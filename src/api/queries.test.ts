// api/queries.test.ts — the read models behind createApi: the cockpit (A-22) and the workspace
// board (A-23), plus the workOrder.detail pass-through. Scenarios are seeded straight into the
// fakes; only the query under test goes through the api.
import { describe, expect, it } from 'vitest';

import type {
  Actor,
  AgentEvent,
  FlowSlug,
  GateSlug,
  RunId,
  RunOutcome,
  Slug,
  StageSlug,
  Ulid,
  WorkOrderEvent,
  WorkOrderId,
  WorkspaceSlug,
} from '../domain/index';
import { parseSlug, parseUlid } from '../domain/index';

import type { AppDeps, DiscoveredProvider, ProviderDiscovery, RunRecord } from '../application';
import { createFakeDefinitionStore, createFakeDeps } from '../application/ports/fakes';

import { createApi } from './api';
import type { BoardView, CockpitView, SettingsAccountsView } from './queries';

function slugOf<B extends string>(input: string): Slug<B> {
  const parsed = parseSlug<B>(input);
  if (!parsed.ok) throw new Error(`fixture slug must parse: ${input}`);
  return parsed.value;
}

function ulidOf<B extends string>(input: string): Ulid<B> {
  const parsed = parseUlid<B>(input);
  if (!parsed.ok) throw new Error(`fixture ulid must parse: ${input}`);
  return parsed.value;
}

const ACTOR: Actor = { kind: 'user', id: 'u-1' };

const WORKSPACE = slugOf<'workspace'>('acme');
const BROKEN_WORKSPACE = slugOf<'workspace'>('bozuk');
const ACCOUNT = ulidOf<'account'>('01ARZ3NDEKTSV4RRFFQ69G5FAZ');

const PLAN = slugOf<'stage'>('plan');
const IMPLEMENT = slugOf<'stage'>('implement');
const CLOSE = slugOf<'stage'>('close');
const PLAN_APPROVAL = slugOf<'gate'>('plan-approval');
const CLOSURE = slugOf<'gate'>('closure');

const BOARD_FLOW = slugOf<'flow'>('board-flow');
const SIDE_FLOW = slugOf<'flow'>('side-flow');
const SOLO_FLOW = slugOf<'flow'>('solo-flow');

const ROLE_JSON = {
  id: 'worker',
  name: 'Worker',
  instructions: 'Do the work.',
  writeScope: { kind: 'repo' },
  capabilities: [],
  active: true,
};

// The default flow the board is built from; side-flow and solo-flow exist to pin placement by
// stage id across flows (side-flow shares 'implement') and the no-column case (solo-flow does not).
const FLOWS_JSON = [
  {
    id: 'board-flow',
    name: 'Board Flow',
    stages: [
      {
        id: 'plan',
        name: 'Plan',
        role: 'worker',
        exit: [{ kind: 'human', id: 'plan-approval', label: 'Plan approval' }],
      },
      { id: 'implement', name: 'Implement', role: 'worker', exit: [] },
      { id: 'close', name: 'Close', role: null, exit: [{ kind: 'human', id: 'closure', label: 'Closure' }] },
    ],
  },
  {
    id: 'side-flow',
    name: 'Side Flow',
    stages: [{ id: 'implement', name: 'Implement', role: 'worker', exit: [] }],
  },
  {
    id: 'solo-flow',
    name: 'Solo Flow',
    stages: [{ id: 'solo', name: 'Solo', role: 'worker', exit: [] }],
  },
];

const DEFINITIONS_JSON = JSON.stringify({
  roles: [ROLE_JSON],
  flows: FLOWS_JSON,
  capabilities: [],
  workspace: {
    id: 'acme',
    name: 'Acme',
    repos: [],
    flows: ['board-flow', 'side-flow', 'solo-flow'],
    defaultFlow: 'board-flow',
    commandSets: {},
    roleOverrides: [],
    docsRoot: 'docs',
    testGlobs: [],
  },
});

interface Harness {
  readonly deps: AppDeps;
}

const createHarness = (): Harness => {
  const definitions = createFakeDefinitionStore();
  definitions.seed({ kind: 'workspace', workspace: WORKSPACE }, 'defs.json', DEFINITIONS_JSON);
  // A second workspace whose definitions no longer parse: its work orders must not break the
  // cockpit, they simply cannot be classified.
  definitions.seed({ kind: 'workspace', workspace: BROKEN_WORKSPACE }, 'defs.json', '{not json');
  return { deps: createFakeDeps({ definitions }) };
};

