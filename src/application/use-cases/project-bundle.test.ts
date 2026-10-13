// use-cases/project-bundle.test.ts — acceptance tests for project export and import bundle (A-342, R-8, I-86, I-91).
import { describe, expect, it } from 'vitest';

import {
  parseSlug,
  type Actor,
  type ProjectSlug,
  type RepoSlug,
  type Slug,
} from '../../domain/index';
import { createFakeClock } from '../ports/fakes/fake-clock';
import { createFakeDeps } from '../ports/fakes/fake-deps';
import { createFakeEventLog } from '../ports/fakes/fake-event-log';
import { createFakeBundleStore } from '../ports/fakes/fake-bundle-store';
import { exportProject, importBundle } from './project-bundle';
import type { DocketBundle, MemoryNote } from '../ports/bundle-store';

const slugOf = <B extends string>(val: string): Slug<B> => {
  const p = parseSlug<B>(val);
  if (!p.ok) throw new Error(`Invalid slug: ${val}`);
  return p.value;
};

const ACTOR: Actor = { kind: 'user', id: 'usr-1', label: 'Operator' };
const PROJ: ProjectSlug = slugOf('demo-proj');
const REPO: RepoSlug = slugOf('demo-repo');

function setupHarness() {
  const clock = createFakeClock(1776090312000);
  const log = createFakeEventLog();
  const bundleStore = createFakeBundleStore();

  const deps = createFakeDeps({ clock, log, bundleStore });

  return { deps, clock, log, bundleStore };
}

