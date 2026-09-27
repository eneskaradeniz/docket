// stores/work-order-detail.ts — the work-order detail store (U-4): it derives, per stage of the
// work order's flow, the gate list with human-readable states; for a `deploy` gate it exposes the
// environment, whether it is protected, and the read-only promoteFrom chain (E-5). The approve
// intent enforces E-8 at the boundary: for a protected environment the typed confirmation must
// equal the environment name before `deploy.approve` is issued. Every intent maps its
// CommandResult through results.ts (U-8) and refreshes the detail query.
import type { Api } from '../../api/api';
import type { Command, CommandResult } from '../../api/commands';
import type { Query } from '../../api/queries';
import type {
  Actor,
  Definitions,
  EnvSlug,
  EnvironmentDef,
  FlowAction,
  FlowDef,
  GateDef,
  GateSlug,
  RunOutcome,
  StageSlug,
  WorkOrderState,
} from '../../domain/index';
import type { LabelKey } from '../labels/keys';
import { commandResultKey, isQueryFailure } from './results';

/** The coarse change events the api emits after any work-order or run change (docs/v2/ui.md,
 *  U-12). Notifications carry no payloads — the store re-queries. The wiring lands with U-12;
 *  tests inject a fake, so the type lives here until then. */
export type DetailChange =
  | { readonly type: 'workOrders.changed' }
  | { readonly type: 'run.updated'; readonly runId: string };

/** Subscription to the change events; the api's `subscribe` (U-12) satisfies it as-is. */
export type DetailChangeSignal = (listener: (change: DetailChange) => void) => () => void;

export interface WorkOrderDetailStoreDeps {
  readonly api: Pick<Api, 'query' | 'command'>;
  readonly changes: DetailChangeSignal;
  /** Every issued command travels as this actor — the detail screen acts as the user. */
  readonly actor: Actor;
  /** The workspace's definitions: the flow's gate list and the environment defs (protected,
   *  promoteFrom) live there. The api surface that will serve this lands with the screens
   *  wiring; tests inject a fake, so the type lives here until then. */
  readonly definitions: (workspace: string) => Promise<Definitions | null>;
}

/** The detail reply narrowed to the fields the store reads (the api resolves `unknown`; this is
 *  the projection of the application's view the presentation is allowed to see). */
export interface WorkOrderDetailRecord {
  readonly id: string;
  readonly workspace: string;
  readonly flow: string;
  readonly title: string;
}

export interface WorkOrderDetailRun {
  readonly id: string;
  readonly stage: string;
  readonly startedAt: number;
  readonly endedAt?: number;
  readonly outcome?: RunOutcome;
}

export interface WorkOrderDetailView {
  readonly record: WorkOrderDetailRecord;
  readonly state: WorkOrderState;
  readonly next: FlowAction;
  readonly runs: readonly WorkOrderDetailRun[];
}

/** A gate's human-readable standing in this work order; label keys `gate.state.*` (U-1). */
export type GateStatus = 'pending' | 'passed' | 'upcoming';

/** Deploy-gate facts (U-4): the target environment, its protection, and the promoteFrom chain —
 *  read-only, from the workspace definitions (E-5). */
export interface DeployGateView {
  readonly environment: EnvSlug;
  readonly protectedEnvironment: boolean;
  /** The promotion prerequisites, immediate first (prod → [staging, dev]). */
  readonly promoteFromChain: readonly EnvSlug[];
}

export interface GateView {
  readonly id: GateSlug;
  readonly kind: GateDef['kind'];
  readonly status: GateStatus;
  /** Present only for `deploy` gates. */
  readonly deploy?: DeployGateView;
}

/** One stage's gates, in flow order; `current` marks the work order's stage. */
export interface StageGates {
  readonly stage: StageSlug;
  readonly name: string;
  readonly current: boolean;
  readonly gates: readonly GateView[];
}

/** What every intent reports: the raw CommandResult plus its U-8 copy key — the screen toasts
 *  the key's text; nothing else ever renders a result. */
export interface IntentOutcome {
  readonly command: Command['type'];
  readonly result: CommandResult;
  readonly labelKey: LabelKey;
}

