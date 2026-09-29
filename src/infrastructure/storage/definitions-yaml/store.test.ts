// Tests for the YAML definition store (rules I-12 … I-18). Real files in fs.mkdtemp folders only;
// the repo registry is a stub object, never the real one.
import { mkdir, mkdtemp, readdir, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join, relative } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { stringify } from 'yaml';

import type { DefinitionScope, DefinitionStore } from '../../../application/index';
import type { RepoSlug } from '../../../domain/index';
import { BUILTIN_FLOWS, BUILTIN_ROLES } from '../../../domain/index';
import type { RepoPaths } from '../../system/index';

import { createYamlDefinitionStore } from './store';
import { hashContent } from './targets';

const REPO = 'acme' as RepoSlug;
const UNKNOWN_REPO = 'ghost' as RepoSlug;
const GLOBAL_SCOPE: DefinitionScope = { kind: 'global' };
const REPO_SCOPE: DefinitionScope = { kind: 'repo', repo: REPO };
const UNKNOWN_REPO_SCOPE: DefinitionScope = { kind: 'repo', repo: UNKNOWN_REPO };

let globalRoot = '';
let repoPath = '';
let repoRoot = '';
const registry = new Map<string, string>();
const repos: RepoPaths = { path: async (slug) => registry.get(slug) };

const makeStore = (): DefinitionStore => createYamlDefinitionStore({ globalRoot, repos });

beforeEach(async () => {
  globalRoot = await mkdtemp(join(tmpdir(), 'docket-yaml-global-'));
  repoPath = await mkdtemp(join(tmpdir(), 'docket-yaml-repo-'));
  repoRoot = join(repoPath, '.docket');
  registry.clear();
  registry.set(REPO, repoPath);
});

