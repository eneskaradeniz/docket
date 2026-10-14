import { describe, expect, it, vi } from 'vitest';

import type { Api } from '../../api/api';
import type { Command, CommandResult } from '../../api/commands';
import type { Query, RepoStatusView } from '../../api/queries';
import type { Actor } from '../../domain/index';
import { parseSlug } from '../../domain/index';

import { createRepoRelinkStatusStore, repoRelinkErrorKey } from './repo-relink-status';

const ACTOR: Actor = { kind: 'user', id: 'u-1', label: 'Test' };
const WEB = (() => {
  const parsed = parseSlug<'repo'>('web');
  if (!parsed.ok) throw new Error('slug');
  return parsed.value;
})();

const status = (over: Partial<RepoStatusView> & Pick<RepoStatusView, 'status'>): RepoStatusView => ({
  repoId: '01HZX0000000000000000000A1',
  slug: WEB,
  path: '/c/web',
  ...over,
});

const storeOver = (
  views: readonly RepoStatusView[],
  command: (cmd: Command) => Promise<CommandResult>,
  pickPaths: readonly string[] | 'cancel' = 'cancel',
) => {
  const api: Pick<Api, 'query' | 'command'> = {
    query: async (query: Query) => {
      if (query.type === 'repoStatus') return views;
      return { ok: false, code: 'not_found' };
    },
    command: async (_actor, cmd) => command(cmd),
  };
  const pickFolders = vi.fn(async () =>
    pickPaths === 'cancel'
      ? { canceled: true as const }
      : { canceled: false as const, paths: pickPaths },
  );
  const store = createRepoRelinkStatusStore({ api, actor: ACTOR, pickFolders });
  return { store, pickFolders };
};

describe('repo relink status store (U-313)', () => {
  it('U-313: fingerprint_mismatch keeps the banner and surfaces the mismatch sentence key', async () => {
    const { store } = storeOver(
      [status({ status: 'folder_not_found' })],
      async () => ({ ok: false, code: 'fingerprint_mismatch' }),
    );
    await store.load(['web']);
    await store.relinkAtPath('01HZX0000000000000000000A1', '/other');
    const row = store.state().rows[0];
    expect(row?.error).toBe('fingerprint_mismatch');
    expect(repoRelinkErrorKey('fingerprint_mismatch')).toBe('repoSettings.status.fingerprintMismatch');
    expect(store.state().rows).toHaveLength(1);
  });

  it('U-313: folder_not_found from repo.relink maps to the folder-not-found sentence', async () => {
    const { store } = storeOver(
      [status({ status: 'folder_not_found' })],
      async () => ({ ok: false, code: 'folder_not_found' }),
    );
    await store.load(['web']);
    await store.relinkAtPath('01HZX0000000000000000000A1', '/gone');
    expect(store.state().rows[0]?.error).toBe('folder_not_found');
    expect(repoRelinkErrorKey('folder_not_found')).toBe('repoSettings.status.folderNotFound');
  });

  it('U-313: not_found drops the row after a refresh', async () => {
    let views: readonly RepoStatusView[] = [status({ status: 'folder_not_found' })];
    const api: Pick<Api, 'query' | 'command'> = {
      query: async (query: Query) => {
        if (query.type === 'repoStatus') return views;
        return { ok: false, code: 'not_found' };
      },
      command: async () => ({ ok: false, code: 'not_found' }),
    };
    const store = createRepoRelinkStatusStore({
      api,
      actor: ACTOR,
      pickFolders: async () => ({ canceled: true }),
    });
    await store.load(['web']);
    expect(store.state().rows).toHaveLength(1);
    views = [];
    await store.relinkAtPath('01HZX0000000000000000000A1', '/x');
    expect(store.state().rows).toHaveLength(0);
  });

  it('U-313: a successful relink re-reads repoStatus and clears an ok repo', async () => {
    let views: readonly RepoStatusView[] = [status({ status: 'folder_not_found' })];
    const api: Pick<Api, 'query' | 'command'> = {
      query: async (query: Query) => {
        if (query.type === 'repoStatus') return views;
        return { ok: false, code: 'not_found' };
      },
      command: async () => ({ ok: true }),
    };
    const store = createRepoRelinkStatusStore({
      api,
      actor: ACTOR,
      pickFolders: async () => ({ canceled: false, paths: ['/moved/web'] }),
    });
    await store.load(['web']);
    views = [status({ status: 'ok' })];
    await store.pickAndRelink('01HZX0000000000000000000A1');
    expect(store.state().rows).toHaveLength(0);
  });

  it('U-313: load keeps only non-ok repos that belong to the project slug list', async () => {
    const api = (() => {
      const apiSlug = (() => {
        const parsed = parseSlug<'repo'>('api');
        if (!parsed.ok) throw new Error('slug');
        return parsed.value;
      })();
      const views: readonly RepoStatusView[] = [
        status({ status: 'folder_not_found' }),
        { repoId: '02', slug: apiSlug, path: '/c/api', status: 'relink_offered' },
      ];
      return {
        query: async (query: Query) => (query.type === 'repoStatus' ? views : { ok: false, code: 'not_found' }),
        command: async () => ({ ok: true }),
      } satisfies Pick<Api, 'query' | 'command'>;
    })();
    const store = createRepoRelinkStatusStore({
      api,
      actor: ACTOR,
      pickFolders: async () => ({ canceled: true }),
    });
    await store.load(['web']);
    expect(store.state().rows.map((row) => row.slug)).toEqual(['web']);
  });
});
