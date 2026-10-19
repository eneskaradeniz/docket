// stores/work-order-detail.ts — the work-order detail store (U-4, Phase A #972): it derives, per
// stage of the work order's flow, the gate list with human-readable states; for a `deploy` gate it
// exposes the environment, whether it is protected, and the read-only promoteFrom chain (E-5). The
// approve intent enforces E-8 at the boundary: for a protected environment the typed confirmation
// must equal the environment name before `deploy.approve` is issued. Every intent maps its
// CommandResult through results.ts (U-8) and refreshes the detail query. Every detail load also
// reads `permissions.open` for the decision zone's permission cards, `workOrder.changes` for the
// read-only changed-files list (U-231), and — on a failed standing — the failed run's event tail
// for the one-line error quote. The view-model rules U-223, U-224, U-226, U-229 and U-230 live in
// the pure derivations at the bottom of this file; the screen renders them and forwards clicks.
import type { Api } from '../../api/api';
import type { Command, CommandResult } from '../../api/commands';
import type { OpenAskView, Query, UsageSummaryView } from '../../api/queries';
import type {
  Actor,
  AgentEvent,
  CostByKind,
  CostDisplay,
  EnvironmentDef,
  FlowAction,
  FlowDef,
  GateDef,
  GateSlug,
  GitLifecycleState,
  GitPrState,
  RunOutcome,
  StageSlug,
  VerdictAskDetail,
  WorkOrderId,
  WorkOrderState,
} from '../../domain/index';
import { costDisplay, workOrderBranch } from '../../domain/index';
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
  | { readonly type: 'accounts.changed' }
  // The chat members (U-97) ride the same push channel; stores that do not serve a chat ignore them.
  | { readonly type: 'chat.turn'; readonly conversation: string; readonly turn: string; readonly phase: 'started' | 'finished'; readonly outcome?: string }
  | { readonly type: 'chat.delta'; readonly conversation: string; readonly turn: string; readonly text: string }
  | { readonly type: 'chat.notice'; readonly conversation: string; readonly turn: string; readonly code: string }
  | { readonly type: 'setup.read.ask'; readonly conversation: string }
  | { readonly type: 'quit.requested'; readonly runs: readonly string[]; readonly chats: readonly string[] };

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
  /** The record's own creation stamp — the header's “açılış” fact (the reply carries it). */
  readonly createdAt?: number;
}

export interface WorkOrderDetailRun {
  readonly id: string;
  readonly stage: string;
  readonly attempt: number;
  readonly startedAt: number;
  readonly endedAt?: number;
  readonly outcome?: RunOutcome;
  readonly flowVersion?: number;
  readonly roleVersion?: number;
}

/** One run summary of the detail reply (#969): who ran it, on what, and the folded usage —
 *  `account.label` is the stored account id when the account is gone (U-230). */
export interface WorkOrderRunSummary {
  readonly runId: string;
  readonly stage: string;
  readonly attempt: number;
  readonly role: string;
  readonly account: { readonly id: string; readonly label: string; readonly provider: string };
  readonly model?: string;
  readonly billing: 'pay_per_use' | 'included' | 'unknown';
  readonly usage?: {
    readonly inputTokens: number;
    readonly outputTokens: number;
    readonly cachedInputTokens: number;
    readonly costByKind: CostByKind;
  };
  /** Whether the run's transport accepts a steering note; absent on an older reply reads as unknown. */
  readonly canSteer?: boolean | 'unknown';
}

/** One remote-checks evaluation row of the detail reply (#1146): the verdict the dispatcher
 *  recorded and the checks it was reduced from. The verdict status travels as the reply's own
 *  word; `url` never arrives — the evidence records none. */
export interface WorkOrderGateRow {
  readonly gate: string;
  readonly stage: string;
  readonly verdict?: { readonly status: string; readonly reason?: string };
  readonly at: number;
  readonly checks: readonly { readonly name: string; readonly status: string; readonly url?: string }[];
}

/** One decided human gate of the detail reply (A-411): the decision's own words, and — when the
 *  gate-auto policy decided it — the evidence the approval relied on; a human decision carries
 *  none. Rows arrive in event order, so the last row of a gate is its latest decision. */
export interface WorkOrderGateDecisionRow {
  readonly gate: string;
  readonly stage: string;
  readonly decision: 'approved' | 'rejected';
  readonly at: number;
  readonly approvedByPolicy?: { readonly policy: string; readonly level: string; readonly passedMachineGates: readonly string[] };
}

/** One decided stage-skip proposal of the detail reply (A-433, U-360): the decision's own words,
 *  and — when the stage-skip-auto policy decided it — the policy evidence; a human decision carries
 *  none. Rows arrive in event order. */
export interface WorkOrderStageSkipDecisionRow {
  readonly stages: readonly string[];
  readonly decision: 'approved' | 'rejected';
  readonly at: number;
  readonly reason?: string;
  readonly decidedByPolicy?: { readonly policy: string; readonly level: string };
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
  /** One summary per run (#969); absent only on a reply older than the field. */
  readonly runSummaries?: readonly WorkOrderRunSummary[];
  /** The remote_checks gates' evaluation rows (#1146, A-378); absent on an older reply. */
  readonly gates?: readonly WorkOrderGateRow[];
  /** The human gates' decision rows (A-411); absent on an older reply reads as no decision shown. */
  readonly decisions?: readonly WorkOrderGateDecisionRow[];
  /** The stage-skip decision rows (A-433, U-360); absent on an older reply reads as no decisions shown. */
  readonly skipDecisions?: readonly WorkOrderStageSkipDecisionRow[];
  /** The git lifecycle fold (#1167, A-390): branch, pull request and release marks as the
   *  reply's own derived state — never re-derived here from events; absent on an older reply. */
  readonly git?: GitLifecycleState;
  /** The repo context (#1178, A-392): the registered folder's standing, the owning project's
   *  own name and its other-repo count; absent on an older reply reads as ok — the context
   *  line and the git card's cause line simply stay quiet. */
  readonly repoContext?: WorkOrderDetailRepoContext;
  /** The effective autonomy block (A-404/A-407, U-334): the level in force with its source, the
   *  work-order layer's own standing, and the typed refusal that disables an `auto` pick.
   *  Absent on an older reply or an unreadable chain — the control simply stays quiet. */
  readonly autonomy?: WorkOrderDetailAutonomy;
}

/** The autonomy read the control renders (A-407): the projection of the application's
 *  WorkOrderAutonomyView, plain strings on the wire. */
export interface WorkOrderDetailAutonomy {
  readonly level: 'manual' | 'balanced' | 'auto';
  readonly source: string;
  readonly layerSet: boolean;
  readonly autoUnavailable?: string;
  readonly suggestion?: 'auto';
  readonly restrictiveStages?: readonly string[];
}

/** The repo context the detail reply carries, narrowed to what the presentation reads (A-392). */
export interface WorkOrderDetailRepoContext {
  readonly path: string;
  readonly status: 'ok' | 'folder_not_found' | 'relink_offered' | 'unregistered';
  readonly project: { readonly slug: string; readonly name: string };
  readonly siblingCount: number;
}

