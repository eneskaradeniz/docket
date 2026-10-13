// Tests for the re-rooted YAML definition store (I-86 layout, I-95 grammar and create-only
// version files, I-96 installs, R-129/R-134/R-139 arms; I-11/I-12/I-14/I-16/I-32/I-36/I-44 keep
// successor-behaviour titles). Real files in fs.mkdtemp folders only.
import { mkdir, mkdtemp, readdir, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join, relative } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { stringify } from 'yaml';

import type { DefinitionStore } from '../../../application/index';
import type { CapabilityDef, CapabilitySlug, ProjectSlug, RepoSlug } from '../../../domain/index';
import { BUILTIN_FLOWS, BUILTIN_ROLES } from '../../../domain/index';

import { createYamlDefinitionStore } from './store';
import { hashContent } from './targets';

const REPO = 'acme' as RepoSlug;
const UNKNOWN_REPO = 'ghost' as RepoSlug;
const PROJECT = 'atolye' as ProjectSlug;

let globalRoot = '';
let besideRoot = '';

const makeStore = (): DefinitionStore => createYamlDefinitionStore({ globalRoot });

beforeEach(async () => {
  globalRoot = await mkdtemp(join(tmpdir(), 'docket-yaml-root-'));
  besideRoot = await mkdtemp(join(tmpdir(), 'docket-yaml-beside-'));
});

afterEach(async () => {
  await rm(globalRoot, { recursive: true, force: true });
  await rm(besideRoot, { recursive: true, force: true });
});

// --- fixtures ---------------------------------------------------------------------------------------

const writeText = async (root: string, target: string, text: string): Promise<void> => {
  const file = join(root, target);
  await mkdir(dirname(file), { recursive: true });
  await writeFile(file, text, 'utf8');
};

const writeYaml = (root: string, target: string, value: unknown): Promise<void> =>
  writeText(root, target, `${stringify(value)}\n`);

const roleDef = (id: string, overrides: Record<string, unknown> = {}): unknown => ({
  id,
  name: `Role ${id}`,
  instructions: `Do the ${id} work.`,
  writeScope: { kind: 'none' },
  capabilities: [],
  active: true,
  ...overrides,
});

const flowDef = (id: string, overrides: Record<string, unknown> = {}): unknown => ({
  id,
  name: `Flow ${id}`,
  stages: [
    { id: 'plan', name: 'Plan', role: 'planner', exit: [{ kind: 'human', id: 'plan-approval', label: 'Plan onayı' }] },
  ],
  ...overrides,
});

const capabilityDef = (id: CapabilitySlug): CapabilityDef => ({
  kind: 'context',
  id,
  name: `Capability ${id}`,
  path: join(besideRoot, `${id}.md`),
});

const repoDef = (id: string, overrides: Record<string, unknown> = {}): unknown => ({
  id,
  name: `Repo ${id}`,
  flow: {
    flowId: 'std',
    version: 1,
    stages: [{ id: 'plan', name: 'Plan', role: 'planner', exit: [] }],
    bindings: [{ stage: 'plan', role: { roleId: 'planner', version: 1 }, accounts: [] }],
  },
  defaultLimitPolicy: 'wait_resume',
  commandSets: {},
  docsRoot: 'docs',
  testGlobs: [],
  ...overrides,
});

const roadmapDef = (overrides: Record<string, unknown> = {}): unknown => ({
  phases: [
    {
      id: 'phase-1',
      name: 'Birinci aşama',
      blockedBy: [],
      tasks: [{ id: 'task-1', title: 'İş', dependsOn: [], acceptance: ['kabul'] }],
    },
  ],
  ...overrides,
});

/** A loadable world: the standard flow, the planner role, and the repo's repo.yaml. */
const seedLoadableWorld = async (): Promise<void> => {
  await writeYaml(globalRoot, 'library/flows/std/v1.yaml', flowDef('std', { stages: [{ id: 'plan', name: 'Plan', role: 'planner', exit: [] }] }));
  await writeYaml(globalRoot, 'library/roles/planner/v1.yaml', roleDef('planner'));
  await writeYaml(globalRoot, `repos/${REPO}/repo.yaml`, repoDef(REPO));
};

// --- load --------------------------------------------------------------------------------------------

