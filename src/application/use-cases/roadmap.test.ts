// use-cases/roadmap.test.ts — rules A-97 … A-100 from docs/v2/application.md: runPhase turns a
// phase's runnable tasks into opened, queued work orders.
import { describe, expect, it } from 'vitest';

import {
  BUILTIN_FLOWS,
  BUILTIN_ROLES,
  parseSlug,
  parseUlid,
  type AccountId,
  type Actor,
  type PhaseSlug,
  type ProjectSlug,
  type RepoSlug,
  type Slug,
  type TaskSlug,
  type Ulid,
} from '../../domain/index';

import type { AccountRecord, AppDeps } from '../ports/index';
import { createFakeDefinitionStore, createFakeDeps, createFakeEventLog, type FakeEventLog } from '../ports/fakes/index';

import { closeWorkOrder } from './work-orders';
import { runPhase } from './roadmap';

const ACTOR: Actor = { kind: 'user', id: 'u-1', label: 'Operator' };

const slugOf = <B extends string>(input: string): Slug<B> => {
  const parsed = parseSlug<B>(input);
  if (!parsed.ok) throw new Error(`fixture slug must parse: ${input}`);
  return parsed.value;
};

const ulidOf = <B extends string>(input: string): Ulid<B> => {
  const parsed = parseUlid<B>(input);
  if (!parsed.ok) throw new Error(`fixture ulid must parse: ${input}`);
  return parsed.value;
};

const PROJECT: ProjectSlug = slugOf('atolye');
const MAIN: RepoSlug = slugOf('main');
const WEB: RepoSlug = slugOf('web');
const P1: PhaseSlug = slugOf('p1');
const P2: PhaseSlug = slugOf('p2');
const BUILD: TaskSlug = slugOf('build');
const POLISH: TaskSlug = slugOf('polish');
const SHIP: TaskSlug = slugOf('ship');
const ACCOUNT: AccountId = ulidOf('01ARZ3NDEKTSV4RRFFQ69G5FCV');

const repoDefinitions = (repo: string): string =>
  JSON.stringify({
    roles: BUILTIN_ROLES,
    flows: BUILTIN_FLOWS.filter((flow) => flow.id === 'standard'),
    capabilities: [],
    repo: {
      id: repo,
      name: repo,
      flows: ['standard'],
      defaultFlow: 'standard',
      commandSets: { tests: ['npm test'] },
      roleOverrides: [],
      docsRoot: 'docs',
      testGlobs: [],
    },
  });

interface TaskSpec {
  readonly id: string;
  readonly dependsOn?: readonly string[];
  readonly targets?: readonly string[];
}

interface PhaseSpec {
  readonly id: string;
  readonly blockedBy?: readonly string[];
  readonly tasks: readonly TaskSpec[];
}

const roadmapJson = (phases: readonly PhaseSpec[]): string =>
  JSON.stringify({
    phases: phases.map((phase) => ({
      id: phase.id,
      name: phase.id,
      blockedBy: phase.blockedBy ?? [],
      tasks: phase.tasks.map((task) => ({
        id: task.id,
        title: `Task ${task.id}`,
        dependsOn: task.dependsOn ?? [],
        acceptance: [],
        targets: task.targets ?? [],
      })),
    })),
  });

const DEFAULT_ROADMAP = roadmapJson([
  { id: 'p1', tasks: [{ id: 'build', targets: ['main', 'web'] }, { id: 'polish', dependsOn: ['build'] }] },
  { id: 'p2', blockedBy: ['p1'], tasks: [{ id: 'ship' }] },
]);

interface Harness {
  readonly deps: AppDeps;
  readonly log: FakeEventLog;
}

interface HarnessOptions {
  /** `null` seeds no roadmap file at all. */
  readonly roadmap?: string | null;
  /** False leaves every role unbound, so enqueueing fails on routing alone. */
  readonly bound?: boolean;
  /** Repos that get no definitions, so opening a work order there fails. */
  readonly brokenRepos?: readonly RepoSlug[];
}

