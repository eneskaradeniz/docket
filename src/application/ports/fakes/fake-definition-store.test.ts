import { describe, expect, it } from 'vitest';

import type { CapabilityDef, Definitions, ProjectSlug } from '../../../domain/index';
import { parseSlug, type CapabilitySlug, type RepoSlug } from '../../../domain/index';

import type { DefinitionScope } from '../definition-store';

import { createFakeDefinitionStore, FAKE_ROADMAP_TARGET } from './fake-definition-store';

const toCapSlug = (s: string): CapabilitySlug => {
  const parsed = parseSlug<'capability'>(s);
  if (!parsed.ok) throw new Error('fixture slug must parse');
  return parsed.value;
};

const toSlug = (s: string): RepoSlug => {
  const parsed = parseSlug<'repo'>(s);
  if (!parsed.ok) throw new Error('fixture slug must parse');
  return parsed.value;
};

const toProjectSlug = (s: string): ProjectSlug => {
  const parsed = parseSlug<'project'>(s);
  if (!parsed.ok) throw new Error('fixture slug must parse');
  return parsed.value;
};

const REPO_SLUG: RepoSlug = toSlug('acme');
const PROJECT_SLUG: ProjectSlug = toProjectSlug('atolye');
const GLOBAL: DefinitionScope = { kind: 'global' };
const PROJECT: DefinitionScope = { kind: 'project', project: PROJECT_SLUG };
const REPO: DefinitionScope = { kind: 'repo', repo: REPO_SLUG };

const implementerFile = (name: string): string =>
  JSON.stringify({
    roles: [
      {
        id: 'implementer',
        name,
        instructions: 'implement the task',
        writeScope: { kind: 'repo' },
        capabilities: [],
        active: true,
      },
    ],
  });

const reviewerFile = JSON.stringify({
  roles: [
    {
      id: 'reviewer',
      name: 'Reviewer',
      instructions: 'review the change',
      writeScope: { kind: 'none' },
      capabilities: [],
      active: true,
    },
  ],
});

const flowFile = (name: string): string =>
  JSON.stringify({
    flows: [
      {
        id: 'standard',
        name,
        stages: [{ id: 'implement', name: 'Implement', role: 'implementer', exit: [] }],
      },
    ],
  });

const capabilityFile = JSON.stringify({
  capabilities: [{ kind: 'context', id: 'docs', name: 'Docs', path: 'docs' }],
});

const invalidRoadmapFile = JSON.stringify({
  phases: [
    {
      id: 'p1',
      name: 'Phase 1',
      blockedBy: [],
      tasks: [{ id: 't1', title: 'Task 1', dependsOn: ['missing-task'], acceptance: [] }],
    },
  ],
});

const rolesOf = (loaded: Definitions): readonly (readonly [string, string])[] =>
  loaded.roles.map((role) => [role.id, role.name] as const);