export interface WorkOrderDetailState {
  readonly loading: boolean;
  /** The last successful query's view; null only before the first success. A failed query
   *  leaves it verbatim on screen. */
  readonly view: WorkOrderDetailView | null;
  /** The per-stage gate list (U-4), derived from the definitions and the derived state. */
  readonly stages: readonly StageGates[];
  /** The failure code of the latest failed query (or definitions load); null while healthy. */
  readonly problem: string | null;
  /** The latest intent's U-8 mapping; null before the first intent. */
  readonly lastOutcome: IntentOutcome | null;
}

export interface GateDecideInput {
  readonly gate: string;
  readonly decision: 'approved' | 'rejected';
  readonly note?: string;
}

export interface PermissionAnswerInput {
  readonly runId: string;
  readonly askId: string;
  readonly decision: 'allow' | 'deny';
}

export interface DeployApproveInput {
  readonly gate: string;
  readonly commit: string;
  /** What the user typed to confirm a protected environment (E-8); travels verbatim. */
  readonly confirmedEnvironment?: string;
}

export interface WorkOrderDetailStore {
  load(id: string): Promise<void>;
  state(): WorkOrderDetailState;
  decideGate(input: GateDecideInput): Promise<IntentOutcome>;
  enqueue(): Promise<IntentOutcome>;
  answerPermission(input: PermissionAnswerInput): Promise<IntentOutcome>;
  approveDeploy(input: DeployApproveInput): Promise<IntentOutcome>;
  subscribe(listener: () => void): () => void;
}

/** The promoteFrom chain of an environment, immediate prerequisite first. Validation (E-5)
 *  guarantees the chain is acyclic; the visited guard only keeps a degenerate definition from
 *  hanging the store. */
const promoteFromChain = (
  environments: readonly EnvironmentDef[],
  first: EnvSlug | undefined,
): readonly EnvSlug[] => {
  if (first === undefined) return [];
  const chain: EnvSlug[] = [];
  const seen = new Set<string>();
  let current: EnvSlug | undefined = first;
  while (current !== undefined && !seen.has(current)) {
    chain.push(current);
    seen.add(current);
    current = environments.find((candidate) => candidate.id === current)?.promoteFrom;
  }
  return chain;
};

const deployGateView = (
  environments: readonly EnvironmentDef[],
  environment: EnvSlug,
): DeployGateView => {
  const definition = environments.find((candidate) => candidate.id === environment);
  return {
    environment,
    protectedEnvironment: definition?.protected ?? false,
    promoteFromChain: promoteFromChain(environments, definition?.promoteFrom),
  };
};

const gateStatus = (
  state: WorkOrderState,
  index: number,
  currentIndex: number,
  gate: GateSlug,
): GateStatus => {
  // Done is terminal: the list renders as history, every gate behind the work order.
  if (state.stage === null) return 'passed';
  if (index === currentIndex) return state.pendingGates.includes(gate) ? 'pending' : 'passed';
  return index < currentIndex ? 'passed' : 'upcoming';
};

const stageGates = (
  flow: FlowDef,
  environments: readonly EnvironmentDef[],
  state: WorkOrderState,
): readonly StageGates[] => {
  const currentIndex =
    state.stage === null ? flow.stages.length : flow.stages.findIndex((stage) => stage.id === state.stage);
  return flow.stages.map((stage, index) => ({
    stage: stage.id,
    name: stage.name,
    current: state.stage !== null && index === currentIndex,
    gates: stage.exit.map((gate) => ({
      id: gate.id,
      kind: gate.kind,
      status: gateStatus(state, index, currentIndex, gate.id),
      ...(gate.kind === 'deploy' ? { deploy: deployGateView(environments, gate.environment) } : {}),
    })),
  }));
};