afterEach(async () => {
  await rm(globalRoot, { recursive: true, force: true });
  await rm(repoPath, { recursive: true, force: true });
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

const repoDef = (overrides: Record<string, unknown> = {}): unknown => ({
  id: 'acme',
  name: 'Acme',
  repos: [],
  flows: ['standard'],
  defaultFlow: 'standard',
  commandSets: { tests: ['npm test'] },
  roleOverrides: [],
  docsRoot: 'docs',
  testGlobs: ['src/**/*.test.ts'],
  ...overrides,
});

/** Seeds the built-in library as global files: roles/<id>.yaml and flows/<id>.yaml. */
const seedLibrary = async (root: string): Promise<void> => {
  for (const role of BUILTIN_ROLES) await writeYaml(root, `roles/${role.id}.yaml`, role);
  for (const flow of BUILTIN_FLOWS) await writeYaml(root, `flows/${flow.id}.yaml`, flow);
};

/** Every file under a root, as target → content; the "nothing changed" oracle. */
const snapshot = async (root: string): Promise<Readonly<Record<string, string>>> => {
  const out: Record<string, string> = {};
  const walk = async (dir: string): Promise<void> => {
    let entries;
    try {
      entries = await readdir(dir, { withFileTypes: true });
    } catch {
      return;
    }
    for (const entry of entries) {
      const path = join(dir, entry.name);
      if (entry.isDirectory()) await walk(path);
      else out[relative(root, path)] = await readFile(path, 'utf8');
    }
  };
  await walk(root);
  return out;
};

const issuesByPath = (issues: readonly { readonly path: string }[]): readonly string[] =>
  [...issues].map((issue) => issue.path).sort();

// --- load (I-12) ------------------------------------------------------------------------------------

describe('load', () => {
  it('I-12: merges global files with repo overrides, the repo entry taking the global position', async () => {
    await seedLibrary(globalRoot);
    const localStandard = { ...BUILTIN_FLOWS[0], name: 'Standart — yerel' };
    await writeYaml(repoRoot, 'flows/standard.yaml', localStandard);
    await writeYaml(repoRoot, 'roles/local-helper.yaml', roleDef('local-helper'));
    await writeYaml(repoRoot, 'workspace.yaml', repoDef());

    const result = await makeStore().load(REPO);

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    // Global flows in file-name order, the repo 'standard' overriding in place.
    expect(result.value.flows.map((flow) => flow.id)).toEqual(['quick-fix', 'research', 'security-reviewed', 'standard']);
    expect(result.value.flows[3]?.name).toBe('Standart — yerel');
    // Global roles in file-name order, then repo-only roles.
    expect(result.value.roles.map((role) => role.id)).toEqual([
      'analyst', 'developer', 'documenter', 'planner', 'reviewer', 'security-auditor', 'test-writer', 'local-helper',
    ]);
    expect(result.value.repo?.defaultFlow).toBe('standard');
    expect(result.value.capabilities).toEqual([]);
  });

  it('I-12: an unknown repo is a missing_field issue on path "repo"', async () => {
    const result = await makeStore().load(UNKNOWN_REPO);

    expect(result).toEqual({
      ok: false,
      error: [{ path: 'repo', code: 'missing_field', message: expect.any(String) }],
    });
  });

  it('I-12: a missing workspace.yaml is the same missing_field issue', async () => {
    await writeYaml(globalRoot, 'flows/standard.yaml', flowDef('standard'));

    const result = await makeStore().load(REPO);

    expect(result).toEqual({
      ok: false,
      error: [{ path: 'repo', code: 'missing_field', message: expect.any(String) }],
    });
  });

  it('I-12: missing kind folders are empty; only *.yaml files that pass parseTarget are read, in file-name order', async () => {
    // No capabilities/ folder anywhere; junk next to the real files.
    await writeYaml(globalRoot, 'roles/planner.yaml', roleDef('planner'));
    await writeText(globalRoot, 'flows/notes.txt', 'not yaml');
    await writeYaml(globalRoot, 'flows/draft.yml', flowDef('draft'));
    await writeYaml(globalRoot, 'flows/UPPER.yaml', flowDef('upper'));
    await writeYaml(globalRoot, 'flows/standard.yaml', flowDef('standard'));
    await mkdir(join(globalRoot, 'flows', 'sub'), { recursive: true });
    await writeYaml(globalRoot, 'flows/sub/inner.yaml', flowDef('inner'));
    await writeText(repoRoot, 'roles/notes.txt', 'not yaml');
    await writeYaml(repoRoot, 'workspace.yaml', repoDef());

    const result = await makeStore().load(REPO);

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.roles.map((role) => role.id)).toEqual(['planner']);
    expect(result.value.capabilities).toEqual([]);
    expect(result.value.flows.map((flow) => flow.id)).toEqual(['standard']);
  });

  it('I-12: repo-only entries follow the globals and keep file-name order among themselves', async () => {
    await writeYaml(globalRoot, 'roles/planner.yaml', roleDef('planner'));
    await writeYaml(globalRoot, 'flows/standard.yaml', flowDef('standard'));
    await writeYaml(repoRoot, 'roles/b-extra.yaml', roleDef('b-extra'));
    await writeYaml(repoRoot, 'roles/a-extra.yaml', roleDef('a-extra'));
    await writeYaml(repoRoot, 'workspace.yaml', repoDef());

    const result = await makeStore().load(REPO);

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.roles.map((role) => role.id)).toEqual(['planner', 'a-extra', 'b-extra']);
  });

  it('I-12: the merged input goes through validateDefinitions, so semantic issues surface with their paths', async () => {
    await writeYaml(globalRoot, 'roles/planner.yaml', roleDef('planner', { capabilities: ['nope'] }));
    await writeYaml(repoRoot, 'workspace.yaml', repoDef());

    const result = await makeStore().load(REPO);

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error).toContainEqual({
      path: 'roles[0].capabilities[0]',
      code: 'unknown_capability',
      message: expect.any(String),
    });
  });
});

