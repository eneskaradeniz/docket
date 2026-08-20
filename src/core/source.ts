// src/core/source.ts — data-access PORT declared in core (ADR-0006).
// Pure declaration, no logic. The adapter implements it (the SQLite store now; fixtures
// seed it). src/ui reaches data only through this port; it never imports an adapter.
//
// Async (WO-0009): the store is a real data source, so reads return Promises and the UI
// carries loading/error states. This replaces the throwaway sync IPC bridge (TD-017).
import type { RepoId, StepRole, StepView, WoEvent, Workspace, WorkOrder, WorkOrderId, WorkspaceId } from './types';

export interface RepoConnectionInput {
  path: string;
  remote?: string;
}

export interface CreateWorkspaceInput {
  label: string;
  repos: RepoConnectionInput[];
  /** Which repo path holds the decision store; omit/'' = same repo's docs/ folder. */
  decisionStorePath?: string;
}

// Review granularity, chosen when the work order is created (PRODUCT.md §Review mode). `gates` =
// the architect proceeds autonomously between steps; `every-step` = it surfaces its verdict after
// every step. Written to order.md front-matter; consumed by the architect runtime (WO-0016).
export type ReviewMode = 'gates' | 'every-step';

// The per-WORK-ORDER permission rule (WO-0031c / v4 "iş-emrine-izin-kuralı"). Settings holds only the
// DEFAULT; the rule lives on the work order — chosen at creation, changeable from the ask card, always
// visible as the strip badge, logged to the timeline. `ask_every` = Her seferinde sor; `risky_excluded`
// = Riskli hariç (the default — auto-approve in-scope asks except the risky set, see core/risky.ts);
// `full_auto` = Tam otomatik. The fence (scope) is unchanged in all three — this is cadence, not scope.
export type PermissionRule = 'ask_every' | 'risky_excluded' | 'full_auto';

export interface CreateWorkOrderInput {
  workspaceId: WorkspaceId;
  title: string;
  description: string; // → order.md Objective; the architect session's first prompt
  trackRepos: RepoId[]; // workspace code repos MINUS the decision-store repo
  reviewMode: ReviewMode; // → order.md front-matter (review_mode); not stored in the DB
  contextFiles: string[]; // local file paths → order.md Context
  permissionRule?: PermissionRule; // → order.md front-matter (permission_rule, WO-0031c); omit = the Settings default
}

/** The editable-after-creation fields (WO-0031c): the operator may retitle/redescribe a work order and
 *  switch its review cadence or permission rule at any time — every edit is logged to the timeline. */
export interface UpdateWorkOrderInput {
  title?: string;
  description?: string; // → order.md Objective
  reviewMode?: ReviewMode;
  permissionRule?: PermissionRule;
}

export interface WorkOrderSource {
  getWorkspaces(): Promise<Workspace[]>;
  getWorkOrders(): Promise<WorkOrder[]>;
  getWorkOrder(id: WorkOrderId): Promise<WorkOrder | undefined>;
  // Document text is NOT stored (ADR-0010) — served from fixtures in M2, git in M3.
  getWorkOrderDocs(id: WorkOrderId): Promise<{ order: string; plan: string }>;

  // Workspace management (WO-0014). The store brands ids + resolves the GitHub remote (best-effort).
  // M2 pragmatic CRUD (ADR-0009 addendum): the UI authors definitions into observed tables + connections
  // into the owned connection table; M3 git scanner reconciles.
  createWorkspace(input: CreateWorkspaceInput): Promise<Workspace>;
  updateWorkspace(id: WorkspaceId, patch: { label?: string; decisionStorePath?: string }): Promise<void>;
  // Delete a workspace with everything Docket recorded under it (WO-0032): every work order of the
  // workspace and its rows (tracks, steps, sessions, events — the deleteWorkOrder cascade, including
  // the Docket-authored docs/work-orders/WO-NNNN-* dirs in the decision store) plus the definition
  // and connection rows. Repo code and git history are never touched. Throws while any session of
  // the workspace is running, deleting nothing. The operator confirms in the UI before this fires.
  deleteWorkspace(id: WorkspaceId): Promise<void>;
  addRepoConnection(id: WorkspaceId, repo: RepoConnectionInput): Promise<void>;
  removeRepoConnection(id: WorkspaceId, path: string): Promise<void>;

