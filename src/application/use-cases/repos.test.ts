// use-cases/repos.test.ts — rules A-341 (repoStatus, repo.relink) and A-354 (saveRepoFlow).
import { describe, expect, it } from 'vitest';

import type { Actor, RepoDef, RepoFlow, RepoSlug, RoleDef, StageSlug, Ulid } from '../../domain/index';
import { err, ok, parseSlug, parseUlid } from '../../domain/index';

import type { AccountRecord, RepoRegistryEntry } from '../ports/index';
import {
  createFakeAccountRepo,
  createFakeDefinitionStore,
  createFakeDeps,
  createFakeEventLog,
  createFakeRepoRegistry,
} from '../ports/fakes';

import { relinkRepo, repoStatuses, saveRepoFlow } from './repos';

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

const ulidOf = <B extends string>(input: string): Ulid<B> => {
  const parsed = parseUlid<B>(input);
  if (!parsed.ok) throw new Error(`fixture ulid must parse: ${input}`);
  return parsed.value;
};

const SAVE_REPO: RepoSlug = slug('acme');
const STAGE: StageSlug = (() => {
  const parsed = parseSlug<'stage'>('implement');
  if (!parsed.ok) throw new Error('fixture stage');
  return parsed.value;
})();
const CONNECTED = ulidOf<'account'>('01ARZ3NDEKTSV4RRFFQ69G5FB3');
const MISSING_A = ulidOf<'account'>('01ARZ3NDEKTSV4RRFFQ69G5FB4');
const MISSING_B = ulidOf<'account'>('01ARZ3NDEKTSV4RRFFQ69G5FB5');

const WORKER: RoleDef = {
  id: (() => {
    const parsed = parseSlug<'role'>('worker');
    if (!parsed.ok) throw new Error('fixture role');
    return parsed.value;
  })(),
  name: 'Worker',
  instructions: 'Work.',
  writeScope: { kind: 'repo' },
  capabilities: [],
  active: true,
};

const baseFlow = (): RepoFlow => ({
  flowId: (() => {
    const parsed = parseSlug<'flow'>('flow-a');
    if (!parsed.ok) throw new Error('fixture flow');
    return parsed.value;
  })(),
  version: 1,
  stages: [{ id: STAGE, name: 'Implement', role: WORKER.id, exit: [] }],
  bindings: [
    {
      stage: STAGE,
      role: { roleId: WORKER.id, version: 1 },
      accounts: [],
    },
  ],
});

const flowWithAccounts = (accounts: readonly Ulid<'account'>[]): RepoFlow => ({
  ...baseFlow(),
  bindings: [
    {
      stage: STAGE,
      role: { roleId: WORKER.id, version: 1 },
      accounts: accounts.map((accountId) => ({ accountId })),
    },
  ],
});

const accountRecord = (id: Ulid<'account'>): AccountRecord => ({
  id,
  provider: 'provider-a',
  label: 'Work',
  authMode: 'subscription',
  limitPolicy: 'wait_resume',
  caps: [],
});

const saveHarness = async (withConnected = false) => {
  const repos = createFakeRepoRegistry();
  await repos.register({
    repoId: '01HZX0000000000000000000A1',
    slug: SAVE_REPO,
    path: '/c/acme',
    fingerprint: { rootCommit: '' },
  });
  const definitions = createFakeDefinitionStore();
  await definitions.appendVersion('roles', 'worker', WORKER, 900);
  const repoDef: RepoDef = {
    id: SAVE_REPO,
    name: 'Acme',
    commandSets: {},
    docsRoot: 'docs',
    testGlobs: [],
    defaultLimitPolicy: 'wait_resume',
    flow: baseFlow(),
  };
  definitions.setRepoDef(SAVE_REPO, repoDef);
  await definitions.writeFile({ kind: 'repo', repo: SAVE_REPO }, 'repo.yaml', JSON.stringify(repoDef), '');
  const accounts = createFakeAccountRepo();
  if (withConnected) await accounts.save(accountRecord(CONNECTED));
  const log = createFakeEventLog();
  const deps = createFakeDeps({ repos, definitions, accounts, log });
  return { deps, definitions, log, repoDef };
};

describe('A-354: saveRepoFlow', () => {
  it('A-354: saveRepoFlow rejects a stage chain naming an unconnected account', async () => {
    const { deps, log, repoDef, definitions } = await saveHarness(false);
    const flow = flowWithAccounts([MISSING_A]);

    const result = await saveRepoFlow(deps, { repo: SAVE_REPO, flow, actor: ACTOR });

    expect(result).toEqual({
      ok: false,
      error: { code: 'account_not_connected', accounts: [{ stage: STAGE, accountId: MISSING_A }] },
    });
    const loaded = await definitions.load(SAVE_REPO);
    expect(loaded.ok && loaded.value.repo?.flow).toEqual(repoDef.flow);
    expect(log.entries()).toEqual([]);
  });

  it('A-354: lists every offending stage and account and writes nothing', async () => {
    const { deps, log } = await saveHarness(false);
    const review: StageSlug = (() => {
      const parsed = parseSlug<'stage'>('review');
      if (!parsed.ok) throw new Error('fixture stage');
      return parsed.value;
    })();
    const flow: RepoFlow = {
      ...baseFlow(),
      stages: [
        { id: STAGE, name: 'Implement', role: WORKER.id, exit: [] },
        { id: review, name: 'Review', role: WORKER.id, exit: [] },
      ],
      bindings: [
        { stage: STAGE, role: { roleId: WORKER.id, version: 1 }, accounts: [{ accountId: MISSING_A }] },
        { stage: review, role: { roleId: WORKER.id, version: 1 }, accounts: [{ accountId: MISSING_B }] },
      ],
    };

    const result = await saveRepoFlow(deps, { repo: SAVE_REPO, flow, actor: ACTOR });

    expect(result).toEqual({
      ok: false,
      error: {
        code: 'account_not_connected',
        accounts: [
          { stage: STAGE, accountId: MISSING_A },
          { stage: review, accountId: MISSING_B },
        ],
      },
    });
    expect(log.entries()).toEqual([]);
  });

  it('A-354: an empty chain and all-connected chains save exactly as before', async () => {
    const empty = await saveHarness(false);
    const emptyFlow = flowWithAccounts([]);
    expect(await saveRepoFlow(empty.deps, { repo: SAVE_REPO, flow: emptyFlow, actor: ACTOR })).toEqual(ok({ ok: true }));
    expect(empty.log.entries().map((entry) => entry.action)).toEqual(['repo.flow_saved']);

    const connected = await saveHarness(true);
    const withAccount = flowWithAccounts([CONNECTED]);
    expect(await saveRepoFlow(connected.deps, { repo: SAVE_REPO, flow: withAccount, actor: ACTOR })).toEqual(ok({ ok: true }));
    expect(connected.log.entries().map((entry) => entry.action)).toEqual(['repo.flow_saved']);
  });
});