describe('project-bundle use cases (A-342, R-8, I-86, I-91)', () => {
  it('A-342: project.export answers { path, counts } and audits project.exported; project.importBundle answers { warnings, renames } and audits project.imported', async () => {
    const { deps, log, clock } = setupHarness();

    // 1. Seed project, repos and definitions in definition store
    await deps.projects.save({
      id: PROJ,
      name: 'Demo Project',
      mainRepo: REPO,
      repos: [REPO],
    });

    await deps.definitions.installBuiltins({
      roles: [
        {
          id: slugOf<'role'>('planner'),
          name: 'Planner Role',
          instructions: 'Plan work',
          writeScope: { kind: 'none' },
          capabilities: [],
          active: true,
        },
      ],
      flows: [
        {
          id: slugOf<'flow'>('standard'),
          name: 'Standard Flow',
          stages: [
            {
              id: slugOf('impl'),
              name: 'Implementation',
              role: slugOf('planner'),
              exit: [],
            },
          ],
        },
      ],
    });

    await deps.definitions.writeFile(
      `repos/${REPO}/repo.yaml`,
      JSON.stringify({
        id: REPO,
        name: 'Demo Repo',
        flows: [slugOf('standard')],
        defaultFlow: slugOf('standard'),
        commandSets: { tests: ['npm test'] },
        roleOverrides: [],
        docsRoot: 'docs',
        testGlobs: ['**/*.test.ts'],
        flow: {
          flowId: slugOf('standard'),
          version: 1,
          stages: [{ id: slugOf('impl'), name: 'Implementation', role: slugOf('planner'), exit: [] }],
          bindings: [{ stage: slugOf('impl'), role: { roleId: slugOf('planner'), version: 1 }, accounts: [] }],
        },
      }),
      '',
    );

    const acceptedNote: MemoryNote = {
      id: 'mem-1',
      scope: 'project',
      scopeId: 'demo-proj',
      text: 'Project note',
      createdBy: 'user',
      active: true,
    };
    await deps.definitions.appendVersion('memory', acceptedNote.id, acceptedNote, clock.now());
    await deps.memory.recordNoteId(acceptedNote.id);
    // A pending proposal that must NOT travel (R-142)
    await deps.memory.saveProposal({
      id: 'prop-1',
      scope: 'project',
      scopeId: 'demo-proj',
      text: 'Pending',
      sourceRun: 'run-1',
      state: 'pending',
    });

    // 2. Export project
    const exported = await exportProject(deps, { project: PROJ, actor: ACTOR });
    expect(exported.ok).toBe(true);
    if (!exported.ok) return;

    expect(exported.value.path).toContain('demo-proj');
    expect(exported.value.counts).toEqual({
      projects: 1,
      repos: 1,
      definitions: 2, // planner role + standard flow
      memoryNotes: 1,
    });

    // Verify audit event project.exported
    const exportAudits = await log.list({ kind: 'project', id: PROJ }, 10);
    expect(exportAudits.some((a) => a.action === 'project.exported')).toBe(true);

    // 3. Export of unknown project answers not_found
    const unknown = await exportProject(deps, { project: slugOf('unknown'), actor: ACTOR });
    expect(unknown).toEqual({ ok: false, error: 'not_found' });

    // 4. Import bundle into the store
    const imported = await importBundle(deps, { path: exported.value.path, actor: ACTOR });
    expect(imported.ok).toBe(true);
    if (!imported.ok) return;

    expect(imported.value.warnings).toEqual([]);
    // Since PROJ, REPO, and definitions already exist in the target store, they are renamed / bumped!
    expect(imported.value.renames.length).toBeGreaterThan(0);
    expect(imported.value.renames.some((r) => r.id === PROJ && r.to.startsWith(`${PROJ}-`))).toBe(true);
    expect(imported.value.renames.some((r) => r.id === REPO && r.to.startsWith(`${REPO}-`))).toBe(true);

    // Verify audit event project.imported
    const importAudits = await log.list({ kind: 'project', id: slugOf(`${PROJ}-2`) }, 10);
    expect(importAudits.some((a) => a.action === 'project.imported')).toBe(true);
  });

  it('R-8: a bundled definition carrying a secret literal fails import validation and writes nothing', async () => {
    const { deps, bundleStore } = setupHarness();

    const badBundle: DocketBundle = {
      format: 'docket-bundle',
      version: 1,
      createdAt: 1000,
      projects: [
        {
          project: {
            id: slugOf('proj-sec'),
            name: 'Security Project',
            mainRepo: slugOf('repo-sec'),
            repos: [slugOf('repo-sec')],
          },
        },
      ],
      repos: [
        {
          id: slugOf('repo-sec'),
          name: 'Security Repo',
          flows: [slugOf('std')],
          defaultFlow: slugOf('std'),
          commandSets: {},
          roleOverrides: [],
          docsRoot: 'docs',
          testGlobs: [],
        },
      ],
      library: {
        roles: {},
        flows: {},
        capabilities: {
          'mcp-server': [
            {
              definitionId: 'mcp-server',
              version: 1,
              recordedAt: 1000,
              archived: false,
              body: {
                kind: 'mcp',
                id: slugOf('mcp-server'),
                name: 'MCP Server',
                command: 'node',
                args: [],
                env: {
                  API_KEY: { literal: 'SECRET_LITERAL_VALUE_123' }, // R-8 violation!
                },
              },
            },
          ],
        },
        memory: {},
      },
      memory: [],
      checksum: 'valid-checksum',
    };

    bundleStore.seed('/fake/bad-bundle.json', badBundle);

    const result = await importBundle(deps, { path: '/fake/bad-bundle.json', actor: ACTOR });
    expect(result.ok).toBe(false);
    if (result.ok) return;

    expect(result.error).toBe('definitions_invalid');
    expect(result.issues?.some((i) => i.code === 'secret_literal')).toBe(true);

    // Nothing written
    const projCheck = await deps.projects.get(slugOf('proj-sec'));
    expect(projCheck).toBeUndefined();
  });

  it('I-86: exported bundles live under ~/.docket/exports and are imported through the store', async () => {
    const { deps } = setupHarness();

    await deps.projects.save({
      id: slugOf('i86-proj'),
      name: 'I86 Project',
      mainRepo: slugOf('i86-repo'),
      repos: [slugOf('i86-repo')],
    });

    await deps.definitions.installBuiltins({
      roles: [
        {
          id: slugOf<'role'>('worker'),
          name: 'Worker',
          instructions: 'Do work',
          writeScope: { kind: 'none' },
          capabilities: [],
          active: true,
        },
      ],
      flows: [
        {
          id: slugOf<'flow'>('std'),
          name: 'Standard',
          stages: [
            {
              id: slugOf('impl'),
              name: 'Impl',
              role: slugOf('worker'),
              exit: [],
            },
          ],
        },
      ],
    });

    await deps.definitions.writeFile(
      `repos/i86-repo/repo.yaml`,
      JSON.stringify({
        id: slugOf('i86-repo'),
        name: 'I86 Repo',
        flows: [slugOf('std')],
        defaultFlow: slugOf('std'),
        commandSets: {},
        roleOverrides: [],
        docsRoot: 'docs',
        testGlobs: [],
      }),
      '',
    );

    const exported = await exportProject(deps, { project: slugOf('i86-proj'), actor: ACTOR });
    expect(exported.ok).toBe(true);
    if (!exported.ok) return;

    // Written through bundleStore under exports
    expect(exported.value.path).toContain('/exports/');

    // Import operates through the store
    const imported = await importBundle(deps, { path: exported.value.path, actor: ACTOR });
    expect(imported.ok).toBe(true);
  });
});
