// work-order-detail.test.ts — U-4: the detail store derives the per-stage gate list with
// human-readable states, exposes a deploy gate's environment/protection/promoteFrom chain
// (E-5, read-only), and gates the approve intent on the typed environment confirmation (E-8:
// the input must equal the environment name before deploy.approve is issued — wrong or absent
// never fires). Every intent maps its CommandResult through results.ts (U-8) and refreshes the
// detail query. The decision zone is fed from `permissions.open`, scoped to the loaded work
// order's runs, and the live pane mounts on the work order's newest active run. Phase A (#972)
// adds the view-model rules: U-223 (one badge word per state), U-224 (the stage strip's counter),
// U-226 (the decision-zone matrix), U-229 (cost by billing), U-230 (provenance) and U-231 (the
// read-only changes list). Api, change signal and pane are injected fakes.
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';

import { AutonomyControl } from '../components/autonomy-control';
import { AutonomySuggestionBanner } from '../components/autonomy-suggestion-banner';

import type { Api } from '../../api/api';
import type { Command, CommandResult } from '../../api/commands';
import type { Query, UsageSummaryView } from '../../api/queries';
import type {
  Actor,
  AgentEvent,
  CostByKind,
  FlowDef,
  FlowAction,
  GateSlug,
  GitLifecycleState,
  RunOutcome,
  Slug,
  StageSlug,
  WorkOrderState,
} from '../../domain/index';
import { parseSlug } from '../../domain/index';

