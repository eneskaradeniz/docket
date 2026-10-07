// dev-bridge.test.ts — the bridge's own contract, proven without Electron: the gating rule, the
// op surface (continuation behaviour, truncation, whitelist), the store views' secret-free shapes and
// the four invariants, each with a passing and a failing fixture. The folds and registries main.ts
// injects are the real ones, so the wiring's semantics are what gets tested.
import { describe, expect, it } from 'vitest';
import { mkdirSync, mkdtempSync, rmSync, symlinkSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { deriveWorkOrderState, foldRun } from '../src/domain/index';
import type {
  AccountId,
  AgentEvent,
  EpochMs,
  FlowDef,
  FlowSlug,
  RoleSlug,
  RunId,
  StageSlug,
  WorkOrderId,
  WorkOrderEvent,
} from '../src/domain/index';
import { COMMAND_REGISTRY, QUERY_REGISTRY } from '../src/api/index';
import type {
  AccountRecord,
  AuditEntry,
  AuditSubject,
  BindingScope,
  RunRecord,
  WorkOrderRecord,
} from '../src/application/index';
import type { RoleBinding } from '../src/domain/index';

import {
  DEV_BRIDGE_MAX_BYTES,
  DEV_OPS,
  DEV_RING_LIMIT,
  createDevBridge,
  dataDirOutsideDocketHome,
  devBridgeEnabled,
  inv1SucceededRunsCarryTokens,
  inv2AccountsHaveABinding,
  inv3EndedRunsHoldNoOpenAsk,
  inv4RunningOrdersHaveAnActiveRun,
} from './dev-bridge';

// --- the fake world ----------------------------------------------------------------------------------

const NOW: EpochMs = 1_700_000_000_000;

const ORDER_ID = '01WO0000000000000000000001' as WorkOrderId;
const RUN_ID = '01RUN0000000000000000000001' as RunId;
const ACCOUNT_ID = 'acct-1' as AccountId;

const wo = (id: WorkOrderId, at: EpochMs = 5): WorkOrderRecord => ({
  id,
  project: 'proj' as WorkOrderRecord['project'],
  repo: 'repo' as WorkOrderRecord['repo'],
  flow: 'std' as WorkOrderRecord['flow'],
  title: `work order ${id}`,
  createdAt: at,
  createdBy: { kind: 'user', id: 'u-1' },
});

const run = (id: RunId, workOrderId: WorkOrderId, at: EpochMs = 10, ended?: EpochMs): RunRecord => ({
  id,
  workOrderId,
  stage: 'work' as RunRecord['stage'],
  attempt: 1,
  role: 'worker' as RunRecord['role'],
  route: { accountId: ACCOUNT_ID },
  startedAt: at,
  endedAt: ended,
  autoResumesUsed: 0,
});

const account = (id: AccountId): AccountRecord => ({
  id,
  provider: 'p',
  label: `account ${id}`,
  authMode: 'api_key',
  limitPolicy: 'wait_resume',
  secretRef: `keychain-entry-${id}`,
  routeKind: 'cli',
  endpoint: 'https://example.test/api',
  caps: [],
});

const binding = (role: string): { scope: BindingScope; binding: RoleBinding } => ({
  scope: { level: 'global' },
  binding: { role: role as RoleSlug, accounts: [{ accountId: ACCOUNT_ID }] },
});

const auditEntry = (id: string, at: EpochMs, subject: AuditSubject): AuditEntry => ({
  id: id as AuditEntry['id'],
  at,
  actor: { kind: 'user', id: 'u-1' },
  action: 'run.started',
  subject,
});

const created = (at: EpochMs = 5): WorkOrderEvent => ({ type: 'created', at, by: { kind: 'user', id: 'u-1' }, flow: 'std' as FlowSlug });
const runStarted = (runId: RunId, at: EpochMs = 10): WorkOrderEvent => ({
  type: 'run_started',
  at,
  runId,
  stage: 'work' as StageSlug,
  attempt: 1,
});
const runFinished = (runId: RunId, at: EpochMs = 61): WorkOrderEvent => ({ type: 'run_finished', at, runId, outcome: 'succeeded' });

interface World {
  accounts: readonly AccountRecord[];
  bindings: readonly { readonly scope: BindingScope; readonly binding: RoleBinding }[];
  orders: readonly WorkOrderRecord[];
  orderEvents: readonly { readonly workOrderId: WorkOrderId; readonly events: readonly WorkOrderEvent[] }[];
  runs: readonly RunRecord[];
  runEvents: readonly { readonly runId: RunId; readonly events: readonly AgentEvent[] }[];
  audit: readonly AuditEntry[];
}

const eventsOfOrder = (world: World, id: WorkOrderId): readonly WorkOrderEvent[] =>
  world.orderEvents.find((entry) => entry.workOrderId === id)?.events ?? [];

const emptyWorld = (): World => ({
  accounts: [],
  bindings: [],
  orders: [],
  orderEvents: [],
  runs: [],
  runEvents: [],
  audit: [],
});

/** The subject key the sqlite log uses: the subject's id, or the role for a binding. */
const subjectKeyOf = (subject: AuditSubject): string => (subject.kind === 'binding' ? subject.role : subject.id);

const FLOW: FlowDef = {
  id: 'std' as FlowSlug,
  name: 'Std',
  stages: [{ id: 'work' as StageSlug, name: 'Work', role: 'worker' as RoleSlug, exit: [] }],
};

const makeBridge = (world: World) =>
  createDevBridge({
    workOrders: {
      list: async () => world.orders,
      number: async (id) => {
        const index = world.orders.findIndex((order) => order.id === id);
        return index === -1 ? undefined : index + 1;
      },
      events: async (id) => eventsOfOrder(world, id),
    },
    runs: {
      listForWorkOrder: async (workOrderId) => world.runs.filter((candidate) => candidate.workOrderId === workOrderId),
      events: async (id) => world.runEvents.find((entry) => entry.runId === id)?.events ?? [],
    },
    accounts: { list: async () => world.accounts },
    bindings: { listAll: async () => world.bindings },
    log: {
      // The port's own contract: newest first, by (at desc, id desc), limited.
      list: async (subject, limit) =>
        world.audit
          .filter((entry) => entry.subject.kind === subject.kind && subjectKeyOf(entry.subject) === subjectKeyOf(subject))
          .sort((a, b) => b.at - a.at || (a.id < b.id ? 1 : -1))
          .slice(0, Math.max(0, limit)),
    },
    definitions: { load: async () => ({ ok: true as const, value: { roles: [], flows: [FLOW], capabilities: [] } }) },
    now: () => NOW,
    fold: foldRun,
    deriveStatus: deriveWorkOrderState,
    commandRegistry: COMMAND_REGISTRY,
    queryRegistry: QUERY_REGISTRY,
  });

const callJson = async (bridge: ReturnType<typeof makeBridge>, op: unknown, args?: unknown) =>
  JSON.parse((await bridge.call(op, args)).payload) as {
    readonly ok: boolean;
    readonly code?: string;
    readonly [key: string]: unknown;
  };

/** Every object key anywhere in the value — the secrets-field sweep walks it. */
const keysAnywhere = (value: unknown): readonly string[] => {
  if (Array.isArray(value)) return value.flatMap((item) => keysAnywhere(item));
  if (typeof value === 'object' && value !== null) {
    return Object.entries(value).flatMap(([key, item]) => [key, ...keysAnywhere(item)]);
  }
  return [];
};

// --- gating ------------------------------------------------------------------------------------------

describe('devBridgeEnabled', () => {
  const gate = { flag: '1', isPackaged: false, dataDir: '/tmp/docket-cdp-x', docketHome: '/tmp/home/.docket' };

  it('G-1: is enabled only when all four conditions hold', () => {
    expect(devBridgeEnabled(gate)).toBe(true);
  });

  it('G-2: each condition failing alone leaves the bridge off', () => {
    expect(devBridgeEnabled({ ...gate, flag: undefined })).toBe(false);
    expect(devBridgeEnabled({ ...gate, flag: '0' })).toBe(false);
    expect(devBridgeEnabled({ ...gate, flag: 'true' })).toBe(false);
    expect(devBridgeEnabled({ ...gate, isPackaged: true })).toBe(false);
    expect(devBridgeEnabled({ ...gate, dataDir: undefined })).toBe(false);
    expect(devBridgeEnabled({ ...gate, dataDir: '' })).toBe(false);
  });

  it('G-3: a data dir equal to or inside ~/.docket fails', () => {
    expect(dataDirOutsideDocketHome('/tmp/home/.docket', '/tmp/home/.docket')).toBe(false);
    expect(dataDirOutsideDocketHome('/tmp/home/.docket/sub/dir', '/tmp/home/.docket')).toBe(false);
    expect(dataDirOutsideDocketHome('/tmp/home/elsewhere', '/tmp/home/.docket')).toBe(true);
  });

  it('G-4: a symlinked parent that lands inside ~/.docket fails too', () => {
    const root = mkdtempSync(join(tmpdir(), 'devbridge-gate-'));
    try {
      const home = join(root, 'home');
      const docketHome = join(home, '.docket');
      mkdirSync(docketHome, { recursive: true });
      const link = join(root, 'link');
      symlinkSync(docketHome, link);
      // The plain spelling sits outside ~/.docket; the resolved form is inside it.
      expect(dataDirOutsideDocketHome(join(link, 'data'), docketHome)).toBe(false);
      expect(dataDirOutsideDocketHome(join(home, 'data'), docketHome)).toBe(true);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it('G-5: folds case on the platforms whose filesystems do', () => {
    const verdict = dataDirOutsideDocketHome('/tmp/home/.DOCKET/data', '/tmp/home/.docket');
    // macOS and Windows match case-insensitively; Linux does not.
    expect(verdict).toBe(process.platform === 'darwin' || process.platform === 'win32' ? false : true);
  });
});

// --- describe ------------------------------------------------------------------------------------------

describe('describe', () => {
  it('D-1: lists the registry names with their input text plus the bridge ops', async () => {
    const bridge = makeBridge(emptyWorld());
    const body = await callJson(bridge, 'describe', {});
    expect(body.ok).toBe(true);
    const commands = body.commands as { readonly name: string; readonly input: string }[];
    const queries = body.queries as { readonly name: string; readonly input: string }[];
    expect(commands.map((row) => row.name)).toEqual(Object.keys(COMMAND_REGISTRY).sort());
    expect(queries.map((row) => row.name)).toEqual(Object.keys(QUERY_REGISTRY).sort());
    expect(commands.find((row) => row.name === 'permission.answer')?.input).toContain('askId');
    expect(body.ops).toEqual([...DEV_OPS]);
  });

  it('D-2: an unknown op is rejected, not guessed', async () => {
    const body = await callJson(makeBridge(emptyWorld()), 'events', {});
    expect(body.ok).toBe(false);
    expect(body.code).toBe('unknown_op');
  });
});

// --- events.since --------------------------------------------------------------------------------------

const seededRunEvents: readonly AgentEvent[] = [
  { type: 'session_started', at: 10, sessionRef: 'sess-1' },
  { type: 'usage', at: 20, inputTokens: 100, outputTokens: 40 },
  { type: 'text', at: 30, delta: 'CONFIDENTIAL-STREAM-DELTA' },
  { type: 'permission_ask', at: 40, id: 'ask-1', tool: 'bash', target: '/tmp/x', options: ['allow'] },
  { type: 'tool_result', at: 50, id: 'ask-1', ok: true },
  { type: 'finished', at: 60, reason: 'completed' },
];

const seededWorld = (): World => ({
  accounts: [account(ACCOUNT_ID)],
  bindings: [binding('worker')],
  orders: [wo(ORDER_ID)],
  orderEvents: [{ workOrderId: ORDER_ID, events: [created(5), runStarted(RUN_ID, 10), runFinished(RUN_ID, 61)] }],
  runs: [{ ...run(RUN_ID, ORDER_ID, 10, 61), outcome: 'succeeded' }],
  runEvents: [{ runId: RUN_ID, events: seededRunEvents }],
  audit: [
    auditEntry('01AUDIT0000000000000000002', 62, { kind: 'run', id: RUN_ID }),
    auditEntry('01AUDIT0000000000000000001', 55, { kind: 'work_order', id: ORDER_ID }),
  ],
});

describe('events.since', () => {
  it('E-1: merges the sources by time then source and numbers them gap-free', async () => {
    const bridge = makeBridge(seededWorld());
    bridge.pushUiEvent({ type: 'run.updated', runId: RUN_ID }, 15);
    const body = await callJson(bridge, 'events.since', {});
    expect(body.ok).toBe(true);
    const events = body.events as { readonly n: number; readonly at: EpochMs; readonly source: string; readonly type: string }[];
    // 1 ui + 6 run + 3 work-order + 2 audit rows.
    expect(events).toHaveLength(12);
    expect(events.map((row) => row.n)).toEqual(Array.from({ length: 12 }, (_, index) => index + 1));
    // Sorted by (at, source-rank): the two at=10 rows are run before work-order; the ui event at
    // 15 lands between the run rows at 10 and 20.
    const timeline = events.map((row) => `${row.source}:${row.type}@${row.at}`);
    expect(timeline.indexOf('docket-event:run.updated@15')).toBeGreaterThan(timeline.indexOf('run:session_started@10'));
    expect(timeline.indexOf('docket-event:run.updated@15')).toBeLessThan(timeline.indexOf('run:usage@20'));
    expect(timeline.indexOf('run:session_started@10')).toBeLessThan(timeline.indexOf('work-order:run_started@10'));
  });

  it('E-2: the continuation token continues gap-free across polls and pages', async () => {
    const bridge = makeBridge(seededWorld());
    bridge.pushUiEvent({ type: 'workOrders.changed' }, 70);
    const first = await callJson(bridge, 'events.since', { limit: 5 });
    expect((first.events as unknown[]).length).toBe(5);
    expect(first.after).toBe(5);
    const second = await callJson(bridge, 'events.since', { after: first.after as number });
    const secondEvents = second.events as { readonly n: number }[];
    expect(secondEvents.map((row) => row.n)).toEqual(
      Array.from({ length: secondEvents.length }, (_, index) => 6 + index),
    );
    expect(second.after).toBe(6 + secondEvents.length - 1);
    // A quiet re-poll moves nothing and returns the same token.
    const quiet = await callJson(bridge, 'events.since', { after: second.after as number });
    expect(quiet.events).toEqual([]);
    expect(quiet.after).toBe(second.after);
  });

  it('E-3: ordering is stable — the same world answers with the same sequence', async () => {
    const a = makeBridge(seededWorld());
    const b = makeBridge(seededWorld());
    a.pushUiEvent({ type: 'accounts.changed' }, 35);
    b.pushUiEvent({ type: 'accounts.changed' }, 35);
    const read = async (bridge: ReturnType<typeof makeBridge>) => {
      const body = await callJson(bridge, 'events.since', {});
      return (body.events as { readonly source: string; readonly type: string }[]).map((row) => `${row.source}:${row.type}`);
    };
    expect(await read(a)).toEqual(await read(b));
  });

  it('E-4: summaries never carry stream payloads', async () => {
    const bridge = makeBridge(seededWorld());
    bridge.pushUiEvent({ type: 'run.updated', runId: RUN_ID }, 15);
    const reply = await bridge.call('events.since', {});
    expect(reply.payload).not.toContain('CONFIDENTIAL-STREAM-DELTA');
    const body = JSON.parse(reply.payload) as { readonly events: { readonly summary: string }[] };
    for (const row of body.events) expect(row.summary.length).toBeLessThanOrEqual(200);
  });

  it('E-5: the limit is clamped to 500 and malformed pages are refused', async () => {
    const world = seededWorld();
    const many: readonly AgentEvent[] = Array.from({ length: 520 }, (_, index) => ({
      type: 'text',
      at: 1000 + index,
      delta: `chunk-${index}`,
    }));
    world.runEvents = [{ runId: RUN_ID, events: [...seededRunEvents, ...many] }];
    const bridge = makeBridge(world);
    const clamped = await callJson(bridge, 'events.since', { limit: 999 });
    expect((clamped.events as unknown[]).length).toBe(500);
    expect(await callJson(bridge, 'events.since', { after: -1 })).toMatchObject({ ok: false, code: 'bad_request' });
    expect(await callJson(bridge, 'events.since', { limit: 0 })).toMatchObject({ ok: false, code: 'bad_request' });
    expect(await callJson(bridge, 'events.since', { after: 'x' })).toMatchObject({ ok: false, code: 'bad_request' });
  });

  it('E-6: the ring keeps only the last 2000 ui events', async () => {
    const bridge = makeBridge(emptyWorld());
    for (let index = 0; index < DEV_RING_LIMIT + 50; index += 1) {
      bridge.pushUiEvent({ type: 'workOrders.changed' }, 100 + index);
    }
    // The page ceiling applies too, so the session  drains the log with the token.
    let after = 0;
    let uiRows = 0;
    for (;;) {
      const body = await callJson(bridge, 'events.since', { after });
      const rows = body.events as { readonly source: string }[];
      if (rows.length === 0) break;
      uiRows += rows.filter((row) => row.source === 'docket-event').length;
      after = body.after as number;
    }
    expect(uiRows).toBe(DEV_RING_LIMIT);
  });
});

// --- store.read ----------------------------------------------------------------------------------------

describe('store.read', () => {
  it('S-1: accounts carry the non-secret identity fields only', async () => {
    const bridge = makeBridge(seededWorld());
    const reply = await bridge.call('store.read', { name: 'accounts' });
    const body = JSON.parse(reply.payload) as { readonly ok: boolean; readonly rows: { id: string; label: string; routeKind: string; endpoint: string; state: string }[] };
    expect(body.ok).toBe(true);
    expect(body.rows).toHaveLength(1);
    expect(body.rows[0]).toMatchObject({ id: 'acct-1', routeKind: 'cli', endpoint: 'https://example.test/api', state: 'api_key' });
    expect(reply.payload).not.toContain('keychain-entry');
  });

  it('S-2: runs carry the record outcome and the folded token sums', async () => {
    const bridge = makeBridge(seededWorld());
    const body = await callJson(bridge, 'store.read', { name: 'runs' });
    const rows = body.rows as { readonly id: string; readonly outcome: string; readonly inputTokens: number; readonly outputTokens: number }[];
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ outcome: 'succeeded', inputTokens: 100, outputTokens: 40 });
  });

  it('S-3: open_asks lists the asks the store believes pending — closed asks are gone', async () => {
    const world = seededWorld();
    // A second, active run whose stream parks on an unanswered ask.
    const parked: RunId = '01RUN0000000000000000000002' as RunId;
    world.runs = [...world.runs, run(parked, ORDER_ID, 200)];
    world.runEvents = [
      ...world.runEvents,
      {
        runId: parked,
        events: [
          { type: 'session_started', at: 200, sessionRef: 'sess-2' },
          { type: 'permission_ask', at: 210, id: 'ask-2', tool: 'webfetch', options: ['allow'] },
        ] as readonly AgentEvent[],
      },
    ];
    world.orderEvents = [
      ...world.orderEvents.filter((entry) => entry.workOrderId !== ORDER_ID),
      { workOrderId: ORDER_ID, events: [created(5), runStarted(RUN_ID, 10), runStarted(parked, 200)] },
    ];
    const body = await callJson(makeBridge(world), 'store.read', { name: 'open_asks' });
    const rows = body.rows as { readonly runId: string; readonly askId: string; readonly tool: string; readonly at: EpochMs }[];
    // ask-1 closed by its tool_result; only ask-2 is pending.
    expect(rows.map((row) => row.askId)).toEqual(['ask-2']);
    expect(rows[0]).toMatchObject({ runId: parked, tool: 'webfetch', at: 210 });
  });

  it('S-4: work_orders carry the display number and the derived status', async () => {
    const world = seededWorld();
    // The event log leaves the run in flight, so the derived status is running.
    world.orderEvents = [{ workOrderId: ORDER_ID, events: [created(5), runStarted(RUN_ID, 10)] }];
    world.runEvents = [{ runId: RUN_ID, events: [{ type: 'session_started', at: 10, sessionRef: 's' }] }];
    const body = await callJson(makeBridge(world), 'store.read', { name: 'work_orders' });
    const rows = body.rows as { readonly id: string; readonly number: number; readonly status: string }[];
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ id: ORDER_ID, number: 1, status: 'running' });
  });

  it('S-5: bindings list their scope, role and account chain', async () => {
    const body = await callJson(makeBridge(seededWorld()), 'store.read', { name: 'bindings' });
    const rows = body.rows as { readonly role: string; readonly scope: { readonly level: string } }[];
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ role: 'worker', scope: { level: 'global' } });
  });

  it('S-6: any other name is rejected — including the secrets table by name', async () => {
    const bridge = makeBridge(seededWorld());
    expect(await callJson(bridge, 'store.read', { name: 'secrets' })).toMatchObject({ ok: false, code: 'unknown_store' });
    expect(await callJson(bridge, 'store.read', { name: 'audit' })).toMatchObject({ ok: false, code: 'unknown_store' });
    expect(await callJson(bridge, 'store.read', {})).toMatchObject({ ok: false, code: 'bad_request' });
    expect(await callJson(bridge, 'store.read')).toMatchObject({ ok: false, code: 'bad_request' });
  });
});

