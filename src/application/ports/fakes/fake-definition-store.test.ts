import { describe, expect, it } from 'vitest';

import type { CapabilityDef, FlowSlug, ProjectSlug, RepoDef, RoleSlug, StageSlug } from '../../../domain/index';
import { parseSlug, type CapabilitySlug, type RepoSlug } from '../../../domain/index';

import { createFakeDefinitionStore } from './fake-definition-store';
import { repoFlowOf } from './repo-flow-fixture';

const toRoleSlug = (s: string): RoleSlug => {
  const parsed = parseSlug<'role'>(s);
  if (!parsed.ok) throw new Error('fixture slug must parse');
  return parsed.value;
};

const toFlowSlug = (s: string): FlowSlug => {
  const parsed = parseSlug<'flow'>(s);
  if (!parsed.ok) throw new Error('fixture slug must parse');
  return parsed.value;
};

const toStageSlug = (s: string): StageSlug => {
  const parsed = parseSlug<'stage'>(s);
  if (!parsed.ok) throw new Error('fixture slug must parse');
  return parsed.value;
};

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
const OTHER_REPO: RepoSlug = toSlug('other');
const PROJECT_SLUG: ProjectSlug = toProjectSlug('atolye');

const implementerRole = (name: string): string =>
  JSON.stringify({
    id: 'implementer',
    name,
    instructions: 'implement the task',
    writeScope: { kind: 'repo' },
    capabilities: [],
    active: true,
  });

const reviewerRole = JSON.stringify({
  id: 'reviewer',
  name: 'Reviewer',
  instructions: 'review the change',
  writeScope: { kind: 'none' },
  capabilities: [],
  active: true,
});

const standardFlow = (name: string): string =>
  JSON.stringify({
    id: 'standard',
    name,
    stages: [{ id: 'implement', name: 'Implement', role: 'implementer', exit: [] }],
  });

const capabilityBody = JSON.stringify({ kind: 'context', id: 'docs', name: 'Docs', path: 'docs' });

const STANDARD_FLOW_JSON = {
  id: 'standard',
  name: 'Standard',
  stages: [{ id: 'implement', name: 'Implement', role: 'implementer', exit: [] }],
};

const repoYaml = (overrides: Record<string, unknown> = {}): string =>
  JSON.stringify({
    id: 'acme',
    name: 'Acme',
    flow: repoFlowOf(STANDARD_FLOW_JSON),
    defaultLimitPolicy: 'wait_resume',
    commandSets: {},
    docsRoot: 'docs',
    testGlobs: [],
    ...overrides,
  });