describe('load', () => {
  it('I-12: loads the library\'s current versions together with the repo\'s repo.yaml', async () => {
    await seedLoadableWorld();
    const loaded = await makeStore().load(REPO);
    expect(loaded.ok).toBe(true);
    if (!loaded.ok) return;
    expect(loaded.value.flows.map((flow) => flow.id)).toEqual(['std']);
    expect(loaded.value.roles.map((role) => role.id)).toEqual(['planner']);
    expect(loaded.value.repo?.id).toBe(REPO);
    expect(loaded.value.project).toBeUndefined();
  });

  it('I-12: the newest version of a definition is the current one', async () => {
    await writeYaml(globalRoot, 'library/flows/std/v1.yaml', flowDef('std', { stages: [{ id: 'plan', name: 'Plan', role: 'planner', exit: [] }] }));
    await writeYaml(globalRoot, 'library/roles/planner/v1.yaml', roleDef('planner', { name: 'Old' }));
    await writeYaml(globalRoot, 'library/roles/planner/v2.yaml', roleDef('planner', { name: 'New' }));
    const flowV2 = {
      flowId: 'std',
      version: 1,
      stages: [{ id: 'plan', name: 'Plan', role: 'planner', exit: [] }],
      bindings: [{ stage: 'plan', role: { roleId: 'planner', version: 2 }, accounts: [] }],
    };
    await writeYaml(globalRoot, `repos/${REPO}/repo.yaml`, repoDef(REPO, { flow: flowV2 }));
    const loaded = await makeStore().load(REPO);
    expect(loaded.ok && loaded.value.roles[0]?.name).toBe('New');
  });

  it('I-11: only version files the grammar accepts are read, in version order', async () => {
    await writeYaml(globalRoot, 'library/flows/std/v1.yaml', flowDef('std', { stages: [{ id: 'plan', name: 'Plan', role: 'planner', exit: [] }] }));
    await writeYaml(globalRoot, 'library/roles/planner/v1.yaml', roleDef('planner'));
    await writeText(globalRoot, 'library/roles/planner/notes.txt', 'not a definition');
    await writeYaml(globalRoot, `repos/${REPO}/repo.yaml`, repoDef(REPO));
    const loaded = await makeStore().load(REPO);
    expect(loaded.ok && loaded.value.roles).toHaveLength(1);
  });

  it('I-12: a repo without repo.yaml is a missing_field issue on path "repo"', async () => {
    await writeYaml(globalRoot, 'library/roles/planner/v1.yaml', roleDef('planner'));
    const loaded = await makeStore().load(UNKNOWN_REPO);
    expect(loaded).toEqual({
      ok: false,
      error: [{ path: 'repo', code: 'missing_field', message: 'repo.yaml is required' }],
    });
  });

  it('I-12: an unparsable library file is a wrong_type issue carrying the yaml-prefixed reason', async () => {
    await writeText(globalRoot, 'library/roles/planner/v1.yaml', 'id: [unclosed');
    const loaded = await makeStore().load(REPO);
    expect(loaded.ok).toBe(false);
    if (loaded.ok) return;
    expect(loaded.error[0]?.code).toBe('wrong_type');
    expect(loaded.error[0]?.path).toBe('library/roles/planner/v1.yaml');
    expect(loaded.error[0]?.message.startsWith('yaml:')).toBe(true);
  });

  it('I-12: an id that does not match its folder is an invalid_slug issue', async () => {
    await writeYaml(globalRoot, 'library/roles/planner/v1.yaml', roleDef('other'));
    const loaded = await makeStore().load(REPO);
    expect(loaded).toEqual({
      ok: false,
      error: [{ path: 'library/roles/planner/v1.yaml', code: 'invalid_slug', message: 'id does not match folder name' }],
    });
  });

  it('I-13: file problems are collected before validation and keep their original paths', async () => {
    await writeText(globalRoot, 'library/roles/planner/v1.yaml', 'id: [unclosed');
    const loaded = await makeStore().load(REPO);
    expect(loaded.ok).toBe(false);
    if (loaded.ok) return;
    expect(loaded.error.some((issue) => issue.code === 'wrong_type' && issue.path === 'library/roles/planner/v1.yaml')).toBe(true);
  });

  it('I-12: the merged input goes through validateDefinitions, so semantic issues surface with their paths', async () => {
    await writeYaml(globalRoot, 'library/roles/planner/v1.yaml', roleDef('planner'));
    const invalidFlow = {
      flowId: 'std',
      version: 1,
      stages: [{ id: 'plan', name: 'Plan', role: 'planner', exit: [] }],
      bindings: [{ stage: 'plan', role: { roleId: 'planner', version: 99 }, accounts: [] }],
    };
    await writeYaml(globalRoot, `repos/${REPO}/repo.yaml`, repoDef(REPO, { flow: invalidFlow }));
    const loaded = await makeStore().load(REPO);
    expect(loaded.ok).toBe(false);
    if (loaded.ok) return;
    expect(loaded.error.some((issue) => issue.code === 'unknown_role_version')).toBe(true);
  });

  it('I-86: every definition is read and written under the ~/.docket layout', async () => {
    await seedLoadableWorld();
    const store = makeStore();
    expect((await store.load(REPO)).ok).toBe(true);
    // No roadmap lives under the root for this project yet.
    expect(await store.loadRoadmap(PROJECT)).toBeUndefined();
    const written = await store.writeFile(`projects/${PROJECT}/roadmap.yaml`, `${stringify(roadmapDef())}\n`, '');
    expect(written.ok).toBe(true);
    const roadmap = await store.loadRoadmap(PROJECT);
    expect(roadmap !== undefined && roadmap.ok).toBe(true);
    // Everything the store ever answered sits under the root.
    for (const target of ['repos/acme/repo.yaml', 'library/roles/planner/v1.yaml', `projects/${PROJECT}/roadmap.yaml`]) {
      expect(await readFile(join(globalRoot, target), 'utf8')).toBeTruthy();
    }
    expect(relative(globalRoot, join(globalRoot, 'library/roles/planner/v1.yaml'))).toBe('library/roles/planner/v1.yaml');
  });

  it('I-87: no store write lands inside a registered repo folder — every write target stays under the global root', async () => {
    // A repo folder beside the root stands in for a registered checkout: the store's whole write
    // surface runs, and the folder's tree must come back byte-identical.
    const repoFolder = join(besideRoot, 'checkout');
    await writeText(repoFolder, '.git/HEAD', 'ref: refs/heads/main\n');
    await writeText(repoFolder, 'README.md', 'mine\n');
    const walkFiles = async (folder: string): Promise<readonly string[]> => {
      const entries = await readdir(folder, { withFileTypes: true });
      const files: string[] = [];
      for (const entry of entries) {
        const path = join(folder, entry.name);
        if (entry.isDirectory()) files.push(...(await walkFiles(path)));
        else files.push(path);
      }
      return files;
    };
    const snapshot = async (): Promise<readonly (readonly [string, string])[]> =>
      Promise.all((await walkFiles(repoFolder)).map(async (file) => [file, await readFile(file, 'utf8')] as const));
    const before = await snapshot();

    const store = makeStore();
    await store.installBuiltins({ roles: BUILTIN_ROLES, flows: BUILTIN_FLOWS });
    await store.installCapabilities([capabilityDef('docs' as CapabilitySlug)]);
    await store.appendVersion('roles', 'planner', roleDef('planner'), 10);
    await store.appendVersion('memory', 'notes', { note: 'a' }, 10);
    const written = await store.writeFile(`repos/${REPO}/repo.yaml`, `${stringify(repoDef(REPO))}\n`, '');
    expect(written.ok).toBe(true);

    expect(await snapshot()).toEqual(before);
  });
});

