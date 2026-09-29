// remote-checks-gate use case — rules E-14 (gate eligibility and forge resolution), E-15 (matching
// returned checks against `required`), E-16 (the timeout deadline) and E-17 (the single event a
// concluded poll leaves behind) from docs/v2/application.md, driven over the in-memory fakes.
import { describe, expect, it } from 'vitest';

import {
  err,
  parseSlug,
  parseUlid,
  type Actor,
  type RepoRef,
  type Result,
  type Slug,
  type Ulid,
  type WorkOrderId,
  type WorkOrderState,
  type RepoSlug,
} from '../../domain/index';

import type { AppDeps, CheckRun, Forge, ForgeResolver, RemoteChecksError } from '../index';
import {
  createFakeClock,
  createFakeDefinitionStore,
  createFakeDeps,
  createFakeForge,
  type FakeDefinitionStore,
} from '../ports/fakes/index';

import { pollRemoteChecks } from '../index';

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

const REPO: RepoRef = { id: 'repo-1', remote: 'https://forge.example/ws/app.git', defaultBranch: 'main' };
const BRANCH_REF = 'feature/shine';

/** One definition file covering every remote-checks scenario, valid per the domain validators. */
const DEFINITIONS_BODY = {
  roles: [
    { id: 'worker', name: 'Worker', instructions: 'worker instructions', writeScope: { kind: 'repo' }, capabilities: [], active: true },
  ],
  flows: [
    {
      id: 'all-flow',
      name: 'All checks',
      stages: [{
        id: 'verify',
        name: 'Verify',
        role: null,
        exit: [{ kind: 'remote_checks', id: 'ci', required: 'all', timeoutMinutes: 10 }],
      }],
    },
    {
      id: 'required-flow',
      name: 'Required checks',
      stages: [{
        id: 'verify',
        name: 'Verify',
        role: null,
        exit: [{ kind: 'remote_checks', id: 'ci', required: ['lint', 'test'], timeoutMinutes: 10 }],
      }],
    },
    {
      id: 'mixed-flow',
      name: 'Mixed exits',
      stages: [{
        id: 'verify',
        name: 'Verify',
        role: null,
        exit: [
          { kind: 'remote_checks', id: 'ci', required: 'all', timeoutMinutes: 10 },
          { kind: 'human', id: 'signoff', label: 'Signoff' },
        ],
      }],
    },
    {
      id: 'two-stage-flow',
      name: 'Build then verify',
      stages: [
        { id: 'build', name: 'Build', role: null, exit: [{ kind: 'human', id: 'enter-approval', label: 'Enter' }] },
        { id: 'verify', name: 'Verify', role: null, exit: [{ kind: 'remote_checks', id: 'ci', required: 'all', timeoutMinutes: 10 }] },
      ],
    },
  ],
  capabilities: [],
  repo: {
    id: 'ws',
    name: 'Repo',
    repos: [],
    flows: ['all-flow', 'required-flow', 'mixed-flow', 'two-stage-flow'],
    defaultFlow: 'all-flow',
    commandSets: { 'deploy-stg': ['docket-deploy stg'] },
    roleOverrides: [],
    docsRoot: 'docs',
    testGlobs: [],
    environments: [
      { id: 'stg', name: 'Staging', order: 1, deploy: 'deploy-stg', env: {}, protected: false },
    ],
  },
};

interface Harness {
  readonly deps: AppDeps;
  readonly clock: ReturnType<typeof createFakeClock>;
  readonly definitions: FakeDefinitionStore;
}

const makeHarness = (): Harness => {
  const clock = createFakeClock(1_000);
  const definitions = createFakeDefinitionStore();
  definitions.seed({ kind: 'global' }, 'definitions.json', JSON.stringify(DEFINITIONS_BODY));
  const deps = createFakeDeps({ clock, definitions });
  return { deps, clock, definitions };
};

/** Creates the work order with its `created` event, the way openWorkOrder would have. */
const createIn = async (h: Harness, flow: string): Promise<void> => {
  const flowId = slugOf<'flow'>(flow);
  await h.deps.workOrders.create({
    id: WORK_ORDER,
    repo: REPO_SLUG,
    flow: flowId,
    title: 'Fixture',
    createdAt: h.clock.now(),
    createdBy: USER,
  });
  await h.deps.workOrders.appendEvent(WORK_ORDER, { type: 'created', at: h.clock.now(), by: USER, flow: flowId });
};

