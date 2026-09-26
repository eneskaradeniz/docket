import { describe, expect, it } from 'vitest';

import type { Definitions } from '../../../domain/index';
import { parseSlug, type WorkspaceSlug } from '../../../domain/index';

import type { DefinitionScope } from '../definition-store';

import { createFakeDefinitionStore, FAKE_ROADMAP_TARGET } from './fake-definition-store';

const wsSlug = (s: string): WorkspaceSlug => {
  const parsed = parseSlug<'workspace'>(s);
  if (!parsed.ok) throw new Error('fixture slug must parse');
  return parsed.value;
};

const WS_SLUG: WorkspaceSlug = wsSlug('acme');
const GLOBAL: DefinitionScope = { kind: 'global' };
const WS: DefinitionScope = { kind: 'workspace', workspace: WS_SLUG };

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

const roadmapFile = JSON.stringify({
  phases: [
    {
      id: 'p1',
      name: 'Phase 1',
      blockedBy: [],
      tasks: [{ id: 't1', title: 'Task 1', dependsOn: [], acceptance: [] }],
    },
  ],
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
    store.seed(WS, 'roles/b.json', implementerFile('Same'));

    const a = await store.readFile(GLOBAL, 'roles/a.json');
    const b = await store.readFile(WS, 'roles/b.json');
    expect(a?.hash).toBe(b?.hash);
  });

  it('A-2: load merges global definitions with the workspace’s, workspace ids overriding global ids of the same kind', async () => {
    const store = createFakeDefinitionStore();
    store.seed(GLOBAL, 'roles/implementer.json', implementerFile('Global implementer'));
    store.seed(GLOBAL, 'flows/standard.json', flowFile('Global standard'));
    store.seed(GLOBAL, 'capabilities/docs.json', capabilityFile);
    store.seed(WS, 'roles/implementer.json', implementerFile('Workspace implementer'));
    store.seed(WS, 'roles/reviewer.json', reviewerFile);
    store.seed(WS, 'flows/standard.json', flowFile('Workspace standard'));

    const loaded = await store.load(WS_SLUG);
    expect(loaded.ok).toBe(true);
    if (!loaded.ok) throw new Error('load must succeed');
    expect(rolesOf(loaded.value)).toEqual([
      ['implementer', 'Workspace implementer'],
      ['reviewer', 'Reviewer'],
    ]);
    expect(loaded.value.flows.map((flow) => flow.name)).toEqual(['Workspace standard']);
    expect(loaded.value.capabilities.map((capability) => capability.id)).toEqual(['docs']);
  });

  it('load keeps another workspace’s overrides out', async () => {
    const store = createFakeDefinitionStore();
    store.seed(GLOBAL, 'roles/implementer.json', implementerFile('Global implementer'));
    const other = wsSlug('other');
    store.seed({ kind: 'workspace', workspace: other }, 'roles/implementer.json', implementerFile('Other implementer'));

    const loaded = await store.load(WS_SLUG);
    expect(loaded.ok).toBe(true);
    if (loaded.ok) expect(rolesOf(loaded.value)).toEqual([['implementer', 'Global implementer']]);
  });

  it('load reports issues for invalid definitions and writes nothing', async () => {
    const store = createFakeDefinitionStore();
    store.seed(GLOBAL, 'roles/implementer.json', implementerFile('Implementer'));
    store.seed(GLOBAL, 'flows/standard.json', flowFile('Standard'));
    store.seed(WS, 'roles/broken.json', JSON.stringify({ roles: [{ id: 'reviewer', name: 'Reviewer' }] }));

    const loaded = await store.load(WS_SLUG);
    expect(loaded.ok).toBe(false);
    if (!loaded.ok) expect(loaded.error.length).toBeGreaterThan(0);
  });

  it('load reports an issue for malformed file content', async () => {
    const store = createFakeDefinitionStore();
    store.seed(GLOBAL, 'roles/broken.json', 'not-json{');

    const loaded = await store.load(WS_SLUG);
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

    const workspaceScoped = await store.validateCandidate(WS, 'roles/reviewer.json', reviewerFile);
    expect(workspaceScoped.ok).toBe(true);
    expect(await store.readFile(WS, 'roles/reviewer.json')).toBeUndefined();
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

  it('loadRoadmap is undefined when no roadmap file exists', async () => {
    const store = createFakeDefinitionStore();
    store.seed(GLOBAL, 'roles/implementer.json', implementerFile('Implementer'));

    expect(await store.loadRoadmap(WS_SLUG)).toBeUndefined();
  });

  it('loadRoadmap returns the workspace roadmap, falling back to the global one', async () => {
    const store = createFakeDefinitionStore();
    store.seed(GLOBAL, FAKE_ROADMAP_TARGET, roadmapFile);
    const globalOnly = await store.loadRoadmap(WS_SLUG);
    expect(globalOnly?.ok).toBe(true);

    const otherTasks = JSON.stringify({
      phases: [
        { id: 'p1', name: 'Phase 1', blockedBy: [], tasks: [{ id: 't9', title: 'Task 9', dependsOn: [], acceptance: [] }] },
      ],
    });
    store.seed(WS, FAKE_ROADMAP_TARGET, otherTasks);
    const workspaceWins = await store.loadRoadmap(WS_SLUG);
    expect(workspaceWins?.ok).toBe(true);
    if (workspaceWins?.ok) expect(workspaceWins.value.phases[0]?.tasks[0]?.id).toBe('t9');
  });

  it('loadRoadmap reports issues for an invalid roadmap', async () => {
    const store = createFakeDefinitionStore();
    store.seed(WS, FAKE_ROADMAP_TARGET, invalidRoadmapFile);

    const loaded = await store.loadRoadmap(WS_SLUG);
    expect(loaded?.ok).toBe(false);
    if (loaded && !loaded.ok) expect(loaded.error.length).toBeGreaterThan(0);
  });

  it('workspacePath reports a deterministic path per workspace and honours setWorkspacePath', async () => {
    const store = createFakeDefinitionStore();
    const other = wsSlug('other');

    const a1 = await store.workspacePath(WS_SLUG);
    const a2 = await store.workspacePath(WS_SLUG);
    expect(a1).toBe(a2);
    expect(await store.workspacePath(other)).not.toBe(a1);

    store.setWorkspacePath(WS_SLUG, '/custom/checkout');
    expect(await store.workspacePath(WS_SLUG)).toBe('/custom/checkout');
    store.setWorkspacePath(WS_SLUG, undefined);
    expect(await store.workspacePath(WS_SLUG)).toBeUndefined();
  });
});
