// use-cases/projects-create.test.ts — rules A-75 … A-78 from docs/v2/application.md ("Create a project
// from the built-in library"), over the in-memory fakes.
import { describe, expect, it } from 'vitest';

import type { Actor, Result } from '../../domain/index';
import { BUILTIN_COMMAND_SET_NAMES, BUILTIN_FLOWS, BUILTIN_ROLES, parseSlug } from '../../domain/index';

import type { FakeDefinitionStore, FakeEventLog, FakeGitProbe, FakeProjectRepo, FakeRepoFolders, FakeRepoRegistry } from '../ports/fakes';
import {
  createFakeClock,
  createFakeDefinitionStore,
  createFakeEventLog,
  createFakeGitProbe,
  createFakeIdGen,
  createFakeProjectRepo,
  createFakeRepoFolders,
  createFakeRepoRegistry,
} from '../ports/fakes';

import { createProject } from './projects';

const ACTOR: Actor = { kind: 'user', id: 'u-1', label: 'Operator' };
const CHECKOUT = '/work/atolye';
const PARENT = '/work';

interface Harness {
  readonly definitions: FakeDefinitionStore;
  readonly projects: FakeProjectRepo;
  readonly repos: FakeRepoRegistry;
  readonly git: FakeGitProbe;
  readonly log: FakeEventLog;
  readonly folders: FakeRepoFolders;
  readonly deps: Parameters<typeof createProject>[0];
}

const createHarness = (configure?: (h: Harness) => void): Harness => {
  const definitions = createFakeDefinitionStore();
  const projects = createFakeProjectRepo();
  const repos = createFakeRepoRegistry();
  const git = createFakeGitProbe();
  const log = createFakeEventLog();
  const folders = createFakeRepoFolders();
  const h: Harness = {
    definitions,
    projects,
    repos,
    git,
    log,
    folders,
    deps: { clock: createFakeClock(1_000), ids: createFakeIdGen('projects-create'), log, projects, repos, definitions, git, repoFolders: folders },
  };
  configure?.(h);
  return h;
};

const slugOf = <B extends string>(input: string) => {
  const parsed = parseSlug<B>(input);
  if (!parsed.ok) throw new Error(`fixture slug must parse: ${input}`);
  return parsed.value;
};

const expectErr = (result: Result<unknown, string>, code: string): void => {
  expect(result).toEqual({ ok: false, error: code });
};

const existing = { kind: 'existing', path: CHECKOUT } as const;
const blank = { kind: 'blank', parent: PARENT } as const;

const firstRole = BUILTIN_ROLES[0];
const globalRoleFile = async (h: Harness) =>
  firstRole === undefined ? undefined : h.definitions.readFile({ kind: 'global' }, `roles/${firstRole.id}.json`);

/** Nothing the create flow writes exists: no project/repo file, no registration, no audit entry. */
const expectNothingWritten = async (h: Harness, path: string): Promise<void> => {
  expect((await h.definitions.readProjectAt(path)).ok).toBe(false);
  expect(h.definitions.repoAt(path)).toBeUndefined();
  expect(await h.projects.list()).toEqual([]);
  expect(await h.repos.list()).toEqual([]);
  expect(h.log.entries()).toEqual([]);
};

describe('createProject validation (A-75)', () => {
  it('A-75: an empty, blank or over-long name is invalid_name and nothing is written', async () => {
    const h = createHarness((self) => self.git.markWorkTree(CHECKOUT));

    for (const name of ['', '   \t', 'x'.repeat(81)]) {
      expectErr(await createProject(h.deps, { source: existing, name, actor: ACTOR }), 'invalid_name');
    }
    await expectNothingWritten(h, CHECKOUT);
    expect(await globalRoleFile(h)).toBeUndefined();
  });

  it('A-75: a name of exactly 80 characters is accepted (after trimming)', async () => {
    const h = createHarness((self) => self.git.markWorkTree(CHECKOUT));

    const result = await createProject(h.deps, { source: existing, name: `  ${'x'.repeat(80)}  `, actor: ACTOR });

    expect(result.ok).toBe(true);
  });

  it('A-75: an existing source that is not a git work tree is not_a_repo and nothing is written', async () => {
    const h = createHarness();

    expectErr(await createProject(h.deps, { source: existing, name: 'Atölye', actor: ACTOR }), 'not_a_repo');

    await expectNothingWritten(h, CHECKOUT);
    expect(await globalRoleFile(h)).toBeUndefined();
  });

  it('A-75: the slug avoids every saved project id and every registered repo slug', async () => {
    const h = createHarness((self) => {
      self.git.markWorkTree(CHECKOUT);
    });
    await h.projects.save({ id: slugOf<'project'>('atolye'), name: 'Old', mainRepo: slugOf<'repo'>('old'), repos: [slugOf<'repo'>('old')] });
    await h.repos.register(slugOf<'repo'>('atolye-2'), '/somewhere');

    const result = await createProject(h.deps, { source: existing, name: 'Atölye', actor: ACTOR });

    expect(result.ok && result.value.id).toBe('atolye-3');
  });
});

