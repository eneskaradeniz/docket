// run executor — rules A-15 … A-18 from docs/v2/application.md, driven over the in-memory fakes.
import { describe, expect, it } from 'vitest';

import {
  isUlid,
  parseSlug,
  parseUlid,
  RESUME_JITTER_MS,
  type AccountId,
  type AgentEvent,
  type EpochMs,
  type LimitClass,
  type LimitPolicy,
  type Meter,
  type MeterId,
  type Pool,
  type PoolId,
  type QueueItem,
  type RoleDef,
  type RunId,
  type RunOutcome,
  type Slug,
  type StageSlug,
  type Ulid,
  type WorkOrderId,
  type RepoSlug,
} from '../../domain/index';

import type { AccountRecord, AgentTransport, AuditEntry, RunRecord, RunRequest, TransportError } from '../ports';
import {
  createFakeAccountRepo,
  createFakeClock,
  createFakeDeps,
  createFakeEventLog,
  createFakeIdGen,
  createFakeRunRepo,
  createFakeTransport,
  createFakeTransportResolver,
  createFakeWorkOrderRepo,
  type FakeAccountRepo,
  type FakeClock,
  type FakeEventLog,
  type FakeIdGen,
  type FakeRunRepo,
  type FakeTransport,
  type FakeTransportResolver,
  type FakeWorkOrderRepo,
} from '../ports/fakes';

import { executeRun, type PermissionGate } from './run-executor';

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
const WORK_ORDER: WorkOrderId = ulidOf('01ARZ3NDEKTSV4RRFFQ69G5FAV');
const ACCOUNT: AccountId = ulidOf('01ARZ3NDEKTSV4RRFFQ69G5FAA');
const POOL: PoolId = ulidOf('01ARZ3NDEKTSV4RRFFQ69G5FAB');
const METER: MeterId = ulidOf('01ARZ3NDEKTSV4RRFFQ69G5FAC');
const PRIOR_RUN: RunId = ulidOf('01ARZ3NDEKTSV4RRFFQ69G5FB1');
const STAGE: StageSlug = slugOf<'stage'>('implement');
const OTHER_STAGE: StageSlug = slugOf<'stage'>('review');
const T0: EpochMs = 1_700_000_000_000;

const ROLE: RoleDef = {
  id: slugOf<'role'>('implementer'),
  name: 'Implementer',
  instructions: 'implement the stage',
  writeScope: { kind: 'repo' },
  capabilities: [],
  active: true,
};

const CAPABILITY = {
  kind: 'context',
  id: slugOf<'capability'>('docs'),
  name: 'Docs',
  path: 'docs',
} as const;

const ITEM: QueueItem = {
  id: ulidOf<'queue-item'>('01ARZ3NDEKTSV4RRFFQ69G5FAD'),
  workOrderId: WORK_ORDER,
  repo: REPO,
  stage: STAGE,
  route: { accountId: ACCOUNT },
  priority: 0,
  enqueuedAt: T0,
};

const INPUT = {
  item: ITEM,
  role: ROLE,
  prompt: 'implement the stage',
  cwd: `/wt/${REPO}/${WORK_ORDER}`,
  capabilities: [CAPABILITY],
};

const WORK_ORDER_RECORD = {
  id: WORK_ORDER,
  repo: REPO,
  flow: slugOf<'flow'>('standard'),
  title: 'The work order',
  createdAt: T0,
  createdBy: { kind: 'user', id: 'user-1', label: 'Operator' },
} as const;

const accountRecord = (limitPolicy: LimitPolicy): AccountRecord => ({
  id: ACCOUNT,
  provider: 'provider-x',
  label: 'Main',
  authMode: 'subscription',
  limitPolicy,
  caps: [],
});

const POOLS: readonly Pool[] = [{ id: POOL, accountId: ACCOUNT, label: 'pro', kind: 'allowance', appliesTo: 'all' }];

const seededMeter = (): Meter => ({
  id: METER,
  poolId: POOL,
  label: 'pro',
  cadence: 'fixed',
  durationMs: 3_600_000,
  unit: 'percent',
  used: 10,
  limit: 100,
  remaining: 90,
  resetPrecision: 'exact',
  observedAt: T0 - 5_000,
  source: 'polled',
});

const priorRun = (overrides: Partial<RunRecord>): RunRecord => ({
  id: PRIOR_RUN,
  workOrderId: WORK_ORDER,
  stage: STAGE,
  attempt: 1,
  role: ROLE.id,
  route: { accountId: ACCOUNT },
  startedAt: T0 - 1_000,
  autoResumesUsed: 0,
  ...overrides,
});

const at = (ms: number): EpochMs => T0 + ms;