const harness = async (options: HarnessOptions = {}): Promise<Harness> => {
  const definitions = createFakeDefinitionStore();
  const log = createFakeEventLog();
  const deps = createFakeDeps({ definitions, log });
  const project = { id: PROJECT, name: 'Atölye', mainRepo: MAIN, repos: [MAIN, WEB] };
  definitions.setProject(project);
  await deps.projects.save(project);
  for (const repo of [MAIN, WEB]) {
    if (options.brokenRepos?.includes(repo) === true) continue;
    definitions.seed({ kind: 'repo', repo }, 'defs.json', repoDefinitions(repo));
  }
  if (options.roadmap !== null) {
    definitions.seed({ kind: 'project', project: PROJECT }, 'roadmap.json', options.roadmap ?? DEFAULT_ROADMAP);
  }

  if (options.bound !== false) {
    const account: AccountRecord = { id: ACCOUNT, provider: 'provider-x', label: 'account', authMode: 'subscription', limitPolicy: 'wait_resume', caps: [] };
    await deps.accounts.save(account);
    for (const role of ['planner', 'developer', 'reviewer']) {
      await deps.bindings.save({ level: 'global' }, { role: slugOf<'role'>(role), accounts: [{ accountId: ACCOUNT }] });
    }
  }
  return { deps, log };
};

const run = (h: Harness, phase: PhaseSlug) => runPhase(h.deps, { project: PROJECT, phase, actor: ACTOR });
const allOrders = (h: Harness) => h.deps.workOrders.list({ project: PROJECT });
const phaseRuns = (h: Harness) => h.log.entries().filter((entry) => entry.action === 'phase.run');