  // Work-order creation (WO-0015). The store brands the id, authors order.md into the decision-store
  // working tree (Docket does NOT commit — operator commits; ADR-0009 M2 addendum), and inserts a thin
  // observed work_order row + tracks. `description`/`reviewMode`/`contextFiles` transit to order.md,
  // never to the DB (ADR-0010 rule 1 — no document text in the store). M3 git scanner reconciles.
  createWorkOrder(input: CreateWorkOrderInput): Promise<WorkOrder>;

  // Approve the architect's proposed plan (WO-0016). Writes plan.md into the decision-store working tree
  // (no commit — operator commits; ADR-0009 M2 addendum) and flips gate_plan_approved. The plan text is
  // the architect session's proposed plan (captured from the plan_ready event); it never enters the DB.
  // M2 ruling: the plan_approval gate is satisfied by the observed flag, not a commit sha (TD-005/TD-025).
  // WO-0031c: when the operator EDITED the steps before approving, `editedCount` rides the plan_approved
  // event (the "düzenlenmiş onay" — the timeline says what changed, not just that it happened).
  approvePlan(workOrderId: WorkOrderId, planText: string, opts?: { editedCount?: number }): Promise<void>;

  // Edit a work order after creation (WO-0031c): title/description → order.md (+ the DB title), review
  // mode / permission rule → order.md front-matter. Every edit appends a `wo_edited` event; a permission
  // rule change additionally appends `rule_changed`. Throws when the WO or its order.md is missing, and
  // — WO-0031f K1 — when the WO is closed (a closed work order is an immutable archive).
  updateWorkOrder(workOrderId: WorkOrderId, patch: UpdateWorkOrderInput): Promise<void>;

  // Record the operator's answer on a permission ask card (WO-0031c): the timeline carries what was
  // allowed/denied and on what target. The pipeline knows the requestId, not the work order — the UI,
  // which knows both, writes this at the same moment it resolves the ask.
  recordPermissionDecision(
    workOrderId: WorkOrderId,
    input: { allowed: boolean; tool: string; target: string },
  ): Promise<void>;

  // The plan's steps (WO-0017): specs parsed from plan.md's ```steps fence at view time, zipped with the
  // observed run state. [] when the plan has no steps fence or isn't approved. Detail-only — the board never
  // asks for steps (ADR-0010: specs are document text, never stored; only the run outcome is persisted).
  getWorkOrderSteps(workOrderId: WorkOrderId): Promise<StepView[]>;

  // A step's report body, read from the decision store at view time (ADR-0010 — report text is in git, not
  // the DB). Lazy per-step read. '' when the report file is absent (step not yet run).
  getStepReport(workOrderId: WorkOrderId, idx: number, role: StepRole): Promise<string>;

  // A step's verdict body (the architect's review), read from the decision store at view time (WO-0020).
  // Lazy per-step read. '' when the verdict is absent (step not yet reviewed).
  getStepVerdict(workOrderId: WorkOrderId, idx: number): Promise<string>;

  // Reset a step so it can be re-run: deletes its observed row (status/report/verdict) so deriveSteps shows
  // 'pending' again (WO-0020 revise path). The report/verdict files are overwritten on re-run/re-review.
  resetStep(workOrderId: WorkOrderId, idx: number): Promise<void>;

  // Delete a work order (WO-0020): cascade-delete its DB rows (sessions, tracks, steps, sources) + remove its
  // decision-store folder (order.md/plan.md/reports). Workspace + repo definitions are untouched. The operator
  // confirms in the UI before this fires.
  deleteWorkOrder(workOrderId: WorkOrderId): Promise<void>;

  // Close a finished work order (WO-0025 / P1-2): every step done + reviewed and the plan approved, else it
  // throws. Appends a `## Closure` note to order.md and records the three facts deriveStage needs. M2 ruling —
  // OPERATOR-ATTESTED closure, the mirror of the plan gate's ruling above: track merges are attested by the
  // operator (merged_at), the verifier gate is set, and the closure sha is the decision-store HEAD at close
  // time ("closed at this commit"), not yet an M3 docs-commit sha. Stage becomes `closed`.
  closeWorkOrder(workOrderId: WorkOrderId, note: string): Promise<void>;

  // WO-0029 / B19: the operator's override on a revise verdict ("Devam et") — the step's row flips to
  // proceed; the architect's original text stays in the verdict file. Idempotent (no-op when not revise).
  overrideStepVerdict(workOrderId: WorkOrderId, idx: number): Promise<void>;

  // WO-0030 / İstek 8: the work order's lifecycle audit (append-only, written by the store's own
  // mutations). [] for work orders created before the event log existed (legacy — no backfill).
  getWorkOrderEvents(workOrderId: WorkOrderId): Promise<WoEvent[]>;
}
