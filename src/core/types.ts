// src/core/types.ts — domain contract. Pure: no React, no I/O, no Node (AC9).
//
// Gate-1-signed-off view model (architect verdict, subject to corrections A and B, both applied):
// three-valued evidence (AC12) and a CardReason that carries the default case (AC13).
// Core returns structured data only — every fixed human string lives in src/ui/data/labels.ts.

// --- Identifiers: branded. Components pass and compare them but cannot construct literals
//     (a bare project-id string will not typecheck against a WorkspaceId). Only the adapter
//     constructs them — fixtures now, workspace.yaml/git in M3. ADR-0003 rule 1, structurally. ---
export type WorkspaceId = string & { readonly __brand: 'WorkspaceId' };
export type RepoId = string & { readonly __brand: 'RepoId' };
export type WorkOrderId = string & { readonly __brand: 'WorkOrderId' };
export type TrackId = string & { readonly __brand: 'TrackId' };

// ADR-0003 rule 2: project context flows from a Workspace object, never a global or singleton.
export interface Workspace {
  id: WorkspaceId;
  label: string; // human label, e.g. "Docket" — components render this, never the raw id
  repos: RepoId[];
  decisionStore: RepoId;
}

// --- Pipeline (ADR-0001). WO-level rail stages — ZERO overlap with track stages. ---
export type StageId =
  | 'written'
  | 'plan_requested'
  | 'plan_ready'
  | 'architect_approval'
  | 'implementation'
  | 'verification'
  | 'architect_audit'
  | 'closure'
  | 'closed';

// Per-track lane stages — pr / ci / merge live ONLY here.
export type TrackStage = 'not_started' | 'implementation' | 'pr_opened' | 'ci' | 'merged';

export type EvidenceKind = 'plan_approval' | 'pr_open' | 'ci_green' | 'verification' | 'closure';
export type BoardColumn = 'your_turn' | 'running' | 'external';
// The approved redesign's two-bucket board + a collapsed "closed" drawer (WO-0013). Derived from
// column + stage: 'external' (forge/CI work without you) folds into 'working'.
export type BoardBucket = 'up' | 'working' | 'closed';

// --- CI: discriminated union. Exempt is a required branch — never a silent skip (state 6). ---
export interface CiCheck {
  name: string;
  conclusion: 'success' | 'failure' | 'pending';
}

export type Ci =
  | { kind: 'run'; state: 'running' | 'success' | 'failed'; checks: CiCheck[] }
  | { kind: 'exempt'; reason: string };

// --- Merge post-state: presence = merged; absence = not yet. (The merge ACTION is derived.) ---
export interface Merged {
  at: string;
}

// --- Sessions — PROVISIONAL until WO-0001 (AC7 / stop-and-ask gate 3).
//     Single home: WorkOrder.sessions. `scope` disambiguates per-track implementer sessions. ---
export type SessionRole = 'implementer' | 'architect' | 'verifier';

// The persisted + live transcript line (unified in WO-0026 — the old TranscriptEntry {role,text} had no
// consumer). Lives in types.ts so both SessionRef (persisted) and LiveSessionState (live fold) share it
// without a types↔runner import cycle; runner.ts re-exports it for existing importers.
// `note` (WO-0031c) is the OPERATOR-side synthetic line — the Durdur wind-down, the session-close cost
// freeze, the force kill. It is appended to the live fold only; a persisted transcript never carries it,
// so a resumed session replays provider history without Docket's own commentary.
export type TranscriptNoteKind = 'interrupt_sent' | 'session_closed' | 'force_killed';
export type TranscriptLine =
  | { speaker: 'assistant'; text: string }
  | { speaker: 'tool_use'; tool: string; detail: string }
  | { speaker: 'tool_result'; summary: string; isError: boolean }
  | { speaker: 'system'; text: string }
  | { speaker: 'note'; kind: TranscriptNoteKind; detail?: string };

/** One surfaced permission ask (moved to types.ts in WO-0027 so SessionRef/StopAndAsk and the live fold
 *  share it without a types↔runner cycle; runner.ts re-exports). */
export interface PermissionAsk {
  requestId: string;
  tool: string;
  input: Record<string, unknown>;
  title?: string;
  reason?: string;
}

export interface StopAndAsk {
  question: string;
  gate: string;
  /** The unanswered asks at the time the session paused (WO-0027 / Bulgu 9) — re-seeded on remount. */
  asks?: PermissionAsk[];
}

