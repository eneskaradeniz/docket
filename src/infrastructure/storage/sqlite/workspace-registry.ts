// Machine-local registry of which checkout holds which workspace, itself stored in docket.db.
import type { WorkspaceSlug } from '../../../domain/index';
import type { WorkspacePaths } from '../../system/index';
import type { DocketDb } from './database';

export interface WorkspaceRegistry extends WorkspacePaths {
  register(slug: WorkspaceSlug, path: string): Promise<void>; // upsert; `path` absolute
  list(): Promise<readonly { readonly slug: WorkspaceSlug; readonly path: string }[]>; // slug asc
  remove(slug: WorkspaceSlug): Promise<void>;
}

interface RegistryEntry {
  readonly slug: WorkspaceSlug;
  readonly path: string;
}

/** A selected row, keyed by column name; node:sqlite hands back index-signature records. */
type DataRow = { readonly [column: string]: unknown };

function entryFromRow(row: DataRow): RegistryEntry {
  if (typeof row.slug !== 'string' || typeof row.path !== 'string') {
    throw new Error('workspaces row without text columns');
  }
  return { slug: row.slug as WorkspaceSlug, path: row.path };
}

export function createSqliteWorkspaceRegistry(db: DocketDb): WorkspaceRegistry {
  return {
    register: async (slug: WorkspaceSlug, path: string): Promise<void> => {
      db.raw
        .prepare('INSERT INTO workspaces (slug, path) VALUES (?, ?) ON CONFLICT (slug) DO UPDATE SET path = excluded.path')
        .run(slug, path);
    },

    list: async (): Promise<readonly RegistryEntry[]> =>
      db.raw
        .prepare('SELECT slug, path FROM workspaces ORDER BY slug ASC')
        .all()
        .map((row) => entryFromRow(row)),

    remove: async (slug: WorkspaceSlug): Promise<void> => {
      db.raw.prepare('DELETE FROM workspaces WHERE slug = ?').run(slug);
    },

    path: async (slug: WorkspaceSlug): Promise<string | undefined> => {
      const row = db.raw.prepare('SELECT path FROM workspaces WHERE slug = ?').get(slug);
      if (row === undefined) return undefined;
      if (typeof row.path !== 'string') throw new Error('workspaces row without a text path');
      return row.path;
    },
  };
}
