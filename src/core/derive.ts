// The product rules (ADR-0005 consequence): pure functions over WorkOrder state. No React, no I/O.
// `whoseTurn` is the gate engine from ADR-0001 read in the other direction.
import { GATES } from './gates';
import type {
  AbsentReason,
  ActionIntent,
  BoardColumn,
  CardReason,
  EvidenceItem,
  EvidenceKind,
  EvidenceStatus,
  PrimaryAction,
  RepoId,
  SessionRef,
  StageId,
  StageRailStep,
  StageStatus,
  Track,
  TrackId,
  TrackLaneView,
  TrackMergeAction,
  WorkOrder,
  WorkOrderCardView,
  WorkOrderDetailView,
} from './types';

const STAGE_ORDER: readonly StageId[] = [
  'written',
  'plan_requested',
  'plan_ready',
  'architect_approval',
  'implementation',
  'verification',
  'architect_audit',
  'closure',
  'closed',
];

const ADVANCE_INTENT: Partial<Record<StageId, ActionIntent>> = {
  written: 'request_plan',
  plan_requested: 'request_plan',
  plan_ready: 'approve_plan',
  architect_approval: 'resume',
  implementation: 'resume',
  verification: 'audit',
  architect_audit: 'merge_track',
  closure: 'close',
  closed: 'close',
};

const ABSENT_REASON: Partial<Record<EvidenceKind, AbsentReason>> = {
  plan_approval: 'awaiting_plan_commit',
  verification: 'verifier_report_missing',
  closure: 'docs_not_updated',
};

const stageIndex = (s: StageId): number => STAGE_ORDER.indexOf(s);

// WO-level gate evidence status. pr_open / ci_green are per-track and handled in deriveEvidence.
function woGateStatus(wo: WorkOrder, kind: EvidenceKind): EvidenceStatus {
  switch (kind) {
    case 'plan_approval':
      return wo.gateInputs.planApproved ? 'satisfied' : 'unsatisfied';
    case 'verification':
      return wo.gateInputs.verifierReport?.resolvablePointers ? 'satisfied' : 'unsatisfied';
    case 'closure':
      return wo.gateInputs.closureDocsSha != null ? 'satisfied' : 'unsatisfied';
    default:
      return 'unsatisfied';
  }
}

function unsatisfiedGateKinds(wo: WorkOrder): EvidenceKind[] {
  const gate = GATES[wo.stage];
  if (!gate) return [];
  return gate.filter((k) => woGateStatus(wo, k) !== 'satisfied');
}

function ciActivelyRunning(wo: WorkOrder): boolean {
  return wo.tracks.some((t) => {
    if (t.ci.kind !== 'run') return false;
    return t.ci.state === 'running' || t.ci.checks.some((c) => c.conclusion === 'pending');
  });
}

function trackCiStatus(t: Track): EvidenceStatus {
  if (t.ci.kind === 'exempt') return 'exempt';
  return t.ci.state === 'success' ? 'satisfied' : 'unsatisfied';
}

function allTracksMerged(wo: WorkOrder): boolean {
  return wo.tracks.length > 0 && wo.tracks.every((t) => t.merge != null);
}

// whoseTurn — first match wins; default your_turn (a work order matching no rule is on the operator).
export function whoseTurn(wo: WorkOrder): BoardColumn {
  if (wo.sessions.some((s) => s.status === 'stopped_asking')) return 'your_turn';
  if (wo.tracks.some((t) => t.ci.kind === 'run' && t.ci.state === 'failed')) return 'your_turn';
  if (unsatisfiedGateKinds(wo).length > 0) return 'your_turn';
  if (wo.sessions.some((s) => s.status === 'running')) return 'running';
  if (ciActivelyRunning(wo)) return 'external';
  return 'your_turn';
}

export function deriveCardReason(wo: WorkOrder): CardReason {
  const stopped = wo.sessions.find((s) => s.status === 'stopped_asking');
  if (stopped && stopped.status === 'stopped_asking') {
    return { kind: 'stopped_asking', gate: stopped.stopAndAsk.gate };
  }

  const failed = wo.tracks.find((t) => t.ci.kind === 'run' && t.ci.state === 'failed');
  if (failed && failed.ci.kind === 'run') {
    const failing = failed.ci.checks.find((c) => c.conclusion === 'failure');
    return { kind: 'ci_failed', checkName: failing?.name ?? 'checks' };
  }

  const unsat = unsatisfiedGateKinds(wo);
  if (unsat.includes('plan_approval')) return { kind: 'awaiting_plan_commit' };
  if (unsat.includes('closure')) return { kind: 'docs_not_updated' };

  if (wo.sessions.some((s) => s.status === 'running')) return { kind: 'in_progress' };
  if (ciActivelyRunning(wo)) return { kind: 'ci_running' };
  return { kind: 'awaiting_next_session' };
}