// --- load, file problems (I-13) ---------------------------------------------------------------------

describe('load (file problems)', () => {
  it('I-13: unparsable YAML is a wrong_type issue carrying the first line of the parser message', async () => {
    await writeText(globalRoot, 'roles/planner.yaml', 'a: [unclosed');
    await writeYaml(repoRoot, 'workspace.yaml', repoDef());

    const result = await makeStore().load(REPO);

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error).toEqual([
      {
        path: 'global:roles/planner.yaml',
        code: 'wrong_type',
        message: expect.stringMatching(/^yaml: [^\n]+$/),
      },
    ]);
  });

  it('I-13: a parsable document that is not a mapping is a wrong_type issue', async () => {
    await writeText(globalRoot, 'roles/planner.yaml', '- 1\n- 2\n');
    await writeYaml(repoRoot, 'workspace.yaml', repoDef());

    const result = await makeStore().load(REPO);

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error).toEqual([
      { path: 'global:roles/planner.yaml', code: 'wrong_type', message: expect.stringMatching(/^yaml: /) },
    ]);
  });

  it('I-13: a kind file whose id differs from its file stem is an invalid_slug issue', async () => {
    await writeYaml(globalRoot, 'roles/planner.yaml', roleDef('other'));
    await writeYaml(repoRoot, 'workspace.yaml', repoDef());

    const result = await makeStore().load(REPO);

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error).toEqual([
      { path: 'global:roles/planner.yaml', code: 'invalid_slug', message: 'id does not match file name' },
    ]);
  });

  it('I-13: a kind file without an id counts as differing from its stem', async () => {
    const noId = roleDef('planner') as Record<string, unknown>;
    delete noId['id'];
    await writeYaml(globalRoot, 'roles/planner.yaml', noId);
    await writeYaml(repoRoot, 'workspace.yaml', repoDef());

    const result = await makeStore().load(REPO);

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error).toEqual([
      { path: 'global:roles/planner.yaml', code: 'invalid_slug', message: 'id does not match file name' },
    ]);
  });

  it('I-13: problems are collected for every file in both scopes before validation runs', async () => {
    await writeText(globalRoot, 'roles/planner.yaml', 'a: [unclosed');
    await writeYaml(globalRoot, 'roles/analyst.yaml', roleDef('analyst', { capabilities: ['nope'] }));
    await writeYaml(repoRoot, 'flows/standard.yaml', flowDef('other'));
    await writeYaml(repoRoot, 'workspace.yaml', repoDef());

    const result = await makeStore().load(REPO);

    expect(result.ok).toBe(false);
    if (result.ok) return;
    // Both file problems, and validateDefinitions was never reached (no unknown_capability).
    expect(issuesByPath(result.error)).toEqual(['global:roles/planner.yaml', 'repo:flows/standard.yaml']);
    expect(result.error.every((issue) => issue.code === 'wrong_type' || issue.code === 'invalid_slug')).toBe(true);
  });

  it('I-13: an unparsable workspace.yaml is a file problem on the repo scope', async () => {
    await writeYaml(globalRoot, 'roles/planner.yaml', roleDef('planner'));
    await writeText(repoRoot, 'workspace.yaml', 'name: [oops');

    const result = await makeStore().load(REPO);

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error).toEqual([
      { path: 'repo:workspace.yaml', code: 'wrong_type', message: expect.stringMatching(/^yaml: /) },
    ]);
  });
});

// --- loadRoadmap (I-14) -----------------------------------------------------------------------------