// Common fields live on every session; the status discriminates. `providerSessionId` is the
// provider's session UUID (present on live sessions persisted by WO-0010; absent on fixture
// examples). Docket owns the id/role/scope, not the transcript itself (ADR-0010).
export type SessionRef = (
  | { status: 'running' }
  | { status: 'stopped_asking'; stopAndAsk: StopAndAsk }
  | { status: 'idle' }
  | { status: 'none' }
) & {
  role: SessionRole;
  transcript: TranscriptLine[];
  scope?: TrackId;
  providerSessionId?: string;
  cost?: CostSummary; // observed per-session cost (WO-0011); undefined until turn_complete / on fixture-less rows
  stepIdx?: number; // the plan step this session runs (WO-0017); undefined for the architect plan session + free-form runs
  startedAt?: string; // ISO — when the session's drive started (WO-0027 / İstek 7: durations)
  endedAt?: string; // ISO — when it terminally ended (turn complete / abort / error); absent while live
};

// --- Plan steps (WO-0017). A Plan is an ordered list of Steps (PRODUCT.md); each Step is a role + aim +
//     track scope, runs as one session, and produces a report. The step SPECS are parsed from the ```steps
//     fence in plan.md at view time (ADR-0010 — document text is never stored); only the run OUTCOME
//     (status + report pointer) is persisted. Roles reuse SessionRole (ADR-0002). ---
export type StepRole = SessionRole;

// Scope is classified in core (all vs a track ref) but the ref is resolved + branded to a TrackId only in
// the adapter (ADR-0003 rule 1 — core never constructs a branded identity).
export type StepScope = { kind: 'all' } | { kind: 'track'; ref: string };

// Static spec straight from the parser (pure text → struct). No branded ids.
export interface StepSpec {
  idx: number; // 1-based position in the ```steps fence
  role: StepRole;
  aim: string; // the "what" label, non-empty
  scope: StepScope;
}

// Runtime status observed by Docket (mirrors the mock's done/active/pending/blocked).
export type StepStatus = 'pending' | 'active' | 'done' | 'blocked';

// The view shape the UI renders. `scopeTrackId` is branded by the adapter (undefined for 'all' or when the
// ref matched no track → status 'blocked'). Composed in the adapter, never constructed in core.
export interface StepView {
  idx: number;
  role: StepRole;
  aim: string;
  scope: StepScope;
  scopeTrackId?: TrackId;
  status: StepStatus;
  reportPath?: string; // relative to the WO dir, e.g. "reports/step-02-implementer.md"
  verdict?: 'proceed' | 'revise'; // the architect's review outcome (WO-0020); absent = not yet reviewed
  verdictPath?: string; // relative to the WO dir, e.g. "verdicts/step-02.md"
}

// --- Track (per-repo lane). No session field — sessions live once, on the work order. ---
export interface PrRef {
  url: string;
  headSha: string;
}

export interface Track {
  id: TrackId;
  repo: RepoId;
  dependsOn: TrackId[];
  stage: TrackStage;
  pr?: PrRef; // absent until pr_open satisfied
  ci: Ci; // always present: run | exempt (never silent)
  merge?: Merged; // post-merge state only; absent until merged
}

// --- WO lifecycle event (WO-0030 / İstek 8): one append-only audit row per lifecycle action. ---
// WO-0031c adds the edit/permission kinds: wo_edited (title/description/review-mode edits), rule_changed
// (the per-WO permission rule), permission_decision (the operator's answer on an ask card).
export type WoEventKind =
  | 'created'
  | 'plan_saved'
  | 'plan_approved'
  | 'step_started'
  | 'step_done'
  | 'step_verdict'
  | 'verdict_overridden'
  | 'closed'
  | 'wo_edited'
  | 'rule_changed'
  | 'permission_decision';

export interface WoEvent {
  kind: WoEventKind;
  detail: string; // short context, e.g. 'adım 2 · revise' or the closure sha — never display copy
  at: string; // ISO
}

// --- WO-level gate inputs (drive plan_approval / verification / closure) ---
export interface WoGateInputs {
  planApproved: boolean;
  verifierReport?: { resolvablePointers: boolean };
  // present => closed. M2 (WO-0025): the decision-store HEAD at close time, set with the operator's
  // attestation — "closed at this commit". M3 replaces it with the docs-commit sha the forge observes.
  closureDocsSha?: string;
}

// --- Primary action: absent, never disabled (AC3 / invariant 1).
//     Core returns the structural reason; the UI maps ActionIntent / AbsentReason -> text. ---
export type ActionIntent =
  | 'request_plan'
  | 'approve_plan'
  | 'resume'
  | 'open_pr'
  | 'merge_track'
  | 'request_verification'
  | 'audit'
  | 'update_docs'
  | 'close';

export type AbsentReason =
  | 'awaiting_plan_commit'
  | 'docs_not_updated'
  | 'depends_on_open'
  | 'verifier_report_missing'
  | 'pointers_unresolved'
  | 'step_not_resolved';

export type PrimaryAction =
  | { kind: 'available'; intent: ActionIntent }
  | { kind: 'absent'; reason: AbsentReason };