// --- roadmap -----------------------------------------------------------------------------------------

describe('loadRoadmap', () => {
  it('R-139: the project roadmap is read from and written to ~/.docket/projects/<slug>/roadmap.yaml', async () => {
    const store = makeStore();
    expect(await store.loadRoadmap(PROJECT)).toBeUndefined();
    const written = await store.writeFile(`projects/${PROJECT}/roadmap.yaml`, `${stringify(roadmapDef())}\n`, '');
    expect(written.ok).toBe(true);
    const roadmap = await store.loadRoadmap(PROJECT);
    expect(roadmap !== undefined && roadmap.ok && roadmap.value.phases[0]?.id).toBe('phase-1');
    const file = await store.readFile(`projects/${PROJECT}/roadmap.yaml`);
    expect(file?.content).toBe(`${stringify(roadmapDef())}\n`);
  });

  it('I-14: an unknown project has no roadmap', async () => {
    expect(await makeStore().loadRoadmap(PROJECT)).toBeUndefined();
  });

  it('I-14: a valid roadmap.yaml loads through validateRoadmap with the project', async () => {
    await writeYaml(globalRoot, `projects/${PROJECT}/project.yaml`, { id: PROJECT, name: 'Atölye', repos: [REPO] });
    await writeYaml(globalRoot, `projects/${PROJECT}/roadmap.yaml`, roadmapDef({ phases: [{ id: 'phase-1', name: 'Bir', blockedBy: [], tasks: [{ id: 'task-1', title: 'İş', dependsOn: [], targets: [REPO], acceptance: ['kabul'] }] }] }));
    const roadmap = await makeStore().loadRoadmap(PROJECT);
    expect(roadmap !== undefined && roadmap.ok).toBe(true);
  });

  it('I-14: an invalid roadmap returns the validateRoadmap issues', async () => {
    await writeYaml(globalRoot, `projects/${PROJECT}/project.yaml`, { id: PROJECT, name: 'Atölye', repos: [REPO] });
    await writeYaml(globalRoot, `projects/${PROJECT}/roadmap.yaml`, roadmapDef({ phases: [{ id: 'phase-1', name: 'Bir', blockedBy: [], tasks: [{ id: 'task-1', title: 'İş', dependsOn: [], targets: [UNKNOWN_REPO], acceptance: [] }] }] }));
    const roadmap = await makeStore().loadRoadmap(PROJECT);
    expect(roadmap !== undefined && !roadmap.ok).toBe(true);
    if (roadmap === undefined || roadmap.ok) return;
    expect(roadmap.error.some((issue) => issue.code === 'unknown_repo')).toBe(true);
  });

  it('I-14: an unparsable roadmap.yaml is a wrong_type RoadmapIssue on path roadmap.yaml', async () => {
    await writeText(globalRoot, `projects/${PROJECT}/roadmap.yaml`, 'phases: [unclosed');
    const roadmap = await makeStore().loadRoadmap(PROJECT);
    expect(roadmap !== undefined && !roadmap.ok).toBe(true);
    if (roadmap === undefined || roadmap.ok) return;
    expect(roadmap.error[0]?.path).toBe('roadmap.yaml');
    expect(roadmap.error[0]?.code).toBe('wrong_type');
  });
});