describe('loadRoadmap', () => {
  it('I-14: an unknown repo has no roadmap', async () => {
    expect(await makeStore().loadRoadmap(UNKNOWN_REPO)).toBeUndefined();
  });

  it('I-14: a repo without roadmap.yaml has no roadmap', async () => {
    await writeYaml(repoRoot, 'workspace.yaml', repoDef());

    expect(await makeStore().loadRoadmap(REPO)).toBeUndefined();
  });

  it('I-14: a valid roadmap.yaml loads through validateRoadmap', async () => {
    await writeYaml(repoRoot, 'roadmap.yaml', roadmapDef());

    const result = await makeStore().loadRoadmap(REPO);

    expect(result?.ok).toBe(true);
    if (result?.ok !== true) return;
    expect(result.value.phases.map((phase) => phase.id)).toEqual(['phase-1']);
  });

  it('I-14: an invalid roadmap returns the validateRoadmap issues', async () => {
    await writeYaml(repoRoot, 'roadmap.yaml', {
      phases: [{ id: '-bad', name: 'Kötü', blockedBy: [], tasks: [] }],
    });

    const result = await makeStore().loadRoadmap(REPO);

    expect(result?.ok).toBe(false);
    if (result?.ok !== false) return;
    expect(result.error).toContainEqual({ path: 'phases[0].id', code: 'invalid_slug', message: expect.any(String) });
  });

  it('I-14: an unparsable roadmap.yaml is a wrong_type RoadmapIssue on path roadmap.yaml', async () => {
    await writeText(repoRoot, 'roadmap.yaml', 'phases: [oops');

    const result = await makeStore().loadRoadmap(REPO);

    expect(result).toEqual({
      ok: false,
      error: [{ path: 'roadmap.yaml', code: 'wrong_type', message: expect.stringMatching(/^yaml: /) }],
    });
  });

  it('I-14: a roadmap document that is not a mapping is a wrong_type RoadmapIssue too', async () => {
    await writeText(repoRoot, 'roadmap.yaml', '- 1\n');

    const result = await makeStore().loadRoadmap(REPO);

    expect(result).toEqual({
      ok: false,
      error: [{ path: 'roadmap.yaml', code: 'wrong_type', message: expect.stringMatching(/^yaml: /) }],
    });
  });
});

// --- readFile (I-15) --------------------------------------------------------------------------------

describe('readFile', () => {
  it('I-15: an invalid target is undefined in both scopes', async () => {
    const store = makeStore();
    await writeYaml(repoRoot, 'workspace.yaml', repoDef());

    expect(await store.readFile(GLOBAL_SCOPE, 'workspace.yaml')).toBeUndefined();
    expect(await store.readFile(GLOBAL_SCOPE, '../../etc/passwd')).toBeUndefined();
    expect(await store.readFile(REPO_SCOPE, 'roles/../../planner.yaml')).toBeUndefined();
  });

  it('I-15: an unknown repo is undefined', async () => {
    expect(await makeStore().readFile(UNKNOWN_REPO_SCOPE, 'roles/planner.yaml')).toBeUndefined();
  });

  it('I-15: a missing file is undefined', async () => {
    await writeYaml(repoRoot, 'workspace.yaml', repoDef());

    expect(await makeStore().readFile(GLOBAL_SCOPE, 'roles/planner.yaml')).toBeUndefined();
  });

  it('I-15: an existing file returns its content and its sha256 hash', async () => {
    const content = `${stringify(flowDef('standard'))}\n`;
    await writeText(globalRoot, 'flows/standard.yaml', content);
    await writeYaml(repoRoot, 'workspace.yaml', repoDef());
    await writeYaml(repoRoot, 'roadmap.yaml', roadmapDef());

    const store = makeStore();
    const flow = await store.readFile(GLOBAL_SCOPE, 'flows/standard.yaml');
    const repo = await store.readFile(REPO_SCOPE, 'workspace.yaml');
    const roadmap = await store.readFile(REPO_SCOPE, 'roadmap.yaml');

    expect(flow).toEqual({ content, hash: hashContent(content) });
    expect(repo?.hash).toBe(hashContent(repo?.content ?? ''));
    expect(roadmap?.hash).toBe(hashContent(roadmap?.content ?? ''));
  });
});

// --- writeFile (I-16) -------------------------------------------------------------------------------

