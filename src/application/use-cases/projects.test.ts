// use-cases/projects.test.ts — rules A-24, A-25, A-26 from docs/v2/application.md.
import { describe, expect, it } from 'vitest';

import type {
  Actor,
  FlowSlug,
  ProjectSlug,
  RepoSlug,
  Result,
  TaskSlug,
} from '../../domain/index';
import { parseSlug, parseUlid } from '../../domain/index';

import type { FakeDefinitionStore, FakeEventLog, FakeGitProbe, FakeProjectRepo, FakeRepoRegistry, FakeWorkOrderRepo } from '../ports/fakes';
import {
  createFakeClock,
  createFakeDefinitionStore,
  createFakeEventLog,
  createFakeGitProbe,
  createFakeIdGen,
  createFakeProjectRepo,
  createFakeRepoRegistry,
  createFakeWorkOrderRepo,
} from '../ports/fakes';

import { attachProject, openTaskWorkOrders, registerRepo, unregisterRepo } from './projects';

const ACTOR: Actor = { kind: 'user', id: 'u-1', label: 'Operator' };

const slugOf = <B extends string>(input: string) => {
  const parsed = parseSlug<B>(input);
  if (!parsed.ok) throw new Error(`fixture slug must parse: ${input}`);
  return parsed.value;
};

const ulidOf = <B extends string>(input: string) => {
  const parsed = parseUlid<B>(input);
  if (!parsed.ok) throw new Error(`fixture ulid must parse: ${input}`);
  return parsed.value;
};

const PROJECT: ProjectSlug = slugOf<'project'>('atolye');
const MAIN: RepoSlug = slugOf<'repo'>('main');
const REPO: RepoSlug = slugOf<'repo'>('acme');
const FLOW: FlowSlug = slugOf<'flow'>('standard');
const TASK: TaskSlug = slugOf<'task'>('setup-auth');
const OTHER_TASK: TaskSlug = slugOf<'task'>('docs-pass');

const CHECKOUT = '/checkouts/atolye';
const OTHER_CHECKOUT = '/checkouts/other';

const PROJECT_DEF = { id: PROJECT, name: 'Atölye', mainRepo: MAIN, repos: [MAIN, REPO] };

const DEFINITIONS_JSON = JSON.stringify({
  roles: [
    { id: 'worker', name: 'Worker', instructions: 'work', writeScope: { kind: 'repo' }, capabilities: [], active: true },
  ],
  flows: [
    {
      id: 'standard',
      name: 'Standard',
      stages: [
        { id: 'plan', name: 'Plan', role: 'worker', exit: [{ kind: 'human', id: 'plan-approval', label: 'Plan' }] },
      ],
    },
  ],
  capabilities: [],
  repo: {
    id: 'main',
    name: 'Main',
    flows: ['standard'],
    defaultFlow: 'standard',
    commandSets: {},
    roleOverrides: [],
    docsRoot: 'docs',
    testGlobs: [],
  },
});

const ROADMAP_JSON = JSON.stringify({
  phases: [
    {
      id: 'p1',
      name: 'Phase 1',
      blockedBy: [],
      tasks: [
        { id: 'setup-auth', title: 'Setup auth', dependsOn: [], acceptance: [], targets: ['main', 'acme'] },
        { id: 'docs-pass', title: 'Docs pass', dependsOn: [], acceptance: [], targets: [] },
      ],
    },
  ],
});

interface Harness {
  readonly definitions: FakeDefinitionStore;
  readonly projects: FakeProjectRepo;
  readonly repos: FakeRepoRegistry;
  readonly workOrders: FakeWorkOrderRepo;
  readonly git: FakeGitProbe;
  readonly log: FakeEventLog;
  readonly attachDeps: Parameters<typeof attachProject>[0];
  readonly taskDeps: Parameters<typeof openTaskWorkOrders>[0];
  readonly registerDeps: Parameters<typeof registerRepo>[0];
}