// --- readFile / writeFile ------------------------------------------------------------------------------

describe('readFile and writeFile', () => {
  it('I-15: readFile ignores invalid targets, unknown subjects and missing files and returns the content hash for real files', async () => {
    const store = makeStore();
    const content = `${stringify(repoDef(REPO))}\n`;
    await writeText(globalRoot, `repos/${REPO}/repo.yaml`, content);
    expect(await store.readFile('outside/roles.yaml')).toBeUndefined();
    expect(await store.readFile(`repos/${UNKNOWN_REPO}/repo.yaml`)).toBeUndefined();
    expect(await store.readFile('missing.yaml')).toBeUndefined();
    expect(await store.readFile(`repos/${REPO}/repo.yaml`)).toEqual({ content, hash: hashContent(content) });
  });

  it('I-17: validateCandidate is side-effect free and rejects invalid targets before any write', async () => {
    const store = makeStore();
    const before = await readdir(globalRoot);
    const invalid = await store.validateCandidate('outside/roles.yaml', 'x');
    expect(invalid).toEqual({ ok: false, error: [{ path: 'outside/roles.yaml', code: 'wrong_type', message: 'not a definition file' }] });
    expect(await readdir(globalRoot)).toEqual(before);
    await seedLoadableWorld();
    const valid = await store.validateCandidate(`repos/${REPO}/repo.yaml`, `${stringify(repoDef(REPO))}\n`);
    expect(valid.ok).toBe(true);
  });

  it('I-16: an invalid target throws', async () => {
    const store = makeStore();
    await expect(store.writeFile('outside/roles.yaml', 'x', '')).rejects.toThrow('not a definition file');
    expect(await store.readFile('outside/roles.yaml')).toBeUndefined();
    expect(await store.readFile('../escape.yaml')).toBeUndefined();
  });

  it('I-16: an absent file with expectedHash "" is created, folders made as needed, and the new hash returned', async () => {
    const content = `${stringify(repoDef(REPO))}\n`;
    const written = await makeStore().writeFile(`repos/${REPO}/repo.yaml`, content, '');
    expect(written.ok).toBe(true);
    if (!written.ok) return;
    expect(written.value.hash).toBe(hashContent(content));
    expect(await readFile(join(globalRoot, `repos/${REPO}/repo.yaml`), 'utf8')).toBe(content);
  });

  it('I-16: an absent file with a non-empty expectedHash is stale and stays absent', async () => {
    const store = makeStore();
    const written = await store.writeFile(`repos/${REPO}/repo.yaml`, 'x', 'deadbeef');
    expect(written).toEqual({ ok: false, error: 'stale' });
    await expect(readFile(join(globalRoot, `repos/${REPO}/repo.yaml`), 'utf8')).rejects.toMatchObject({ code: 'ENOENT' });
  });

  it('I-16: an existing file is replaced when the expected hash matches', async () => {
    const store = makeStore();
    await store.writeFile(`repos/${REPO}/repo.yaml`, 'a: 1\n', '');
    const replaced = await store.writeFile(`repos/${REPO}/repo.yaml`, 'a: 2\n', hashContent('a: 1\n'));
    expect(replaced.ok).toBe(true);
    expect(await readFile(join(globalRoot, `repos/${REPO}/repo.yaml`), 'utf8')).toBe('a: 2\n');
  });

  it('I-16: a stale expected hash changes nothing', async () => {
    const store = makeStore();
    await store.writeFile(`repos/${REPO}/repo.yaml`, 'a: 1\n', '');
    const replaced = await store.writeFile(`repos/${REPO}/repo.yaml`, 'a: 2\n', hashContent('something else'));
    expect(replaced).toEqual({ ok: false, error: 'stale' });
    expect(await readFile(join(globalRoot, `repos/${REPO}/repo.yaml`), 'utf8')).toBe('a: 1\n');
  });

  it('I-16: of two concurrent writers with the same expectedHash exactly one succeeds', async () => {
    const store = makeStore();
    const target = `repos/${REPO}/repo.yaml`;
    await store.writeFile(target, 'a: 1\n', '');
    const first = store.writeFile(target, 'a: 2\n', hashContent('a: 1\n'));
    const second = store.writeFile(target, 'a: 3\n', hashContent('a: 1\n'));
    const outcomes = await Promise.all([first, second]);
    expect(outcomes.filter((outcome) => outcome.ok)).toHaveLength(1);
    expect(await readFile(join(globalRoot, target), 'utf8')).toBe(outcomes[0]?.ok ? 'a: 2\n' : 'a: 3\n');
  });

  it('I-95: a library version target writes only with expectedHash "" onto a file that does not exist', async () => {
    const store = makeStore();
    const created = await store.writeFile('library/roles/planner/v1.yaml', `${stringify(roleDef('planner'))}\n`, '');
    expect(created.ok).toBe(true);
    const refused = await store.writeFile('library/roles/planner/v2.yaml', 'x', hashContent('nothing'));
    expect(refused).toEqual({ ok: false, error: 'stale' });
    await expect(readFile(join(globalRoot, 'library/roles/planner/v2.yaml'), 'utf8')).rejects.toMatchObject({ code: 'ENOENT' });
  });

  it('R-129: a recorded library version file is never rewritten on disk', async () => {
    const store = makeStore();
    const body = `${stringify(roleDef('planner'))}\n`;
    const created = await store.writeFile('library/roles/planner/v1.yaml', body, '');
    expect(created.ok).toBe(true);
    // Whatever hash a later write claims — the recorded one, the file's own — a version file
    // refuses; only appending the NEXT version writes anything.
    const sameHash = await store.writeFile('library/roles/planner/v1.yaml', 'id: planner\n', created.ok ? created.value.hash : '');
    expect(sameHash).toEqual({ ok: false, error: 'stale' });
    expect(await readFile(join(globalRoot, 'library/roles/planner/v1.yaml'), 'utf8')).toBe(body);
    const appended = await store.appendVersion('roles', 'planner', roleDef('planner', { name: 'New' }), 50);
    expect(appended.ok && appended.value.version).toBe(2);
    expect(await readFile(join(globalRoot, 'library/roles/planner/v1.yaml'), 'utf8')).toBe(body);
    expect(await readFile(join(globalRoot, 'library/roles/planner/v2.yaml'), 'utf8')).toContain('New');
  });
});

