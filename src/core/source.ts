// src/core/source.ts — data-access PORT declared in core (ADR-0006).
// Pure declaration, no logic. The adapter implements it (the SQLite store now; fixtures
// seed it). src/ui reaches data only through this port; it never imports an adapter.
//
// Async (WO-0009): the store is a real data source, so reads return Promises and the UI
// carries loading/error states. This replaces the throwaway sync IPC bridge (TD-017).
import type { Workspace, WorkOrder, WorkOrderId, WorkspaceId } from './types';

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
}