const createHarness = (configure?: (h: Harness) => void, withRoadmap = true): Harness => {
  const clock = createFakeClock(1_000);
  const ids = createFakeIdGen('projects-test');
  const definitions = createFakeDefinitionStore();
  const projects = createFakeProjectRepo();
  const repos = createFakeRepoRegistry();
  const workOrders = createFakeWorkOrderRepo();
  const git = createFakeGitProbe();
  const log = createFakeEventLog();

  definitions.setProject(PROJECT_DEF);
  definitions.seed({ kind: 'repo', repo: MAIN }, 'defs.json', DEFINITIONS_JSON);
  definitions.seed({ kind: 'repo', repo: REPO }, 'defs.json', DEFINITIONS_JSON);
  if (withRoadmap) definitions.seed({ kind: 'project', project: PROJECT }, 'roadmap.json', ROADMAP_JSON);

  const h: Harness = {
    definitions,
    projects,
    repos,
    workOrders,
    git,
    log,
    attachDeps: { clock, ids, log, projects, repos, definitions, git },
    taskDeps: { clock, ids, log, workOrders, definitions, projects },
    registerDeps: { clock, ids, log, projects, repos, workOrders },
  };
  configure?.(h);
  return h;
};

const expectErr = (result: Result<unknown, string>, code: string): void => {
  expect(result).toEqual({ ok: false, error: code });
};

describe('attachProject', () => {
  it('A-24: a path that is not a git work tree is not_a_repo and nothing is written', async () => {
    const h = createHarness();

    const result = await attachProject(h.attachDeps, { path: CHECKOUT, actor: ACTOR });

    expectErr(result, 'not_a_repo');
    expect(await h.projects.list()).toEqual([]);
    expect(await h.repos.list()).toEqual([]);
    expect(h.log.entries()).toEqual([]);
  });

  it('A-24: a checkout without project.yaml is no_project_yaml', async () => {
    const h = createHarness((self) => self.git.markWorkTree(CHECKOUT));

    const result = await attachProject(h.attachDeps, { path: CHECKOUT, actor: ACTOR });

    expectErr(result, 'no_project_yaml');
    expect(await h.projects.list()).toEqual([]);
    expect(h.log.entries()).toEqual([]);
  });

  it('A-24: a project.yaml that fails R-46 is definitions_invalid with the issues attached nowhere', async () => {
    const h = createHarness((self) => {
      self.git.markWorkTree(CHECKOUT);
      self.definitions.seedProjectAt(CHECKOUT, JSON.stringify({ id: 'atolye', name: 'Atölye', mainRepo: 'elsewhere', repos: [] }));
    });

    const result = await attachProject(h.attachDeps, { path: CHECKOUT, actor: ACTOR });

    expectErr(result, 'definitions_invalid');
    expect(await h.projects.list()).toEqual([]);
    expect(h.log.entries()).toEqual([]);
  });

  it('A-24: a valid project.yaml saves the ProjectDef, registers the main repo, audits project.attached', async () => {
    const h = createHarness((self) => {
      self.git.markWorkTree(CHECKOUT);
      self.definitions.seedProjectAt(CHECKOUT, JSON.stringify({ id: 'atolye', name: 'Atölye', mainRepo: 'main', repos: ['main', 'acme'] }));
    });

    const result = await attachProject(h.attachDeps, { path: CHECKOUT, actor: ACTOR });

    expect(result).toEqual({ ok: true, value: { id: PROJECT, name: 'Atölye', mainRepo: MAIN, repos: [MAIN, REPO] } });
    expect(await h.projects.get(PROJECT)).toEqual({ id: PROJECT, name: 'Atölye', mainRepo: MAIN, repos: [MAIN, REPO] });
    expect(await h.repos.path(MAIN)).toBe(CHECKOUT);
    expect(await h.repos.path(REPO)).toBeUndefined();
    const entries = h.log.entries();
    expect(entries.map((entry) => entry.action)).toEqual(['project.attached']);
    expect(entries[0]?.subject).toEqual({ kind: 'project', id: PROJECT });
  });

  it('A-24: a repos entry whose slug the project does not list is repo_not_in_project with nothing written', async () => {
    const h = createHarness((self) => {
      self.git.markWorkTree(CHECKOUT);
      self.definitions.seedProjectAt(CHECKOUT, JSON.stringify({ id: 'atolye', name: 'Atölye', mainRepo: 'main', repos: ['main'] }));
    });
    const outsider = slugOf<'repo'>('not-listed');

    const result = await attachProject(h.attachDeps, {
      path: CHECKOUT,
      actor: ACTOR,
      repos: [{ repo: REPO, path: OTHER_CHECKOUT }, { repo: outsider, path: '/checkouts/outsider' }],
    });

    expectErr(result, 'repo_not_in_project');
    expect(await h.projects.list()).toEqual([]);
    expect(await h.repos.list()).toEqual([]);
    expect(h.log.entries()).toEqual([]);
  });

  it('A-24: every listed repos entry is registered at its own path', async () => {
    const h = createHarness((self) => {
      self.git.markWorkTree(CHECKOUT);
      self.definitions.seedProjectAt(CHECKOUT, JSON.stringify({ id: 'atolye', name: 'Atölye', mainRepo: 'main', repos: ['main', 'acme'] }));
    });

    const result = await attachProject(h.attachDeps, {
      path: CHECKOUT,
      actor: ACTOR,
      repos: [{ repo: REPO, path: OTHER_CHECKOUT }],
    });

    expect(result.ok).toBe(true);
    expect(await h.repos.path(MAIN)).toBe(CHECKOUT);
    expect(await h.repos.path(REPO)).toBe(OTHER_CHECKOUT);
  });
});