// --- validateCandidate ---------------------------------------------------------------------------------

describe('validateCandidate', () => {
  it('I-95: a library version candidate validates as that definition\'s next version', async () => {
    const store = makeStore();
    await writeYaml(globalRoot, 'library/roles/planner/v1.yaml', roleDef('planner'));
    const valid = await store.validateCandidate('library/roles/planner/v2.yaml', `${stringify(roleDef('planner', { name: 'New' }))}\n`);
    expect(valid.ok).toBe(true);
    const wrongId = await store.validateCandidate('library/roles/planner/v2.yaml', `${stringify(roleDef('other'))}\n`);
    expect(wrongId.ok).toBe(false);
    if (wrongId.ok) return;
    expect(wrongId.error[0]?.code).toBe('invalid_slug');
    const broken = await store.validateCandidate('library/roles/planner/v2.yaml', 'name: [unclosed');
    expect(broken.ok).toBe(false);
  });

  it('validates a repo.yaml candidate against the library it would load with', async () => {
    await writeYaml(globalRoot, 'library/flows/std/v1.yaml', flowDef('std', { stages: [{ id: 'plan', name: 'Plan', role: null, exit: [] }] }));
    await writeYaml(globalRoot, 'library/roles/planner/v1.yaml', roleDef('planner'));
    const store = makeStore();
    await seedLoadableWorld();
    const valid = await store.validateCandidate(`repos/${REPO}/repo.yaml`, `${stringify(repoDef(REPO))}\n`);
    expect(valid.ok).toBe(true);
    const invalidFlow = {
      flowId: 'std',
      version: 1,
      stages: [{ id: 'plan', name: 'Plan', role: 'planner', exit: [] }],
      bindings: [{ stage: 'plan', role: { roleId: 'ghost', version: 1 }, accounts: [] }],
    };
    const unknownRole = await store.validateCandidate(`repos/${REPO}/repo.yaml`, `${stringify(repoDef(REPO, { flow: invalidFlow }))}\n`);
    expect(unknownRole.ok).toBe(false);
  });

  it('I-32: a project.yaml candidate validates through the project rules alone', async () => {
    const store = makeStore();
    const valid = await store.validateCandidate(`projects/${PROJECT}/project.yaml`, `${stringify({ id: PROJECT, name: 'Atölye', repos: [REPO] })}\n`);
    expect(valid.ok).toBe(true);
    const emptyRepos = await store.validateCandidate(`projects/${PROJECT}/project.yaml`, `${stringify({ id: PROJECT, name: 'Atölye', repos: [] })}\n`);
    expect(emptyRepos.ok).toBe(false);
  });

  it('I-32: an unparsable project.yaml is a wrong_type issue', async () => {
    const broken = await makeStore().validateCandidate(`projects/${PROJECT}/project.yaml`, 'id: [unclosed');
    expect(broken.ok).toBe(false);
    if (broken.ok) return;
    expect(broken.error[0]?.code).toBe('wrong_type');
  });

  it('validates a roadmap candidate against the project\'s own project.yaml', async () => {
    await writeYaml(globalRoot, `projects/${PROJECT}/project.yaml`, { id: PROJECT, name: 'Atölye', repos: [REPO] });
    const store = makeStore();
    const valid = await store.validateCandidate(`projects/${PROJECT}/roadmap.yaml`, `${stringify(roadmapDef())}\n`);
    expect(valid.ok).toBe(true);
    const unknownRepo = await store.validateCandidate(`projects/${PROJECT}/roadmap.yaml`, `${stringify(roadmapDef({ phases: [{ id: 'phase-1', name: 'Bir', blockedBy: [], tasks: [{ id: 'task-1', title: 'İş', dependsOn: [], targets: [UNKNOWN_REPO], acceptance: [] }] }] }))}\n`);
    expect(unknownRepo.ok).toBe(false);
  });

  it('refuses a target outside the grammar', async () => {
    const refused = await makeStore().validateCandidate('outside/roles.yaml', 'x');
    expect(refused.ok).toBe(false);
    if (refused.ok) return;
    expect(refused.error[0]?.message).toBe('not a definition file');
  });
});