/** A permission ask shown in the decision zone, fed from `permissions.open` and scoped to the
 *  loaded work order's runs. The tool and its target (the command or path) come from the asking
 *  run's own `permission_ask` event; until that read lands — or when the stream no longer holds
 *  the ask — the ask id stands in for the tool and no target is claimed, never an invented one. */
export interface WorkOrderAskView {
  readonly runId: string;
  readonly askId: string;
  readonly tool: string;
  readonly target: string | null;
  /** The verdict a reviewer is about to submit, when the ask is for Docket's verdict tool and its
   *  event carried the bounded detail; absent for every other ask. */
  readonly detail?: VerdictAskDetail;
}

/** A gate's human-readable standing in this work order; label keys `gate.state.*` (U-1). */
export type GateStatus = 'pending' | 'passed' | 'upcoming';

/** Deploy-gate facts (U-4): the target environment, its protection, and the promoteFrom chain —
 *  read-only, from the repo definitions (E-5). */
export interface DeployGateView {
  readonly environment: string;
  readonly protectedEnvironment: boolean;
  /** The promotion prerequisites, immediate first (prod → [staging, dev]). */
  readonly promoteFromChain: readonly string[];
}

export interface GateView {
  readonly id: GateSlug;
  readonly kind: GateDef['kind'];
  readonly status: GateStatus;
  /** The definition's own name, present on the kinds that carry one (U-19: the decision card
   *  names the gate). */
  readonly label?: string;
  /** Present only for `deploy` gates. */
  readonly deploy?: DeployGateView;
  /** The latest decision's policy evidence (A-411, U-355), present only when the gate-auto
   *  policy decided it — a human decision carries none, so the row stays as it always was. */
  readonly policyApproval?: NonNullable<WorkOrderGateDecisionRow['approvedByPolicy']>;
}

/** One stage's gates, in flow order; `current` marks the work order's stage. The role decides the
 *  provenance word (U-230): the reviewer role reads “inceleyen”, every other “yazan”. */