const roadmapOf = (targets: readonly string[]): string =>
  JSON.stringify({
    phases: [
      {
        id: 'p1',
        name: 'Phase 1',
        blockedBy: [],
        tasks: [{ id: 't1', title: 'Task 1', dependsOn: [], targets, acceptance: [] }],
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

const projectYaml = JSON.stringify({ id: 'atolye', name: 'Atölye', repos: ['acme'] });

describe('createFakeDefinitionStore', () => {
  it('A-4: writeFile creates a file when expectedHash is "" and the target is absent', async () => {
    const store = createFakeDefinitionStore();

    const written = await store.writeFile(`repos/${REPO_SLUG}/repo.yaml`, repoYaml(), '');
    expect(written.ok).toBe(true);

    const file = await store.readFile(`repos/${REPO_SLUG}/repo.yaml`);
    expect(file?.content).toBe(repoYaml());
    expect(typeof file?.hash).toBe('string');
    expect(file?.hash.length).toBeGreaterThan(0);
  });

  it('A-4: writeFile succeeds with the current hash and reports the new hash', async () => {
    const store = createFakeDefinitionStore();
    const first = await store.writeFile(`repos/${REPO_SLUG}/repo.yaml`, repoYaml({ name: 'One' }), '');
    if (!first.ok) throw new Error('first write must succeed');

    const second = await store.writeFile(`repos/${REPO_SLUG}/repo.yaml`, repoYaml({ name: 'Two' }), first.value.hash);
    expect(second.ok).toBe(true);
    if (second.ok) expect(second.value.hash).not.toBe(first.value.hash);

    const file = await store.readFile(`repos/${REPO_SLUG}/repo.yaml`);
    expect(file?.content).toBe(repoYaml({ name: 'Two' }));
    expect(file?.hash).toBe(second.ok ? second.value.hash : '');
  });

  it('A-4: writeFile returns err("stale") for a wrong expected hash, for "" on an existing file, and for an outdated hash', async () => {
    const store = createFakeDefinitionStore();
    const absent = await store.writeFile(`repos/${REPO_SLUG}/repo.yaml`, repoYaml(), 'deadbeef');
    expect(absent.ok).toBe(false);
    if (!absent.ok) expect(absent.error).toBe('stale');

    const created = await store.writeFile(`repos/${REPO_SLUG}/repo.yaml`, repoYaml(), '');
    expect(created.ok).toBe(true);

    const again = await store.writeFile(`repos/${REPO_SLUG}/repo.yaml`, repoYaml(), '');
    expect(again.ok).toBe(false);
    const outdated = await store.writeFile(`repos/${REPO_SLUG}/repo.yaml`, repoYaml(), 'deadbeef');
    expect(outdated.ok).toBe(false);
  });

  it('a library version target is create-only — any second write is stale', async () => {
    const store = createFakeDefinitionStore();
    const created = await store.writeFile('library/roles/implementer/v1.yaml', implementerRole('Implementer'), '');
    expect(created.ok).toBe(true);
    const sameHash = await store.writeFile('library/roles/implementer/v1.yaml', implementerRole('Other'), created.ok ? created.value.hash : '');
    expect(sameHash).toEqual({ ok: false, error: 'stale' });
    const noHash = await store.writeFile('library/roles/implementer/v1.yaml', implementerRole('Other'), '');
    expect(noHash).toEqual({ ok: false, error: 'stale' });
    const file = await store.readFile('library/roles/implementer/v1.yaml');
    expect(file?.content).toBe(implementerRole('Implementer'));
  });

  it('equal content produces the same hash in every target', async () => {
    const store = createFakeDefinitionStore();
    const first = await store.writeFile(`repos/${REPO_SLUG}/repo.yaml`, repoYaml(), '');
    const second = await store.writeFile(`repos/${OTHER_REPO}/repo.yaml`, repoYaml(), '');
    expect(first.ok && second.ok && first.value.hash === second.value.hash).toBe(true);
  });

  it('A-2: load answers the library\'s current versions together with the repo\'s repo.yaml', async () => {
    const store = createFakeDefinitionStore();
    store.seed('library/roles/implementer/v1.yaml', implementerRole('Implementer'));
    store.seed('library/roles/implementer/v2.yaml', implementerRole('Implementer II'));
    store.seed('library/roles/reviewer/v1.yaml', reviewerRole);
    const twoStage = {
      id: 'standard',
      name: 'Standard',
      stages: [
        { id: 'implement', name: 'Implement', role: 'implementer', exit: [] },
        { id: 'review', name: 'Review', role: 'reviewer', exit: [] },
      ],
    };
    store.seed('library/flows/standard/v1.yaml', JSON.stringify(twoStage));
    const repoFlow = {
      flowId: 'standard',
      version: 1,
      stages: twoStage.stages,
      bindings: [
        { stage: 'implement', role: { roleId: 'implementer', version: 2 }, accounts: [] },
        { stage: 'review', role: { roleId: 'reviewer', version: 1 }, accounts: [] },
      ],
    };
    store.seed(`repos/${REPO_SLUG}/repo.yaml`, repoYaml({ flow: repoFlow }));

    const loaded = await store.load(REPO_SLUG);
    expect(loaded.ok).toBe(true);
    if (!loaded.ok) return;
    expect(loaded.value.roles.map((role) => [role.id, role.name])).toEqual([
      ['implementer', 'Implementer II'],
      ['reviewer', 'Reviewer'],
    ]);
    expect(loaded.value.flows.map((flow) => flow.id)).toEqual(['standard']);
    expect(loaded.value.repo?.id).toBe('acme');
  });

  it('load keeps another repo\'s file out', async () => {
    const store = createFakeDefinitionStore();
    store.seed('library/roles/implementer/v1.yaml', implementerRole('Implementer'));
    store.seed('library/roles/implementer/v1.yaml', implementerRole('Implementer'));
    store.seed('library/flows/standard/v1.yaml', standardFlow('Standard'));
    store.seed(`repos/${REPO_SLUG}/repo.yaml`, repoYaml());
    store.seed(`repos/${OTHER_REPO}/repo.yaml`, repoYaml({ id: 'other', flows: ['missing'] }));

    const loaded = await store.load(REPO_SLUG);
    expect(loaded.ok).toBe(true);
  });

  it('load answers a missing repo.yaml with the missing_field issue on path "repo"', async () => {
    const store = createFakeDefinitionStore();
    store.seed('library/roles/implementer/v1.yaml', implementerRole('Implementer'));
    expect(await store.load(REPO_SLUG)).toEqual({
      ok: false,
      error: [{ path: 'repo', code: 'missing_field', message: 'repo.yaml is required' }],
    });
  });

  it('load reports issues for invalid definitions and writes nothing', async () => {
    const store = createFakeDefinitionStore();
    store.seed('library/roles/implementer/v1.yaml', implementerRole('Implementer'));
    store.seed('library/flows/standard/v1.yaml', standardFlow('Standard'));
    store.seed(`repos/${REPO_SLUG}/repo.yaml`, repoYaml({ defaultFlow: 'missing' }));

    const loaded = await store.load(REPO_SLUG);
    expect(loaded.ok).toBe(false);
    if (loaded.ok) return;
    expect(loaded.error.some((issue) => issue.code === 'unknown_field')).toBe(true);
  });

  it('validateCandidate validates the definitions as they would be with the candidate, and writes nothing', async () => {
    const store = createFakeDefinitionStore();
    store.seed('library/roles/implementer/v1.yaml', implementerRole('Implementer'));
    store.seed('library/roles/implementer/v1.yaml', implementerRole('Implementer'));
    store.seed('library/flows/standard/v1.yaml', standardFlow('Standard'));

    const valid = await store.validateCandidate(`repos/${REPO_SLUG}/repo.yaml`, repoYaml());
    expect(valid.ok).toBe(true);
    expect(await store.readFile(`repos/${REPO_SLUG}/repo.yaml`)).toBeUndefined();
  });

  it('validateCandidate reports the issues the candidate would introduce', async () => {
    const store = createFakeDefinitionStore();
    store.seed('library/roles/implementer/v1.yaml', implementerRole('Implementer'));
    store.seed('library/flows/standard/v1.yaml', standardFlow('Standard'));

    const invalid = await store.validateCandidate(`repos/${REPO_SLUG}/repo.yaml`, repoYaml({ defaultFlow: 'missing' }));
    expect(invalid.ok).toBe(false);
    if (invalid.ok) return;
    expect(invalid.error.some((issue) => issue.code === 'unknown_field')).toBe(true);
  });

  it('a library version candidate validates standalone and its id must match the folder', async () => {
    const store = createFakeDefinitionStore();
    const valid = await store.validateCandidate('library/roles/implementer/v2.yaml', implementerRole('New'));
    expect(valid.ok).toBe(true);
    const wrongId = await store.validateCandidate('library/roles/implementer/v2.yaml', reviewerRole);
    expect(wrongId.ok).toBe(false);
    if (wrongId.ok) return;
    expect(wrongId.error[0]?.code).toBe('invalid_slug');
  });

  it('loadRoadmap is undefined for an unknown project and for a project without a roadmap', async () => {
    const store = createFakeDefinitionStore();
    expect(await store.loadRoadmap(PROJECT_SLUG)).toBeUndefined();
    store.setProject({ id: PROJECT_SLUG, name: 'Atölye', repos: [REPO_SLUG] });
    expect(await store.loadRoadmap(PROJECT_SLUG)).toBeUndefined();
  });

  it('loadRoadmap returns the project roadmap, validated against the project', async () => {
    const store = createFakeDefinitionStore();
    store.seed(`projects/${PROJECT_SLUG}/project.yaml`, projectYaml);
    store.seed(`projects/${PROJECT_SLUG}/roadmap.yaml`, roadmapOf(['acme']));

    const roadmap = await store.loadRoadmap(PROJECT_SLUG);
    expect(roadmap !== undefined && roadmap.ok).toBe(true);
    if (roadmap === undefined || roadmap.ok) return;
    expect(roadmap.error).toEqual([]);
  });

  it('loadRoadmap reports issues for an invalid roadmap', async () => {
    const store = createFakeDefinitionStore();
    store.setProject({ id: PROJECT_SLUG, name: 'Atölye', repos: [REPO_SLUG] });
    store.seed(`projects/${PROJECT_SLUG}/roadmap.yaml`, invalidRoadmapFile);

    const roadmap = await store.loadRoadmap(PROJECT_SLUG);
    expect(roadmap !== undefined && !roadmap.ok).toBe(true);
    if (roadmap === undefined || roadmap.ok) return;
    expect(roadmap.error.length).toBeGreaterThan(0);
  });

  it('a seeded project.yaml joins the roadmap context through the file world too', async () => {
    const store = createFakeDefinitionStore();
    store.seed(`projects/${PROJECT_SLUG}/project.yaml`, projectYaml);
    store.seed(`projects/${PROJECT_SLUG}/roadmap.yaml`, roadmapOf(['ghost']));

    const roadmap = await store.loadRoadmap(PROJECT_SLUG);
    expect(roadmap !== undefined && !roadmap.ok).toBe(true);
  });

  it('installBuiltins writes one v1 target per definition and never touches an existing history', async () => {
    const store = createFakeDefinitionStore();
    const role = { id: toRoleSlug('implementer'), name: 'Implementer', instructions: 'x', writeScope: { kind: 'none' as const }, capabilities: [], active: true };
    const flow = { id: toFlowSlug('standard'), name: 'Standard', stages: [{ id: toStageSlug('implement'), name: 'Implement', role: null, exit: [] }] };
    const installed = await store.installBuiltins({ roles: [role], flows: [flow] });
    expect(installed.written).toEqual(['library/roles/implementer/v1.yaml', 'library/flows/standard/v1.yaml']);
    const again = await store.installBuiltins({ roles: [role], flows: [flow] });
    expect(again.written).toEqual([]);
  });

  it('writes one bare definition per library/capabilities/<id>/v1.yaml target and never overwrites', async () => {
    const store = createFakeDefinitionStore();
    const capability: CapabilityDef = { kind: 'context', id: toCapSlug('docs'), name: 'Docs', path: 'docs' };
    const installed = await store.installCapabilities([capability]);
    expect(installed.written).toEqual(['library/capabilities/docs/v1.yaml']);
    const again = await store.installCapabilities([capability]);
    expect(again.written).toEqual([]);
    expect(again.skipped).toEqual(['library/capabilities/docs/v1.yaml']);
  });

  it('the bare capability file joins load and validateCandidate like any other capability body', async () => {
    const store = createFakeDefinitionStore();
    store.seed('library/capabilities/docs/v1.yaml', capabilityBody);
    store.seed('library/roles/implementer/v1.yaml', implementerRole('Implementer'));
    store.seed('library/flows/standard/v1.yaml', standardFlow('Standard'));
    store.seed(`repos/${REPO_SLUG}/repo.yaml`, repoYaml());

    const loaded = await store.load(REPO_SLUG);
    expect(loaded.ok && loaded.value.capabilities).toHaveLength(1);
  });

  it('listVersions answers version order and empty for an unknown id; appendVersion numbers from nextVersion', async () => {
    const store = createFakeDefinitionStore();
    expect(await store.listVersions('roles', 'implementer')).toEqual([]);
    const first = await store.appendVersion('roles', 'implementer', JSON.parse(implementerRole('One')), 10);
    expect(first.ok && first.value.version).toBe(1);
    const second = await store.appendVersion('roles', 'implementer', JSON.parse(implementerRole('Two')), 20);
    expect(second.ok && second.value.version).toBe(2);
    const history = await store.listVersions('roles', 'implementer');
    expect(history.map((record) => record.version)).toEqual([1, 2]);
    expect(history.map((record) => record.recordedAt)).toEqual([10, 20]);
    expect(history[1]?.body).toEqual(JSON.parse(implementerRole('Two')));
  });

  it('failNextAppendStale makes the next appendVersion answer stale and write nothing', async () => {
    const store = createFakeDefinitionStore();
    store.failNextAppendStale();
    const appended = await store.appendVersion('roles', 'implementer', JSON.parse(implementerRole('One')), 10);
    expect(appended).toEqual({ ok: false, error: 'stale' });
    expect(await store.listVersions('roles', 'implementer')).toEqual([]);
  });

  it('setRepoDef replaces the narrowed repo section load answers, keeping file issues decisive', async () => {
    const store = createFakeDefinitionStore();
    store.seed('library/roles/implementer/v1.yaml', implementerRole('Implementer'));
    store.seed('library/flows/standard/v1.yaml', standardFlow('Standard'));
    store.seed(`repos/${REPO_SLUG}/repo.yaml`, repoYaml());
    const typed: RepoDef = {
      id: REPO_SLUG,
      name: 'Acme',
      flow: {
        flowId: toFlowSlug('standard'),
        version: 1,
        stages: [{ id: toStageSlug('implement'), name: 'Implement', role: toRoleSlug('implementer'), exit: [] }],
        bindings: [
          { stage: toStageSlug('implement'), role: { roleId: toRoleSlug('implementer'), version: 1 }, accounts: [] },
        ],
      },
      defaultLimitPolicy: 'wait_resume',
      commandSets: {},
      docsRoot: 'docs',
      testGlobs: [],
    };
    store.setRepoDef(REPO_SLUG, typed);

    const loaded = await store.load(REPO_SLUG);
    expect(loaded.ok && loaded.value.repo).toEqual(typed);
  });
});
