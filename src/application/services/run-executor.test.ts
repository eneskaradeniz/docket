// run executor — rules A-15 … A-18 from docs/v2/application.md, driven over the in-memory fakes.
import { describe, expect, it } from 'vitest';

import {
  CHECKPOINT_MIN_INTERVAL_MS,
  decideOnLimit,
  definitionsDigest,
  isUlid,
  parseSlug,
  parseUlid,
  RESUME_JITTER_MS,
  ROLLING_NOTE_MAX_CHARS,
  stageBrief,
  type AccountId,
  type AgentEvent,
  type Billing,
  type CatalogModel,
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

import type { AccountRecord, AgentTransport, AuditEntry, CheckpointDiff, RunRecord, RunRequest, TransportError } from '../ports';
import {
  createFakeAccountRepo,
  createFakeCapabilityCatalog,
  createFakeCheckpointCommitter,
  createFakeClock,
  createFakeDefinitionStore,
  createFakeDeps,
  createFakeEventLog,
  createFakeIdGen,
  createFakeInstructionFiles,
  createFakeModelCatalog,
  createFakeRunDirs,
  createFakeRunRepo,
  createFakeRunTokens,
  createFakeTransport,
  createFakeTransportResolver,
  createFakeWorkOrderRepo,
  type FakeAccountRepo,
  type FakeCheckpointCommitter,
  type FakeClock,
  type FakeDefinitionStore,
  type FakeEventLog,
  type FakeIdGen,
  type FakeRouteKind,
  type FakeRunRepo,
  type FakeTransport,
  type FakeTransportResolver,
  type FakeWorkOrderRepo,
} from '../ports/fakes';

import { grantSpendConsent, revokeSpendConsent } from '../use-cases';
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
  project: slugOf<'project'>('proj'),
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
const emptyUsage = (): AgentEvent => ({ type: 'usage', at: at(4), inputTokens: 0, outputTokens: 0 });
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
  readonly checkpoints: FakeCheckpointCommitter;
  readonly definitions: FakeDefinitionStore;
}

