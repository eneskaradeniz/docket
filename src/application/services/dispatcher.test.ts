// services/dispatcher tests — rules A-17a (applyLimitDecision), A-19 (enqueueStage) and A-20
// (dispatcherTick) from docs/v2/application.md, driven over the in-memory port fakes.
import { describe, expect, it } from 'vitest';

import type {
  AccountId,
  AccountRoute,
  Actor,
  DispatchDecision,
  DispatchLimits,
  EpochMs,
  Meter,
  MeterId,
  Pool,
  PoolId,
  QueueItem,
  QueueItemId,
  Result,
  RunId,
  Slug,
  SpendCap,
  StageSlug,
  Ulid,
  WorkOrderId,
  RepoSlug,
} from '../../domain/index';
import { deriveWorkOrderState, isUlid, parseSlug, parseUlid } from '../../domain/index';

import type { AccountRecord, AppDeps } from '../ports';
import {
  createFakeClock,
  createFakeDefinitionStore,
  createFakeDeps,
  type FakeClock,
  type FakeDefinitionStore,
} from '../ports/fakes';

import { applyLimitDecision, dispatcherTick, enqueueStage } from './dispatcher';

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

const REPO: RepoSlug = slugOf('ws');
const OTHER: RepoSlug = slugOf('other');
const IMPLEMENT: StageSlug = slugOf('implement');
const IMPLEMENTER = slugOf<'role'>('implementer');

const WO1: WorkOrderId = ulidOf('01ARZ3NDEKTSV4RRFFQ69G5FAV');
const WO2: WorkOrderId = ulidOf('01ARZ3NDEKTSV4RRFFQ69G5FAW');
const WO3: WorkOrderId = ulidOf('01ARZ3NDEKTSV4RRFFQ69G5FAX');
const WO4: WorkOrderId = ulidOf('01ARZ3NDEKTSV4RRFFQ69G5FAY'); // only created where a test wants an orphan

const RUN1: RunId = ulidOf('01ARZ3NDEKTSV4RRFFQ69G5FBV');
const RUN2: RunId = ulidOf('01ARZ3NDEKTSV4RRFFQ69G5FBW');

const A1: AccountId = ulidOf('01ARZ3NDEKTSV4RRFFQ69G5FCV');
const A2: AccountId = ulidOf('01ARZ3NDEKTSV4RRFFQ69G5FCW');
const A3: AccountId = ulidOf('01ARZ3NDEKTSV4RRFFQ69G5FCX'); // never saved to the repo

const Q1: QueueItemId = ulidOf('01ARZ3NDEKTSV4RRFFQ69G5FDV');
const Q2: QueueItemId = ulidOf('01ARZ3NDEKTSV4RRFFQ69G5FDW');
const Q3: QueueItemId = ulidOf('01ARZ3NDEKTSV4RRFFQ69G5FDX');

const POOL1: PoolId = ulidOf('01ARZ3NDEKTSV4RRFFQ69G5FEV');
const METER1: MeterId = ulidOf('01ARZ3NDEKTSV4RRFFQ69G5FEW');

const USER: Actor = { kind: 'user', id: 'user-1', label: 'Operator' };

/** A mid-month instant: 2026-09-26T15:04:05.678Z. Its UTC day and month boundaries are pinned below. */
const MID_MONTH: EpochMs = 1_790_435_045_678;
const UTC_DAY_START: EpochMs = 1_790_380_800_000; // 2026-09-26T00:00:00.000Z
const PREV_DAY_NOON: EpochMs = 1_790_337_600_000; // 2026-09-25T12:00:00.000Z — same month, earlier day
const UTC_MONTH_START: EpochMs = 1_788_220_800_000; // 2026-09-01T00:00:00.000Z
const PREV_MONTH_END: EpochMs = 1_788_220_799_999; // 2026-08-31T23:59:59.999Z

const DEFINITIONS_BODY = {
  roles: [
    {
      id: 'implementer',
      name: 'Implementer',
      instructions: 'implement the task',
      writeScope: { kind: 'repo' },
      capabilities: [],
      active: true,
    },
  ],
  flows: [
    {
      id: 'standard',
      name: 'Standard',
      stages: [{ id: 'implement', name: 'Implement', role: 'implementer', exit: [] }],
    },
    {
      id: 'manual',
      name: 'Manual',
      stages: [
        { id: 'check', name: 'Check', role: null, exit: [{ kind: 'human', id: 'sign-off', label: 'Sign off' }] },
      ],
    },
  ],
  capabilities: [],
  repo: {
    id: 'ws',
    name: 'Repo',
    repos: [],
    flows: ['standard', 'manual'],
    defaultFlow: 'standard',
    commandSets: {},
    roleOverrides: [],
    docsRoot: 'docs',
    testGlobs: [],
  },
};

interface Harness {
  readonly deps: AppDeps;
  readonly clock: FakeClock;
  readonly definitions: FakeDefinitionStore;
}

const makeHarness = (start: EpochMs = 1_000): Harness => {
  const clock = createFakeClock(start);
  const definitions = createFakeDefinitionStore();
  definitions.seed({ kind: 'global' }, 'definitions.json', JSON.stringify(DEFINITIONS_BODY));
  const deps = createFakeDeps({ clock, definitions });
  return { deps, clock, definitions };
};

