// Tests for the one-time legacy import (I-90; I-86 never-opens arm, I-91 rename arm, R-134 import-only
// reading arm). Real files in fs.mkdtemp folders only.
import { createHash } from 'node:crypto';
import { mkdir, mkdtemp, readdir, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { parse, stringify } from 'yaml';

import type { DefinitionStore } from '../../../application/index';
import type { RepoSlug } from '../../../domain/index';
import { BUILTIN_FLOWS, BUILTIN_ROLES } from '../../../domain/index';

import { createLegacyImporter } from './legacy-import';
import { createYamlDefinitionStore } from './store';

let globalRoot = '';
let repoRoot = '';
let store: DefinitionStore;

beforeEach(async () => {
  globalRoot = await mkdtemp(join(tmpdir(), 'docket-legacy-root-'));
  repoRoot = await mkdtemp(join(tmpdir(), 'docket-legacy-repo-'));
  store = createYamlDefinitionStore({ globalRoot });
  await store.installBuiltins({ roles: BUILTIN_ROLES, flows: BUILTIN_FLOWS });
});

afterEach(async () => {
  await rm(globalRoot, { recursive: true, force: true });
  await rm(repoRoot, { recursive: true, force: true });
});

const writeYaml = async (root: string, target: string, value: unknown): Promise<void> => {
  const file = join(root, target);
  await mkdir(dirname(file), { recursive: true });
  await writeFile(file, `${stringify(value)}\n`, 'utf8');
};

const projectYaml = (overrides: Record<string, unknown> = {}): unknown => ({
  id: 'atolye',
  name: 'Atölye',
  mainRepo: 'web',
  repos: ['web', 'api'],
  ...overrides,
});

const repoYaml = (overrides: Record<string, unknown> = {}): unknown => ({
  id: 'web',
  name: 'Web',
  flows: ['standard'],
  defaultFlow: 'standard',
  commandSets: { tests: ['npm test'] },
  roleOverrides: [{ id: 'developer', instructions: 'Küçük adımlarla ilerle.' }],
  docsRoot: 'docs',
  testGlobs: ['**/*.test.ts'],
  ...overrides,
});

const roadmapYaml = (): unknown => ({
  phases: [
    {
      id: 'phase-1',
      name: 'Birinci aşama',
      blockedBy: [],
      tasks: [{ id: 'task-1', title: 'İş', dependsOn: [], acceptance: ['kabul'] }],
    },
  ],
});

const seedLegacy = async (parts: { project?: unknown; repo?: unknown; roadmap?: unknown } = {}): Promise<void> => {
  await writeYaml(repoRoot, '.docket/project.yaml', parts.project ?? projectYaml());
  await writeYaml(repoRoot, '.docket/repo.yaml', parts.repo ?? repoYaml());
  await writeYaml(repoRoot, '.docket/roadmap.yaml', parts.roadmap ?? roadmapYaml());
};

const importer = () => createLegacyImporter({ globalRoot, store });

const readStored = async (target: string): Promise<Record<string, unknown>> =>
  parse(await readFile(join(globalRoot, target), 'utf8')) as Record<string, unknown>;

/** Every file under a folder with its content hash — the byte-identity probe. */
const snapshot = async (folder: string, prefix = ''): Promise<Record<string, string>> => {
  const result: Record<string, string> = {};
  for (const entry of await readdir(folder, { withFileTypes: true })) {
    const name = `${prefix}${entry.name}`;
    if (entry.isDirectory()) Object.assign(result, await snapshot(join(folder, entry.name), `${name}/`));
    else result[name] = createHash('sha256').update(await readFile(join(folder, entry.name))).digest('hex');
  }
  return result;
};

describe('importLegacyRepo', () => {
  it('I-90: importLegacyRepo maps legacy project/repo/roadmap onto the new shapes with warnings', async () => {
    await seedLegacy();
    await writeYaml(repoRoot, '.docket/roles/custom.yaml', {
      id: 'custom', name: 'Özel', instructions: 'x', writeScope: { kind: 'none' }, capabilities: [], active: true,
    });

    const result = await importer().importLegacyRepo(repoRoot);

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.renames).toEqual([]);
    // The project-level default is dropped and reported by name.
    expect(result.value.warnings.some((warning) => warning.includes('roles') && warning.includes('custom'))).toBe(true);

    const repo = await readStored('repos/web/repo.yaml');
    expect(repo['id']).toBe('web');
    expect(repo['defaultLimitPolicy']).toBe('wait_resume');
    expect(repo['commandSets']).toEqual({ tests: ['npm test'] });
    const flow = repo['flow'] as { flowId: string; version: number; stages: { id: string; role: string | null }[]; bindings: Record<string, unknown>[] };
    const standard = BUILTIN_FLOWS.find((candidate) => candidate.id === 'standard');
    expect(flow.flowId).toBe('standard');
    expect(flow.version).toBe(1);
    expect(flow.stages.map((stage) => stage.id)).toEqual(standard?.stages.map((stage) => stage.id));
    // Exactly one binding per stage, same order; human-only stages carry no role.
    expect(flow.bindings.map((binding) => binding['stage'])).toEqual(flow.stages.map((stage) => stage.id));
    const developerBinding = flow.bindings.find((binding) => (binding['role'] as { roleId?: string } | undefined)?.roleId === 'developer');
    expect(developerBinding?.['role']).toEqual({
      roleId: 'developer',
      version: 1,
      overlay: { instructions: 'Küçük adımlarla ilerle.' },
    });
    expect(developerBinding?.['accounts']).toEqual([]);
    for (const binding of flow.bindings.filter((candidate) => !('role' in candidate))) {
      expect(flow.stages.find((stage) => stage.id === binding['stage'])?.role).toBeNull();
    }

    const project = await readStored('projects/atolye/project.yaml');
    expect(project).toMatchObject({ id: 'atolye', name: 'Atölye', repos: ['web', 'api'] });
    expect(await readStored('projects/atolye/roadmap.yaml')).toEqual(roadmapYaml());
  });

  it('R-134: flows/defaultFlow/roleOverrides are never written, only read by the import', async () => {
    await seedLegacy();
    const result = await importer().importLegacyRepo(repoRoot);
    expect(result.ok).toBe(true);
    const repo = await readStored('repos/web/repo.yaml');
    expect('flows' in repo).toBe(false);
    expect('defaultFlow' in repo).toBe(false);
    expect('roleOverrides' in repo).toBe(false);
  });

  it('I-90: the import only reads — the repo\'s .docket is byte-identical afterwards', async () => {
    await seedLegacy();
    await writeYaml(repoRoot, '.docket/flows/extra.yaml', { id: 'extra', name: 'Extra', stages: [] });
    const before = await snapshot(join(repoRoot, '.docket'));
    const names = await readdir(repoRoot);

    await importer().importLegacyRepo(repoRoot);

    expect(await snapshot(join(repoRoot, '.docket'))).toEqual(before);
    expect(await readdir(repoRoot)).toEqual(names);
  });

  it('I-87: the import writes nothing into the repo folder — only the global root gains files', async () => {
    await seedLegacy();
    const before = await snapshot(repoRoot);
    const rootBefore = await snapshot(globalRoot);

    const result = await importer().importLegacyRepo(repoRoot);

    expect(result.ok).toBe(true);
    expect(await snapshot(repoRoot)).toEqual(before);
    expect(Object.keys(await snapshot(globalRoot)).length).toBeGreaterThan(Object.keys(rootBefore).length);
  });

  it('I-91: an imported id that exists is renamed -2/-3 and listed in the report', async () => {
    await seedLegacy();
    const first = await importer().importLegacyRepo(repoRoot);
    expect(first.ok && first.value.renames).toEqual([]);

    const second = await importer().importLegacyRepo(repoRoot);
    expect(second.ok && second.value.renames).toEqual([
      { id: 'web', to: 'web-2' },
      { id: 'atolye', to: 'atolye-2' },
    ]);
    const third = await importer().importLegacyRepo(repoRoot);
    expect(third.ok && third.value.renames).toEqual([
      { id: 'web', to: 'web-3' },
      { id: 'atolye', to: 'atolye-3' },
    ]);

    // The first import's files were never overwritten; the renamed project lists the renamed repo.
    expect((await readStored('repos/web/repo.yaml'))['id']).toBe('web');
    expect((await readStored('repos/web-2/repo.yaml'))['id']).toBe('web-2');
    expect(await readStored('projects/atolye-2/project.yaml')).toMatchObject({
      id: 'atolye-2',
      mainRepo: 'web-2',
      repos: ['web-2', 'api'],
    });
  });

  it('I-90: an invalid legacy folder writes nothing and answers every issue', async () => {
    await seedLegacy({ repo: repoYaml({ defaultFlow: 'ghost-flow' }), roadmap: { phases: 'nope' } });
    const result = await importer().importLegacyRepo(repoRoot);
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.length).toBeGreaterThanOrEqual(2);
    expect(await store.readFile('repos/web/repo.yaml')).toBeUndefined();
    expect(await store.readFile('projects/atolye/project.yaml')).toBeUndefined();
  });

  it('I-90: a folder without a legacy .docket answers an issue and writes nothing', async () => {
    const result = await importer().importLegacyRepo(repoRoot);
    expect(result.ok).toBe(false);
    expect(await store.readFile('repos/web/repo.yaml')).toBeUndefined();
  });

  it('I-90: roleOverrides, extra flows and an inactive flag the new model has no home for are reported', async () => {
    await seedLegacy({
      repo: repoYaml({
        flows: ['standard', 'hotfix'],
        roleOverrides: [{ id: 'documenter', active: false }, { id: 'developer', instructions: 'ok' }],
      }),
    });
    await writeYaml(repoRoot, '.docket/flows/hotfix.yaml', {
      id: 'hotfix', name: 'Hotfix', stages: [{ id: 'fix', name: 'Fix', role: 'developer', exit: [] }],
    });
    const result = await importer().importLegacyRepo(repoRoot);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.warnings.some((warning) => warning.includes('hotfix'))).toBe(true);
    expect(result.value.warnings.some((warning) => warning.includes('documenter'))).toBe(true);
  });
});

describe('the store never opens a repo-side .docket', () => {
  it('I-86: the store never opens <repo>/.docket outside the one-time import', async () => {
    await seedLegacy();
    // A valid legacy repo.yaml sits in the checkout; the store, rooted under the global root,
    // neither loads nor reads it, however the repo is named.
    const loaded = await store.load('web' as RepoSlug);
    expect(loaded.ok).toBe(false);
    expect(await store.readFile('repos/web/repo.yaml')).toBeUndefined();
    expect(await store.readFile(join(repoRoot, '.docket/repo.yaml'))).toBeUndefined();
    expect(await store.loadRoadmap('atolye' as never)).toBeUndefined();
  });
});