const seedWorkOrder = async (
  h: Harness,
  id: WorkOrderId,
  flow: FlowSlug,
  title: string,
  createdAt: number,
  workspace: WorkspaceSlug = WORKSPACE,
): Promise<void> => {
  await h.deps.workOrders.create({ id, workspace, flow, title, createdAt, createdBy: ACTOR });
  await h.deps.workOrders.appendEvent(id, { type: 'created', at: createdAt, by: ACTOR, flow });
};

const seedEvents = async (h: Harness, id: WorkOrderId, events: readonly WorkOrderEvent[]): Promise<void> => {
  for (const event of events) await h.deps.workOrders.appendEvent(id, event);
};

const seedRun = async (h: Harness, record: RunRecord, events: readonly AgentEvent[] = []): Promise<void> => {
  await h.deps.runs.create(record);
  if (events.length > 0) await h.deps.runs.appendEvents(record.id, events);
};

const runStarted = (at: number, runId: RunId, stage: StageSlug): WorkOrderEvent => ({
  type: 'run_started',
  at,
  runId,
  stage,
  attempt: 1,
});

const runFinished = (at: number, runId: RunId, outcome: RunOutcome): WorkOrderEvent => ({
  type: 'run_finished',
  at,
  runId,
  outcome,
});

const gatePassed = (at: number, stage: StageSlug, gate: GateSlug): WorkOrderEvent => ({
  type: 'gate_evaluated',
  at,
  stage,
  gate,
  verdict: { status: 'passed' },
});

const activeRun = (id: RunId, workOrderId: WorkOrderId, stage: StageSlug, startedAt: number): RunRecord => ({
  id,
  workOrderId,
  stage,
  attempt: 1,
  role: slugOf<'role'>('worker'),
  route: { accountId: ACCOUNT },
  startedAt,
  autoResumesUsed: 0,
});

// --- the cockpit scenario: every attention kind at once, plus the states that stay out ---------

const WO_ASK = ulidOf<'work-order'>('01ARZ3NDEKTSV4RRFFQ69G5FAV');
const WO_AWAIT_EARLY = ulidOf<'work-order'>('01ARZ3NDEKTSV4RRFFQ69G5FAW');
const WO_AWAIT_LATE = ulidOf<'work-order'>('01ARZ3NDEKTSV4RRFFQ69G5FAX');
const WO_BLOCKED = ulidOf<'work-order'>('01ARZ3NDEKTSV4RRFFQ69G5FAY');
const WO_LIMIT = ulidOf<'work-order'>('01ARZ3NDEKTSV4RRFFQ69G5FAZ');
const WO_RUNNING = ulidOf<'work-order'>('01ARZ3NDEKTSV4RRFFQ69G5FB1');
const WO_READY = ulidOf<'work-order'>('01ARZ3NDEKTSV4RRFFQ69G5FB2');
const WO_DONE = ulidOf<'work-order'>('01ARZ3NDEKTSV4RRFFQ69G5FB3');
const WO_ASK_ANSWERED = ulidOf<'work-order'>('01ARZ3NDEKTSV4RRFFQ69G5FB4');
const WO_BROKEN = ulidOf<'work-order'>('01ARZ3NDEKTSV4RRFFQ69G5FB5');

const RUN_ASK = ulidOf<'run'>('01ARZ3NDEKTSV4RRFFQ69G5H01');
const RUN_RUNNING = ulidOf<'run'>('01ARZ3NDEKTSV4RRFFQ69G5H02');
const RUN_ANSWERED = ulidOf<'run'>('01ARZ3NDEKTSV4RRFFQ69G5H03');
const RUN_EARLY = ulidOf<'run'>('01ARZ3NDEKTSV4RRFFQ69G5H11');
const RUN_LATE = ulidOf<'run'>('01ARZ3NDEKTSV4RRFFQ69G5H12');
const RUN_LIMIT = ulidOf<'run'>('01ARZ3NDEKTSV4RRFFQ69G5H13');

