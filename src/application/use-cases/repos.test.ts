// use-cases/repos.test.ts — rules A-341 and A-345 (repo status, relink, flow save/read) with the ports faked.
import { describe, expect, it } from 'vitest';

import type { Actor, FlowSlug, RepoFlow, RepoSlug, RoleSlug, StageSlug } from '../../domain/index';
import { err, ok, parseSlug } from '../../domain/index';

import type { DefinitionScope, RepoRegistryEntry } from '../ports/index';
import {
  createFakeDefinitionStore,
  createFakeDeps,
  createFakeEventLog,
  createFakeRepoRegistry,
  repoFlowOf,
  type FakeDefinitionStore,
} from '../ports/fakes';

import { relinkRepo, repoFlowView, repoStatuses, saveRepoFlow } from './repos';

const ACTOR: Actor = { kind: 'user', id: 'u-1', label: 'Operator' };
const slug = (input: string): RepoSlug => {
  const parsed = parseSlug<'repo'>(input);
  if (!parsed.ok) throw new Error(`fixture slug must parse: ${input}`);
  return parsed.value;
};

const roleSlug = (input: string): RoleSlug => {
  const parsed = parseSlug<'role'>(input);
  if (!parsed.ok) throw new Error(`fixture slug must parse: ${input}`);
  return parsed.value;
};

const flowSlug = (input: string): FlowSlug => {
  const parsed = parseSlug<'flow'>(input);
  if (!parsed.ok) throw new Error(`fixture slug must parse: ${input}`);
  return parsed.value;
};

const stageSlug = (input: string): StageSlug => {
  const parsed = parseSlug<'stage'>(input);
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

const WEB = slug('web');

const FLOW_DEF = {
  id: flowSlug('standard'),
  name: 'Standard',
  stages: [{ id: stageSlug('implement'), name: 'Implement', role: roleSlug('worker'), exit: [] }],
};

const WORKER_ROLE = {
  id: roleSlug('worker'),
  name: 'Worker',
  instructions: 'Ship it.',
  writeScope: { kind: 'repo' as const },
  capabilities: [],
  active: true,
};

const repoYaml = (flow: Record<string, unknown>): string =>
  JSON.stringify({
    id: 'web',
    name: 'Web',
    flow,
    defaultLimitPolicy: 'wait_resume',
    commandSets: {},
    docsRoot: 'docs',
    testGlobs: [],
  });

const flowHarness = async (): Promise<{
  readonly deps: ReturnType<typeof createFakeDeps>;
  readonly repos: ReturnType<typeof createFakeRepoRegistry>;
  readonly log: ReturnType<typeof createFakeEventLog>;
  readonly definitions: FakeDefinitionStore;
  readonly initialFlow: RepoFlow;
}> => {
  const definitions = createFakeDefinitionStore();
  await definitions.installBuiltins({ roles: [WORKER_ROLE], flows: [FLOW_DEF] });
  const initialFlow = repoFlowOf({
    id: 'standard',
    stages: [
      { id: 'implement', name: 'Implement', role: 'worker', exit: [] } as { id: string; role: string | null },
    ],
  }) as unknown as RepoFlow;
  definitions.seed(`repos/${WEB}/repo.yaml`, repoYaml(initialFlow as unknown as Record<string, unknown>));
  const repos = createFakeRepoRegistry();
  await repos.register(entry({ slug: WEB }));
  const log = createFakeEventLog();
  const deps = createFakeDeps({ repos, log, definitions });
  return { deps, repos, log, definitions, initialFlow };
};

describe('A-345: repo.saveFlow and repo.flow', () => {
  it('A-345: saveRepoFlow writes repo.yaml, audits repo.flow_saved, and repoFlowView reads the stored RepoFlow', async () => {
    const h = await flowHarness();
    const updated: RepoFlow = {
      ...h.initialFlow,
      stages: h.initialFlow.stages.map((stage) =>
        stage.id === stageSlug('implement') ? { ...stage, name: 'Implement (edited)' } : stage,
      ),
    };

    const saved = await saveRepoFlow(h.deps, { repo: WEB, flow: updated, actor: ACTOR });
    expect(saved).toEqual(ok({ ok: true }));

    const view = await repoFlowView(h.deps, WEB);
    expect(view).toEqual({ ok: true, flow: updated });

    const audit = h.log.entries();
    expect(audit).toHaveLength(1);
    expect(audit[0]).toMatchObject({
      actor: ACTOR,
      action: 'repo.flow_saved',
      subject: { kind: 'repo', id: 'web' },
    });
  });

  it('A-345: not_found when the repo is unknown or repo.yaml is absent', async () => {
    const h = await flowHarness();
    expect(await saveRepoFlow(h.deps, { repo: slug('missing'), flow: h.initialFlow, actor: ACTOR })).toEqual(
      err('not_found'),
    );
    expect(await repoFlowView(h.deps, slug('missing'))).toEqual({ ok: false, code: 'not_found' });

    await h.repos.register(entry({ slug: slug('bare'), repoId: '01HZX0000000000000000000B1' }));
    expect(await saveRepoFlow(h.deps, { repo: slug('bare'), flow: h.initialFlow, actor: ACTOR })).toEqual(
      err('not_found'),
    );
    expect(h.log.entries()).toEqual([]);
  });

  it('A-345: definitions_invalid refuses a flow that fails R-127/R-128 and writes nothing — no audit', async () => {
    const h = await flowHarness();
    const broken: RepoFlow = {
      ...h.initialFlow,
      bindings: [{ stage: stageSlug('implement'), role: { roleId: roleSlug('worker'), version: 99 }, accounts: [] }],
    };

    expect(await saveRepoFlow(h.deps, { repo: WEB, flow: broken, actor: ACTOR })).toEqual(err('definitions_invalid'));
    expect(await repoFlowView(h.deps, WEB)).toEqual({ ok: true, flow: h.initialFlow });
    expect(h.log.entries()).toEqual([]);
  });

  it('A-345: stale when the repo.yaml hash no longer matches', async () => {
    const h = await flowHarness();
    const staleDefinitions: FakeDefinitionStore = {
      ...h.definitions,
      readFile: async (targetOrScope: DefinitionScope | string, maybeTarget?: string) => {
        const file =
          typeof targetOrScope === 'string'
            ? await h.definitions.readFile(targetOrScope)
            : await h.definitions.readFile(targetOrScope, maybeTarget as string);
        return file === undefined ? undefined : { ...file, hash: 'out-of-date' };
      },
    };
    const deps = { ...h.deps, definitions: staleDefinitions };

    expect(
      await saveRepoFlow(deps, {
        repo: WEB,
        flow: {
          ...h.initialFlow,
          stages: h.initialFlow.stages.map((stage) => ({ ...stage, name: 'Touched' })),
        },
        actor: ACTOR,
      }),
    ).toEqual(err('stale'));
    expect(h.log.entries()).toEqual([]);
  });
});