// --- invariants ----------------------------------------------------------------------------------------

describe('invariants (pure)', () => {
  type RunRow = Parameters<typeof inv1SucceededRunsCarryTokens>[0][number];
  const runRow = (over: Partial<RunRow>): RunRow =>
    ({
      id: '01RUN0000000000000000000099' as RunId,
      workOrderId: ORDER_ID,
      stage: 'work',
      role: 'worker',
      outcome: 'succeeded',
      startedAt: 10,
      endedAt: 60,
      inputTokens: 10,
      outputTokens: 5,
      openAskIds: [],
      ...over,
    }) as RunRow;

  it('I-1: a succeeded run with zero summed tokens fails, a costed one passes', () => {
    expect(inv1SucceededRunsCarryTokens([runRow({ inputTokens: 0, outputTokens: 0 })])).toMatchObject({ id: 'INV-1', ok: false });
    expect(inv1SucceededRunsCarryTokens([runRow({})])).toMatchObject({ id: 'INV-1', ok: true });
    // A run that never succeeded proves nothing and must not fail the invariant.
    expect(inv1SucceededRunsCarryTokens([runRow({ outcome: null })])).toMatchObject({ id: 'INV-1', ok: true });
  });

  it('I-2: accounts without a single binding fail; no accounts passes', () => {
    const accountRow = { id: 'acct-1' };
    expect(inv2AccountsHaveABinding([accountRow], [])).toMatchObject({ id: 'INV-2', ok: false });
    expect(inv2AccountsHaveABinding([accountRow], [{ role: 'worker' }])).toMatchObject({ id: 'INV-2', ok: true });
    expect(inv2AccountsHaveABinding([], [])).toMatchObject({ id: 'INV-2', ok: true });
  });

  it('I-3: an ended run that still holds an open ask fails', () => {
    expect(inv3EndedRunsHoldNoOpenAsk([runRow({ openAskIds: ['ask-9'] })])).toMatchObject({ id: 'INV-3', ok: false });
    expect(inv3EndedRunsHoldNoOpenAsk([runRow({})])).toMatchObject({ id: 'INV-3', ok: true });
    // An active run may legitimately wait on a human.
    expect(inv3EndedRunsHoldNoOpenAsk([runRow({ endedAt: null, openAskIds: ['ask-9'] })])).toMatchObject({ id: 'INV-3', ok: true });
  });

  it('I-4: a work order shown running without an active run fails', () => {
    const orderRow = { id: ORDER_ID, title: 't', status: 'running' };
    expect(inv4RunningOrdersHaveAnActiveRun([orderRow], [runRow({ endedAt: 60 })])).toMatchObject({ id: 'INV-4', ok: false });
    expect(inv4RunningOrdersHaveAnActiveRun([orderRow], [runRow({ endedAt: null })])).toMatchObject({ id: 'INV-4', ok: true });
    expect(inv4RunningOrdersHaveAnActiveRun([{ id: ORDER_ID, title: 't', status: 'done' }], [])).toMatchObject({ id: 'INV-4', ok: true });
  });
});

