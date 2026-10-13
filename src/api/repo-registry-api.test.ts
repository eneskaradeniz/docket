// A-341 through the api boundary: the repoStatus query and repo.relink.
import { describe, expect, it } from 'vitest';

import type { Actor, RepoSlug } from '../domain/index';
import { parseSlug } from '../domain/index';
import { createFakeDeps, createFakeRepoRegistry } from '../application/ports/fakes';

import { createApi } from './api';

const ACTOR: Actor = { kind: 'user', id: 'u-1', label: 'Operator' };
const WEB = (() => {
  const parsed = parseSlug<'repo'>('web');
  if (!parsed.ok) throw new Error('fixture slug');
  return parsed.value as RepoSlug;
})();
const REPO_ID = '01HZX0000000000000000000A1';

const seeded = async () => {
  const repos = createFakeRepoRegistry();
  await repos.register({ repoId: REPO_ID, slug: WEB, path: '/c/web', fingerprint: { rootCommit: 'aaa' } });
  const deps = createFakeDeps({
    repos,
    readFingerprint: async (path) => (path === '/c/web' ? { rootCommit: 'bbb' } : undefined),
  });
  return { api: createApi(deps), repos };
};

describe('A-341 api', () => {
  it('A-341: the repoStatus query lists every entry with its status', async () => {
    const { api } = await seeded();
    expect(await api.query({ type: 'repoStatus' })).toEqual([
      { repoId: REPO_ID, slug: 'web', path: '/c/web', status: 'relink_offered' },
    ]);
  });

  it('A-341: repo.relink answers ok for a matching folder and the registry\'s refusals otherwise', async () => {
    const { api, repos } = await seeded();
    repos.markFingerprint('/moved/web', { rootCommit: 'aaa' });
    repos.markFingerprint('/other', { rootCommit: 'zzz' });
    expect(await api.command(ACTOR, { type: 'repo.relink', repoId: REPO_ID, path: '/moved/web' })).toEqual({ ok: true });
    expect(await api.command(ACTOR, { type: 'repo.relink', repoId: REPO_ID, path: '/other' })).toEqual({ ok: false, code: 'fingerprint_mismatch' });
    expect(await api.command(ACTOR, { type: 'repo.relink', repoId: REPO_ID, path: '/gone' })).toEqual({ ok: false, code: 'folder_not_found' });
    expect(await api.command(ACTOR, { type: 'repo.relink', repoId: 'nope', path: '/moved/web' })).toEqual({ ok: false, code: 'not_found' });
  });
});