export function deriveRail(wo: WorkOrder): StageRailStep[] {
  const cur = stageIndex(wo.stage);
  return STAGE_ORDER.map((stage): StageRailStep => {
    const idx = stageIndex(stage);
    let status: StageStatus;
    if (idx < cur) status = 'done';
    else if (idx > cur) status = 'upcoming';
    else status = unsatisfiedGateKinds(wo).length > 0 ? 'locked' : 'current';
    if (status !== 'locked') return { stage, status };
    const gate = GATES[stage] ?? [];
    return { stage, status, needs: gate.filter((k) => woGateStatus(wo, k) !== 'satisfied') };
  });
}

export function deriveEvidence(wo: WorkOrder): EvidenceItem[] {
  const items: EvidenceItem[] = [];
  const woKinds: EvidenceKind[] = ['plan_approval', 'verification', 'closure'];
  for (const k of woKinds) items.push({ kind: k, status: woGateStatus(wo, k) });

  for (const t of wo.tracks) {
    items.push({ kind: 'pr_open', status: t.pr ? 'satisfied' : 'unsatisfied', scope: t.id });
    const ciItem: EvidenceItem =
      t.ci.kind === 'exempt'
        ? { kind: 'ci_green', status: 'exempt', exemption: { reason: t.ci.reason }, scope: t.id }
        : { kind: 'ci_green', status: trackCiStatus(t), scope: t.id };
    items.push(ciItem);
  }
  return items;
}

export function derivePrimaryAction(wo: WorkOrder): PrimaryAction {
  const gate = GATES[wo.stage];
  if (gate) {
    const unsat = gate.filter((k) => woGateStatus(wo, k) !== 'satisfied');
    if (unsat.length === 0) return { kind: 'available', intent: ADVANCE_INTENT[wo.stage] ?? 'resume' };
    return { kind: 'absent', reason: ABSENT_REASON[unsat[0]] ?? 'awaiting_plan_commit' };
  }
  if (wo.stage === 'implementation') {
    return { kind: 'available', intent: allTracksMerged(wo) ? 'request_verification' : 'resume' };
  }
  return { kind: 'available', intent: ADVANCE_INTENT[wo.stage] ?? 'resume' };
}

export function deriveTrackMerge(wo: WorkOrder, track: Track): TrackMergeAction {
  if (track.merge) return { kind: 'absent', reason: 'already_merged' };
  const openDep = track.dependsOn.some((dep) => !wo.tracks.some((t) => t.id === dep && t.merge != null));
  if (openDep) return { kind: 'absent', reason: 'depends_on_open' };
  if (!track.pr) return { kind: 'absent', reason: 'pr_not_open' };
  if (track.ci.kind === 'run' && track.ci.state !== 'success') {
    return { kind: 'absent', reason: 'ci_not_green' };
  }
  return { kind: 'available' };
}

export function sessionForTrack(wo: WorkOrder, trackId: TrackId): SessionRef | undefined {
  return wo.sessions.find((s) => s.role === 'implementer' && s.scope === trackId);
}

export function toCardView(wo: WorkOrder): WorkOrderCardView {
  return {
    id: wo.id,
    title: wo.title,
    workspace: wo.workspace,
    stage: wo.stage,
    column: whoseTurn(wo),
    reason: deriveCardReason(wo),
    primaryRepo: wo.tracks[0]?.repo ?? ('' as RepoId),
    trackCount: wo.tracks.length,
    cost: wo.cost,
  };
}

export function toDetailView(wo: WorkOrder): WorkOrderDetailView {
  return {
    id: wo.id,
    title: wo.title,
    workspace: wo.workspace,
    mode: wo.mode,
    rail: deriveRail(wo),
    tracks: wo.tracks.map(
      (t): TrackLaneView => ({
        track: t,
        session: sessionForTrack(wo, t.id),
        mergeAction: deriveTrackMerge(wo, t),
      }),
    ),
    evidence: deriveEvidence(wo),
    sessions: wo.sessions,
    primaryAction: derivePrimaryAction(wo),
    sources: wo.sources,
    cost: wo.cost,
  };
}