const eventsOf = (h: Harness): Promise<readonly unknown[]> => h.deps.workOrders.events(WORK_ORDER);

const check = (name: string, status: CheckRun['status']): CheckRun => ({ name, status });

/** The fake forge with its `checks` wrapped, so a test can see the repo and ref it was polled with. */
const trackingForge = (checks: readonly CheckRun[]): {
  readonly forge: Forge;
  readonly seen: readonly { readonly repo: RepoRef; readonly ref: string }[];
} => {
  const base = createFakeForge({ checks });
  const seen: { repo: RepoRef; ref: string }[] = [];
  return {
    seen,
    forge: {
      ...base,
      checks: async (repo, ref) => {
        seen.push({ repo, ref });
        return base.checks(repo, ref);
      },
    },
  };
};

/** A resolver that hands out `forge` for every repo and records what it was asked to resolve. */
const resolverFor = (forge: Forge | undefined): {
  readonly resolver: ForgeResolver;
  readonly asked: readonly RepoRef[];
} => {
  const asked: RepoRef[] = [];
  return { asked, resolver: { forRepo: async (repo) => { asked.push(repo); return forge; } } };
};

/** A forge whose checks call errors — any errored call reads as forge_error. */
const failingForge = (): Forge => ({ ...createFakeForge(), checks: async () => err('network') });

const poll = (h: Harness, resolver: ForgeResolver, gate: string): Promise<Result<WorkOrderState, RemoteChecksError>> =>
  pollRemoteChecks(h.deps, resolver, { id: WORK_ORDER, gate: slugOf<'gate'>(gate), branchRef: BRANCH_REF, repo: REPO });

// --- pollRemoteChecks (E-14, E-15, E-16, E-17) -------------------------------------------------------

