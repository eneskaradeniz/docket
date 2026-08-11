// src/core/session-store.ts — the live-session persistence + prompt-assembly PORT (WO-0023).
//
// The drive loop (src/core/pipeline.ts) records live-session/step/verdict state and assembles prompts
// server-side. Those methods lived on the concrete Store adapter (src/adapters/store); this lifts them to a
// core port so the pipeline depends on an interface, not an adapter — and so the drive loop is testable with
// a fake store, without SQLite or an agent (ADR-0006 line 30). The adapter's `Store implements SessionStore`;
// the UI's `WorkOrderSource` stays the read/CRUD half.
import type { CostSummary, SessionRef, SessionRole, StepRole, TrackId, WorkOrderId } from './types';

export interface RecordSessionInput {
  providerSessionId: string;
  workOrderId: WorkOrderId;
  role: SessionRole;
  scope?: TrackId;
  status: SessionRef['status'];
  cost?: CostSummary;
  stepIdx?: number; // the plan step this session runs (WO-0017); undefined for the architect plan session
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
}