describe('invariants (through the op)', () => {
  const byId = (body: { readonly [key: string]: unknown }, id: string): boolean | undefined => {
    const results = body.results as readonly { readonly id: string; readonly ok: boolean }[] | undefined;
    return results?.find((row) => row.id === id)?.ok;
  };

  it('I-5: a consistent world answers all four ok', async () => {
    const body = await callJson(makeBridge(seededWorld()), 'invariants', {});
    expect(body.ok).toBe(true);
    const results = body.results as { readonly id: string; readonly ok: boolean }[];
    expect(results.map((row) => row.id)).toEqual(['INV-1', 'INV-2', 'INV-3', 'INV-4']);
    for (const row of results) expect(row.ok, row.id).toBe(true);
  });

  it('I-6: each violation surfaces on its own invariant', async () => {
    // INV-1: the record says succeeded but the stream never reported usage.
    const inv1World = seededWorld();
    inv1World.runEvents = [
      { runId: RUN_ID, events: [{ type: 'session_started', at: 10, sessionRef: 'sess-1' }, { type: 'finished', at: 60, reason: 'completed' }] },
    ];
    expect(byId(await callJson(makeBridge(inv1World), 'invariants', {}), 'INV-1')).toBe(false);

    // INV-2: an account with no binding at all.
    const inv2World = seededWorld();
    inv2World.bindings = [];
    expect(byId(await callJson(makeBridge(inv2World), 'invariants', {}), 'INV-2')).toBe(false);

    // INV-3: the run ended while its ask never closed.
    const inv3World = seededWorld();
    inv3World.runEvents = [
      {
        runId: RUN_ID,
        events: [
          { type: 'permission_ask', at: 40, id: 'ask-1', tool: 'bash', options: ['allow'] },
          { type: 'finished', at: 60, reason: 'failed' },
        ],
      },
    ];
    expect(byId(await callJson(makeBridge(inv3World), 'invariants', {}), 'INV-3')).toBe(false);

    // INV-4: the event log shows the run in flight while the run record ended.
    const inv4World = seededWorld();
    inv4World.orderEvents = [{ workOrderId: ORDER_ID, events: [created(5), runStarted(RUN_ID, 10)] }];
    expect(byId(await callJson(makeBridge(inv4World), 'invariants', {}), 'INV-4')).toBe(false);
  });
});