const route = (accountId: AccountId, model?: string): AccountRoute =>
  model === undefined ? { accountId } : { accountId, model };

const account = (
  id: AccountId,
  caps: readonly { readonly scope: 'account_day' | 'account_week' | 'account_month'; readonly cap: SpendCap }[] = [],
): AccountRecord => ({
  id,
  provider: 'provider-x',
  label: `account ${id}`,
  authMode: 'subscription',
  limitPolicy: 'ask',
  caps,
});

const pool = (id: PoolId, accountId: AccountId): Pool => ({
  id,
  accountId,
  label: 'allowance',
  kind: 'allowance',
  appliesTo: 'all',
});

const meter = (id: MeterId, poolId: PoolId, at: EpochMs): Meter => ({
  id,
  poolId,
  cadence: 'calendar',
  unit: 'fraction',
  remaining: 0,
  resetsAt: 9_000,
  resetPrecision: 'exact',
  observedAt: at,
  source: 'pushed',
});

const LIMITS = (over: Partial<DispatchLimits> = {}): DispatchLimits => ({
  global: 4,
  perRepo: 3,
  perAccount: {},
  ...over,
});

/** Creates the work order with its `created` event, the way openWorkOrder would have. */
const createWorkOrder = async (
  h: Harness,
  id: WorkOrderId,
  repo: RepoSlug = REPO,
  flow = 'standard',
): Promise<void> => {
  const flowId = slugOf<'flow'>(flow);
  await h.deps.workOrders.create({
    id,
    project: slugOf<'project'>('proj'),
    repo,
    flow: flowId,
    title: `fixture ${id}`,
    createdAt: h.clock.now(),
    createdBy: USER,
  });
  await h.deps.workOrders.appendEvent(id, { type: 'created', at: h.clock.now(), by: USER, flow: flowId });
};

/** A run record exactly as executeRun would have written it before it streams. */
const createRun = async (
  h: Harness,
  runId: RunId,
  workOrderId: WorkOrderId,
  runRoute: AccountRoute,
): Promise<void> => {
  await h.deps.runs.create({
    id: runId,
    workOrderId,
    stage: IMPLEMENT,
    attempt: 1,
    role: IMPLEMENTER,
    route: runRoute,
    startedAt: h.clock.now(),
    autoResumesUsed: 0,
  });
};

const queueItem = (
  id: QueueItemId,
  workOrderId: WorkOrderId,
  itemRoute: AccountRoute,
  over: { readonly priority?: number; readonly enqueuedAt?: EpochMs; readonly notBefore?: EpochMs } = {},
): QueueItem => ({
  id,
  workOrderId,
  repo: REPO,
  stage: IMPLEMENT,
  route: itemRoute,
  priority: over.priority ?? 0,
  enqueuedAt: over.enqueuedAt ?? 1_000,
  ...(over.notBefore !== undefined ? { notBefore: over.notBefore } : {}),
});

// `start` recorder: dispatcherTick hands each started item to it, fire-and-forget.
interface StartRecorder {
  readonly items: QueueItem[];
  readonly callback: (item: QueueItem) => void;
}

const startRecorder = (): StartRecorder => {
  const items: QueueItem[] = [];
  return { items, callback: (item: QueueItem): void => { items.push(item); } };
};

const queueAfter = async (h: Harness): Promise<readonly QueueItem[]> => h.deps.queue.list();

const expectEnqueueErr = (
  result: Awaited<ReturnType<typeof enqueueStage>>,
  error: 'not_found' | 'not_ready' | 'definitions_invalid' | 'unknown_role' | 'no_binding' | 'no_account',
): void => {
  expect(result).toStrictEqual({ ok: false, error });
};

// --- enqueueStage (A-19) ----------------------------------------------------------------------------