describe('writeFile', () => {
  it('I-16: an invalid target throws in both scopes', async () => {
    const store = makeStore();
    await writeYaml(repoRoot, 'workspace.yaml', repoDef());

    await expect(store.writeFile(GLOBAL_SCOPE, '../../etc/passwd', 'x', '')).rejects.toThrow();
    await expect(store.writeFile(GLOBAL_SCOPE, 'workspace.yaml', 'x', '')).rejects.toThrow();
    await expect(store.writeFile(REPO_SCOPE, 'flows\\standard.yaml', 'x', '')).rejects.toThrow();
  });

  it('I-16: an unknown repo throws', async () => {
    await expect(
      makeStore().writeFile(UNKNOWN_REPO_SCOPE, 'roles/planner.yaml', 'x', ''),
    ).rejects.toThrow();
  });

  it('I-16: an absent file with expectedHash "" is created, folders made as needed, and the new hash returned', async () => {
    const content = `${stringify(roleDef('planner'))}\n`;

    const result = await makeStore().writeFile(GLOBAL_SCOPE, 'roles/planner.yaml', content, '');

    expect(result).toEqual({ ok: true, value: { hash: hashContent(content) } });
    expect(await readFile(join(globalRoot, 'roles', 'planner.yaml'), 'utf8')).toBe(content);
  });

  it('I-16: an absent file with a non-empty expectedHash is stale and stays absent', async () => {
    const result = await makeStore().writeFile(GLOBAL_SCOPE, 'roles/planner.yaml', 'x', hashContent('other'));

    expect(result).toEqual({ ok: false, error: 'stale' });
    await expect(readFile(join(globalRoot, 'roles', 'planner.yaml'), 'utf8')).rejects.toMatchObject({ code: 'ENOENT' });
  });

  it('I-16: an existing file is replaced when the expected hash matches', async () => {
    const original = `${stringify(roleDef('planner'))}\n`;
    await writeText(globalRoot, 'roles/planner.yaml', original);
    const replacement = `${stringify(roleDef('planner', { name: 'Planlayıcı 2' }))}\n`;

    const result = await makeStore().writeFile(GLOBAL_SCOPE, 'roles/planner.yaml', replacement, hashContent(original));

    expect(result).toEqual({ ok: true, value: { hash: hashContent(replacement) } });
    expect(await readFile(join(globalRoot, 'roles', 'planner.yaml'), 'utf8')).toBe(replacement);
  });

  it('I-16: a stale expected hash changes nothing', async () => {
    const original = `${stringify(roleDef('planner'))}\n`;
    await writeText(globalRoot, 'roles/planner.yaml', original);

    const result = await makeStore().writeFile(GLOBAL_SCOPE, 'roles/planner.yaml', 'tampered', hashContent('other'));

    expect(result).toEqual({ ok: false, error: 'stale' });
    expect(await readFile(join(globalRoot, 'roles', 'planner.yaml'), 'utf8')).toBe(original);
  });

  it('I-16: of two concurrent writers with the same expectedHash exactly one succeeds', async () => {
    await writeText(globalRoot, 'flows/standard.yaml', `${stringify(flowDef('standard'))}\n`);
    const original = await readFile(join(globalRoot, 'flows', 'standard.yaml'), 'utf8');
    const first = `${stringify(flowDef('standard', { name: 'Birinci' }))}\n`;
    const second = `${stringify(flowDef('standard', { name: 'İkinci' }))}\n`;

    const store = makeStore();
    const [a, b] = await Promise.all([
      store.writeFile(GLOBAL_SCOPE, 'flows/standard.yaml', first, hashContent(original)),
      store.writeFile(GLOBAL_SCOPE, 'flows/standard.yaml', second, hashContent(original)),
    ]);

    const outcomes = [a, b].sort((x, y) => (x.ok === y.ok ? 0 : x.ok ? 1 : -1));
    const winner = outcomes[1];
    expect(outcomes[0]).toEqual({ ok: false, error: 'stale' });
    if (winner === undefined || !winner.ok) throw new Error('expected exactly one writer to succeed');
    const onDisk = await readFile(join(globalRoot, 'flows', 'standard.yaml'), 'utf8');
    expect(onDisk === first || onDisk === second).toBe(true);
    expect(winner.value.hash).toBe(hashContent(onDisk));
  });

  it('I-16: the write goes through a temporary file in the same folder and leaves nothing behind', async () => {
    const store = makeStore();
    await store.writeFile(REPO_SCOPE, 'roles/planner.yaml', `${stringify(roleDef('planner'))}\n`, '');
    await store.writeFile(REPO_SCOPE, 'roles/planner.yaml', `${stringify(roleDef('planner', { active: false }))}\n`, hashContent(`${stringify(roleDef('planner'))}\n`));

    expect(await readdir(join(repoRoot, 'roles'))).toEqual(['planner.yaml']);
  });
});

