// Machine-local registry of which checkout holds which repo, itself stored in docket.db.
import type { RepoSlug } from '../../../domain/index';
import type { RepoPaths } from '../../system/index';
import type { DocketDb } from './database';

export interface RepoRegistry extends RepoPaths {
  register(slug: RepoSlug, path: string): Promise<void>; // upsert; `path` absolute
  list(): Promise<readonly { readonly slug: RepoSlug; readonly path: string }[]>; // slug asc
  remove(slug: RepoSlug): Promise<void>;
}

interface RegistryEntry {
  readonly slug: RepoSlug;
  readonly path: string;
}

/** A selected row, keyed by column name; node:sqlite hands back index-signature records. */
type DataRow = { readonly [column: string]: unknown };

function entryFromRow(row: DataRow): RegistryEntry {
  if (typeof row.slug !== 'string' || typeof row.path !== 'string') {
    throw new Error('workspaces row without text columns');
  }
  return { slug: row.slug as RepoSlug, path: row.path };
}

export function createSqliteRepoRegistry(db: DocketDb): RepoRegistry {
  return {
    register: async (slug: RepoSlug, path: string): Promise<void> => {
      db.raw
        .prepare('INSERT INTO workspaces (slug, path) VALUES (?, ?) ON CONFLICT (slug) DO UPDATE SET path = excluded.path')
        .run(slug, path);
    },

    list: async (): Promise<readonly RegistryEntry[]> =>
      db.raw
        .prepare('SELECT slug, path FROM workspaces ORDER BY slug ASC')
        .all()
        .map((row) => entryFromRow(row)),

    remove: async (slug: RepoSlug): Promise<void> => {
      db.raw.prepare('DELETE FROM workspaces WHERE slug = ?').run(slug);
    },

    path: async (slug: RepoSlug): Promise<string | undefined> => {
      const row = db.raw.prepare('SELECT path FROM workspaces WHERE slug = ?').get(slug);
      if (row === undefined) return undefined;
      if (typeof row.path !== 'string') throw new Error('workspaces row without a text path');
      return row.path;
    },
  };
}
