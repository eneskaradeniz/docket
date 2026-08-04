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

export interface TranscriptEntry {
  role: SessionRole;
  text: string; // provisional shape
}

export interface StopAndAsk {
  question: string;
  gate: string;
}

export type SessionRef =
  | { role: SessionRole; status: 'running'; transcript: TranscriptEntry[]; scope?: TrackId }
  | {
      role: SessionRole;
      status: 'stopped_asking';
      transcript: TranscriptEntry[];
      stopAndAsk: StopAndAsk;
      scope?: TrackId;
    }
  | { role: SessionRole; status: 'idle'; transcript: TranscriptEntry[]; scope?: TrackId }
  | { role: SessionRole; status: 'none'; transcript: TranscriptEntry[]; scope?: TrackId };

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

// --- WO-level gate inputs (drive plan_approval / verification / closure) ---
export interface WoGateInputs {
  planApproved: boolean;
  verifierReport?: { resolvablePointers: boolean };
  closureDocsSha?: string; // present => ROADMAP + tech-debt updated this commit
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
  | 'pointers_unresolved';

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
  | { kind: 'awaiting_plan_commit' }
  | { kind: 'docs_not_updated' }
  | { kind: 'awaiting_next_session' };

export interface WorkOrderCardView {
  id: WorkOrderId;
  title: string;
  workspace: WorkspaceId;
  stage: StageId;
  column: BoardColumn;
  reason: CardReason;
  primaryRepo: RepoId;
  trackCount: number;
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
  rail: StageRailStep[];
  tracks: TrackLaneView[];
  evidence: EvidenceItem[]; // single left-column checklist: WO-level + per-track
  sessions: SessionRef[];
  primaryAction: PrimaryAction;
  sources: SourceLink[];
  cost: CostSummary;
}
