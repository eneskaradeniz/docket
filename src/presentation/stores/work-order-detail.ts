// stores/work-order-detail.ts — the work-order detail store (U-4): it derives, per stage of the
// work order's flow, the gate list with human-readable states; for a `deploy` gate it exposes the
// environment, whether it is protected, and the read-only promoteFrom chain (E-5). The approve
// intent enforces E-8 at the boundary: for a protected environment the typed confirmation must
// equal the environment name before `deploy.approve` is issued. Every intent maps its
// CommandResult through results.ts (U-8) and refreshes the detail query. Every detail load also
// reads `permissions.open` for the asks section and mounts the live pane on the work order's
// newest active run — composition creates that pane and hands it in.
import type { Api } from '../../api/api';
import type { Command, CommandResult } from '../../api/commands';
import type { OpenAskView, Query, StageFilesView, WorktreeFilePreview } from '../../api/queries';
import type {
  Actor,
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
import type { LivePaneStore } from './live-pane';
import { commandResultKey, isQueryFailure } from './results';

/** The coarse change events the api emits after any work-order or run change (docs/v2/ui.md,
 *  U-12). Notifications carry no payloads — the store re-queries. The wiring lands with U-12;
 *  tests inject a fake, so the type lives here until then. */
export type DetailChange =
  | { readonly type: 'workOrders.changed' }
  | { readonly type: 'run.updated'; readonly runId: string }
  | { readonly type: 'update.changed' }
  | { readonly type: 'accounts.changed' };

/** Subscription to the change events; the api's `subscribe` (U-12) satisfies it as-is. */
export type DetailChangeSignal = (listener: (change: DetailChange) => void) => () => void;

export interface WorkOrderDetailStoreDeps {
  readonly api: Pick<Api, 'query' | 'command'>;
  readonly changes: DetailChangeSignal;
  /** Every issued command travels as this actor — the detail screen acts as the user. */
  readonly actor: Actor;
  /** The live pane this store mounts for the work order's newest active run. Composition
   *  creates it; the screen renders it through the store, the only channel composition reaches
   *  the screen by. */
  readonly pane: LivePaneStore;
}

/** The detail reply narrowed to the fields the store reads (the api resolves `unknown`; this is
 *  the projection of the application's view the presentation is allowed to see). */
export interface WorkOrderDetailRecord {
  readonly id: string;
  readonly repo: string;
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
  /** The work order's A-29 number (U-22): the reply names its work order, so it numbers it. */
  readonly number: number;
  /** The work order own flow and the repo environments, carried by the detail query — the
   *  store needs no definitions loader of its own. */
  readonly flow: FlowDef;
  readonly environments: readonly EnvironmentDef[];
}

/** A permission ask shown in the detail's asks section, fed from `permissions.open` and scoped
 *  to the loaded work order's runs. The owning work order's title stands in for the tool when
 *  the ask still resolves to one, the ask id when it does not — never an invented tool name;
 *  the read carries no target, so none is claimed. */
export interface WorkOrderAskView {
  readonly runId: string;
  readonly askId: string;
  readonly tool: string;
  readonly target: string | null;
}

/** A gate's human-readable standing in this work order; label keys `gate.state.*` (U-1). */
export type GateStatus = 'pending' | 'passed' | 'upcoming';

/** Deploy-gate facts (U-4): the target environment, its protection, and the promoteFrom chain —
 *  read-only, from the repo definitions (E-5). */
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
  /** The definition's own name, present on the kinds that carry one (U-19: the flow strip and
   *  the ask card name the gate). */
  readonly label?: string;
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
  /** The per-stage gate list (U-4), derived from the view's flow, environments and state. */
  readonly stages: readonly StageGates[];
  /** The open asks of this work order's runs (from `permissions.open`), in the query's order. */
  readonly asks: readonly WorkOrderAskView[];
  /** The failure code of the latest failed query (or definitions load); null while healthy. */
  readonly problem: string | null;
  /** The latest intent's U-8 mapping; null before the first intent. */
  readonly lastOutcome: IntentOutcome | null;
  /** The stage files if the work order is currently awaiting_human. null otherwise. */
  readonly stageFiles: StageFilesView | null;
}

export interface GateDecideInput {
  readonly gate: string;
  readonly decision: 'approved' | 'rejected';
  readonly note?: string;
}

/** The pending changes gate's attestation (U-61): true — nothing needed changing; false — the
 *  run fell short and the stage goes again. */