describe('pollRemoteChecks', () => {
  it('E-14: polls a pending remote_checks gate of the current stage through the repo’s forge', async () => {
    const h = makeHarness();
    await createIn(h, 'all-flow');
    const { forge, seen } = trackingForge([check('lint', 'passed'), check('test', 'passed')]);
    const { resolver, asked } = resolverFor(forge);
    h.clock.advance(50);

    const result = await poll(h, resolver, 'ci');

    expect(result).toEqual({
      ok: true,
      value: { status: 'done', stage: null, attempt: 1, pendingGates: [] },
    });
    expect(asked).toEqual([REPO]);
    expect(seen).toEqual([{ repo: REPO, ref: BRANCH_REF }]);
    const events = await eventsOf(h);
    expect(events).toHaveLength(2);
    expect(events[1]).toEqual({
      type: 'gate_evaluated',
      at: 1_050,
      stage: 'verify',
      gate: 'ci',
      verdict: { status: 'passed' },
    });
  });

  it('E-14: an unknown work order is not_found', async () => {
    const h = makeHarness();
    const { forge, seen } = trackingForge([]);
    const { resolver, asked } = resolverFor(forge);

    const result = await poll(h, resolver, 'ci');

    expect(result).toEqual({ ok: false, error: 'not_found' });
    expect(asked).toHaveLength(0);
    expect(seen).toHaveLength(0);
  });

  it('E-14: definitions that do not load leave no gate to find (not_found)', async () => {
    const h = makeHarness();
    h.definitions.seed({ kind: 'global' }, 'definitions.json', '{ not json');
    await createIn(h, 'all-flow');
    const { forge, seen } = trackingForge([]);
    const { resolver, asked } = resolverFor(forge);

    const result = await poll(h, resolver, 'ci');

    expect(result).toEqual({ ok: false, error: 'not_found' });
    expect(asked).toHaveLength(0);
    expect(seen).toHaveLength(0);
  });

  it('E-14: a gate of a stage that is not the current stage is not_current_stage', async () => {
    const h = makeHarness();
    await createIn(h, 'two-stage-flow'); // sits in 'build'; 'ci' belongs to 'verify'
    const { forge, seen } = trackingForge([]);
    const { resolver, asked } = resolverFor(forge);

    const result = await poll(h, resolver, 'ci');

    expect(result).toEqual({ ok: false, error: 'not_current_stage' });
    expect(asked).toHaveLength(0);
    expect(seen).toHaveLength(0);

    // A finished work order has no current stage either, so the same code answers.
    const done = makeHarness();
    await createIn(done, 'all-flow');
    const green = resolverFor(trackingForge([check('lint', 'passed')]).forge);
    expect(await poll(done, green.resolver, 'ci')).toEqual({ ok: true, value: { status: 'done', stage: null, attempt: 1, pendingGates: [] } });
    const again = resolverFor(trackingForge([check('lint', 'passed')]).forge);
    expect(await poll(done, again.resolver, 'ci')).toEqual({ ok: false, error: 'not_current_stage' });
  });

  it('E-14: a gate of the current stage that is no longer pending is not_pending', async () => {
    const h = makeHarness();
    await createIn(h, 'mixed-flow');
    await h.deps.workOrders.appendEvent(WORK_ORDER, {
      type: 'gate_evaluated',
      at: h.clock.now(),
      stage: slugOf<'stage'>('verify'),
      gate: slugOf<'gate'>('ci'),
      verdict: { status: 'passed' },
    });
    const { forge, seen } = trackingForge([]);
    const { resolver, asked } = resolverFor(forge);

    const result = await poll(h, resolver, 'ci');

    expect(result).toEqual({ ok: false, error: 'not_pending' });
    expect(asked).toHaveLength(0);
    expect(seen).toHaveLength(0);
  });

  it('E-14: a gate that is not a remote_checks gate is not_a_remote_checks_gate', async () => {
    const h = makeHarness();
    await createIn(h, 'mixed-flow');
    const { forge, seen } = trackingForge([]);
    const { resolver, asked } = resolverFor(forge);

    const result = await poll(h, resolver, 'signoff');

    expect(result).toEqual({ ok: false, error: 'not_a_remote_checks_gate' });
    expect(asked).toHaveLength(0);
    expect(seen).toHaveLength(0);
  });

  it('E-14: a repo with no resolvable forge is forge_unavailable', async () => {
    const h = makeHarness();
    await createIn(h, 'all-flow');
    const { resolver, asked } = resolverFor(undefined);

    const result = await poll(h, resolver, 'ci');

    expect(result).toEqual({ ok: false, error: 'forge_unavailable' });
    expect(asked).toEqual([REPO]);
    expect(await eventsOf(h)).toHaveLength(1);
  });

  it('E-14: an errored forge.checks call is forge_error', async () => {
    const h = makeHarness();
    await createIn(h, 'all-flow');
    const { resolver } = resolverFor(failingForge());

    const result = await poll(h, resolver, 'ci');

    expect(result).toEqual({ ok: false, error: 'forge_error' });
    expect(await eventsOf(h)).toHaveLength(1);
  });

  it('E-15: every named check passed reports all_passed and passes the gate', async () => {
    const h = makeHarness();
    await createIn(h, 'required-flow');
    const { resolver } = resolverFor(trackingForge([check('lint', 'passed'), check('test', 'passed')]).forge);

    const result = await poll(h, resolver, 'ci');

    expect(result).toEqual({
      ok: true,
      value: { status: 'done', stage: null, attempt: 1, pendingGates: [] },
    });
  });

  it('E-15: a failed or cancelled check reports has_failure naming the first such check', async () => {
    const h = makeHarness();
    await createIn(h, 'all-flow');
    const { resolver } = resolverFor(
      trackingForge([check('build', 'passed'), check('lint', 'failed'), check('test', 'cancelled')]).forge,
    );

    const result = await poll(h, resolver, 'ci');

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.status).toBe('blocked');
    expect(result.value.blockedReason).toBe('gate "ci" failed: remote check failed: lint');

    const cancelledOnly = makeHarness();
    await createIn(cancelledOnly, 'all-flow');
    const cancelled = resolverFor(trackingForge([check('audit', 'cancelled')]).forge);
    const cancelledResult = await poll(cancelledOnly, cancelled.resolver, 'ci');
    expect(cancelledResult.ok).toBe(true);
    if (!cancelledResult.ok) return;
    expect(cancelledResult.value.blockedReason).toBe('gate "ci" failed: remote check failed: audit');
  });

  it('E-15: queued, running and skipped checks leave the status pending', async () => {
    for (const status of ['queued', 'running', 'skipped'] as const) {
      const h = makeHarness();
      await createIn(h, 'all-flow');
      const { resolver } = resolverFor(trackingForge([check('lint', status)]).forge);

      const result = await poll(h, resolver, 'ci');

      expect(result).toEqual({
        ok: true,
        value: { status: 'awaiting_human', stage: 'verify', attempt: 1, pendingGates: ['ci'] },
      });
      expect(await eventsOf(h)).toHaveLength(1);
    }

    // A pass mixed with an unfinished check is still not a pass.
    const mixed = makeHarness();
    await createIn(mixed, 'all-flow');
    const mixedResolver = resolverFor(trackingForge([check('lint', 'passed'), check('test', 'running')]).forge);
    const mixedResult = await poll(mixed, mixedResolver.resolver, 'ci');
    expect(mixedResult.ok).toBe(true);
    if (!mixedResult.ok) return;
    expect(mixedResult.value.pendingGates).toEqual(['ci']);
    expect(await eventsOf(mixed)).toHaveLength(1);
  });

  it('E-15: a required array filters to the named checks only', async () => {
    const h = makeHarness();
    await createIn(h, 'required-flow');
    // 'build' failing must not colour a verdict it is not part of.
    const { resolver } = resolverFor(
      trackingForge([check('lint', 'passed'), check('build', 'failed'), check('test', 'passed')]).forge,
    );

    const result = await poll(h, resolver, 'ci');

    expect(result).toEqual({
      ok: true,
      value: { status: 'done', stage: null, attempt: 1, pendingGates: [] },
    });
  });

  it('E-15: a required name with no returned match keeps the gate pending', async () => {
    const h = makeHarness();
    await createIn(h, 'required-flow');
    const { resolver } = resolverFor(trackingForge([check('lint', 'passed')]).forge); // 'test' never reported

    const result = await poll(h, resolver, 'ci');

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.pendingGates).toEqual(['ci']);
    expect(await eventsOf(h)).toHaveLength(1);

    // Names the gate does not require are equally absent from the match.
    const unknown = makeHarness();
    await createIn(unknown, 'required-flow');
    const unknownResolver = resolverFor(trackingForge([check('build', 'passed')]).forge);
    const unknownResult = await poll(unknown, unknownResolver.resolver, 'ci');
    expect(unknownResult.ok).toBe(true);
    if (!unknownResult.ok) return;
    expect(unknownResult.value.pendingGates).toEqual(['ci']);
    expect(await eventsOf(unknown)).toHaveLength(1);
  });

  it('E-15: an empty returned checks list keeps the gate pending', async () => {
    const h = makeHarness();
    await createIn(h, 'all-flow');
    const { resolver } = resolverFor(trackingForge([]).forge);

    const result = await poll(h, resolver, 'ci');

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.pendingGates).toEqual(['ci']);
    expect(await eventsOf(h)).toHaveLength(1);
  });

  it('E-16: elapsed time beyond timeoutMinutes since the gate entered pending fails with timeout', async () => {
    const h = makeHarness();
    await createIn(h, 'all-flow'); // gate pending since t = 1_000; timeout 10 minutes
    const { resolver } = resolverFor(trackingForge([check('lint', 'queued')]).forge);
    h.clock.advance(10 * 60_000 + 1);

    const result = await poll(h, resolver, 'ci');

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.status).toBe('blocked');
    expect(result.value.blockedReason).toBe('gate "ci" failed: timeout');
    const events = await eventsOf(h);
    expect(events).toHaveLength(2);
    expect(events[1]).toMatchObject({ type: 'gate_evaluated', verdict: { status: 'failed', reason: 'timeout' } });

    // A definitive failure arrived inside the window of a late poll: the failure, not the deadline.
    const failed = makeHarness();
    await createIn(failed, 'all-flow');
    const failedResolver = resolverFor(trackingForge([check('lint', 'failed')]).forge);
    failed.clock.advance(10 * 60_000 + 1);
    const failedResult = await poll(failed, failedResolver.resolver, 'ci');
    expect(failedResult.ok).toBe(true);
    if (!failedResult.ok) return;
    expect(failedResult.value.blockedReason).toBe('gate "ci" failed: remote check failed: lint');
  });

  it('E-16: exactly timeoutMinutes elapsed is not yet a timeout', async () => {
    const h = makeHarness();
    await createIn(h, 'all-flow');
    const { resolver } = resolverFor(trackingForge([check('lint', 'queued')]).forge);
    h.clock.advance(10 * 60_000); // elapsed === timeoutMinutes, and the rule says "exceeds"

    const result = await poll(h, resolver, 'ci');

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.pendingGates).toEqual(['ci']);
    expect(await eventsOf(h)).toHaveLength(1);
  });

  it('E-16: the clock starts when the gate entered pending, not when the work order was created', async () => {
    const h = makeHarness();
    await createIn(h, 'two-stage-flow'); // created at 1_000; 'ci' belongs to the later 'verify' stage
    h.clock.advance(200_000); // 201_000
    await h.deps.workOrders.appendEvent(WORK_ORDER, {
      type: 'gate_evaluated',
      at: h.clock.now(),
      stage: slugOf<'stage'>('build'),
      gate: slugOf<'gate'>('enter-approval'),
      verdict: { status: 'passed' },
    }); // 'verify' entered at 201_000 — 'ci' pending from here
    h.clock.advance(500_000); // 701_000: 700_000 since created, only 500_000 since pending

    const before = resolverFor(trackingForge([check('lint', 'queued')]).forge);
    const beforeResult = await poll(h, before.resolver, 'ci');
    expect(beforeResult.ok).toBe(true);
    if (!beforeResult.ok) return;
    expect(beforeResult.value.pendingGates).toEqual(['ci']);
    expect(await eventsOf(h)).toHaveLength(2);

    h.clock.advance(100_001); // 801_001: 600_001 since the gate entered pending
    const after = resolverFor(trackingForge([check('lint', 'queued')]).forge);
    const afterResult = await poll(h, after.resolver, 'ci');
    expect(afterResult.ok).toBe(true);
    if (!afterResult.ok) return;
    expect(afterResult.value.status).toBe('blocked');
    expect(afterResult.value.blockedReason).toBe('gate "ci" failed: timeout');
  });

  it('E-17: a concluded poll appends exactly one gate_evaluated event with the remoteChecks evidence', async () => {
    const h = makeHarness();
    await createIn(h, 'all-flow');
    const { resolver } = resolverFor(trackingForge([check('lint', 'failed')]).forge);
    h.clock.advance(25);

    const result = await poll(h, resolver, 'ci');

    expect(result.ok).toBe(true);
    const events = await eventsOf(h);
    expect(events).toHaveLength(2);
    expect(events[1]).toEqual({
      type: 'gate_evaluated',
      at: 1_025,
      stage: 'verify',
      gate: 'ci',
      verdict: { status: 'failed', reason: 'remote check failed: lint' },
    });
  });

  it('E-17: a pending outcome appends nothing — the gate stays pending for the dispatcher to re-poll', async () => {
    const h = makeHarness();
    await createIn(h, 'all-flow');
    const running = resolverFor(trackingForge([check('lint', 'running')]).forge);

    const first = await poll(h, running.resolver, 'ci');

    expect(first.ok).toBe(true);
    if (!first.ok) return;
    expect(first.value.pendingGates).toEqual(['ci']);
    expect(await eventsOf(h)).toHaveLength(1);

    // The next poll sees fresh checks and concludes normally.
    const passed = resolverFor(trackingForge([check('lint', 'passed')]).forge);
    const second = await poll(h, passed.resolver, 'ci');
    expect(second).toEqual({
      ok: true,
      value: { status: 'done', stage: null, attempt: 1, pendingGates: [] },
    });
    expect(await eventsOf(h)).toHaveLength(2);
  });

  it('returns Result values only (ok true with a value, or ok false with a code)', async () => {
    const h = makeHarness();
    await createIn(h, 'all-flow');
    const results: readonly Result<unknown, string>[] = [
      await poll(h, resolverFor(trackingForge([check('lint', 'passed')]).forge).resolver, 'ci'),
      await poll(h, resolverFor(undefined).resolver, 'ci'),
    ];
    for (const result of results) {
      expect(result.ok).toBeTypeOf('boolean');
      if (result.ok) expect(Object.keys(result)).toEqual(['ok', 'value']);
      else expect(Object.keys(result)).toEqual(['ok', 'error']);
    }
  });
});
