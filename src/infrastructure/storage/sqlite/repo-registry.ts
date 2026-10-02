// Machine-local registry of which checkout holds which repo, itself stored in docket.db.
import type { RepoRegistry } from '../../../application/index';
import type { RepoSlug } from '../../../domain/index';
import type { DocketDb } from './database';

interface RegistryEntry {
  readonly slug: RepoSlug;
  readonly path: string;
}

/** A selected row, keyed by column name; node:sqlite hands back index-signature records. */
type DataRow = { readonly [column: string]: unknown };

function entryFromRow(row: DataRow): RegistryEntry {
  if (typeof row.slug !== 'string' || typeof row.path !== 'string') {
    throw new Error('repos row without text columns');
  }
  return { slug: row.slug as RepoSlug, path: row.path };
}

export function createSqliteRepoRegistry(db: DocketDb): RepoRegistry {
  return {
    register: async (slug: RepoSlug, path: string): Promise<void> => {
      db.raw
        .prepare('INSERT INTO repos (slug, path) VALUES (?, ?) ON CONFLICT (slug) DO UPDATE SET path = excluded.path')
        .run(slug, path);
    },

    list: async (): Promise<readonly RegistryEntry[]> =>
      db.raw
        .prepare('SELECT slug, path FROM repos ORDER BY slug ASC')
        .all()
        .map((row) => entryFromRow(row)),

    remove: async (slug: RepoSlug): Promise<void> => {
      db.raw.prepare('DELETE FROM repos WHERE slug = ?').run(slug);
    },

    path: async (slug: RepoSlug): Promise<string | undefined> => {
      const row = db.raw.prepare('SELECT path FROM repos WHERE slug = ?').get(slug);
      if (row === undefined) return undefined;
      if (typeof row.path !== 'string') throw new Error('repos row without a text path');
      return row.path;
    },
  };
}