export interface GateAttestInput {
  readonly gate: string;
  readonly noChangeNeeded: boolean;
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
  /** The live pane this store mounts for the work order's newest active run. */
  readonly pane: LivePaneStore;
  load(id: string): Promise<void>;
  state(): WorkOrderDetailState;
  decideGate(input: GateDecideInput): Promise<IntentOutcome>;
  attestNoChanges(input: GateAttestInput): Promise<IntentOutcome>;
  enqueue(): Promise<IntentOutcome>;
  answerPermission(input: PermissionAnswerInput): Promise<IntentOutcome>;
  approveDeploy(input: DeployApproveInput): Promise<IntentOutcome>;
  readStageFile(path: string): Promise<WorktreeFilePreview | null>;
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
      ...(gate.kind === 'human' || gate.kind === 'page_approval' ? { label: gate.label } : {}),
      ...(gate.kind === 'deploy' ? { deploy: deployGateView(environments, gate.environment) } : {}),
    })),
  }));
};

/** One chip of the detail's flow strip (U-19): a stage, or — sitting right after the current
 *  stage — one of its still-pending gates, the strip's dashed amber chip. */
export type FlowChip =
  | { readonly kind: 'stage'; readonly name: string; readonly standing: 'done' | 'current' | 'upcoming' }
  | { readonly kind: 'gate'; readonly name: string; readonly standing: 'pending' };

/** The strip: the stages in flow order — done behind the work order, the current one marked,
 *  the rest upcoming — with the current stage's pending gates named after it. Pure (U-19). */
export const flowChips = (stages: readonly StageGates[]): readonly FlowChip[] => {
  const currentAt = stages.findIndex((stage) => stage.current);
  return stages.flatMap((stage, index) => {
    const standing: 'done' | 'current' | 'upcoming' =
      currentAt === -1 || index < currentAt ? 'done' : index === currentAt ? 'current' : 'upcoming';
    const chips: FlowChip[] = [{ kind: 'stage', name: stage.name, standing }];
    if (standing === 'current') {
      for (const gate of stage.gates) {
        if (gate.status !== 'pending') continue;
        // A deploy gate has no definition label; its environment is the name a person reads.
        chips.push({ kind: 'gate', name: gate.label ?? gate.deploy?.environment ?? gate.id, standing: 'pending' });
      }
    }
    return chips;
  });
};

/** The honest map from a `permissions.open` row to what the asks section shows: the owning work
 *  order's title when the ask still resolves to one, the ask id when it does not; the read
 *  carries no target, so none is claimed. */
const toAskView = (row: OpenAskView): WorkOrderAskView => ({
  runId: row.runId,
  askId: row.askId,
  tool: row.title ?? row.askId,
  target: null,
});

/** The stage-files card is a convenience read riding the detail (U-57): a reply that is not
 *  exactly the view the api resolves to — a failure, an envelope, a list that is not a list —
 *  renders no card, never a crashed detail screen. */
const isStageFilesView = (value: unknown): value is StageFilesView => {
  if (typeof value !== 'object' || value === null) return false;
  const candidate = value as { readonly files?: unknown; readonly truncated?: unknown };
  if (!Array.isArray(candidate.files) || typeof candidate.truncated !== 'boolean') return false;
  return candidate.files.every(
    (file) =>
      typeof file === 'object' &&
      file !== null &&
      typeof (file as { readonly path?: unknown }).path === 'string',
  );
};

/** The preview pane is a convenience read too (U-57): the same stance — anything but the preview
 *  shape shows the read's failure copy, never a crash. */
const isWorktreeFilePreview = (value: unknown): value is WorktreeFilePreview => {
  if (typeof value !== 'object' || value === null) return false;
  const candidate = value as { readonly lines?: unknown; readonly truncated?: unknown };
  return (
    Array.isArray(candidate.lines) &&
    candidate.lines.every((line) => typeof line === 'string') &&
    typeof candidate.truncated === 'boolean'
  );
};

/** The asks section shows only the loaded work order's own asks — a run id the view knows is
 *  the one honest link the open-asks read carries. */
const asksFor = (
  rows: readonly OpenAskView[],
  view: WorkOrderDetailView | null,
): readonly WorkOrderAskView[] => {
  if (view === null) return [];
  const ownRuns = new Set(view.runs.map((run) => run.id));
  return rows.filter((row) => ownRuns.has(row.runId)).map(toAskView);
};

/** The work order's newest still-active run — the one the live pane mounts for. */
const newestActiveRun = (view: WorkOrderDetailView): string | undefined => {
  let newest: WorkOrderDetailRun | undefined;
  for (const run of view.runs) {
    if (run.endedAt !== undefined) continue;
    if (newest === undefined || run.startedAt > newest.startedAt) newest = run;
  }
  return newest?.id;
};