// --- installs ------------------------------------------------------------------------------------------

describe('installBuiltins', () => {
  it('I-96: writes library/roles/<id>/v1.yaml and library/flows/<id>/v1.yaml, listing the targets', async () => {
    const installed = await makeStore().installBuiltins({ roles: BUILTIN_ROLES, flows: BUILTIN_FLOWS });
    for (const role of BUILTIN_ROLES) {
      expect(installed.written).toContain(`library/roles/${role.id}/v1.yaml`);
      expect(await readFile(join(globalRoot, 'library/roles', role.id, 'v1.yaml'), 'utf8')).toBeTruthy();
    }
    for (const flow of BUILTIN_FLOWS) {
      expect(installed.written).toContain(`library/flows/${flow.id}/v1.yaml`);
    }
  });

  it('I-96: the written files round-trip — loaded back they equal the library definitions', async () => {
    await makeStore().installBuiltins({ roles: BUILTIN_ROLES, flows: BUILTIN_FLOWS });
    const allRolesFlow = {
      flowId: BUILTIN_FLOWS[0]?.id ?? 'standard',
      version: 1,
      stages: BUILTIN_ROLES.map((role) => ({
        id: role.id,
        name: role.name,
        role: role.id,
        exit: [],
      })),
      bindings: BUILTIN_ROLES.map((role) => ({
        stage: role.id,
        role: { roleId: role.id, version: 1 },
        accounts: [],
      })),
    };
    await writeYaml(globalRoot, `repos/${REPO}/repo.yaml`, repoDef(REPO, {
      flow: allRolesFlow,
      commandSets: { tests: ['node -e "process.exit(0)"'] },
    }));
    const loaded = await makeStore().load(REPO);
    expect(loaded.ok).toBe(true);
    if (!loaded.ok) return;
    // The library answers ids in slug order; the built-ins ride their own library order.
    const byId = (a: { readonly id: string }, b: { readonly id: string }): number => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0);
    expect([...loaded.value.roles].sort(byId)).toEqual([...BUILTIN_ROLES].sort(byId));
    const expectedFlows = BUILTIN_FLOWS.map((flow) =>
      flow.id === allRolesFlow.flowId ? { ...flow, stages: allRolesFlow.stages } : flow,
    );
    expect([...loaded.value.flows].sort(byId)).toEqual([...expectedFlows].sort(byId));
  });

  it('I-36: a target that exists is skipped untouched whatever its content; written lists only what was written', async () => {
    const store = makeStore();
    await writeText(globalRoot, `library/roles/${BUILTIN_ROLES[0]?.id}/v1.yaml`, 'id: somebody-elses\n');
    const installed = await store.installBuiltins({ roles: BUILTIN_ROLES, flows: [] });
    expect(installed.written).not.toContain(`library/roles/${BUILTIN_ROLES[0]?.id}/v1.yaml`);
    expect(installed.written).toHaveLength(BUILTIN_ROLES.length - 1);
    expect(await readFile(join(globalRoot, 'library/roles', BUILTIN_ROLES[0]?.id ?? '', 'v1.yaml'), 'utf8')).toBe('id: somebody-elses\n');
  });

  it('I-36: a second run writes nothing', async () => {
    const store = makeStore();
    await store.installBuiltins({ roles: BUILTIN_ROLES, flows: BUILTIN_FLOWS });
    const again = await store.installBuiltins({ roles: BUILTIN_ROLES, flows: BUILTIN_FLOWS });
    expect(again.written).toEqual([]);
  });

  it('I-36: a symbolic link at a target counts as existing and is not followed', async () => {
    const { symlink } = await import('node:fs/promises');
    const role = BUILTIN_ROLES[0];
    if (role === undefined) throw new Error('expected a built-in role');
    const folder = join(globalRoot, 'library/roles', role.id);
    await mkdir(folder, { recursive: true });
    await symlink(join(besideRoot, 'victim.yaml'), join(folder, 'v1.yaml'));
    const installed = await makeStore().installBuiltins({ roles: BUILTIN_ROLES, flows: [] });
    expect(installed.written).not.toContain(`library/roles/${role.id}/v1.yaml`);
    await expect(readFile(join(besideRoot, 'victim.yaml'), 'utf8')).rejects.toMatchObject({ code: 'ENOENT' });
  });
});