export const createWorkOrderDetailStore = (deps: WorkOrderDetailStoreDeps): WorkOrderDetailStore => {
  const { api, changes, actor, definitions } = deps;

  let state: WorkOrderDetailState = {
    loading: false,
    view: null,
    stages: [],
    problem: null,
    lastOutcome: null,
  };
  // The work order the store is bound to: change events re-query it, intents act on it.
  let workOrderId: string | null = null;
  const listeners = new Set<() => void>();
  // Only the newest attempt may apply its reply: a slow earlier query must not overwrite a
  // fresher view when change events stack up.
  let attempts = 0;

  const set = (next: WorkOrderDetailState): void => {
    state = next;
    for (const listener of [...listeners]) listener();
  };

  const load = async (id: string): Promise<void> => {
    const attempt = attempts + 1;
    attempts = attempt;
    workOrderId = id;
    set({ ...state, loading: true, problem: null });
    const reply: unknown = await api.query({ type: 'workOrder.detail', id } satisfies Query);
    if (attempt !== attempts) return;
    if (isQueryFailure(reply)) {
      // The previous view and gate list stay exactly as they were; only the problem appears.
      set({ ...state, loading: false, problem: reply.code });
      return;
    }
    // The contract of the detail query: a reply that is not a failure is the detail view.
    const view = reply as WorkOrderDetailView;
    const defs = await definitions(view.record.workspace);
    if (attempt !== attempts) return;
    if (defs === null) {
      set({ ...state, loading: false, view, stages: [], problem: 'definitions_invalid' });
      return;
    }
    const flow = defs.flows.find((candidate) => candidate.id === view.record.flow);
    if (flow === undefined) {
      set({ ...state, loading: false, view, stages: [], problem: 'unknown_flow' });
      return;
    }
    set({
      ...state,
      loading: false,
      view,
      stages: stageGates(flow, defs.workspace?.environments ?? [], view.state),
      problem: null,
    });
  };

  // Both event kinds concern the detail — gate decisions move the work order and runs move its
  // state — so every notification triggers the same re-query.
  changes(() => {
    if (workOrderId === null) return;
    void load(workOrderId);
  });

  /** An intent with no loaded work order has nothing to act on; the refusal maps through U-8
   *  like any other failure and no command is issued. */
  const notLoadedOutcome = (command: Command['type']): IntentOutcome => {
    const result: CommandResult = { ok: false, code: 'not_found' };
    return { command, result, labelKey: commandResultKey(command, result) };
  };

  const runIntent = async (command: Command): Promise<IntentOutcome> => {
    const result = await api.command(actor, command);
    const outcome: IntentOutcome = {
      command: command.type,
      result,
      labelKey: commandResultKey(command.type, result),
    };
    set({ ...state, lastOutcome: outcome });
    // The detail mirrors its own mutation: the next query shows the command's effect.
    if (workOrderId !== null) await load(workOrderId);
    return outcome;
  };

  return {
    load,
    state: () => state,
    subscribe: (listener) => {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
    decideGate: (input) => {
      if (workOrderId === null) return Promise.resolve(notLoadedOutcome('gate.decide'));
      return runIntent({
        type: 'gate.decide',
        workOrderId,
        gate: input.gate,
        decision: input.decision,
        ...(input.note !== undefined ? { note: input.note } : {}),
      });
    },
    enqueue: () => {
      if (workOrderId === null) return Promise.resolve(notLoadedOutcome('workOrder.enqueue'));
      return runIntent({ type: 'workOrder.enqueue', id: workOrderId });
    },
    answerPermission: (input) => {
      // Permission asks belong to runs, not the work order, so this intent needs no loaded view.
      return runIntent({
        type: 'permission.answer',
        runId: input.runId,
        askId: input.askId,
        decision: input.decision,
      });
    },
    approveDeploy: (input) => {
      if (workOrderId === null) return Promise.resolve(notLoadedOutcome('deploy.approve'));
      // E-8 at the intent boundary: a protected environment's approve fires only when the typed
      // confirmation equals the environment name. The command is never sent otherwise; the use
      // case remains the security boundary for everything the store cannot see.
      const current = state.stages.find((stage) => stage.current);
      const deployGate = current?.gates.find((gate) => gate.id === input.gate && gate.deploy !== undefined);
      if (
        deployGate !== undefined &&
        deployGate.deploy !== undefined &&
        deployGate.deploy.protectedEnvironment &&
        input.confirmedEnvironment !== deployGate.deploy.environment
      ) {
        const result: CommandResult = { ok: false, code: 'confirmation_mismatch' };
        const outcome: IntentOutcome = {
          command: 'deploy.approve',
          result,
          labelKey: commandResultKey('deploy.approve', result),
        };
        set({ ...state, lastOutcome: outcome });
        return Promise.resolve(outcome);
      }
      return runIntent({
        type: 'deploy.approve',
        workOrderId,
        gate: input.gate,
        commit: input.commit,
        ...(input.confirmedEnvironment !== undefined ? { confirmedEnvironment: input.confirmedEnvironment } : {}),
      });
    },
  };
};