const seedCockpitScenario = async (h: Harness): Promise<Harness> => {
  await seedWorkOrder(h, WO_READY, BOARD_FLOW, 'Just ready', 100);

  await seedWorkOrder(h, WO_DONE, BOARD_FLOW, 'All finished', 200);
  await seedEvents(h, WO_DONE, [
    runStarted(250, RUN_EARLY, PLAN),
    runFinished(300, RUN_EARLY, 'succeeded'),
    gatePassed(350, PLAN, PLAN_APPROVAL),
    runStarted(400, RUN_LATE, IMPLEMENT),
    runFinished(450, RUN_LATE, 'succeeded'),
    gatePassed(500, CLOSE, CLOSURE),
  ]);

  await seedWorkOrder(h, WO_AWAIT_EARLY, BOARD_FLOW, 'Waiting early', 1_000);
  await seedEvents(h, WO_AWAIT_EARLY, [runStarted(1_100, RUN_EARLY, PLAN), runFinished(1_200, RUN_EARLY, 'succeeded')]);

  await seedWorkOrder(h, WO_LIMIT, BOARD_FLOW, 'Hit a limit', 1_500);
  await seedEvents(h, WO_LIMIT, [runStarted(1_600, RUN_LIMIT, PLAN), runFinished(2_000, RUN_LIMIT, 'limit')]);

  await seedWorkOrder(h, WO_AWAIT_LATE, BOARD_FLOW, 'Waiting late', 2_000);
  await seedEvents(h, WO_AWAIT_LATE, [runStarted(2_400, RUN_LATE, PLAN), runFinished(2_500, RUN_LATE, 'succeeded')]);

  await seedWorkOrder(h, WO_ASK, BOARD_FLOW, 'Waiting on a permission', 4_000);
  await seedEvents(h, WO_ASK, [runStarted(4_100, RUN_ASK, PLAN)]);
  await seedRun(h, activeRun(RUN_ASK, WO_ASK, PLAN, 4_000), [
    { type: 'permission_ask', at: 5_000, id: 'ask-1', tool: 'write', options: ['allow', 'deny'] },
  ]);

  await seedWorkOrder(h, WO_RUNNING, BOARD_FLOW, 'Busy running', 4_300);
  await seedEvents(h, WO_RUNNING, [runStarted(4_400, RUN_RUNNING, PLAN)]);
  await seedRun(h, activeRun(RUN_RUNNING, WO_RUNNING, PLAN, 4_500));

  await seedWorkOrder(h, WO_ASK_ANSWERED, BOARD_FLOW, 'Ask already answered', 5_000);
  await seedEvents(h, WO_ASK_ANSWERED, [runStarted(5_100, RUN_ANSWERED, PLAN)]);
  await seedRun(h, activeRun(RUN_ANSWERED, WO_ASK_ANSWERED, PLAN, 5_500), [
    { type: 'permission_ask', at: 5_200, id: 'ask-2', tool: 'write', options: ['allow', 'deny'] },
    { type: 'tool_result', at: 5_300, id: 'ask-2', ok: true },
  ]);

  await seedWorkOrder(h, WO_BLOCKED, BOARD_FLOW, 'Explicitly blocked', 9_700);
  await seedEvents(h, WO_BLOCKED, [{ type: 'blocked', at: 9_900, by: ACTOR, reason: 'waiting on upstream' }]);

  await seedWorkOrder(h, WO_BROKEN, BOARD_FLOW, 'Underivable state', 50, BROKEN_WORKSPACE);
  return h;
};

// --- the board scenario: one work order per position, plus the cross-flow cases ---------------

const WO_B_PLAN = ulidOf<'work-order'>('01ARZ3NDEKTSV4RRFFQ69G5GAV');
const WO_B_IMPL = ulidOf<'work-order'>('01ARZ3NDEKTSV4RRFFQ69G5GAW');
const WO_B_RUN = ulidOf<'work-order'>('01ARZ3NDEKTSV4RRFFQ69G5GAX');
const WO_B_SIDE = ulidOf<'work-order'>('01ARZ3NDEKTSV4RRFFQ69G5GAY');
const WO_B_SOLO = ulidOf<'work-order'>('01ARZ3NDEKTSV4RRFFQ69G5GAZ');
const WO_B_CLOSE = ulidOf<'work-order'>('01ARZ3NDEKTSV4RRFFQ69G5GB1');
const WO_B_DONE = ulidOf<'work-order'>('01ARZ3NDEKTSV4RRFFQ69G5GB2');