const sessionStarted = (sessionRef: string): AgentEvent => ({ type: 'session_started', at: at(1), sessionRef });
const text = (delta: string): AgentEvent => ({ type: 'text', at: at(2), delta });
const thinking = (delta: string): AgentEvent => ({ type: 'thinking', at: at(2), delta });
const toolCall = (): AgentEvent => ({ type: 'tool_call', at: at(3), id: 'tool-1', name: 'read', target: 'src/a.ts' });
const toolResult = (ok: boolean): AgentEvent => ({ type: 'tool_result', at: at(3), id: 'tool-1', ok });
const ask = (): AgentEvent => ({
  type: 'permission_ask',
  at: at(3),
  id: 'ask-1',
  tool: 'bash',
  target: '/tmp/x',
  options: ['allow', 'deny'],
});
const usage = (costUsd?: number): AgentEvent => ({
  type: 'usage',
  at: at(4),
  inputTokens: 120,
  outputTokens: 80,
  cachedInputTokens: 20,
  ...(costUsd !== undefined ? { costUsd, costKind: 'reported' as const } : {}),
});
const quotaSignal = (durationMs: number, used = 40): AgentEvent => ({
  type: 'quota_signal',
  at: at(4),
  meter: {
    poolLabel: 'pro',
    cadence: 'rolling_continuous',
    durationMs,
    unit: 'percent',
    used,
    limit: 100,
    remaining: 100 - used,
    resetPrecision: 'clock_only',
    observedAt: at(4),
    source: 'pushed',
  },
});
const limitHit = (hit: { readonly class: LimitClass; readonly resetsAt?: EpochMs; readonly retryAfterMs?: number }): AgentEvent => ({
  type: 'limit_hit',
  at: at(5),
  hit: { remedies: ['wait'], ...hit },
});
const finished = (reason: 'completed' | 'failed' | 'cancelled' | 'limit'): AgentEvent => ({ type: 'finished', at: at(9), reason });

// --- harness ----------------------------------------------------------------------------------------

interface Harness {
  readonly deps: Parameters<typeof executeRun>[0];
  readonly clock: FakeClock;
  readonly ids: FakeIdGen;
  readonly log: FakeEventLog;
  readonly workOrders: FakeWorkOrderRepo;
  readonly runs: FakeRunRepo;
  readonly accounts: FakeAccountRepo;
  readonly transports: FakeTransportResolver;
  readonly transport: FakeTransport;
}

const harness = async (options: {
  readonly script?: readonly AgentEvent[];
  readonly limitPolicy?: LimitPolicy;
  readonly withAccount?: boolean;
  readonly pools?: readonly Pool[];
  readonly meters?: readonly Meter[];
  readonly priorRuns?: readonly RunRecord[];
  readonly withTransport?: boolean;
} = {}): Promise<Harness> => {
  const clock = createFakeClock(T0);
  const ids = createFakeIdGen();
  const log = createFakeEventLog();
  const workOrders = createFakeWorkOrderRepo();
  const runs = createFakeRunRepo();
  const accounts = createFakeAccountRepo();
  const transports = createFakeTransportResolver();
  const transport = createFakeTransport(options.script ?? [finished('completed')]);
  if (options.withTransport !== false) transports.register(ACCOUNT, transport);

  const deps = createFakeDeps({ clock, ids, log, workOrders, runs, accounts, transports });

  await workOrders.create({ ...WORK_ORDER_RECORD });
  if (options.withAccount !== false) await accounts.save(accountRecord(options.limitPolicy ?? 'wait_resume'));
  if (options.pools !== undefined) await accounts.savePools(ACCOUNT, options.pools);
  for (const meter of options.meters ?? []) await accounts.saveMeter(meter);
  for (const run of options.priorRuns ?? []) await runs.create(run);

  return { deps, clock, ids, log, workOrders, runs, accounts, transports, transport };
};

type recordedAsk = { readonly runId: RunId; readonly ask: Extract<AgentEvent, { readonly type: 'permission_ask' }> };

const permissionGate = (
  decision: 'allow' | 'deny' = 'allow',
): { readonly permissions: PermissionGate; readonly asked: readonly recordedAsk[] } => {
  const asked: recordedAsk[] = [];
  return {
    permissions: {
      onAsk: async (runId, ask) => {
        asked.push({ runId, ask });
        return decision;
      },
    },
    asked,
  };
};

/** The run executeRun created: the newest of the work order's runs by startedAt. */
const theRun = async (runs: FakeRunRepo): Promise<RunRecord> => {
  const all = await runs.listForWorkOrder(WORK_ORDER);
  const record = all[all.length - 1];
  if (record === undefined) throw new Error('the executed run must exist');
  return record;
};

const theRequest = (transport: FakeTransport) => {
  const request = transport.requests()[0];
  if (request === undefined) throw new Error('the transport must have been started once');
  return request;
};

const auditShape = (entries: readonly AuditEntry[]) =>
  entries.map((entry) => ({ action: entry.action, subject: entry.subject, actor: entry.actor, detail: entry.detail }));

/** A transport whose first `failures` starts fail with `error`, then delegate to `inner`; every
 *  request is recorded, failed ones included. Models a resume the transport cannot perform. */
const flakyStart = (
  inner: FakeTransport,
  failures: number,
  error: TransportError,
): { readonly transport: AgentTransport; readonly requests: () => readonly RunRequest[] } => {
  const seen: RunRequest[] = [];
  let remaining = failures;
  return {
    transport: {
      start: async (request) => {
        seen.push(request);
        if (remaining > 0) {
          remaining -= 1;
          return { ok: false, error };
        }
        return inner.start(request);
      },
    },
    requests: () => [...seen],
  };
};

