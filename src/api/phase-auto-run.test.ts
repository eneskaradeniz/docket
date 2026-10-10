// api/phase-auto-run.test.ts — the boundary of `roadmap.pausePhase`, `roadmap.resumePhase` and the
// `autoRun` field of `roadmap.byProject` (docs/v2/application.md A-109 … A-116; here A-110 and A-116
// are exercised through the boundary).
import { describe, expect, it } from 'vitest';

import { BUILTIN_FLOWS, BUILTIN_ROLES, parseSlug, type Actor, type Slug } from '../domain/index';
import { createFakeDefinitionStore, createFakeDeps } from '../application/ports/fakes/index';

import { createApi } from './index';
import type { RoadmapPageView } from './queries';
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
    JSON.stringify({
      phases: [
        { id: 'p1', name: 'P1', blockedBy: [], tasks: [{ id: 'build', title: 'Build', dependsOn: [], acceptance: [], targets: [] }] },
        { id: 'p2', name: 'P2', blockedBy: ['p1'], tasks: [{ id: 'ship', title: 'Ship', dependsOn: [], acceptance: [], targets: [] }] },
        { id: 'p3', name: 'P3', blockedBy: ['p1', 'p2'], tasks: [{ id: 'launch', title: 'Launch', dependsOn: [], acceptance: [], targets: [] }] },
      ],
    }),
  );
  return { deps, api: createApi(deps) };
};

const byProject = async (api: ReturnType<typeof createApi>): Promise<RoadmapPageView> =>
  (await api.query({ type: 'roadmap.byProject', project: 'atolye' })) as RoadmapPageView;

describe('roadmap.pausePhase / roadmap.resumePhase', () => {
  it('A-110: both commands are listed in the registry', () => {
    expect(COMMAND_REGISTRY['roadmap.pausePhase'].input).toBe('project: ProjectSlug, phase: PhaseSlug');
    expect(COMMAND_REGISTRY['roadmap.resumePhase'].input).toBe('project: ProjectSlug, phase: PhaseSlug');
  });

  it('A-110: pause then resume answer ok, a wrong state answers its code, a bad id is invalid_id', async () => {
    const { api } = await setup();
    const input = { project: 'atolye', phase: 'p1' };
    expect(await api.command(USER, { type: 'roadmap.pausePhase', ...input })).toEqual({ ok: false, code: 'not_running' });
    expect(await api.command(USER, { type: 'roadmap.resumePhase', ...input })).toEqual({ ok: false, code: 'not_paused' });
    expect((await api.command(USER, { type: 'roadmap.runPhase', ...input })).ok).toBe(true);
    expect(await api.command(USER, { type: 'roadmap.pausePhase', ...input })).toEqual({ ok: true });
    expect(await api.command(USER, { type: 'roadmap.resumePhase', ...input })).toEqual({ ok: true });
    expect(await api.command(USER, { type: 'roadmap.pausePhase', project: 'Not A Slug', phase: 'p1' })).toEqual({ ok: false, code: 'invalid_id' });
    expect(await api.command(USER, { type: 'roadmap.resumePhase', project: 'atolye', phase: 'Not A Slug' })).toEqual({ ok: false, code: 'invalid_id' });
  });

  it('A-116: a boundary pause appends a phase.paused audit entry attributed to the caller', async () => {
    const { api, deps } = await setup();
    await api.command(USER, { type: 'roadmap.runPhase', project: 'atolye', phase: 'p1' });
    await api.command(USER, { type: 'roadmap.pausePhase', project: 'atolye', phase: 'p1' });
    const entries = await deps.log.list({ kind: 'project', id: PROJECT }, 50);
    expect(entries.filter((entry) => entry.action === 'phase.paused').map((entry) => entry.actor)).toEqual([USER]);
  });
});

describe('roadmap.byProject autoRun', () => {
  it('A-110: a phase entry carries autoRun { state, attention } once a record exists and omits it before', async () => {
    const { api, deps } = await setup();
    const before = await byProject(api);
    expect(before.phases.every((phase) => !('autoRun' in phase))).toBe(true);

    await api.command(USER, { type: 'roadmap.runPhase', project: 'atolye', phase: 'p1' });
    const after = await byProject(api);
    expect(after.phases[0]?.autoRun).toEqual({ state: 'running', attention: [] });
    expect(after.phases[1] !== undefined && 'autoRun' in after.phases[1]).toBe(false);

    await api.command(USER, { type: 'roadmap.pausePhase', project: 'atolye', phase: 'p1' });
    expect((await byProject(api)).phases[0]?.autoRun).toEqual({ state: 'paused', attention: [] });

    const order = (await deps.workOrders.list({ project: PROJECT }))[0];
    if (order === undefined) throw new Error('expected a work order');
    await deps.phaseAutoRuns.put({ project: PROJECT, phase: slugOf('p1'), state: 'paused', startedAt: 1, attention: [order.id] });
    expect((await byProject(api)).phases[0]?.autoRun).toEqual({ state: 'paused', attention: [order.id] });
  });
});

describe('roadmap.byProject blockedBy', () => {
  it('A-127: a phase entry lists the ids of its blocking phases that are not done, in the phase\'s own order; empty when none block it', async () => {
    const { api } = await setup();
    const view = await byProject(api);
    expect(view.phases.map((phase) => phase.blockedBy)).toEqual([[], ['p1'], ['p1', 'p2']]);
  });
});
