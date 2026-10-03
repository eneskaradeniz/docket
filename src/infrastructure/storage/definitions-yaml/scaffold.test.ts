// Tests for the project scaffolding methods of the YAML definition store (rule I-36): installBuiltins
// and scaffoldProject. Real files in fs.mkdtemp folders only.
import { mkdir, mkdtemp, readdir, readFile, rm, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { parse } from 'yaml';

import type { DefinitionStore } from '../../../application/index';
import type { ProjectDef, RepoDef, RepoSlug } from '../../../domain/index';
import { BUILTIN_COMMAND_SET_NAMES, BUILTIN_FLOWS, BUILTIN_ROLES, validateDefinitions } from '../../../domain/index';
import type { ProjectPaths, RepoPaths } from '../../system/index';

import { createYamlDefinitionStore } from './store';

const SLUG = 'atolye' as RepoSlug;
const LIBRARY = { roles: BUILTIN_ROLES, flows: BUILTIN_FLOWS };

const PROJECT: ProjectDef = { id: 'atolye' as ProjectDef['id'], name: 'Atölye', mainRepo: SLUG, repos: [SLUG] };
const REPO: RepoDef = {
  id: SLUG,
  name: 'Atölye',
  flows: BUILTIN_FLOWS.map((flow) => flow.id),
  defaultFlow: BUILTIN_FLOWS[0]?.id ?? ('standard' as RepoDef['defaultFlow']),
  commandSets: Object.fromEntries(BUILTIN_COMMAND_SET_NAMES.map((name) => [name, [] as readonly string[]])),
  roleOverrides: [],
  docsRoot: 'docs',
  testGlobs: [],
};

let globalRoot = '';
let checkout = '';
const registry = new Map<string, string>();
const repos: RepoPaths = { path: async (slug) => registry.get(slug) };
const projects: ProjectPaths = {
  projectOf: async (repo) => (registry.has(repo) ? PROJECT.id : undefined),
  mainRepoPath: async () => checkout,
};
const makeStore = (): DefinitionStore => createYamlDefinitionStore({ globalRoot, repos, projects });

beforeEach(async () => {
  globalRoot = await mkdtemp(join(tmpdir(), 'docket-scaffold-global-'));
  checkout = await mkdtemp(join(tmpdir(), 'docket-scaffold-checkout-'));
  registry.clear();
});

afterEach(async () => {
  await rm(globalRoot, { recursive: true, force: true });
  await rm(checkout, { recursive: true, force: true });
});

const firstRole = BUILTIN_ROLES[0];
const firstFlow = BUILTIN_FLOWS[0];
if (firstRole === undefined || firstFlow === undefined) throw new Error('the library must not be empty');

describe('installBuiltins', () => {
  it('I-36: writes every role and flow under the global root, creating the folders, and lists the targets', async () => {
    const result = await makeStore().installBuiltins(LIBRARY);

    const expected = [...BUILTIN_ROLES.map((role) => `roles/${role.id}.yaml`), ...BUILTIN_FLOWS.map((flow) => `flows/${flow.id}.yaml`)];
    expect([...result.written]).toEqual(expected);
    expect((await readdir(join(globalRoot, 'roles'))).sort()).toEqual(BUILTIN_ROLES.map((role) => `${role.id}.yaml`).sort());
    expect((await readdir(join(globalRoot, 'flows'))).sort()).toEqual(BUILTIN_FLOWS.map((flow) => `${flow.id}.yaml`).sort());
  });

  it('I-36: the written files round-trip — loaded back they equal the library definitions', async () => {
    await makeStore().installBuiltins(LIBRARY);
    registry.set(SLUG, checkout);
    await mkdir(join(checkout, '.docket'), { recursive: true });
    await makeStore().scaffoldProject(checkout, PROJECT, REPO);

    const loaded = await makeStore().load(SLUG);

    expect(loaded.ok).toBe(true);
    if (!loaded.ok) return;
    const direct = validateDefinitions({ roles: BUILTIN_ROLES, flows: BUILTIN_FLOWS, capabilities: [] });
    expect(direct.ok).toBe(true);
    if (!direct.ok) return;
    // The store lists files by name; equality is per definition, not per position.
    const byId = <T extends { readonly id: string }>(items: readonly T[]): readonly T[] =>
      [...items].sort((a, b) => (a.id < b.id ? -1 : 1));
    expect(byId(loaded.value.roles)).toEqual(byId(direct.value.roles));
    expect(byId(loaded.value.flows)).toEqual(byId(direct.value.flows));
    expect(parse(await readFile(join(globalRoot, 'flows', `${firstFlow.id}.yaml`), 'utf8'))).toEqual(JSON.parse(JSON.stringify(firstFlow)));
  });

  it('I-36: a target that exists is skipped untouched whatever its content; written lists only what was written', async () => {
    await mkdir(join(globalRoot, 'roles'), { recursive: true });
    await writeFile(join(globalRoot, 'roles', `${firstRole.id}.yaml`), 'not: [valid yaml', 'utf8');
    await mkdir(join(globalRoot, 'flows'), { recursive: true });
    await writeFile(join(globalRoot, 'flows', `${firstFlow.id}.yaml`), '', 'utf8');

    const result = await makeStore().installBuiltins(LIBRARY);

    expect(result.written).not.toContain(`roles/${firstRole.id}.yaml`);
    expect(result.written).not.toContain(`flows/${firstFlow.id}.yaml`);
    expect(await readFile(join(globalRoot, 'roles', `${firstRole.id}.yaml`), 'utf8')).toBe('not: [valid yaml');
    expect(await readFile(join(globalRoot, 'flows', `${firstFlow.id}.yaml`), 'utf8')).toBe('');
    expect(result.written.length).toBe(BUILTIN_ROLES.length + BUILTIN_FLOWS.length - 2);
  });

  it('I-36: a second run writes nothing', async () => {
    await makeStore().installBuiltins(LIBRARY);

    const second = await makeStore().installBuiltins(LIBRARY);

    expect(second.written).toEqual([]);
  });

  it('I-36: a symbolic link at a target counts as existing and is not followed', async () => {
    const elsewhere = join(globalRoot, 'elsewhere.txt');
    await writeFile(elsewhere, 'mine', 'utf8');
    await mkdir(join(globalRoot, 'roles'), { recursive: true });
    await symlink(elsewhere, join(globalRoot, 'roles', `${firstRole.id}.yaml`));

    await makeStore().installBuiltins(LIBRARY);

    expect(await readFile(elsewhere, 'utf8')).toBe('mine');
  });
});

describe('scaffoldProject', () => {
  it('I-36: creates .docket and writes project.yaml and repo.yaml that read back as the same definitions', async () => {
    const store = makeStore();

    const result = await store.scaffoldProject(checkout, PROJECT, REPO);

    expect(result).toEqual({ ok: true, value: undefined });
    expect((await readdir(join(checkout, '.docket'))).sort()).toEqual(['project.yaml', 'repo.yaml']);
    expect(await store.readProjectAt(checkout)).toEqual({ ok: true, value: PROJECT });
    expect(parse(await readFile(join(checkout, '.docket', 'repo.yaml'), 'utf8'))).toEqual(JSON.parse(JSON.stringify(REPO)));
  });

  it('I-36: an existing project.yaml writes nothing and is left untouched', async () => {
    await mkdir(join(checkout, '.docket'), { recursive: true });
    await writeFile(join(checkout, '.docket', 'project.yaml'), 'mine: true\n', 'utf8');

    const result = await makeStore().scaffoldProject(checkout, PROJECT, REPO);

    expect(result).toEqual({ ok: false, error: 'project_yaml_exists' });
    expect(await readdir(join(checkout, '.docket'))).toEqual(['project.yaml']);
    expect(await readFile(join(checkout, '.docket', 'project.yaml'), 'utf8')).toBe('mine: true\n');
  });

  it('I-36: an existing repo.yaml writes nothing — not even project.yaml — and is left untouched', async () => {
    await mkdir(join(checkout, '.docket'), { recursive: true });
    await writeFile(join(checkout, '.docket', 'repo.yaml'), 'mine: true\n', 'utf8');

    const result = await makeStore().scaffoldProject(checkout, PROJECT, REPO);

    expect(result).toEqual({ ok: false, error: 'repo_yaml_exists' });
    expect(await readdir(join(checkout, '.docket'))).toEqual(['repo.yaml']);
    expect(await readFile(join(checkout, '.docket', 'repo.yaml'), 'utf8')).toBe('mine: true\n');
  });

  it('I-36: other files already in .docket stay; nothing but the two files is written', async () => {
    await mkdir(join(checkout, '.docket', 'roles'), { recursive: true });
    await writeFile(join(checkout, '.docket', 'roles', 'mine.yaml'), 'id: mine\n', 'utf8');
    await writeFile(join(checkout, '.docket', 'roadmap.yaml'), 'phases: []\n', 'utf8');

    const result = await makeStore().scaffoldProject(checkout, PROJECT, REPO);

    expect(result.ok).toBe(true);
    expect((await readdir(join(checkout, '.docket'))).sort()).toEqual(['project.yaml', 'repo.yaml', 'roadmap.yaml', 'roles']);
    expect(await readFile(join(checkout, '.docket', 'roadmap.yaml'), 'utf8')).toBe('phases: []\n');
  });

  it('I-36: a write error is io_failed (.docket is a file) and the file stays', async () => {
    await writeFile(join(checkout, '.docket'), 'a file, not a folder', 'utf8');

    const result = await makeStore().scaffoldProject(checkout, PROJECT, REPO);

    expect(result).toEqual({ ok: false, error: 'io_failed' });
    expect(await readFile(join(checkout, '.docket'), 'utf8')).toBe('a file, not a folder');
  });
});