const RUN_B_RUN = ulidOf<'run'>('01ARZ3NDEKTSV4RRFFQ69G5H21');

const seedBoardScenario = async (h: Harness): Promise<Harness> => {
  await seedWorkOrder(h, WO_B_PLAN, BOARD_FLOW, 'Board plan', 100);
  await seedEvents(h, WO_B_PLAN, [runStarted(150, RUN_EARLY, PLAN), runFinished(200, RUN_EARLY, 'succeeded')]);

  await seedWorkOrder(h, WO_B_IMPL, BOARD_FLOW, 'At implement', 200);
  await seedEvents(h, WO_B_IMPL, [
    runStarted(250, RUN_LATE, PLAN),
    runFinished(300, RUN_LATE, 'succeeded'),
    gatePassed(350, PLAN, PLAN_APPROVAL),
  ]);

  await seedWorkOrder(h, WO_B_RUN, BOARD_FLOW, 'Still running', 300);
  await seedEvents(h, WO_B_RUN, [
    runStarted(350, RUN_LIMIT, PLAN),
    runFinished(400, RUN_LIMIT, 'succeeded'),
    gatePassed(450, PLAN, PLAN_APPROVAL),
    runStarted(500, RUN_B_RUN, IMPLEMENT),
  ]);
  await seedRun(h, activeRun(RUN_B_RUN, WO_B_RUN, IMPLEMENT, 500));

  await seedWorkOrder(h, WO_B_SIDE, SIDE_FLOW, 'Side entry', 400);
  await seedWorkOrder(h, WO_B_SOLO, SOLO_FLOW, 'Solo entry', 450);

  await seedWorkOrder(h, WO_B_CLOSE, BOARD_FLOW, 'At close', 500);
  await seedEvents(h, WO_B_CLOSE, [
    runStarted(550, RUN_EARLY, PLAN),
    runFinished(600, RUN_EARLY, 'succeeded'),
    gatePassed(650, PLAN, PLAN_APPROVAL),
    runStarted(700, RUN_LATE, IMPLEMENT),
    runFinished(750, RUN_LATE, 'succeeded'),
  ]);

  await seedWorkOrder(h, WO_B_DONE, BOARD_FLOW, 'Finished', 600);
  await seedEvents(h, WO_B_DONE, [
    runStarted(650, RUN_EARLY, PLAN),
    runFinished(700, RUN_EARLY, 'succeeded'),
    gatePassed(750, PLAN, PLAN_APPROVAL),
    runStarted(800, RUN_LATE, IMPLEMENT),
    runFinished(850, RUN_LATE, 'succeeded'),
    gatePassed(900, CLOSE, CLOSURE),
  ]);
  return h;
};

// --- the tests ---------------------------------------------------------------------------------------

describe('cockpit', () => {
  it('A-22: attention is ordered by kind (permission_ask, awaiting_human, blocked, limit_waiting), then since ascending', async () => {
    const h = await seedCockpitScenario(createHarness());
    const view = (await createApi(h.deps).query({ type: 'cockpit' })) as CockpitView;

    expect(view.attention.map((item) => item.workOrderId)).toEqual([
      WO_ASK,
      WO_AWAIT_EARLY,
      WO_AWAIT_LATE,
      WO_BLOCKED,
      WO_LIMIT,
    ]);
    expect(view.attention[0]).toEqual({
      workOrderId: WO_ASK,
      workspace: 'acme',
      title: 'Waiting on a permission',
      kind: 'permission_ask',
      stage: 'plan',
      since: 5_000,
    });
    // The two awaiting_human items keep since-ascending order among themselves, and kind outranks
    // since: the blocked item (since 9_900) still precedes the limit_waiting one (since 2_000).
    expect(view.attention.map((item) => [item.kind, item.since])).toEqual([
      ['permission_ask', 5_000],
      ['awaiting_human', 1_200],
      ['awaiting_human', 2_500],
      ['blocked', 9_900],
      ['limit_waiting', 2_000],
    ]);
  });

  it('A-22: only attention-worthy work orders are listed; active runs are reported separately', async () => {
    const h = await seedCockpitScenario(createHarness());
    const view = (await createApi(h.deps).query({ type: 'cockpit' })) as CockpitView;

    // ready, running, done, an answered ask and an underivable workspace all stay out of attention.
    const listed = view.attention.map((item) => item.workOrderId);
    expect(listed).not.toContain(WO_READY);
    expect(listed).not.toContain(WO_RUNNING);
    expect(listed).not.toContain(WO_DONE);
    expect(listed).not.toContain(WO_ASK_ANSWERED);
    expect(listed).not.toContain(WO_BROKEN);

    expect(view.running).toEqual([
      { workOrderId: WO_ASK, stage: 'plan', accountId: ACCOUNT, startedAt: 4_000 },
      { workOrderId: WO_RUNNING, stage: 'plan', accountId: ACCOUNT, startedAt: 4_500 },
      { workOrderId: WO_ASK_ANSWERED, stage: 'plan', accountId: ACCOUNT, startedAt: 5_500 },
    ]);
  });
});