// --- validateCandidate (I-17) -----------------------------------------------------------------------

describe('validateCandidate', () => {
  it('I-17: a target that is not a definition file is a wrong_type issue and nothing is touched', async () => {
    await seedLibrary(globalRoot);
    await writeYaml(repoRoot, 'workspace.yaml', repoDef());
    const before = {
      global: await snapshot(globalRoot),
      repo: await snapshot(repoRoot),
    };

    const result = await makeStore().validateCandidate(REPO_SCOPE, '../../etc/passwd', 'id: evil');

    expect(result).toEqual({
      ok: false,
      error: [{ path: '../../etc/passwd', code: 'wrong_type', message: 'not a definition file' }],
    });
    expect(await snapshot(globalRoot)).toEqual(before.global);
    expect(await snapshot(repoRoot)).toEqual(before.repo);
  });

  it('I-17: a valid repo-scope candidate validates the definitions as they would be, writing nothing', async () => {
    await seedLibrary(globalRoot);
    await writeYaml(repoRoot, 'workspace.yaml', repoDef());
    const before = { global: await snapshot(globalRoot), repo: await snapshot(repoRoot) };
    const candidate = `${stringify({ ...BUILTIN_FLOWS[0], name: 'Standart — aday' })}\n`;

    const result = await makeStore().validateCandidate(REPO_SCOPE, 'flows/standard.yaml', candidate);

    expect(result.ok).toBe(true);
    expect(await snapshot(globalRoot)).toEqual(before.global);
    expect(await snapshot(repoRoot)).toEqual(before.repo);
  });

  it('I-17: a repo-scope candidate replaces the target in memory, so issues point at the merged position', async () => {
    await writeYaml(globalRoot, 'flows/standard.yaml', flowDef('standard'));
    await writeYaml(repoRoot, 'workspace.yaml', repoDef());
    const candidate = stringify({
      id: 'standard',
      name: 'Kırık',
      stages: [{ id: 'plan', name: 'Plan', role: 'ghost-role', exit: [] }],
    });

    const result = await makeStore().validateCandidate(REPO_SCOPE, 'flows/standard.yaml', candidate);

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error).toContainEqual({
      path: 'flows[0].stages[0].role',
      code: 'unknown_role',
      message: expect.any(String),
    });
  });

  it('I-17: a global-scope candidate is validated against the global files alone', async () => {
    await writeYaml(globalRoot, 'roles/analyst.yaml', roleDef('analyst'));
    await writeYaml(globalRoot, 'roles/planner.yaml', roleDef('planner'));
    // A broken workspace.yaml and a repo-only role file: neither may enter global validation.
    await writeYaml(repoRoot, 'workspace.yaml', repoDef({ defaultFlow: 'missing-flow' }));
    await writeYaml(repoRoot, 'roles/extra.yaml', roleDef('extra', { capabilities: ['nope'] }));

    const store = makeStore();
    const valid = await store.validateCandidate(GLOBAL_SCOPE, 'roles/planner.yaml', `${stringify(roleDef('planner'))}\n`);
    const broken = await store.validateCandidate(
      GLOBAL_SCOPE,
      'roles/zzz.yaml',
      `${stringify(roleDef('zzz', { capabilities: ['nope'] }))}\n`,
    );

    expect(valid.ok).toBe(true);
    // Position 2 = [analyst, planner, zzz]; the repo-only 'extra' never merged in.
    expect(broken.ok).toBe(false);
    if (broken.ok) return;
    expect(broken.error).toContainEqual({
      path: 'roles[2].capabilities[0]',
      code: 'unknown_capability',
      message: expect.any(String),
    });
  });

  it('I-17: a candidate that is unparsable or not a mapping is a wrong_type file problem', async () => {
    await writeYaml(repoRoot, 'workspace.yaml', repoDef());

    const unparsable = await makeStore().validateCandidate(REPO_SCOPE, 'roles/planner.yaml', 'a: [unclosed');
    const nonMapping = await makeStore().validateCandidate(REPO_SCOPE, 'roles/planner.yaml', '- 1\n');

    expect(unparsable.ok).toBe(false);
    if (unparsable.ok) return;
    expect(unparsable.error).toEqual([
      { path: 'repo:roles/planner.yaml', code: 'wrong_type', message: expect.stringMatching(/^yaml: /) },
    ]);
    expect(nonMapping.ok).toBe(false);
  });

  it('I-17: a candidate whose id differs from the target stem is an invalid_slug file problem', async () => {
    await writeYaml(repoRoot, 'workspace.yaml', repoDef());

    const result = await makeStore().validateCandidate(
      REPO_SCOPE,
      'roles/planner.yaml',
      `${stringify(roleDef('other'))}\n`,
    );

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error).toEqual([
      { path: 'repo:roles/planner.yaml', code: 'invalid_slug', message: 'id does not match file name' },
    ]);
  });

  it('I-17: a roadmap.yaml candidate runs validateRoadmap with issues mapped onto the roadmap. prefix', async () => {
    await writeYaml(repoRoot, 'workspace.yaml', repoDef());
    const invalid = stringify({
      phases: [{ id: '-bad', name: 'Kötü', blockedBy: [], tasks: [] }],
    });

    const store = makeStore();
    const valid = await store.validateCandidate(REPO_SCOPE, 'roadmap.yaml', `${stringify(roadmapDef())}\n`);
    const broken = await store.validateCandidate(REPO_SCOPE, 'roadmap.yaml', invalid);
    const unparsable = await store.validateCandidate(REPO_SCOPE, 'roadmap.yaml', 'phases: [oops');

    expect(valid.ok).toBe(true);
    expect(broken.ok).toBe(false);
    if (broken.ok) return;
    expect(broken.error).toEqual([
      {
        path: 'roadmap.phases[0].id',
        code: 'wrong_type',
        message: expect.stringMatching(/^invalid_slug: /),
      },
    ]);
    expect(unparsable.ok).toBe(false);
  });

  it('I-17: a repo-scope candidate for an unknown repo reports the missing repo', async () => {
    const result = await makeStore().validateCandidate(
      UNKNOWN_REPO_SCOPE,
      'roles/planner.yaml',
      `${stringify(roleDef('planner'))}\n`,
    );

    expect(result).toEqual({
      ok: false,
      error: [{ path: 'repo', code: 'missing_field', message: expect.any(String) }],
    });
  });
});

// --- repoPath (I-18) ---------------------------------------------------------------------------

describe('repoPath', () => {
  it('I-18: returns RepoPaths.path for the repo', async () => {
    const store = makeStore();

    expect(await store.repoPath(REPO)).toBe(repoPath);
    expect(await store.repoPath(UNKNOWN_REPO)).toBeUndefined();
  });
});