describe('openTaskWorkOrders', () => {
  it('A-25: an unknown project is unknown_project and nothing opens', async () => {
    const h = createHarness();

    const result = await openTaskWorkOrders(h.taskDeps, { project: slugOf<'project'>('ghost'), task: TASK, actor: ACTOR });

    expectErr(result, 'unknown_project');
    expect(await h.workOrders.list({})).toEqual([]);
  });

  it('A-25: a project without a roadmap is unknown_task', async () => {
    const h = createHarness(undefined, false);
    await h.projects.save(PROJECT_DEF);

    const result = await openTaskWorkOrders(h.taskDeps, { project: PROJECT, task: TASK, actor: ACTOR });

    expectErr(result, 'unknown_task');
    expect(await h.workOrders.list({})).toEqual([]);
  });

  it('A-25: a roadmap that fails validation is definitions_invalid', async () => {
    const h = createHarness((self) => {
      self.definitions.seed({ kind: 'project', project: PROJECT }, 'roadmap.json', 'not-json{');
    });
    await h.projects.save(PROJECT_DEF);

    const result = await openTaskWorkOrders(h.taskDeps, { project: PROJECT, task: TASK, actor: ACTOR });

    expectErr(result, 'definitions_invalid');
    expect(await h.workOrders.list({})).toEqual([]);
  });

  it('A-25: a task id no roadmap phase carries is unknown_task', async () => {
    const h = createHarness();
    await h.projects.save(PROJECT_DEF);

    const result = await openTaskWorkOrders(h.taskDeps, {
      project: PROJECT,
      task: slugOf<'task'>('no-such-task'),
      actor: ACTOR,
    });

    expectErr(result, 'unknown_task');
    expect(await h.workOrders.list({})).toEqual([]);
  });

  it('A-25: one work order per target repo, all-or-nothing, each following A-5', async () => {
    const h = createHarness();
    await h.projects.save(PROJECT_DEF);

    const result = await openTaskWorkOrders(h.taskDeps, { project: PROJECT, task: TASK, actor: ACTOR });

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value).toHaveLength(2);
    const records = await h.workOrders.list({ project: PROJECT });
    expect(records.map((record) => record.repo)).toEqual([MAIN, REPO]);
    expect(records.every((record) => record.task === TASK)).toBe(true);
    expect(records.every((record) => record.title === 'Setup auth')).toBe(true);
    for (const record of records) {
      expect((await h.workOrders.events(record.id))[0]?.type).toBe('created');
    }
    expect(h.log.entries().map((entry) => entry.action)).toEqual(['work_order.opened', 'work_order.opened']);
  });

  it('A-25: a task with empty targets opens on the main repo alone', async () => {
    const h = createHarness();
    await h.projects.save(PROJECT_DEF);

    const result = await openTaskWorkOrders(h.taskDeps, { project: PROJECT, task: OTHER_TASK, actor: ACTOR });

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const records = await h.workOrders.list({ project: PROJECT });
    expect(records.map((record) => record.repo)).toEqual([MAIN]);
  });

  it('A-25: a target whose definitions fail validation leaves every work order unopened', async () => {
    const broken = slugOf<'repo'>('broken-repo');
    const h = createHarness((self) => {
      // The roadmap names a member repo whose definitions no longer load: the second target
      // fails, and with it the whole opening — the first target must not exist either.
      self.definitions.seed(
        { kind: 'project', project: PROJECT },
        'roadmap.json',
        JSON.stringify({
          phases: [
            {
              id: 'p1',
              name: 'Phase 1',
              blockedBy: [],
              tasks: [{ id: 'setup-auth', title: 'Setup auth', dependsOn: [], acceptance: [], targets: ['main', 'broken-repo'] }],
            },
          ],
        }),
      );
      self.definitions.seed({ kind: 'repo', repo: broken }, 'defs.json', '{not json');
    });
    await h.projects.save({ ...PROJECT_DEF, repos: [MAIN, REPO, broken] });

    const result = await openTaskWorkOrders(h.taskDeps, { project: PROJECT, task: TASK, actor: ACTOR });

    expectErr(result, 'definitions_invalid');
    expect(await h.workOrders.list({})).toEqual([]);
    expect(h.log.entries()).toEqual([]);
  });
});

