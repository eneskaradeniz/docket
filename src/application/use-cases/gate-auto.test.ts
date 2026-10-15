// gate-auto use case — rule A-410 (applyGateAutoPolicy): after a work order's machine gates are
// evaluated, the pass asks the domain which pending human gates the gate-auto policy may approve
// and appends each through decideHumanGate — the same path and event as a user decision. Every
// doubt (below auto, machine evidence missing, an earlier human reject, an unreadable level)
// writes nothing; docs/v2/application.md → A-410.
import { describe, expect, it } from 'vitest';

import {
  parseSlug,
  parseUlid,
  type Actor,
  type RunId,
  type Slug,
  type StageSlug,
  type Ulid,
  type WorkOrderId,
  type RepoSlug,
} from '../../domain/index';

import type { AppDeps } from '../ports';
import {
  createFakeClock,
  createFakeDefinitionStore,
  createFakeDeps,
  createFakeEventLog,
  type FakeDefinitionStore,
  type FakeEventLog,
  repoFlowOf,
} from '../ports/fakes';

import { applyGateAutoPolicy } from './gate-auto';
import { AUTONOMY_KEY } from './settings';

// --- fixtures ---------------------------------------------------------------------------------------

const slugOf = <B extends string>(input: string): Slug<B> => {
  const parsed = parseSlug<B>(input);
  if (!parsed.ok) throw new Error(`fixture slug must parse: ${input}`);
  return parsed.value;
};

const ulidOf = <B extends string>(input: string): Ulid<B> => {
  const parsed = parseUlid<B>(input);
  if (!parsed.ok) throw new Error(`fixture ulid must parse: ${input}`);
  return parsed.value;
};

const REPO_SLUG: RepoSlug = slugOf('ws');
const WORK_ORDER: WorkOrderId = ulidOf('01ARZ3NDEKTSV4RRFFQ69G5FAV');
const RUN_ID: RunId = ulidOf('01ARZ3NDEKTSV4RRFFQ69G5FA1');

const USER: Actor = { kind: 'user', id: 'user-1', label: 'Operator' };
const POLICY_ACTOR: Actor = { kind: 'policy', policy: slugOf<'policy'>('gate-auto'), level: 'auto' };

/** One stage mixing the machine gate the policy relies on with the human gate it may decide. */
const DEFINITIONS_BODY = {
  roles: [
    { id: 'worker', name: 'Worker', instructions: 'worker instructions', writeScope: { kind: 'repo' }, capabilities: [], active: true },
  ],
  flows: [
    {
      id: 'auto-flow',
      name: 'Auto',
      stages: [
        {
          id: 'build',
          name: 'Build',
          role: 'worker',
          exit: [
            { kind: 'command', id: 'run-checks', commandSet: 'checks' },
            { kind: 'human', id: 'final-approval', label: 'Final approval' },
          ],
        },
      ],
    },
  ],
  capabilities: [],
};

const REPO_BODY = {
  id: 'ws',
  name: 'Repo',
  flow: repoFlowOf(DEFINITIONS_BODY.flows[0]),
  defaultLimitPolicy: 'wait_resume',
  commandSets: { checks: ['npm test'] },
  docsRoot: 'docs',
  testGlobs: [],
  environments: [],
};

interface Harness {
  readonly deps: AppDeps;
  readonly clock: ReturnType<typeof createFakeClock>;
  readonly definitions: FakeDefinitionStore;
  readonly log: FakeEventLog;
}

const makeHarness = (): Harness => {
  const clock = createFakeClock(1_000);
  const definitions = createFakeDefinitionStore();
  const log = createFakeEventLog();
  definitions.seed({ kind: 'global' }, 'definitions.json', JSON.stringify(DEFINITIONS_BODY));
  definitions.seed({ kind: 'repo', repo: REPO_SLUG }, 'repo.yaml', JSON.stringify(REPO_BODY));
  const deps = createFakeDeps({
    clock,
    definitions,
    log,
  });
  return { deps, clock, definitions, log };
};

const createIn = async (h: Harness, autonomy?: 'auto'): Promise<void> => {
  const flowId = slugOf<'flow'>('auto-flow');
  await h.deps.workOrders.create({
    id: WORK_ORDER,
    project: slugOf<'project'>('proj'),
    repo: REPO_SLUG,
    flow: flowId,
    title: 'Fixture',
    createdAt: h.clock.now(),
    createdBy: USER,
    ...(autonomy !== undefined ? { autonomy } : {}),
  });
  await h.deps.workOrders.appendEvent(WORK_ORDER, { type: 'created', at: h.clock.now(), by: USER, flow: flowId });
};

/** A succeeded run of the build stage, then its command gate passed: awaiting_human on the
 *  human gate — the exact standing the policy pass is for. */
const machineConcludedIn = async (h: Harness): Promise<void> => {
  const stage = slugOf('build') as StageSlug;
  await h.deps.workOrders.appendEvent(WORK_ORDER, { type: 'run_started', at: h.clock.now(), runId: RUN_ID, stage, attempt: 1 });
  await h.deps.workOrders.appendEvent(WORK_ORDER, { type: 'run_finished', at: h.clock.now(), runId: RUN_ID, outcome: 'succeeded' });
  await h.deps.workOrders.appendEvent(WORK_ORDER, {
    type: 'gate_evaluated',
    at: h.clock.now(),
    stage,
    gate: slugOf('run-checks'),
    verdict: { status: 'passed' },
  });
};

const eventsOf = (h: Harness): Promise<readonly unknown[]> => h.deps.workOrders.events(WORK_ORDER);