describe('enqueueStage', () => {
  it('A-19: enqueues the current stage when the next action is start_run, routed to the first account of the chain', async () => {
    const h = makeHarness();
    await createWorkOrder(h, WO1);
    await h.deps.accounts.save(account(A1));
    await h.deps.accounts.save(account(A2));
    await h.deps.bindings.save({ level: 'global' }, {
      role: IMPLEMENTER,
      accounts: [route(A2, 'model-x'), route(A1)],
    });

    const result = await enqueueStage(h.deps, { id: WO1 });

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(isUlid(result.value)).toBe(true);
    const items = await queueAfter(h);
    expect(items).toHaveLength(1);
    expect(items[0]).toStrictEqual({
      id: result.value,
      workOrderId: WO1,
      repo: REPO,
      stage: IMPLEMENT,
      route: { accountId: A2, model: 'model-x' },
      priority: 0,
      enqueuedAt: 1_000,
    });
  });

  it('A-19: the queue item carries the resolved binding thinking, and none when the binding has none', async () => {
    const h = makeHarness();
    await createWorkOrder(h, WO1);
    await h.deps.accounts.save(account(A1));
    await h.deps.bindings.save({ level: 'global' }, {
      role: IMPLEMENTER,
      accounts: [route(A1)],
      thinking: { effort: 'high' },
    });
    await enqueueStage(h.deps, { id: WO1 });
    expect((await queueAfter(h))[0]?.thinking).toEqual({ effort: 'high' });

    await h.deps.bindings.save({ level: 'global' }, { role: IMPLEMENTER, accounts: [route(A1)] });
    await enqueueStage(h.deps, { id: WO1 });
    expect(await queueAfter(h)).toHaveLength(1);
    expect((await queueAfter(h))[0]).not.toHaveProperty('thinking');
  });

  it('A-19: the given priority lands on the queue item, and the work order history is untouched', async () => {
    const h = makeHarness();
    await createWorkOrder(h, WO1);
    await h.deps.accounts.save(account(A1));
    await h.deps.bindings.save({ level: 'global' }, { role: IMPLEMENTER, accounts: [route(A1)] });

    const result = await enqueueStage(h.deps, { id: WO1, priority: 7 });

    expect(result.ok).toBe(true);
    const items = await queueAfter(h);
    expect(items[0]?.priority).toBe(7);
    expect(await h.deps.workOrders.events(WO1)).toHaveLength(1);
  });

  it('A-19: an existing queue item for the same work order is replaced by exactly one new item', async () => {
    const h = makeHarness();
    await createWorkOrder(h, WO1);
    await h.deps.accounts.save(account(A1));
    await h.deps.bindings.save({ level: 'global' }, { role: IMPLEMENTER, accounts: [route(A1)] });
    await h.deps.queue.put(queueItem(Q1, WO1, route(A1), { priority: -3, enqueuedAt: 500 }));

    const result = await enqueueStage(h.deps, { id: WO1 });

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const items = await queueAfter(h);
    expect(items).toHaveLength(1);
    expect(items[0]?.id).toBe(result.value);
    expect(items[0]?.id).not.toBe(Q1);
    expect(items[0]?.enqueuedAt).toBe(1_000);
  });

  it('A-19: a work order whose next action is not start_run is rejected with not_ready', async () => {
    const h = makeHarness();
    await createWorkOrder(h, WO1, REPO, 'manual'); // first stage has no role → awaiting_human

    const result = await enqueueStage(h.deps, { id: WO1 });

    expectEnqueueErr(result, 'not_ready');
    expect(await queueAfter(h)).toHaveLength(0);
  });

  it('A-19: a running work order is not_ready — the dispatcher waits for the run to finish', async () => {
    const h = makeHarness();
    await createWorkOrder(h, WO1);
    await h.deps.workOrders.appendEvent(WO1, {
      type: 'run_started',
      at: 1_000,
      runId: RUN1,
      stage: IMPLEMENT,
      attempt: 1,
    });

    expectEnqueueErr(await enqueueStage(h.deps, { id: WO1 }), 'not_ready');
  });

  it('A-19: a limit_waiting work order is not_ready until a resume is scheduled for it', async () => {
    const h = makeHarness();
    await createWorkOrder(h, WO1);
    await h.deps.workOrders.appendEvent(WO1, {
      type: 'run_started',
      at: 1_000,
      runId: RUN1,
      stage: IMPLEMENT,
      attempt: 1,
    });
    await h.deps.workOrders.appendEvent(WO1, {
      type: 'run_finished',
      at: 1_100,
      runId: RUN1,
      outcome: 'limit',
    });

    expectEnqueueErr(await enqueueStage(h.deps, { id: WO1 }), 'not_ready');
  });

  it('A-19: a closed work order is not_ready', async () => {
    const h = makeHarness();
    await createWorkOrder(h, WO1);
    await h.deps.workOrders.appendEvent(WO1, { type: 'closed', at: 1_000, by: USER });

    expectEnqueueErr(await enqueueStage(h.deps, { id: WO1 }), 'not_ready');
  });

  it('A-19: a work order whose flow is gone from the definitions is not_ready', async () => {
    // the record names a flow the current definitions no longer carry
    const h = makeHarness();
    h.definitions.seed({ kind: 'global' }, 'definitions.json', JSON.stringify({
      ...DEFINITIONS_BODY,
      flows: [DEFINITIONS_BODY.flows[0]], // only 'standard' remains
      repo: { ...DEFINITIONS_BODY.repo, flows: ['standard'] },
    }));
    const flowId = slugOf<'flow'>('manual');
    await h.deps.workOrders.create({
      id: WO1,
      project: slugOf<'project'>('proj'),
      repo: REPO,
      flow: flowId,
      title: 'fixture',
      createdAt: h.clock.now(),
      createdBy: USER,
    });
    await h.deps.workOrders.appendEvent(WO1, { type: 'created', at: h.clock.now(), by: USER, flow: flowId });

    expectEnqueueErr(await enqueueStage(h.deps, { id: WO1 }), 'not_ready');
    expect(await queueAfter(h)).toHaveLength(0);
  });

  it('A-19: an unknown work order is rejected with not_found', async () => {
    const h = makeHarness();

    expectEnqueueErr(await enqueueStage(h.deps, { id: WO4 }), 'not_found');
  });

  it('A-19: definitions that cannot be loaded are rejected with definitions_invalid', async () => {
    const h = makeHarness();
    h.definitions.seed({ kind: 'global' }, 'a-broken.json', 'not-json{');
    await createWorkOrder(h, WO1);

    expectEnqueueErr(await enqueueStage(h.deps, { id: WO1 }), 'definitions_invalid');
  });

  it('A-19: a routing failure passes through unchanged (no_binding)', async () => {
    const h = makeHarness();
    await createWorkOrder(h, WO1);
    await h.deps.accounts.save(account(A1));

    expectEnqueueErr(await enqueueStage(h.deps, { id: WO1 }), 'no_binding');
  });

  it('A-19: a chain that filters down to no existing account passes no_account through', async () => {
    const h = makeHarness();
    await createWorkOrder(h, WO1);
    await h.deps.bindings.save({ level: 'global' }, { role: IMPLEMENTER, accounts: [route(A3)] });

    expectEnqueueErr(await enqueueStage(h.deps, { id: WO1 }), 'no_account');
  });
});

