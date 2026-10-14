// stores/repo-relink-status.ts — registry folder health for Depo ayarları (U-312, U-313): reads
// repoStatus when the section opens and after every repo.relink; errors stay on the banner.
import type { Api } from '../../api/api';
import type { Query, RepoStatusView } from '../../api/queries';
import type { Actor, RepoSlug } from '../../domain/index';
import type { LabelKey } from '../labels/keys';

type PickFoldersResult =
  | { readonly canceled: true }
  | { readonly canceled: false; readonly paths: readonly string[] };
import { isQueryFailure } from './results';

export type RepoRelinkCommandError = 'not_found' | 'folder_not_found' | 'fingerprint_mismatch';

export interface RepoRelinkRow {
  readonly repoId: string;
  readonly slug: RepoSlug;
  readonly path: string;
  readonly status: 'folder_not_found' | 'relink_offered';
  readonly error: 'folder_not_found' | 'fingerprint_mismatch' | null;
}

export interface RepoRelinkStatusState {
  readonly rows: readonly RepoRelinkRow[];
  readonly busyRepoId: string | null;
}

export const repoRelinkErrorKey = (error: 'folder_not_found' | 'fingerprint_mismatch'): LabelKey =>
  error === 'fingerprint_mismatch' ? 'repoSettings.status.fingerprintMismatch' : 'repoSettings.status.folderNotFound';

export interface RepoRelinkStatusStoreDeps {
  readonly api: Pick<Api, 'query' | 'command'>;
  readonly actor: Actor;
  readonly pickFolders: (options?: { readonly multiple?: boolean }) => Promise<PickFoldersResult>;
}

export interface RepoRelinkStatusStore {
  readonly subscribe: (listener: () => void) => () => void;
  readonly state: () => RepoRelinkStatusState;
  /** Re-reads repoStatus and keeps only non-ok rows for the given project repo slugs. */
  readonly load: (repoSlugs: readonly string[]) => Promise<void>;
  readonly relinkAtPath: (repoId: string, path: string) => Promise<void>;
  readonly pickAndRelink: (repoId: string) => Promise<void>;
}

const empty: RepoRelinkStatusState = { rows: [], busyRepoId: null };

const rowOf = (view: RepoStatusView, error: RepoRelinkRow['error']): RepoRelinkRow | null => {
  if (view.status === 'ok') return null;
  return {
    repoId: view.repoId,
    slug: view.slug,
    path: view.path,
    status: view.status,
    error,
  };
};

const mergeRows = (views: readonly RepoStatusView[], repoSlugs: readonly string[]): readonly RepoRelinkRow[] => {
  const slugSet = new Set(repoSlugs);
  const rows: RepoRelinkRow[] = [];
  for (const view of views) {
    if (!slugSet.has(view.slug)) continue;
    const row = rowOf(view, null);
    if (row !== null) rows.push(row);
  }
  return rows;
};

type RelinkCommandResult =
  | { readonly ok: true }
  | { readonly ok: false; readonly code: 'not_found' | 'folder_not_found' | 'fingerprint_mismatch' };

const applyCommand = (
  result: RelinkCommandResult,
  repoId: string,
  rows: readonly RepoRelinkRow[],
): readonly RepoRelinkRow[] => {
  if (result.ok) return rows.filter((row) => row.repoId !== repoId);
  if (result.code === 'not_found') return rows.filter((row) => row.repoId !== repoId);
  if (result.code === 'folder_not_found') {
    return rows.map((row) => (row.repoId === repoId ? { ...row, error: 'folder_not_found' } : row));
  }
  if (result.code === 'fingerprint_mismatch') {
    return rows.map((row) => (row.repoId === repoId ? { ...row, error: 'fingerprint_mismatch' } : row));
  }
  return rows;
};

export const createRepoRelinkStatusStore = (deps: RepoRelinkStatusStoreDeps): RepoRelinkStatusStore => {
  const listeners = new Set<() => void>();
  let state: RepoRelinkStatusState = empty;

  const publish = (next: RepoRelinkStatusState): void => {
    state = next;
    for (const listener of [...listeners]) listener();
  };

  const readStatus = async (repoSlugs: readonly string[]): Promise<void> => {
    const reply: unknown = await deps.api.query({ type: 'repoStatus' } satisfies Query);
    if (isQueryFailure(reply)) {
      publish({ ...state, rows: [] });
      return;
    }
    const views = reply as readonly RepoStatusView[];
    publish({ ...state, rows: mergeRows(views, repoSlugs) });
  };

  const runRelink = async (repoId: string, path: string, repoSlugs: readonly string[]): Promise<void> => {
    publish({ ...state, busyRepoId: repoId });
    const result = await deps.api.command(deps.actor, { type: 'repo.relink', repoId, path });
    const nextRows = applyCommand(result as RelinkCommandResult, repoId, state.rows);
    publish({ ...state, busyRepoId: null, rows: nextRows });
    if (!result.ok && result.code === 'not_found') {
      await readStatus(repoSlugs);
      return;
    }
    if (result.ok) await readStatus(repoSlugs);
  };

  let lastSlugs: readonly string[] = [];

  return {
    subscribe: (listener) => {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    state: () => state,
    load: async (repoSlugs) => {
      lastSlugs = repoSlugs;
      await readStatus(repoSlugs);
    },
    relinkAtPath: async (repoId, path) => {
      await runRelink(repoId, path, lastSlugs);
    },
    pickAndRelink: async (repoId) => {
      const picked = await deps.pickFolders({ multiple: false });
      if (picked.canceled || picked.paths.length === 0) return;
      await runRelink(repoId, picked.paths[0], lastSlugs);
    },
  };
};
