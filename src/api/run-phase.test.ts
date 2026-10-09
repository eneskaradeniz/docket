// api/run-phase.test.ts — the boundary mapping of `roadmap.runPhase` (docs/v2/application.md A-98).
import { describe, expect, it } from 'vitest';

import { BUILTIN_FLOWS, BUILTIN_ROLES, parseSlug, type Actor, type Slug } from '../domain/index';
import { createFakeDefinitionStore, createFakeDeps } from '../application/ports/fakes/index';

import { createApi } from './index';
import { COMMAND_REGISTRY } from './registry';

const USER: Actor = { kind: 'user', id: 'u-1', label: 'Operator' };

const slugOf = <B extends string>(input: string): Slug<B> => {
  const parsed = parseSlug<B>(input);
  if (!parsed.ok) throw new Error(`fixture slug must parse: ${input}`);
  return parsed.value;
};

const REPO = slugOf<'repo'>('main');
const PROJECT = slugOf<'project'>('atolye');

const setup = async () => {
  const definitions = createFakeDefinitionStore();
  const deps = createFakeDeps({ definitions });
  const project = { id: PROJECT, name: 'Atölye', mainRepo: REPO, repos: [REPO] };
  definitions.setProject(project);
  await deps.projects.save(project);
  definitions.seed(
    { kind: 'repo', repo: REPO },
    'defs.json',
    JSON.stringify({
      roles: BUILTIN_ROLES,
      flows: BUILTIN_FLOWS.filter((flow) => flow.id === 'standard'),
      capabilities: [],
      repo: { id: 'main', name: 'main', flows: ['standard'], defaultFlow: 'standard', commandSets: { tests: ['npm test'] }, roleOverrides: [], docsRoot: 'docs', testGlobs: [] },
    }),
  );
  definitions.seed(
    { kind: 'project', project: PROJECT },
    'roadmap.json',
    JSON.stringify({ phases: [{ id: 'p1', name: 'P1', blockedBy: [], tasks: [{ id: 'build', title: 'Build', dependsOn: [], acceptance: [], targets: [] }] }] }),
  );
  return createApi(deps);
};

describe('roadmap.runPhase', () => {
  it('A-98: is listed in the registry with its input', () => {
    expect(COMMAND_REGISTRY['roadmap.runPhase'].input).toBe('project: ProjectSlug, phase: PhaseSlug');
  });

  it('A-98: answers the opened work orders as strings, and the domain refusal as a code', async () => {
    const api = await setup();
    const ran = await api.command(USER, { type: 'roadmap.runPhase', project: 'atolye', phase: 'p1' });
    expect(ran.ok && ran.phaseRun?.opened.map((entry) => entry.task)).toEqual(['build']);
    expect(ran.ok && ran.phaseRun?.opened[0]?.workOrders).toHaveLength(1);

    expect(await api.command(USER, { type: 'roadmap.runPhase', project: 'atolye', phase: 'ghost' })).toEqual({ ok: false, code: 'unknown_phase' });
    expect(await api.command(USER, { type: 'roadmap.runPhase', project: 'Not A Slug', phase: 'p1' })).toEqual({ ok: false, code: 'invalid_id' });
  });
});
