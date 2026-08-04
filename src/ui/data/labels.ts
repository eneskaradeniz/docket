// All fixed UI vocabulary lives here (AC1: no hardcoded copy in components).
// Domain enums map to display strings; dynamic fragments (check name, gate) come from data.
import type {
  AbsentReason,
  ActionIntent,
  BoardColumn,
  CardReason,
  EvidenceKind,
  EvidenceStatus,
  SessionRef,
  SessionRole,
  SourceKind,
  StageId,
  TrackStage,
  TrackMergeAction,
} from '../../core/types';

export const COLUMN_LABELS: Record<BoardColumn, string> = {
  your_turn: 'Your turn',
  running: 'Running',
  external: 'External',
};

export const COLUMN_HELP: Record<BoardColumn, string> = {
  your_turn: 'Waiting on you',
  running: 'A session is working',
  external: 'Waiting on an external system',
};

export const ROLE_LABELS: Record<SessionRole, string> = {
  implementer: 'Implementer',
  architect: 'Architect',
  verifier: 'Verifier',
};

export const STAGE_LABELS: Record<StageId, string> = {
  written: 'Written',
  plan_requested: 'Plan requested',
  plan_ready: 'Plan ready',
  architect_approval: 'Architect approval',
  implementation: 'Implementation',
  verification: 'Verification',
  architect_audit: 'Architect audit',
  closure: 'Closure',
  closed: 'Closed',
};

export const EVIDENCE_LABELS: Record<EvidenceKind, string> = {
  plan_approval: 'Plan approval',
  pr_open: 'PR open',
  ci_green: 'CI green',
  verification: 'Verification report',
  closure: 'Closure docs',
};

export const ACTION_LABELS: Record<ActionIntent, string> = {
  request_plan: 'Request plan',
  approve_plan: 'Approve plan',
  resume: 'Resume session',
  open_pr: 'Open PR',
  merge_track: 'Merge track',
  request_verification: 'Request verification',
  audit: 'Run audit',
  update_docs: 'Update docs',
  close: 'Close work order',
};

export const ABSENT_REASON_LABELS: Record<AbsentReason, string> = {
  awaiting_plan_commit: 'Awaiting the committed plan',
  docs_not_updated: 'ROADMAP and tech-debt are not yet updated',
  depends_on_open: 'A dependency track has not merged',
  verifier_report_missing: 'No verifier report yet',
  pointers_unresolved: 'Evidence pointers do not resolve at head sha',
};

export function cardReasonText(r: CardReason): string {
  switch (r.kind) {
    case 'stopped_asking':
      return `Stopped at ${r.gate}`;
    case 'ci_failed':
      return `CI failing: ${r.checkName}`;
    case 'ci_running':
      return 'CI running';
    case 'in_progress':
      return 'In progress';
    case 'awaiting_plan_commit':
      return 'Awaiting plan commit';
    case 'docs_not_updated':
      return 'Docs not updated';
    case 'awaiting_next_session':
      return 'Awaiting next session';
  }
}

export function mergeActionText(a: TrackMergeAction): string {
  if (a.kind === 'available') return 'Merge';
  switch (a.reason) {
    case 'depends_on_open':
      return 'Merge blocked — dependency open';
    case 'ci_not_green':
      return 'Merge blocked — CI not green';
    case 'pr_not_open':
      return 'No PR yet';
    case 'already_merged':
      return 'Merged';
  }
}

// AC1 (return-pass): display maps for the per-track stage, session status, mode and source
// kind enums, plus the composers that turn them into phrases. With these in place no
// component turns a code identifier into UI text via `.replace('_', ' ')` — every word a
// translator would touch lives here, so a label change (or an `en`/`tr` split, ADR-0007) is
// one edit, not a hunt through components.
export const TRACK_STAGE_LABELS: Record<TrackStage, string> = {
  not_started: 'Not started',
  implementation: 'Implementation',
  pr_opened: 'PR opened',
  ci: 'CI',
  merged: 'Merged',
};

export const SESSION_STATUS_LABELS: Record<SessionRef['status'], string> = {
  running: 'Running',
  stopped_asking: 'Stopped asking',
  idle: 'Idle',
  none: 'None',
};

export const MODE_LABELS: Record<'plan' | 'direct', string> = {
  plan: 'Plan',
  direct: 'Direct',
};

export const SOURCE_KIND_LABELS: Record<SourceKind, string> = {
  adr: 'ADR',
  tech_debt: 'tech-debt',
  roadmap: 'ROADMAP',
  contract: 'contract',
};

export const EVIDENCE_MARK: Record<EvidenceStatus, string> = {
  satisfied: '[x]',
  unsatisfied: '[ ]',
  exempt: '[~]',
};

export function trackSessionText(session: { status: SessionRef['status'] } | undefined | null): string {
  return session ? `session · ${SESSION_STATUS_LABELS[session.status]}` : 'No session';
}

export function dependsOnText(count: number): string {
  return `depends on ${count}`;
}

export function needsText(kind: EvidenceKind): string {
  return `needs ${EVIDENCE_LABELS[kind].toLowerCase()}`;
}

export function modeText(mode: 'plan' | 'direct'): string {
  return `${MODE_LABELS[mode]} mode`;
}

export function stoppedAtGate(gate: string): string {
  return `stopped · ${gate}`;
}

export function formatUsd(usd: number): string {
  return `$${usd.toFixed(2)}`;
}

// Chrome affordance strings — also routed through data so components carry no literal copy.
export const UI = {
  productName: 'Docket',
  backToBoard: '← Board',
  evidence: 'Evidence',
  tracks: 'Tracks',
  session: 'Session',
  sources: 'Sources',
  noWorkOrders: 'No work orders',
  noSessionForRole: 'No session for this role.',
  transcriptEmpty: '(transcript empty)',
  provisional: 'provisional',
  ciExempt: 'CI exempt',
  tokens: 'tokens',
  orderDoc: 'order.md',
  planDoc: 'plan.md',
  workOrders: 'work orders',
  noActionAvailable: 'No action available.',
  tracksUnit: 'track(s)',
  missing: 'missing',
  scopedToTrack: ' · track',
} as const;