// --- the reply envelope --------------------------------------------------------------------------------

describe('the reply envelope', () => {
  it('T-1: a reply over 512 KB is cut and flagged, never silently huge', async () => {
    const world = seededWorld();
    world.orders = Array.from({ length: 3000 }, (_, index) => ({
      ...wo(`${'01WO'}${String(index).padStart(20, '0')}` as WorkOrderId, 5),
      title: `work order ${index} ${'x'.repeat(120)}`,
    }));
    const reply = await makeBridge(world).call('store.read', { name: 'work_orders' });
    expect(reply.truncated).toBe(true);
    expect(Buffer.byteLength(reply.payload, 'utf8')).toBeLessThanOrEqual(DEV_BRIDGE_MAX_BYTES);
    expect(reply.payload.startsWith('{"ok":true')).toBe(true);
  });

  it('T-2: no op output anywhere carries a secrets field or the secret reference value', async () => {
    const bridge = makeBridge(seededWorld());
    bridge.pushUiEvent({ type: 'workOrders.changed' }, 99);
    for (const [op, args] of [
      ['describe', {}],
      ['events.since', {}],
      ['store.read', { name: 'accounts' }],
      ['store.read', { name: 'runs' }],
      ['store.read', { name: 'open_asks' }],
      ['invariants', {}],
    ] as const) {
      const reply = await bridge.call(op, args);
      expect(reply.payload).not.toContain('keychain-entry');
      const keys = keysAnywhere(JSON.parse(reply.payload));
      expect(keys, `${op} keys`).not.toContain('secrets');
      expect(keys, `${op} keys`).not.toContain('secretRef');
    }
  });
});