// --- applyLimitDecision (A-17a) ----------------------------------------------------------------------

describe('applyLimitDecision', () => {
  it('A-17a: schedule_resume queues a resume of the same work order, stage and route at the decision time and spends one auto-resume', async () => {
    const h = makeHarness();
    await createWorkOrder(h, WO1);
    await h.deps.runs.create({
      id: RUN1,
      workOrderId: WO1,
      stage: IMPLEMENT,
      attempt: 1,
      role: IMPLEMENTER,
      route: route(A1, 'model-x'),
      startedAt: 1_000,
      autoResumesUsed: 1,
    });

    const result: Result<{ readonly queued?: QueueItemId }, 'not_found'> = await applyLimitDecision(h.deps, {
      runId: RUN1,
      decision: { kind: 'schedule_resume', at: 9_500, requeryFirst: true },
    });

    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error('decision must apply');
    const { queued } = result.value;
    expect(queued !== undefined && isUlid(queued)).toBe(true);
    const items = await queueAfter(h);
    expect(items).toHaveLength(1);
    expect(items[0]).toStrictEqual({
      id: queued,
      workOrderId: WO1,
      repo: REPO,
      stage: IMPLEMENT,
      route: { accountId: A1, model: 'model-x' },
      priority: 0,
      enqueuedAt: 1_000,
      notBefore: 9_500,
    });
    const run = await h.deps.runs.get(RUN1);
    expect(run?.autoResumesUsed).toBe(2);
    expect(run?.endedAt).toBeUndefined();
    expect(run?.outcome).toBeUndefined();
  });

  it('A-17a: switch_pool queues an item on the same account and leaves the model to be re-chosen at dispatch', async () => {
    const h = makeHarness();
    await createWorkOrder(h, WO1);
    await createRun(h, RUN1, WO1, route(A1, 'model-x'));

    const result = await applyLimitDecision(h.deps, {
      runId: RUN1,
      decision: { kind: 'switch_pool', poolId: POOL1 },
    });

    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error('decision must apply');
    const items = await queueAfter(h);
    expect(items).toHaveLength(1);
    expect(items[0]).toStrictEqual({
      id: result.value.queued,
      workOrderId: WO1,
      repo: REPO,
      stage: IMPLEMENT,
      route: { accountId: A1 },
      priority: 0,
      enqueuedAt: 1_000,
    });
    expect(await h.deps.runs.get(RUN1)).toMatchObject({ autoResumesUsed: 0 });
  });

  it('A-17a: fallback queues an item on the decision route', async () => {
    const h = makeHarness();
    await createWorkOrder(h, WO1);
    await createRun(h, RUN1, WO1, route(A1));

    const result = await applyLimitDecision(h.deps, {
      runId: RUN1,
      decision: { kind: 'fallback', route: route(A2, 'model-y') },
    });

    expect(result.ok).toBe(true);
    const items = await queueAfter(h);
    expect(items).toHaveLength(1);
    expect(items[0]?.route).toStrictEqual({ accountId: A2, model: 'model-y' });
    expect(items[0]?.notBefore).toBeUndefined();
    expect(await h.deps.runs.get(RUN1)).toMatchObject({ autoResumesUsed: 0 });
  });

  it('A-17a: ask queues nothing; the work order stays limit_waiting for the cockpit', async () => {
    const h = makeHarness();
    await createWorkOrder(h, WO1);
    await createRun(h, RUN1, WO1, route(A1));
    await h.deps.workOrders.appendEvent(WO1, {
      type: 'run_finished',
      at: 1_000,
      runId: RUN1,
      outcome: 'limit',
    });

    const result = await applyLimitDecision(h.deps, {
      runId: RUN1,
      decision: { kind: 'ask', reason: 'policy' },
    });

    expect(result).toStrictEqual({ ok: true, value: {} });
    expect(await queueAfter(h)).toHaveLength(0);
    const loaded = await h.deps.definitions.load(REPO);
    if (!loaded.ok) throw new Error('definitions must load');
    const flow = loaded.value.flows.find((candidate) => candidate.id === slugOf<'flow'>('standard'));
    if (flow === undefined) throw new Error('flow must exist');
    const state = deriveWorkOrderState(flow, await h.deps.workOrders.events(WO1));
    expect(state.status).toBe('limit_waiting');
  });

  it('A-17a: an unknown run is rejected with not_found', async () => {
    const h = makeHarness();

    const result = await applyLimitDecision(h.deps, {
      runId: RUN2,
      decision: { kind: 'ask', reason: 'policy' },
    });

    expect(result).toStrictEqual({ ok: false, error: 'not_found' });
  });

  it('A-17a: a run whose work order no longer exists is rejected with not_found', async () => {
    const h = makeHarness();
    await createRun(h, RUN1, WO4, route(A1));

    const result = await applyLimitDecision(h.deps, {
      runId: RUN1,
      decision: { kind: 'schedule_resume', at: 9_500, requeryFirst: true },
    });

    expect(result).toStrictEqual({ ok: false, error: 'not_found' });
  });
});