describe('workspace.board', () => {
  it('A-23: has one column per stage of the workspace default flow, in flow order', async () => {
    const h = await seedBoardScenario(createHarness());
    const view = (await createApi(h.deps).query({ type: 'workspace.board', workspace: 'acme' })) as BoardView;

    expect(view.workspace).toBe('acme');
    expect(view.flow).toBe('board-flow');
    expect(view.columns.map((column) => [column.stage, column.name])).toEqual([
      ['plan', 'Plan'],
      ['implement', 'Implement'],
      ['close', 'Close'],
    ]);
  });

  it('A-23: each work order sits in the column of its current stage and done work orders go to done', async () => {
    const h = await seedBoardScenario(createHarness());
    const view = (await createApi(h.deps).query({ type: 'workspace.board', workspace: 'acme' })) as BoardView;

    expect(view.columns[0]?.workOrders).toEqual([{ id: WO_B_PLAN, title: 'Board plan', status: 'awaiting_human' }]);
    expect(view.columns[1]?.workOrders).toEqual([
      { id: WO_B_IMPL, title: 'At implement', status: 'ready' },
      { id: WO_B_RUN, title: 'Still running', status: 'running' },
      { id: WO_B_SIDE, title: 'Side entry', status: 'ready' },
    ]);
    expect(view.columns[2]?.workOrders).toEqual([{ id: WO_B_CLOSE, title: 'At close', status: 'awaiting_human' }]);
    expect(view.done).toEqual([{ id: WO_B_DONE, title: 'Finished' }]);

    // A stage the default flow does not have cannot place its work order anywhere on this board.
    const shown = [
      ...view.columns.flatMap((column) => column.workOrders.map((item) => item.id)),
      ...view.done.map((item) => item.id),
    ];
    expect(shown).not.toContain(WO_B_SOLO);
  });

  it('returns invalid_id for a workspace that is not a slug', async () => {
    const h = createHarness();

    const result = await createApi(h.deps).query({ type: 'workspace.board', workspace: 'Acme' });

    expect(result).toEqual({ ok: false, code: 'invalid_id' });
  });

  it('returns definitions_invalid when the workspace has no loadable definitions', async () => {
    const h = createHarness();

    const result = await createApi(h.deps).query({ type: 'workspace.board', workspace: 'lonely' });

    expect(result).toEqual({ ok: false, code: 'definitions_invalid' });
  });
});

describe('workOrder.detail', () => {
  it('returns the derived view of a known work order', async () => {
    const h = await seedCockpitScenario(createHarness());

    const result = await createApi(h.deps).query({ type: 'workOrder.detail', id: WO_AWAIT_EARLY });

    expect(result).toMatchObject({
      record: { id: WO_AWAIT_EARLY, workspace: 'acme', flow: 'board-flow', title: 'Waiting early' },
      state: { status: 'awaiting_human', stage: 'plan', attempt: 1, pendingGates: ['plan-approval'] },
      next: { kind: 'await_human', stage: 'plan', gates: ['plan-approval'] },
      runs: [],
    });
  });

  it('returns not_found for an unknown id', async () => {
    const h = createHarness();

    const result = await createApi(h.deps).query({ type: 'workOrder.detail', id: '01ARZ3NDEKTSV4RRFFQ69G5FZZ' });

    expect(result).toEqual({ ok: false, code: 'not_found' });
  });

  it('returns invalid_id for an unparseable id', async () => {
    const h = createHarness();

    const result = await createApi(h.deps).query({ type: 'workOrder.detail', id: 'nope' });

    expect(result).toEqual({ ok: false, code: 'invalid_id' });
  });
});