export const createWorkOrderDetailStore = (deps: WorkOrderDetailStoreDeps): WorkOrderDetailStore => {
  const { api, changes, actor, pane } = deps;

  let state: WorkOrderDetailState = {
    loading: false,
    view: null,
    stages: [],
    asks: [],
    problem: null,
    lastOutcome: null,
    stageFiles: null,
  };
  // The work order the store is bound to: change events re-query it, intents act on it.
  let workOrderId: string | null = null;
  // The raw `permissions.open` rows; the state's asks derive from these plus the loaded view on
  // every set, so whichever read lands second still shows a consistent section.
  let askRows: readonly OpenAskView[] = [];
  const listeners = new Set<() => void>();
  // Only the newest attempt may apply its reply: a slow earlier query must not overwrite a
  // fresher view when change events stack up.
  let attempts = 0;

  const set = (next: WorkOrderDetailState): void => {
    state = { ...next, asks: asksFor(askRows, next.view) };
    for (const listener of [...listeners]) listener();
  };

  /** The open asks ride every load: the section must exist the moment a work order opens, and
   *  an intent's refresh re-reads it, so an answered ask leaves the section at once. A failed
   *  read keeps the rows already shown — an error never blanks the section. */
  const loadAsks = async (): Promise<void> => {
    const reply: unknown = await api.query({ type: 'permissions.open' } satisfies Query);
    if (isQueryFailure(reply)) return;
    askRows = reply as readonly OpenAskView[];
    set({ ...state });
  };

  const load = async (id: string): Promise<void> => {
    const attempt = attempts + 1;
    attempts = attempt;
    workOrderId = id;
    set({ ...state, loading: true, problem: null });
    const detailRead = api.query({ type: 'workOrder.detail', id } satisfies Query);
    void loadAsks();
    const reply: unknown = await detailRead;
    if (attempt !== attempts) return;
    if (isQueryFailure(reply)) {
      // The previous view and gate list stay exactly as they were; only the problem appears.
      set({ ...state, loading: false, problem: reply.code, stageFiles: null });
      return;
    }
    // The contract of the detail query: a reply that is not a failure is the detail view, and
    // the query has already resolved the definitions server-side — the flow and the environments
    // ride the reply, so the stage list derives without a second read.
    const view = reply as WorkOrderDetailView;
    let stageFiles: StageFilesView | null = null;
    if (view.state.status === 'awaiting_human') {
      const stageFilesReply: unknown = await api.query({ type: 'workOrders.stageFiles', id } satisfies Query);
      if (isStageFilesView(stageFilesReply)) stageFiles = stageFilesReply;
    }
    if (attempt !== attempts) return;
    set({
      ...state,
      loading: false,
      view,
      stages: stageGates(view.flow, view.environments, view.state),
      problem: null,
      stageFiles,
    });
    // A run still going is mounted into the live pane; the pane itself ignores a repeat attach.
    const active = newestActiveRun(view);
    if (active !== undefined) void pane.attach(active);
  };

  // Gate decisions move the work order and runs move its state, so both event kinds trigger the
  // same re-query; the update channel does not — its state belongs to the settings surface.
  changes((change) => {
    if (change.type === 'update.changed') return;
    if (workOrderId === null) return;
    void load(workOrderId);
  });

  /** An intent with no loaded work order has nothing to act on; the refusal maps through U-8
   *  like any other failure and no command is issued. */
  const notLoadedOutcome = (command: Command['type']): IntentOutcome => {
    const result: CommandResult = { ok: false, code: 'not_found' };
    return { command, result, labelKey: commandResultKey(command, result) };
  };

  const runIntent = async (command: Command, successKey?: LabelKey): Promise<IntentOutcome> => {
    const result = await api.command(actor, command);
    const outcome: IntentOutcome = {
      command: command.type,
      result,
      labelKey: result.ok && successKey !== undefined ? successKey : commandResultKey(command.type, result),
    };
    set({ ...state, lastOutcome: outcome });
    // The detail mirrors its own mutation: the next query shows the command's effect.
    if (workOrderId !== null) await load(workOrderId);
    return outcome;
  };

  return {
    pane,
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
      return runIntent(
        {
          type: 'gate.decide',
          workOrderId,
          gate: input.gate,
          decision: input.decision,
          ...(input.note !== undefined ? { note: input.note } : {}),
        },
        // The decision's success names itself (U-19: 'Onaylandı.' / 'Reddedildi.'), where every
        // other intent's copy stays the command's own.
        input.decision === 'approved' ? 'success.gate.approved' : 'success.gate.rejected',
      );
    },
    attestNoChanges: (input) => {
      if (workOrderId === null) return Promise.resolve(notLoadedOutcome('gate.attest'));
      return runIntent(
        { type: 'gate.attest', workOrderId, gate: input.gate, noChangeNeeded: input.noChangeNeeded },
        // The attestation's two answers carry different news, so each names itself (U-61).
        input.noChangeNeeded ? 'success.gate.attestNoChange' : 'success.gate.attestRerun',
      );
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
    readStageFile: async (path: string) => {
      if (workOrderId === null) return null;
      const reply: unknown = await api.query({ type: 'workOrders.readStageFile', id: workOrderId, path } satisfies Query);
      return isWorktreeFilePreview(reply) ? reply : null;
    },
  };
};
