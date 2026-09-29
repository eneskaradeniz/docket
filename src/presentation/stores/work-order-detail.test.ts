// work-order-detail.test.ts — U-4: the detail store derives the per-stage gate list with
// human-readable states, exposes a deploy gate's environment/protection/promoteFrom chain
// (E-5, read-only), and gates the approve intent on the typed environment confirmation (E-8:
// the input must equal the environment name before deploy.approve is issued — wrong or absent
// never fires). Every intent maps its CommandResult through results.ts (U-8) and refreshes the
// detail query. The asks section is fed from `permissions.open`, scoped to the loaded work
// order's runs, and the live pane mounts on the work order's newest active run. The flow and
// the environments ride the detail view itself; api, change signal and pane are injected fakes.
import { describe, expect, it } from 'vitest';

import type { Api } from '../../api/api';
import type { Command, CommandResult } from '../../api/commands';
import type { Query } from '../../api/queries';
import type {
  Actor,
  EnvironmentDef,
  FlowDef,
  FlowAction,
  GateSlug,
  RunOutcome,
  Slug,
  StageSlug,
  WorkOrderState,
} from '../../domain/index';
import { parseSlug } from '../../domain/index';

import type { LivePaneStore } from './live-pane';
import {
  createWorkOrderDetailStore,
  type DetailChange,
  type DetailChangeSignal,
  type WorkOrderDetailRun,
  type WorkOrderDetailView,
} from './work-order-detail';

function slugOf<B extends string>(input: string): Slug<B> {
  const parsed = parseSlug<B>(input);
  if (!parsed.ok) throw new Error(`fixture slug must parse: ${input}`);
  return parsed.value;
}

const ACTOR: Actor = { kind: 'user', id: 'u-1' };
const WO_ID = '01ARZ3NDEKTSV4RRFFQ69G5FZZ';
const RUN_ID = '01ARZ3NDEKTSV4RRFFQ69G5FA0';
const ACTIVE_RUN_ID = '01ARZ3NDEKTSV4RRFFQ69G5FB1';

const STAGE_PLAN = slugOf<'stage'>('plan');
const STAGE_BUILD = slugOf<'stage'>('build');
const STAGE_SHIP = slugOf<'stage'>('ship');
const GATE_PLAN_APPROVAL = slugOf<'gate'>('plan-approval');
const GATE_SECRET_SCAN = slugOf<'gate'>('secret-scan');
const GATE_SHIP_APPROVAL = slugOf<'gate'>('ship-approval');
const GATE_DEPLOY_PROD = slugOf<'gate'>('deploy-prod');
const GATE_DEPLOY_STAGING = slugOf<'gate'>('deploy-staging');
const ENV_DEV = slugOf<'env'>('dev');
const ENV_STAGING = slugOf<'env'>('staging');
const ENV_PROD = slugOf<'env'>('prod');

/** A release flow whose ship stage carries an unprotected and a protected deploy gate. */
const FLOW: FlowDef = {
  id: slugOf<'flow'>('release-flow'),
  name: 'Release Flow',
  stages: [
    {
      id: STAGE_PLAN,
      name: 'Plan',
      role: null,
      exit: [{ kind: 'human', id: GATE_PLAN_APPROVAL, label: 'Plan approval' }],
    },
    {
      id: STAGE_BUILD,
      name: 'Build',
      role: slugOf<'role'>('builder'),
      exit: [{ kind: 'secret_scan', id: GATE_SECRET_SCAN }],
    },
    {
      id: STAGE_SHIP,
      name: 'Ship',
      role: null,
      exit: [
        { kind: 'human', id: GATE_SHIP_APPROVAL, label: 'Ship approval' },
        { kind: 'deploy', id: GATE_DEPLOY_PROD, environment: ENV_PROD },
        { kind: 'deploy', id: GATE_DEPLOY_STAGING, environment: ENV_STAGING },
      ],
    },
  ],
};