describe('createFakeDefinitionStore', () => {
  it('A-4: writeFile creates a file when expectedHash is "" and the target is absent', async () => {
    const store = createFakeDefinitionStore();

    const written = await store.writeFile(GLOBAL, 'roles/implementer.json', implementerFile('Implementer'), '');
    expect(written.ok).toBe(true);

    const file = await store.readFile(GLOBAL, 'roles/implementer.json');
    expect(file?.content).toBe(implementerFile('Implementer'));
    expect(typeof file?.hash).toBe('string');
    expect(file?.hash.length).toBeGreaterThan(0);
  });

  it('A-4: writeFile succeeds with the current hash and reports the new hash', async () => {
    const store = createFakeDefinitionStore();
    const first = await store.writeFile(GLOBAL, 'roles/implementer.json', implementerFile('One'), '');
    if (!first.ok) throw new Error('first write must succeed');

    const second = await store.writeFile(GLOBAL, 'roles/implementer.json', implementerFile('Two'), first.value.hash);
    expect(second.ok).toBe(true);
    if (second.ok) expect(second.value.hash).not.toBe(first.value.hash);

    const file = await store.readFile(GLOBAL, 'roles/implementer.json');
    expect(file?.content).toBe(implementerFile('Two'));
    expect(file?.hash).toBe(second.ok ? second.value.hash : '');
  });

  it('A-4: writeFile returns err("stale") for a wrong expected hash, for "" on an existing file, and for an outdated hash', async () => {
    const store = createFakeDefinitionStore();
    const absent = await store.writeFile(GLOBAL, 'roles/implementer.json', implementerFile('One'), 'deadbeef');
    expect(absent.ok).toBe(false);
    if (!absent.ok) expect(absent.error).toBe('stale');

    const created = await store.writeFile(GLOBAL, 'roles/implementer.json', implementerFile('One'), '');
    if (!created.ok) throw new Error('write must succeed');

    const emptyOnExisting = await store.writeFile(GLOBAL, 'roles/implementer.json', implementerFile('Two'), '');
    expect(emptyOnExisting.ok).toBe(false);
    if (!emptyOnExisting.ok) expect(emptyOnExisting.error).toBe('stale');

    const updated = await store.writeFile(GLOBAL, 'roles/implementer.json', implementerFile('Two'), created.value.hash);
    if (!updated.ok) throw new Error('write must succeed');

    const outdated = await store.writeFile(GLOBAL, 'roles/implementer.json', implementerFile('Three'), created.value.hash);
    expect(outdated.ok).toBe(false);
    if (!outdated.ok) expect(outdated.error).toBe('stale');
    expect((await store.readFile(GLOBAL, 'roles/implementer.json'))?.content).toBe(implementerFile('Two'));
  });

  it('equal content produces the same hash in every scope and target', async () => {
    const store = createFakeDefinitionStore();
    store.seed(GLOBAL, 'roles/a.json', implementerFile('Same'));
    store.seed(REPO, 'roles/b.json', implementerFile('Same'));

    const a = await store.readFile(GLOBAL, 'roles/a.json');
    const b = await store.readFile(REPO, 'roles/b.json');
    expect(a?.hash).toBe(b?.hash);
  });

  it('A-2: load merges global definitions with the repo’s, repo ids overriding global ids of the same kind', async () => {
    const store = createFakeDefinitionStore();
    store.seed(GLOBAL, 'roles/implementer.json', implementerFile('Global implementer'));
    store.seed(GLOBAL, 'flows/standard.json', flowFile('Global standard'));
    store.seed(GLOBAL, 'capabilities/docs.json', capabilityFile);
    store.seed(REPO, 'roles/implementer.json', implementerFile('Repo implementer'));
    store.seed(REPO, 'roles/reviewer.json', reviewerFile);
    store.seed(REPO, 'flows/standard.json', flowFile('Repo standard'));

    const loaded = await store.load(REPO_SLUG);
    expect(loaded.ok).toBe(true);
    if (!loaded.ok) throw new Error('load must succeed');
    expect(rolesOf(loaded.value)).toEqual([
      ['implementer', 'Repo implementer'],
      ['reviewer', 'Reviewer'],
    ]);
    expect(loaded.value.flows.map((flow) => flow.name)).toEqual(['Repo standard']);
    expect(loaded.value.capabilities.map((capability) => capability.id)).toEqual(['docs']);
  });

  it('load keeps another repo’s overrides out', async () => {
    const store = createFakeDefinitionStore();
    store.seed(GLOBAL, 'roles/implementer.json', implementerFile('Global implementer'));
    const other = toSlug('other');
    store.seed({ kind: 'repo', repo: other }, 'roles/implementer.json', implementerFile('Other implementer'));

    const loaded = await store.load(REPO_SLUG);
    expect(loaded.ok).toBe(true);
    if (loaded.ok) expect(rolesOf(loaded.value)).toEqual([['implementer', 'Global implementer']]);
  });

  it('load reports issues for invalid definitions and writes nothing', async () => {
    const store = createFakeDefinitionStore();
    store.seed(GLOBAL, 'roles/implementer.json', implementerFile('Implementer'));
    store.seed(GLOBAL, 'flows/standard.json', flowFile('Standard'));
    store.seed(REPO, 'roles/broken.json', JSON.stringify({ roles: [{ id: 'reviewer', name: 'Reviewer' }] }));

    const loaded = await store.load(REPO_SLUG);
    expect(loaded.ok).toBe(false);
    if (!loaded.ok) expect(loaded.error.length).toBeGreaterThan(0);
  });

  it('load reports an issue for malformed file content', async () => {
    const store = createFakeDefinitionStore();
    store.seed(GLOBAL, 'roles/broken.json', 'not-json{');

    const loaded = await store.load(REPO_SLUG);
    expect(loaded.ok).toBe(false);
    if (!loaded.ok) expect(loaded.error.length).toBeGreaterThan(0);
  });

  it('validateCandidate validates the definitions as they would be with the candidate, and writes nothing', async () => {
    const store = createFakeDefinitionStore();
    store.seed(GLOBAL, 'roles/implementer.json', implementerFile('Implementer'));
    store.seed(GLOBAL, 'flows/standard.json', flowFile('Standard'));

    const added = await store.validateCandidate(GLOBAL, 'roles/reviewer.json', reviewerFile);
    expect(added.ok).toBe(true);
    if (added.ok) expect(added.value).toBeUndefined();
    expect(await store.readFile(GLOBAL, 'roles/reviewer.json')).toBeUndefined();

    const replaced = await store.validateCandidate(GLOBAL, 'roles/implementer.json', implementerFile('Replaced'));
    expect(replaced.ok).toBe(true);
    expect((await store.readFile(GLOBAL, 'roles/implementer.json'))?.content).toBe(implementerFile('Implementer'));

    const repoScoped = await store.validateCandidate(REPO, 'roles/reviewer.json', reviewerFile);
    expect(repoScoped.ok).toBe(true);
    expect(await store.readFile(REPO, 'roles/reviewer.json')).toBeUndefined();
  });

  it('validateCandidate reports the issues the candidate would introduce', async () => {
    const store = createFakeDefinitionStore();
    store.seed(GLOBAL, 'roles/implementer.json', implementerFile('Implementer'));

    const unknownCapability = await store.validateCandidate(
      GLOBAL,
      'roles/implementer.json',
      JSON.stringify({
        roles: [
          {
            id: 'implementer',
            name: 'Implementer',
            instructions: 'implement the task',
            writeScope: { kind: 'repo' },
            capabilities: ['missing-capability'],
            active: true,
          },
        ],
      }),
    );
    expect(unknownCapability.ok).toBe(false);
    if (!unknownCapability.ok) expect(unknownCapability.error.length).toBeGreaterThan(0);
  });

  it('loadRoadmap is undefined for an unknown project and for a project without a roadmap', async () => {
    const store = createFakeDefinitionStore();
    store.seed(GLOBAL, 'roles/implementer.json', implementerFile('Implementer'));

    expect(await store.loadRoadmap(PROJECT_SLUG)).toBeUndefined();
    store.seed(PROJECT, 'roles/implementer.json', implementerFile('Implementer'));
    expect(await store.loadRoadmap(PROJECT_SLUG)).toBeUndefined();
  });

  it('loadRoadmap returns the project roadmap, validated against the project', async () => {
    const store = createFakeDefinitionStore();
    store.setProject({ id: PROJECT_SLUG, name: 'Atölye', mainRepo: REPO_SLUG, repos: [REPO_SLUG] });
    const targetsKnown = JSON.stringify({
      phases: [
        {
          id: 'p1',
          name: 'Phase 1',
          blockedBy: [],
          tasks: [{ id: 't9', title: 'Task 9', dependsOn: [], acceptance: [], targets: ['acme'] }],
        },
      ],
    });
    store.seed(PROJECT, FAKE_ROADMAP_TARGET, targetsKnown);
    const loaded = await store.loadRoadmap(PROJECT_SLUG);
    expect(loaded?.ok).toBe(true);
    if (loaded?.ok) expect(loaded.value.phases[0]?.tasks[0]?.targets).toEqual([REPO_SLUG]);
  });

  it('loadRoadmap reports issues for an invalid roadmap', async () => {
    const store = createFakeDefinitionStore();
    store.seed(PROJECT, FAKE_ROADMAP_TARGET, invalidRoadmapFile);

    const loaded = await store.loadRoadmap(PROJECT_SLUG);
    expect(loaded?.ok).toBe(false);
    if (loaded && !loaded.ok) expect(loaded.error.length).toBeGreaterThan(0);
  });

  it('readProjectAt classifies the project.yaml at a checkout path', async () => {
    const store = createFakeDefinitionStore();

    const absent = await store.readProjectAt('/checkouts/atolye');
    expect(absent.ok).toBe(false);
    if (!absent.ok) {
      expect(absent.error).toEqual([{ path: 'project.yaml', code: 'missing_field', message: 'project.yaml is required' }]);
    }

    store.seedProjectAt('/checkouts/atolye', JSON.stringify({ id: 'atolye', name: 'Atölye', mainRepo: 'acme', repos: ['acme'] }));
    const loaded = await store.readProjectAt('/checkouts/atolye');
    expect(loaded.ok).toBe(true);
    if (loaded.ok) expect(loaded.value).toEqual({ id: PROJECT_SLUG, name: 'Atölye', mainRepo: REPO_SLUG, repos: [REPO_SLUG] });

    store.seedProjectAt('/checkouts/broken', 'not-json{');
    const broken = await store.readProjectAt('/checkouts/broken');
    expect(broken.ok).toBe(false);
    if (!broken.ok) expect(broken.error[0]?.code).toBe('wrong_type');
  });

  it('load merges the project defaults of the repo owning project between global and repo', async () => {
    const store = createFakeDefinitionStore();
    store.setProject({ id: PROJECT_SLUG, name: 'Atölye', mainRepo: REPO_SLUG, repos: [REPO_SLUG] });
    store.seed(GLOBAL, 'roles/implementer.json', implementerFile('Global implementer'));
    store.seed(PROJECT, 'roles/implementer.json', JSON.stringify({
      roles: [{ id: 'reviewer', name: 'Project reviewer', instructions: 'review', writeScope: { kind: 'none' }, capabilities: [], active: false }],
    }));
    store.seed(REPO, 'roles/implementer.json', implementerFile('Repo implementer'));

    const loaded = await store.load(REPO_SLUG);
    expect(loaded.ok).toBe(true);
    if (loaded.ok) {
      const implementer = loaded.value.roles.find((role) => role.id === 'implementer');
      expect(implementer?.name).toBe('Repo implementer');
      expect(loaded.value.roles.some((role) => role.id === 'reviewer')).toBe(true);
    }
  });

  it('repoPath reports a deterministic path per repo and honours setRepoPath', async () => {
    const store = createFakeDefinitionStore();
    const other = toSlug('other');

    const a1 = await store.repoPath(REPO_SLUG);
    const a2 = await store.repoPath(REPO_SLUG);
    expect(a1).toBe(a2);
    expect(await store.repoPath(other)).not.toBe(a1);

    store.setRepoPath(REPO_SLUG, '/custom/checkout');
    expect(await store.repoPath(REPO_SLUG)).toBe('/custom/checkout');
    store.setRepoPath(REPO_SLUG, undefined);
    expect(await store.repoPath(REPO_SLUG)).toBeUndefined();
  });
});