const actionsOf = (log: FakeEventLog): readonly string[] => log.entries().map((entry) => entry.action);

// --- tests ------------------------------------------------------------------------------------------

describe('executeRun', () => {
  it('A-15: a first run of the stage is recorded at attempt 1 with autoResumesUsed 0 and reaches the transport as requested', async () => {
    const h = await harness({ script: [sessionStarted('sess-1'), finished('completed')] });

    const outcome = await executeRun(h.deps, permissionGate().permissions, INPUT);

    expect(outcome).toEqual({ kind: 'finished', outcome: 'succeeded' });
    const record = await theRun(h.runs);
    expect(record).toMatchObject({
      id: record.id,
      workOrderId: WORK_ORDER,
      stage: STAGE,
      attempt: 1,
      role: ROLE.id,
      route: { accountId: ACCOUNT },
      startedAt: T0,
      autoResumesUsed: 0,
      endedAt: T0,
      outcome: 'succeeded',
      sessionRef: 'sess-1',
    });
    expect(isUlid(record.id)).toBe(true);
    expect(await h.workOrders.events(WORK_ORDER)).toEqual([
      { type: 'run_started', at: T0, runId: record.id, stage: STAGE, attempt: 1 },
      { type: 'run_finished', at: T0, runId: record.id, outcome: 'succeeded' },
    ]);
    expect(auditShape(h.log.entries())).toEqual([
      {
        action: 'run.started',
        subject: { kind: 'run', id: record.id },
        actor: { kind: 'system', component: 'run-executor' },
        detail: undefined,
      },
      {
        action: 'run.finished',
        subject: { kind: 'run', id: record.id },
        actor: { kind: 'system', component: 'run-executor' },
        detail: { outcome: 'succeeded' },
      },
    ]);
    expect(h.transport.requests()).toEqual([
      {
        runId: record.id,
        cwd: INPUT.cwd,
        role: ROLE,
        route: { accountId: ACCOUNT },
        prompt: INPUT.prompt,
        capabilities: [CAPABILITY],
      },
    ]);
  });

  it('A-15: the run record, run_started event and run.started audit are written before the transport starts', async () => {
    const h = await harness({ script: [finished('completed')] });
    const seen: {
      readonly runExists: boolean;
      readonly startedEvents: number;
      readonly startedAudits: number;
    }[] = [];
    const inner = h.transport;
    const recording: AgentTransport = {
      start: async (request) => {
        seen.push({
          runExists: (await h.runs.get(request.runId)) !== undefined,
          startedEvents: (await h.workOrders.events(WORK_ORDER)).filter((event) => event.type === 'run_started').length,
          startedAudits: h.log.entries().filter((entry) => entry.action === 'run.started').length,
        });
        return inner.start(request);
      },
    };
    h.transports.register(ACCOUNT, recording); // the last registration wins

    await executeRun(h.deps, permissionGate().permissions, INPUT);

    expect(seen).toEqual([{ runExists: true, startedEvents: 1, startedAudits: 1 }]);
  });

  it('A-15: a missing transport fails the run and returns transport_error', async () => {
    const h = await harness({ withTransport: false });

    const outcome = await executeRun(h.deps, permissionGate().permissions, INPUT);

    expect(outcome).toEqual({
      kind: 'transport_error',
      error: { code: 'not_installed', message: `no transport for account ${ACCOUNT}` },
    });
    const record = await theRun(h.runs);
    expect(record.endedAt).toBe(T0);
    expect(record.outcome).toBe('failed');
    expect(await h.runs.listActive()).toEqual([]);
    expect(await h.workOrders.events(WORK_ORDER)).toEqual([
      { type: 'run_started', at: T0, runId: record.id, stage: STAGE, attempt: 1 },
      { type: 'run_finished', at: T0, runId: record.id, outcome: 'failed' },
    ]);
    expect(h.transport.requests()).toEqual([]);
  });

  it('A-15: a transport start error fails the run and returns the error as transport_error', async () => {
    const error = { code: 'not_logged_in' as const, message: 'login required' };
    const h = await harness({ script: [finished('completed')] });
    h.transport.failStart(error);

    const outcome = await executeRun(h.deps, permissionGate().permissions, INPUT);

    expect(outcome).toEqual({ kind: 'transport_error', error });
    const record = await theRun(h.runs);
    expect(record.outcome).toBe('failed');
    expect(record.endedAt).toBe(T0);
    expect(await h.workOrders.events(WORK_ORDER)).toEqual([
      { type: 'run_started', at: T0, runId: record.id, stage: STAGE, attempt: 1 },
      { type: 'run_finished', at: T0, runId: record.id, outcome: 'failed' },
    ]);
  });

  it('A-15: resuming carries the attempt, autoResumesUsed and session of the previous run of the same stage+attempt', async () => {
    const h = await harness({
      script: [finished('completed')],
      priorRuns: [priorRun({ outcome: 'limit', autoResumesUsed: 2, sessionRef: 'sess-0' })],
    });

    await executeRun(h.deps, permissionGate().permissions, INPUT);

    const record = await theRun(h.runs);
    expect(record.attempt).toBe(1);
    expect(record.autoResumesUsed).toBe(2);
    expect(theRequest(h.transport).resume).toEqual({ sessionRef: 'sess-0' });
  });

  it('A-15: a previous run of the same stage that succeeded starts the next attempt from zero', async () => {
    const h = await harness({
      script: [finished('completed')],
      priorRuns: [priorRun({ outcome: 'succeeded', autoResumesUsed: 2, sessionRef: 'sess-0' })],
    });

    await executeRun(h.deps, permissionGate().permissions, INPUT);

    const record = await theRun(h.runs);
    expect(record.attempt).toBe(2);
    expect(record.autoResumesUsed).toBe(0);
    expect(theRequest(h.transport).resume).toBeUndefined();
  });

  it('A-15: a previous run of another stage does not continue this stage attempt', async () => {
    const h = await harness({
      script: [finished('completed')],
      priorRuns: [priorRun({ stage: OTHER_STAGE, attempt: 3, outcome: 'limit', autoResumesUsed: 1 })],
    });

    await executeRun(h.deps, permissionGate().permissions, INPUT);

    const record = await theRun(h.runs);
    expect(record.attempt).toBe(1);
    expect(record.autoResumesUsed).toBe(0);
  });

  it('A-15: a cancelled previous run keeps its attempt (the flow returns to ready on the same attempt)', async () => {
    const h = await harness({
      script: [finished('completed')],
      priorRuns: [priorRun({ attempt: 2, outcome: 'cancelled', autoResumesUsed: 1, sessionRef: 'sess-0' })],
    });

    await executeRun(h.deps, permissionGate().permissions, INPUT);

    const record = await theRun(h.runs);
    expect(record.attempt).toBe(2);
    expect(record.autoResumesUsed).toBe(1);
  });

  it('A-16: every streamed event is persisted in arrival order', async () => {
    const script = [
      sessionStarted('sess-1'),
      text('hello'),
      thinking('pondering'),
      toolCall(),
      toolResult(true),
      { type: 'raw' as const, at: at(4), line: '{"unparsed":true}' },
      usage(),
      finished('completed'),
    ];
    const h = await harness({ script });

    const outcome = await executeRun(h.deps, permissionGate().permissions, INPUT);

    expect(outcome).toEqual({ kind: 'finished', outcome: 'succeeded' });
    const record = await theRun(h.runs);
    expect(await h.runs.events(record.id)).toEqual(script);
  });

  it('A-16: a full scripted run (ask, usage, quota) persists everything and finishes clean', async () => {
    const script = [sessionStarted('sess-1'), text('working'), ask(), usage(0.75), quotaSignal(3_600_000), finished('completed')];
    const h = await harness({ script, pools: POOLS });
    const gateResult = permissionGate('allow');

    const outcome = await executeRun(h.deps, gateResult.permissions, INPUT);

    expect(outcome).toEqual({ kind: 'finished', outcome: 'succeeded' });
    const record = await theRun(h.runs);
    expect(await h.runs.events(record.id)).toEqual(script);
    expect(record.sessionRef).toBe('sess-1');
    expect(record.outcome).toBe('succeeded');
    expect(gateResult.asked.length).toBe(1);
    expect(h.transport.answers()).toEqual([{ askId: 'ask-1', decision: 'allow' }]);
    expect((await h.accounts.meters(ACCOUNT)).length).toBe(1);
    expect(await h.accounts.spend({ accountId: ACCOUNT, repo: REPO, workOrderId: WORK_ORDER, from: 0, to: T0 + 10_000 })).toBe(0.75);
    expect(await h.workOrders.events(WORK_ORDER)).toEqual([
      { type: 'run_started', at: T0, runId: record.id, stage: STAGE, attempt: 1 },
      { type: 'run_finished', at: T0, runId: record.id, outcome: 'succeeded' },
    ]);
    expect(actionsOf(h.log)).toEqual(['run.started', 'permission.answered', 'run.finished']);
  });

  it('A-16: session_started sets sessionRef on the run record', async () => {
    const h = await harness({ script: [sessionStarted('sess-42'), finished('completed')] });

    await executeRun(h.deps, permissionGate().permissions, INPUT);

    expect((await theRun(h.runs)).sessionRef).toBe('sess-42');
  });

  it('A-16: permission_ask is asked through the gate and the answer is delivered to the transport', async () => {
    const h = await harness({ script: [ask(), finished('completed')] });
    const gateResult = permissionGate('deny');

    const outcome = await executeRun(h.deps, gateResult.permissions, INPUT);

    // The scripted stream rests on the ask; a finished outcome proves the answer released it.
    expect(outcome).toEqual({ kind: 'finished', outcome: 'succeeded' });
    const record = await theRun(h.runs);
    expect(gateResult.asked.length).toBe(1);
    const first = gateResult.asked[0];
    if (first === undefined) throw new Error('the gate must have been asked once');
    expect(first.runId).toBe(record.id);
    expect(first.ask).toEqual(ask());
    expect(h.transport.answers()).toEqual([{ askId: 'ask-1', decision: 'deny' }]);
    expect(actionsOf(h.log)).toEqual(['run.started', 'permission.answered', 'run.finished']);
    const answered = h.log.entries()[1];
    if (answered === undefined) throw new Error('the answer must be audited');
    expect(answered.subject).toEqual({ kind: 'run', id: record.id });
    expect(answered.detail).toEqual({ tool: 'bash', decision: 'deny' });
  });

  it('A-16: quota_signal saves a meter with a new MeterId when no meter of that pool label and duration exists', async () => {
    const h = await harness({ script: [quotaSignal(3_600_000), finished('completed')], pools: POOLS });

    await executeRun(h.deps, permissionGate().permissions, INPUT);

    const meters = await h.accounts.meters(ACCOUNT);
    expect(meters.length).toBe(1);
    const meter = meters[0];
    if (meter === undefined) throw new Error('the meter must exist');
    expect(meter.id).not.toBe(METER);
    expect(isUlid(meter.id)).toBe(true);
    expect(meter).toMatchObject({
      poolId: POOL,
      label: 'pro',
      cadence: 'rolling_continuous',
      durationMs: 3_600_000,
      unit: 'percent',
      used: 40,
      limit: 100,
      remaining: 60,
      resetPrecision: 'clock_only',
      observedAt: at(4),
      source: 'pushed',
    });
  });

  it('A-16: quota_signal reuses the id of the existing meter with the same pool label and duration', async () => {
    const h = await harness({
      script: [quotaSignal(3_600_000, 55), finished('completed')],
      pools: POOLS,
      meters: [seededMeter()],
    });

    await executeRun(h.deps, permissionGate().permissions, INPUT);

    const meters = await h.accounts.meters(ACCOUNT);
    expect(meters.length).toBe(1);
    const meter = meters[0];
    if (meter === undefined) throw new Error('the meter must exist');
    expect(meter.id).toBe(METER);
    expect(meter.used).toBe(55);
    expect(meter.source).toBe('pushed');
    expect(meter.observedAt).toBe(at(4));
  });

  it('A-16: a quota_signal of another duration saves a second meter instead of overwriting', async () => {
    const h = await harness({
      script: [quotaSignal(7_200_000), finished('completed')],
      pools: POOLS,
      meters: [seededMeter()],
    });

    await executeRun(h.deps, permissionGate().permissions, INPUT);

    const meters = await h.accounts.meters(ACCOUNT);
    expect(meters.length).toBe(2);
    expect(new Set(meters.map((meter) => meter.id)).size).toBe(2);
    expect(meters.map((meter) => meter.durationMs).sort()).toEqual([3_600_000, 7_200_000]);
  });

  it('A-16: a quota_signal for a pool the account does not know is still saved', async () => {
    const h = await harness({ script: [quotaSignal(3_600_000), finished('completed')] });

    await executeRun(h.deps, permissionGate().permissions, INPUT);

    const meters = await h.accounts.meters();
    expect(meters.length).toBe(1);
    const meter = meters[0];
    if (meter === undefined) throw new Error('the meter must exist');
    expect(isUlid(meter.poolId)).toBe(true);
  });

  it('A-16: usage with a cost records spend for the run account, repo and work order', async () => {
    const h = await harness({ script: [usage(0.25), usage(1.5), usage(), finished('completed')] });

    await executeRun(h.deps, permissionGate().permissions, INPUT);

    const window = { from: 0, to: T0 + 10_000 };
    expect(await h.accounts.spend({ accountId: ACCOUNT, repo: REPO, workOrderId: WORK_ORDER, ...window })).toBe(1.75);
    expect(await h.accounts.spend({ repo: slugOf<'repo'>('elsewhere'), ...window })).toBe(0);
  });

  it('A-16: a usage event without a cost records no spend', async () => {
    const h = await harness({ script: [usage(), finished('completed')] });

    await executeRun(h.deps, permissionGate().permissions, INPUT);

    expect(await h.accounts.spend({ from: 0, to: T0 + 10_000 })).toBe(0);
  });

  it('A-16: the executor never mutates its input', async () => {
    const h = await harness({ script: [sessionStarted('sess-1'), finished('completed')] });
    const item = { ...ITEM, route: { ...ITEM.route } };
    const role = { ...ROLE, capabilities: [...ROLE.capabilities] };

    await executeRun(h.deps, permissionGate().permissions, { ...INPUT, item, role });

    expect(item).toEqual(ITEM);
    expect(role).toEqual(ROLE);
  });

  it('A-17: a limit_hit ends the run with outcome limit, appends run_finished: limit and returns the domain decision', async () => {
    const h = await harness({
      script: [sessionStarted('sess-1'), text('working'), limitHit({ class: 'window_exhausted', resetsAt: at(60_000) }), finished('limit')],
    });
    h.clock.advance(5);

    const outcome = await executeRun(h.deps, permissionGate().permissions, INPUT);

    expect(outcome).toEqual({
      kind: 'limit',
      decision: { kind: 'schedule_resume', at: at(60_000) + RESUME_JITTER_MS, requeryFirst: true },
    });
    const record = await theRun(h.runs);
    expect(record.outcome).toBe('limit');
    expect(record.endedAt).toBe(T0 + 5);
    expect(record.sessionRef).toBe('sess-1');
    expect(await h.workOrders.events(WORK_ORDER)).toEqual([
      { type: 'run_started', at: T0 + 5, runId: record.id, stage: STAGE, attempt: 1 },
      { type: 'run_finished', at: T0 + 5, runId: record.id, outcome: 'limit' },
    ]);
    // The run is over at the hit: the scripted finished event beyond it never lands.
    expect(await h.runs.events(record.id)).toEqual([sessionStarted('sess-1'), text('working'), limitHit({ class: 'window_exhausted', resetsAt: at(60_000) })]);
    expect(actionsOf(h.log)).toEqual(['run.started']);
  });

  it('A-17: the decision is asked with the account policy and the carried autoResumesUsed', async () => {
    const h = await harness({
      script: [limitHit({ class: 'window_exhausted' })],
      priorRuns: [priorRun({ outcome: 'limit', autoResumesUsed: 3 })],
    });

    const outcome = await executeRun(h.deps, permissionGate().permissions, INPUT);

    expect((await theRun(h.runs)).autoResumesUsed).toBe(3);
    expect(outcome).toEqual({ kind: 'limit', decision: { kind: 'ask', reason: 'max_resumes' } });
  });

  it('A-17: an account whose policy is ask returns the ask decision', async () => {
    const h = await harness({
      limitPolicy: 'ask',
      script: [limitHit({ class: 'window_exhausted', resetsAt: at(60_000) })],
    });

    const outcome = await executeRun(h.deps, permissionGate().permissions, INPUT);

    expect(outcome).toEqual({ kind: 'limit', decision: { kind: 'ask', reason: 'policy' } });
    expect((await theRun(h.runs)).outcome).toBe('limit');
  });

  it('A-17: a hit on an account with no record has no policy to follow and asks', async () => {
    const h = await harness({ withAccount: false, script: [limitHit({ class: 'window_exhausted', resetsAt: at(60_000) })] });

    const outcome = await executeRun(h.deps, permissionGate().permissions, INPUT);

    expect(outcome).toEqual({ kind: 'limit', decision: { kind: 'ask', reason: 'policy' } });
  });

  it('A-18: finished maps its reason to the outcome exactly as foldRun does', async () => {
    const cases: readonly (readonly [Extract<AgentEvent, { readonly type: 'finished' }>['reason'], RunOutcome])[] = [
      ['completed', 'succeeded'],
      ['failed', 'failed'],
      ['cancelled', 'cancelled'],
    ];
    for (const [reason, expected] of cases) {
      const h = await harness({ script: [finished(reason)] });

      const outcome = await executeRun(h.deps, permissionGate().permissions, INPUT);

      expect(outcome).toEqual({ kind: 'finished', outcome: expected });
      const record = await theRun(h.runs);
      expect(record.outcome).toBe(expected);
      expect(record.endedAt).toBe(T0);
      expect(await h.workOrders.events(WORK_ORDER)).toEqual([
        { type: 'run_started', at: T0, runId: record.id, stage: STAGE, attempt: 1 },
        { type: 'run_finished', at: T0, runId: record.id, outcome: expected },
      ]);
    }
  });

  it('A-18: the run.finished audit carries detail { outcome } on the run subject', async () => {
    const h = await harness({ script: [finished('completed')] });

    await executeRun(h.deps, permissionGate().permissions, INPUT);

    const record = await theRun(h.runs);
    expect(auditShape(h.log.entries())).toEqual([
      {
        action: 'run.started',
        subject: { kind: 'run', id: record.id },
        actor: { kind: 'system', component: 'run-executor' },
        detail: undefined,
      },
      {
        action: 'run.finished',
        subject: { kind: 'run', id: record.id },
        actor: { kind: 'system', component: 'run-executor' },
        detail: { outcome: 'succeeded' },
      },
    ]);
  });

  it('A-18: a stream that ends without finished or limit_hit closes the run as failed', async () => {
    const h = await harness({ script: [sessionStarted('sess-1')] });

    const outcome = await executeRun(h.deps, permissionGate().permissions, INPUT);

    expect(outcome).toEqual({ kind: 'finished', outcome: 'failed' });
    const record = await theRun(h.runs);
    expect(record.outcome).toBe('failed');
    expect(record.endedAt).toBe(T0);
    expect(await h.workOrders.events(WORK_ORDER)).toEqual([
      { type: 'run_started', at: T0, runId: record.id, stage: STAGE, attempt: 1 },
      { type: 'run_finished', at: T0, runId: record.id, outcome: 'failed' },
    ]);
  });

  it('P-22: a resume the transport accepts runs the resumed session unchanged (no fallback)', async () => {
    const h = await harness({
      script: [sessionStarted('sess-1'), finished('completed')],
      priorRuns: [priorRun({ outcome: 'limit', sessionRef: 'sess-0' })],
    });
    await h.runs.appendEvents(PRIOR_RUN, [text('earlier answer'), finished('limit')]);

    const outcome = await executeRun(h.deps, permissionGate().permissions, INPUT);

    expect(outcome).toEqual({ kind: 'finished', outcome: 'succeeded' });
    expect(h.transport.requests()).toHaveLength(1);
    const request = theRequest(h.transport);
    expect(request.resume).toEqual({ sessionRef: 'sess-0' });
    expect(request.prompt).toBe(INPUT.prompt);
    expect((await theRun(h.runs)).sessionRef).toBe('sess-1');
  });

  it('P-22: a start error under a resume reference restarts once without resume, the prompt prefixed with a summary of the stored events', async () => {
    const h = await harness({
      script: [sessionStarted('sess-9'), finished('completed')],
      priorRuns: [priorRun({ outcome: 'limit', sessionRef: 'sess-0' })],
    });
    await h.runs.appendEvents(PRIOR_RUN, [
      sessionStarted('sess-0'),
      text('the earlier answer'),
      thinking('pondering'),
      toolCall(),
      toolResult(false),
      finished('limit'),
    ]);
    const error: TransportError = { code: 'spawn_failed', message: 'the session is gone' };
    const flaky = flakyStart(h.transport, 1, error);
    h.transports.register(ACCOUNT, flaky.transport); // the last registration wins

    const outcome = await executeRun(h.deps, permissionGate().permissions, INPUT);

    expect(outcome).toEqual({ kind: 'finished', outcome: 'succeeded' });
    const requests = flaky.requests();
    if (requests.length !== 2) throw new Error('the transport must have been started exactly twice');
    const [resumed, restarted] = requests;
    expect(resumed.resume).toEqual({ sessionRef: 'sess-0' });
    expect(resumed.prompt).toBe(INPUT.prompt);
    expect(restarted.resume).toBeUndefined();
    expect(restarted.prompt.startsWith('The previous session could not be resumed')).toBe(true);
    expect(restarted.prompt).toContain('[text] the earlier answer');
    expect(restarted.prompt).toContain('[thinking] pondering');
    expect(restarted.prompt).toContain('[tool] read src/a.ts');
    expect(restarted.prompt).toContain('[tool result] failed');
    // Bookkeeping events carry no conversation; the resumed session id never reaches the prompt.
    expect(restarted.prompt).not.toContain('sess-0');
    expect(restarted.prompt.endsWith(`--- end of previous transcript ---\n\n${INPUT.prompt}`)).toBe(true);
    // The restart reuses the same run: one record, one started/finished pair.
    expect(await h.runs.listForWorkOrder(WORK_ORDER)).toHaveLength(2);
    const record = await theRun(h.runs);
    expect(record.attempt).toBe(1);
    expect(record.sessionRef).toBe('sess-9');
    expect(await h.workOrders.events(WORK_ORDER)).toEqual([
      { type: 'run_started', at: T0, runId: record.id, stage: STAGE, attempt: 1 },
      { type: 'run_finished', at: T0, runId: record.id, outcome: 'succeeded' },
    ]);
  });

  it('P-22: the transcript summary is bounded per entry and in total', async () => {
    const h = await harness({
      script: [finished('completed')],
      priorRuns: [priorRun({ outcome: 'limit', sessionRef: 'sess-0' })],
    });
    // Six oversized turns: five fill the summary budget, the sixth must never appear.
    await h.runs.appendEvents(PRIOR_RUN, [
      text('A'.repeat(5_000)),
      text('A'.repeat(5_000)),
      text('A'.repeat(5_000)),
      text('A'.repeat(5_000)),
      text('A'.repeat(5_000)),
      text('B'.repeat(5_000)),
    ]);
    const flaky = flakyStart(h.transport, 1, { code: 'spawn_failed', message: 'resume failed' });
    h.transports.register(ACCOUNT, flaky.transport);

    await executeRun(h.deps, permissionGate().permissions, INPUT);

    const requests = flaky.requests();
    const restarted = requests[1];
    if (restarted === undefined) throw new Error('the restart must have been started');
    const lines = restarted.prompt.split('\n');
    const marker = lines.indexOf('--- end of previous transcript ---');
    if (marker < 0) throw new Error('the summary must end at its marker');
    const summary = lines.slice(2, marker - 1); // header, blank … blank, marker
    expect(summary.length).toBe(5);
    for (const line of summary) expect(line.length).toBeLessThanOrEqual(400);
    expect(summary.reduce((total, line) => total + line.length, 0)).toBe(2000);
    // '[text] ' (7) + 392 kept characters + the ellipsis = the 400-character entry bound.
    expect(restarted.prompt).toContain(`[text] ${'A'.repeat(392)}…`);
    expect(restarted.prompt).not.toContain('A'.repeat(393));
    expect(restarted.prompt).not.toContain('B');
    // The original prompt stays intact after the bounded summary.
    expect(restarted.prompt.endsWith(INPUT.prompt)).toBe(true);
  });

  it('P-22: a prior run with no stored events restarts with the bare summary frame around the prompt', async () => {
    const h = await harness({
      script: [finished('completed')],
      priorRuns: [priorRun({ outcome: 'limit', sessionRef: 'sess-0' })],
    });
    const flaky = flakyStart(h.transport, 1, { code: 'spawn_failed', message: 'resume failed' });
    h.transports.register(ACCOUNT, flaky.transport);

    const outcome = await executeRun(h.deps, permissionGate().permissions, INPUT);

    expect(outcome).toEqual({ kind: 'finished', outcome: 'succeeded' });
    const restarted = flaky.requests()[1];
    if (restarted === undefined) throw new Error('the restart must have been started');
    expect(restarted.prompt.startsWith('The previous session could not be resumed')).toBe(true);
    expect(restarted.prompt).not.toContain('[text]');
    expect(restarted.prompt).not.toContain('[tool]');
    expect(restarted.prompt.endsWith(`--- end of previous transcript ---\n\n${INPUT.prompt}`)).toBe(true);
  });

  it('P-22: a restart without resume that also fails fails the run — exactly two starts, no loop', async () => {
    const h = await harness({
      script: [finished('completed')],
      // The prior run ended when it hit its limit; only the executed run is ever active.
      priorRuns: [priorRun({ outcome: 'limit', sessionRef: 'sess-0', endedAt: T0 - 500 })],
    });
    await h.runs.appendEvents(PRIOR_RUN, [text('earlier answer')]);
    const error: TransportError = { code: 'spawn_failed', message: 'broken transport' };
    const flaky = flakyStart(h.transport, 2, error);
    h.transports.register(ACCOUNT, flaky.transport);

    const outcome = await executeRun(h.deps, permissionGate().permissions, INPUT);

    expect(outcome).toEqual({ kind: 'transport_error', error });
    const requests = flaky.requests();
    if (requests.length !== 2) throw new Error('the executor must stop after the single restart');
    expect(requests[0]?.resume).toEqual({ sessionRef: 'sess-0' });
    expect(requests[1]?.resume).toBeUndefined();
    expect(requests[1]?.prompt).toContain('[text] earlier answer');
    const record = await theRun(h.runs);
    expect(record.outcome).toBe('failed');
    expect(await h.runs.listActive()).toEqual([]);
    expect(await h.workOrders.events(WORK_ORDER)).toEqual([
      { type: 'run_started', at: T0, runId: record.id, stage: STAGE, attempt: 1 },
      { type: 'run_finished', at: T0, runId: record.id, outcome: 'failed' },
    ]);
  });

  it('P-22: a start error without a resume reference fails immediately — never restarted', async () => {
    const h = await harness({ script: [finished('completed')] });
    h.transport.failStart({ code: 'spawn_failed', message: 'broken transport' });

    const outcome = await executeRun(h.deps, permissionGate().permissions, INPUT);

    expect(outcome).toEqual({ kind: 'transport_error', error: { code: 'spawn_failed', message: 'broken transport' } });
    expect(h.transport.requests()).toHaveLength(1);
    expect((await theRun(h.runs)).outcome).toBe('failed');
  });

  it('U-12: every appended run event notifies the injected hook with the run id', async () => {
    const h = await harness({ script: [sessionStarted('sess-1'), text('working'), ask(), finished('completed')] });
    const notified: RunId[] = [];

    const outcome = await executeRun(h.deps, permissionGate().permissions, INPUT, undefined, (runId) => notified.push(runId));

    expect(outcome).toEqual({ kind: 'finished', outcome: 'succeeded' });
    const record = await theRun(h.runs);
    // Exactly one notification per appended event, the run's own id each time: the executor's
    // run_started / run_finished appends to the work order log never reach this hook.
    expect(notified).toEqual([record.id, record.id, record.id, record.id]);
  });

  it('the run-finished path also notifies the workOrders.changed hook, after the append is visible', async () => {
    const h = await harness({ script: [sessionStarted('sess-1'), finished('completed')] });
    const calls: string[] = [];
    const logAtChange: Promise<readonly string[]>[] = [];

    const outcome = await executeRun(
      h.deps,
      permissionGate().permissions,
      INPUT,
      undefined,
      (runId) => calls.push(`run ${runId}`),
      () => {
        calls.push('workOrders');
        // A store re-queries the moment the change arrives, so the read that starts at delivery
        // time must already see the run_finished append.
        logAtChange.push(h.workOrders.events(WORK_ORDER).then((events) => events.map((event) => event.type)));
      },
    );

    expect(outcome).toEqual({ kind: 'finished', outcome: 'succeeded' });
    const record = await theRun(h.runs);
    // The per-event notifications keep their order and the work-order change lands exactly once,
    // after the last of them; the run_started append stays silent on this channel.
    expect(calls).toEqual([`run ${record.id}`, `run ${record.id}`, 'workOrders']);
    const first = logAtChange[0];
    if (first === undefined) throw new Error('workOrders.changed must have been delivered');
    expect(await first).toEqual(['run_started', 'run_finished']);
  });

  it('a run that fails before any transport still notifies workOrders.changed — every run_finished append does', async () => {
    const h = await harness({ withTransport: false });
    let changed = 0;

    const outcome = await executeRun(h.deps, permissionGate().permissions, INPUT, undefined, undefined, () => {
      changed += 1;
    });

    expect(outcome.kind).toBe('transport_error');
    expect(changed).toBe(1);
    expect((await h.workOrders.events(WORK_ORDER)).map((event) => event.type)).toEqual(['run_started', 'run_finished']);
  });
});
