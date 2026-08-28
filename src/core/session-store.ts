// src/core/session-store.ts — the live-session persistence + prompt-assembly PORT (WO-0023).
//
// The drive loop (src/core/pipeline.ts) records live-session/step/verdict state and assembles prompts
// server-side. Those methods lived on the concrete Store adapter (src/adapters/store); this lifts them to a
// core port so the pipeline depends on an interface, not an adapter — and so the drive loop is testable with
// a fake store, without SQLite or an agent (ADR-0006 line 30). The adapter's `Store implements SessionStore`;
// the UI's `WorkOrderSource` stays the read/CRUD half.
import type { CostSummary, PermissionAsk, SessionRef, SessionRole, SteerNote, StepRole, TrackId, TranscriptLine, TurnUsage, WorkOrderId, WorkspaceId } from './types';
import type { BudgetRefusal } from './runner';
import type { DraftSourceSummary } from './roadmap-draft';

// WO-0050 / D3: a session's OWNER — every session belongs to exactly one. A work-order session
// (the pre-WO-0050 universe) or a workspace-scoped session (the roadmap draft drive). The pipeline
// computes this once per drive from `isDraftDrive`; the store keys its rows by it.
export type SessionOwner = { kind: 'wo'; workOrderId: WorkOrderId } | { kind: 'draft'; workspaceId: WorkspaceId };

export interface RecordSessionInput {
  providerSessionId: string;
  owner: SessionOwner;
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
  // WO-0052 usage checkpoints, BOTH undefined-KNOWS-NOTHING: undefined KEEPS the prior row's
  // values (the `pendingNotes` keep-prior rule above — a record from a path whose fold holds no
  // reading must not erase the latest known one), defined OVERWRITES (latest-wins).
  ctx?: { usedTokens: number; maxTokens: number }; // the LATEST context-window reading, checkpointed at each record
  finalUsage?: TurnUsage; // the last observed rich usage detail (the session row's final figure)
}

/** Server-side persistence + prompt assembly the drive loop needs. The composition root injects the
 *  adapter's `Store`; the pipeline never imports the adapter. */
export interface SessionStore {
  /** Persist (upsert) a live session row keyed by provider session id + owner — drive side-effect (WO-0010). */
  recordSession(input: RecordSessionInput): void;
  /** Append ONE per-turn usage row (WO-0052) — one INSERT per OBSERVED provider result, including
   *  the held intermediates of a steered drive. Append-only (the `appendEvent` discipline): rows
   *  are never updated, never deleted by the session upsert, and a resume leg appends to the SAME
   *  session (its deltas are that leg's own spend under the per-leg `applyResultCost` baseline —
   *  no double-count). `usage` carries the result's optional rich detail; absent fields stay
   *  absent, never zeros. */
  recordTurnUsage(owner: SessionOwner, providerSessionId: string, row: { at: string; delta: CostSummary; usage?: TurnUsage }): void;
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
   *  only derived in the UI (any host — GUI pane or CLI `drive --step` — is refused alike).
   *  WO-0050: a draft drive never carries step/review indexes, so this gate is never asked of one. */
  planApprovedFor(workOrderId: WorkOrderId): boolean;
  /** The work order's FLOW MODE (WO-0045), read from order.md front-matter at spawn time: in 'manual'
   *  the pipeline refuses any `origin:'auto'` step/review spawn — no drive starts itself. Absent
   *  order.md / missing key → 'auto' (today's behavior). A draft is never `origin:'auto'`. */
  flowModeFor(workOrderId: WorkOrderId): 'auto' | 'manual';
  /** The workspace BUDGET gate (WO-0047), read at spawn time only: when the calendar-month spend
   *  of the drive's workspace meets its configured cap, returns the refusal's facts (observed
   *  spend + cap) and the pipeline refuses EVERY drive — plan, step, review, resume — before the
   *  runner spawns. undefined = no block (no threshold configured, or below the cap). Called
   *  UNCONDITIONALLY: fakes must implement it — a `typeof` guard would hide a missing impl behind
   *  a contract that only fails in production.
   *  WO-0050 / D4: TWO explicit methods, not one unified parameter — the two keys resolve
   *  differently store-side (a join through the work order vs the workspace directly), and branded
   *  ids are compile-time only, so a `WorkOrderId | WorkspaceId` parameter is indistinguishable at
   *  runtime. Both carry the same "called unconditionally" clause; both fakes implement both. */
  budgetBlockFor(workOrderId: WorkOrderId): BudgetRefusal | undefined;
  /** The SAME gate, keyed directly by workspace — the WO-less draft drive's read (WO-0050). The
   *  draft session's own spend counts (the widened month sum includes workspace-keyed rows), so a
   *  draft can never bypass the cap the way a missing-WO row once silently did. */
  budgetBlockForDraft(workspaceId: WorkspaceId): BudgetRefusal | undefined;
  /** The queued steer notes persisted on a session row (WO-0045) — what Sürdür delivers. [] when the
   *  row carries none (the SDK queue died with the stop; this row is the only carrier). WO-0050: the
   *  owner union keys the row (an İtiraz resume re-queues carry notes like any resume). */
  pendingNotesFor(owner: SessionOwner, providerSessionId: string): SteerNote[];
  /** Append a steer-lifecycle audit event to the WO timeline (WO-0045). Detail may quote the note —
   *  the operator's own words — never an environment value (CLAUDE.md 2026-08-26). WO-only by design
   *  (D15): a draft has no wo_event home and needs none — the roadmap file + git is the record. */
  recordAuditEvent(workOrderId: WorkOrderId, kind: 'steer_queued' | 'steer_delivered' | 'steer_retracted', detail: string): void;
  /** The roadmap DRAFT drive's first prompt (WO-0050 / D5), assembled from the workspace's facts:
   *  the slug, the known repo slugs, the roadmap file's path — core's `roadmapDraftPrompt` builds
   *  the text (paths-not-contents; ONE mechanism). undefined when the workspace does not resolve
   *  (the pipeline refuses the drive pre-spawn — no empty-prompt provider run).
   *  WO-0051 / D5: `freeExplore` adds the ONE exploration sentence iff true (additive-optional —
   *  the dialog's ordinary flow passes nothing and the prompt stays deterministic). */
  roadmapDraftPromptFor(workspaceId: WorkspaceId, goalNote: string, docPaths: string[], freeExplore?: boolean): string | undefined;
  /** The draft drive's `plan_ready` side-effect (WO-0050 / D6): upsert the workspace's ONE pending
   *  `roadmap_draft` row (md + the provider session id İtiraz resumes). Supersede guard inside: a
   *  row whose md PARSES is never overwritten by one that does not — the refusal keeps the prior
   *  valid proposal ("bozuk taslak geçerliyi ezmesin" at the row, the parse-guard at approval).
   *  WO-0051 / D2: `opts.sourceSummary` persists the composition's COUNTS + explore flag — never
   *  a path; an İtiraz resume's summary-less write KEEPS the prior figures (keep-prior, like the
   *  provider session id); the summary dies with the row at approval. */
  saveRoadmapDraft(workspaceId: WorkspaceId, md: string, opts?: { providerSessionId?: string; sourceSummary?: DraftSourceSummary }): void;
  /** A FRESH (non-resume) draft clears the pending row once its gates pass (operator ruling
   *  2026-08-27: supersede — re-opening ✦ already decided the old proposal is dead). An İtiraz
   *  resume never clears; only this call and `approveRoadmapDraft` do. */
  clearRoadmapDraft(workspaceId: WorkspaceId): void;
}