export interface StageGates {
  readonly stage: StageSlug;
  readonly name: string;
  readonly role: string | null;
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

/** The read-only changed-files list of `workOrder.changes` (#969, U-231). `state` says why the
 *  list is empty: `no_worktree` (no working copy to measure) and `unavailable` (a git failure —
 *  never “no changes”) each carry their own calm line. */
export interface WorkOrderChangeFile {
  readonly path: string;
  readonly added: number;
  readonly removed: number;
  readonly binary: boolean;
}

export interface WorkOrderChangesView {
  readonly state: 'ready' | 'no_worktree' | 'unavailable';
  readonly files: readonly WorkOrderChangeFile[];
  readonly truncated: boolean;
}

export interface WorkOrderDetailState {
  readonly loading: boolean;
  /** The last successful query's view; null only before the first success. A failed query
   *  leaves it verbatim on screen. */
  readonly view: WorkOrderDetailView | null;
  /** The per-stage gate list (U-4), derived from the view's flow, environments and state. */
  readonly stages: readonly StageGates[];
  /** The stage-skip decision rows (A-433, U-360). */
  readonly skipDecisions: readonly WorkOrderStageSkipDecisionRow[];
  /** The open asks of this work order's runs (from `permissions.open`), in the query's order. */
  readonly asks: readonly WorkOrderAskView[];
  /** The failure code of the latest failed query; null while healthy. */
  readonly problem: string | null;
  /** The latest intent's U-8 mapping; null before the first intent. */
  readonly lastOutcome: IntentOutcome | null;
  /** The read-only changed-files list; null before the first read or after a failed one. */
  readonly changes: WorkOrderChangesView | null;
  /** The newest failed run's last spoken line, quoted by the failed card (U-226); null when the
   *  standing is not a failure or the run said nothing. */
  readonly lastErrorLine: string | null;
  /** The asking run's already-allowed asks — the permission card's collapsed “{n} izin verildi” line
   *  (U-226); counts every allowed ask, human or policy; 0 renders no line. */
  readonly autoAllowed: number;
  /** The folded usage read (#1112); null before the first reply or while the first read runs. */
  readonly usageSummary: UsageSummaryView | null;
  /** True when the latest `usage.summary` read failed; the detail view stays on screen. */
  readonly usageSummaryFailed: boolean;
  /** The forge default-branch read (A-391); null before the first reply or on a reply the guard
   *  cannot read — the PR dialog's prefill and the push door's reason both read it. */
  readonly gitBase: GitBaseRead | null;
  /** The checked-out branch a local merge would land on (A-426); read only while the repo has
   *  no forge, null before the first reply. */
  readonly localBase: GitBaseRead | null;
}

/** The `workOrder.gitBase` reply narrowed (A-391): the default branch on success, the typed code
 *  on failure. */
export type GitBaseRead =
  | { readonly ok: true; readonly base: string }
  | { readonly ok: false; readonly code: string };

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

/** The PR dialog's fields (U-346): the base is required, the title optional — the use case
 *  falls back to the work order's own title. Both travel verbatim. */
export interface GitOpenPrInput {
  readonly base: string;
  readonly title?: string;
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
  /** Stops the live run (`run.stop`, U-302) — a request: the card itself leaves only when the
   *  work order's changed event shows the ended run. */
  stopRun(runId: string): Promise<IntentOutcome>;
  /** Sends the live run a steering note (`run.steer`, U-303). */
  steerRun(runId: string, note: string): Promise<IntentOutcome>;
  /** Closes the work order (`workOrder.close`) — the ⋯ menu's one item (U-226). */
  closeWorkOrder(): Promise<IntentOutcome>;
  /** Sets (or clears, with `null`) the work-order layer of the autonomy chain (U-334, A-403).
   *  The command never toasts: the refreshed detail read is the answer the control shows. */
  setAutonomy(level: 'manual' | 'auto' | null): Promise<IntentOutcome>;
  /** Pushes the work order's branch (`workOrder.push`, U-345); the door itself words the
   *  missing-forge reason, so the command's own refusal only answers the late cases. */
  push(): Promise<IntentOutcome>;
  /** Opens the pull request (`workOrder.openPr`, U-346) — base and the optional title travel
   *  verbatim; the api bounds them. */
  openPr(input: GitOpenPrInput): Promise<IntentOutcome>;
  /** Merges the pull request (`workOrder.mergePr`, U-347) — the number the confirm dialog
   *  restated travels verbatim; a stale number is the typed refusal, never a wrong merge. */
  mergePr(number: number): Promise<IntentOutcome>;
  /** Merges the work-order branch into the base the confirm named (`workOrder.mergeLocal`,
   *  U-358) — the base travels as the approval pin. */
  mergeLocal(base: string): Promise<IntentOutcome>;
  /** Releases the branch and worktree (`workOrder.releaseBranch`, U-348). */
  releaseBranch(): Promise<IntentOutcome>;
  /** Re-reads `usage.summary` for the loaded work order (the usage line's retry). */
  reloadUsageSummary(): Promise<void>;
  subscribe(listener: () => void): () => void;
}

/** Pay-per-use money and subscription equivalent totals split per run (#1112, decision 4). */
export interface WorkOrderUsageMoney {
  readonly payPerUseUsd: number | null;
  readonly payPerUseEstimate: boolean;
  readonly includedEquivalentUsd: number | null;
}

export const workOrderUsageMoney = (view: WorkOrderDetailView): WorkOrderUsageMoney => {
  let payUsd = 0;
  let payEstimate = false;
  let hasPay = false;
  let equivUsd = 0;
  let hasEquiv = false;
  for (const row of view.runSummaries ?? []) {
    if (row.usage === undefined) continue;
    const display = costDisplay(row.usage.costByKind, row.billing);
    if (display.kind === 'money') {
      hasPay = true;
      payUsd += display.usd;
      if (display.estimate) payEstimate = true;
    }
    if (display.kind === 'tokens' && display.equivalentUsd !== undefined) {
      hasEquiv = true;
      equivUsd += display.equivalentUsd;
    }
  }
  return {
    payPerUseUsd: hasPay ? payUsd : null,
    payPerUseEstimate: payEstimate,
    includedEquivalentUsd: hasEquiv ? equivUsd : null,
  };
};

/** The promoteFrom chain of an environment, immediate prerequisite first. Validation (E-5)
 *  guarantees the chain is acyclic; the visited guard only keeps a degenerate definition from
 *  hanging the store. */
const promoteFromChain = (
  environments: readonly EnvironmentDef[],
  first: string | undefined,
): readonly string[] => {
  if (first === undefined) return [];
  const chain: string[] = [];
  const seen = new Set<string>();
  let current: string | undefined = first;
  while (current !== undefined && !seen.has(current)) {
    chain.push(current);
    seen.add(current);
    current = environments.find((candidate) => candidate.id === current)?.promoteFrom;
  }
  return chain;
};

const deployGateView = (
  environments: readonly EnvironmentDef[],
  environment: string,
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
  decisions: readonly WorkOrderGateDecisionRow[] = [],
): readonly StageGates[] => {
  const currentIndex =
    state.stage === null ? flow.stages.length : flow.stages.findIndex((stage) => stage.id === state.stage);
  // Rows arrive in event order, so the last row of a gate is its latest decision — a later human
  // re-decision after a stage re-entry replaces an older policy approval, exactly as it should.
  const policyApprovalByGate = new Map<string, NonNullable<WorkOrderGateDecisionRow['approvedByPolicy']>>();
  for (const row of decisions) {
    if (row.approvedByPolicy !== undefined) policyApprovalByGate.set(row.gate, row.approvedByPolicy);
    else policyApprovalByGate.delete(row.gate);
  }
  return flow.stages.map((stage, index) => ({
    stage: stage.id,
    name: stage.name,
    role: stage.role,
    current: state.stage !== null && index === currentIndex,
    gates: stage.exit.map((gate) => ({
      id: gate.id,
      kind: gate.kind,
      status: gateStatus(state, index, currentIndex, gate.id),
      ...(gate.kind === 'human' || gate.kind === 'page_approval' ? { label: gate.label } : {}),
      ...(gate.kind === 'deploy' ? { deploy: deployGateView(environments, gate.environment) } : {}),
      ...(policyApprovalByGate.has(gate.id) ? { policyApproval: policyApprovalByGate.get(gate.id) } : {}),
    })),
  }));
};

// --- U-223: one badge, one word per state -----------------------------------------------------------

export type DetailBadgeTone = 'info' | 'proceed' | 'signal' | 'error';

/** The header's one status badge (U-223): a single word per state, said once. The failure
 *  standings carry their sub-line (“deneme hakkı var/bitti”); “Engellendi” is never used — the
 *  block standing is a failure with no attempts left. */
export interface DetailBadge {
  readonly tone: DetailBadgeTone;
  readonly wordKey: LabelKey;
  readonly pulse: boolean;
  readonly subKey?: LabelKey;
}

/** Only a person answers these two kinds; every other gate is machine-evaluated. */
const isHumanDecision = (gate: GateView): boolean => gate.kind === 'human' || gate.kind === 'page_approval';

/** The failed standing of a `ready` stage: the stage re-entered after a failed run of the
 *  previous attempt (the fold's R-21), so the badge names the failure, not the readiness. */
export const isFailedStanding = (view: WorkOrderDetailView): boolean => {
  if (view.state.status !== 'ready' || view.state.stage === null || view.state.attempt <= 1) return false;
  return view.runs.some(
    (run) => run.stage === view.state.stage && run.attempt === view.state.attempt - 1 && run.outcome === 'failed',
  );
};

/** One word for the standing (U-223, table-driven by the tests over every state). */
export const detailBadge = (
  stages: readonly StageGates[],
  view: WorkOrderDetailView,
  asks: readonly WorkOrderAskView[],
): DetailBadge => {
  if (asks.length > 0) return { tone: 'signal', wordKey: 'detail.badge.permission', pulse: true };
  const current = stages.find((stage) => stage.current);
  const pending = (current?.gates ?? []).filter((gate) => gate.status === 'pending');
  const pendingDeploy = pending.some((gate) => gate.kind === 'deploy');
  const humanPending = pending.filter(isHumanDecision);
  switch (view.state.status) {
    case 'ready':
      return isFailedStanding(view)
        ? { tone: 'error', wordKey: 'run.outcome.failed', subKey: 'detail.badge.retryLeft', pulse: false }
        : { tone: 'info', wordKey: 'wo.status.ready', pulse: false };
    case 'running':
      return { tone: 'proceed', wordKey: 'wo.status.running', pulse: true };
    case 'gating':
      return pendingDeploy
        ? { tone: 'signal', wordKey: 'detail.badge.deployWaiting', pulse: false }
        : { tone: 'info', wordKey: 'wo.status.gating', pulse: false };
    case 'awaiting_human':
      if (pendingDeploy) return { tone: 'signal', wordKey: 'detail.badge.deployWaiting', pulse: false };
      if (humanPending.length >= 2) return { tone: 'signal', wordKey: 'detail.badge.multi', pulse: false };
      if (humanPending.length === 1) return { tone: 'signal', wordKey: 'detail.badge.awaiting', pulse: false };
      // A no-role stage holds machine gates a person cannot answer; the word stays honest.
      return { tone: 'info', wordKey: 'wo.status.gating', pulse: false };
    case 'limit_waiting':
      return { tone: 'info', wordKey: 'wo.status.limit_waiting', pulse: false };
    case 'blocked':
      return { tone: 'error', wordKey: 'run.outcome.failed', subKey: 'detail.badge.retryOut', pulse: false };
    case 'done':
      return { tone: 'proceed', wordKey: 'wo.status.done', pulse: false };
  }
};

// --- U-226: the decision zone -----------------------------------------------------------------------

/** One decision card of the zone. The approve card's evidence (the changes list summary, the
 *  pending pages) is read by the screen from the state's `changes` and the pages store; the card
 *  model itself stays pure over the view. */
export type DecisionCard =
  | { readonly kind: 'approve'; readonly gate: GateView }
  | { readonly kind: 'attest'; readonly gate: GateView }
  | { readonly kind: 'deploy'; readonly gate: GateView }
  /** The honest card of a `gating` stage: nothing here is the operator's to answer — the pending
   *  machine-evaluated gates are listed, and `verdictOrphaned` says no run is live while an
   *  agent-verdict gate still waits (the reviewer ended without deciding). */
  | { readonly kind: 'gating'; readonly gates: readonly GateView[]; readonly verdictOrphaned: boolean }
  | { readonly kind: 'permission'; readonly ask: WorkOrderAskView }
  | { readonly kind: 'start'; readonly stageName: string }
  | { readonly kind: 'failed'; readonly retry: boolean }
  | {
      readonly kind: 'running';
      readonly runId: string;
      readonly stageName: string;
      readonly startedAt: number;
      readonly canSteer: boolean | 'unknown';
    };

export type DecisionZone =
  | { readonly kind: 'quiet'; readonly done: boolean }
  | { readonly kind: 'cards'; readonly cards: readonly DecisionCard[] };

/** The cards the zone holds for this standing (U-226's matrix, U-301's running case). A
 *  permission ask outranks every standing; a live run is exactly one running card — the quiet
 *  line, the stage, the duration, and the two secondary doors; a failure outranks the start
 *  action; the decidable gates of the current stage (human, page, changes, deploy) each carry
 *  their own card, stacked 12 px apart (U-227). The failed card's retry flag is the fold's own
 *  verdict: a `ready` re-entry only happens while the on-fail budget had attempts left (R-21),
 *  a block is the budget spent. */
export const decisionZone = (
  stages: readonly StageGates[],
  view: WorkOrderDetailView,
  asks: readonly WorkOrderAskView[],
): DecisionZone => {
  if (asks.length > 0) {
    return { kind: 'cards', cards: asks.map((ask) => ({ kind: 'permission' as const, ask })) };
  }
  // U-301: the running case names the newest live run — the same run the live pane mounts. A
  // `running` standing without a live run in the view (a stale read, an orphaned record) and a
  // `limit_waiting` one alike stay quiet: there is nothing to stop and no handle to steer.
  if (view.state.status === 'running') {
    const live = newestActiveRun(view);
    if (live !== undefined) {
      const stage = stages.find((candidate) => candidate.current);
      const canSteer = view.runSummaries?.find((summary) => summary.runId === live.id)?.canSteer ?? 'unknown';
      return {
        kind: 'cards',
        cards: [{ kind: 'running', runId: live.id, stageName: stage?.name ?? '', startedAt: live.startedAt, canSteer }],
      };
    }
  }
  if (view.state.status === 'blocked') {
    return { kind: 'cards', cards: [{ kind: 'failed', retry: false }] };
  }
  if (view.state.status === 'ready') {
    if (isFailedStanding(view)) {
      return { kind: 'cards', cards: [{ kind: 'failed', retry: true }] };
    }
    if (view.next.kind === 'start_run') {
      const stage = stages.find((candidate) => candidate.current);
      return { kind: 'cards', cards: [{ kind: 'start', stageName: stage?.name ?? '' }] };
    }
    return { kind: 'quiet', done: false };
  }
  if (view.state.status === 'gating' || view.state.status === 'awaiting_human') {
    const current = stages.find((stage) => stage.current);
    const cards: DecisionCard[] = [];
    const settling: GateView[] = [];
    let humanHeldBack = false;
    for (const gate of current?.gates ?? []) {
      if (gate.status !== 'pending') continue;
      // `decideHumanGate` only answers an `awaiting_human` stage: while machine gates are still
      // pending (`gating`) a human gate is not yet the operator's to decide.
      if (isHumanDecision(gate)) {
        if (view.state.status === 'awaiting_human') cards.push({ kind: 'approve', gate });
        else humanHeldBack = true;
      } else if (gate.kind === 'changes') cards.push({ kind: 'attest', gate });
      else if (gate.kind === 'deploy') cards.push({ kind: 'deploy', gate });
      else settling.push(gate);
    }
    // A stage whose machine gates simply run stays quiet; the card speaks when a human gate waits
    // behind them or the agent verdict has no run left to deliver it.
    const verdictOrphaned =
      newestActiveRun(view) === undefined && settling.some((gate) => gate.kind === 'agent_verdict');
    if (view.state.status === 'gating' && settling.length > 0 && (humanHeldBack || verdictOrphaned)) {
      cards.unshift({ kind: 'gating', gates: settling, verdictOrphaned });
    }
    return cards.length > 0 ? { kind: 'cards', cards } : { kind: 'quiet', done: false };
  }
  if (view.state.status === 'done') return { kind: 'quiet', done: true };
  return { kind: 'quiet', done: false };
};

/** The cards the strip's gate counter counts (U-224): every gate card that waits for the
 *  operator's yes/no — a start or a failure report is not a gate waiting, and a permission ask
 *  is a run's question, not a gate (it has its own counter). */
export const gateWaitingCount = (zone: DecisionZone): number =>
  zone.kind === 'quiet'
    ? 0
    : zone.cards.filter((card) => card.kind === 'approve' || card.kind === 'attest' || card.kind === 'deploy').length;

/** The permission asks the strip's own counter names beside the gate count. */
export const asksWaitingCount = (zone: DecisionZone): number =>
  zone.kind === 'quiet' ? 0 : zone.cards.filter((card) => card.kind === 'permission').length;

// --- U-224: the stage strip -------------------------------------------------------------------------

export interface StripSegment {
  readonly name: string;
  readonly standing: 'done' | 'current' | 'future';
  readonly failed: boolean;
  readonly running: boolean;
  /** Present on the current stage only; 0 renders nothing. */
  readonly gatesWaiting: number;
  /** Open permission asks, on the current stage only; 0 renders nothing. */
  readonly asksWaiting: number;
}

/** The strip (U-224, the operator's Alternative 1): stages only — never gate segments, never
 *  gate names — with the “· N kapı bekliyor” counter on the current stage's label alone. */
export const stripSegments = (
  stages: readonly StageGates[],
  zone: DecisionZone,
  view: WorkOrderDetailView,
): readonly StripSegment[] => {
  const failedStanding = view.state.status === 'blocked' || isFailedStanding(view);
  const running = view.state.status === 'running' || view.state.status === 'limit_waiting';
  const waiting = gateWaitingCount(zone);
  const asking = asksWaitingCount(zone);
  const currentAt = stages.findIndex((stage) => stage.current);
  return stages.map((stage, index) => ({
    name: stage.name,
    standing: currentAt === -1 || index < currentAt ? ('done' as const) : index === currentAt ? ('current' as const) : ('future' as const),
    failed: stage.current && failedStanding,
    running: stage.current && running,
    gatesWaiting: stage.current ? waiting : 0,
    asksWaiting: stage.current ? asking : 0,
  }));
};

/** The stage list's standing of one row (not the strip's): behind the current stage is done,
 *  the current one is now, ahead of it is upcoming; a finished work order has no current stage
 *  and every stage is done. A flow position nobody holds (a stage id the flow no longer has)
 *  claims nothing: every row stays upcoming rather than a false “done”. */
export const stageListStanding = (
  stages: readonly StageGates[],
  index: number,
  finished: boolean,
): 'done' | 'current' | 'upcoming' => {
  if (finished) return 'done';
  const currentAt = stages.findIndex((stage) => stage.current);
  if (currentAt === -1) return 'upcoming';
  return index < currentAt ? 'done' : index === currentAt ? 'current' : 'upcoming';
};

/** The git doors card shows only when there is something to ship or a ledger fact to keep
 *  showing: the branch has changed files, a branch was pushed, a pull request exists — or the
 *  repo's own not-ok cause must be said. Before that, four disabled doors with reasons are
 *  noise. A changes read that has not landed is not an empty tree, but it is also no evidence
 *  of anything to ship, so the card waits for it. */
export const gitCardVisible = (
  view: WorkOrderDetailView,
  model: GitCardModel | null,
  changes: WorkOrderChangesView | null,
): boolean => {
  if (model === null) return false;
  if (model.repoReasonKey !== undefined) return true;
  if (model.pr !== null || view.git?.branch !== undefined || view.git?.mergedLocal !== undefined) return true;
  return changes !== null && changes.state === 'ready' && changes.files.length > 0;
};

// --- U-229/U-230: the run rows ----------------------------------------------------------------------

/** One run row: the run record joined with its summary (#969). A missing summary (a reply
 *  without the field) still renders the row — the provenance line is simply absent. */
export interface WorkOrderRunRow {
  readonly id: string;
  /** The short code the rows show — never the raw ULID (the walk-through decision). */
  readonly shortCode: string;
  readonly stage: string;
  readonly attempt: number;
  readonly startedAt: number;
  readonly endedAt: number | undefined;
  readonly outcome: RunOutcome | undefined;
  readonly accountLabel: string | null;
  readonly model: string | null;
  readonly billing: 'pay_per_use' | 'included' | 'unknown' | null;
  /** The cost display the billing dictates (U-229): money for pay-per-use, tokens plus the
   *  estimate note for included, credits for credits. */
  readonly cost: CostDisplay | null;
  readonly usage: { readonly inputTokens: number; readonly outputTokens: number } | null;
  readonly flowVersion: number | null;
  readonly roleVersion: number | null;
}

/** The run code a row shows (the walk-through decision): `run_` plus the id's last four
 *  characters, lowercased — short, never the raw ULID; the full id rides the title. */
export const formatRunCode = (id: string): string => `run_${id.slice(-4).toLowerCase()}`;

export const runRows = (view: WorkOrderDetailView): readonly WorkOrderRunRow[] => {
  const summaries = view.runSummaries ?? [];
  return view.runs.map((run) => {
    const summary = summaries.find((candidate) => candidate.runId === run.id) ?? null;
    return {
      id: run.id,
      shortCode: formatRunCode(run.id),
      stage: run.stage,
      attempt: run.attempt,
      startedAt: run.startedAt,
      endedAt: run.endedAt,
      outcome: run.outcome,
      accountLabel: summary?.account.label ?? null,
      model: summary?.model ?? null,
      billing: summary?.billing ?? null,
      cost:
        summary !== null && summary.usage !== undefined
          ? costDisplay(summary.usage.costByKind, summary.billing)
          : null,
      usage:
        summary?.usage !== undefined
          ? { inputTokens: summary.usage.inputTokens, outputTokens: summary.usage.outputTokens }
          : null,
      flowVersion: run.flowVersion ?? null,
      roleVersion: run.roleVersion ?? null,
    };
  });
};

// --- U-341…U-343: the CI check fold ------------------------------------------------------------------

/** One matched check of a gate's newest recorded evidence — the forge's name and status word. */
export interface GateCheckRow {
  readonly name: string;
  readonly status: string;
}

/** One evaluation of the gate's verdict history, in record order (newest last). */
export interface GateVerdictRow {
  readonly at: number;
  readonly status: string;
}

/** One remote_checks gate's fold model: its standing in this work order, the matched checks of
 *  the newest evaluation that recorded them, and the verdict history behind it. */
export interface GateChecksGroup {
  readonly gate: string;
  readonly standing: GateStatus;
  readonly checks: readonly GateCheckRow[];
  readonly history: readonly GateVerdictRow[];
}

/** The fold's groups (U-341): every remote_checks gate that is pending or holds evaluations,
 *  in flow order — an upcoming gate nobody evaluated yet stays out. A gate's checks come from
 *  the newest evaluation that recorded evidence, so evaluations older than the evidence field
 *  show history only. A reply without `gates` (older than the field) still folds its pending
 *  gates: the standing is the stage list's own fact, not the rows'. */
export const gateCheckGroups = (
  stages: readonly StageGates[],
  gates: readonly WorkOrderGateRow[] | undefined,
): readonly GateChecksGroup[] => {
  const rows = gates ?? [];
  const groups: GateChecksGroup[] = [];
  for (const stage of stages) {
    for (const gate of stage.gates) {
      if (gate.kind !== 'remote_checks') continue;
      const own = rows.filter((row) => row.gate === gate.id);
      if (own.length === 0 && gate.status !== 'pending') continue;
      let withChecks: WorkOrderGateRow | undefined;
      for (let index = own.length - 1; index >= 0; index -= 1) {
        if ((own[index].checks ?? []).length > 0) {
          withChecks = own[index];
          break;
        }
      }
      groups.push({
        gate: gate.id,
        standing: gate.status,
        checks: withChecks === undefined ? [] : withChecks.checks.map((check) => ({ name: check.name, status: check.status })),
        history: own.map((row) => ({ at: row.at, status: row.verdict?.status ?? 'unknown' })),
      });
    }
  }
  return groups;
};

// --- U-344 … U-349: the git doors -------------------------------------------------------------------

/** One door of the git card: its standing and, when it is closed, the one quiet line that says
 *  why (U-345, U-349). */
export interface GitDoor {
  readonly kind: 'push' | 'openPr' | 'merge' | 'mergeLocal' | 'release';
  readonly available: boolean;
  /** Present only on a closed door — the reason line the card renders beside it. */
  readonly reasonKey?: LabelKey;
}

/** The git card's model: the branch line, the pull request the ledger holds and the four doors
 *  in their fixed order (U-344, U-349). */
export interface GitCardModel {
  readonly branch: string;
  readonly pr: GitPrState | null;
  /** Present once the branch was merged into the base locally (R-185, U-358). */
  readonly mergedLocal?: { readonly base: string };
  /** Present only while the repo context answers a not-ok standing (U-351): the one visible
   *  cause every closed door shares — the card stands to say it. */
  readonly repoReasonKey?: LabelKey;
  readonly doors: readonly GitDoor[];
}

/** The one cause line each not-ok repo standing words (U-351) — the same sentence the header's
 *  context line repeats, so one copy set serves both places (U-352). */
export const repoStatusReasonKey = (status: Exclude<WorkOrderDetailRepoContext['status'], 'ok'>): LabelKey =>
  status === 'relink_offered'
    ? 'detail.git.repo.relinkOffered'
    : status === 'folder_not_found'
      ? 'detail.git.repo.folderNotFound'
      : 'detail.git.repo.unregistered';

/** The doors' matrix (U-344 … U-349): the card stands only while a worktree holds and the
 *  lifecycle is open — a released work order shows no card; the branch line is the naming rule's
 *  deterministic `docket/wo-<id>` word until the ledger's own push names it; every door's
 *  availability derives from the lifecycle state the reply carried (A-390), never from events
 *  re-derived here. The push door alone reads the forge: a missing forge is a standing the card
 *  can know (the gitBase read's own code), a failed forge call is not — the command words it.
 *  A not-ok repo context (U-351) overrides both gates: the card stands even without a working
 *  copy, every door is closed, and the doors' own lifecycle reasons stay unsaid — they would
 *  name the wrong cause for doors the repo's own standing closed. */
export const gitCard = (
  view: WorkOrderDetailView,
  gitBase: GitBaseRead | null,
  hasWorktree: boolean,
  localBase: GitBaseRead | null = null,
): GitCardModel | null => {
  const git = view.git;
  if (git?.released === true) return null;
  const repoStatus = view.repoContext?.status ?? 'ok';
  if (repoStatus !== 'ok') {
    return {
      branch: git?.branch?.name ?? workOrderBranch(view.record.id as WorkOrderId),
      pr: git?.pr ?? null,
      repoReasonKey: repoStatusReasonKey(repoStatus),
      doors: [
        { kind: 'push', available: false },
        { kind: 'openPr', available: false },
        { kind: 'merge', available: false },
        { kind: 'release', available: false },
      ],
    };
  }
  if (!hasWorktree) return null;
  const pr = git?.pr ?? null;
  const openPr = pr !== null && !pr.merged;
  const pushBlocked = gitBase !== null && !gitBase.ok && gitBase.code === 'forge_unavailable';
  const mergedLocal = git?.mergedLocal;
  // U-358: the local merge is the forge-less door — a standing forge never offers it, and a
  // merged branch has done it. It needs the checkout's base to name in its confirm.
  const mergeLocalDoor: readonly GitDoor[] =
    pushBlocked && mergedLocal === undefined
      ? [
          localBase !== null && localBase.ok
            ? { kind: 'mergeLocal', available: true }
            : { kind: 'mergeLocal', available: false, reasonKey: 'detail.git.mergeLocal.noBase' as LabelKey },
        ]
      : [];
  return {
    branch: git?.branch?.name ?? workOrderBranch(view.record.id as WorkOrderId),
    pr,
    ...(mergedLocal === undefined ? {} : { mergedLocal: { base: mergedLocal.base } }),
    doors: [
      {
        kind: 'push',
        available: !pushBlocked,
        ...(pushBlocked ? { reasonKey: 'detail.git.push.noForge' as LabelKey } : {}),
      },
      {
        kind: 'openPr',
        available: git?.branch !== undefined && !openPr,
        ...(git?.branch === undefined
          ? { reasonKey: 'detail.git.openPr.noBranch' as LabelKey }
          : openPr
            ? { reasonKey: 'detail.git.openPr.exists' as LabelKey }
            : {}),
      },
      {
        kind: 'merge',
        available: openPr,
        ...(!openPr ? { reasonKey: 'detail.git.noOpenPr' as LabelKey } : {}),
      },
      ...mergeLocalDoor,
      {
        kind: 'release',
        available: pr?.merged === true || mergedLocal !== undefined,
        ...(pr?.merged !== true && mergedLocal === undefined ? { reasonKey: 'detail.git.notMerged' as LabelKey } : {}),
      },
    ],
  };
};

/** The failed card's one mono line: the failed run's last spoken answer — the trailing run of
 *  `text` events, concatenated in arrival order. A run that said nothing has no line; the card
 *  shows the run's short code alone. */
export const lastMessageOf = (events: readonly AgentEvent[]): string | null => {
  const tail: string[] = [];
  for (let at = events.length - 1; at >= 0; at -= 1) {
    const event = events[at];
    if (event.type !== 'text') break;
    tail.unshift(event.delta);
  }
  const text = tail.join('').trim();
  return text.length > 0 ? text : null;
};

/** The run the failed card quotes and scrolls to: the newest failed run of the current stage. */
export const newestFailedRunOf = (view: WorkOrderDetailView): WorkOrderDetailRun | null => {
  if (view.state.stage === null) return null;
  let newest: WorkOrderDetailRun | null = null;
  for (const run of view.runs) {
    if (run.stage !== view.state.stage || run.outcome !== 'failed') continue;
    if (newest === null || run.startedAt > newest.startedAt) newest = run;
  }
  return newest;
};

/** What the asking run's `permission_ask` event says about one ask. */
interface AskDetail {
  readonly tool: string;
  readonly target: string | null;
  readonly verdict: VerdictAskDetail | undefined;
}

/** The honest map from a `permissions.open` row to what the decision zone shows: the tool and
 *  target of the run's own ask event when it was read, the ask id alone when it was not. */
const toAskView = (row: OpenAskView, detail: AskDetail | undefined): WorkOrderAskView => ({
  runId: row.runId,
  askId: row.askId,
  tool: detail?.tool ?? row.askId,
  target: detail?.target ?? null,
  ...(detail?.verdict === undefined ? {} : { detail: detail.verdict }),
});

/** A reply that is not exactly the changes view — a failure, an envelope, a list that is not a
 *  list — renders no section, never a crashed detail screen. */
const isChangesView = (value: unknown): value is WorkOrderChangesView => {
  if (typeof value !== 'object' || value === null) return false;
  const candidate = value as { readonly state?: unknown; readonly files?: unknown; readonly truncated?: unknown };
  if (
    candidate.state !== 'ready' &&
    candidate.state !== 'no_worktree' &&
    candidate.state !== 'unavailable'
  ) {
    return false;
  }
  if (!Array.isArray(candidate.files) || typeof candidate.truncated !== 'boolean') return false;
  return candidate.files.every(
    (file) =>
      typeof file === 'object' &&
      file !== null &&
      typeof (file as { readonly path?: unknown }).path === 'string',
  );
};

/** The gitBase reply's success arm (A-391): `{ ok: true, base }` and nothing else — a reply the
 *  guard cannot read leaves the state unread, never a wrong prefill. */
const isGitBaseView = (value: unknown): value is { readonly ok: true; readonly base: string } => {
  if (typeof value !== 'object' || value === null) return false;
  const candidate = value as { readonly ok?: unknown; readonly base?: unknown };
  return candidate.ok === true && typeof candidate.base === 'string';
};

/** The asks section shows only the loaded work order's own asks — a run id the view knows is
 *  the one honest link the open-asks read carries. */
const asksFor = (
  rows: readonly OpenAskView[],
  view: WorkOrderDetailView | null,
  details: ReadonlyMap<string, AskDetail>,
): readonly WorkOrderAskView[] => {
  if (view === null) return [];
  const ownRuns = new Set(view.runs.map((run) => run.id));
  return rows.filter((row) => ownRuns.has(row.runId)).map((row) => toAskView(row, details.get(row.askId)));
};

/** The work order's newest still-active run — the one the live pane mounts for and the running
 *  card names (U-301). */
const newestActiveRun = (view: WorkOrderDetailView): WorkOrderDetailRun | undefined => {
  let newest: WorkOrderDetailRun | undefined;
  for (const run of view.runs) {
    if (run.endedAt !== undefined) continue;
    if (newest === undefined || run.startedAt > newest.startedAt) newest = run;
  }
  return newest;
};

export const createWorkOrderDetailStore = (deps: WorkOrderDetailStoreDeps): WorkOrderDetailStore => {
  const { api, changes, actor, pane } = deps;

  let state: WorkOrderDetailState = {
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
  };
  // The work order the store is bound to: change events re-query it, intents act on it.
  let workOrderId: string | null = null;
  // The raw `permissions.open` rows; the state's asks derive from these plus the loaded view on
  // every set, so whichever read lands second still shows a consistent section.
  let askRows: readonly OpenAskView[] = [];
  // What each open ask's own event said (tool + target), keyed by ask id; filled by the run
  // event tail reads and folded into the asks on every set.
  const askDetails = new Map<string, AskDetail>();
  const listeners = new Set<() => void>();
  // Only the newest attempt may apply its reply: a slow earlier query must not overwrite a
  // fresher view when change events stack up.
  let attempts = 0;

  const set = (next: WorkOrderDetailState): void => {
    state = { ...next, asks: asksFor(askRows, next.view, askDetails) };
    for (const listener of [...listeners]) listener();
  };

  /** The open asks ride every load: the zone must exist the moment a work order opens, and an
   *  intent's refresh re-reads it, so an answered ask leaves the zone at once. A failed read
   *  keeps the rows already shown — an error never blanks the section. */
  const loadAsks = async (): Promise<void> => {
    const reply: unknown = await api.query({ type: 'permissions.open' } satisfies Query);
    if (isQueryFailure(reply)) return;
    askRows = reply as readonly OpenAskView[];
    set({ ...state });
    // An ask that arrives after the detail load must still say what it asks for.
    if (state.asks.some((ask) => !askDetails.has(ask.askId))) void loadAskDetails(state.asks);
  };

  /** The read-only changes list rides every load the same way (U-231): a failure keeps the list
   *  already on screen. */
  const loadChanges = async (id: string): Promise<void> => {
    const reply: unknown = await api.query({ type: 'workOrder.changes', workOrder: id } satisfies Query);
    if (isQueryFailure(reply)) return;
    if (!isChangesView(reply)) return;
    set({ ...state, changes: reply });
  };

  /** The forge default-branch read (A-391) rides the binding, not every refresh: it reaches the
   *  forge host, and the repo's wiring changes far more rarely than the work order does. A
   *  failed read keeps its code — the PR dialog words the empty-with-hint standing, the push
   *  door words the missing-forge reason. */
  let gitBaseFor: string | null = null;
  const loadGitBase = async (id: string): Promise<void> => {
    const reply: unknown = await api.query({ type: 'workOrder.gitBase', id } satisfies Query);
    // A binding that moved on while the read was out leaves its answer for the next one.
    if (workOrderId !== id) return;
    if (isQueryFailure(reply)) {
      set({ ...state, gitBase: { ok: false, code: reply.code } });
      // Only a repo with no forge has a local base to name (U-358).
      if (reply.code === 'forge_unavailable') void loadLocalBase(id);
    } else if (isGitBaseView(reply)) set({ ...state, gitBase: { ok: true, base: reply.base } });
  };

  /** The checkout's branch (A-426), read on every refresh while the forge is missing: it is a
   *  local git read, and the confirm must name what is checked out now. */
  const loadLocalBase = async (id: string): Promise<void> => {
    const reply: unknown = await api.query({ type: 'workOrder.localBase', id } satisfies Query);
    if (workOrderId !== id) return;
    if (isQueryFailure(reply)) set({ ...state, localBase: { ok: false, code: reply.code } });
    else if (isGitBaseView(reply)) set({ ...state, localBase: { ok: true, base: reply.base } });
  };

  /** The failed standing's one-line quote: the failed run's own last words, read once per
   *  load from its event tail. */
  const loadErrorLine = async (view: WorkOrderDetailView): Promise<void> => {
    const failed = newestFailedRunOf(view);
    if (failed === null) return;
    const reply: unknown = await api.query({ type: 'run.events', runId: failed.id } satisfies Query);
    if (isQueryFailure(reply) || !Array.isArray(reply)) return;
    const line = lastMessageOf(reply as readonly AgentEvent[]);
    set({ ...state, lastErrorLine: line });
  };

  /** The permission card's collapsed count: the asking run's already-allowed asks, read from
   *  its own event tail once per load. */
  const loadUsageSummary = async (id: string, attempt: number): Promise<void> => {
    const reply: unknown = await api.query({ type: 'usage.summary', workOrder: id } satisfies Query);
    if (attempt !== attempts) return;
    if (isQueryFailure(reply)) {
      set({ ...state, usageSummaryFailed: true });
      return;
    }
    set({ ...state, usageSummary: reply as UsageSummaryView, usageSummaryFailed: false });
  };

  /** One read per asking run of its event tail feeds two things: each open ask's tool and target
   *  (the card must show what is being approved — every pending ask, whichever run raised it)
   *  and the collapsed count of asks those runs already allowed. A run whose read fails leaves
   *  its asks on the ask-id fallback. */
  const loadAskDetails = async (asks: readonly WorkOrderAskView[]): Promise<void> => {
    const runIds = [...new Set(asks.map((ask) => ask.runId))];
    if (runIds.length === 0) return;
    const replies = await Promise.all(
      runIds.map((runId): Promise<unknown> => api.query({ type: 'run.events', runId } satisfies Query)),
    );
    let allowed = 0;
    let read = false;
    for (const reply of replies) {
      if (isQueryFailure(reply) || !Array.isArray(reply)) continue;
      read = true;
      for (const event of reply as readonly AgentEvent[]) {
        if (event.type === 'permission_ask') askDetails.set(event.id, { tool: event.tool, target: event.target ?? null, verdict: event.detail });
        else if (event.type === 'permission_answered' && event.decision === 'allow') allowed += 1;
      }
    }
    if (read) set({ ...state, autoAllowed: allowed });
  };

  const load = async (id: string): Promise<void> => {
    const attempt = attempts + 1;
    attempts = attempt;
    workOrderId = id;
    set({
      ...state,
      loading: true,
      problem: null,
      lastErrorLine: null,
      autoAllowed: 0,
      usageSummary: null,
      usageSummaryFailed: false,
    });
    const detailRead = api.query({ type: 'workOrder.detail', id } satisfies Query);
    void loadAsks();
    void loadChanges(id);
    void loadUsageSummary(id, attempt);
    if (gitBaseFor !== id) {
      gitBaseFor = id;
      void loadGitBase(id);
    } else if (state.gitBase !== null && !state.gitBase.ok && state.gitBase.code === 'forge_unavailable') {
      void loadLocalBase(id);
    }
    const reply: unknown = await detailRead;
    if (attempt !== attempts) return;
    if (isQueryFailure(reply)) {
      // The previous view and gate list stay exactly as they were; only the problem appears.
      set({ ...state, loading: false, problem: reply.code });
      return;
    }
    // The contract of the detail query: a reply that is not a failure is the detail view, and
    // the query has already resolved the definitions server-side — the flow and the environments
    // ride the reply, so the stage list derives without a second read.
    const view = reply as WorkOrderDetailView;
    const stages = stageGates(view.flow, view.environments, view.state, view.decisions);
    set({
      ...state,
      loading: false,
      view,
      stages,
      skipDecisions: view.skipDecisions ?? [],
      problem: null,
    });
    if (view.state.status === 'blocked' || isFailedStanding(view)) void loadErrorLine(view);
    const freshAsks = asksFor(askRows, view, askDetails);
    if (freshAsks.length > 0) void loadAskDetails(freshAsks);
    // A run still going is mounted into the live pane; the pane itself ignores a repeat attach.
    const active = newestActiveRun(view);
    if (active !== undefined) void pane.attach(active.id);
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

  /** A failure code this surface words itself, when the U-8 copy would say the wrong sentence —
   *  the stop's calm "already ended" line (U-302) is the one such override. */
  const runIntent = async (
    command: Command,
    successKey?: LabelKey,
    failureKeys?: Readonly<Record<string, LabelKey>>,
    quietFailure?: (code: string) => boolean,
    quietRefresh?: (code: string) => boolean,
  ): Promise<IntentOutcome> => {
    const result = await api.command(actor, command);
    const outcome: IntentOutcome = {
      command: command.type,
      result,
      labelKey:
        result.ok && successKey !== undefined
          ? successKey
          : !result.ok && failureKeys !== undefined && failureKeys[result.code] !== undefined
            ? failureKeys[result.code]
            : commandResultKey(command.type, result),
    };
    // A quiet failure belongs to the caller's own surface, not the screen's: it is returned for
    // that surface to word (the note dialog's inline error, U-303) and never published as the
    // lastOutcome — so no toast fires and no refresh runs, because a refused command changed
    // nothing the next query could show. The one exception is a refusal that answers a fact the
    // ledger already holds (openPr's pr_exists answers the stored pull request): the re-query
    // shows it even though no toast fires.
    if (quietFailure !== undefined && !result.ok && quietFailure(result.code)) {
      if (quietRefresh !== undefined && quietRefresh(result.code) && workOrderId !== null) await load(workOrderId);
      return outcome;
    }
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
    stopRun: (runId) => {
      // Runs, not work orders, are what a stop reaches — no loaded view needed. The not_active
      // answer is the calm line (U-302), not a failure word: the run ended on its own first.
      return runIntent(
        { type: 'run.stop', runId },
        undefined,
        { not_active: 'detail.stop.alreadyEnded' },
      );
    },
    steerRun: (runId, note) => {
      // The note travels verbatim; the api bounds it and answers bad_input, which the note
      // dialog words as its own inline error (U-303) — the store adds no second validation, and
      // the field's verdict is quiet: an unmapped code would otherwise ride the U-8 generic
      // arm and toast a red "unexpected error" for an empty note.
      return runIntent(
        { type: 'run.steer', runId, note },
        undefined,
        { bad_input: 'detail.steer.error', unsupported: 'detail.steer.unsupported' },
        (code) => code === 'bad_input',
      );
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
    closeWorkOrder: () => {
      if (workOrderId === null) return Promise.resolve(notLoadedOutcome('workOrder.close'));
      return runIntent({ type: 'workOrder.close', id: workOrderId }, 'success.workOrder.close');
    },
    setAutonomy: async (level) => {
      if (workOrderId === null) return notLoadedOutcome('workOrder.setAutonomy');
      const result = await api.command(actor, { type: 'workOrder.setAutonomy', id: workOrderId, level });
      // Never a toast either way (U-334): a success is the refreshed detail's own chain read; a
      // refusal changed nothing, and the control's reason line already words the standing.
      if (result.ok) await load(workOrderId);
      return { command: 'workOrder.setAutonomy', result, labelKey: commandResultKey('workOrder.setAutonomy', result) };
    },
    push: () => {
      if (workOrderId === null) return Promise.resolve(notLoadedOutcome('workOrder.push'));
      return runIntent({ type: 'workOrder.push', id: workOrderId }, 'detail.git.push.success');
    },
    openPr: (input) => {
      if (workOrderId === null) return Promise.resolve(notLoadedOutcome('workOrder.openPr'));
      return runIntent(
        {
          type: 'workOrder.openPr',
          id: workOrderId,
          base: input.base,
          ...(input.title !== undefined ? { title: input.title } : {}),
        },
        'detail.git.openPr.success',
        undefined,
        // pr_exists answers the stored pull request the refusal carries: never an error toast —
        // the quiet refresh puts that PR's line on the card (U-346).
        (code) => code === 'pr_exists',
        (code) => code === 'pr_exists',
      );
    },
    mergePr: (number) => {
      if (workOrderId === null) return Promise.resolve(notLoadedOutcome('workOrder.mergePr'));
      return runIntent({ type: 'workOrder.mergePr', id: workOrderId, number }, 'detail.git.merge.success');
    },
    mergeLocal: (base) => {
      if (workOrderId === null) return Promise.resolve(notLoadedOutcome('workOrder.mergeLocal'));
      return runIntent({ type: 'workOrder.mergeLocal', id: workOrderId, base }, 'detail.git.mergeLocal.success');
    },
    releaseBranch: () => {
      if (workOrderId === null) return Promise.resolve(notLoadedOutcome('workOrder.releaseBranch'));
      return runIntent({ type: 'workOrder.releaseBranch', id: workOrderId }, 'detail.git.release.success');
    },
    reloadUsageSummary: async () => {
      if (workOrderId === null) return;
      const attempt = attempts;
      set({ ...state, usageSummary: null, usageSummaryFailed: false });
      await loadUsageSummary(workOrderId, attempt);
    },
  };
};
