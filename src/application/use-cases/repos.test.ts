// use-cases/repos.test.ts — rule A-341 (repoStatus, repo.relink) with the ports faked.
import { describe, expect, it } from 'vitest';

import type { Actor, RepoSlug } from '../../domain/index';
import { err, ok, parseSlug } from '../../domain/index';

import type { RepoRegistryEntry } from '../ports/index';
import { createFakeDeps, createFakeEventLog, createFakeRepoRegistry } from '../ports/fakes';

import { relinkRepo, repoStatuses } from './repos';

const ACTOR: Actor = { kind: 'user', id: 'u-1', label: 'Operator' };
const slug = (input: string): RepoSlug => {
  const parsed = parseSlug<'repo'>(input);
  if (!parsed.ok) throw new Error(`fixture slug must parse: ${input}`);
  return parsed.value;
};

const entry = (overrides: Partial<RepoRegistryEntry> = {}): RepoRegistryEntry => ({
  repoId: '01HZX0000000000000000000A1',
  slug: slug('web'),
  path: '/checkouts/web',
  fingerprint: { rootCommit: 'aaa' },
  ...overrides,
});

const harness = () => {
  const repos = createFakeRepoRegistry();
  const log = createFakeEventLog();
  const deps = createFakeDeps({ repos, log });
  return { deps, repos, log };
};

describe('A-341: repoStatus', () => {
  it('A-341: ok when the path reads the stored rootCommit, folder_not_found when it reads nothing, relink_offered when it differs', async () => {
    const h = harness();
    await h.repos.register(entry({ repoId: '01HZX0000000000000000000A1', slug: slug('web'), path: '/c/web' }));
    await h.repos.register(entry({ repoId: '01HZX0000000000000000000A2', slug: slug('api'), path: '/c/api' }));
    await h.repos.register(entry({ repoId: '01HZX0000000000000000000A3', slug: slug('docs'), path: '/c/docs' }));
    const reads: Record<string, { rootCommit: string } | undefined> = {
      '/c/web': { rootCommit: 'aaa' },
      '/c/api': undefined,
      '/c/docs': { rootCommit: 'zzz' },
    };

    const statuses = await repoStatuses({ ...h.deps, readFingerprint: async (path) => reads[path] });

    expect(statuses.map((view) => [view.slug, view.status])).toEqual([
      ['api', 'folder_not_found'],
      ['docs', 'relink_offered'],
      ['web', 'ok'],
    ]);
    expect(statuses[2]).toEqual({ repoId: '01HZX0000000000000000000A1', slug: 'web', path: '/c/web', status: 'ok' });
  });

  it('A-341: an entry whose fingerprint was never read (rootCommit "") is ok while the folder reads', async () => {
    const h = harness();
    await h.repos.register(entry({ fingerprint: { rootCommit: '' } }));
    const statuses = await repoStatuses({ ...h.deps, readFingerprint: async () => ({ rootCommit: 'bbb' }) });
    expect(statuses.map((view) => view.status)).toEqual(['ok']);
  });
});

describe('A-341: repo.relink', () => {
  it('A-341: relink applies the confirmed folder through the registry\'s verification and audits repo.relinked', async () => {
    const h = harness();
    await h.repos.register(entry());
    h.repos.markFingerprint('/moved/web', { rootCommit: 'aaa' });

    const result = await relinkRepo(h.deps, { repoId: entry().repoId, path: '/moved/web', actor: ACTOR });

    expect(result).toEqual(ok(undefined));
    expect((await h.repos.byRepoId(entry().repoId))?.path).toBe('/moved/web');
    expect(h.log.entries().map((logged) => logged.action)).toEqual(['repo.relinked']);
  });

  it('A-341: not_found · folder_not_found · fingerprint_mismatch, and a refusal re-points nothing and audits nothing', async () => {
    const h = harness();
    await h.repos.register(entry());
    h.repos.markFingerprint('/other/repo', { rootCommit: 'different' });

    expect(await relinkRepo(h.deps, { repoId: 'missing', path: '/x', actor: ACTOR })).toEqual(err('not_found'));
    expect(await relinkRepo(h.deps, { repoId: entry().repoId, path: '/nowhere', actor: ACTOR })).toEqual(err('folder_not_found'));
    expect(await relinkRepo(h.deps, { repoId: entry().repoId, path: '/other/repo', actor: ACTOR })).toEqual(err('fingerprint_mismatch'));
    expect((await h.repos.byRepoId(entry().repoId))?.path).toBe('/checkouts/web');
    expect(h.log.entries()).toEqual([]);
  });
});
