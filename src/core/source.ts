// src/core/source.ts — data-access PORT declared in core (ADR-0006).
// Pure declaration, no logic. The adapter implements it (the SQLite store now; fixtures
// seed it). src/ui reaches data only through this port; it never imports an adapter.
//
// Async (WO-0009): the store is a real data source, so reads return Promises and the UI
// carries loading/error states. This replaces the throwaway sync IPC bridge (TD-017).
import type { RepoId, Workspace, WorkOrder, WorkOrderId, WorkspaceId } from './types';

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
}