/** dev ← staging ← prod: the protected prod environment promotes through staging, which promotes through dev (E-5). */
const ENVIRONMENTS: readonly EnvironmentDef[] = [
  { id: ENV_DEV, name: 'Dev', order: 1, deploy: 'deploy-dev', env: {}, protected: false },
  { id: ENV_STAGING, name: 'Staging', order: 2, deploy: 'deploy-staging', env: {}, protected: false, promoteFrom: ENV_DEV },
  { id: ENV_PROD, name: 'Prod', order: 3, deploy: 'deploy-prod', env: {}, protected: true, promoteFrom: ENV_STAGING },
];

const NONE: FlowAction = { kind: 'none' };

const stateAt = (stage: StageSlug, pending: readonly GateSlug[]): WorkOrderState => ({
  status: 'gating', // a pending deploy gate is a machine gate, so the stage is gating
  stage,
  attempt: 1,
  pendingGates: pending,
});

const AT_BUILD = stateAt(STAGE_BUILD, [GATE_SECRET_SCAN]);
const AT_SHIP = stateAt(STAGE_SHIP, [GATE_SHIP_APPROVAL, GATE_DEPLOY_PROD, GATE_DEPLOY_STAGING]);
const DONE: WorkOrderState = { status: 'done', stage: null, attempt: 1, pendingGates: [] };

const detailReply = (state: WorkOrderState): WorkOrderDetailView => ({
  record: { id: WO_ID, repo: 'atolye', flow: 'release-flow', title: 'Ship the thing' },
  state,
  next: NONE,
  runs: [
    {
      id: RUN_ID,
      stage: 'build',
      startedAt: 1_000,
      endedAt: 2_000,
      outcome: 'succeeded' satisfies RunOutcome,
    },
  ],
  // The flow definition and the environments arrive inside the view, so the store needs no
  // definitions loader of its own.
  flow: FLOW,
  environments: ENVIRONMENTS,
});

const detailReplyWithRuns = (state: WorkOrderState, runs: readonly WorkOrderDetailRun[]): WorkOrderDetailView => ({
  ...detailReply(state),
  runs,
});

interface FakeApi extends Pick<Api, 'query' | 'command'> {
  readonly queries: Query[];
  readonly commands: Command[];
  setReply(reply: unknown): void;
  setAsks(reply: unknown): void;
  setCommandResult(result: CommandResult): void;
}

/** The detail query and the open-asks query are answered separately; both calls are recorded. */
const fakeApi = (initialReply: unknown): FakeApi => {
  const queries: Query[] = [];
  const commands: Command[] = [];
  let reply: unknown = initialReply;
  let asksReply: unknown = [];
  let commandResult: CommandResult = { ok: true };
  return {
    queries,
    commands,
    setReply: (next) => {
      reply = next;
    },
    setAsks: (next) => {
      asksReply = next;
    },
    setCommandResult: (next) => {
      commandResult = next;
    },
    query: (query) => {
      queries.push(query);
      return Promise.resolve(query.type === 'permissions.open' ? asksReply : reply);
    },
    command: (_actor, command) => {
      commands.push(command);
      return Promise.resolve(commandResult);
    },
  };
};

interface FakeSignal {
  readonly signal: DetailChangeSignal;
  emit(change: DetailChange): void;
}

const fakeSignal = (): FakeSignal => {
  const listeners: ((change: DetailChange) => void)[] = [];
  return {
    signal: (listener) => {
      listeners.push(listener);
      return () => {
        const at = listeners.indexOf(listener);
        if (at >= 0) listeners.splice(at, 1);
      };
    },
    emit: (change) => {
      for (const listener of [...listeners]) listener(change);
    },
  };
};

/** Lets the store's fire-and-forget change reload finish before assertions read the state. */
const flush = (): Promise<void> => new Promise((resolve) => {
  setTimeout(resolve, 0);
});

interface FakePane extends LivePaneStore {
  readonly attached: readonly string[];
}