// --- Per-track merge action: absent (never disabled) when dependsOn is open (state 5).
//     An exempt CI satisfies the ci requirement — exempt does not block (AC12). ---
export type TrackMergeAction =
  | { kind: 'available' }
  | { kind: 'absent'; reason: 'depends_on_open' | 'ci_not_green' | 'pr_not_open' | 'already_merged' };

// --- Referenced docs: links only (ccd463e ownership ruling). ---
export type SourceKind = 'adr' | 'tech_debt' | 'roadmap' | 'contract';

export interface SourceLink {
  kind: SourceKind;
  label: string;
  ref: string;
}

export interface CostSummary {
  tokensIn: number;
  tokensOut: number;
  usd: number;
}

// ===== RAW STATE (the adapter provides this — fixtures now; SQLite/git in M3) =====
export interface WorkOrder {
  id: WorkOrderId;
  title: string;
  workspace: WorkspaceId;
  mode: 'plan' | 'direct';
  stage: StageId; // current WO-level stage
  tracks: Track[];
  sessions: SessionRef[]; // single home for all sessions; implementer sessions carry scope
  gateInputs: WoGateInputs;
  cost: CostSummary;
  sources: SourceLink[]; // referenced docs only — owned docs come via getWorkOrderDocs
  // WO-0031e tur-3: the canClose predicate over the step rows, derived by the adapter at hydrate
  // (ADR-0010 rule 2 — same as `stage`/`cost`, never stored). The board's honest "the Kapat card
  // is live" signal; undefined = not closable.
  closeable?: boolean;
}

// ===== DERIVED VIEWS (pure functions in core; structured data, no display strings) =====
export type StageStatus = 'done' | 'current' | 'locked' | 'upcoming';

export interface StageRailStep {
  stage: StageId;
  status: StageStatus;
  needs?: EvidenceKind[]; // when locked: unsatisfied gate evidence -> "PR · needs …"
}

// AC12 (7cdeea1): evidence is three-valued. Exempt is a decision someone made — shown with its
// reason, and it does NOT block the gate. (The same boolean-modelling bug fixed on Ci, one layer up.)
export type EvidenceStatus = 'satisfied' | 'unsatisfied' | 'exempt';

export interface EvidenceItem {
  kind: EvidenceKind;
  status: EvidenceStatus;
  exemption?: { reason: string }; // present only when status === 'exempt'
  scope?: TrackId; // per-track evidence (pr_open, ci_green)
}

// AC13: every card carries a reason for its column, including the default case.
// (`in_progress` covers the running column — a WO with an actively-working session that is neither
//  stopped, CI-failing, nor awaiting a gate. The six signed-off variants left no reason for it.)
export type CardReason =
  | { kind: 'stopped_asking'; gate: string }
  | { kind: 'ci_failed'; checkName: string }
  | { kind: 'ci_running' }
  | { kind: 'in_progress' }
  | { kind: 'just_written' }
  | { kind: 'awaiting_plan_commit' }
  | { kind: 'docs_not_updated' }
  | { kind: 'awaiting_next_session' };

export type CardActionKind = 'permission' | 'plan' | 'closure' | 'link';
/** The inline ▸ next-action on a card, derived from the work order's primary action + reason. */
export interface CardAction {
  kind: CardActionKind;
  intent: ActionIntent;
}

export interface WorkOrderCardView {
  id: WorkOrderId;
  title: string;
  workspace: WorkspaceId;
  stage: StageId;
  column: BoardColumn;
  bucket: BoardBucket;
  reason: CardReason;
  action?: CardAction;
  actionRank: number;
  closable: boolean; // WO-0031e tur-3 — the awaiting-close platform partition reads this
  role?: SessionRole;
  primaryRepo: RepoId | undefined;
  trackCount: number;
  sessionCount: number;
  cost: CostSummary;
}

// A lane view: the track plus its resolved session and derived merge action.
export interface TrackLaneView {
  track: Track;
  session: SessionRef | undefined; // resolved from WorkOrder.sessions by scope
  mergeAction: TrackMergeAction;
}

export interface WorkOrderDetailView {
  id: WorkOrderId;
  title: string;
  workspace: WorkspaceId;
  mode: 'plan' | 'direct';
  stage: StageId;
  rail: StageRailStep[];
  tracks: TrackLaneView[];
  evidence: EvidenceItem[]; // single left-column checklist: WO-level + per-track
  sessions: SessionRef[];
  steps: StepView[]; // the plan's steps (WO-0017); [] when plan.md has no ```steps fence or plan not approved
  reviewMode: 'gates' | 'every-step'; // the WO's review cadence (WO-0020) — gates auto-proceeds; every-step pauses
  gateInputs: WoGateInputs; // for the closed card's sha display (WO-0029 / B21)
  primaryAction: PrimaryAction;
  sources: SourceLink[];
  cost: CostSummary;
}
