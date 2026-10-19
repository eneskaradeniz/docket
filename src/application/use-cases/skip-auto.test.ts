// skip-auto use case — rule A-432 (applyStageSkipAutoPolicy): after a run finishes or
// during the periodic sweep, the pass asks the domain which pending stage-skip proposals
// the stage-skip policy may approve under auto level and appends each as stage_skip_decided with
// decidedByPolicy evidence. Every doubt (below auto, earlier failed gate, earlier rejected skip,
// unreadable level) writes nothing; docs/v2/application.md → A-432.
import { describe, expect, it } from 'vitest';

import {
  parseSlug,
  parseUlid,
  type Actor,
  type RepoSlug,
  type Slug,
  type StageSlug,
  type Ulid,
  type WorkOrderId,
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

import { AUTONOMY_KEY } from './settings';
import { applyStageSkipAutoPolicy } from './skip-auto';

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

const USER: Actor = { kind: 'user', id: 'user-1', label: 'Operator' };

/** Flow with four stages: plan, build, review, ship. */
const DEFINITIONS_BODY = {
  roles: [
    { id: 'worker', name: 'Worker', instructions: 'worker instructions', writeScope: { kind: 'repo' }, capabilities: [], active: true },
    { id: 'reviewer', name: 'Reviewer', instructions: 'reviewer instructions', writeScope: { kind: 'repo' }, capabilities: [], active: true },
  ],
  flows: [
    {
      id: 'auto-flow',
      name: 'Auto Flow',
      stages: [
        {
          id: 'plan',
          name: 'Plan',
          role: 'worker',
          exit: [{ kind: 'command', id: 'plan-checks', commandSet: 'checks' }],
          onFail: { goto: 'plan', maxAttempts: 2 },
        },
        {
          id: 'build',
          name: 'Build',
          role: 'worker',
          exit: [{ kind: 'command', id: 'run-checks', commandSet: 'checks' }],
          onFail: { goto: 'build', maxAttempts: 2 },
        },
        {
          id: 'review',
          name: 'Review',
          role: 'reviewer',
          exit: [{ kind: 'command', id: 'review-checks', commandSet: 'checks' }],
          onFail: { goto: 'review', maxAttempts: 2 },
        },
        {
          id: 'ship',
          name: 'Ship',
          role: 'worker',
          exit: [{ kind: 'human', id: 'final-approval', label: 'Final' }],
          onFail: { goto: 'ship', maxAttempts: 2 },
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
  budget: { amountUsd: 10, warnPercent: 80 },
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

const eventsOf = (h: Harness): Promise<readonly unknown[]> => h.deps.workOrders.events(WORK_ORDER);

describe('applyStageSkipAutoPolicy (A-432)', () => {
  it('A-432: under auto with pending valid skip proposal, appends stage_skip_decided with policy evidence', async () => {
    const h = makeHarness();
    await createIn(h);
    await h.deps.settings.set(AUTONOMY_KEY, 'auto');

    // Planner proposes skipping build and review while current stage is plan
    await h.deps.workOrders.appendEvent(WORK_ORDER, {
      type: 'stage_skip_proposed',
      at: h.clock.now(),
      stages: [slugOf('build') as StageSlug, slugOf('review') as StageSlug],
      reason: 'already verified',
    });
    h.clock.advance(50);

    const result = await applyStageSkipAutoPolicy(h.deps, { id: WORK_ORDER });

    expect(result.ok).toBe(true);
    if (!result.ok) return;

    expect(result.value.decided).toEqual([
      {
        stages: [slugOf('build'), slugOf('review')],
        policy: 'stage-skip-auto',
        level: 'auto',
      },
    ]);
    expect(result.value.state.skippedStages).toEqual([slugOf('build'), slugOf('review')]);

    const events = await eventsOf(h);
    expect(events).toHaveLength(3); // created, proposed, decided
    expect(events[2]).toEqual({
      type: 'stage_skip_decided',
      at: 1_050,
      approved: true,
      decidedByPolicy: { policy: 'stage-skip-auto', level: 'auto' },
    });
  });

  it('A-432: writes nothing below auto level (e.g. manual or unconfigured)', async () => {
    const h = makeHarness();
    await createIn(h);
    // Setting level is left unset (defaults to manual)
    await h.deps.workOrders.appendEvent(WORK_ORDER, {
      type: 'stage_skip_proposed',
      at: h.clock.now(),
      stages: [slugOf('build') as StageSlug],
      reason: 'skip',
    });

    const result = await applyStageSkipAutoPolicy(h.deps, { id: WORK_ORDER });

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.decided).toEqual([]);
    expect(result.value.state.skippedStages).toEqual([]);
    expect(await eventsOf(h)).toHaveLength(2); // created, proposed only
  });

  it('A-432: writes nothing if there is no pending proposal', async () => {
    const h = makeHarness();
    await createIn(h);
    await h.deps.settings.set(AUTONOMY_KEY, 'auto');

    const result = await applyStageSkipAutoPolicy(h.deps, { id: WORK_ORDER });

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.decided).toEqual([]);
    expect(await eventsOf(h)).toHaveLength(1);
  });

  it('A-432: writes nothing if any gate in history failed', async () => {
    const h = makeHarness();
    await createIn(h);
    await h.deps.settings.set(AUTONOMY_KEY, 'auto');

    await h.deps.workOrders.appendEvent(WORK_ORDER, {
      type: 'gate_evaluated',
      at: h.clock.now(),
      stage: slugOf('plan') as StageSlug,
      gate: slugOf('plan-checks'),
      verdict: { status: 'failed', reason: 'broke' },
    });
    await h.deps.workOrders.appendEvent(WORK_ORDER, {
      type: 'stage_skip_proposed',
      at: h.clock.now(),
      stages: [slugOf('build') as StageSlug],
      reason: 'skip',
    });

    const result = await applyStageSkipAutoPolicy(h.deps, { id: WORK_ORDER });

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.decided).toEqual([]);
    expect(await eventsOf(h)).toHaveLength(3); // created, gate_evaluated, proposed
  });

  it('A-432: writes nothing if an earlier proposal was rejected by human', async () => {
    const h = makeHarness();
    await createIn(h);
    await h.deps.settings.set(AUTONOMY_KEY, 'auto');

    await h.deps.workOrders.appendEvent(WORK_ORDER, {
      type: 'stage_skip_proposed',
      at: h.clock.now(),
      stages: [slugOf('build') as StageSlug],
      reason: 'first skip',
    });
    await h.deps.workOrders.appendEvent(WORK_ORDER, {
      type: 'stage_skip_decided',
      at: h.clock.now(),
      approved: false,
    });
    await h.deps.workOrders.appendEvent(WORK_ORDER, {
      type: 'stage_skip_proposed',
      at: h.clock.now(),
      stages: [slugOf('review') as StageSlug],
      reason: 'second skip',
    });

    const result = await applyStageSkipAutoPolicy(h.deps, { id: WORK_ORDER });

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.decided).toEqual([]);
    expect(await eventsOf(h)).toHaveLength(4);
  });

  it('A-432: an unreadable stored level writes nothing', async () => {
    const h = makeHarness();
    await createIn(h);
    await h.deps.settings.set(AUTONOMY_KEY, 'bogus_level');

    await h.deps.workOrders.appendEvent(WORK_ORDER, {
      type: 'stage_skip_proposed',
      at: h.clock.now(),
      stages: [slugOf('build') as StageSlug],
      reason: 'skip',
    });

    const result = await applyStageSkipAutoPolicy(h.deps, { id: WORK_ORDER });

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.decided).toEqual([]);
    expect(await eventsOf(h)).toHaveLength(2);
  });

  it('A-432: returns not_found for unknown work order', async () => {
    const h = makeHarness();
    const result = await applyStageSkipAutoPolicy(h.deps, { id: WORK_ORDER });
    expect(result).toEqual({ ok: false, error: 'not_found' });
  });

  it('A-432: the work order record itself carrying auto is sufficient without global setting', async () => {
    const h = makeHarness();
    await createIn(h, 'auto');

    await h.deps.workOrders.appendEvent(WORK_ORDER, {
      type: 'stage_skip_proposed',
      at: h.clock.now(),
      stages: [slugOf('build') as StageSlug],
      reason: 'skip build',
    });

    const result = await applyStageSkipAutoPolicy(h.deps, { id: WORK_ORDER });

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.decided).toHaveLength(1);
    expect(result.value.decided[0].policy).toBe('stage-skip-auto');
  });
});