describe('installCapabilities', () => {
  it('I-44: writes library/capabilities/<id>/v1.yaml, skipping targets that exist', async () => {
    const first = capabilityDef('docs' as CapabilitySlug);
    const second = capabilityDef('kit' as CapabilitySlug);
    const store = makeStore();
    const installed = await store.installCapabilities([first, second]);
    expect(installed.written).toEqual(['library/capabilities/docs/v1.yaml', 'library/capabilities/kit/v1.yaml']);
    expect(installed.skipped).toEqual([]);
    const again = await store.installCapabilities([first, second]);
    expect(again.written).toEqual([]);
    expect(again.skipped).toEqual(['library/capabilities/docs/v1.yaml', 'library/capabilities/kit/v1.yaml']);
  });

  it('I-44: a written capability round-trips through load', async () => {
    const capability = capabilityDef('docs' as CapabilitySlug);
    await makeStore().installCapabilities([capability]);
    await writeYaml(globalRoot, 'library/flows/std/v1.yaml', flowDef('std', { stages: [{ id: 'plan', name: 'Plan', role: null, exit: [] }] }));
    await writeYaml(globalRoot, `repos/${REPO}/repo.yaml`, repoDef(REPO, {
      flow: {
        flowId: 'std',
        version: 1,
        stages: [{ id: 'plan', name: 'Plan', role: null, exit: [] }],
        bindings: [{ stage: 'plan', accounts: [] }],
      },
    }));
    const loaded = await makeStore().load(REPO);
    expect(loaded.ok && loaded.value.capabilities).toEqual([capability]);
  });
});

