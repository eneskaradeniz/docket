// src/core/source.ts — data-access PORT declared in core (ADR-0006).
// Pure declaration, no logic. The adapter implements it (the SQLite store now; fixtures
// seed it). src/ui reaches data only through this port; it never imports an adapter.
//
// Async (WO-0009): the store is a real data source, so reads return Promises and the UI
// carries loading/error states. This replaces the throwaway sync IPC bridge (TD-017).
import type { RepoId, StepRole, StepView, Workspace, WorkOrder, WorkOrderId, WorkspaceId } from './types';

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

export interface CreateWorkOrderInput {
  workspaceId: WorkspaceId;
  title: string;
  description: string; // → order.md Objective; the architect session's first prompt
  trackRepos: RepoId[]; // workspace code repos MINUS the decision-store repo
  reviewMode: ReviewMode; // → order.md front-matter (review_mode); not stored in the DB
  contextFiles: string[]; // local file paths → order.md Context
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
  approvePlan(workOrderId: WorkOrderId, planText: string): Promise<void>;

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
}