describe('applyGateAutoPolicy', () => {
  it('A-410: under auto with the machine gates concluded, approves the human gate through the same event and audit as a user decision', async () => {
    const h = makeHarness();
    await createIn(h);
    await machineConcludedIn(h);
    await h.deps.settings.set(AUTONOMY_KEY, 'auto');
    h.clock.advance(50);

    const result = await applyGateAutoPolicy(h.deps, { id: WORK_ORDER });

    expect(result).toEqual({
      ok: true,
      value: { status: 'done', stage: null, attempt: 1, pendingGates: [], skippedStages: [] },
    });
    const events = await eventsOf(h);
    expect(events[4]).toEqual({
      type: 'gate_evaluated',
      at: 1_050,
      stage: slugOf('build'),
      gate: slugOf('final-approval'),
      verdict: { status: 'passed' },
      approvedByPolicy: { policy: 'gate-auto', level: 'auto', passedMachineGates: ['run-checks'] },
    });
    expect(h.log.entries()).toHaveLength(1);
    expect(h.log.entries()[0]).toMatchObject({ actor: POLICY_ACTOR, action: 'gate.decided' });
  });

  it('A-410: writes nothing below the auto level — the gate stays pending for the human', async () => {
    const h = makeHarness();
    await createIn(h);
    await machineConcludedIn(h);

    const result = await applyGateAutoPolicy(h.deps, { id: WORK_ORDER });

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value).toMatchObject({ status: 'awaiting_human', pendingGates: ['final-approval'] });
    expect(await eventsOf(h)).toHaveLength(4);
    expect(h.log.entries()).toHaveLength(0);
  });

  it('A-410: writes nothing while the stage still gates on a machine gate', async () => {
    const h = makeHarness();
    await createIn(h);
    const stage = slugOf('build') as StageSlug;
    await h.deps.workOrders.appendEvent(WORK_ORDER, { type: 'run_started', at: h.clock.now(), runId: RUN_ID, stage, attempt: 1 });
    await h.deps.workOrders.appendEvent(WORK_ORDER, { type: 'run_finished', at: h.clock.now(), runId: RUN_ID, outcome: 'succeeded' });
    await h.deps.settings.set(AUTONOMY_KEY, 'auto');

    const result = await applyGateAutoPolicy(h.deps, { id: WORK_ORDER });

    expect(result.ok).toBe(true);
    expect(await eventsOf(h)).toHaveLength(3);
    expect(h.log.entries()).toHaveLength(0);
  });

  it('A-410: never re-approves a gate the human rejected — the reject is standing doubt', async () => {
    const h = makeHarness();
    await createIn(h);
    await machineConcludedIn(h);
    await h.deps.settings.set(AUTONOMY_KEY, 'auto');
    const rejected = await h.deps.workOrders.events(WORK_ORDER);
    // The operator rejects; the stage re-enters and its run + machine gate conclude again.
    await h.deps.workOrders.appendEvent(WORK_ORDER, {
      type: 'gate_evaluated',
      at: h.clock.now(),
      stage: slugOf('build'),
      gate: slugOf('final-approval'),
      verdict: { status: 'failed', reason: 'no' },
    });
    await h.deps.workOrders.appendEvent(WORK_ORDER, { type: 'run_started', at: h.clock.now(), runId: RUN_ID, stage: slugOf('build') as StageSlug, attempt: 2 });
    await h.deps.workOrders.appendEvent(WORK_ORDER, { type: 'run_finished', at: h.clock.now(), runId: RUN_ID, outcome: 'succeeded' });
    await h.deps.workOrders.appendEvent(WORK_ORDER, {
      type: 'gate_evaluated',
      at: h.clock.now(),
      stage: slugOf('build'),
      gate: slugOf('run-checks'),
      verdict: { status: 'passed' },
    });

    const result = await applyGateAutoPolicy(h.deps, { id: WORK_ORDER });

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value).toMatchObject({ status: 'awaiting_human', pendingGates: ['final-approval'] });
    expect(await eventsOf(h)).toHaveLength(rejected.length + 4);
    expect(h.log.entries()).toHaveLength(0);
  });

  it('A-410: an unreadable stored level writes nothing — the refusal surfaces on its own typed reads', async () => {
    const h = makeHarness();
    await createIn(h);
    await machineConcludedIn(h);
    await h.deps.settings.set(AUTONOMY_KEY, 'bogus');

    const result = await applyGateAutoPolicy(h.deps, { id: WORK_ORDER });

    expect(result.ok).toBe(true);
    expect(await eventsOf(h)).toHaveLength(4);
    expect(h.log.entries()).toHaveLength(0);
  });

  it('A-410: an unknown work order is not_found', async () => {
    const h = makeHarness();

    const result = await applyGateAutoPolicy(h.deps, { id: WORK_ORDER });

    expect(result).toEqual({ ok: false, error: 'not_found' });
  });

  it('A-410: the work order record itself carrying auto is enough — no settings key anywhere (the walk seed’s shape)', async () => {
    const h = makeHarness();
    await createIn(h, 'auto');
    await machineConcludedIn(h);
    h.clock.advance(50);

    const result = await applyGateAutoPolicy(h.deps, { id: WORK_ORDER });

    expect(result).toEqual({
      ok: true,
      value: { status: 'done', stage: null, attempt: 1, pendingGates: [], skippedStages: [] },
    });
    const events = await eventsOf(h);
    expect(events[4]).toMatchObject({
      gate: 'final-approval',
      approvedByPolicy: { policy: 'gate-auto', level: 'auto', passedMachineGates: ['run-checks'] },
    });
  });
});