describe('createProject definitions (A-76)', () => {
  it('A-76: project ≡ repo, every built-in flow enabled, standard default, empty built-in command sets', async () => {
    const h = createHarness((self) => self.git.markWorkTree(CHECKOUT));

    const result = await createProject(h.deps, { source: existing, name: 'Çalışma Alanı', actor: ACTOR });

    expect(result).toEqual({
      ok: true,
      value: { id: 'calisma-alani', name: 'Çalışma Alanı', mainRepo: 'calisma-alani', repos: ['calisma-alani'] },
    });
    const written = h.definitions.repoAt(CHECKOUT);
    expect(written).toBeDefined();
    const repo: unknown = JSON.parse(written ?? 'null');
    expect(repo).toEqual({
      id: 'calisma-alani',
      name: 'Çalışma Alanı',
      flows: BUILTIN_FLOWS.map((flow) => flow.id),
      defaultFlow: 'standard',
      commandSets: Object.fromEntries(BUILTIN_COMMAND_SET_NAMES.map((name) => [name, []])),
      roleOverrides: [],
      docsRoot: 'docs',
      testGlobs: [],
    });
  });

  it('A-76: the name is stored trimmed', async () => {
    const h = createHarness((self) => self.git.markWorkTree(CHECKOUT));

    const result = await createProject(h.deps, { source: existing, name: '  Atölye  ', actor: ACTOR });

    expect(result.ok && result.value.name).toBe('Atölye');
  });
});

describe('createProject writes (A-77)', () => {
  it('A-77: existing source — installs the built-ins, scaffolds, attaches and returns the attach result', async () => {
    const h = createHarness((self) => self.git.markWorkTree(CHECKOUT));

    const result = await createProject(h.deps, { source: existing, name: 'Atölye', actor: ACTOR });

    expect(result).toEqual({ ok: true, value: { id: 'atolye', name: 'Atölye', mainRepo: 'atolye', repos: ['atolye'] } });
    expect(await globalRoleFile(h)).toBeDefined();
    expect(await h.projects.get(slugOf<'project'>('atolye'))).toBeDefined();
    expect(await h.repos.path(slugOf<'repo'>('atolye'))).toBe(CHECKOUT);
    expect(h.folders.created()).toEqual([]);
  });

  it('A-77: blank source — the folder is created under the parent, named by the slug, and is the project path', async () => {
    const h = createHarness((self) => {
      self.folders.markFolder(PARENT);
      self.git.markWorkTree(`${PARENT}/atolye`);
    });

    const result = await createProject(h.deps, { source: blank, name: 'Atölye', actor: ACTOR });

    expect(result.ok).toBe(true);
    expect(h.folders.created()).toEqual([`${PARENT}/atolye`]);
    expect(await h.repos.path(slugOf<'repo'>('atolye'))).toBe(`${PARENT}/atolye`);
    expect(h.definitions.repoAt(`${PARENT}/atolye`)).toBeDefined();
  });

  it('A-77: blank source — createRepo errors are returned as they are and nothing else is written', async () => {
    const notAFolder = createHarness();
    expectErr(await createProject(notAFolder.deps, { source: blank, name: 'Atölye', actor: ACTOR }), 'not_a_folder');
    await expectNothingWritten(notAFolder, `${PARENT}/atolye`);
    expect(await globalRoleFile(notAFolder)).toBeUndefined();

    const occupied = createHarness((self) => {
      self.folders.markFolder(PARENT);
      self.folders.markOccupied(`${PARENT}/atolye`);
    });
    expectErr(await createProject(occupied.deps, { source: blank, name: 'Atölye', actor: ACTOR }), 'folder_exists');
    await expectNothingWritten(occupied, `${PARENT}/atolye`);
    expect(await globalRoleFile(occupied)).toBeUndefined();

    const failing = createHarness((self) => {
      self.folders.markFolder(PARENT);
      self.folders.failNextWithIoError();
    });
    expectErr(await createProject(failing.deps, { source: blank, name: 'Atölye', actor: ACTOR }), 'io_failed');
    await expectNothingWritten(failing, `${PARENT}/atolye`);
  });

  it('A-77: an existing project.yaml is project_exists — nothing is overwritten, registered or audited', async () => {
    const original = JSON.stringify({ id: 'mine', name: 'Mine', mainRepo: 'mine', repos: ['mine'] });
    const h = createHarness((self) => {
      self.git.markWorkTree(CHECKOUT);
      self.definitions.seedProjectAt(CHECKOUT, original);
    });

    expectErr(await createProject(h.deps, { source: existing, name: 'Atölye', actor: ACTOR }), 'project_exists');

    expect(h.definitions.repoAt(CHECKOUT)).toBeUndefined();
    expect(await h.projects.list()).toEqual([]);
    expect(await h.repos.list()).toEqual([]);
    expect(h.log.entries()).toEqual([]);
  });

  it('A-77: an existing repo.yaml is docket_folder_exists — nothing is written, registered or audited', async () => {
    const h = createHarness((self) => {
      self.git.markWorkTree(CHECKOUT);
      self.definitions.seedRepoAt(CHECKOUT, '{"id":"mine"}');
    });

    expectErr(await createProject(h.deps, { source: existing, name: 'Atölye', actor: ACTOR }), 'docket_folder_exists');

    expect((await h.definitions.readProjectAt(CHECKOUT)).ok).toBe(false);
    expect(h.definitions.repoAt(CHECKOUT)).toBe('{"id":"mine"}');
    expect(await h.projects.list()).toEqual([]);
    expect(h.log.entries()).toEqual([]);
  });

  it('A-77: a scaffold write failure is io_failed; a created folder stays and nothing is attached', async () => {
    const h = createHarness((self) => {
      self.folders.markFolder(PARENT);
      self.git.markWorkTree(`${PARENT}/atolye`);
      self.definitions.failNextScaffold();
    });

    expectErr(await createProject(h.deps, { source: blank, name: 'Atölye', actor: ACTOR }), 'io_failed');

    expect(h.folders.created()).toEqual([`${PARENT}/atolye`]);
    expect(await h.projects.list()).toEqual([]);
    expect(h.log.entries()).toEqual([]);
  });

  it('A-77: attachProject errors come back as they are (a blank folder that is not a work tree)', async () => {
    const h = createHarness((self) => self.folders.markFolder(PARENT));

    expectErr(await createProject(h.deps, { source: blank, name: 'Atölye', actor: ACTOR }), 'not_a_repo');
  });

  it('A-77: installBuiltins never replaces a library file that already exists', async () => {
    const h = createHarness((self) => self.git.markWorkTree(CHECKOUT));
    if (firstRole === undefined) throw new Error('fixture needs a built-in role');
    h.definitions.seed({ kind: 'global' }, `roles/${firstRole.id}.json`, '{"roles":[]}');

    await createProject(h.deps, { source: existing, name: 'Atölye', actor: ACTOR });

    expect((await globalRoleFile(h))?.content).toBe('{"roles":[]}');
  });
});