// --- dispatcherTick (A-20) --------------------------------------------------------------------------

describe('dispatcherTick', () => {
  it('A-20: starts what the rule starts, removes the started items from the queue and hands each item to start', async () => {
    const h = makeHarness();
    await createWorkOrder(h, WO1);
    await createWorkOrder(h, WO2);
    const first = queueItem(Q1, WO1, route(A1), { enqueuedAt: 1_000 });
    const second = queueItem(Q2, WO2, route(A2), { enqueuedAt: 1_100 });
    await h.deps.queue.put(first);
    await h.deps.queue.put(second);
    const recorder = startRecorder();

    const result = await dispatcherTick(h.deps, { limits: LIMITS() }, recorder.callback);

    expect(result.decisions).toStrictEqual([
      { item: Q1, kind: 'start' },
      { item: Q2, kind: 'start' },
    ]);
    expect(result.started).toStrictEqual([Q1, Q2]);
    expect(recorder.items).toStrictEqual([first, second]);
    expect(await queueAfter(h)).toStrictEqual([]);
  });

  it('A-20: three queued work orders in one repo with perRepo 2 — two start, one waits repo_limit', async () => {
    const h = makeHarness();
    await createWorkOrder(h, WO1);
    await createWorkOrder(h, WO2);
    await createWorkOrder(h, WO3);
    await h.deps.queue.put(queueItem(Q1, WO1, route(A1), { enqueuedAt: 1_000 }));
    await h.deps.queue.put(queueItem(Q2, WO2, route(A2), { enqueuedAt: 1_100 }));
    await h.deps.queue.put(queueItem(Q3, WO3, route(A1), { enqueuedAt: 1_200 }));
    const recorder = startRecorder();

    const result = await dispatcherTick(h.deps, { limits: LIMITS({ perRepo: 2 }) }, recorder.callback);

    expect(result.decisions).toStrictEqual([
      { item: Q1, kind: 'start' },
      { item: Q2, kind: 'start' },
      { item: Q3, kind: 'wait', reason: 'repo_limit' },
    ] satisfies readonly DispatchDecision[]);
    expect(result.started).toStrictEqual([Q1, Q2]);
    expect(recorder.items.map((item) => item.id)).toStrictEqual([Q1, Q2]);
    expect(await queueAfter(h)).toHaveLength(1);
    expect((await queueAfter(h))[0]?.id).toBe(Q3);
  });

  it('A-20: an account at hard_stop spend makes its item wait budget', async () => {
    const h = makeHarness();
    await createWorkOrder(h, WO1);
    await createWorkOrder(h, WO2);
    await h.deps.accounts.save(account(A1, [{ scope: 'account_day', cap: { amountUsd: 10, warnPercent: 80 } }]));
    await h.deps.accounts.recordSpend({
      project: slugOf<'project'>('proj'),
      accountId: A1,
      repo: REPO,
      workOrderId: WO1,
      at: h.clock.now(),
      usd: 10,
    });
    await h.deps.queue.put(queueItem(Q1, WO1, route(A1)));
    await h.deps.queue.put(queueItem(Q2, WO2, route(A2)));

    const result = await dispatcherTick(h.deps, { limits: LIMITS() }, startRecorder().callback);

    expect(result.decisions).toStrictEqual([
      { item: Q1, kind: 'wait', reason: 'budget' },
      { item: Q2, kind: 'start' },
    ]);
    expect(result.started).toStrictEqual([Q2]);
    expect((await queueAfter(h)).map((item) => item.id)).toStrictEqual([Q1]);
  });

  it('A-20: a warn-level spend does not hold an item back — only hard_stop is a budget wait', async () => {
    const h = makeHarness();
    await createWorkOrder(h, WO1);
    await h.deps.accounts.save(account(A1, [{ scope: 'account_day', cap: { amountUsd: 10, warnPercent: 80 } }]));
    await h.deps.accounts.recordSpend({
      project: slugOf<'project'>('proj'),
      accountId: A1,
      repo: REPO,
      workOrderId: WO1,
      at: h.clock.now(),
      usd: 8, // exactly the 80 % warn threshold
    });
    await h.deps.queue.put(queueItem(Q1, WO1, route(A1)));

    const result = await dispatcherTick(h.deps, { limits: LIMITS() }, startRecorder().callback);

    expect(result.decisions).toStrictEqual([{ item: Q1, kind: 'start' }]);
    expect(result.started).toStrictEqual([Q1]);
  });

  it('A-20: the day cap window is the UTC day of now, inclusive of its first millisecond', async () => {
    const capped = account(A1, [{ scope: 'account_day', cap: { amountUsd: 10, warnPercent: 80 } }]);

    const atBoundary = makeHarness(MID_MONTH);
    await createWorkOrder(atBoundary, WO1);
    await atBoundary.deps.accounts.save(capped);
    await atBoundary.deps.accounts.recordSpend({
      project: slugOf<'project'>('proj'),
      accountId: A1,
      repo: REPO,
      workOrderId: WO1,
      at: UTC_DAY_START,
      usd: 10,
    });
    await atBoundary.deps.queue.put(queueItem(Q1, WO1, route(A1)));
    const boundary = await dispatcherTick(atBoundary.deps, { limits: LIMITS() }, startRecorder().callback);
    expect(boundary.decisions).toStrictEqual([{ item: Q1, kind: 'wait', reason: 'budget' }]);

    const beforeBoundary = makeHarness(MID_MONTH);
    await createWorkOrder(beforeBoundary, WO1);
    await beforeBoundary.deps.accounts.save(capped);
    await beforeBoundary.deps.accounts.recordSpend({
      project: slugOf<'project'>('proj'),
      accountId: A1,
      repo: REPO,
      workOrderId: WO1,
      at: PREV_DAY_NOON, // inside the month, outside the UTC day
      usd: 10,
    });
    await beforeBoundary.deps.queue.put(queueItem(Q1, WO1, route(A1)));
    const previous = await dispatcherTick(beforeBoundary.deps, { limits: LIMITS() }, startRecorder().callback);
    expect(previous.decisions).toStrictEqual([{ item: Q1, kind: 'start' }]);
  });

  it('A-20: the week cap window is the UTC ISO week of now, from Monday 00:00 UTC; the previous Sunday 23:59 does not count', async () => {
    const capped = account(A1, [{ scope: 'account_week', cap: { amountUsd: 10, warnPercent: 80 } }]);
    // MID_MONTH is Saturday 2026-09-26; its ISO week starts Monday 2026-09-21T00:00:00.000Z.
    const MONDAY_START: EpochMs = 1_789_948_800_000;
    const SUNDAY_LATE: EpochMs = MONDAY_START - 60_000; // 2026-09-20T23:59:00.000Z

    const runWith = async (spentAt: EpochMs) => {
      const h = makeHarness(MID_MONTH);
      await createWorkOrder(h, WO1);
      await h.deps.accounts.save(capped);
      await h.deps.accounts.recordSpend({
        project: slugOf<'project'>('proj'),
        accountId: A1,
        repo: REPO,
        workOrderId: WO1,
        at: spentAt,
        usd: 10,
      });
      await h.deps.queue.put(queueItem(Q1, WO1, route(A1)));
      return dispatcherTick(h.deps, { limits: LIMITS() }, startRecorder().callback);
    };

    expect((await runWith(MONDAY_START)).decisions).toStrictEqual([{ item: Q1, kind: 'wait', reason: 'budget' }]);
    expect((await runWith(SUNDAY_LATE)).decisions).toStrictEqual([{ item: Q1, kind: 'start' }]);
  });

  it('A-20: the month cap window is the UTC calendar month of now, inclusive of its first millisecond', async () => {
    const capped = account(A1, [{ scope: 'account_month', cap: { amountUsd: 10, warnPercent: 80 } }]);

    const atBoundary = makeHarness(MID_MONTH);
    await createWorkOrder(atBoundary, WO1);
    await atBoundary.deps.accounts.save(capped);
    await atBoundary.deps.accounts.recordSpend({
      project: slugOf<'project'>('proj'),
      accountId: A1,
      repo: REPO,
      workOrderId: WO1,
      at: UTC_MONTH_START,
      usd: 10,
    });
    await atBoundary.deps.queue.put(queueItem(Q1, WO1, route(A1)));
    const boundary = await dispatcherTick(atBoundary.deps, { limits: LIMITS() }, startRecorder().callback);
    expect(boundary.decisions).toStrictEqual([{ item: Q1, kind: 'wait', reason: 'budget' }]);

    const beforeBoundary = makeHarness(MID_MONTH);
    await createWorkOrder(beforeBoundary, WO1);
    await beforeBoundary.deps.accounts.save(capped);
    await beforeBoundary.deps.accounts.recordSpend({
      project: slugOf<'project'>('proj'),
      accountId: A1,
      repo: REPO,
      workOrderId: WO1,
      at: PREV_MONTH_END, // the last millisecond of August
      usd: 10,
    });
    await beforeBoundary.deps.queue.put(queueItem(Q1, WO1, route(A1)));
    const previous = await dispatcherTick(beforeBoundary.deps, { limits: LIMITS() }, startRecorder().callback);
    expect(previous.decisions).toStrictEqual([{ item: Q1, kind: 'start' }]);
  });

  it('A-20: exhausted quota headroom holds the item with the earliest relief as until', async () => {
    const h = makeHarness();
    await createWorkOrder(h, WO1);
    await h.deps.accounts.save(account(A1));
    await h.deps.accounts.savePools(A1, [pool(POOL1, A1)]);
    await h.deps.accounts.saveMeter(meter(METER1, POOL1, 1_000)); // remaining 0, resets at 9_000
    await h.deps.queue.put(queueItem(Q1, WO1, route(A1)));

    const result = await dispatcherTick(h.deps, { limits: LIMITS() }, startRecorder().callback);

    expect(result.decisions).toStrictEqual([{ item: Q1, kind: 'wait', reason: 'quota', until: 9_000 }]);
    expect(result.started).toStrictEqual([]);
    expect((await queueAfter(h)).map((item) => item.id)).toStrictEqual([Q1]);
  });

  it('A-20: an item whose account reserve blocks the window is not started and waits for quota', async () => {
    const h = makeHarness();
    await createWorkOrder(h, WO1);
    await h.deps.accounts.save({ ...account(A1), reserve: { long: 0.3 } });
    await h.deps.accounts.savePools(A1, [pool(POOL1, A1)]);
    await h.deps.accounts.saveMeter({ ...meter(METER1, POOL1, 1_000), remaining: 0.25 }); // 25% left, 30% kept back
    await h.deps.queue.put(queueItem(Q1, WO1, route(A1)));

    const started = startRecorder();
    const result = await dispatcherTick(h.deps, { limits: LIMITS() }, started.callback);

    expect(result.decisions).toStrictEqual([{ item: Q1, kind: 'wait', reason: 'quota', until: 9_000 }]);
    expect(result.started).toStrictEqual([]);
    expect((await queueAfter(h)).map((item) => item.id)).toStrictEqual([Q1]);

    // the same meter without a reserve starts
    await h.deps.accounts.save(account(A1));
    const free = await dispatcherTick(h.deps, { limits: LIMITS() }, startRecorder().callback);
    expect(free.decisions).toStrictEqual([{ item: Q1, kind: 'start' }]);
  });

  it('A-20: unknown headroom does not block — the transport learns the truth on start', async () => {
    const h = makeHarness();
    await createWorkOrder(h, WO1);
    await h.deps.accounts.save(account(A1));
    await h.deps.accounts.savePools(A1, [pool(POOL1, A1)]); // a pool but no meters → no data
    await h.deps.queue.put(queueItem(Q1, WO1, route(A1, 'model-x')));

    const result = await dispatcherTick(h.deps, { limits: LIMITS() }, startRecorder().callback);

    expect(result.decisions).toStrictEqual([{ item: Q1, kind: 'start' }]);
    expect(result.started).toStrictEqual([Q1]);
  });

  it('A-20: an item scheduled for later waits until its notBefore', async () => {
    const h = makeHarness();
    await createWorkOrder(h, WO1);
    await h.deps.queue.put(queueItem(Q1, WO1, route(A1), { notBefore: 8_000 }));

    const result = await dispatcherTick(h.deps, { limits: LIMITS() }, startRecorder().callback);

    expect(result.decisions).toStrictEqual([{ item: Q1, kind: 'wait', reason: 'not_before', until: 8_000 }]);
    expect(result.started).toStrictEqual([]);
    expect((await queueAfter(h)).map((item) => item.id)).toStrictEqual([Q1]);
  });

  it('A-20: an item whose work order already runs waits with work_order_busy', async () => {
    const h = makeHarness();
    await createWorkOrder(h, WO1);
    await createRun(h, RUN1, WO1, route(A2)); // active, on another account
    await h.deps.queue.put(queueItem(Q1, WO1, route(A1)));

    const result = await dispatcherTick(h.deps, { limits: LIMITS() }, startRecorder().callback);

    expect(result.decisions).toStrictEqual([{ item: Q1, kind: 'wait', reason: 'work_order_busy' }]);
    expect(result.started).toStrictEqual([]);
  });

  it('A-20: running runs of another repo do not consume this repo limit', async () => {
    const h = makeHarness();
    await createWorkOrder(h, WO1, REPO);
    await createWorkOrder(h, WO4, OTHER);
    await createRun(h, RUN1, WO4, route(A2));
    await h.deps.queue.put(queueItem(Q1, WO1, route(A1)));

    const result = await dispatcherTick(h.deps, { limits: LIMITS({ perRepo: 1 }) }, startRecorder().callback);

    expect(result.decisions).toStrictEqual([{ item: Q1, kind: 'start' }]);
    expect(result.started).toStrictEqual([Q1]);
  });

  it('A-20: the global limit counts the runs of every repo', async () => {
    const h = makeHarness();
    await createWorkOrder(h, WO1, REPO);
    await createWorkOrder(h, WO4, OTHER);
    await createRun(h, RUN1, WO4, route(A2));
    await h.deps.queue.put(queueItem(Q1, WO1, route(A1)));

    const result = await dispatcherTick(h.deps, { limits: LIMITS({ global: 1 }) }, startRecorder().callback);

    expect(result.decisions).toStrictEqual([{ item: Q1, kind: 'wait', reason: 'global_limit' }]);
    expect(result.started).toStrictEqual([]);
  });

  it('A-20: the per-account limit holds the second item on the same account, started or already running', async () => {
    const h = makeHarness();
    await createWorkOrder(h, WO1);
    await createWorkOrder(h, WO2);
    await createWorkOrder(h, WO3);
    await createRun(h, RUN1, WO3, route(A1));
    await h.deps.queue.put(queueItem(Q1, WO1, route(A1), { enqueuedAt: 1_000 }));
    await h.deps.queue.put(queueItem(Q2, WO2, route(A1), { enqueuedAt: 1_100 }));

    const result = await dispatcherTick(h.deps, { limits: LIMITS({ perAccount: { [A1]: 1 } }) }, startRecorder().callback);

    expect(result.decisions).toStrictEqual([
      { item: Q1, kind: 'wait', reason: 'account_limit' },
      { item: Q2, kind: 'wait', reason: 'account_limit' },
    ]);
    expect(result.started).toStrictEqual([]);
    expect((await queueAfter(h)).map((item) => item.id)).toStrictEqual([Q1, Q2]);
  });

  it('A-20: a start within the tick consumes capacity for the items after it', async () => {
    const h = makeHarness();
    await createWorkOrder(h, WO1);
    await createWorkOrder(h, WO2);
    await h.deps.queue.put(queueItem(Q1, WO1, route(A1), { priority: 0, enqueuedAt: 1_000 }));
    await h.deps.queue.put(queueItem(Q2, WO2, route(A2), { priority: 5, enqueuedAt: 2_000 }));

    const result = await dispatcherTick(h.deps, { limits: LIMITS({ perRepo: 1 }) }, startRecorder().callback);

    // higher priority is considered first and takes the only repo slot
    expect(result.decisions).toStrictEqual([
      { item: Q2, kind: 'start' },
      { item: Q1, kind: 'wait', reason: 'repo_limit' },
    ]);
    expect(result.started).toStrictEqual([Q2]);
  });

  it('A-20: an active run whose work order no longer exists cannot be attributed to a repo and counts nowhere', async () => {
    const h = makeHarness();
    await createRun(h, RUN1, WO4, route(A1)); // no work order record behind it
    await createWorkOrder(h, WO1);
    await h.deps.queue.put(queueItem(Q1, WO1, route(A1)));

    const result = await dispatcherTick(h.deps, { limits: LIMITS({ global: 1, perAccount: { [A1]: 1 } }) }, startRecorder().callback);

    expect(result.decisions).toStrictEqual([{ item: Q1, kind: 'start' }]);
  });

  it('R-48: a project ceiling at hard_stop holds every queued item of that project, even a repo with no spend, while another project still starts, and a running run stays', async () => {
    const h = makeHarness();
    const PROJ = slugOf<'project'>('proj');
    const OTHER_PROJ = slugOf<'project'>('other-proj');
    const FOREIGN: RepoSlug = slugOf('foreign');
    await h.deps.projects.save({
      id: PROJ,
      name: 'Proj',
      mainRepo: REPO,
      repos: [REPO, OTHER],
      budget: { amountUsd: 10, warnPercent: 80 },
    });
    await h.deps.projects.save({
      id: OTHER_PROJ,
      name: 'Other',
      mainRepo: FOREIGN,
      repos: [FOREIGN],
      budget: { amountUsd: 10, warnPercent: 80 },
    });
    await createWorkOrder(h, WO1, REPO);
    await createWorkOrder(h, WO2, OTHER);
    await createWorkOrder(h, WO3, FOREIGN);
    await createWorkOrder(h, WO4, OTHER);
    // 6 + 4 spread over the two repos of PROJ; REPO itself spent nothing.
    for (const [at, usd] of [[OTHER, 6], [OTHER, 4]] as const) {
      await h.deps.accounts.recordSpend({
        accountId: A1,
        project: PROJ,
        repo: at,
        workOrderId: WO2,
        at: h.clock.now(),
        usd,
      });
    }
    await createRun(h, RUN1, WO4, route(A1));
    await h.deps.queue.put(queueItem(Q1, WO1, route(A1)));
    await h.deps.queue.put({ ...queueItem(Q2, WO2, route(A1)), repo: OTHER });
    await h.deps.queue.put({ ...queueItem(Q3, WO3, route(A1)), repo: FOREIGN });

    const result = await dispatcherTick(h.deps, { limits: LIMITS() }, startRecorder().callback);

    expect(result.decisions).toStrictEqual([
      { item: Q1, kind: 'wait', reason: 'budget' },
      { item: Q2, kind: 'wait', reason: 'budget' },
      { item: Q3, kind: 'start' },
    ]);
    expect((await h.deps.runs.listActive()).map((run) => run.id)).toStrictEqual([RUN1]);
  });

  it('R-48: a repo limit at hard_stop holds only that repo — its sibling under the same project starts', async () => {
    const h = makeHarness();
    const PROJ = slugOf<'project'>('proj');
    h.definitions.seed(
      { kind: 'global' },
      'definitions.json',
      JSON.stringify({
        ...DEFINITIONS_BODY,
        repo: { ...DEFINITIONS_BODY.repo, budget: { amountUsd: 5, warnPercent: 80 } },
      }),
    );
    await h.deps.projects.save({
      id: PROJ,
      name: 'Proj',
      mainRepo: REPO,
      repos: [REPO, OTHER],
      budget: { amountUsd: 100, warnPercent: 80 },
    });
    await createWorkOrder(h, WO1, REPO);
    await createWorkOrder(h, WO2, OTHER);
    await h.deps.accounts.recordSpend({
      accountId: A1,
      project: PROJ,
      repo: REPO,
      workOrderId: WO1,
      at: h.clock.now(),
      usd: 5,
    });
    await h.deps.queue.put(queueItem(Q1, WO1, route(A1)));
    await h.deps.queue.put({ ...queueItem(Q2, WO2, route(A1)), repo: OTHER });

    const result = await dispatcherTick(h.deps, { limits: LIMITS() }, startRecorder().callback);

    expect(result.decisions).toStrictEqual([
      { item: Q1, kind: 'wait', reason: 'budget' },
      { item: Q2, kind: 'start' },
    ]);
  });

  it('A-20: an empty queue ticks with no decisions and no starts', async () => {
    const h = makeHarness();
    const recorder = startRecorder();

    const result = await dispatcherTick(h.deps, { limits: LIMITS() }, recorder.callback);

    expect(result).toStrictEqual({ decisions: [], started: [] });
    expect(recorder.items).toStrictEqual([]);
  });
});