describe('runPhase', () => {
  it('A-97: an unknown project, missing roadmap, invalid roadmap or unknown phase answers its code and writes nothing', async () => {
    const h = await harness();
    expect(await runPhase(h.deps, { project: slugOf('ghost'), phase: P1, actor: ACTOR })).toEqual({ ok: false, error: 'unknown_project' });
    expect(await run(h, slugOf('p9'))).toEqual({ ok: false, error: 'unknown_phase' });

    const missing = await harness({ roadmap: null });
    expect(await run(missing, P1)).toEqual({ ok: false, error: 'no_roadmap' });

    const invalid = await harness({ roadmap: roadmapJson([{ id: 'p1', tasks: [{ id: 'build', dependsOn: ['nope'] }] }]) });
    expect(await run(invalid, P1)).toEqual({ ok: false, error: 'definitions_invalid' });

    for (const each of [h, missing, invalid]) {
      expect(await allOrders(each)).toEqual([]);
      expect(each.log.entries()).toEqual([]);
    }
  });

  it('A-97: a phase blocked by an undone phase, or already done, is phase_not_runnable and nothing is written', async () => {
    const h = await harness();
    expect(await run(h, P2)).toEqual({ ok: false, error: 'phase_not_runnable' });
    expect(await allOrders(h)).toEqual([]);
    expect(await h.deps.queue.list()).toEqual([]);
    expect(h.log.entries()).toEqual([]);

    // Run phase 1, then close every one of its work orders: the phase is done and cannot run again.
    const single = await harness({ roadmap: roadmapJson([{ id: 'p1', tasks: [{ id: 'build' }] }, { id: 'p2', blockedBy: ['p1'], tasks: [{ id: 'ship' }] }]) });
    expect((await run(single, P1)).ok).toBe(true);
    for (const order of await allOrders(single)) {
      expect((await closeWorkOrder(single.deps, { id: order.id, actor: ACTOR })).ok).toBe(true);
    }
    const before = single.log.entries().length;
    expect(await run(single, P1)).toEqual({ ok: false, error: 'phase_not_runnable' });
    expect(single.log.entries()).toHaveLength(before);

    // With phase 1 done, phase 2 is runnable.
    const next = await run(single, P2);
    expect(next.ok && next.value.opened.map((entry) => entry.task)).toEqual([SHIP]);
  });

  it('A-98: a task targeting two repos opens one work order per repo, queued, and its dependent task is not opened', async () => {
    const h = await harness();
    const result = await run(h, P1);
    if (!result.ok) throw new Error(`run must succeed: ${result.error}`);

    expect(result.value.failed).toEqual([]);
    expect(result.value.opened.map((entry) => entry.task)).toEqual([BUILD]);
    const ids = result.value.opened[0]?.workOrders ?? [];
    expect(ids).toHaveLength(2);

    const orders = await allOrders(h);
    expect(orders.map((order) => order.repo).sort()).toEqual([MAIN, WEB]);
    expect(orders.every((order) => order.task === BUILD)).toBe(true);
    expect(orders.map((order) => order.id).sort()).toEqual([...ids].sort());

    const queued = await h.deps.queue.list();
    expect(queued.map((item) => item.workOrderId).sort()).toEqual([...ids].sort());
    expect(orders.some((order) => order.task === POLISH)).toBe(false);
  });

  it('A-98: runnable tasks open in roadmap order', async () => {
    const h = await harness({ roadmap: roadmapJson([{ id: 'p1', tasks: [{ id: 'polish' }, { id: 'build' }, { id: 'ship' }] }]) });
    const result = await run(h, P1);
    if (!result.ok) throw new Error('run must succeed');
    expect(result.value.opened.map((entry) => entry.task)).toEqual([POLISH, BUILD, SHIP]);
  });

  it('A-98: an empty phase answers both arrays empty', async () => {
    const h = await harness({ roadmap: roadmapJson([{ id: 'p1', tasks: [] }]) });
    expect(await run(h, P1)).toEqual({ ok: true, value: { opened: [], failed: [] } });
  });

  it('A-99: a task that cannot open is collected and the other tasks still run', async () => {
    const h = await harness({
      roadmap: roadmapJson([{ id: 'p1', tasks: [{ id: 'build', targets: ['web'] }, { id: 'polish', targets: ['main'] }] }]),
      brokenRepos: [WEB],
    });
    const result = await run(h, P1);
    if (!result.ok) throw new Error('run must succeed');
    expect(result.value.opened.map((entry) => entry.task)).toEqual([POLISH]);
    expect(result.value.failed).toEqual([{ task: BUILD, error: 'definitions_invalid' }]);
    expect((await allOrders(h)).map((order) => order.task)).toEqual([POLISH]);
  });

  it('A-99: an opened work order whose enqueue failed stays and is reported with its id', async () => {
    const h = await harness({ bound: false, roadmap: roadmapJson([{ id: 'p1', tasks: [{ id: 'build' }, { id: 'polish' }] }]) });
    const result = await run(h, P1);
    if (!result.ok) throw new Error('run must succeed');

    const orders = await allOrders(h);
    expect(orders).toHaveLength(2);
    expect(result.value.failed.map((entry) => entry.task)).toEqual([BUILD, POLISH]);
    for (const entry of result.value.failed) {
      expect(orders.map((order) => order.id)).toContain(entry.workOrder);
      expect(entry.error).not.toBe('');
    }
    // The orders are still reported as opened: the operator finds them on the board.
    expect(result.value.opened.flatMap((entry) => entry.workOrders).sort()).toEqual(orders.map((order) => order.id).sort());
    expect(await h.deps.queue.list()).toEqual([]);
  });

  it('A-99: running the phase twice opens nothing the second time', async () => {
    const h = await harness();
    expect((await run(h, P1)).ok).toBe(true);
    const before = (await allOrders(h)).length;

    expect(await run(h, P1)).toEqual({ ok: true, value: { opened: [], failed: [] } });
    expect(await allOrders(h)).toHaveLength(before);
    expect(await h.deps.queue.list()).toHaveLength(before);
  });

  it('A-100: each call appends one phase.run entry with counts only', async () => {
    const h = await harness();
    await run(h, P1);
    await run(h, P1);

    const entries = phaseRuns(h);
    expect(entries).toHaveLength(2);
    expect(entries[0]).toMatchObject({
      actor: ACTOR,
      subject: { kind: 'project', id: PROJECT },
      detail: { project: PROJECT, phase: P1, opened: 1, failed: 0 },
    });
    expect(entries[1]?.detail).toEqual({ project: PROJECT, phase: P1, opened: 0, failed: 0 });
    expect(JSON.stringify(entries)).not.toContain('Task build');
  });

  it('A-100: failures are counted and a refused call writes no entry', async () => {
    const h = await harness({ bound: false });
    await run(h, P1);
    expect(phaseRuns(h)[0]?.detail).toMatchObject({ opened: 1, failed: 2 });

    const refused = await harness();
    await run(refused, P2);
    expect(phaseRuns(refused)).toEqual([]);
  });
});
