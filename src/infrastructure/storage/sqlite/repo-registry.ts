// Machine-local registry of repo identities over the repo_registry table: the record rides the
// `data` column and the index columns are rebuilt from it on every write.
import type { ReadRepoFingerprint, RepoRegistry, RepoRegistryEntry } from '../../../application/index';
import type { Result } from '../../../domain/index';
import { err, ok } from '../../../domain/index';

import type { DocketDb } from './database';

/** A selected row, keyed by column name; node:sqlite hands back index-signature records. */
type DataRow = { readonly [column: string]: unknown };

function entryFromRow(row: DataRow): RepoRegistryEntry {
  if (typeof row.data !== 'string') throw new Error('repo_registry row without JSON data');
  const parsed: unknown = JSON.parse(row.data);
  if (typeof parsed !== 'object' || parsed === null) throw new Error('repo_registry data is not a record');
  const record = parsed as Readonly<Record<string, unknown>>;
  if (
    typeof record['repoId'] !== 'string' ||
    typeof record['slug'] !== 'string' ||
    typeof record['path'] !== 'string' ||
    typeof record['fingerprint'] !== 'object' ||
    record['fingerprint'] === null ||
    typeof (record['fingerprint'] as Readonly<Record<string, unknown>>)['rootCommit'] !== 'string'
  ) {
    throw new Error('repo_registry data is not an entry record');
  }
  return parsed as RepoRegistryEntry;
}

export function createSqliteRepoRegistry(db: DocketDb, readFingerprint: ReadRepoFingerprint): RepoRegistry {
  const upsert = db.raw.prepare(
    'INSERT INTO repo_registry (repo_id, slug, path, data) VALUES (?, ?, ?, ?) ' +
      'ON CONFLICT (repo_id) DO UPDATE SET slug = excluded.slug, path = excluded.path, data = excluded.data',
  );

  const write = async (entry: RepoRegistryEntry): Promise<void> => {
    upsert.run(entry.repoId, entry.slug, entry.path, JSON.stringify(entry));
  };

  return {
    register: write,

    byRepoId: async (repoId: string): Promise<RepoRegistryEntry | undefined> => {
      const row = db.raw.prepare('SELECT data FROM repo_registry WHERE repo_id = ?').get(repoId);
      return row === undefined ? undefined : entryFromRow(row);
    },

    list: async (): Promise<readonly RepoRegistryEntry[]> =>
      db.raw
        .prepare('SELECT data FROM repo_registry ORDER BY slug ASC')
        .all()
        .map((row) => entryFromRow(row as DataRow)),

    relink: async (repoId: string, path: string): Promise<Result<void, 'folder_not_found' | 'fingerprint_mismatch'>> => {
      const row = db.raw.prepare('SELECT data FROM repo_registry WHERE repo_id = ?').get(repoId);
      if (row === undefined) return err('folder_not_found');
      const entry = entryFromRow(row);
      const fingerprint = await readFingerprint(path);
      if (fingerprint === undefined) return err('folder_not_found');
      // A stored '' (migration 11's not-yet-read stance) backfills; any other stored rootCommit
      // must equal the candidate's, or the folder belongs to a different history.
      if (entry.fingerprint.rootCommit !== '' && entry.fingerprint.rootCommit !== fingerprint.rootCommit) {
        return err('fingerprint_mismatch');
      }
      await write({ ...entry, path, fingerprint });
      return ok(undefined);
    },
  };
}