// --- settings.accounts and providers.discovered (U-13) ----------------------------------------------

const ACCOUNT_OTHER = ulidOf<'account'>('01ARZ3NDEKTSV4RRFFQ69G5FB8');
const POOL = ulidOf<'pool'>('01ARZ3NDEKTSV4RRFFQ69G5FC1');
const METER_WINDOW = ulidOf<'meter'>('01ARZ3NDEKTSV4RRFFQ69G5FC2');
const METER_USD = ulidOf<'meter'>('01ARZ3NDEKTSV4RRFFQ69G5FC3');

/** Everything the settings surface lists: one full account, one bare account, bindings per level. */
const seedSettingsScenario = async (h: Harness): Promise<void> => {
  await h.deps.accounts.save({
    id: ACCOUNT,
    provider: 'acme-prov',
    label: 'Main',
    authMode: 'subscription',
    plan: 'pro',
    limitPolicy: 'wait_resume',
    caps: [],
  });
  await h.deps.accounts.save({
    id: ACCOUNT_OTHER,
    provider: 'beta-prov',
    label: 'Spare',
    authMode: 'api_key',
    limitPolicy: 'ask',
    caps: [],
  });
  await h.deps.accounts.savePools(ACCOUNT, [
    { id: POOL, accountId: ACCOUNT, label: 'Weekly allowance', kind: 'allowance', appliesTo: 'all' },
  ]);
  await h.deps.accounts.saveMeter({
    id: METER_WINDOW,
    poolId: POOL,
    label: 'Prompts',
    cadence: 'rolling_from_first_use',
    durationMs: 604_800_000,
    unit: 'prompts',
    used: 40,
    limit: 100,
    remaining: 60,
    resetsAt: 9_000,
    resetPrecision: 'exact',
    observedAt: 8_000,
    source: 'polled',
  });
  // The bare meter pins the null-normalisation: every absent optional reads null, not undefined.
  await h.deps.accounts.saveMeter({
    id: METER_USD,
    poolId: POOL,
    cadence: 'none',
    unit: 'usd',
    resetPrecision: 'unknown',
    observedAt: 8_500,
    source: 'pushed',
  });
  await h.deps.bindings.save(
    { level: 'global' },
    { role: slugOf<'role'>('worker'), accounts: [{ accountId: ACCOUNT, model: 'atlas-max' }] },
  );
  await h.deps.bindings.save(
    { level: 'workspace', workspace: WORKSPACE },
    { role: slugOf<'role'>('reviewer'), accounts: [{ accountId: ACCOUNT_OTHER }, { accountId: ACCOUNT }] },
  );
  await h.deps.bindings.save(
    { level: 'workOrder', workOrderId: WO_AWAIT_EARLY },
    { role: slugOf<'role'>('worker'), accounts: [{ accountId: ACCOUNT_OTHER }] },
  );
};

describe('settings.accounts', () => {
  it('U-13: returns every account with its pools and meters plus the per-role binding chains', async () => {
    const h = createHarness();
    await seedSettingsScenario(h);

    const view = (await createApi(h.deps).query({ type: 'settings.accounts' })) as SettingsAccountsView;

    expect(view.accounts).toEqual([
      {
        id: ACCOUNT,
        provider: 'acme-prov',
        label: 'Main',
        authMode: 'subscription',
        plan: 'pro',
        pools: [{ id: POOL, label: 'Weekly allowance', kind: 'allowance', appliesTo: 'all' }],
        meters: [
          {
            id: METER_WINDOW,
            poolId: POOL,
            label: 'Prompts',
            cadence: 'rolling_from_first_use',
            durationMs: 604_800_000,
            unit: 'prompts',
            used: 40,
            limit: 100,
            remaining: 60,
            resetsAt: 9_000,
            resetPrecision: 'exact',
            observedAt: 8_000,
            source: 'polled',
            staleAfterMs: null,
          },
          {
            id: METER_USD,
            poolId: POOL,
            label: null,
            cadence: 'none',
            durationMs: null,
            unit: 'usd',
            used: null,
            limit: null,
            remaining: null,
            resetsAt: null,
            resetPrecision: 'unknown',
            observedAt: 8_500,
            source: 'pushed',
            staleAfterMs: null,
          },
        ],
      },
      {
        id: ACCOUNT_OTHER,
        provider: 'beta-prov',
        label: 'Spare',
        authMode: 'api_key',
        plan: null,
        pools: [],
        meters: [],
      },
    ]);
    expect(view.bindings).toEqual([
      { scope: { level: 'global' }, role: 'worker', accounts: [{ accountId: ACCOUNT, model: 'atlas-max' }] },
      {
        scope: { level: 'workspace', workspace: WORKSPACE },
        role: 'reviewer',
        accounts: [
          { accountId: ACCOUNT_OTHER, model: null },
          { accountId: ACCOUNT, model: null },
        ],
      },
      {
        scope: { level: 'workOrder', workOrderId: WO_AWAIT_EARLY },
        role: 'worker',
        accounts: [{ accountId: ACCOUNT_OTHER, model: null }],
      },
    ]);
  });

  it('U-13: an empty store yields empty account and binding lists', async () => {
    const h = createHarness();

    const view = (await createApi(h.deps).query({ type: 'settings.accounts' })) as SettingsAccountsView;

    expect(view).toEqual({ accounts: [], bindings: [] });
  });
});

