// In-memory RepoRegistry — repoId-keyed entries with an injectable fingerprint reader, so the
// relink cases run identically against the fake and the SQLite adapter.
import type { Result } from '../../../domain/index';
import { err, ok } from '../../../domain/index';

import type { ReadRepoFingerprint, RepoFingerprint, RepoRegistry, RepoRegistryEntry } from '../repo-registry';

/** The port surface is complete on its own; the named type exists for tests that want the reader
 *  seeding helper of the default (zero-arg) construction. */
export interface FakeRepoRegistry extends RepoRegistry {
  /** Seeds the default reader's answer for a folder; `undefined` marks it unread (not a work tree
   *  with commits). Meaningless when a reader was injected — that reader owns its own answers. */
  markFingerprint(path: string, fingerprint: RepoFingerprint | undefined): void;
}

export const createFakeRepoRegistry = (readFingerprint?: ReadRepoFingerprint): FakeRepoRegistry => {
  const entries = new Map<string, RepoRegistryEntry>();
  const seeded = new Map<string, RepoFingerprint>();
  const reader: ReadRepoFingerprint = readFingerprint ?? (async (path) => seeded.get(path));

  return {
    register: async (entry: RepoRegistryEntry): Promise<void> => {
      for (const [repoId, existing] of entries) {
        // The same rule the SQLite unique index enforces: one slug, one identity.
        if (repoId !== entry.repoId && existing.slug === entry.slug) {
          throw new Error(`slug "${entry.slug}" is held by repoId "${repoId}"`);
        }
      }
      entries.set(entry.repoId, entry);
    },

    byRepoId: async (repoId: string): Promise<RepoRegistryEntry | undefined> => entries.get(repoId),

    list: async (): Promise<readonly RepoRegistryEntry[]> =>
      [...entries.values()].sort((a, b) => (a.slug < b.slug ? -1 : 1)),

    relink: async (repoId: string, path: string): Promise<Result<void, 'folder_not_found' | 'fingerprint_mismatch'>> => {
      const entry = entries.get(repoId);
      if (entry === undefined) return err('folder_not_found');
      const fingerprint = await reader(path);
      if (fingerprint === undefined) return err('folder_not_found');
      if (entry.fingerprint.rootCommit !== '' && entry.fingerprint.rootCommit !== fingerprint.rootCommit) {
        return err('fingerprint_mismatch');
      }
      entries.set(repoId, { ...entry, path, fingerprint });
      return ok(undefined);
    },

    markFingerprint: (path: string, fingerprint: RepoFingerprint | undefined): void => {
      if (fingerprint === undefined) seeded.delete(path);
      else seeded.set(path, fingerprint);
    },
  };
};