/** Records every attach so tests can pin which run the store mounts the pane for. */
const fakePane = (): FakePane => {
  const attached: string[] = [];
  let runId: string | null = null;
  return {
    attached,
    push: () => {},
    state: () => ({ runId, items: [], ask: null, ended: false }),
    answer: () => Promise.resolve({ ok: false, code: 'not_found' }),
    subscribe: () => () => {},
    attach: (id) => {
      attached.push(id);
      runId = id;
      return Promise.resolve();
    },
  };
};

const createStore = (api: FakeApi, signal: FakeSignal = fakeSignal(), pane: FakePane = fakePane()) =>
  createWorkOrderDetailStore({
    api,
    changes: signal.signal,
    actor: ACTOR,
    pane,
  });

describe('work-order detail store', () => {
  it('U-4: the store derives the per-stage gate list with human-readable states', async () => {
    const api = fakeApi(detailReply(AT_BUILD));
    const store = createStore(api);

    expect(store.state()).toEqual({
      loading: false,
      view: null,
      stages: [],
      asks: [],
      problem: null,
      lastOutcome: null,
    });
    const loading = store.load(WO_ID);
    expect(store.state().loading).toBe(true);
    await loading;

    expect(api.queries[0]).toEqual({ type: 'workOrder.detail', id: WO_ID });
    // Before the ship stage is reached its gates — deploy gates included — are upcoming.
    expect(store.state().stages).toEqual([
      { stage: 'plan', name: 'Plan', current: false, gates: [{ id: 'plan-approval', kind: 'human', status: 'passed' }] },
      { stage: 'build', name: 'Build', current: true, gates: [{ id: 'secret-scan', kind: 'secret_scan', status: 'pending' }] },
      {
        stage: 'ship',
        name: 'Ship',
        current: false,
        gates: [
          { id: 'ship-approval', kind: 'human', status: 'upcoming' },
          { id: 'deploy-prod', kind: 'deploy', status: 'upcoming', deploy: { environment: 'prod', protectedEnvironment: true, promoteFromChain: ['staging', 'dev'] } },
          { id: 'deploy-staging', kind: 'deploy', status: 'upcoming', deploy: { environment: 'staging', protectedEnvironment: false, promoteFromChain: ['dev'] } },
        ],
      },
    ]);

    api.setReply(detailReply(AT_SHIP));
    await store.load(WO_ID);
    expect(store.state().stages).toEqual([
      { stage: 'plan', name: 'Plan', current: false, gates: [{ id: 'plan-approval', kind: 'human', status: 'passed' }] },
      { stage: 'build', name: 'Build', current: false, gates: [{ id: 'secret-scan', kind: 'secret_scan', status: 'passed' }] },
      {
        stage: 'ship',
        name: 'Ship',
        current: true,
        gates: [
          { id: 'ship-approval', kind: 'human', status: 'pending' },
          { id: 'deploy-prod', kind: 'deploy', status: 'pending', deploy: { environment: 'prod', protectedEnvironment: true, promoteFromChain: ['staging', 'dev'] } },
          { id: 'deploy-staging', kind: 'deploy', status: 'pending', deploy: { environment: 'staging', protectedEnvironment: false, promoteFromChain: ['dev'] } },
        ],
      },
    ]);
  });

  it('U-4: a deploy gate exposes its environment, protection and the read-only promoteFrom chain', async () => {
    const store = createStore(fakeApi(detailReply(AT_SHIP)));
    await store.load(WO_ID);

    const ship = store.state().stages.find((stage) => stage.stage === 'ship');
    expect(ship).toBeDefined();
    const gates = ship?.gates.filter((gate) => gate.kind === 'deploy') ?? [];
    expect(gates.map((gate) => gate.deploy)).toEqual([
      { environment: 'prod', protectedEnvironment: true, promoteFromChain: ['staging', 'dev'] },
      { environment: 'staging', protectedEnvironment: false, promoteFromChain: ['dev'] },
    ]);
  });

  it('U-4: a protected deploy gate with a wrong typed confirmation never fires the approve intent', async () => {
    const api = fakeApi(detailReply(AT_SHIP));
    const store = createStore(api);
    await store.load(WO_ID);

    const outcome = await store.approveDeploy({ gate: 'deploy-prod', commit: 'abc123', confirmedEnvironment: 'production' });

    // The command is never issued and nothing could have changed, so no refresh follows.
    expect(api.commands).toEqual([]);
    expect(api.queries.filter((query) => query.type === 'workOrder.detail')).toHaveLength(1);
    expect(outcome).toEqual({
      command: 'deploy.approve',
      result: { ok: false, code: 'confirmation_mismatch' },
      labelKey: 'error.confirmation_mismatch',
    });
    expect(store.state().lastOutcome).toEqual(outcome);
  });

  it('U-4: a protected deploy gate with an absent confirmation never fires the approve intent', async () => {
    const api = fakeApi(detailReply(AT_SHIP));
    const store = createStore(api);
    await store.load(WO_ID);

    const outcome = await store.approveDeploy({ gate: 'deploy-prod', commit: 'abc123' });

    expect(api.commands).toEqual([]);
    expect(api.queries.filter((query) => query.type === 'workOrder.detail')).toHaveLength(1);
    expect(outcome.result).toEqual({ ok: false, code: 'confirmation_mismatch' });
    expect(outcome.labelKey).toBe('error.confirmation_mismatch');
  });

  it('U-4: a matching typed confirmation fires deploy.approve verbatim and refreshes the detail query', async () => {
    const api = fakeApi(detailReply(AT_SHIP));
    const store = createStore(api);
    await store.load(WO_ID);

    const outcome = await store.approveDeploy({ gate: 'deploy-prod', commit: 'abc123', confirmedEnvironment: 'prod' });

    expect(api.commands).toEqual([
      { type: 'deploy.approve', workOrderId: WO_ID, gate: 'deploy-prod', commit: 'abc123', confirmedEnvironment: 'prod' },
    ]);
    expect(api.queries.filter((query) => query.type === 'workOrder.detail')).toHaveLength(2); // the intent refreshes the detail query
    expect(outcome).toEqual({ command: 'deploy.approve', result: { ok: true }, labelKey: 'success.deploy.approve' });
  });

  it('U-4: an unprotected deploy gate approves without a typed confirmation', async () => {
    const api = fakeApi(detailReply(AT_SHIP));
    const store = createStore(api);
    await store.load(WO_ID);

    const outcome = await store.approveDeploy({ gate: 'deploy-staging', commit: 'abc123' });

    expect(api.commands).toEqual([
      { type: 'deploy.approve', workOrderId: WO_ID, gate: 'deploy-staging', commit: 'abc123' },
    ]);
    expect(outcome.result.ok).toBe(true);
    expect(outcome.labelKey).toBe('success.deploy.approve');
  });

  it('U-4: gate decisions are intents mapped through U-8 that refresh the detail query', async () => {
    const api = fakeApi(detailReply(AT_SHIP));
    const store = createStore(api);
    await store.load(WO_ID);

    const approved = await store.decideGate({ gate: 'ship-approval', decision: 'approved', note: 'looks good' });
    expect(api.commands).toEqual([
      { type: 'gate.decide', workOrderId: WO_ID, gate: 'ship-approval', decision: 'approved', note: 'looks good' },
    ]);
    expect(api.queries.filter((query) => query.type === 'workOrder.detail')).toHaveLength(2);
    expect(approved).toEqual({ command: 'gate.decide', result: { ok: true }, labelKey: 'success.gate.decide' });

    api.setCommandResult({ ok: false, code: 'not_pending' });
    const rejected = await store.decideGate({ gate: 'ship-approval', decision: 'rejected' });
    expect(rejected).toEqual({
      command: 'gate.decide',
      result: { ok: false, code: 'not_pending' },
      labelKey: 'error.not_pending',
    });
    expect(store.state().lastOutcome).toEqual(rejected);
  });

  it('U-4: a stage enqueue is an intent mapped through U-8 that refreshes the detail query', async () => {
    const api = fakeApi(detailReply(AT_BUILD));
    const store = createStore(api);
    await store.load(WO_ID);

    const outcome = await store.enqueue();

    expect(api.commands).toEqual([{ type: 'workOrder.enqueue', id: WO_ID }]);
    expect(api.queries.filter((query) => query.type === 'workOrder.detail')).toHaveLength(2);
    expect(outcome).toEqual({ command: 'workOrder.enqueue', result: { ok: true }, labelKey: 'success.workOrder.enqueue' });
  });

  it('U-4: a permission answer is an intent mapped through U-8 that refreshes the detail query', async () => {
    const api = fakeApi(detailReply(AT_BUILD));
    const store = createStore(api);
    await store.load(WO_ID);

    const outcome = await store.answerPermission({ runId: RUN_ID, askId: 'ask-1', decision: 'allow' });

    expect(api.commands).toEqual([
      { type: 'permission.answer', runId: RUN_ID, askId: 'ask-1', decision: 'allow' },
    ]);
    expect(api.queries.filter((query) => query.type === 'workOrder.detail')).toHaveLength(2);
    expect(outcome).toEqual({ command: 'permission.answer', result: { ok: true }, labelKey: 'success.permission.answer' });
  });

  it('U-4: a failed query keeps the previous view and stages, and exposes the problem', async () => {
    const good = detailReply(AT_SHIP);
    const api = fakeApi(good);
    const store = createStore(api);
    await store.load(WO_ID);

    api.setReply({ ok: false, code: 'not_found' });
    await store.load(WO_ID);
    const failed = store.state();
    expect(failed.problem).toBe('not_found');
    expect(failed.loading).toBe(false);
    expect(failed.view).toEqual(good);
    expect(failed.stages.length).toBe(3); // the derived gate list stays on screen

    // A first failed load leaves no view but still reports the problem.
    const fresh = createStore(fakeApi({ ok: false, code: 'invalid_id' }));
    await fresh.load(WO_ID);
    expect(fresh.state().view).toBeNull();
    expect(fresh.state().stages).toEqual([]);
    expect(fresh.state().problem).toBe('invalid_id');
  });

  it('U-4: a definitions failure reply fails soft — problem state, no view, no gate stages', async () => {
    // Definitions ride the detail query now, so an unloadable set arrives exactly like any other
    // query failure: the problem shows and nothing crashes.
    const store = createStore(fakeApi({ ok: false, code: 'definitions_invalid' }));
    await store.load(WO_ID);
    const state = store.state();
    expect(state.problem).toBe('definitions_invalid');
    expect(state.view).toBeNull();
    expect(state.stages).toEqual([]);
    expect(state.loading).toBe(false);
  });

  it('U-4: the store re-queries on the coarse change events', async () => {
    const api = fakeApi(detailReply(AT_SHIP));
    const emitter = fakeSignal();
    const store = createStore(api, emitter);
    await store.load(WO_ID);
    expect(api.queries.filter((query) => query.type === 'workOrder.detail')).toHaveLength(1);

    emitter.emit({ type: 'workOrders.changed' });
    await flush();
    expect(api.queries.filter((query) => query.type === 'workOrder.detail')).toHaveLength(2);

    emitter.emit({ type: 'run.updated', runId: RUN_ID });
    await flush();
    expect(api.queries.filter((query) => query.type === 'workOrder.detail')).toHaveLength(3);
  });

  it('U-4: a finished work order renders every gate as passed', async () => {
    const store = createStore(fakeApi(detailReply(DONE)));
    await store.load(WO_ID);

    const stages = store.state().stages;
    expect(stages.map((stage) => stage.current)).toEqual([false, false, false]);
    expect(stages.every((stage) => stage.gates.every((gate) => gate.status === 'passed'))).toBe(true);
  });

  it('U-4: an intent before any load answers not_found without issuing a command', async () => {
    const api = fakeApi(detailReply(AT_SHIP));
    const store = createStore(api);

    const outcome = await store.decideGate({ gate: 'ship-approval', decision: 'approved' });

    expect(api.commands).toEqual([]);
    expect(outcome).toEqual({
      command: 'gate.decide',
      result: { ok: false, code: 'not_found' },
      labelKey: 'error.not_found',
    });
  });

  it('U-4: the asks section is fed from permissions.open, scoped to the loaded work order\'s runs', async () => {
    const api = fakeApi(detailReply(AT_BUILD));
    api.setAsks([
      { runId: RUN_ID, askId: 'ask-1', since: 5, title: 'Ship the thing' },
      { runId: '01ARZ3NDEKTSV4RRFFQ69G5FC2', askId: 'ask-2', since: 6, title: null },
      { runId: RUN_ID, askId: 'ask-3', since: 7, title: null },
    ]);
    const store = createStore(api);
    await store.load(WO_ID);

    // Only this work order's runs are shown. The title stands in for the tool when the ask still
    // resolves to one, the ask id when it does not; the read carries no target, so none is claimed.
    expect(store.state().asks).toEqual([
      { runId: RUN_ID, askId: 'ask-1', tool: 'Ship the thing', target: null },
      { runId: RUN_ID, askId: 'ask-3', tool: 'ask-3', target: null },
    ]);
  });

  it('U-4: a permissions.open failure keeps the asks already shown', async () => {
    const api = fakeApi(detailReply(AT_BUILD));
    api.setAsks([{ runId: RUN_ID, askId: 'ask-1', since: 5, title: 'Ship the thing' }]);
    const emitter = fakeSignal();
    const store = createStore(api, emitter);
    await store.load(WO_ID);
    const shown = store.state().asks;
    expect(shown).toHaveLength(1);

    api.setAsks({ ok: false, code: 'not_found' });
    emitter.emit({ type: 'run.updated', runId: RUN_ID });
    await flush();

    expect(store.state().asks).toEqual(shown);
  });

  it('U-4: the open asks ride every detail load and refresh when an ask is answered', async () => {
    const api = fakeApi(detailReply(AT_BUILD));
    api.setAsks([{ runId: RUN_ID, askId: 'ask-1', since: 5, title: 'Ship the thing' }]);
    const store = createStore(api);
    await store.load(WO_ID);
    expect(store.state().asks).toHaveLength(1);

    api.setAsks([]);
    await store.answerPermission({ runId: RUN_ID, askId: 'ask-1', decision: 'allow' });

    // The answer intent's refresh carries both reads: the detail and the open asks.
    expect(api.queries.filter((query) => query.type === 'permissions.open')).toHaveLength(2);
    expect(store.state().asks).toEqual([]);
  });

  it('U-4: the live pane mounts on the newest active run, never on a finished one', async () => {
    const pane = fakePane();
    const api = fakeApi(
      detailReplyWithRuns(AT_BUILD, [
        { id: RUN_ID, stage: 'build', startedAt: 1_000, endedAt: 2_000, outcome: 'succeeded' },
        { id: ACTIVE_RUN_ID, stage: 'build', startedAt: 3_000 },
      ]),
    );
    const store = createStore(api, fakeSignal(), pane);
    await store.load(WO_ID);
    expect(pane.attached).toEqual([ACTIVE_RUN_ID]);

    // A work order whose runs have all ended mounts nothing.
    const idlePane = fakePane();
    const idle = createStore(
      fakeApi(
        detailReplyWithRuns(AT_SHIP, [
          { id: RUN_ID, stage: 'ship', startedAt: 1_000, endedAt: 2_000, outcome: 'succeeded' },
        ]),
      ),
      fakeSignal(),
      idlePane,
    );
    await idle.load(WO_ID);
    expect(idlePane.attached).toEqual([]);
  });
});
