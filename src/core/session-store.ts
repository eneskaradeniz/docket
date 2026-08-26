// src/core/session-store.ts — the live-session persistence + prompt-assembly PORT (WO-0023).
//
// The drive loop (src/core/pipeline.ts) records live-session/step/verdict state and assembles prompts
// server-side. Those methods lived on the concrete Store adapter (src/adapters/store); this lifts them to a
// core port so the pipeline depends on an interface, not an adapter — and so the drive loop is testable with
// a fake store, without SQLite or an agent (ADR-0006 line 30). The adapter's `Store implements SessionStore`;
// the UI's `WorkOrderSource` stays the read/CRUD half.
import type { CostSummary, PermissionAsk, SessionRef, SessionRole, SteerNote, StepRole, TrackId, TranscriptLine, WorkOrderId } from './types';
import type { BudgetRefusal } from './runner';

export interface RecordSessionInput {
  providerSessionId: string;
  workOrderId: WorkOrderId;
  role: SessionRole;
  scope?: TrackId;
  status: SessionRef['status'];
  cost?: CostSummary;
  stepIdx?: number; // the plan step this session runs (WO-0017); undefined for the architect plan session
  transcript?: TranscriptLine[]; // the folded live transcript checkpoint (WO-0026/F6) — rewritten per record
  asks?: PermissionAsk[]; // the unanswered asks at a stopped_asking record (WO-0027/Bulgu 9) — persisted for re-attach
  pendingNotes?: SteerNote[]; // the queued steer notes (WO-0045) — LATEST-WINS: the live fold overwrites;
  //                             undefined KEEPS the prior row's notes (a record from a notes-blind path must
  //                             not silently drop them)
  startedAt?: string; // ISO — preserved across every record of the drive (WO-0027 / İstek 7)
  endedAt?: string; // ISO — set only on the terminal record
}

/** Server-side persistence + prompt assembly the drive loop needs. The composition root injects the
 *  adapter's `Store`; the pipeline never imports the adapter. */
export interface SessionStore {
  /** Persist (upsert) a live session row keyed by provider session id — drive side-effect (WO-0010). */
  recordSession(input: RecordSessionInput): void;
  /** Upsert a step's run outcome — status + report pointer (WO-0017). */
  recordStep(workOrderId: WorkOrderId, idx: number, patch: { status: 'active' | 'done'; reportPath?: string }): void;
  /** Write a step's report to the decision store + mark the step done (WO-0017). Drive side-effect at turn_complete. */
  recordStepReport(workOrderId: WorkOrderId, idx: number, role: StepRole, body: string): void;
  /** Write the architect's verdict for a step (WO-0020): verdicts/step-NN.md + UPDATE the verdict columns. */
  recordStepVerdict(workOrderId: WorkOrderId, idx: number, verdict: 'proceed' | 'revise', body: string): void;
  /** Write the architect's proposed plan to plan.md as PENDING so it survives restart (WO-0020, closes TD-025). */
  savePendingPlan(workOrderId: WorkOrderId, planText: string): void;
  /** The architect PLAN session's first prompt, assembled from order.md (WO-0016). */
  architectPromptFor(workOrderId: WorkOrderId): string | undefined;
  /** A step session's prompt + resolved track scope, assembled from order.md + plan.md (WO-0017). */
  stepPromptFor(workOrderId: WorkOrderId, idx: number): { prompt: string; scope?: TrackId } | undefined;
  /** The architect's REVIEW prompt for a step (WO-0020). Undefined when plan/step/report missing. */
  stepReviewPromptFor(workOrderId: WorkOrderId, idx: number): string | undefined;
  /** The work order's PLAN-APPROVAL gate. WO-0038 incident (2026-08-22): the pipeline REFUSES step
   *  and review drives while it is closed — the gate is enforced at the pipeline/store layer, not
   *  only derived in the UI (any host — GUI pane or CLI `drive --step` — is refused alike). */
  planApprovedFor(workOrderId: WorkOrderId): boolean;
  /** The work order's FLOW MODE (WO-0045), read from order.md front-matter at spawn time: in 'manual'
   *  the pipeline refuses any `origin:'auto'` step/review spawn — no drive starts itself. Absent
   *  order.md / missing key → 'auto' (today's behavior). */
  flowModeFor(workOrderId: WorkOrderId): 'auto' | 'manual';
  /** The workspace BUDGET gate (WO-0047), read at spawn time only: when the calendar-month spend
   *  of the drive's workspace meets its configured cap, returns the refusal's facts (observed
   *  spend + cap) and the pipeline refuses EVERY drive — plan, step, review, resume — before the
   *  runner spawns. undefined = no block (no threshold configured, or below the cap). Called
   *  UNCONDITIONALLY: fakes must implement it — a `typeof` guard would hide a missing impl behind
   *  a contract that only fails in production. */
  budgetBlockFor(workOrderId: WorkOrderId): BudgetRefusal | undefined;
  /** The queued steer notes persisted on a session row (WO-0045) — what Sürdür delivers. [] when the
   *  row carries none (the SDK queue died with the stop; this row is the only carrier). */
  pendingNotesFor(workOrderId: WorkOrderId, providerSessionId: string): SteerNote[];
  /** Append a steer-lifecycle audit event to the WO timeline (WO-0045). Detail may quote the note —
   *  the operator's own words — never an environment value (CLAUDE.md 2026-08-26). */
  recordAuditEvent(workOrderId: WorkOrderId, kind: 'steer_queued' | 'steer_delivered' | 'steer_retracted', detail: string): void;
}