// --- version histories -----------------------------------------------------------------------------------

describe('listVersions and appendVersion', () => {
  it('answers an empty history for an unknown definition, then contiguous versions from 1', async () => {
    const store = makeStore();
    expect(await store.listVersions('roles', 'planner')).toEqual([]);
    const first = await store.appendVersion('roles', 'planner', roleDef('planner'), 10);
    expect(first.ok && first.value.version).toBe(1);
    const second = await store.appendVersion('roles', 'planner', roleDef('planner', { name: 'New' }), 20);
    expect(second.ok && second.value.version).toBe(2);
    if (!first.ok || !second.ok) return;
    expect([first.value.recordedAt, second.value.recordedAt]).toEqual([10, 20]);
    const history = await store.listVersions('roles', 'planner');
    expect(history.map((record) => record.version)).toEqual([1, 2]);
    // The histories read the files' own mtimes back, which are the write times.
    expect(history.every((record) => typeof record.recordedAt === 'number')).toBe(true);
    expect(history[1]?.body).toEqual(roleDef('planner', { name: 'New' }));
    expect(history.every((record) => record.definitionId === 'planner' && record.archived === false)).toBe(true);
  });

  it('answers stale when the same next version appears first', async () => {
    const store = makeStore();
    // Two concurrent appends both see an empty history and both aim at v1: the per-path write
    // queue lets exactly one create it; the other answers stale and writes nothing.
    const raced = await Promise.all([
      store.appendVersion('roles', 'planner', roleDef('planner', { name: 'First' }), 10),
      store.appendVersion('roles', 'planner', roleDef('planner', { name: 'Second' }), 10),
    ]);
    expect(raced.filter((outcome) => outcome.ok)).toHaveLength(1);
    expect(raced.filter((outcome) => !outcome.ok)).toEqual([{ ok: false, error: 'stale' }]);
    const text = await readFile(join(globalRoot, 'library/roles/planner/v1.yaml'), 'utf8');
    expect(text).toContain(text.includes('First') ? 'First' : 'Second');
    expect(await store.listVersions('roles', 'planner')).toHaveLength(1);
  });

  it('R-134: flows/defaultFlow/roleOverrides are never written by any store-driven write', async () => {
    const store = makeStore();
    await store.installBuiltins({ roles: BUILTIN_ROLES, flows: BUILTIN_FLOWS });
    await store.installCapabilities([capabilityDef('docs' as CapabilitySlug)]);
    await store.appendVersion('roles', 'planner', roleDef('planner'), 10);
    await store.appendVersion('memory', 'notes', { note: 'a' }, 10);
    // The store's own composing writes touch only the library; nothing under repos/ or
    // projects/ exists, and no written body carries the legacy repo fields.
    const roots = await readdir(globalRoot);
    expect(roots).toEqual(['library']);
    const walkFiles = async (folder: string): Promise<readonly string[]> => {
      const entries = await readdir(folder, { withFileTypes: true });
      const files: string[] = [];
      for (const entry of entries) {
        const path = join(folder, entry.name);
        if (entry.isDirectory()) files.push(...(await walkFiles(path)));
        else files.push(path);
      }
      return files;
    };
    for (const file of await walkFiles(join(globalRoot, 'library'))) {
      const text = await readFile(file, 'utf8');
      expect(text).not.toContain('defaultFlow');
      expect(text).not.toContain('roleOverrides');
    }
  });
});
