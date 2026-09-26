// Machine-local registry of which checkout holds which workspace, itself stored in docket.db.
import type { WorkspaceSlug } from '../../../domain/index';
import type { WorkspacePaths } from '../../system/index';
import type { DocketDb } from './database';

export interface WorkspaceRegistry extends WorkspacePaths {
  register(slug: WorkspaceSlug, path: string): Promise<void>; // upsert; `path` absolute
  list(): Promise<readonly { readonly slug: WorkspaceSlug; readonly path: string }[]>; // slug asc
  remove(slug: WorkspaceSlug): Promise<void>;
}

export function createSqliteWorkspaceRegistry(db: DocketDb): WorkspaceRegistry {
  void db;
  throw new Error('not implemented');
}