/** A discovery pass the test drives by hand: results are held back until the pass is ended. */
const createScriptedDiscovery = (
  results: readonly DiscoveredProvider[],
): { readonly discovery: ProviderDiscovery; readonly passes: () => number; readonly endPass: () => void } => {
  let passes = 0;
  let endPass: () => void = () => {};
  const discovery: ProviderDiscovery = {
    discover: (onResult) =>
      new Promise<void>((resolve) => {
        passes += 1;
        endPass = () => {
          for (const result of results) onResult(result);
          resolve();
        };
      }),
  };
  return { discovery, passes: () => passes, endPass: () => endPass() };
};

const drainMicrotasks = async (): Promise<void> => {
  for (let i = 0; i < 5; i += 1) await Promise.resolve();
};

describe('providers.discovered', () => {
  it('U-13: kicks one pass per query and resolves only when the pass ends', async () => {
    const h = createHarness();
    const script = createScriptedDiscovery([
      { defId: 'alpha', binPath: '/usr/local/bin/alpha', version: '1.2.3', loggedIn: true, optionalFlags: ['--fast'] },
    ]);
    const api = createApi(h.deps, undefined, script.discovery);

    const pending = api.query({ type: 'providers.discovered' });
    let settled: boolean = false;
    void pending.then(() => {
      settled = true;
    });
    await drainMicrotasks();

    // The pass is still running: no result is reported before it ends.
    expect(settled).toBe(false);
    expect(script.passes()).toBe(1);

    script.endPass();
    expect(await pending).toEqual([
      { defId: 'alpha', binPath: '/usr/local/bin/alpha', version: '1.2.3', loggedIn: true, optionalFlags: ['--fast'] },
    ]);
    // One query, one pass: answering does not kick another.
    expect(script.passes()).toBe(1);
  });

  it('U-13: per-provider failures are null fields in the rows, not query failures', async () => {
    const h = createHarness();
    const script = createScriptedDiscovery([
      { defId: 'alpha', binPath: '/usr/local/bin/alpha', version: '1.2.3', loggedIn: true, optionalFlags: [] },
      { defId: 'beta', binPath: null, version: null, loggedIn: null, optionalFlags: [] },
    ]);
    const api = createApi(h.deps, undefined, script.discovery);

    const first = api.query({ type: 'providers.discovered' });
    script.endPass();
    expect(await first).toEqual([
      { defId: 'alpha', binPath: '/usr/local/bin/alpha', version: '1.2.3', loggedIn: true, optionalFlags: [] },
      { defId: 'beta', binPath: null, version: null, loggedIn: null, optionalFlags: [] },
    ]);

    // Every query kicks a fresh pass.
    const second = api.query({ type: 'providers.discovered' });
    script.endPass();
    await second;
    expect(script.passes()).toBe(2);
  });

  it('U-13: without a discovery port the query reports not_found instead of throwing', async () => {
    const h = createHarness();

    expect(await createApi(h.deps).query({ type: 'providers.discovered' })).toEqual({ ok: false, code: 'not_found' });
  });
});