describe('createProject audit (A-78)', () => {
  it('A-78: project.created comes first, then project.attached, with source and builtinsWritten', async () => {
    const h = createHarness((self) => self.git.markWorkTree(CHECKOUT));

    await createProject(h.deps, { source: existing, name: 'Atölye', actor: ACTOR });

    const entries = h.log.entries();
    expect(entries.map((entry) => entry.action)).toEqual(['project.created', 'project.attached']);
    expect(entries[0]?.subject).toEqual({ kind: 'project', id: 'atolye' });
    expect(entries[0]?.actor).toEqual(ACTOR);
    expect(entries[0]?.detail).toEqual({ source: 'existing', builtinsWritten: BUILTIN_ROLES.length + BUILTIN_FLOWS.length });
  });

  it('A-78: builtinsWritten counts only the files actually written on a second project', async () => {
    const h = createHarness((self) => {
      self.git.markWorkTree(CHECKOUT);
      self.git.markWorkTree('/work/other');
    });
    await createProject(h.deps, { source: existing, name: 'Atölye', actor: ACTOR });

    await createProject(h.deps, { source: { kind: 'existing', path: '/work/other' }, name: 'Other', actor: ACTOR });

    const created = h.log.entries().filter((entry) => entry.action === 'project.created');
    expect(created[1]?.detail).toEqual({ source: 'existing', builtinsWritten: 0 });
  });

  it('A-78: blank source is recorded as source blank; a refusal writes no audit entry', async () => {
    const h = createHarness((self) => {
      self.folders.markFolder(PARENT);
      self.git.markWorkTree(`${PARENT}/atolye`);
    });
    expectErr(await createProject(h.deps, { source: blank, name: '', actor: ACTOR }), 'invalid_name');
    expect(h.log.entries()).toEqual([]);

    await createProject(h.deps, { source: blank, name: 'Atölye', actor: ACTOR });

    expect(h.log.entries()[0]?.detail).toMatchObject({ source: 'blank' });
  });
});