// --- installCapabilities (the I-44 grammar, fake side) -------------------------------------------

describe('installCapabilities (fake)', () => {
  const GLOBAL: DefinitionScope = { kind: 'global' };
  const MCP: CapabilityDef = { kind: 'mcp', id: toCapSlug('db-tools'), name: 'Db Tools', command: 'npx db', args: [], env: {} };

  it('writes one bare definition per capabilities/<id>.yaml target and never overwrites an existing one', async () => {
    const store = createFakeDefinitionStore();
    expect(await store.installCapabilities([MCP])).toEqual({
      written: ['capabilities/db-tools.yaml'],
      skipped: [],
    });
    expect(await store.installCapabilities([MCP])).toEqual({
      written: [],
      skipped: ['capabilities/db-tools.yaml'],
    });
    const file = await store.readFile(GLOBAL, 'capabilities/db-tools.yaml');
    expect(JSON.parse(file?.content ?? 'null')).toEqual(MCP);
  });

  it('the bare file joins load and validateCandidate like any other capability body', async () => {
    const store = createFakeDefinitionStore();
    await store.installCapabilities([{ kind: 'mcp', id: toCapSlug('db'), name: 'Db', command: 'x', args: [], env: {} }]);
    const loaded = await store.load(REPO_SLUG);
    expect(loaded.ok).toBe(true);
    if (loaded.ok) expect(loaded.value.capabilities).toHaveLength(1);

    // The same grammar the import use case hands validateCandidate merges beside the installed file.
    const validated = await store.validateCandidate(
      GLOBAL,
      'capabilities/other.yaml',
      JSON.stringify({ kind: 'context', id: 'other', name: 'Other', path: '/x/other.md' }),
    );
    expect(validated.ok).toBe(true);
  });
});
