// The product rules (ADR-0005 consequence): pure functions over WorkOrder state. No React, no I/O.
// `whoseTurn` is the gate engine from ADR-0001 read in the other direction.
import { GATES } from './gates';
import type { LiveSessionStatus } from './runner'; // type-only — runner imports only types.ts, no cycle
import type {
  AbsentReason,
  ActionIntent,
  BoardBucket,
  BoardColumn,
  CardAction,
  CardActionKind,
  CardReason,
  CostSummary,
  EvidenceItem,
  EvidenceKind,
  EvidenceStatus,
  PrimaryAction,
  SessionRef,
  SessionRole,
  StageId,
  StageRailStep,
  StageStatus,
  StepSpec,
  StepStatus,
  StepView,
  Track,
  TrackId,
  TrackLaneView,
  TrackMergeAction,
  TrackStage,
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
    // No PR yet ⇒ nothing is actually running (WO-0027 / TD-024): a freshly-created track's seeded
    // `running` CI claim is a placeholder until the forge observes a real check run (M3).
    if (t.ci.kind !== 'run' || !t.pr) return false;
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

// Stage is DERIVED from observed facts, never stored (ADR-0010 "no stage column on an
// observed table" / TD-008). The store sets WorkOrder.stage by calling this at hydration;
// every other function here then reads wo.stage as before. M2 derivation is coarse where
// the observed facts available don't distinguish the finer plan/audit stages (plan_requested /
// plan_ready / verification / architect_audit are not represented) — M3 refines from live
// git/forge observation. `written` (WO-0015) is the freshly-authored state: order.md exists
// but no session has run and the plan is not approved — distinct from `architect_approval`,
// where a plan exists and awaits the operator's verdict.
export function deriveStage(wo: Pick<WorkOrder, 'gateInputs' | 'tracks' | 'sessions'>): StageId {
  if (wo.sessions.length === 0 && !wo.gateInputs.planApproved) return 'written';
  if (!wo.gateInputs.planApproved) return 'architect_approval';
  const allMerged = wo.tracks.length > 0 && wo.tracks.every((t) => t.merge != null);
  if (allMerged && wo.gateInputs.verifierReport?.resolvablePointers) {
    return wo.gateInputs.closureDocsSha != null ? 'closed' : 'closure';
  }
  return 'implementation';
}

// Per-work-order cost, DERIVED from the WO's session list (ADR-0010 rule 2 — the same lesson as
// deriveStage for `stage`: a stored aggregate is a claim wearing a schema). The store sets
// WorkOrder.cost = deriveWorkOrderCost(sessions) at hydrate; undefined session costs (a live row
// before turn_complete, or a fixture-less row) count as zero, never NaN. The session list is already
// WO-scoped by the store query (WHERE work_order_id = ?).
export function deriveWorkOrderCost(sessions: ReadonlyArray<Pick<SessionRef, 'cost'>>): CostSummary {
  let tokensIn = 0;
  let tokensOut = 0;
  let usd = 0;
  for (const s of sessions) {
    const c = s.cost;
    if (c) {
      tokensIn += c.tokensIn;
      tokensOut += c.tokensOut;
      usd += c.usd;
    }
  }
  return { tokensIn, tokensOut, usd };
}

// A track's stage is forge-owned pr/ci/merge fact plus whether an implementer session is
// actively scoped to it — derived, never stored (ADR-0010 rule 2 generalised: a track's
// `stage` sat on the same row as pr_url/ci_kind/merged_at, i.e. derived data beside its
// own inputs). `hasActiveSession` = a session scoped to this track with status != 'none'.
export function deriveTrackStage(track: Pick<Track, 'pr' | 'merge'>, hasActiveSession: boolean): TrackStage {
  if (track.merge) return 'merged';
  if (track.pr) return 'ci';
  return hasActiveSession ? 'implementation' : 'not_started';
}

// The plan's steps, zipped with their resolved runtime state (WO-0017). The SPECS come from
// `parsePlanSteps(plan.md)` (git-owned text, read at view time — ADR-0010); the RESOLUTION map is built by
// the store: it resolves each `scope.ref` to a branded TrackId (the adapter's job — core never constructs
// one) and carries the run status/reportPath from the observed `work_order_step` rows.
//
// Derivation rules: a track-scoped step whose ref matched no track (`scopeTrackId` undefined) is `blocked`
// — it can never run, and that is shown honestly rather than silently running it as 'all'. An 'all'-scoped
// step is always runnable. A step with no run row is `pending`; otherwise its observed status wins.
export interface ObservedStep {
  status?: StepStatus; // undefined when the step has not yet run
  reportPath?: string;
  verdict?: 'proceed' | 'revise'; // the architect review outcome (WO-0020); undefined = not yet reviewed
  verdictPath?: string;
  scopeTrackId?: TrackId; // the adapter's branded resolution; undefined for 'all' or an unmatched ref
}

export function deriveSteps(specs: StepSpec[], observed: ReadonlyMap<number, ObservedStep>): StepView[] {
  return specs.map((s): StepView => {
    const o = observed.get(s.idx);
    const scopeTrackId = o?.scopeTrackId;
    if (s.scope.kind === 'track' && scopeTrackId === undefined) {
      return { idx: s.idx, role: s.role, aim: s.aim, scope: s.scope, status: 'blocked' };
    }
    return {
      idx: s.idx,
      role: s.role,
      aim: s.aim,
      scope: s.scope,
      ...(scopeTrackId !== undefined ? { scopeTrackId } : {}),
      status: o?.status ?? 'pending',
      ...(o?.reportPath ? { reportPath: o.reportPath } : {}),
      ...(o?.verdict ? { verdict: o.verdict } : {}),
      ...(o?.verdictPath ? { verdictPath: o.verdictPath } : {}),
    };
  });
}

// whoseTurn — first match wins; default your_turn (a work order matching no rule is on the operator).
// A RUNNING session outranks an unsatisfied gate (base-mobile trial, 2026-08-21): during the plan
// drive the plan_approval gate is unsatisfied BECAUSE the session is still working toward it — the
// gate check first left the board claiming "Sıra sende" for the drive's whole run. The operator's
// turn over a gated stage resumes when the session ends or stops to ask.
export function whoseTurn(wo: WorkOrder): BoardColumn {
  if (wo.sessions.some((s) => s.status === 'stopped_asking')) return 'your_turn';
  if (wo.tracks.some((t) => t.ci.kind === 'run' && t.ci.state === 'failed')) return 'your_turn';
  if (wo.sessions.some((s) => s.status === 'running')) return 'running';
  if (unsatisfiedGateKinds(wo).length > 0) return 'your_turn';
  if (ciActivelyRunning(wo)) return 'external';
  return 'your_turn';
}

export function deriveCardReason(wo: WorkOrder): CardReason {
  // Pre-merge (operator tour of PR #37): a closed WO is not "awaiting the next session" — the
  // archive card said 'Sonraki oturum bekleniyor' under a Kapalı badge. Closed is terminal.
  if (wo.stage === 'closed') return { kind: 'closed' };
  if (wo.stage === 'written') return { kind: 'just_written' };
  const stopped = wo.sessions.find((s) => s.status === 'stopped_asking');
  if (stopped && stopped.status === 'stopped_asking') {
    return { kind: 'stopped_asking', gate: stopped.stopAndAsk.gate };
  }

  const failed = wo.tracks.find((t) => t.ci.kind === 'run' && t.ci.state === 'failed');
  if (failed && failed.ci.kind === 'run') {
    const failing = failed.ci.checks.find((c) => c.conclusion === 'failure');
    return { kind: 'ci_failed', checkName: failing?.name ?? 'checks' };
  }

  // The same precedence as whoseTurn: a running session is working TOWARD the gate — in_progress
  // outranks the gate reasons (base-mobile trial, 2026-08-21; the plan drive said "Plan onayı
  // bekleniyor" while the architect was still writing the plan).
  if (wo.sessions.some((s) => s.status === 'running')) return { kind: 'in_progress' };

  // 2026-08-24 (operator, live run): a STOPPED session row — the operator interrupted a drive; it
  // resumes, it did not end. Without this the card fell through to the gate reasons and said
  // "Plan onayı bekleniyor" over a plan that does not exist.
  if (wo.sessions.some((s) => s.status === 'stopped')) return { kind: 'session_stopped' };

  const unsat = unsatisfiedGateKinds(wo);
  if (unsat.includes('plan_approval')) return { kind: 'awaiting_plan_commit' };
  if (unsat.includes('closure')) return { kind: 'docs_not_updated' };

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

// The approved two-bucket board (WO-0013). 'external' (forge/CI work happening without the operator)
// folds into 'working'; 'closed' work orders collapse into the drawer.
export function deriveBucket(c: { column: BoardColumn; stage: StageId }): BoardBucket {
  if (c.stage === 'closed') return 'closed';
  if (c.column === 'running' || c.column === 'external') return 'working';
  return 'up';
}

// The inline ▸ next-action on a card, derived from the primary action + card reason. Working states
// (a running session / CI) surface no inline action — the card shows a working indicator instead.
export function deriveCardAction(wo: WorkOrder): CardAction | undefined {
  // Pre-merge (operator tour of PR #37): a closed WO carries NO inline action — the archive card
  // is a record, not a next step. Without this, derivePrimaryAction happily re-derives the close
  // intent (every gate is satisfied after closure) and the card claims ▸ Kapatılabilir forever.
  if (wo.stage === 'closed') return undefined;
  const reason = deriveCardReason(wo);
  if (reason.kind === 'in_progress' || reason.kind === 'ci_running') return undefined;
  if (reason.kind === 'stopped_asking') return { kind: 'permission', intent: 'resume' };
  // WO-0031e tur-3: a closable WO (adapter-derived canClose) names its own action — the card says
  // ▸ Kapatılabilir. Disjoint from plan (closable requires planApproved) and from an unresolved
  // revise (canClose requires every verdict proceed), so it can only be the closure intent.
  if (wo.closeable) return { kind: 'closure', intent: 'close' };
  const primary = derivePrimaryAction(wo);
  if (primary.kind === 'absent') return undefined;
  const intent = primary.intent;
  if (intent === 'approve_plan') return { kind: 'plan', intent };
  if (intent === 'close') return { kind: 'closure', intent };
  return { kind: 'link', intent };
}

/** Sort rank within the 'up' bucket (lower = needs you sooner). Working/closed cards have no action. */
export function deriveCardActionRank(action: CardAction | undefined): number {
  if (!action) return 4;
  const rank: Record<CardActionKind, number> = { permission: 0, plan: 1, closure: 2, link: 3 };
  return rank[action.kind];
}

export function toCardView(wo: WorkOrder): WorkOrderCardView {
  const column = whoseTurn(wo);
  const action = deriveCardAction(wo);
  const active = wo.sessions.find((s) => s.status === 'running' || s.status === 'stopped_asking');
  // WO-0031f T3 — the card Süre is the finished-session sum: the same arithmetic deriveSessionAudit's
  // total speaks (Math.max(0, ended − started), 0 while either date is absent), so the card, the strip
  // and the Toplam row can never disagree. Rides the existing getWorkOrders payload (TD-036).
  const durationMs = wo.sessions.reduce(
    (acc, s) =>
      acc + (s.startedAt && s.endedAt ? Math.max(0, new Date(s.endedAt).getTime() - new Date(s.startedAt).getTime()) : 0),
    0,
  );
  return {
    id: wo.id,
    title: wo.title,
    workspace: wo.workspace,
    stage: wo.stage,
    column,
    bucket: deriveBucket({ column, stage: wo.stage }),
    reason: deriveCardReason(wo),
    action,
    actionRank: deriveCardActionRank(action),
    closable: wo.closeable === true && wo.stage !== 'closed',
    role: active?.role,
    primaryRepo: wo.tracks[0]?.repo,
    trackCount: wo.tracks.length,
    sessionCount: wo.sessions.length,
    cost: wo.cost,
    costKnown: wo.sessions.some((s) => s.cost !== undefined),
    durationMs,
  };
}

// ===== The live-drive overlay (base-mobile trial, 2026-08-22) =====
//
// The board derives from store rows, and the session row is written only when the provider's first
// event arrives — so for the subprocess boot window (and any moment the renderer's rows lag the
// fold, e.g. right after an answered ask) the card would sit in "Sıra sende" while work is in
// flight. The app's drive memory — the same source the detail header band reads — overlays the card:
// a drive that is booting or running puts its WO in the working bucket, from the click. Every
// other fold status is a no-op: those moments are the rows' to narrate (a stopped_asking reason
// carries the gate, which only the row knows), and a closed archive is terminal.

/** What the app's drive memory knows about the ONE active drive — the board overlay's input. */
export interface LiveDriveFact {
  running: boolean; // the drive handle is live (booting or streaming)
  booting: boolean; // started, no first event folded yet — the subprocess spawn window
  status: LiveSessionStatus; // the fold's status
}

export function overlayLiveDrive(view: WorkOrderCardView, live: LiveDriveFact | undefined): WorkOrderCardView {
  if (!live || !live.running) return view;
  if (!(live.booting || live.status === 'running')) return view;
  if (view.bucket === 'closed') return view;
  return {
    ...view,
    column: 'running',
    bucket: 'working',
    reason: { kind: 'in_progress' },
    action: undefined,
    actionRank: deriveCardActionRank(undefined),
  };
}

// ===== WO-level phase (WO-0021) =====
//
// The plan-driven macro phase the operator is in — derived from the stage + the step list + whether a plan is
// pending (docs.plan exists but the gate is unflipped). The primary surface (a one-line banner); the fixed
// StageRail stays the secondary view behind "Akışı göster". A revise verdict is NOT its own phase (the
// VerdictCard carries it; the macro phase stays `implementing`).
export type WoPhase =
  | { kind: 'just_written' }
  | { kind: 'planning' } // architect_approval, no plan.md yet
  | { kind: 'plan_stopped' } // 2026-08-24: planning, and the proposal session was STOPPED by the operator
  | { kind: 'plan_ready' } // architect_approval, plan.md present (pending — TD-025 restart recovery)
  | { kind: 'implementing'; done: number; total: number }
  | { kind: 'reviewing'; stepIdx: number } // first done step with no verdict (the WO-0020 review trigger)
  | { kind: 'closing' }
  | { kind: 'done' };

export function derivePhase(
  wo: Pick<WorkOrder, 'stage' | 'sessions'>,
  steps: ReadonlyArray<Pick<StepView, 'idx' | 'status' | 'verdict'>>,
  hasPendingPlan: boolean,
): WoPhase {
  switch (wo.stage) {
    case 'written':
      return { kind: 'just_written' };
    case 'plan_requested':
    case 'plan_ready':
    case 'architect_approval':
      // In M2 deriveStage collapses these to architect_approval; the plan_pending flag distinguishes them.
      if (hasPendingPlan) return { kind: 'plan_ready' };
      // 2026-08-24 (operator, live run): a STOPPED proposal session changes the phase's voice — the
      // architect is not "düşünüyor" while interrupted; the proposal sits stopped, awaiting Sürdür.
      // Read from the ROWS: survives restarts (the live fold does not).
      if (wo.sessions.some((s) => s.status === 'stopped')) return { kind: 'plan_stopped' };
      return { kind: 'planning' };
    case 'implementation': {
      const reviewing = steps.find((s) => s.status === 'done' && !s.verdict);
      if (reviewing) return { kind: 'reviewing', stepIdx: reviewing.idx };
      const done = steps.filter((s) => s.status === 'done').length;
      return { kind: 'implementing', done, total: steps.length };
    }
    case 'verification':
    case 'architect_audit':
      // Not reached in M2 (deriveStage never yields these — TD-025); coerce to implementing if they ever are.
      return { kind: 'implementing', done: 0, total: 0 };
    case 'closure':
      return { kind: 'closing' };
    case 'closed':
      return { kind: 'done' };
  }
}

export function toDetailView(wo: WorkOrder, steps: StepView[] = [], reviewMode: 'gates' | 'every-step' = 'gates'): WorkOrderDetailView {
  return {
    id: wo.id,
    title: wo.title,
    workspace: wo.workspace,
    mode: wo.mode,
    stage: wo.stage,
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
    steps,
    reviewMode,
    gateInputs: wo.gateInputs,
    primaryAction: derivePrimaryAction(wo),
    sources: wo.sources,
    cost: wo.cost,
  };
}

// ===== Turn state (WO-0031c) =====
//
// ONE classifier for the three ambient surfaces of the console: the header band's turn line ("Sıra sende"),
// the glow wash and the action rail's lamp. Precedence mirrors where the operator's attention must go:
// a dead session (retry) outranks a pending ask, which outranks a running drive; the wind-down
// (`stopping` — interrupt sent, session still open) is still a running (spending) session; `stopped` is
// the controller's memory that a wind-down COMPLETED and Sürdür has not been clicked yet.
export type TurnState = 'yours' | 'running' | 'stopped' | 'retry' | 'done';

export function deriveTurnState(input: {
  phase: WoPhase;
  liveStatus: LiveSessionStatus; // the active drive's fold; 'idle' when no drive ran in this app session
  hasPendingAsks: boolean; // the runner holds unanswered permission asks
  stopping?: boolean; // interrupt sent, session not yet closed (Durduruluyor…)
  stopped?: boolean; // wind-down completed, awaiting Sürdür (controller-owned; cleared on resume)
  /** The boot window (base-mobile trial, 2026-08-21): the drive was started but the provider session
   *  has not opened yet (fold still 'idle' — no first event; the subprocess is spawning). The turn is
   *  running from the click — "Sıra sende" over a drive the operator just launched is a lie. */
  starting?: boolean; // store.start() ran, no first RunnerEvent yet
}): TurnState {
  // A closed work order is DONE — terminal, outranking any stale live state (tur-2: a closed WO used
  // to fall through to 'yours' and the header band claimed "Sıra sende" over an archive).
  if (input.phase.kind === 'done') return 'done';
  if (input.liveStatus === 'error') return 'retry';
  if (input.hasPendingAsks || input.liveStatus === 'stopped_asking') return 'yours';
  if (input.liveStatus === 'plan_ready') return 'yours';
  if (input.liveStatus === 'running' || input.stopping || input.starting) return 'running';
  // WO-0039 stabilization (2026-08-23): the fold itself carries the intentional stop now (the
  // `interrupted` event) — not only the controller's `stopped` memory. A stale-'running' fold can
  // no longer mask the completed wind-down (the glow used to stay run-colored after Durdur).
  if (input.liveStatus === 'stopped' || input.stopped) return 'stopped';
  return 'yours';
}

// ===== Session ledger / Denetim (WO-0031c) =====
//
// One row per session in the same language the step cards speak: the architect's plan session is
// "Plan", an architect session on a step is that step's REVIEW ("İnceleme N"), and implementer/verifier
// sessions are the step run ("Adım N · aim"). Names are STRUCTURED — labels render them (ADR-0007).
// Rows sort by start time; a live session (no endedAt) contributes zero duration, never NaN; an absent
// cost stays undefined (the ledger shows "—", not a fake $0,00 — the same honesty as TD-030).

export type SessionAuditName =
  | { kind: 'plan' }
  | { kind: 'step'; idx: number; aim?: string }
  | { kind: 'review'; idx: number }
  | { kind: 'unscoped' };

export interface SessionAuditRow {
  name: SessionAuditName;
  role: SessionRole;
  sourceIdx: number; // WO-0031e tur-3 — the INPUT session index (rows are sorted); the row expansion maps sessions[sourceIdx].transcript
  startedAt?: string;
  endedAt?: string;
  durationMs: number;
  costUsd?: number;
}

export function deriveSessionAudit(
  sessions: ReadonlyArray<Pick<SessionRef, 'role' | 'stepIdx' | 'startedAt' | 'endedAt' | 'cost'>>,
  steps: ReadonlyArray<Pick<StepSpec, 'idx' | 'aim'>> = [],
): { rows: SessionAuditRow[]; total: { startAt?: string; endAt?: string; durationMs: number; costUsd: number } } {
  const rows = sessions
    .map((s, sourceIdx) => ({ s, sourceIdx })) // WO-0031e tur-3 — capture the INPUT index before the sort
    .sort((x, y) => (x.s.startedAt ?? '').localeCompare(y.s.startedAt ?? ''))
    .map(({ s, sourceIdx }): SessionAuditRow => {
      const name: SessionAuditName =
        s.role === 'architect'
          ? s.stepIdx === undefined
            ? { kind: 'plan' }
            : { kind: 'review', idx: s.stepIdx }
          : s.stepIdx === undefined
            ? { kind: 'unscoped' }
            : { kind: 'step', idx: s.stepIdx, ...(s.stepIdx !== undefined ? { aim: steps.find((st) => st.idx === s.stepIdx)?.aim } : {}) };
      const durationMs =
        s.startedAt && s.endedAt
          ? Math.max(0, new Date(s.endedAt).getTime() - new Date(s.startedAt).getTime())
          : 0;
      return {
        name,
        role: s.role,
        sourceIdx,
        ...(s.startedAt ? { startedAt: s.startedAt } : {}),
        ...(s.endedAt ? { endedAt: s.endedAt } : {}),
        durationMs,
        ...(s.cost ? { costUsd: s.cost.usd } : {}),
      };
    });
  const withStart = rows.filter((r) => r.startedAt !== undefined);
  const withEnd = rows.filter((r) => r.endedAt !== undefined);
  return {
    rows,
    total: {
      ...(withStart.length > 0 ? { startAt: withStart.map((r) => r.startedAt)!.sort()[0] } : {}),
      ...(withEnd.length > 0 ? { endAt: withEnd.map((r) => r.endedAt)!.sort().at(-1) } : {}),
      durationMs: rows.reduce((acc, r) => acc + r.durationMs, 0),
      costUsd: rows.reduce((acc, r) => acc + (r.costUsd ?? 0), 0),
    },
  };
}

// ===== Work-order closure (WO-0025 / P1-2) =====
//
// A work order is CLOSEABLE when the plan was approved and every plan step finished AND was reviewed —
// exactly the state the "Tüm adımlar tamam" card already celebrates (WorkOrderDetail's allStepsDone plus the
// verdicts the review loop records). Pure: the store re-checks the same facts from the DB before writing.

/** The minimum step facts closure needs — satisfied by both `StepView` and a DB row projection. */
export type CloseableStep = Pick<StepView, 'status' | 'verdict'>;

export type CloseCheck =
  | { ok: true }
  | { ok: false; reason: 'plan_not_approved' | 'no_steps' | 'step_not_done' | 'step_not_reviewed' | 'step_not_resolved' };

export function canClose(input: { planApproved: boolean; steps: CloseableStep[] }): CloseCheck {
  if (!input.planApproved) return { ok: false, reason: 'plan_not_approved' };
  if (input.steps.length === 0) return { ok: false, reason: 'no_steps' };
  if (input.steps.some((s) => s.status !== 'done')) return { ok: false, reason: 'step_not_done' };
  if (input.steps.some((s) => !s.verdict)) return { ok: false, reason: 'step_not_reviewed' };
  // WO-0029 / B19: a revise verdict is an OPEN decision — the operator overrides it (Devam et) or re-runs
  // the step; a work order never closes with an unresolved revise silently absorbed.
  if (input.steps.some((s) => s.verdict !== 'proceed')) return { ok: false, reason: 'step_not_resolved' };
  return { ok: true };
}
