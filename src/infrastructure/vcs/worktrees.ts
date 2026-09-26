// Git worktree management for runs: one worktree per (workspace, work order) under the data dir.
import type { Worktrees } from '../../application/index';
import type { WorkOrderId } from '../../domain/index';
import type { WorkspacePaths } from '../system/index';

export interface WorktreesConfig {
  readonly root: string; // root = <dataDir>/worktrees
  readonly workspaces: WorkspacePaths;
}

export function createWorktrees(config: WorktreesConfig): Worktrees {
  void config;
  throw new Error('not implemented');
}

export function worktreeBranch(id: WorkOrderId): string {
  void id;
  throw new Error('not implemented');
}

// + work-order id -> the commit the worktree started from
export const BASE_REF_PREFIX = 'refs/docket/bases/';