const harness = async (options: {
  readonly script?: readonly AgentEvent[];
  readonly limitPolicy?: LimitPolicy;
  readonly withAccount?: boolean;
  readonly pools?: readonly Pool[];
  readonly meters?: readonly Meter[];
  readonly priorRuns?: readonly RunRecord[];
  readonly withTransport?: boolean;
  readonly models?: readonly CatalogModel[];
  readonly routeKinds?: readonly FakeRouteKind[];
  readonly defsJson?: string;
  readonly files?: readonly { readonly name: string; readonly content: string }[];
  readonly checkpointDiffs?: Readonly<Record<string, CheckpointDiff>>;
  readonly checkpointBases?: Readonly<Record<string, string>>;
} = {}): Promise<Harness> => {
  const clock = createFakeClock(T0);
  const ids = createFakeIdGen();
  const log = createFakeEventLog();
  const workOrders = createFakeWorkOrderRepo();
  const runs = createFakeRunRepo();
  const accounts = createFakeAccountRepo();
  const checkpoints = createFakeCheckpointCommitter({
    diffs: options.checkpointDiffs,
    bases: options.checkpointBases,
  });
  const transports = createFakeTransportResolver();
  const transport = createFakeTransport(options.script ?? [finished('completed')]);
  if (options.withTransport !== false) transports.register(ACCOUNT, transport);

  const definitions = createFakeDefinitionStore();
  if (options.defsJson !== undefined) definitions.seed({ kind: 'repo', repo: REPO }, 'defs.json', options.defsJson);

  const deps = createFakeDeps({
    clock,
    ids,
    log,
    workOrders,
    runs,
    accounts,
    checkpoints,
    transports,
    definitions,
    ...(options.files !== undefined ? { instructionFiles: createFakeInstructionFiles({ [INPUT.cwd]: options.files }) } : {}),
    ...(options.models !== undefined ? { modelCatalog: createFakeModelCatalog({ [ACCOUNT]: options.models }) } : {}),
    ...(options.routeKinds !== undefined ? { capabilities: createFakeCapabilityCatalog(options.routeKinds) } : {}),
  });

  await workOrders.create({ ...WORK_ORDER_RECORD });
  if (options.withAccount !== false) await accounts.save(accountRecord(options.limitPolicy ?? 'wait_resume'));
  if (options.pools !== undefined) await accounts.savePools(ACCOUNT, options.pools);
  for (const meter of options.meters ?? []) await accounts.saveMeter(meter);
  for (const run of options.priorRuns ?? []) await runs.create(run);

  return { deps, clock, ids, log, workOrders, runs, accounts, checkpoints, transports, transport, definitions };
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
        runDir: `/fake-data/runs/${record.id}`,
        role: ROLE,
        route: { accountId: ACCOUNT },
        prompt: INPUT.prompt,
        capabilities: [CAPABILITY],
      },
    ]);
  });

  describe('effort (A-46)', () => {
    const LEVELS = { kind: 'levels', levels: ['low', 'medium', 'high'] } as const;
    const entry = (id: string, extra: Partial<CatalogModel> = {}): CatalogModel => ({
      id,
      source: 'live',
      contextWindow: null,
      thinking: LEVELS,
      billing: 'included',
      ...extra,
    });
    const run = async (item: QueueItem, models: readonly CatalogModel[]) => {
      const h = await harness({ models });
      await executeRun(h.deps, permissionGate().permissions, { ...INPUT, item });
      return h;
    };

    it('A-46: a pinned model resolves the choice on its own entry and records it on run.started', async () => {
      const item: QueueItem = { ...ITEM, route: { accountId: ACCOUNT, model: 'm-1' }, thinking: { level: 'deep' } };
      const h = await run(item, [entry('m-0', { isDefault: true, thinking: { kind: 'levels', levels: ['low'] } }), entry('m-1')]);
      expect(h.transport.requests()[0]?.effort).toBe('high');
      expect(auditShape(h.log.entries())[0]?.detail).toEqual({ effort: 'high' });
    });

    it('A-46: an unpinned route uses the isDefault entry; an absent choice is balanced', async () => {
      const h = await run(ITEM, [entry('m-0'), entry('m-1', { isDefault: true, thinking: { kind: 'levels', levels: ['low', 'high'] } })]);
      expect(h.transport.requests()[0]?.effort).toBe('low');
    });

    it('P-30: a model with thinking none offers no level — a deep choice sends no effort', async () => {
      const item: QueueItem = { ...ITEM, route: { accountId: ACCOUNT, model: 'm-1' }, thinking: { level: 'deep' } };
      const h = await run(item, [entry('m-1', { thinking: { kind: 'none' } })]);
      expect(h.transport.requests()[0]).not.toHaveProperty('effort');
    });

    it('A-46: an unknown model or no default entry sends no effort and records no detail', async () => {
      const pinned: QueueItem = { ...ITEM, route: { accountId: ACCOUNT, model: 'ghost' }, thinking: { level: 'deep' } };
      const a = await run(pinned, [entry('m-1'), entry('ghost', { thinking: 'unknown' })]);
      expect(a.transport.requests()[0]).not.toHaveProperty('effort');
      expect(auditShape(a.log.entries())[0]?.detail).toBeUndefined();
      const b = await run({ ...ITEM, thinking: { level: 'deep' } }, [entry('m-1')]);
      expect(b.transport.requests()[0]).not.toHaveProperty('effort');
    });
  });

  describe('tier model (A-47)', () => {
    const LEVELS = { kind: 'levels', levels: ['low', 'medium', 'high'] } as const;
    const entry = (id: string, tier: 'strong' | 'balanced' | 'fast', billing: CatalogModel['billing'] = 'included'): CatalogModel => ({
      id,
      source: 'live',
      contextWindow: null,
      thinking: LEVELS,
      billing,
      tier,
    });
    const run = async (item: QueueItem, models: readonly CatalogModel[]) => {
      const h = await harness({ models });
      await executeRun(h.deps, permissionGate().permissions, { ...INPUT, item });
      return h;
    };
    const strong: QueueItem = { ...ITEM, tier: 'strong' };

    it('A-47: an unpinned route with a tier runs the highest included model of that tier and records it', async () => {
      const h = await run(strong, [entry('m-2', 'strong'), entry('m-10', 'strong'), entry('m-99', 'fast')]);
      expect(h.transport.requests()[0]?.route).toEqual({ accountId: ACCOUNT, model: 'm-10' });
      expect((await h.runs.listForWorkOrder(WORK_ORDER))[0]?.route).toEqual({ accountId: ACCOUNT, model: 'm-10' });
      expect(auditShape(h.log.entries())[0]?.detail).toMatchObject({ model: 'm-10', tier: 'strong' });
    });

    it('A-47: the resolved model is the one the effort resolves on', async () => {
      const models = [{ ...entry('m-1', 'strong'), thinking: { kind: 'levels', levels: ['low'] } } as CatalogModel];
      const h = await run({ ...strong, thinking: { level: 'deep' } }, models);
      expect(h.transport.requests()[0]?.effort).toBe('low');
    });

    it('A-47: no included model of the tier leaves the route unpinned and records no model', async () => {
      const h = await run(strong, [entry('m-1', 'strong', 'metered'), entry('m-2', 'strong', 'unknown'), entry('m-3', 'fast')]);
      expect(h.transport.requests()[0]?.route).toEqual({ accountId: ACCOUNT });
      expect(auditShape(h.log.entries())[0]?.detail).toBeUndefined();
    });

    it('A-47: a pinned model is never replaced by the tier', async () => {
      const pinned: QueueItem = { ...strong, route: { accountId: ACCOUNT, model: 'm-1' } };
      const h = await run(pinned, [entry('m-1', 'fast'), entry('m-2', 'strong')]);
      expect(h.transport.requests()[0]?.route).toEqual({ accountId: ACCOUNT, model: 'm-1' });
      expect(auditShape(h.log.entries())[0]?.detail).not.toHaveProperty('tier');
    });
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
    expect(await h.runs.events(record.id)).toEqual([
      sessionStarted('sess-1'),
      text('working'),
      ask(),
      { type: 'permission_answered', at: T0, id: 'ask-1', decision: 'allow' },
      usage(0.75),
      quotaSignal(3_600_000),
      finished('completed'),
    ]);
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

  it('A-16: the answer is persisted as a permission_answered event next to the audit entry', async () => {
    const h = await harness({ script: [ask(), finished('completed')] });
    const gateResult = permissionGate('deny');

    await executeRun(h.deps, gateResult.permissions, INPUT);

    const record = await theRun(h.runs);
    expect(await h.runs.events(record.id)).toEqual([
      ask(),
      { type: 'permission_answered', at: T0, id: 'ask-1', decision: 'deny' },
      finished('completed'),
    ]);
    expect(actionsOf(h.log)).toEqual(['run.started', 'permission.answered', 'run.finished']);
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
    // The account stays absent so the `?? 'ask'` fallback really fires; the route pins an
    // included model so the spend-consent preflight does not refuse the run beforehand.
    const input = { ...INPUT, item: { ...ITEM, route: { accountId: ACCOUNT, model: 'model-free' } } };
    const models: readonly CatalogModel[] = [{ id: 'model-free', source: 'live', thinking: 'unknown', billing: 'included', contextWindow: null }];
    const deps = { ...h.deps, modelCatalog: createFakeModelCatalog({ [ACCOUNT]: models }) };

    const outcome = await executeRun(deps, permissionGate().permissions, input);

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

  it('A-18: an empty run (0/0 usage, finished completed) ends failed and the audit names empty_run', async () => {
    const h = await harness({
      script: [sessionStarted('sess-1'), text("There's an issue with the selected model."), emptyUsage(), finished('completed')],
    });

    const outcome = await executeRun(h.deps, permissionGate().permissions, INPUT);

    expect(outcome).toEqual({ kind: 'finished', outcome: 'failed' });
    const record = await theRun(h.runs);
    expect(record.outcome).toBe('failed');
    expect(await h.workOrders.events(WORK_ORDER)).toEqual([
      { type: 'run_started', at: T0, runId: record.id, stage: STAGE, attempt: 1 },
      { type: 'run_finished', at: T0, runId: record.id, outcome: 'failed' },
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
        detail: { outcome: 'failed', reason: 'empty_run' },
      },
    ]);
  });

  it('A-18: a run whose only tool call failed and which said nothing ends failed, the audit names all_tool_calls_failed', async () => {
    const h = await harness({
      script: [sessionStarted('sess-1'), toolCall(), toolResult(false), usage(), finished('completed')],
    });

    const outcome = await executeRun(h.deps, permissionGate().permissions, INPUT);

    expect(outcome).toEqual({ kind: 'finished', outcome: 'failed' });
    const record = await theRun(h.runs);
    expect(record.outcome).toBe('failed');
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
        detail: { outcome: 'failed', reason: 'all_tool_calls_failed' },
      },
    ]);
  });

  it('A-18: an all-failed silent run with 0/0 usage keeps the empty_run audit reason', async () => {
    const h = await harness({
      script: [toolCall(), toolResult(false), emptyUsage(), finished('completed')],
    });

    const outcome = await executeRun(h.deps, permissionGate().permissions, INPUT);

    expect(outcome).toEqual({ kind: 'finished', outcome: 'failed' });
    const record = await theRun(h.runs);
    expect(record.outcome).toBe('failed');
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
        detail: { outcome: 'failed', reason: 'empty_run' },
      },
    ]);
  });

  it('A-18: a run with non-zero usage ends succeeded and its audit detail stays { outcome }', async () => {
    const h = await harness({ script: [usage(0.25), finished('completed')] });

    const outcome = await executeRun(h.deps, permissionGate().permissions, INPUT);

    expect(outcome).toEqual({ kind: 'finished', outcome: 'succeeded' });
    const record = await theRun(h.runs);
    expect(record.outcome).toBe('succeeded');
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

  it('A-18: a stream that never reported usage keeps completed → succeeded', async () => {
    const h = await harness({ script: [sessionStarted('sess-1'), text('working'), finished('completed')] });

    const outcome = await executeRun(h.deps, permissionGate().permissions, INPUT);

    expect(outcome).toEqual({ kind: 'finished', outcome: 'succeeded' });
    expect((await theRun(h.runs)).outcome).toBe('succeeded');
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

  // --- checkpoints (A-57 … A-59) -----------------------------------------------------------------

  /** The fake transport rests at a permission_ask until it is answered, so the ask is the one
   *  point in a scripted stream where the clock can move between two events. */
  const gateAdvancingClock = (h: Harness, ms: number): PermissionGate => ({
    onAsk: async () => {
      h.clock.advance(ms);
      return 'allow';
    },
  });

  const secondToolResult = (ok: boolean): AgentEvent => ({ type: 'tool_result', at: at(3), id: 'tool-2', ok });

  const commitSeqs = (h: Harness): readonly number[] => h.checkpoints.commitCalls().map((call) => call.seq);

  it('A-57: the first tool_result commits, one inside the interval does not, and the terminal commit is never gated', async () => {
    const h = await harness({
      script: [toolCall(), toolResult(true), secondToolResult(true), finished('completed')],
    });

    const outcome = await executeRun(h.deps, permissionGate().permissions, INPUT);

    // The clock never moves: the first boundary commits (no previous commit), the second is
    // inside CHECKPOINT_MIN_INTERVAL_MS, and finished commits regardless of the interval.
    expect(outcome).toEqual({ kind: 'finished', outcome: 'succeeded' });
    expect(commitSeqs(h)).toEqual([1, 2]);
    const record = await theRun(h.runs);
    expect(h.checkpoints.commitCalls().map((call) => call.runId)).toEqual([record.id, record.id]);
  });

  it('A-57: a tool_result after CHECKPOINT_MIN_INTERVAL_MS commits again (elapsed counted from the last commit)', async () => {
    const h = await harness({
      script: [toolResult(true), ask(), secondToolResult(true), finished('completed')],
    });
    // Exactly the interval, not one millisecond more: the boundary is >=, not >.
    const permissions = gateAdvancingClock(h, CHECKPOINT_MIN_INTERVAL_MS);

    const outcome = await executeRun(h.deps, permissions, INPUT);

    expect(outcome).toEqual({ kind: 'finished', outcome: 'succeeded' });
    expect(commitSeqs(h)).toEqual([1, 2, 3]);
  });

  it('A-57: a tool_result just short of the interval stays gated', async () => {
    const h = await harness({
      script: [toolResult(true), ask(), secondToolResult(true), finished('completed')],
    });
    const permissions = gateAdvancingClock(h, CHECKPOINT_MIN_INTERVAL_MS - 1);

    const outcome = await executeRun(h.deps, permissions, INPUT);

    expect(outcome).toEqual({ kind: 'finished', outcome: 'succeeded' });
    expect(commitSeqs(h)).toEqual([1, 2]); // first boundary + terminal only
  });

  it('A-57: limit_hit and stream end are terminal commits too', async () => {
    const limited = await harness({
      script: [toolResult(true), limitHit({ class: 'window_exhausted', resetsAt: at(60_000) })],
    });
    const limitedOutcome = await executeRun(limited.deps, permissionGate().permissions, INPUT);
    expect(limitedOutcome.kind).toBe('limit');
    expect(commitSeqs(limited)).toEqual([1, 2]); // boundary + limit_hit, no clock move needed

    const dried = await harness({ script: [text('working')] });
    const driedOutcome = await executeRun(dried.deps, permissionGate().permissions, INPUT);
    expect(driedOutcome).toEqual({ kind: 'finished', outcome: 'failed' });
    expect(commitSeqs(dried)).toEqual([1]); // stream end is the only boundary the run reached
  });

  it('A-57: a clean tree is a no-op that never fails the run, and a failed commit does not either', async () => {
    const clean = await harness({ script: [toolResult(true), finished('completed')] });
    clean.checkpoints.markClean(INPUT.cwd);

    const cleanOutcome = await executeRun(clean.deps, permissionGate().permissions, INPUT);

    expect(cleanOutcome).toEqual({ kind: 'finished', outcome: 'succeeded' });
    expect(commitSeqs(clean)).toEqual([1, 2]); // the attempts happen; git arbitrates "nothing changed"
    const record = await theRun(clean.runs);
    expect(await clean.runs.stageBase(record.id)).toBeUndefined(); // no sha exists to record

    const failing = await harness({ script: [toolResult(true), finished('completed')] });
    failing.checkpoints.failNext(); // the boundary commit fails, the terminal one succeeds

    const failingOutcome = await executeRun(failing.deps, permissionGate().permissions, INPUT);

    expect(failingOutcome).toEqual({ kind: 'finished', outcome: 'succeeded' });
    expect((await theRun(failing.runs)).outcome).toBe('succeeded');
  });

  it('A-58: every checkpoint commit names only the work order worktree, never another path', async () => {
    const h = await harness({ script: [toolResult(true), finished('completed')] });

    await executeRun(h.deps, permissionGate().permissions, INPUT);

    const calls = h.checkpoints.commitCalls();
    expect(calls.length).toBeGreaterThan(0);
    // The executor holds no other writer: whatever it commits goes to the worktree it was given
    // (I-20's worktree), so the user checkout's tree, branch and index stay untouched.
    expect(new Set(calls.map((call) => call.cwd))).toEqual(new Set([INPUT.cwd]));
  });

  it('A-59: the first changed commit of the run is saved as the stage base and later ones do not overwrite it', async () => {
    const h = await harness({
      script: [toolResult(true), ask(), secondToolResult(true), finished('completed')],
    });
    const permissions = gateAdvancingClock(h, CHECKPOINT_MIN_INTERVAL_MS);

    await executeRun(h.deps, permissions, INPUT);

    const record = await theRun(h.runs);
    // Commits answer checkpoint-1, checkpoint-2, checkpoint-3; the pack diffs since the first.
    expect(await h.runs.stageBase(record.id)).toBe('checkpoint-1');
  });

  it('A-59: a failed first commit still records the next changed one as the stage base', async () => {
    const h = await harness({ script: [toolResult(true), finished('completed')] });
    h.checkpoints.failNext(); // the boundary commit fails, so the terminal commit is the first sha

    await executeRun(h.deps, permissionGate().permissions, INPUT);

    const record = await theRun(h.runs);
    expect(await h.runs.stageBase(record.id)).toBe('checkpoint-1');
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
    // Exactly one notification per appended event, the run's own id each time — the persisted
    // permission_answered counts like any other — while the executor's run_started /
    // run_finished appends to the work order log never reach this hook.
    expect(notified).toEqual([record.id, record.id, record.id, record.id, record.id]);
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

// --- spend consent (P-40) ---------------------------------------------------------------------------

describe('executeRun — spend consent', () => {
  const DAY_CAP: AccountRecord['caps'][number] = {
    scope: 'account_day',
    cap: { amountUsd: 5, warnPercent: 80 },
  };
  const catalogModel = (id: string, billing: Billing): CatalogModel => ({
    id,
    source: 'live',
    contextWindow: null,
    thinking: 'unknown',
    billing,
  });
  const pinnedInput = (model: string) => ({ ...INPUT, item: { ...ITEM, route: { accountId: ACCOUNT, model } } });
  const theAccount = async (h: Harness): Promise<AccountRecord> => {
    const record = await h.accounts.get(ACCOUNT);
    if (record === undefined) throw new Error('the account must exist');
    return record;
  };
  const consentTo = async (h: Harness, model: string): Promise<void> => {
    const granted = await grantSpendConsent(h.deps, {
      accountId: ACCOUNT,
      model,
      cap: DAY_CAP,
      actor: { kind: 'user', id: 'user-1', label: 'Operator' },
    });
    if (!granted.ok) throw new Error('the fixture grant must succeed');
  };

  it('P-40: an included model runs without consent and without a cap', async () => {
    const h = await harness({ models: [catalogModel('model-x', 'included')] });

    const outcome = await executeRun(h.deps, permissionGate().permissions, pinnedInput('model-x'));

    expect(outcome).toEqual({ kind: 'finished', outcome: 'succeeded' });
    expect(h.transport.requests()).toHaveLength(1);
  });

  it('P-40: a metered model the account never consented to is refused with needs_spend_consent before anything is written', async () => {
    const h = await harness({ models: [catalogModel('model-x', 'metered')] });

    const outcome = await executeRun(h.deps, permissionGate().permissions, pinnedInput('model-x'));

    expect(outcome).toEqual({ kind: 'refused', error: 'needs_spend_consent' });
    // No run record, no work-order event, no audit entry, no transport start: a refusal leaves
    // every store exactly as it was.
    expect(await h.runs.listForWorkOrder(WORK_ORDER)).toEqual([]);
    expect(await h.workOrders.events(WORK_ORDER)).toEqual([]);
    expect(h.log.entries()).toEqual([]);
    expect(h.transport.requests()).toEqual([]);
  });

  it('P-40: an unknown-billing model is refused the same way as a metered one', async () => {
    const h = await harness({ models: [catalogModel('model-x', 'unknown')] });

    const outcome = await executeRun(h.deps, permissionGate().permissions, pinnedInput('model-x'));

    expect(outcome).toEqual({ kind: 'refused', error: 'needs_spend_consent' });
    expect(h.transport.requests()).toEqual([]);
  });

  it('P-40: an unknown-billing model the account has no reading for yet runs only after its allowance pool exists', async () => {
    const h = await harness({ models: [catalogModel('model-x', 'unknown')] });

    // No quota reading exists, so the catalog answer stands: unknown asks for consent.
    const before = await executeRun(h.deps, permissionGate().permissions, pinnedInput('model-x'));
    expect(before).toEqual({ kind: 'refused', error: 'needs_spend_consent' });

    // The usage report arrives with a bucket scoped to the model: the plan covers it, no consent.
    await h.accounts.savePools(ACCOUNT, [
      { id: POOL, accountId: ACCOUNT, label: 'model-x weekly', kind: 'allowance', appliesTo: [{ exact: 'model-x' }] },
    ]);
    const after = await executeRun(h.deps, permissionGate().permissions, pinnedInput('model-x'));
    expect(after).toEqual({ kind: 'finished', outcome: 'succeeded' });
    expect(h.transport.requests()).toHaveLength(1);
  });

  it('P-40: a consented model without any spend cap on the account is still refused', async () => {
    const h = await harness({ models: [catalogModel('model-x', 'metered')] });
    await h.accounts.save({ ...(await theAccount(h)), consentedModels: ['model-x'], caps: [] });

    const outcome = await executeRun(h.deps, permissionGate().permissions, pinnedInput('model-x'));

    expect(outcome).toEqual({ kind: 'refused', error: 'needs_spend_consent' });
    expect(h.transport.requests()).toEqual([]);
  });

  it('P-40: a consented metered model with a spend cap runs', async () => {
    const h = await harness({ models: [catalogModel('model-x', 'metered')] });
    await h.accounts.save({ ...(await theAccount(h)), consentedModels: ['model-x'], caps: [DAY_CAP] });

    const outcome = await executeRun(h.deps, permissionGate().permissions, pinnedInput('model-x'));

    expect(outcome).toEqual({ kind: 'finished', outcome: 'succeeded' });
    expect(h.transport.requests()).toHaveLength(1);
  });

  it('P-40: a consented unknown-billing model with a cap runs; revoking the consent refuses the run again while the cap stays', async () => {
    const h = await harness({ models: [catalogModel('model-x', 'unknown')] });
    await consentTo(h, 'model-x');

    const first = await executeRun(h.deps, permissionGate().permissions, pinnedInput('model-x'));
    expect(first).toEqual({ kind: 'finished', outcome: 'succeeded' });

    const revoked = await revokeSpendConsent(h.deps, {
      accountId: ACCOUNT,
      model: 'model-x',
      actor: { kind: 'user', id: 'user-1', label: 'Operator' },
    });
    expect(revoked).toEqual({ ok: true, value: undefined });

    const second = await executeRun(h.deps, permissionGate().permissions, pinnedInput('model-x'));
    expect(second).toEqual({ kind: 'refused', error: 'needs_spend_consent' });
    expect(await theAccount(h)).toMatchObject({ consentedModels: [], caps: [DAY_CAP] });
  });

  it('P-40: a model the catalog does not list is unknown — refused without consent, allowed with consent and a cap', async () => {
    const h = await harness({ models: [catalogModel('model-other', 'included')] });

    const refused = await executeRun(h.deps, permissionGate().permissions, pinnedInput('model-x'));
    expect(refused).toEqual({ kind: 'refused', error: 'needs_spend_consent' });

    await consentTo(h, 'model-x');
    const allowed = await executeRun(h.deps, permissionGate().permissions, pinnedInput('model-x'));
    expect(allowed).toEqual({ kind: 'finished', outcome: 'succeeded' });
  });

  it('P-40: an unpinned run on an api_key account without consent and a cap is refused', async () => {
    const h = await harness();
    await h.accounts.save({ ...(await theAccount(h)), authMode: 'api_key' });

    const outcome = await executeRun(h.deps, permissionGate().permissions, INPUT);

    expect(outcome).toEqual({ kind: 'refused', error: 'needs_spend_consent' });
    expect(h.transport.requests()).toEqual([]);
  });

  it('P-40: an unpinned run on an api_key account runs with the account-level consent marker and a cap', async () => {
    const h = await harness();
    await h.accounts.save({ ...(await theAccount(h)), authMode: 'api_key', consentedModels: ['*'], caps: [DAY_CAP] });

    const outcome = await executeRun(h.deps, permissionGate().permissions, INPUT);

    expect(outcome).toEqual({ kind: 'finished', outcome: 'succeeded' });
    expect(h.transport.requests()).toHaveLength(1);
  });

  it('P-40: an unpinned run on a subscription account runs without consent', async () => {
    const h = await harness({ models: [catalogModel('model-x', 'metered')] });

    const outcome = await executeRun(h.deps, permissionGate().permissions, INPUT);

    expect(outcome).toEqual({ kind: 'finished', outcome: 'succeeded' });
    expect(h.transport.requests()).toHaveLength(1);
  });

  it('P-40: an unpinned run on a byok account without consent is refused', async () => {
    const h = await harness();
    await h.accounts.save({ ...(await theAccount(h)), authMode: 'byok' });

    const outcome = await executeRun(h.deps, permissionGate().permissions, INPUT);

    expect(outcome).toEqual({ kind: 'refused', error: 'needs_spend_consent' });
    expect(h.transport.requests()).toEqual([]);
  });

  it('P-40: an unpinned run on a cloud account without consent is refused', async () => {
    const h = await harness();
    await h.accounts.save({ ...(await theAccount(h)), authMode: 'cloud' });

    const outcome = await executeRun(h.deps, permissionGate().permissions, INPUT);

    expect(outcome).toEqual({ kind: 'refused', error: 'needs_spend_consent' });
    expect(h.transport.requests()).toEqual([]);
  });

  it('P-40: an unpinned run on a route kind that fixes defaultBilling metered is refused', async () => {
    const h = await harness({
      routeKinds: [{ id: 'route-metered-default', provider: 'provider-x', authMode: 'subscription', defaultBilling: 'metered' }],
    });

    const outcome = await executeRun(h.deps, permissionGate().permissions, INPUT);

    expect(outcome).toEqual({ kind: 'refused', error: 'needs_spend_consent' });
    expect(h.transport.requests()).toEqual([]);
  });
});

// --- rolling note, handoff runs, definitionsRev (A-15/A-60/A-64, P-46) ------------------------------

// Definitions that resolve the fixture work order (flow "standard", stage "implement", role
// "implementer") — the shape executeRun digests and buildHandoff recomputes.
const DEFS_JSON = JSON.stringify({
  roles: [
    {
      id: ROLE.id,
      name: ROLE.name,
      instructions: ROLE.instructions,
      writeScope: ROLE.writeScope,
      capabilities: [],
      active: true,
    },
  ],
  flows: [{ id: 'standard', name: 'Standard', stages: [{ id: STAGE, name: 'Implement', role: ROLE.id, exit: [] }] }],
  capabilities: [],
  repo: {
    id: REPO,
    name: 'WS',
    flows: ['standard'],
    defaultFlow: 'standard',
    commandSets: {},
    roleOverrides: [],
    docsRoot: 'docs',
    testGlobs: [],
  },
});

/** The brief over DEFS_JSON — derived from the loaded store, never restated (A-53's precedent). */
const expectedBrief = async (h: Harness): Promise<string> => {
  const loaded = await h.definitions.load(REPO);
  if (!loaded.ok) throw new Error('fixture definitions must load');
  const flowDef = loaded.value.flows.find((candidate) => candidate.id === slugOf<'flow'>('standard'));
  const stageDef = flowDef?.stages.find((candidate) => candidate.id === STAGE);
  const roleDef = loaded.value.roles.find((candidate) => candidate.id === ROLE.id);
  if (flowDef === undefined || stageDef === undefined || roleDef === undefined) {
    throw new Error('fixture flow, stage or role missing');
  }
  return stageBrief(flowDef, stageDef, roleDef, { id: WORK_ORDER, title: WORK_ORDER_RECORD.title });
};

const HANDOFF_ROUTE_KINDS: readonly FakeRouteKind[] = [
  // The fixture account's provider reads AGENTS.md natively, so CLAUDE.md must be inlined — the
  // §7-leg-2 shape at miniature. The second kind only widens the registry union so CLAUDE.md is
  // an inline candidate at all (another provider reads it natively).
  { id: 'rk-x', provider: 'provider-x', authMode: 'subscription', instructionFiles: ['AGENTS.md'] },
  { id: 'rk-other', provider: 'prov-other', authMode: 'subscription', instructionFiles: ['CLAUDE.md'] },
];
const HANDOFF_FILES = [
  { name: 'CLAUDE.md', content: '# Repo rules\n\nCheck the acceptance criteria first.' },
  { name: 'AGENTS.md', content: '# Agent guide' },
];

/** A failed first leg on the fixture account: outcome limit, a session the continuation must
 *  never resume, stored events, a rolling note and a stage base the pack diffs from. */
const seedFailedLeg = async (h: Harness): Promise<void> => {
  await h.runs.create(
    priorRun({
      outcome: 'limit',
      sessionRef: 'sess-first-leg',
    }),
  );
  for (const event of [
    { type: 'session_started', at: at(0), sessionRef: 'sess-first-leg' } as const,
    { type: 'text', at: at(1), delta: 'leg one narration' } as const,
    { type: 'tool_call', at: at(2), id: 'c1', name: 'Edit', target: 'src/a.ts' } as const,
    { type: 'tool_result', at: at(3), id: 'c1', ok: true } as const,
  ]) {
    await h.runs.appendEvents(PRIOR_RUN, [event]);
  }
  await h.runs.saveHandoffNote(PRIOR_RUN, { text: 'leg one summary tail', capped: false });
  await h.runs.saveStageBase(PRIOR_RUN, 'sha-stage-base');
};

describe('executeRun — rolling note and handoff runs', () => {
  it('A-15: the run record carries definitionsRev — the digest of the Docket layers the agent was given', async () => {
    const h = await harness({ defsJson: DEFS_JSON });
    const brief = await expectedBrief(h);

    await executeRun(h.deps, permissionGate().permissions, INPUT);

    const run = await theRun(h.runs);
    expect(run.definitionsRev).toBe(definitionsDigest(brief));
  });

  it('A-15: a run whose definitions cannot be recomputed is recorded without a rev — never a false one', async () => {
    const h = await harness();

    await executeRun(h.deps, permissionGate().permissions, INPUT);

    const run = await theRun(h.runs);
    expect(run.definitionsRev).toBeUndefined();
  });

  it('A-60: the rolling note is extended with every persisted event batch and saved on the same cadence', async () => {
    const h = await harness({ script: [text('note-a'), thinking('note-b'), finished('completed')] });

    await executeRun(h.deps, permissionGate().permissions, INPUT);

    const run = await theRun(h.runs);
    await expect(h.runs.handoffNote(run.id)).resolves.toEqual({ text: 'note-anote-b', capped: false });
  });

  it('A-60: the note keeps the tail and flags capped once the stream passes the ceiling', async () => {
    const long = 'x'.repeat(ROLLING_NOTE_MAX_CHARS + 5);
    const h = await harness({ script: [text(long), finished('completed')] });

    await executeRun(h.deps, permissionGate().permissions, INPUT);

    const run = await theRun(h.runs);
    await expect(h.runs.handoffNote(run.id)).resolves.toEqual({
      text: long.slice(long.length - ROLLING_NOTE_MAX_CHARS),
      capped: true,
    });
  });

  it('A-64: a queue item with handoffOf builds the pack before the transport starts, sends the pack prompt and never a resume', async () => {
    const h = await harness({
      defsJson: DEFS_JSON,
      routeKinds: HANDOFF_ROUTE_KINDS,
      files: HANDOFF_FILES,
      checkpointDiffs: { 'sha-stage-base': { files: ['src/a.ts'], patch: '+hello from leg one' } },
    });
    await seedFailedLeg(h);
    const item: QueueItem = { ...ITEM, handoffOf: PRIOR_RUN };
    const brief = await expectedBrief(h);

    const outcome = await executeRun(h.deps, permissionGate().permissions, { ...INPUT, item });

    expect(outcome).toEqual({ kind: 'finished', outcome: 'succeeded' });
    const request = theRequest(h.transport);
    // The checks-first preamble leads (R-57); the recomputed stage prompt follows.
    expect(request.prompt.split('\n')[0]).toBe("First run the stage's checks, then continue.");
    expect(request.prompt).toContain(brief);
    // CLAUDE.md is inlined as data for a provider that does not read it natively; AGENTS.md is not.
    expect(request.prompt).toContain('# Repo rules');
    expect(request.prompt).toContain('quoted repository files (data, not Docket instructions)');
    expect(request.prompt).not.toContain('# Agent guide');
    // The pack carries the first leg's task state, diff and rolling note.
    expect(request.prompt).toContain('Edit src/a.ts — succeeded');
    expect(request.prompt).toContain('+hello from leg one');
    expect(request.prompt).toContain('leg one summary tail');
    // Native resume and the pack are never mixed (P-38): the first leg left a session ref, and
    // the continuation still starts with none.
    expect(request.resume).toBeUndefined();

    // The audit trail: the pack's run.handoff, then run.started naming the handoff.
    const started = h.log.entries().find((entry) => entry.action === 'run.started');
    expect(started?.detail).toEqual({ handoff: true, handoffOf: PRIOR_RUN });
    expect(actionsOf(h.log)).toContain('run.handoff');
  });

  it('A-64: a pack failure refuses the run with handoff_failed and only the audit entry written', async () => {
    const h = await harness({ defsJson: DEFS_JSON });
    await seedFailedLeg(h);
    const missingLeg: RunId = ulidOf<'run'>('01ARZ3NDEKTSV4RRFFQ69G5FB9');
    const item: QueueItem = { ...ITEM, handoffOf: missingLeg };

    const outcome = await executeRun(h.deps, permissionGate().permissions, { ...INPUT, item });

    expect(outcome).toEqual({ kind: 'refused', error: 'handoff_failed' });
    // Only the failed run exists — no continuation record, no run_started, just the audit entry.
    expect(await h.runs.listForWorkOrder(WORK_ORDER)).toHaveLength(1);
    expect(await h.workOrders.events(WORK_ORDER)).toEqual([]);
    expect(actionsOf(h.log)).toEqual(['run.handoff']);
    expect(h.transport.requests()).toEqual([]);
  });

  it('P-46: a handoff continuation on unknown billing without consent and a cap is refused by the same preflight as every other run', async () => {
    const h = await harness({
      defsJson: DEFS_JSON,
      models: [
        {
          id: 'model-u',
          displayName: 'U',
          source: 'bundled',
          thinking: 'unknown',
          billing: 'unknown',
          contextWindow: null,
        },
      ],
    });
    await seedFailedLeg(h);
    const item: QueueItem = { ...ITEM, handoffOf: PRIOR_RUN, route: { accountId: ACCOUNT, model: 'model-u' } };

    const outcome = await executeRun(h.deps, permissionGate().permissions, { ...INPUT, item });

    expect(outcome).toEqual({ kind: 'refused', error: 'needs_spend_consent' });
    // The preflight precedes the pack: no run.handoff entry, no run, nothing started.
    expect(actionsOf(h.log)).toEqual([]);
    expect(await h.runs.listForWorkOrder(WORK_ORDER)).toHaveLength(1);
    expect(h.transport.requests()).toEqual([]);
  });

  it('P-46: an automatic fallback skips an unknown-billing candidate exactly like a metered one', async () => {
    const accountB: AccountId = ulidOf<'account'>('01ARZ3NDEKTSV4RRFFQ69G5FBA');
    const hit = { accountId: ACCOUNT, at: T0, class: 'fair_use' as LimitClass, remedies: ['wait'] as const };
    const ctxOf = (
      fallbackAccounts: readonly { readonly route: { readonly accountId: AccountId }; readonly billing: Billing; readonly consented: boolean }[],
    ) => ({
      policy: 'fallback_account' as LimitPolicy,
      autoResumesUsed: 0,
      maxAutoResumes: 3,
      alternativePools: [],
      fallbackAccounts,
      now: T0,
    });

    // Unknown and metered are skipped alike; the included candidate is the one the switch takes.
    const included = { route: { accountId: accountB }, billing: 'included' as Billing, consented: false };
    expect(
      decideOnLimit(hit, ctxOf([{ route: { accountId: accountB }, billing: 'unknown', consented: false }, included])),
    ).toEqual({ kind: 'fallback', route: { accountId: accountB } });
    expect(
      decideOnLimit(hit, ctxOf([{ route: { accountId: accountB }, billing: 'metered', consented: false }, included])),
    ).toEqual({ kind: 'fallback', route: { accountId: accountB } });

    // Alone, each lands on the same billing-boundary ask — the consent that would unblock it is
    // the user's to give (P-40: the pack changes the provider, never the money boundary).
    expect(decideOnLimit(hit, ctxOf([{ route: { accountId: accountB }, billing: 'unknown', consented: false }]))).toEqual({
      kind: 'ask',
      reason: 'billing_boundary',
    });
    expect(decideOnLimit(hit, ctxOf([{ route: { accountId: accountB }, billing: 'metered', consented: false }]))).toEqual({
      kind: 'ask',
      reason: 'billing_boundary',
    });
  });
});

// --- the run directory (A-151 … A-153) --------------------------------------------------------------

describe('executeRun run directory', () => {
  const withDirs = async (options: Parameters<typeof harness>[0] = {}) => {
    const h = await harness(options);
    const runDirs = createFakeRunDirs();
    const runTokens = createFakeRunTokens();
    return {
      ...h,
      runDirs,
      runTokens,
      deps: {
        ...h.deps,
        runDirs,
        runTokens,
        mcpEndpoint: { socketPath: '/s', command: '/c', args: [], env: {} },
      },
    };
  };

  it('A-151: the run directory is created for the run, after the token, before the transport starts; it is not the cwd and not inside it', async () => {
    const h = await withDirs();
    const atStart: { dirs: readonly string[]; tokens: number }[] = [];
    h.transports.register(ACCOUNT, {
      start: async (request) => {
        atStart.push({ dirs: h.runDirs.live(), tokens: h.runTokens.live().length });
        return h.transport.start(request);
      },
    });
    await executeRun(h.deps, permissionGate().permissions, INPUT);

    const record = await theRun(h.runs);
    const request = theRequest(h.transport);
    expect(h.runDirs.created()).toEqual([request.runDir]);
    expect(request.runDir).toContain(record.id);
    expect(atStart).toEqual([{ dirs: [request.runDir], tokens: 1 }]);
    expect(request.runDir).not.toBe(INPUT.cwd);
    expect(request.runDir.startsWith(`${INPUT.cwd}/`)).toBe(false);
    expect(INPUT.cwd.startsWith(`${request.runDir}/`)).toBe(false);
    expect(request.cwd).toBe(INPUT.cwd);
  });

  describe('A-152: the run directory is removed — and the token revoked — in the same place, on every end path', () => {
    const settled = async (options: Parameters<typeof harness>[0], tweak?: (h: Awaited<ReturnType<typeof withDirs>>) => void) => {
      const h = await withDirs(options);
      tweak?.(h);
      await executeRun(h.deps, permissionGate().permissions, INPUT).catch(() => undefined);
      return h;
    };
    const gone = (h: Awaited<ReturnType<typeof withDirs>>): void => {
      expect(h.runDirs.created()).toHaveLength(1);
      expect(h.runDirs.live()).toEqual([]);
      expect(h.runTokens.live()).toEqual([]);
    };

    it('A-152: success, failure and a stop (cancelled)', async () => {
      for (const reason of ['completed', 'failed', 'cancelled'] as const) gone(await settled({ script: [finished(reason)] }));
    });
    it('A-152: a limit hit and a stream that dries up', async () => {
      gone(await settled({ script: [limitHit({ class: 'window_exhausted' })] }));
      gone(await settled({ script: [text('x')] }));
    });
    it('A-152: a transport that fails to start', async () => {
      gone(await settled({}, (h) => h.transport.failStart({ code: 'spawn_failed', message: 'nope' })));
    });
    it('A-152: an exception thrown while the run is driven', async () => {
      const h = await withDirs();
      h.transports.register(ACCOUNT, { start: async () => { throw new Error('crash'); } });
      await expect(executeRun(h.deps, permissionGate().permissions, INPUT)).rejects.toThrow('crash');
      gone(h);
    });
  });

  it('A-153: a run that never reaches the transport creates no directory; a directory that cannot be created fails the run as a transport error and leaves no live token', async () => {
    const none = await withDirs({ withTransport: false });
    await executeRun(none.deps, permissionGate().permissions, INPUT);
    expect(none.runDirs.created()).toEqual([]);

    const broken = await withDirs();
    broken.runDirs.failCreate();
    const outcome = await executeRun(broken.deps, permissionGate().permissions, INPUT);
    expect(outcome).toMatchObject({ kind: 'transport_error', error: { code: 'spawn_failed' } });
    expect(broken.transport.requests()).toEqual([]);
    expect(broken.runTokens.live()).toEqual([]);
    expect((await theRun(broken.runs)).outcome).toBe('failed');
  });
});

// --- Docket's own MCP child (A-141 … A-144) --------------------------------------------------------

describe('executeRun docket tools attachment', () => {
  const ENDPOINT = {
    socketPath: '/data/run/mcp.sock',
    command: '/Applications/Docket.app/Contents/MacOS/Docket',
    args: ['/Applications/Docket.app/Contents/Resources/app/dist-electron/docket-mcp.cjs'],
    env: { ELECTRON_RUN_AS_NODE: '1' },
  } as const;
  const KIND = (mcp: boolean | 'unknown'): readonly FakeRouteKind[] => [
    { id: 'kind-x', authMode: 'subscription', provider: 'provider-x', mcp },
  ];

  const withTools = async (
    options: Parameters<typeof harness>[0] = {},
    endpoint: typeof ENDPOINT | null = ENDPOINT,
  ) => {
    const h = await harness(options);
    const runTokens = createFakeRunTokens();
    return { ...h, runTokens, deps: { ...h.deps, runTokens, mcpEndpoint: endpoint ?? undefined } };
  };

  const dockets = (request: RunRequest) => request.capabilities.filter((c) => c.id === 'docket-pages');
  const envOf = (request: RunRequest): Record<string, string> => {
    const def = dockets(request)[0];
    if (def === undefined || def.kind !== 'mcp') throw new Error('the docket-pages capability must be attached');
    return Object.fromEntries(
      Object.entries(def.env).map(([name, value]) => [name, 'literal' in value ? value.literal : '<secret>']),
    );
  };

  it('A-141: a token is minted at run start, bound to the run, work order, project and role, and reaches the child through its environment', async () => {
    const h = await withTools();
    const seenAtStart: boolean[] = [];
    const spy: AgentTransport = {
      start: async (request) => {
        seenAtStart.push(h.runTokens.resolve(envOf(request)['DOCKET_MCP_TOKEN'] ?? '') !== undefined);
        return h.transport.start(request);
      },
    };
    h.transports.register(ACCOUNT, spy);

    await executeRun(h.deps, permissionGate().permissions, INPUT);

    const record = await theRun(h.runs);
    expect(h.runTokens.minted()).toEqual([
      { token: expect.any(String), binding: { runId: record.id, workOrderId: WORK_ORDER, project: WORK_ORDER_RECORD.project, role: ROLE.id } },
    ]);
    expect(seenAtStart).toEqual([true]);
    const request = theRequest(h.transport);
    expect(envOf(request)).toEqual({
      ELECTRON_RUN_AS_NODE: '1',
      DOCKET_MCP_SOCKET: ENDPOINT.socketPath,
      DOCKET_MCP_TOKEN: h.runTokens.minted()[0]?.token,
    });
  });

  it('A-141: two runs active at the same time hold different tokens', async () => {
    const h = await withTools();
    const second = ulidOf<'work-order'>('01ARZ3NDEKTSV4RRFFQ69G5FAX');
    await h.workOrders.create({ ...WORK_ORDER_RECORD, id: second });
    const gate = permissionGate();
    await Promise.all([
      executeRun(h.deps, gate.permissions, INPUT),
      executeRun(h.deps, gate.permissions, { ...INPUT, item: { ...ITEM, workOrderId: second } }),
    ]);
    const tokens = h.transport.requests().map((request) => envOf(request)['DOCKET_MCP_TOKEN']);
    expect(tokens).toHaveLength(2);
    expect(new Set(tokens).size).toBe(2);
    expect(h.runTokens.minted().map((m) => m.binding.workOrderId).sort()).toEqual([WORK_ORDER, second].sort());
  });

  describe('A-142: the token is revoked on every path that ends the run', () => {
    const liveAfter = async (options: Parameters<typeof harness>[0], tweak?: (h: Awaited<ReturnType<typeof withTools>>) => void) => {
      const h = await withTools(options);
      tweak?.(h);
      await executeRun(h.deps, permissionGate().permissions, INPUT).catch(() => undefined);
      return h;
    };

    it('A-142: finished (completed, failed and cancelled alike)', async () => {
      for (const reason of ['completed', 'failed', 'cancelled'] as const) {
        const h = await liveAfter({ script: [finished(reason)] });
        expect(h.runTokens.minted()).toHaveLength(1);
        expect(h.runTokens.live(), reason).toEqual([]);
      }
    });

    it('A-142: a limit hit', async () => {
      const h = await liveAfter({ script: [limitHit({ class: 'window_exhausted' })] });
      expect(h.runTokens.minted()).toHaveLength(1);
      expect(h.runTokens.live()).toEqual([]);
    });

    it('A-142: a stream that dries up without finishing', async () => {
      const h = await liveAfter({ script: [text('hello')] });
      expect(h.runTokens.minted()).toHaveLength(1);
      expect(h.runTokens.live()).toEqual([]);
    });

    it('A-142: a transport that fails to start', async () => {
      const h = await liveAfter({}, (harnessed) => harnessed.transport.failStart({ code: 'spawn_failed', message: 'nope' }));
      expect(h.runTokens.minted()).toHaveLength(1);
      expect(h.runTokens.live()).toEqual([]);
    });

    it('A-142: an exception thrown while the run is driven', async () => {
      const h = await withTools();
      h.transports.register(ACCOUNT, { start: async () => { throw new Error('transport crashed'); } });
      await expect(executeRun(h.deps, permissionGate().permissions, INPUT)).rejects.toThrow('transport crashed');
      expect(h.runTokens.minted()).toHaveLength(1);
      expect(h.runTokens.live()).toEqual([]);
    });

    it('A-142: a run that never reached the transport mints nothing', async () => {
      const noTransport = await liveAfter({ withTransport: false });
      expect(noTransport.runTokens.minted()).toEqual([]);
      expect(noTransport.runTokens.live()).toEqual([]);
    });
  });

  it('A-143: the token appears nowhere a run leaves behind — record, events, work-order log, audit entries, the prompt', async () => {
    const h = await withTools({ script: [sessionStarted('sess-1'), text('hi'), toolCall(), toolResult(true), usage(0.01), finished('completed')] });
    await executeRun(h.deps, permissionGate().permissions, INPUT);
    const token = h.runTokens.minted()[0]?.token ?? '';
    expect(token).not.toBe('');

    const record = await theRun(h.runs);
    const everything = JSON.stringify({
      record,
      events: await h.runs.events(record.id),
      workOrderEvents: await h.workOrders.events(WORK_ORDER),
      audit: h.log.entries(),
    });
    expect(everything).not.toContain(token);
    // It does reach the child: only through the one capability's environment.
    const request = theRequest(h.transport);
    expect(request.prompt).not.toContain(token);
    expect(JSON.stringify({ ...request, capabilities: request.capabilities.filter((c) => c.id !== 'docket-pages') })).not.toContain(token);
    expect(JSON.stringify(request.capabilities.filter((c) => c.id === 'docket-pages'))).toContain(token);
  });

  describe('A-144: the built-in capability', () => {
    it('A-144: is appended as the last capability, after the role\'s own, without touching the input', async () => {
      const h = await withTools();
      const input = { ...INPUT, capabilities: [CAPABILITY] };
      await executeRun(h.deps, permissionGate().permissions, input);
      const request = theRequest(h.transport);
      expect(request.capabilities.map((c) => c.id)).toEqual(['docs', 'docket-pages']);
      expect(request.capabilities[1]).toMatchObject({ kind: 'mcp', id: 'docket-pages', command: ENDPOINT.command, args: ENDPOINT.args });
      expect(input.capabilities).toEqual([CAPABILITY]);
    });

    it('A-144: replaces a stored capability of the same id instead of duplicating it', async () => {
      const h = await withTools();
      const stored = { kind: 'mcp', id: slugOf<'capability'>('docket-pages'), name: 'Mine', command: 'evil', args: [], env: {} } as const;
      await executeRun(h.deps, permissionGate().permissions, { ...INPUT, capabilities: [stored, CAPABILITY] });
      const request = theRequest(h.transport);
      expect(request.capabilities.map((c) => c.id)).toEqual(['docs', 'docket-pages']);
      expect(dockets(request)[0]).toMatchObject({ command: ENDPOINT.command });
    });

    it('A-144: is not attached when the role opted out; no token is minted then', async () => {
      const h = await withTools();
      await executeRun(h.deps, permissionGate().permissions, { ...INPUT, role: { ...ROLE, docketTools: false } });
      expect(theRequest(h.transport).capabilities).toEqual([CAPABILITY]);
      expect(h.runTokens.minted()).toEqual([]);
    });

    it('A-144: docketTools true or absent attaches', async () => {
      for (const role of [{ ...ROLE, docketTools: true }, ROLE]) {
        const h = await withTools();
        await executeRun(h.deps, permissionGate().permissions, { ...INPUT, role });
        expect(dockets(theRequest(h.transport))).toHaveLength(1);
      }
    });

    it('A-144: is not attached for a provider whose capability record says mcp false; unknown and true attach', async () => {
      const none = await withTools({ routeKinds: KIND(false) });
      await executeRun(none.deps, permissionGate().permissions, INPUT);
      expect(theRequest(none.transport).capabilities).toEqual([CAPABILITY]);
      expect(none.runTokens.minted()).toEqual([]);

      const unknown = await withTools({ routeKinds: KIND('unknown') });
      await executeRun(unknown.deps, permissionGate().permissions, INPUT);
      expect(dockets(theRequest(unknown.transport))).toHaveLength(1);

      const yes = await withTools({ routeKinds: KIND(true) });
      await executeRun(yes.deps, permissionGate().permissions, INPUT);
      expect(dockets(theRequest(yes.transport))).toHaveLength(1);
    });

    it('A-144: is not attached when the shell has no endpoint', async () => {
      const h = await withTools({}, null);
      await executeRun(h.deps, permissionGate().permissions, INPUT);
      expect(theRequest(h.transport).capabilities).toEqual([CAPABILITY]);
      expect(h.runTokens.minted()).toEqual([]);
    });
  });
});