import type { LivePaneStore } from './live-pane';
import { TR } from '../labels/tr';
import { EN } from '../labels/en';
import {
  createWorkOrderDetailStore,
  decisionZone,
  detailBadge,
  formatRunCode,
  gateCheckGroups,
  asksWaitingCount,
  gateWaitingCount,
  gitCardVisible,
  stageListStanding,
  gitCard,
  isFailedStanding,
  lastMessageOf,
  newestFailedRunOf,
  runRows,
  stripSegments,
  workOrderUsageMoney,
  type DetailChange,
  type DecisionZone,
  type DetailChangeSignal,
  type GateChecksGroup,
  type GitBaseRead,
  type StageGates,
  type WorkOrderDetailRun,
  type WorkOrderGateRow,
  type WorkOrderDetailView,
  type WorkOrderRunSummary,
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
const FAILED_RUN_ID = '01ARZ3NDEKTSV4RRFFQ69G5FC9';

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

/** A release flow whose ship stage carries an unprotected and a protected deploy gate; the build
 *  stage's role is the reviewer role the provenance word reads (U-230). */
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
      role: slugOf<'role'>('reviewer'),
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
const ENVIRONMENTS = [
  { id: ENV_DEV, name: 'Dev', order: 1, deploy: 'deploy-dev', env: {}, protected: false },
  { id: ENV_STAGING, name: 'Staging', order: 2, deploy: 'deploy-staging', env: {}, protected: false, promoteFrom: ENV_DEV },
  { id: ENV_PROD, name: 'Prod', order: 3, deploy: 'deploy-prod', env: {}, protected: true, promoteFrom: ENV_STAGING },
];

const NONE: FlowAction = { kind: 'none' };

const stateAt = (stage: StageSlug, pending: readonly GateSlug[], status: WorkOrderState['status'] = 'gating'): WorkOrderState => ({
  status,
  stage,
  attempt: 1,
  pendingGates: pending,
  skippedStages: [],
});

const AT_BUILD = stateAt(STAGE_BUILD, [GATE_SECRET_SCAN]);
const AT_SHIP = stateAt(STAGE_SHIP, [GATE_SHIP_APPROVAL, GATE_DEPLOY_PROD, GATE_DEPLOY_STAGING]);
const DONE: WorkOrderState = { status: 'done', stage: null, attempt: 1, pendingGates: [], skippedStages: [] };
const AWAITING_PLAN: WorkOrderState = {
  status: 'awaiting_human',
  stage: STAGE_PLAN,
  attempt: 1,
  pendingGates: [GATE_PLAN_APPROVAL],
  skippedStages: [],
};

const detailReply = (state: WorkOrderState): WorkOrderDetailView => ({
  record: { id: WO_ID, repo: 'atolye', flow: 'release-flow', title: 'Ship the thing' },
  state,
  next: NONE,
  number: 1,
  runs: [
    {
      id: RUN_ID,
      stage: 'build',
      attempt: 1,
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

const defaultRunSummary = (
  run: WorkOrderDetailRun,
  canSteer: boolean | 'unknown' = true,
): WorkOrderRunSummary => ({
  runId: run.id,
  stage: run.stage,
  attempt: run.attempt,
  role: 'worker',
  account: { id: 'acc-1', label: 'Main', provider: 'claude-code' },
  billing: 'included',
  ...(run.endedAt === undefined ? { canSteer } : {}),
});

const detailReplyWithRuns = (
  state: WorkOrderState,
  runs: readonly WorkOrderDetailRun[],
  runSummaries?: readonly WorkOrderRunSummary[],
): WorkOrderDetailView => ({
  ...detailReply(state),
  runs,
  runSummaries:
    runSummaries ??
    runs.filter((run) => run.endedAt === undefined).map((run) => defaultRunSummary(run)),
});

/** The stage list the fixture flow yields for a state — the same derivation the store applies
 *  (pinned by the store's own tests above), factored out for the pure view-model rules. */
const stagesFor = (flow: FlowDef, state: WorkOrderState) => {
  const currentIndex =
    state.stage === null ? flow.stages.length : flow.stages.findIndex((stage) => stage.id === state.stage);
  return flow.stages.map((stage, index) => ({
    stage: stage.id,
    name: stage.name,
    role: stage.role,
    current: state.stage !== null && index === currentIndex,
    gates: stage.exit.map((gate) => ({
      id: gate.id,
      kind: gate.kind,
      status:
        state.stage === null
          ? ('passed' as const)
          : index === currentIndex
            ? (state.pendingGates.includes(gate.id) ? ('pending' as const) : ('passed' as const))
            : index < currentIndex
              ? ('passed' as const)
              : ('upcoming' as const),
    })),
  }));
};

interface FakeApi extends Pick<Api, 'query' | 'command'> {
  readonly queries: Query[];
  readonly commands: Command[];
  setReply(reply: unknown): void;
  setAsks(reply: unknown): void;
  setChanges(reply: unknown): void;
  setRunEvents(reply: unknown): void;
  /** The event tail of one run alone; wins over the shared `setRunEvents` reply. */
  setRunEventsFor(runId: string, reply: unknown): void;
  setUsageSummary(reply: unknown): void;
  setGitBase(reply: unknown): void;
  setLocalBase(reply: unknown): void;
  setCommandResult(result: CommandResult): void;
}

const EMPTY_USAGE: UsageSummaryView = {
  summary: {
    runs: 0,
    tokens: 0,
    inputTokens: 0,
    cachedInputTokens: 0,
    cacheRatio: 0,
    planningShare: 0,
    byStage: [],
  },
  findings: [],
  runsWithoutUsage: 0,
};

/** The detail query, the open-asks query, the changes read and the run-event tail are answered
 *  separately; every call is recorded. */
const fakeApi = (initialReply: unknown): FakeApi => {
  const queries: Query[] = [];
  const commands: Command[] = [];
  let reply: unknown = initialReply;
  let asksReply: unknown = [];
  let changesReply: unknown = null;
  let runEventsReply: unknown = null;
  const runEventsByRun = new Map<string, unknown>();
  let usageSummaryReply: unknown = EMPTY_USAGE;
  let gitBaseReply: unknown = null;
  let localBaseReply: unknown = null;
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
    setChanges: (next) => {
      changesReply = next;
    },
    setRunEvents: (next) => {
      runEventsReply = next;
    },
    setRunEventsFor: (runId, next) => {
      runEventsByRun.set(runId, next);
    },
    setUsageSummary: (next) => {
      usageSummaryReply = next;
    },
    setGitBase: (next) => {
      gitBaseReply = next;
    },
    setLocalBase: (next) => {
      localBaseReply = next;
    },
    setCommandResult: (next) => {
      commandResult = next;
    },
    query: (query) => {
      queries.push(query);
      if (query.type === 'permissions.open') return Promise.resolve(asksReply);
      if (query.type === 'workOrder.changes') return Promise.resolve(changesReply);
      if (query.type === 'run.events') return Promise.resolve(runEventsByRun.has(query.runId) ? runEventsByRun.get(query.runId) : runEventsReply);
      if (query.type === 'usage.summary') return Promise.resolve(usageSummaryReply);
      if (query.type === 'workOrder.gitBase') return Promise.resolve(gitBaseReply);
      if (query.type === 'workOrder.localBase') return Promise.resolve(localBaseReply);
      return Promise.resolve(reply);
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
      skipDecisions: [],
      asks: [],
      problem: null,
      lastOutcome: null,
      changes: null,
      lastErrorLine: null,
      autoAllowed: 0,
      usageSummary: null,
      usageSummaryFailed: false,
      gitBase: null,
      localBase: null,
    });
    const loading = store.load(WO_ID);
    expect(store.state().loading).toBe(true);
    await loading;

    expect(api.queries[0]).toEqual({ type: 'workOrder.detail', id: WO_ID });
    // Before the ship stage is reached its gates — deploy gates included — are upcoming.
    expect(store.state().stages).toEqual([
      { stage: 'plan', name: 'Plan', role: null, current: false, gates: [{ id: 'plan-approval', kind: 'human', label: 'Plan approval', status: 'passed' }] },
      { stage: 'build', name: 'Build', role: 'reviewer', current: true, gates: [{ id: 'secret-scan', kind: 'secret_scan', status: 'pending' }] },
      {
        stage: 'ship',
        name: 'Ship',
        role: null,
        current: false,
        gates: [
          { id: 'ship-approval', kind: 'human', label: 'Ship approval', status: 'upcoming' },
          { id: 'deploy-prod', kind: 'deploy', status: 'upcoming', deploy: { environment: 'prod', protectedEnvironment: true, promoteFromChain: ['staging', 'dev'] } },
          { id: 'deploy-staging', kind: 'deploy', status: 'upcoming', deploy: { environment: 'staging', protectedEnvironment: false, promoteFromChain: ['dev'] } },
        ],
      },
    ]);

    api.setReply(detailReply(AT_SHIP));
    await store.load(WO_ID);
    expect(store.state().stages).toEqual([
      { stage: 'plan', name: 'Plan', role: null, current: false, gates: [{ id: 'plan-approval', kind: 'human', label: 'Plan approval', status: 'passed' }] },
      { stage: 'build', name: 'Build', role: 'reviewer', current: false, gates: [{ id: 'secret-scan', kind: 'secret_scan', status: 'passed' }] },
      {
        stage: 'ship',
        name: 'Ship',
        role: null,
        current: true,
        gates: [
          { id: 'ship-approval', kind: 'human', label: 'Ship approval', status: 'pending' },
          { id: 'deploy-prod', kind: 'deploy', status: 'pending', deploy: { environment: 'prod', protectedEnvironment: true, promoteFromChain: ['staging', 'dev'] } },
          { id: 'deploy-staging', kind: 'deploy', status: 'pending', deploy: { environment: 'staging', protectedEnvironment: false, promoteFromChain: ['dev'] } },
        ],
      },
    ]);
  });

  it('U-355: a passed gate the policy decided carries its approval evidence; a human re-decision clears it', async () => {
    const decided = detailReply(DONE);
    const api = fakeApi({
      ...decided,
      decisions: [
        {
          gate: 'plan-approval',
          stage: 'plan',
          decision: 'approved',
          at: 1_500,
          approvedByPolicy: { policy: 'gate-auto', level: 'auto', passedMachineGates: ['secret-scan'] },
        },
        { gate: 'ship-approval', stage: 'ship', decision: 'approved', at: 1_600 },
      ],
    });
    const store = createStore(api);
    await store.load(WO_ID);

    const stages = store.state().stages;
    expect(stages[0]?.gates[0]).toEqual({
      id: 'plan-approval',
      kind: 'human',
      label: 'Plan approval',
      status: 'passed',
      policyApproval: { policy: 'gate-auto', level: 'auto', passedMachineGates: ['secret-scan'] },
    });
    expect(stages[2]?.gates[0]).toMatchObject({ id: 'ship-approval', status: 'passed' });
    expect(stages[2]?.gates[0]?.policyApproval).toBeUndefined();

    // The latest decision governs: after a stage re-entry the human decides again, and the old
    // policy evidence must not survive onto the row.
    api.setReply({
      ...decided,
      decisions: [
        {
          gate: 'plan-approval',
          stage: 'plan',
          decision: 'approved',
          at: 1_500,
          approvedByPolicy: { policy: 'gate-auto', level: 'auto', passedMachineGates: ['secret-scan'] },
        },
        { gate: 'plan-approval', stage: 'plan', decision: 'approved', at: 2_500 },
      ],
    });
    await store.load(WO_ID);
    expect(store.state().stages[0]?.gates[0]?.policyApproval).toBeUndefined();
  });

  it('U-360: load maps skipDecisions from view to store state; absent skipDecisions defaults to empty list', async () => {
    const base = detailReply(DONE);
    const withSkips: WorkOrderDetailView = {
      ...base,
      skipDecisions: [
        { stages: ['plan'], decision: 'rejected', at: 1_000 },
        { stages: ['check'], decision: 'approved', at: 1_100, decidedByPolicy: { policy: 'stage-skip-auto', level: 'auto' } },
      ],
    };
    const store = createStore(fakeApi(withSkips));
    await store.load(WO_ID);

    expect(store.state().skipDecisions).toEqual([
      { stages: ['plan'], decision: 'rejected', at: 1_000 },
      { stages: ['check'], decision: 'approved', at: 1_100, decidedByPolicy: { policy: 'stage-skip-auto', level: 'auto' } },
    ]);

    const storeWithoutSkips = createStore(fakeApi(base));
    await storeWithoutSkips.load(WO_ID);
    expect(storeWithoutSkips.state().skipDecisions).toEqual([]);
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
    expect(approved).toEqual({ command: 'gate.decide', result: { ok: true }, labelKey: 'success.gate.approved' });

    api.setCommandResult({ ok: false, code: 'not_pending' });
    const rejected = await store.decideGate({ gate: 'ship-approval', decision: 'rejected' });
    expect(rejected).toEqual({
      command: 'gate.decide',
      result: { ok: false, code: 'not_pending' },
      labelKey: 'error.not_pending',
    });
    expect(store.state().lastOutcome).toEqual(rejected);

    api.setCommandResult({ ok: true });
    const refused = await store.decideGate({ gate: 'ship-approval', decision: 'rejected', note: 'redo the edge case' });
    expect(refused).toEqual({ command: 'gate.decide', result: { ok: true }, labelKey: 'success.gate.rejected' });
    // #978: the reject's note travels to gate.decide — the reason box's text is the note.
    expect(api.commands.at(-1)).toEqual({
      type: 'gate.decide',
      workOrderId: WO_ID,
      gate: 'ship-approval',
      decision: 'rejected',
      note: 'redo the edge case',
    });
  });

  it('U-61: the pending changes gate attests through gate.attest and each answer names its own success', async () => {
    const GATE_CHANGES = slugOf<'gate'>('changes');
    const flow: FlowDef = {
      ...FLOW,
      stages: [
        { id: STAGE_BUILD, name: 'Build', role: slugOf<'role'>('builder'), exit: [{ kind: 'changes', id: GATE_CHANGES }] },
      ],
    };
    const api = fakeApi({ ...detailReply(stateAt(STAGE_BUILD, [GATE_CHANGES])), flow });
    const store = createStore(api);
    await store.load(WO_ID);

    // "Değişiklik gerekmiyordu": the attestation fires gate.attest verbatim and refreshes.
    const noChange = await store.attestNoChanges({ gate: 'changes', noChangeNeeded: true });
    expect(api.commands).toEqual([{ type: 'gate.attest', workOrderId: WO_ID, gate: 'changes', noChangeNeeded: true }]);
    expect(api.queries.filter((query) => query.type === 'workOrder.detail')).toHaveLength(2);
    expect(noChange).toEqual({ command: 'gate.attest', result: { ok: true }, labelKey: 'success.gate.attestNoChange' });

    // "Eksik, yeniden çalıştır": the same command, the other answer, its own copy.
    const rerun = await store.attestNoChanges({ gate: 'changes', noChangeNeeded: false });
    expect(rerun).toEqual({ command: 'gate.attest', result: { ok: true }, labelKey: 'success.gate.attestRerun' });
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

  it('U-226: closing the work order is the ⋯ menu\'s intent — workOrder.close, its own success word', async () => {
    const api = fakeApi(detailReply(AT_BUILD));
    const store = createStore(api);
    await store.load(WO_ID);

    const outcome = await store.closeWorkOrder();

    expect(api.commands).toEqual([{ type: 'workOrder.close', id: WO_ID }]);
    expect(api.queries.filter((query) => query.type === 'workOrder.detail')).toHaveLength(2);
    expect(outcome).toEqual({ command: 'workOrder.close', result: { ok: true }, labelKey: 'success.workOrder.close' });
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

    // Only this work order's runs are shown. Without the run's ask event the ask id stands in
    // for the tool and no target is claimed — the work order's title is never the tool (#1277).
    expect(store.state().asks).toEqual([
      { runId: RUN_ID, askId: 'ask-1', tool: 'ask-1', target: null },
      { runId: RUN_ID, askId: 'ask-3', tool: 'ask-3', target: null },
    ]);
  });

  it('#1277: an ask carries the tool and exact target its own run event named', async () => {
    const api = fakeApi(detailReply(AT_BUILD));
    api.setAsks([
      { runId: RUN_ID, askId: 'ask-1', since: 5, title: 'Ship the thing' },
      { runId: RUN_ID, askId: 'ask-2', since: 6, title: 'Ship the thing' },
    ]);
    api.setRunEvents([
      { type: 'permission_ask', at: 1, id: 'ask-1', tool: 'Read', target: '/repo/docs/plans/ie-0001.md', options: ['allow'] },
      { type: 'permission_ask', at: 2, id: 'ask-2', tool: 'Bash', target: 'ls -la', options: ['allow'] },
    ]);
    const store = createStore(api);
    await store.load(WO_ID);
    await flush();

    expect(store.state().asks).toEqual([
      { runId: RUN_ID, askId: 'ask-1', tool: 'Read', target: '/repo/docs/plans/ie-0001.md' },
      { runId: RUN_ID, askId: 'ask-2', tool: 'Bash', target: 'ls -la' },
    ]);
  });

  it('A-429: a verdict ask carries the detail its run event holds; any other ask carries none', async () => {
    const api = fakeApi(detailReply(AT_BUILD));
    api.setAsks([
      { runId: RUN_ID, askId: 'ask-1', since: 5, title: null },
      { runId: RUN_ID, askId: 'ask-2', since: 6, title: null },
    ]);
    api.setRunEvents([
      {
        type: 'permission_ask',
        at: 1,
        id: 'ask-1',
        tool: 'mcp__docket-pages__submit_verdict',
        detail: { verdict: 'approve', summary: 'Checked the diff.', pointerCount: 2 },
        options: ['allow'],
      },
      { type: 'permission_ask', at: 2, id: 'ask-2', tool: 'Bash', target: 'ls -la', options: ['allow'] },
    ]);
    const store = createStore(api);
    await store.load(WO_ID);
    await flush();

    expect(store.state().asks).toEqual([
      {
        runId: RUN_ID,
        askId: 'ask-1',
        tool: 'mcp__docket-pages__submit_verdict',
        target: null,
        detail: { verdict: 'approve', summary: 'Checked the diff.', pointerCount: 2 },
      },
      { runId: RUN_ID, askId: 'ask-2', tool: 'Bash', target: 'ls -la' },
    ]);
  });

  it('#1277: asks raised by different runs each read their own run\'s event — not only the first ask\'s run', async () => {
    const OTHER_RUN = '01ARZ3NDEKTSV4RRFFQ69G5FC3';
    const api = fakeApi(
      detailReplyWithRuns(stateAt(STAGE_BUILD, [], 'running'), [
        { id: RUN_ID, stage: 'build', attempt: 1, startedAt: 1_000 },
        { id: OTHER_RUN, stage: 'build', attempt: 1, startedAt: 2_000 },
      ]),
    );
    api.setAsks([
      { runId: RUN_ID, askId: 'ask-1', since: 5, title: null },
      { runId: OTHER_RUN, askId: 'ask-2', since: 6, title: null },
      { runId: OTHER_RUN, askId: 'ask-3', since: 7, title: null },
    ]);
    api.setRunEventsFor(RUN_ID, [{ type: 'permission_ask', at: 1, id: 'ask-1', tool: 'Read', target: '/repo/a.md', options: ['allow'] }]);
    api.setRunEventsFor(OTHER_RUN, [
      { type: 'permission_ask', at: 2, id: 'ask-2', tool: 'Bash', target: 'ls -la', options: ['allow'] },
      { type: 'permission_ask', at: 3, id: 'ask-3', tool: 'Edit', options: ['allow'] },
    ]);
    const store = createStore(api);
    await store.load(WO_ID);
    await flush();

    expect(store.state().asks).toEqual([
      { runId: RUN_ID, askId: 'ask-1', tool: 'Read', target: '/repo/a.md' },
      { runId: OTHER_RUN, askId: 'ask-2', tool: 'Bash', target: 'ls -la' },
      // An ask event without a target claims none.
      { runId: OTHER_RUN, askId: 'ask-3', tool: 'Edit', target: null },
    ]);
    // One tail read per asking run, not one per ask.
    const reads = api.queries.filter((query) => query.type === 'run.events');
    expect(new Set(reads.map((query) => (query.type === 'run.events' ? query.runId : ''))).size).toBe(2);
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

  it('U-226: the permission card\'s collapsed count is the asking run\'s already-allowed asks', async () => {
    const api = fakeApi(detailReplyWithRuns(stateAt(STAGE_BUILD, [], 'running'), [
      { id: RUN_ID, stage: 'build', attempt: 1, startedAt: 1_000 },
    ]));
    api.setAsks([{ runId: RUN_ID, askId: 'ask-1', since: 5, title: 'Ship the thing' }]);
    api.setRunEvents([
      { type: 'permission_ask', at: 1, id: 'a', tool: 'Read', options: ['allow'] },
      { type: 'permission_answered', at: 2, id: 'a', decision: 'allow' },
      { type: 'permission_answered', at: 3, id: 'b', decision: 'deny' },
    ]);
    const store = createStore(api);
    await store.load(WO_ID);
    await flush();

    // Only the allows count; a failed read or no asks leaves 0.
    expect(store.state().autoAllowed).toBe(1);
  });

  it('U-4: the live pane mounts on the newest active run, never on a finished one', async () => {
    const pane = fakePane();
    const api = fakeApi(
      detailReplyWithRuns(AT_BUILD, [
        { id: RUN_ID, stage: 'build', attempt: 1, startedAt: 1_000, endedAt: 2_000, outcome: 'succeeded' },
        { id: ACTIVE_RUN_ID, stage: 'build', attempt: 1, startedAt: 3_000 },
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
          { id: RUN_ID, stage: 'ship', attempt: 1, startedAt: 1_000, endedAt: 2_000, outcome: 'succeeded' },
        ]),
      ),
      fakeSignal(),
      idlePane,
    );
    await idle.load(WO_ID);
    expect(idlePane.attached).toEqual([]);
  });

  it('U-302: stopRun issues run.stop for the named run and refreshes; success toasts the stop request', async () => {
    const api = fakeApi(detailReplyWithRuns(stateAt(STAGE_BUILD, [], 'running'), [{ id: ACTIVE_RUN_ID, stage: 'build', attempt: 1, startedAt: 5_000 }]));
    const store = createStore(api);
    await store.load(WO_ID);

    const outcome = await store.stopRun(ACTIVE_RUN_ID);

    expect(api.commands).toEqual([{ type: 'run.stop', runId: ACTIVE_RUN_ID }]);
    // The intent refreshes the detail: the card leaves only when the reload shows the ended run.
    expect(api.queries.filter((query) => query.type === 'workOrder.detail')).toHaveLength(2);
    expect(outcome).toEqual({ command: 'run.stop', result: { ok: true }, labelKey: 'detail.stop.success' });
  });

  it('U-302: a not_active stop maps to the calm line, not a failure word', async () => {
    const api = fakeApi(detailReplyWithRuns(stateAt(STAGE_BUILD, [], 'running'), [{ id: ACTIVE_RUN_ID, stage: 'build', attempt: 1, startedAt: 5_000 }]));
    api.setCommandResult({ ok: false, code: 'not_active' });
    const store = createStore(api);
    await store.load(WO_ID);

    const outcome = await store.stopRun(ACTIVE_RUN_ID);

    expect(outcome.result).toEqual({ ok: false, code: 'not_active' });
    expect(outcome.labelKey).toBe('detail.stop.alreadyEnded');
  });

  it('U-303: steerRun issues run.steer with the note verbatim — no second validation in the store', async () => {
    const api = fakeApi(detailReplyWithRuns(stateAt(STAGE_BUILD, [], 'running'), [{ id: ACTIVE_RUN_ID, stage: 'build', attempt: 1, startedAt: 5_000 }]));
    const store = createStore(api);
    await store.load(WO_ID);

    const outcome = await store.steerRun(ACTIVE_RUN_ID, '  dosyalara bak  ');

    expect(api.commands).toEqual([{ type: 'run.steer', runId: ACTIVE_RUN_ID, note: '  dosyalara bak  ' }]);
    expect(outcome).toEqual({ command: 'run.steer', result: { ok: true }, labelKey: 'detail.steer.success' });
  });

  it('U-303: an empty or oversized note is the field\'s quiet verdict — inline error, no toast, no refresh', async () => {
    const api = fakeApi(detailReplyWithRuns(stateAt(STAGE_BUILD, [], 'running'), [{ id: ACTIVE_RUN_ID, stage: 'build', attempt: 1, startedAt: 5_000 }]));
    api.setCommandResult({ ok: false, code: 'bad_input' });
    const store = createStore(api);
    await store.load(WO_ID);
    const queriesBefore = api.queries.length;
    const outcomeBefore = store.state().lastOutcome;

    // Both unusable shapes travel verbatim; the api answers bad_input for each.
    const empty = await store.steerRun(ACTIVE_RUN_ID, '');
    const oversized = await store.steerRun(ACTIVE_RUN_ID, 'x'.repeat(2001));
    expect(api.commands).toEqual([
      { type: 'run.steer', runId: ACTIVE_RUN_ID, note: '' },
      { type: 'run.steer', runId: ACTIVE_RUN_ID, note: 'x'.repeat(2001) },
    ]);
    for (const rejected of [empty, oversized]) {
      expect(rejected.result).toEqual({ ok: false, code: 'bad_input' });
      // The returned outcome words the field's own copy, so the dialog's inline error and the
      // outcome say the same sentence.
      expect(rejected.labelKey).toBe('detail.steer.error');
    }
    // Quiet means quiet: nothing is published as the screen's lastOutcome (no toast fires — an
    // unmapped code would otherwise ride the U-8 generic arm as a red "unexpected error"), and
    // no refresh runs, because a refused command changed nothing the next query could show.
    expect(store.state().lastOutcome).toBe(outcomeBefore);
    expect(api.queries.length).toBe(queriesBefore);
  });
});

// --- U-223: one badge word per state ------------------------------------------------------------------

describe('detail badge (U-223)', () => {
  const badgeFor = (state: WorkOrderState, asks = 0, flow: FlowDef = FLOW) => {
    const view = { ...detailReply(state), flow };
    return detailBadge(stagesFor(flow, state), view, asks > 0 ? [{ runId: RUN_ID, askId: 'a', tool: 'Bash', target: null }] : []);
  };

  it('U-223: one word per state — the table every standing of the fold can leave', () => {
    expect(badgeFor(stateAt(STAGE_BUILD, [], 'ready'))).toEqual({ tone: 'info', wordKey: 'wo.status.ready', pulse: false });
    expect(badgeFor(stateAt(STAGE_BUILD, [], 'running'))).toEqual({ tone: 'proceed', wordKey: 'wo.status.running', pulse: true });
    expect(badgeFor(AT_BUILD)).toEqual({ tone: 'info', wordKey: 'wo.status.gating', pulse: false });
    expect(badgeFor(stateAt(STAGE_BUILD, [], 'limit_waiting'))).toEqual({ tone: 'info', wordKey: 'wo.status.limit_waiting', pulse: false });
    expect(badgeFor(DONE)).toEqual({ tone: 'proceed', wordKey: 'wo.status.done', pulse: false });
    // One human gate waiting: “Onay bekliyor”, never “İnsan yanıtı bekleniyor”.
    expect(badgeFor(AWAITING_PLAN)).toEqual({ tone: 'signal', wordKey: 'detail.badge.awaiting', pulse: false });
    // A pending deploy gate is its own word whatever the fold status around it.
    expect(badgeFor(AT_SHIP)).toEqual({ tone: 'signal', wordKey: 'detail.badge.deployWaiting', pulse: false });
    expect(badgeFor({ ...stateAt(STAGE_SHIP, [GATE_DEPLOY_PROD], 'awaiting_human') })).toEqual({
      tone: 'signal',
      wordKey: 'detail.badge.deployWaiting',
      pulse: false,
    });
    // Several human gates waiting on one stage: “Birden fazla onay bekliyor”.
    const GATE_SHIP_SECURITY = slugOf<'gate'>('ship-security');
    const multiFlow: FlowDef = {
      ...FLOW,
      stages: [
        {
          id: STAGE_SHIP,
          name: 'Ship',
          role: null,
          exit: [
            { kind: 'human', id: GATE_SHIP_APPROVAL, label: 'Ship approval' },
            { kind: 'human', id: GATE_SHIP_SECURITY, label: 'Ship security' },
          ],
        },
      ],
    };
    expect(
      badgeFor(
        { status: 'awaiting_human', stage: STAGE_SHIP, attempt: 1, pendingGates: [GATE_SHIP_APPROVAL, GATE_SHIP_SECURITY], skippedStages: [] },
        0,
        multiFlow,
      ),
    ).toEqual({ tone: 'signal', wordKey: 'detail.badge.multi', pulse: false });
    // An open ask outranks every gate standing: “İzin bekleniyor”.
    expect(badgeFor(stateAt(STAGE_BUILD, [], 'running'), 1)).toEqual({ tone: 'signal', wordKey: 'detail.badge.permission', pulse: true });
  });

  it('U-223: failure standings say “Başarısız” with the attempts sub-line — “Engellendi” is never used', () => {
    // The block standing is a failure with no attempts left.
    expect(badgeFor({ status: 'blocked', stage: STAGE_BUILD, attempt: 3, pendingGates: [], skippedStages: [], blockedReason: 'run failed' })).toEqual({
      tone: 'error',
      wordKey: 'run.outcome.failed',
      subKey: 'detail.badge.retryOut',
      pulse: false,
    });
    // A ready stage re-entered after a failed run is a failure with attempts left.
    const retry: WorkOrderState = { status: 'ready', stage: STAGE_BUILD, attempt: 2, pendingGates: [GATE_SECRET_SCAN], skippedStages: [] };
    const failedRun: WorkOrderDetailRun = { id: FAILED_RUN_ID, stage: 'build', attempt: 1, startedAt: 100, endedAt: 200, outcome: 'failed' };
    const view = detailReplyWithRuns(retry, [failedRun]);
    expect(isFailedStanding(view)).toBe(true);
    expect(detailBadge(stagesFor(FLOW, retry), view, [])).toEqual({
      tone: 'error',
      wordKey: 'run.outcome.failed',
      subKey: 'detail.badge.retryLeft',
      pulse: false,
    });
  });

  it('U-223: a no-role stage holding machine gates keeps the honest gating word', () => {
    expect(
      badgeFor({ status: 'awaiting_human', stage: STAGE_SHIP, attempt: 1, pendingGates: [GATE_DEPLOY_STAGING], skippedStages: [] }),
    ).toEqual({ tone: 'signal', wordKey: 'detail.badge.deployWaiting', pulse: false });
  });
});

// --- U-226: the decision-zone matrix -------------------------------------------------------------------

describe('decision zone (U-226)', () => {
  const zoneFor = (state: WorkOrderState, runs: readonly WorkOrderDetailRun[] = [], asks = 0, flow: FlowDef = FLOW) => {
    const view = { ...detailReplyWithRuns(state, runs), flow };
    return decisionZone(stagesFor(flow, state), view, asks > 0 ? [{ runId: RUN_ID, askId: 'a', tool: 'Bash', target: null }] : []);
  };

  it('U-226: nothing decidable → one quiet line, no card; done → the done line', () => {
    expect(zoneFor(stateAt(STAGE_BUILD, [], 'running'))).toEqual({ kind: 'quiet', done: false });
    expect(zoneFor(stateAt(STAGE_BUILD, [GATE_SECRET_SCAN]))).toEqual({ kind: 'quiet', done: false });
    expect(zoneFor(stateAt(STAGE_BUILD, [], 'limit_waiting'))).toEqual({ kind: 'quiet', done: false });
    expect(zoneFor(DONE)).toEqual({ kind: 'quiet', done: true });
  });

  it('U-226: a fresh ready stage with a `none` next falls quiet — the start card needs the fold\'s own next action', () => {
    expect(zoneFor(stateAt(STAGE_PLAN, [], 'ready'))).toEqual({ kind: 'quiet', done: false });
  });

  it('U-226: a start_run next action is the start card naming the current stage', () => {
    const state = stateAt(STAGE_PLAN, [], 'ready');
    const view: WorkOrderDetailView = {
      ...detailReply(state),
      next: { kind: 'start_run', stage: STAGE_PLAN, role: slugOf<'role'>('planner'), attempt: 1 },
    };
    expect(decisionZone(stagesFor(FLOW, state), view, [])).toEqual({ kind: 'cards', cards: [{ kind: 'start', stageName: 'Plan' }] });
  });

  it('U-226: awaiting_human with one human gate is one approve card; two human gates are two stacked cards', () => {
    expect(zoneFor(AWAITING_PLAN)).toEqual({
      kind: 'cards',
      cards: [{ kind: 'approve', gate: expect.objectContaining({ id: 'plan-approval' }) }],
    });
    const GATE_SHIP_SECURITY = slugOf<'gate'>('ship-security');
    const flow: FlowDef = {
      ...FLOW,
      stages: [
        {
          id: STAGE_SHIP,
          name: 'Ship',
          role: null,
          exit: [
            { kind: 'human', id: GATE_SHIP_APPROVAL, label: 'Ship approval' },
            { kind: 'human', id: GATE_SHIP_SECURITY, label: 'Ship security' },
          ],
        },
      ],
    };
    expect(
      zoneFor(
        { status: 'awaiting_human', stage: STAGE_SHIP, attempt: 1, pendingGates: [GATE_SHIP_APPROVAL, GATE_SHIP_SECURITY], skippedStages: [] },
        [],
        0,
        flow,
      ),
    ).toEqual({
      kind: 'cards',
      cards: [
        { kind: 'approve', gate: expect.objectContaining({ id: 'ship-approval' }) },
        { kind: 'approve', gate: expect.objectContaining({ id: 'ship-security' }) },
      ],
    });
  });

  describe('gating card', () => {
    const GATE_VERDICT = slugOf<'gate'>('review-verdict');
    const GATE_REVIEW_APPROVAL = slugOf<'gate'>('review-approval');
    const reviewFlow: FlowDef = {
      ...FLOW,
      stages: [
        {
          id: STAGE_BUILD,
          name: 'Build',
          role: slugOf<'role'>('reviewer'),
          exit: [
            { kind: 'agent_verdict', id: GATE_VERDICT, role: slugOf<'role'>('reviewer') },
            { kind: 'human', id: GATE_REVIEW_APPROVAL, label: 'Review approval' },
          ],
        },
      ],
    };
    const pendingBoth = [GATE_VERDICT, GATE_REVIEW_APPROVAL];

    it('R-1287: gating with a pending human gate shows no approve card, only the honest gating card naming the agent gate', () => {
      const zone = zoneFor(stateAt(STAGE_BUILD, pendingBoth, 'gating'), [], 0, reviewFlow);
      expect(zone).toEqual({
        kind: 'cards',
        cards: [{ kind: 'gating', gates: [expect.objectContaining({ id: 'review-verdict', kind: 'agent_verdict' })], verdictOrphaned: true }],
      });
      expect(zone.kind === 'cards' && zone.cards.some((card) => card.kind === 'approve')).toBe(false);
    });

    it('R-1287: the orphaned-verdict note only holds while no run is live', () => {
      const live = [{ id: ACTIVE_RUN_ID, stage: 'build', attempt: 1, startedAt: 5_000 }];
      expect(zoneFor(stateAt(STAGE_BUILD, pendingBoth, 'gating'), live, 0, reviewFlow)).toEqual({
        kind: 'cards',
        cards: [{ kind: 'gating', gates: [expect.objectContaining({ id: 'review-verdict' })], verdictOrphaned: false }],
      });
    });

    it('R-1287: a gating card never counts as a gate waiting for the operator', () => {
      const zone = zoneFor(stateAt(STAGE_BUILD, pendingBoth, 'gating'), [], 0, reviewFlow);
      expect(gateWaitingCount(zone)).toBe(0);
    });

    it('R-1287: awaiting_human keeps the approve card exactly as before', () => {
      expect(
        zoneFor(stateAt(STAGE_BUILD, [GATE_REVIEW_APPROVAL], 'awaiting_human'), [], 0, reviewFlow),
      ).toEqual({
        kind: 'cards',
        cards: [{ kind: 'approve', gate: expect.objectContaining({ id: 'review-approval' }) }],
      });
    });

    it('R-1287: the gating copy never claims the machine gates passed', () => {
      for (const key of ['detail.zone.gatingTitle', 'detail.zone.gatingBody', 'detail.zone.gatingVerdictOrphaned'] as const) {
        expect(TR[key]).not.toMatch(/makine kapıları geçti/);
        expect(EN[key]).not.toMatch(/machine gates passed/);
      }
      expect(TR['detail.zone.gatingVerdictOrphaned']).toBe('Ajan kararı bekleniyor; inceleyen karar vermeden bitti');
    });
  });

  it('U-226: a pending changes gate carries the attestation card; a pending deploy gate the deploy card', () => {
    const GATE_CHANGES = slugOf<'gate'>('changes');
    const flow: FlowDef = {
      ...FLOW,
      stages: [
        {
          id: STAGE_BUILD,
          name: 'Build',
          role: slugOf<'role'>('builder'),
          exit: [
            { kind: 'changes', id: GATE_CHANGES },
            { kind: 'deploy', id: GATE_DEPLOY_PROD, environment: ENV_PROD },
          ],
        },
      ],
    };
    expect(zoneFor(stateAt(STAGE_BUILD, [GATE_CHANGES, GATE_DEPLOY_PROD], 'gating'), [], 0, flow)).toEqual({
      kind: 'cards',
      cards: [
        { kind: 'attest', gate: expect.objectContaining({ id: 'changes' }) },
        { kind: 'deploy', gate: expect.objectContaining({ id: 'deploy-prod' }) },
      ],
    });
  });

  it('U-226: an open ask is the permission card — one card per ask, ahead of every gate standing', () => {
    expect(zoneFor(stateAt(STAGE_BUILD, [], 'running'), [], 1)).toEqual({
      kind: 'cards',
      cards: [{ kind: 'permission', ask: { runId: RUN_ID, askId: 'a', tool: 'Bash', target: null } }],
    });
  });

  it('U-226: a failed re-entry is the retry card; the block is the out-of-retries card', () => {
    const failedRuns: readonly WorkOrderDetailRun[] = [
      { id: FAILED_RUN_ID, stage: 'build', attempt: 1, startedAt: 100, endedAt: 200, outcome: 'failed' },
    ];
    expect(zoneFor({ status: 'ready', stage: STAGE_BUILD, attempt: 2, pendingGates: [GATE_SECRET_SCAN], skippedStages: [] }, failedRuns)).toEqual({
      kind: 'cards',
      cards: [{ kind: 'failed', retry: true }],
    });
    expect(zoneFor({ status: 'blocked', stage: STAGE_BUILD, attempt: 3, pendingGates: [], skippedStages: [], blockedReason: 'run failed' }, failedRuns)).toEqual({
      kind: 'cards',
      cards: [{ kind: 'failed', retry: false }],
    });
    // Attempts exhausted through the fold's own budget: onFail.maxAttempts reached.
    expect(
      zoneFor({ status: 'blocked', stage: STAGE_BUILD, attempt: 4, pendingGates: [], skippedStages: [], blockedReason: 'run failed' }, failedRuns, 0, {
        ...FLOW,
        stages: [{ id: STAGE_BUILD, name: 'Build', role: null, exit: [], onFail: { goto: STAGE_BUILD, maxAttempts: 3 } }],
      }),
    ).toEqual({ kind: 'cards', cards: [{ kind: 'failed', retry: false }] });
  });

  it('#1277: a permission ask is counted as an ask, never as a waiting gate', () => {
    const ask = { runId: RUN_ID, askId: 'a', tool: 'Bash', target: 'ls' };
    const zone: DecisionZone = { kind: 'cards', cards: [{ kind: 'permission', ask }] };
    expect(gateWaitingCount(zone)).toBe(0);
    expect(asksWaitingCount(zone)).toBe(1);
    expect(asksWaitingCount({ kind: 'quiet', done: false })).toBe(0);
    const state = stateAt(STAGE_BUILD, [], 'running');
    const view = detailReply(state);
    const segments = stripSegments(stagesFor(FLOW, state), zone, view);
    expect(segments.every((segment) => segment.gatesWaiting === 0)).toBe(true);
    expect(segments.map((segment) => segment.asksWaiting)).toEqual(segments.map((segment) => (segment.standing === 'current' ? 1 : 0)));
  });

  it('U-224: the gate count a strip counter reads — approve, attest and deploy cards count; permission, start and failure do not', () => {
    const state = stateAt(STAGE_SHIP, [GATE_SHIP_APPROVAL, GATE_DEPLOY_PROD, GATE_DEPLOY_STAGING], 'awaiting_human');
    const zone = zoneFor(state);
    expect(gateWaitingCount(zone)).toBe(3);
    expect(gateWaitingCount({ kind: 'quiet', done: false })).toBe(0);
    expect(gateWaitingCount({ kind: 'cards', cards: [{ kind: 'start', stageName: 'Plan' }] })).toBe(0);
    expect(gateWaitingCount({ kind: 'cards', cards: [{ kind: 'failed', retry: true }] })).toBe(0);
    // The running card (U-301) is not a gate waiting either — it waits on the run, not a person.
    expect(
      gateWaitingCount({ kind: 'cards', cards: [{ kind: 'running', runId: RUN_ID, stageName: 'Build', startedAt: 100, canSteer: true }] }),
    ).toBe(0);
  });

  // --- U-301: the running card -------------------------------------------------------------------------

  it('U-301: a live run of the current stage is exactly one running card naming it', () => {
    const live: readonly WorkOrderDetailRun[] = [
      { id: ACTIVE_RUN_ID, stage: 'build', attempt: 1, startedAt: 5_000 },
    ];
    expect(zoneFor(stateAt(STAGE_BUILD, [], 'running'), live)).toEqual({
      kind: 'cards',
      cards: [{ kind: 'running', runId: ACTIVE_RUN_ID, stageName: 'Build', startedAt: 5_000, canSteer: true }],
    });
  });

  it('U-301: no card when no run is live — a stale running standing and limit_waiting alike stay quiet', () => {
    // The running status without a live run in the view: a stale read, an orphaned record.
    expect(zoneFor(stateAt(STAGE_BUILD, [], 'running'), [])).toEqual({ kind: 'quiet', done: false });
    const ended: readonly WorkOrderDetailRun[] = [
      { id: RUN_ID, stage: 'build', attempt: 1, startedAt: 1_000, endedAt: 2_000, outcome: 'succeeded' },
    ];
    expect(zoneFor(stateAt(STAGE_BUILD, [], 'running'), ended)).toEqual({ kind: 'quiet', done: false });
    // limit_waiting runs hold no live handle: quiet is enough (the architect's decision 4).
    const waiting: readonly WorkOrderDetailRun[] = [
      { id: ACTIVE_RUN_ID, stage: 'build', attempt: 1, startedAt: 5_000 },
    ];
    expect(zoneFor(stateAt(STAGE_BUILD, [], 'limit_waiting'), waiting)).toEqual({ kind: 'quiet', done: false });
  });

  it('U-301: with two live runs the newest one is the card — the run the live pane mounts', () => {
    const two: readonly WorkOrderDetailRun[] = [
      { id: RUN_ID, stage: 'build', attempt: 1, startedAt: 1_000 },
      { id: ACTIVE_RUN_ID, stage: 'build', attempt: 1, startedAt: 9_000 },
    ];
    expect(zoneFor(stateAt(STAGE_BUILD, [], 'running'), two)).toEqual({
      kind: 'cards',
      cards: [{ kind: 'running', runId: ACTIVE_RUN_ID, stageName: 'Build', startedAt: 9_000, canSteer: true }],
    });
  });

  it('U-340: canSteer false or unknown still yields a running card carrying that verdict', () => {
    const live: readonly WorkOrderDetailRun[] = [{ id: ACTIVE_RUN_ID, stage: 'build', attempt: 1, startedAt: 5_000 }];
    const notSteerable = detailReplyWithRuns(stateAt(STAGE_BUILD, [], 'running'), live, [defaultRunSummary(live[0], false)]);
    expect(decisionZone(stagesFor(FLOW, notSteerable.state), notSteerable, [])).toEqual({
      kind: 'cards',
      cards: [{ kind: 'running', runId: ACTIVE_RUN_ID, stageName: 'Build', startedAt: 5_000, canSteer: false }],
    });
    const unknown = detailReplyWithRuns(stateAt(STAGE_BUILD, [], 'running'), live, [defaultRunSummary(live[0], 'unknown')]);
    expect(decisionZone(stagesFor(FLOW, unknown.state), unknown, [])).toEqual({
      kind: 'cards',
      cards: [{ kind: 'running', runId: ACTIVE_RUN_ID, stageName: 'Build', startedAt: 5_000, canSteer: 'unknown' }],
    });
  });

  it('U-301: the running card appears in no other standing — the two doors belong to the live run alone', () => {
    for (const standing of ['ready', 'gating', 'awaiting_human', 'done', 'limit_waiting'] as const) {
      const zone = zoneFor(stateAt(STAGE_BUILD, [], standing), [{ id: ACTIVE_RUN_ID, stage: 'build', attempt: 1, startedAt: 5_000 }]);
      expect(
        zone.kind === 'cards' && zone.cards.some((card) => card.kind === 'running'),
        `${standing} never shows the running card`,
      ).toBe(false);
    }
  });
});

// --- U-19: the in-place detail's stage strip (order and marking; #972 keeps the in-place opening and
// the back row, the pending-gate marking moved to U-224's counter) --------------------------------------

describe('stage strip order (U-19)', () => {
  it('U-19: segments follow the flow\'s order — done behind, the current marked, upcoming ahead', () => {
    const state = stateAt(STAGE_SHIP, [], 'running');
    const view = detailReply(state);
    const stages = stagesFor(FLOW, state);
    const segments = stripSegments(stages, decisionZone(stages, view, []), view);
    expect(segments.map((segment) => segment.name)).toEqual(['Plan', 'Build', 'Ship']);
    expect(segments.map((segment) => segment.standing)).toEqual(['done', 'done', 'current']);
    // A done work order walks off the flow's end: every stage done, none current.
    const done = stripSegments(stagesFor(FLOW, DONE), { kind: 'quiet', done: true }, detailReply(DONE));
    expect(done.map((segment) => segment.standing)).toEqual(['done', 'done', 'done']);
  });
});

// --- U-224: the stage strip ----------------------------------------------------------------------------

describe('stage strip (U-224)', () => {
  it('U-224: segments are stages only; the counter sits on the current label alone; N>2 stays one counter part', () => {
    const state = stateAt(STAGE_SHIP, [GATE_SHIP_APPROVAL, GATE_DEPLOY_PROD, GATE_DEPLOY_STAGING], 'awaiting_human');
    const view = detailReply(state);
    const stages = stagesFor(FLOW, state);
    const zone = decisionZone(stages, view, []);
    const segments = stripSegments(stages, zone, view);
    // Stages only — no gate segment, no gate name anywhere in the model.
    expect(segments.map((segment) => segment.name)).toEqual(['Plan', 'Build', 'Ship']);
    expect(JSON.stringify(segments)).not.toContain('approval');
    expect(JSON.stringify(segments)).not.toContain('deploy-prod');
    expect(segments.map((segment) => segment.standing)).toEqual(['done', 'done', 'current']);
    // The counter: current only, counting the zone's three decision cards as one number.
    expect(segments.map((segment) => segment.gatesWaiting)).toEqual([0, 0, 3]);
    // Done work order: every stage done, no counter.
    const doneSegments = stripSegments(
      stagesFor(FLOW, DONE),
      { kind: 'quiet', done: true },
      detailReply(DONE),
    );
    expect(doneSegments.map((segment) => segment.standing)).toEqual(['done', 'done', 'done']);
    expect(doneSegments.every((segment) => segment.gatesWaiting === 0)).toBe(true);
  });

  it('U-224: the failed and running markings ride the current segment only', () => {
    const failed: WorkOrderState = { status: 'ready', stage: STAGE_BUILD, attempt: 2, pendingGates: [GATE_SECRET_SCAN], skippedStages: [] };
    const failedView = detailReplyWithRuns(failed, [
      { id: FAILED_RUN_ID, stage: 'build', attempt: 1, startedAt: 100, endedAt: 200, outcome: 'failed' },
    ]);
    const failedStages = stagesFor(FLOW, failed);
    const segments = stripSegments(failedStages, decisionZone(failedStages, failedView, []), failedView);
    expect(segments.map((segment) => segment.failed)).toEqual([false, true, false]);

    const runningView = detailReply(stateAt(STAGE_BUILD, [], 'running'));
    const runningStages = stagesFor(FLOW, runningView.state);
    const runningSegments = stripSegments(runningStages, decisionZone(runningStages, runningView, []), runningView);
    expect(runningSegments.map((segment) => segment.running)).toEqual([false, true, false]);
  });
});

// --- U-229/U-230: the run rows -------------------------------------------------------------------------

describe('run rows (U-229, U-230)', () => {
  const summary = (over: Partial<WorkOrderRunSummary>): WorkOrderRunSummary => ({
    runId: RUN_ID,
    stage: 'build',
    attempt: 1,
    role: 'builder',
    account: { id: 'acct-1', label: 'Hesap A', provider: 'claude-code' },
    model: 'Sonnet',
    billing: 'pay_per_use',
    ...over,
  });

  const costOf = (costByKind: CostByKind, billing: 'pay_per_use' | 'included' | 'unknown') =>
    runRows({
      ...detailReply(AT_BUILD),
      runSummaries: [summary({ billing, usage: { inputTokens: 12_400, outputTokens: 3_100, cachedInputTokens: 0, costByKind } })],
    })[0]?.cost ?? null;

  it('U-229: pay-per-use shows money, marked as an estimate when the kind is computed, never a dollar from a bare equivalent', () => {
    expect(costOf({ reported: 1.42 }, 'pay_per_use')).toEqual({ kind: 'money', usd: 1.42, estimate: false });
    expect(costOf({ computed: 1.42 }, 'pay_per_use')).toEqual({ kind: 'money', usd: 1.42, estimate: true });
    // The domain's own honesty: a pay-per-use run that reported only an equivalent figure shows
    // tokens with the estimate, never a dollar as a charge.
    expect(costOf({ equivalent: 1.42 }, 'pay_per_use')).toEqual({ kind: 'tokens', equivalentUsd: 1.42 });
  });

  it('U-229: an included run shows tokens — the equivalent stays a secondary estimate, never a dollar charge (adversarial)', () => {
    expect(costOf({ equivalent: 1.42 }, 'included')).toEqual({ kind: 'tokens', equivalentUsd: 1.42 });
    // Adversarial: an included run whose only figure is the estimate never renders money.
    const row = costOf({ equivalent: 9.99 }, 'included');
    expect(row).not.toEqual(expect.objectContaining({ kind: 'money' }));
    // Credits read in the provider's own unit.
    expect(costOf({ credits: 1_400 }, 'included')).toEqual({ kind: 'credits', credits: 1_400 });
    // No cost at all: none.
    expect(costOf({}, 'included')).toEqual({ kind: 'none' });
  });

  it('U-230: the provenance line reads runSummaries; a deleted account still renders its stored id', () => {
    const rows = runRows({
      ...detailReply(AT_BUILD),
      runSummaries: [
        summary({ account: { id: 'acct-gone', label: '01ARZGONE', provider: 'unknown' }, model: undefined }),
      ],
    });
    expect(rows[0]?.accountLabel).toBe('01ARZGONE');
    expect(rows[0]?.model).toBeNull();
    // The short code, never the raw ULID (the walk-through decision).
    expect(rows[0]?.shortCode).toBe(formatRunCode(RUN_ID));
    expect(rows[0]?.shortCode).not.toContain(RUN_ID);
    // A run without a summary still renders: no provenance, no usage.
    const bare = runRows({ ...detailReply(AT_BUILD), runSummaries: [] });
    expect(bare[0]?.accountLabel).toBeNull();
    expect(bare[0]?.usage).toBeNull();
  });

  it('the run code is the id\'s last four characters on the run_ prefix, lowercase', () => {
    expect(formatRunCode('01ARZ3NDEKTSV4RRFFQ69G5FA0')).toBe('run_5fa0');
    expect(formatRunCode('01ARZ3NDEKTSV4RRFFQ69G5FB1')).toBe('run_5fb1');
  });
});

describe('work-order usage summary (#1112)', () => {
  it('U-327: load issues usage.summary for the work order and keeps the detail on a failed read', async () => {
    const api = fakeApi(detailReply(AT_BUILD));
    const store = createStore(api);
    await store.load(WO_ID);
    expect(api.queries.some((query) => query.type === 'usage.summary' && query.workOrder === WO_ID)).toBe(true);
    expect(store.state().usageSummary).toEqual(EMPTY_USAGE);
    expect(store.state().usageSummaryFailed).toBe(false);

    api.setUsageSummary({ ok: false, code: 'io_failed' });
    await store.reloadUsageSummary();
    expect(store.state().usageSummaryFailed).toBe(true);
    expect(store.state().view).not.toBeNull();
  });

  it('U-328: workOrderUsageMoney splits pay-per-use money from subscription equivalent', () => {
    const view: WorkOrderDetailView = {
      ...detailReply(AT_BUILD),
      runSummaries: [
        {
          runId: 'r-pay',
          stage: STAGE_BUILD,
          attempt: 1,
          role: 'builder',
          account: { id: 'a', label: 'Pay', provider: 'p' },
          billing: 'pay_per_use',
          usage: { inputTokens: 1, outputTokens: 1, cachedInputTokens: 0, costByKind: { reported: 2 } },
        },
        {
          runId: 'r-sub',
          stage: STAGE_BUILD,
          attempt: 1,
          role: 'builder',
          account: { id: 'b', label: 'Sub', provider: 'p' },
          billing: 'included',
          usage: { inputTokens: 1, outputTokens: 1, cachedInputTokens: 0, costByKind: { equivalent: 3 } },
        },
      ],
    };
    expect(workOrderUsageMoney(view)).toEqual({
      payPerUseUsd: 2,
      payPerUseEstimate: false,
      includedEquivalentUsd: 3,
    });
  });
});

// --- U-226 (failed card): the error quote ---------------------------------------------------------------

describe('the failed card\'s error line', () => {
  const at = (millis: number, text?: string): AgentEvent =>
    text === undefined
      ? { type: 'tool_call', at: millis, id: `t-${millis}`, name: 'Bash' }
      : { type: 'text', at: millis, delta: text };

  it('the line is the failed run\'s trailing spoken answer, joined in arrival order', () => {
    expect(lastMessageOf([at(1, 'Önce '), at(2, 'bakıyorum.'), at(3, 'Bitti.')])).toBe('Önce bakıyorum.Bitti.');
    expect(lastMessageOf([at(1, 'eski'), at(2), at(3, 'yeni')])).toBe('yeni');
    expect(lastMessageOf([at(1), at(2)])).toBeNull();
    expect(lastMessageOf([])).toBeNull();
    expect(lastMessageOf([at(1, '   ')])).toBeNull();
  });

  it('the store reads the failed run\'s tail once on a failed standing and quotes its last words', async () => {
    const failed: WorkOrderState = { status: 'ready', stage: STAGE_BUILD, attempt: 2, pendingGates: [GATE_SECRET_SCAN], skippedStages: [] };
    const api = fakeApi(
      detailReplyWithRuns(failed, [
        { id: FAILED_RUN_ID, stage: 'build', attempt: 1, startedAt: 100, endedAt: 200, outcome: 'failed' },
      ]),
    );
    api.setRunEvents([{ type: 'text', at: 1, delta: 'npm test: 3 test başarısız' }]);
    const store = createStore(api);
    await store.load(WO_ID);
    await flush();

    expect(api.queries).toContainEqual({ type: 'run.events', runId: FAILED_RUN_ID });
    expect(store.state().lastErrorLine).toBe('npm test: 3 test başarısız');
    // A stage with no failed run quotes nothing.
    expect(newestFailedRunOf(detailReplyWithRuns(failed, []))).toBeNull();
  });

  it('a failed standing whose run said nothing — or whose tail fails to read — keeps the line null', async () => {
    const failed: WorkOrderState = { status: 'ready', stage: STAGE_BUILD, attempt: 2, pendingGates: [GATE_SECRET_SCAN], skippedStages: [] };
    const runs: readonly WorkOrderDetailRun[] = [
      { id: FAILED_RUN_ID, stage: 'build', attempt: 1, startedAt: 100, endedAt: 200, outcome: 'failed' },
    ];
    // The fake answers run.events with null unless set — a non-array read, same stance as a failure.
    const store = createStore(fakeApi(detailReplyWithRuns(failed, runs)));
    await store.load(WO_ID);
    await flush();
    expect(store.state().lastErrorLine).toBeNull();
  });
});

// --- U-231: the read-only changes list ------------------------------------------------------------------

describe('changed files (U-231)', () => {
  const CHANGES = {
    state: 'ready',
    files: [
      { path: 'src/export/pdf-table.ts', added: 96, removed: 40, binary: false },
      { path: 'assets/logo.png', added: 0, removed: 0, binary: true },
    ],
    truncated: false,
  };

  it('U-231: the changes read rides every load and lands verbatim in the state', async () => {
    const api = fakeApi(detailReply(AT_BUILD));
    api.setChanges(CHANGES);
    const store = createStore(api);
    await store.load(WO_ID);

    expect(api.queries).toContainEqual({ type: 'workOrder.changes', workOrder: WO_ID });
    expect(store.state().changes).toEqual(CHANGES);
  });

  it('U-231: no_worktree and unavailable are honest states, not empty lists; a failed read keeps the list shown', async () => {
    const api = fakeApi(detailReply(AT_BUILD));
    api.setChanges({ state: 'no_worktree', files: [], truncated: false });
    const store = createStore(api);
    await store.load(WO_ID);
    expect(store.state().changes?.state).toBe('no_worktree');

    api.setChanges({ state: 'unavailable', files: [], truncated: false });
    await store.load(WO_ID);
    expect(store.state().changes?.state).toBe('unavailable');

    // A failing read keeps the list already on screen.
    api.setChanges({ ok: false, code: 'not_found' });
    await store.load(WO_ID);
    expect(store.state().changes?.state).toBe('unavailable');
  });

  it('U-231: a reply that is not the changes view shows no section instead of crashing the detail', async () => {
    const broken: readonly unknown[] = [
      { ok: true, data: CHANGES },
      undefined,
      { state: 'ready', files: 'src/x.ts', truncated: false },
      { state: 'ready', files: [{ added: 1 }], truncated: false },
      { state: 'weird', files: [], truncated: false },
    ];
    for (const reply of broken) {
      const api = fakeApi(detailReply(AT_BUILD));
      api.setChanges(reply);
      const store = createStore(api);
      await expect(store.load(WO_ID)).resolves.toBeUndefined();
      expect(store.state().changes).toBeNull();
      expect(store.state().view?.state.status).toBe('gating');
    }
  });
});

describe('gateCheckGroups — the CI check fold (U-341 … U-343)', () => {
  /** Two stages: build with a secret-scan gate, verify with a remote_checks gate plus a signoff —
   *  the shape the fold filters: remote gates only, pending or evaluated. */
  const stages: readonly StageGates[] = [
    {
      stage: slugOf<'stage'>('build'),
      name: 'Build',
      role: null,
      current: false,
      gates: [{ id: slugOf<'gate'>('scan'), kind: 'secret_scan', status: 'passed' }],
    },
    {
      stage: slugOf<'stage'>('verify'),
      name: 'Verify',
      role: null,
      current: true,
      gates: [
        { id: slugOf<'gate'>('ci'), kind: 'remote_checks', status: 'pending' },
        { id: slugOf<'gate'>('signoff'), kind: 'human', status: 'pending', label: 'Signoff' },
      ],
    },
  ];

  it('U-341: groups hold the newest recorded checks per gate and the history newest last; only remote gates fold', () => {
    const rows: readonly WorkOrderGateRow[] = [
      { gate: 'ci', stage: 'verify', verdict: { status: 'failed', reason: 'remote check failed: lint' }, at: 1_000, checks: [] },
      {
        gate: 'ci',
        stage: 'verify',
        verdict: { status: 'passed' },
        at: 2_000,
        checks: [
          { name: 'build-linux', status: 'passed' },
          { name: 'lint', status: 'failed' },
        ],
      },
    ];

    const groups = gateCheckGroups(stages, rows);

    expect(groups).toHaveLength(1);
    const group: GateChecksGroup = groups[0];
    expect(group.gate).toBe('ci');
    expect(group.standing).toBe('pending');
    expect(group.checks).toEqual([
      { name: 'build-linux', status: 'passed' },
      { name: 'lint', status: 'failed' },
    ]);
    expect(group.history).toEqual([
      { at: 1_000, status: 'failed' },
      { at: 2_000, status: 'passed' },
    ]);
  });

  it('U-342: a pending gate without evaluations keeps its quiet group; an evaluated gate no longer pending stays', () => {
    const pendingOnly = gateCheckGroups(stages, []);
    expect(pendingOnly).toHaveLength(1);
    expect(pendingOnly[0]).toEqual({ gate: 'ci', standing: 'pending', checks: [], history: [] });

    // A reply older than the field (no gates at all) still folds the pending gate.
    expect(gateCheckGroups(stages, undefined)).toEqual(pendingOnly);

    // A passed remote gate with history folds too; an upcoming one with nothing stays out.
    const passedStages: readonly StageGates[] = stages.map((stage) => ({
      ...stage,
      current: false,
      gates: stage.gates.map((gate) => (gate.kind === 'remote_checks' ? { ...gate, status: 'passed' } : gate)),
    }));
    const passed = gateCheckGroups(passedStages, [{ gate: 'ci', stage: 'verify', verdict: { status: 'passed' }, at: 3_000, checks: [] }]);
    expect(passed).toHaveLength(1);
    expect(gateCheckGroups(passedStages, [])).toEqual([]);
  });
});

// --- U-344 … U-349: the git doors --------------------------------------------------------------------

describe('git doors (U-344 … U-349)', () => {
  const BRANCH = { name: `docket/wo-${WO_ID.toLowerCase()}`, head: 'a1b2c3d4', pushedAt: 5_000 };
  const PR = { number: 7, url: 'https://forge.example/atolye/pull/7', head: BRANCH.name, base: 'main', merged: false };
  const NO_FORGE: GitBaseRead = { ok: false, code: 'forge_unavailable' };

  /** The door of one kind off a view's lifecycle, worktree standing (the changes read's own
   *  fact) and forge read. */
  const doorOf = (git: GitLifecycleState | undefined, gitBase: GitBaseRead | null, kind: 'push' | 'openPr' | 'merge' | 'mergeLocal' | 'release', hasWorktree = true, localBase: GitBaseRead | null = null) => {
    const view: WorkOrderDetailView = { ...detailReply(AT_BUILD), ...(git === undefined ? {} : { git }) };
    return gitCard(view, gitBase, hasWorktree, localBase)?.doors.find((door) => door.kind === kind);
  };

  it('U-344: released work orders and worktree-less ones carry no card; the branch line is the deterministic name until the ledger names it', () => {
    const view = detailReply(AT_BUILD);
    // A worktree stands and nothing git has happened yet: the card with the deterministic name.
    const fresh = gitCard(view, null, true);
    expect(fresh).not.toBeNull();
    expect(fresh?.branch).toBe(BRANCH.name);
    // The ledger's own push name is the same rule's recorded word — it wins once one folded in.
    expect(gitCard({ ...view, git: { branch: BRANCH } }, null, true)?.branch).toBe(BRANCH.name);
    // No working copy: nothing to push from, no card.
    expect(gitCard(view, null, false)).toBeNull();
    // Released: the lifecycle closed; the closed work shows no git card.
    const released = gitCard({ ...view, git: { branch: BRANCH, pr: { ...PR, merged: true }, released: true } }, null, true);
    expect(released).toBeNull();
    // A reply older than the field reads as the empty lifecycle, never as a crash.
    expect(gitCard(view, null, true)?.pr).toBeNull();
  });

  it('U-345: Gönder closes with its one reason line exactly while the forge is missing', () => {
    // Unknown (the read has not landed), a healthy forge and a transient forge failure all keep
    // the door open — only a missing forge is a missing forge; the command words the rest.
    expect(doorOf(undefined, null, 'push')?.available).toBe(true);
    expect(doorOf(undefined, { ok: true, base: 'main' }, 'push')?.available).toBe(true);
    expect(doorOf(undefined, { ok: false, code: 'forge_error' }, 'push')?.available).toBe(true);
    const missing = doorOf(undefined, NO_FORGE, 'push');
    expect(missing?.available).toBe(false);
    expect(missing?.reasonKey).toBe('detail.git.push.noForge');
  });

  it('U-345: push issues workOrder.push and success announces the pushed branch', async () => {
    const api = fakeApi({ ...detailReply(AT_BUILD), git: { branch: BRANCH } });
    const store = createStore(api);
    await store.load(WO_ID);
    const outcome = await store.push();
    expect(api.commands).toContainEqual({ type: 'workOrder.push', id: WO_ID });
    expect(outcome.labelKey).toBe('detail.git.push.success');
    expect(TR['detail.git.push.success']).toBe('Dal gönderildi.');
    // The intent refreshes the detail query like every other.
    expect(api.queries.filter((query) => query.type === 'workOrder.detail')).toHaveLength(2);
  });

  it('U-346: the PR door follows the lifecycle — a pushed branch with no open PR', () => {
    // Never pushed: closed with the push-first line.
    const unpushed = doorOf(undefined, null, 'openPr');
    expect(unpushed?.available).toBe(false);
    expect(unpushed?.reasonKey).toBe('detail.git.openPr.noBranch');
    // Pushed, no PR: open. A merged PR is not an open one — a second PR may follow.
    expect(doorOf({ branch: BRANCH }, null, 'openPr')?.available).toBe(true);
    expect(doorOf({ branch: BRANCH, pr: { ...PR, merged: true } }, null, 'openPr')?.available).toBe(true);
    // An open PR closes it; the card shows that PR instead.
    const open = doorOf({ branch: BRANCH, pr: PR }, null, 'openPr');
    expect(open?.available).toBe(false);
    expect(open?.reasonKey).toBe('detail.git.openPr.exists');
  });

  it('U-346: the gitBase read rides the binding once and prefill or hint follows its standing', async () => {
    const api = fakeApi({ ...detailReply(AT_BUILD), git: { branch: BRANCH } });
    api.setGitBase({ ok: true, base: 'trunk' });
    const store = createStore(api);
    await store.load(WO_ID);
    expect(api.queries).toContainEqual({ type: 'workOrder.gitBase', id: WO_ID });
    expect(store.state().gitBase).toEqual({ ok: true, base: 'trunk' });
    // A refresh of the same binding does not reach the forge again.
    await store.load(WO_ID);
    expect(api.queries.filter((query) => query.type === 'workOrder.gitBase')).toHaveLength(1);
    // A failed read keeps its code — the dialog's empty-with-hint standing reads it.
    const failing = fakeApi({ ...detailReply(AT_BUILD), git: { branch: BRANCH } });
    failing.setGitBase({ ok: false, code: 'forge_error' });
    const other = createStore(failing);
    await other.load(WO_ID);
    expect(other.state().gitBase).toEqual({ ok: false, code: 'forge_error' });
  });

  it('U-346: openPr carries base and the optional title verbatim; success confirms the open', async () => {
    const api = fakeApi({ ...detailReply(AT_BUILD), git: { branch: BRANCH } });
    const store = createStore(api);
    await store.load(WO_ID);
    const outcome = await store.openPr({ base: ' trunk ', title: ' Ship it ' });
    expect(api.commands).toContainEqual({ type: 'workOrder.openPr', id: WO_ID, base: ' trunk ', title: ' Ship it ' });
    expect(outcome.labelKey).toBe('detail.git.openPr.success');
    const bare = await store.openPr({ base: 'main' });
    expect(api.commands).toContainEqual({ type: 'workOrder.openPr', id: WO_ID, base: 'main' });
    expect(bare.labelKey).toBe('detail.git.openPr.success');
  });

  it('U-346: pr_exists is never an error toast — the refresh shows the stored PR on the card', async () => {
    const api = fakeApi({ ...detailReply(AT_BUILD), git: { branch: BRANCH } });
    const store = createStore(api);
    await store.load(WO_ID);
    api.setCommandResult({ ok: false, code: 'pr_exists', pr: { number: PR.number, url: PR.url } });
    const outcome = await store.openPr({ base: 'main' });
    expect(outcome.result.code).toBe('pr_exists');
    // No outcome was published, so no toast fires; the ledger's stored PR is already a fact the
    // re-query can show — the refresh ran for exactly that.
    expect(store.state().lastOutcome).toBeNull();
    expect(api.queries.filter((query) => query.type === 'workOrder.detail')).toHaveLength(2);
  });

  it('U-347: the merge door stands exactly while an open PR does', () => {
    expect(doorOf({ branch: BRANCH }, null, 'merge')?.available).toBe(false);
    expect(doorOf({ branch: BRANCH, pr: PR }, null, 'merge')?.available).toBe(true);
    const merged = doorOf({ branch: BRANCH, pr: { ...PR, merged: true } }, null, 'merge');
    expect(merged?.available).toBe(false);
    expect(merged?.reasonKey).toBe('detail.git.noOpenPr');
  });

  it('U-347: mergePr carries the number the dialog restated; a stale number is the typed refusal', async () => {
    const api = fakeApi({ ...detailReply(AT_BUILD), git: { branch: BRANCH, pr: PR } });
    const store = createStore(api);
    await store.load(WO_ID);
    await store.mergePr(7);
    expect(api.commands).toContainEqual({ type: 'workOrder.mergePr', id: WO_ID, number: 7 });
    // The stale dialog: the number on screen is not the ledger's — nothing merges.
    api.setCommandResult({ ok: false, code: 'not_found' });
    const stale = await store.mergePr(9);
    expect(api.commands).toContainEqual({ type: 'workOrder.mergePr', id: WO_ID, number: 9 });
    expect(stale.labelKey).toBe('error.not_found');
  });

  it('U-347: no optimistic merge — the card follows the refreshed query alone', async () => {
    const api = fakeApi({ ...detailReply(AT_BUILD), git: { branch: BRANCH, pr: PR } });
    const store = createStore(api);
    await store.load(WO_ID);
    await store.mergePr(7);
    // The reply still says open: only the next query's word moves the card, never the click.
    expect(store.state().view?.git?.pr?.merged).toBe(false);
  });

  it('U-348: the release door waits for the merge; branch_not_merged words the refusal', () => {
    const unmerged = doorOf({ branch: BRANCH, pr: PR }, null, 'release');
    expect(unmerged?.available).toBe(false);
    expect(unmerged?.reasonKey).toBe('detail.git.notMerged');
    expect(doorOf({ branch: BRANCH, pr: { ...PR, merged: true } }, null, 'release')?.available).toBe(true);
  });

  it('U-348: releaseBranch issues the command; the refusal reads the calm line', async () => {
    const api = fakeApi({ ...detailReply(AT_BUILD), git: { branch: BRANCH, pr: { ...PR, merged: true } } });
    const store = createStore(api);
    await store.load(WO_ID);
    const outcome = await store.releaseBranch();
    expect(api.commands).toContainEqual({ type: 'workOrder.releaseBranch', id: WO_ID });
    expect(outcome.labelKey).toBe('detail.git.release.success');
    api.setCommandResult({ ok: false, code: 'branch_not_merged' });
    const refused = await store.releaseBranch();
    expect(refused.labelKey).toBe('error.branch_not_merged');
    expect(TR['error.branch_not_merged']).toBe('Dal birleştirilmedi; silinemez.');
    expect(EN['error.branch_not_merged']).not.toBe(TR['error.branch_not_merged']);
  });

  it('U-358: Ana dala al… stands only in a forge-less repo, only with a read base, and never twice', () => {
    // A forge (healthy, unread or failing) offers no local merge door at all.
    expect(doorOf(undefined, null, 'mergeLocal')).toBeUndefined();
    expect(doorOf(undefined, { ok: true, base: 'main' }, 'mergeLocal')).toBeUndefined();
    expect(doorOf(undefined, { ok: false, code: 'forge_error' }, 'mergeLocal')).toBeUndefined();
    // Forge-less: open once the checkout's base is read; closed with one quiet line otherwise.
    expect(doorOf(undefined, NO_FORGE, 'mergeLocal', true, { ok: true, base: 'main' })?.available).toBe(true);
    const unread = doorOf(undefined, NO_FORGE, 'mergeLocal');
    expect(unread?.available).toBe(false);
    expect(unread?.reasonKey).toBe('detail.git.mergeLocal.noBase');
    expect(doorOf(undefined, NO_FORGE, 'mergeLocal', true, { ok: false, code: 'base_not_checked_out' })?.available).toBe(false);
    // The door precedes the release door; once merged it is gone and the card says so.
    const view = detailReply(AT_BUILD);
    expect(gitCard(view, NO_FORGE, true, { ok: true, base: 'main' })?.doors.map((door) => door.kind)).toEqual(['push', 'openPr', 'merge', 'mergeLocal', 'release']);
    const merged = gitCard({ ...view, git: { mergedLocal: { base: 'main', at: 9 } } }, NO_FORGE, true, { ok: true, base: 'main' });
    expect(merged?.mergedLocal).toEqual({ base: 'main' });
    expect(merged?.doors.map((door) => door.kind)).toEqual(['push', 'openPr', 'merge', 'release']);
  });

  it('U-358: Dalı sil opens after a local merge', () => {
    expect(doorOf({ mergedLocal: { base: 'main', at: 9 } }, NO_FORGE, 'release')?.available).toBe(true);
    expect(doorOf(undefined, NO_FORGE, 'release')?.available).toBe(false);
  });

  it('U-358: the localBase read follows a missing forge, carries its code, and the card stays visible after the merge', async () => {
    const api = fakeApi({ ...detailReply(AT_BUILD) });
    api.setGitBase({ ok: false, code: 'forge_unavailable' });
    api.setLocalBase({ ok: true, base: 'trunk' });
    const store = createStore(api);
    await store.load(WO_ID);
    expect(api.queries).toContainEqual({ type: 'workOrder.localBase', id: WO_ID });
    expect(store.state().localBase).toEqual({ ok: true, base: 'trunk' });
    // A forge that answers never asks for a local base.
    const withForge = fakeApi({ ...detailReply(AT_BUILD) });
    withForge.setGitBase({ ok: true, base: 'main' });
    await createStore(withForge).load(WO_ID);
    expect(withForge.queries.some((query) => query.type === 'workOrder.localBase')).toBe(false);
    // A merged card stays on screen even though no branch was ever pushed.
    const view: WorkOrderDetailView = { ...detailReply(AT_BUILD), git: { mergedLocal: { base: 'main', at: 9 } } };
    expect(gitCardVisible(view, gitCard(view, NO_FORGE, true, null), null)).toBe(true);
  });

  it('U-358: mergeLocal sends the base the dialog named; success reads Ana dala alındı; refusals read calm lines in both bundles', async () => {
    const api = fakeApi({ ...detailReply(AT_BUILD) });
    const store = createStore(api);
    await store.load(WO_ID);
    const outcome = await store.mergeLocal('trunk');
    expect(api.commands).toContainEqual({ type: 'workOrder.mergeLocal', id: WO_ID, base: 'trunk' });
    expect(outcome.labelKey).toBe('detail.git.mergeLocal.success');
    expect(TR['detail.git.mergeLocal.success']).toBe('Ana dala alındı.');
    expect(TR['detail.git.mergeLocal']).toBe('Ana dala al…');
    expect(TR['detail.git.mergedLocal']).toBe('Ana dala alındı');
    // The intent refreshes the detail query like every other: the card follows the ledger.
    expect(api.queries.filter((query) => query.type === 'workOrder.detail')).toHaveLength(2);
    for (const code of ['dirty_checkout', 'base_not_checked_out', 'conflict', 'already_merged', 'forge_configured', 'no_branch'] as const) {
      api.setCommandResult({ ok: false, code });
      const refused = await store.mergeLocal('trunk');
      expect(refused.labelKey).toBe(`error.${code}`);
      expect(TR[`error.${code}`].length).toBeGreaterThan(0);
      expect(EN[`error.${code}`]).not.toBe(TR[`error.${code}`]);
    }
  });

  it('U-349: the doors hold their fixed order and every closed door says one quiet line within eight words', () => {
    const model = gitCard(detailReply(AT_BUILD), null, true);
    expect(model?.doors.map((door) => door.kind)).toEqual(['push', 'openPr', 'merge', 'release']);
    for (const door of model?.doors ?? []) {
      if (door.available) continue;
      expect(door.reasonKey, `${door.kind} carries its reason`).toBeDefined();
      const key = door.reasonKey;
      if (key === undefined) continue;
      for (const bundle of [TR, EN]) {
        const words = bundle[key].split(/\s+/).filter((word) => word.length > 0).length;
        expect(words, `${key} in the bundle stays within eight words`).toBeLessThanOrEqual(8);
      }
    }
  });
});

// --- U-350 … U-353: the repo context ------------------------------------------------------------------

describe('repo context (U-350 … U-353)', () => {
  const CONTEXT = {
    path: '/clones/atolye',
    status: 'ok',
    project: { slug: 'atolye-proj', name: 'Atölye' },
    siblingCount: 2,
  } as const;

  it('U-351: a not-ok repo stands the card with every door closed and the one cause line — even with no worktree', () => {
    const view: WorkOrderDetailView = { ...detailReply(AT_BUILD), repoContext: { ...CONTEXT, status: 'relink_offered' } };
    // No working copy either: the not-ok repo is itself the standing the card exists to say.
    const model = gitCard(view, null, false);
    expect(model).not.toBeNull();
    expect(model?.repoReasonKey).toBe('detail.git.repo.relinkOffered');
    expect(model?.doors.every((door) => !door.available)).toBe(true);
    // The doors' own lifecycle reasons would name the wrong cause; the card carries one line.
    expect(model?.doors.every((door) => door.reasonKey === undefined)).toBe(true);
  });

  it('U-351: each not-ok standing words its own cause; an ok or absent context keeps the old matrix', () => {
    const standings = [
      ['folder_not_found', 'detail.git.repo.folderNotFound'],
      ['unregistered', 'detail.git.repo.unregistered'],
    ] as const;
    for (const [status, key] of standings) {
      const view: WorkOrderDetailView = { ...detailReply(AT_BUILD), repoContext: { ...CONTEXT, status } };
      expect(gitCard(view, null, true)?.repoReasonKey).toBe(key);
    }
    // Ok: the worktree decides the card, exactly as before the field existed.
    expect(gitCard({ ...detailReply(AT_BUILD), repoContext: { ...CONTEXT } }, null, false)).toBeNull();
    expect(gitCard({ ...detailReply(AT_BUILD), repoContext: { ...CONTEXT } }, null, true)?.repoReasonKey).toBeUndefined();
    // An older reply without repoContext reads as ok — never a crash, never a wrong cause.
    expect(gitCard(detailReply(AT_BUILD), null, true)?.repoReasonKey).toBeUndefined();
    expect(gitCard(detailReply(AT_BUILD), null, false)).toBeNull();
  });

  it('U-352: the repo cause copy lives in both bundles, one quiet line within eight words', () => {
    for (const key of ['detail.git.repo.folderNotFound', 'detail.git.repo.relinkOffered', 'detail.git.repo.unregistered']) {
      for (const bundle of [TR, EN]) {
        expect(bundle[key as keyof typeof bundle], `${key} in the bundle`).toBeDefined();
        const words = bundle[key as keyof typeof bundle].split(/\s+/).filter((word) => word.length > 0).length;
        expect(words, `${key} stays within eight words`).toBeLessThanOrEqual(8);
      }
    }
  });
});

describe('the autonomy control wiring (U-334)', () => {
  it('U-334: the view carries the chain read and the screen control renders it — level, source, disabled auto', async () => {
    const api = fakeApi({
      ...detailReply(AT_BUILD),
      autonomy: { level: 'manual', source: 'builtin', layerSet: false, autoUnavailable: 'auto_requires_spend_cap' },
    });
    const store = createStore(api);
    await store.load(WO_ID);
    expect(store.state().view?.autonomy).toEqual({
      level: 'manual',
      source: 'builtin',
      layerSet: false,
      autoUnavailable: 'auto_requires_spend_cap',
    });
    const html = renderToStaticMarkup(
      createElement(AutonomyControl, {
        locale: 'tr',
        mark: 'workOrder',
        view: store.state().view?.autonomy ?? null,
        onPick: () => {},
        onClear: () => {},
      }),
    );
    expect(html).toContain('Kaynak: yerleşik');
    expect(html).toContain('disabled');
  });

  it('U-334: setAutonomy speaks workOrder.setAutonomy and the refreshed read is the answer — never a toast outcome', async () => {
    const api = fakeApi({
      ...detailReply(AT_BUILD),
      autonomy: { level: 'manual', source: 'workOrder', layerSet: true },
    });
    const store = createStore(api);
    await store.load(WO_ID);
    const before = store.state().lastOutcome;

    const outcome = await store.setAutonomy('auto');

    expect(api.commands[api.commands.length - 1]).toEqual({ type: 'workOrder.setAutonomy', id: WO_ID, level: 'auto' });
    expect(outcome.result.ok).toBe(true);
    // The intent never publishes an outcome (the control's own refresh is the answer) and the
    // detail is re-queried so the control reads the new chain.
    expect(store.state().lastOutcome).toBe(before);
    expect(api.queries.filter((query) => query.type === 'workOrder.detail').length).toBeGreaterThanOrEqual(2);
  });

  it('U-334: a refused pick changes nothing on the screen — the reason line is the standing', async () => {
    const api = fakeApi({
      ...detailReply(AT_BUILD),
      autonomy: { level: 'manual', source: 'builtin', layerSet: false, autoUnavailable: 'auto_requires_spend_cap' },
    });
    api.setCommandResult({ ok: false, code: 'auto_requires_spend_cap' });
    const store = createStore(api);
    await store.load(WO_ID);

    const outcome = await store.setAutonomy('auto');

    expect(outcome.result).toEqual({ ok: false, code: 'auto_requires_spend_cap' });
    expect(store.state().view?.autonomy?.level).toBe('manual');
    expect(store.state().lastOutcome).toBeNull();
  });

  it('U-334: clearing the layer speaks the null level', async () => {
    const api = fakeApi({
      ...detailReply(AT_BUILD),
      autonomy: { level: 'manual', source: 'workOrder', layerSet: true },
    });
    const store = createStore(api);
    await store.load(WO_ID);
    await store.setAutonomy(null);
    expect(api.commands[api.commands.length - 1]).toEqual({ type: 'workOrder.setAutonomy', id: WO_ID, level: null });
  });

  it('U-335: the detail carries suggestion auto and restrictive stages; confirm calls setAutonomy("auto")', async () => {
    const api = fakeApi({
      ...detailReply(AT_BUILD),
      autonomy: {
        level: 'manual',
        source: 'builtin',
        layerSet: false,
        suggestion: 'auto',
        restrictiveStages: ['implement'],
      },
    });
    const store = createStore(api);
    await store.load(WO_ID);

    expect(store.state().view?.autonomy?.suggestion).toBe('auto');
    expect(store.state().view?.autonomy?.restrictiveStages).toEqual(['implement']);

    const html = renderToStaticMarkup(
      createElement(AutonomySuggestionBanner, {
        locale: 'tr',
        view: store.state().view?.autonomy ?? null,
        onConfirm: () => store.setAutonomy('auto'),
      }),
    );
    expect(html).toContain('Bu akış otomatik seviyeyi öneriyor');
    expect(html).toContain('implement');

    await store.setAutonomy('auto');
    expect(api.commands[api.commands.length - 1]).toEqual({ type: 'workOrder.setAutonomy', id: WO_ID, level: 'auto' });
  });
});


// --- #1277: the stage list's states and the git card's visibility --------------------------------------

describe('stage list standing (#1277)', () => {
  it('#1277: stages behind the current one are done, the current one is current, those ahead are upcoming', () => {
    const state = stateAt(STAGE_BUILD, [GATE_SECRET_SCAN]);
    const stages = stagesFor(FLOW, state);
    expect(stages.map((_, index) => stageListStanding(stages, index, false))).toEqual(['done', 'current', 'upcoming']);
  });

  it('#1277: the first stage current leaves every later stage upcoming — never done', () => {
    const state = stateAt(STAGE_PLAN, []);
    const stages = stagesFor(FLOW, state);
    expect(stages.map((_, index) => stageListStanding(stages, index, false))).toEqual(['current', 'upcoming', 'upcoming']);
  });

  it('#1277: a finished work order has every stage done', () => {
    const stages = stagesFor(FLOW, DONE);
    expect(stages.map((_, index) => stageListStanding(stages, index, true))).toEqual(['done', 'done', 'done']);
  });
});

describe('git card visibility (#1277)', () => {
  const view = detailReply(AT_BUILD);
  const model = gitCard(view, null, true);
  const READY_CHANGES = { state: 'ready' as const, files: [{ path: 'a.ts', added: 1, removed: 0, binary: false }], truncated: false };

  it('#1277: no changes, no branch, no pull request — no card', () => {
    expect(gitCardVisible(view, model, { state: 'ready', files: [], truncated: false })).toBe(false);
    expect(gitCardVisible(view, model, null)).toBe(false);
    expect(gitCardVisible(view, null, READY_CHANGES)).toBe(false);
  });

  it('#1277: changed files, a pushed branch or a pull request each bring the card', () => {
    expect(gitCardVisible(view, model, READY_CHANGES)).toBe(true);
    const branch = { name: 'docket/wo-x', head: 'a1b2c3d4', pushedAt: 1 };
    expect(gitCardVisible({ ...view, git: { branch } }, model, null)).toBe(true);
  });
});
