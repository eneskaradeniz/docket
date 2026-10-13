// The machine-local repo registry: identity is a generated repoId plus a git fingerprint, and the
// entry maps that identity to the folder cloned on this machine. Entries are permanent — a moved
// folder is re-pointed through relink, never removed.
import type { RepoSlug, Result } from '../../domain/index';

export interface RepoFingerprint {
  readonly rootCommit: string;
  readonly remote?: string;
}

export interface RepoRegistryEntry {
  readonly repoId: string; // ULID
  readonly slug: RepoSlug;
  readonly path: string;
  readonly fingerprint: RepoFingerprint;
}

export interface RepoRegistry {
  /** Upserts the whole entry by repoId; a slug held by another repoId throws (the unique index). */
  register(entry: RepoRegistryEntry): Promise<void>;
  byRepoId(repoId: string): Promise<RepoRegistryEntry | undefined>;
  list(): Promise<readonly RepoRegistryEntry[]>; // slug asc
  /** Re-points the entry at a candidate folder after verifying its fingerprint; never silent. */
  relink(repoId: string, path: string): Promise<Result<void, 'folder_not_found' | 'fingerprint_mismatch'>>;
}

/** Injected by the composition root: adapters that must read a candidate folder's fingerprint take
 *  the reader as a parameter, so no storage module grows a git dependency. */
export type ReadRepoFingerprint = (path: string) => Promise<RepoFingerprint | undefined>;