describe('registerRepo / unregisterRepo', () => {
  it('A-26: an unknown project is unknown_project', async () => {
    const h = createHarness();

    expectErr(
      await registerRepo(h.registerDeps, { project: slugOf<'project'>('ghost'), repo: REPO, path: OTHER_CHECKOUT, actor: ACTOR }),
      'unknown_project',
    );
    expectErr(
      await unregisterRepo(h.registerDeps, { project: slugOf<'project'>('ghost'), repo: REPO, actor: ACTOR }),
      'unknown_project',
    );
  });

  it('A-26: a repo the project does not list is repo_not_in_project', async () => {
    const h = createHarness();
    await h.projects.save(PROJECT_DEF);

    expectErr(
      await registerRepo(h.registerDeps, { project: PROJECT, repo: slugOf<'repo'>('outsider'), path: OTHER_CHECKOUT, actor: ACTOR }),
      'repo_not_in_project',
    );
    expectErr(
      await unregisterRepo(h.registerDeps, { project: PROJECT, repo: slugOf<'repo'>('outsider'), actor: ACTOR }),
      'repo_not_in_project',
    );
    expect(await h.repos.list()).toEqual([]);
  });

  it('A-26: register upserts the pointer and audits repo.registered', async () => {
    const h = createHarness();
    await h.projects.save(PROJECT_DEF);
    await h.repos.register(REPO, '/old/path');

    const result = await registerRepo(h.registerDeps, { project: PROJECT, repo: REPO, path: OTHER_CHECKOUT, actor: ACTOR });

    expect(result).toEqual({ ok: true, value: undefined });
    expect(await h.repos.path(REPO)).toBe(OTHER_CHECKOUT);
    expect(h.log.entries().map((entry) => entry.action)).toEqual(['repo.registered']);
    expect(h.log.entries()[0]?.subject).toEqual({ kind: 'repo', id: REPO });
  });

  it('A-26: unregister refuses while a non-done work order references the repo, then removes the pointer', async () => {
    const h = createHarness();
    await h.projects.save(PROJECT_DEF);
    await h.repos.register(REPO, OTHER_CHECKOUT);
    const id = ulidOf<'work-order'>('01ARZ3NDEKTSV4RRFFQ69G5FCV');
    await h.workOrders.create({
      id,
      project: PROJECT,
      repo: REPO,
      flow: FLOW,
      title: 'Still open',
      createdAt: 1_000,
      createdBy: ACTOR,
    });

    expectErr(await unregisterRepo(h.registerDeps, { project: PROJECT, repo: REPO, actor: ACTOR }), 'repo_in_use');
    expect(await h.repos.path(REPO)).toBe(OTHER_CHECKOUT);

    await h.workOrders.appendEvent(id, { type: 'closed', at: 2_000, by: ACTOR });
    const result = await unregisterRepo(h.registerDeps, { project: PROJECT, repo: REPO, actor: ACTOR });

    expect(result).toEqual({ ok: true, value: undefined });
    expect(await h.repos.path(REPO)).toBeUndefined();
    expect(h.log.entries().map((entry) => entry.action)).toEqual(['repo.unregistered']);
    // Membership is versioned truth in project.yaml; the persisted ProjectDef is untouched.
    expect(await h.projects.get(PROJECT)).toEqual(PROJECT_DEF);
  });
});
