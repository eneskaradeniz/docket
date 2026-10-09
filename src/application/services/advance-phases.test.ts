// services/advance-phases.test.ts — rules A-109 … A-116 from docs/v2/application.md: a phase the
// operator started keeps advancing unattended through its PhaseAutoRun record.
import { describe, expect, it } from 'vitest';

import {
  BUILTIN_FLOWS,
  BUILTIN_ROLES,
  parseSlug,
  parseUlid,
  type AccountId,
  type Actor,
  type PhaseAutoRun,
  type PhaseSlug,
  type ProjectSlug,
  type Slug,
  type TaskSlug,
  type Ulid,
} from '../../domain/index';

import type { AccountRecord, AppDeps } from '../ports/index';
import { createFakeClock, createFakeDefinitionStore, createFakeDeps, createFakeEventLog, type FakeClock, type FakeEventLog } from '../ports/fakes/index';

import { blockWorkOrder, closeWorkOrder, pausePhase, resumePhase } from '../use-cases/index';
import { advancePhases } from './advance-phases';
import { runPhase } from './run-phase';

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
const MAIN = slugOf<'repo'>('main');
const P1: PhaseSlug = slugOf('p1');
const P2: PhaseSlug = slugOf('p2');
const GHOST: PhaseSlug = slugOf('ghost');
const A: TaskSlug = slugOf('a');
const B: TaskSlug = slugOf('b');
const C: TaskSlug = slugOf('c');
const SHIP: TaskSlug = slugOf('ship');
const ACCOUNT: AccountId = ulidOf('01ARZ3NDEKTSV4RRFFQ69G5FCV');

const repoDefinitions = JSON.stringify({
  roles: BUILTIN_ROLES,
  flows: BUILTIN_FLOWS.filter((flow) => flow.id === 'standard'),
  capabilities: [],
  repo: { id: 'main', name: 'main', flows: ['standard'], defaultFlow: 'standard', commandSets: { tests: ['npm test'] }, roleOverrides: [], docsRoot: 'docs', testGlobs: [] },
});

// p1: a → b, and an independent c; p2 waits for p1.
const ROADMAP = JSON.stringify({
  phases: [
    {
      id: 'p1',
      name: 'p1',
      blockedBy: [],
      tasks: [
        { id: 'a', title: 'Task a', dependsOn: [], acceptance: [], targets: [] },
        { id: 'b', title: 'Task b', dependsOn: ['a'], acceptance: [], targets: [] },
        { id: 'c', title: 'Task c', dependsOn: [], acceptance: [], targets: [] },
      ],
    },
    { id: 'p2', name: 'p2', blockedBy: ['p1'], tasks: [{ id: 'ship', title: 'Task ship', dependsOn: [], acceptance: [], targets: [] }] },
  ],
});

interface Harness {
  readonly deps: AppDeps;
  readonly log: FakeEventLog;
  readonly clock: FakeClock;
}

const harness = async (roadmap: string | null = ROADMAP): Promise<Harness> => {
  const definitions = createFakeDefinitionStore();
  const log = createFakeEventLog();
  const clock = createFakeClock(1_000);
  const deps = createFakeDeps({ definitions, log, clock });
  const project = { id: PROJECT, name: 'Atölye', mainRepo: MAIN, repos: [MAIN] };
  definitions.setProject(project);
  await deps.projects.save(project);
  definitions.seed({ kind: 'repo', repo: MAIN }, 'defs.json', repoDefinitions);
  if (roadmap !== null) definitions.seed({ kind: 'project', project: PROJECT }, 'roadmap.json', roadmap);
  const account: AccountRecord = { id: ACCOUNT, provider: 'provider-x', label: 'account', authMode: 'subscription', limitPolicy: 'wait_resume', caps: [] };
  await deps.accounts.save(account);
  for (const role of ['planner', 'developer', 'reviewer']) {
    await deps.bindings.save({ level: 'global' }, { role: slugOf<'role'>(role), accounts: [{ accountId: ACCOUNT }] });
  }
  return { deps, log, clock };
};

const start = (h: Harness, phase: PhaseSlug = P1) => runPhase(h.deps, { project: PROJECT, phase, actor: ACTOR });
const advance = (h: Harness) => advancePhases(h.deps);
const record = (h: Harness, phase: PhaseSlug = P1) => h.deps.phaseAutoRuns.get(PROJECT, phase);
const orderOf = async (h: Harness, task: TaskSlug) => {
  const found = (await h.deps.workOrders.list({ project: PROJECT })).find((order) => order.task === task);
  if (found === undefined) throw new Error(`no work order for ${task}`);
  return found;
};
const tasksOpened = async (h: Harness) => (await h.deps.workOrders.list({ project: PROJECT })).map((order) => order.task).sort();
const finish = async (h: Harness, task: TaskSlug) => {
  const closed = await closeWorkOrder(h.deps, { id: (await orderOf(h, task)).id, actor: ACTOR });
  if (!closed.ok) throw new Error(`close must succeed: ${closed.error}`);
};
const control = { project: PROJECT, phase: P1, actor: ACTOR };

describe('runPhase records a PhaseAutoRun', () => {
  it('A-109: a successful runPhase upserts a running record with startedAt = now and no attention; a refused call writes none', async () => {
    const h = await harness();
    expect(await start(h, P2)).toEqual({ ok: false, error: 'phase_not_runnable' });
    expect(await h.deps.phaseAutoRuns.list()).toEqual([]);

    expect((await start(h)).ok).toBe(true);
    expect(await record(h)).toEqual({ project: PROJECT, phase: P1, state: 'running', startedAt: 1_000, attention: [] });

    // A running record keeps its startedAt across a second call.
    h.clock.advance(500);
    expect((await start(h)).ok).toBe(true);
    expect((await record(h))?.startedAt).toBe(1_000);
    expect(await h.deps.phaseAutoRuns.list()).toHaveLength(1);
  });

  it('A-109: a paused or done record is replaced by a fresh running one', async () => {
    const h = await harness();
    const stale: PhaseAutoRun = { project: PROJECT, phase: P1, state: 'paused', startedAt: 5, attention: [] };
    await h.deps.phaseAutoRuns.put(stale);
    h.clock.advance(100);
    expect((await start(h)).ok).toBe(true);
    expect(await record(h)).toEqual({ project: PROJECT, phase: P1, state: 'running', startedAt: 1_100, attention: [] });

    await h.deps.phaseAutoRuns.put({ ...stale, state: 'done' });
    h.clock.advance(100);
    expect((await start(h)).ok).toBe(true);
    expect(await record(h)).toEqual({ project: PROJECT, phase: P1, state: 'running', startedAt: 1_200, attention: [] });
  });
});

describe('pausePhase / resumePhase', () => {
  it('A-110: pause moves running → paused and resume paused → running; anything else is not_running / not_paused and writes nothing', async () => {
    const h = await harness();
    expect(await pausePhase(h.deps, control)).toEqual({ ok: false, error: 'not_running' });
    expect(await resumePhase(h.deps, control)).toEqual({ ok: false, error: 'not_paused' });
    expect(await h.deps.phaseAutoRuns.list()).toEqual([]);

    await start(h);
    expect(await resumePhase(h.deps, control)).toEqual({ ok: false, error: 'not_paused' });
    expect(await pausePhase(h.deps, control)).toEqual({ ok: true, value: undefined });
    expect((await record(h))?.state).toBe('paused');
    expect(await pausePhase(h.deps, control)).toEqual({ ok: false, error: 'not_running' });
    expect(await resumePhase(h.deps, control)).toEqual({ ok: true, value: undefined });
    expect((await record(h))?.state).toBe('running');

    await h.deps.phaseAutoRuns.put({ project: PROJECT, phase: P1, state: 'done', startedAt: 1, attention: [] });
    expect(await pausePhase(h.deps, control)).toEqual({ ok: false, error: 'not_running' });
    expect(await resumePhase(h.deps, control)).toEqual({ ok: false, error: 'not_paused' });
  });

  it('A-110: pause and resume keep startedAt and attention', async () => {
    const h = await harness();
    await start(h);
    const flagged = (await orderOf(h, A)).id;
    await h.deps.phaseAutoRuns.put({ project: PROJECT, phase: P1, state: 'running', startedAt: 42, attention: [flagged] });
    await pausePhase(h.deps, control);
    await resumePhase(h.deps, control);
    expect(await record(h)).toEqual({ project: PROJECT, phase: P1, state: 'running', startedAt: 42, attention: [flagged] });
  });
});

describe('advancePhases', () => {
  it('A-111: opens and queues only the tasks that became runnable, and leaves the rest alone', async () => {
    const h = await harness();
    await start(h);
    expect(await tasksOpened(h)).toEqual([A, C]);

    // Nothing changed yet: nothing opens.
    await advance(h);
    expect(await tasksOpened(h)).toEqual([A, C]);

    await finish(h, A);
    const queuedBefore = (await h.deps.queue.list()).length;
    await advance(h);
    expect(await tasksOpened(h)).toEqual([A, B, C]);
    const opened = await orderOf(h, B);
    const queued = await h.deps.queue.list();
    expect(queued).toHaveLength(queuedBefore + 1);
    expect(queued.some((item) => item.workOrderId === opened.id)).toBe(true);
  });

  it('A-111: a record without a project, roadmap or phase is skipped without a write; a missing record starts nothing', async () => {
    const h = await harness();
    await advance(h);
    expect(await h.deps.phaseAutoRuns.list()).toEqual([]);
    expect(await h.deps.workOrders.list({ project: PROJECT })).toEqual([]);

    const noRoadmap = await harness(null);
    await noRoadmap.deps.phaseAutoRuns.put({ project: PROJECT, phase: P1, state: 'running', startedAt: 1, attention: [] });
    const before = await noRoadmap.deps.phaseAutoRuns.list();
    await advance(noRoadmap);
    expect(await noRoadmap.deps.phaseAutoRuns.list()).toEqual(before);

    const invalid = await harness(JSON.stringify({ phases: [{ id: 'p1', name: 'p1', blockedBy: [], tasks: [{ id: 'a', title: 'a', dependsOn: ['nope'], acceptance: [], targets: [] }] }] }));
    await invalid.deps.phaseAutoRuns.put({ project: PROJECT, phase: P1, state: 'running', startedAt: 1, attention: [] });
    await advance(invalid);
    expect((await record(invalid))?.state).toBe('running');
    expect(await invalid.deps.workOrders.list({ project: PROJECT })).toEqual([]);

    const unknownPhase = await harness();
    await unknownPhase.deps.phaseAutoRuns.put({ project: PROJECT, phase: GHOST, state: 'running', startedAt: 1, attention: [] });
    await advance(unknownPhase);
    expect((await unknownPhase.deps.phaseAutoRuns.get(PROJECT, GHOST))?.state).toBe('running');
    expect(await unknownPhase.deps.workOrders.list({ project: PROJECT })).toEqual([]);
  });

  it('A-112: when the phase is done the record becomes done, and the next phase stays closed', async () => {
    const h = await harness();
    await start(h);
    await finish(h, A);
    await finish(h, C);
    await advance(h);
    await finish(h, B);
    await advance(h);

    expect((await record(h))?.state).toBe('done');
    expect(await tasksOpened(h)).toEqual([A, B, C]);
    expect(await record(h, P2)).toBeUndefined();

    // A done record is never advanced again, and the next phase opens only when the operator starts it.
    await advance(h);
    expect(await tasksOpened(h)).toEqual([A, B, C]);
    expect((await start(h, P2)).ok).toBe(true);
    expect(await tasksOpened(h)).toEqual([A, B, C, SHIP]);
  });

  it('A-113: a blocked work order is flagged in attention and does not stop the other tasks', async () => {
    const h = await harness();
    await start(h);
    const orderC = await orderOf(h, C);
    const blocked = await blockWorkOrder(h.deps, { id: orderC.id, reason: 'broke', actor: ACTOR });
    expect(blocked.ok).toBe(true);
    await finish(h, A);

    await advance(h);
    expect(await tasksOpened(h)).toEqual([A, B, C]);
    expect((await record(h))?.attention).toEqual([orderC.id]);
    expect((await record(h))?.state).toBe('running');

    // Once the flagged work order is closed it leaves attention.
    await finish(h, C);
    await advance(h);
    expect((await record(h))?.attention).toEqual([]);
  });

  it('A-114: running advancePhases twice in a row opens nothing the second time and writes nothing', async () => {
    const h = await harness();
    await start(h);
    await finish(h, A);
    await advance(h);
    const orders = await h.deps.workOrders.list({ project: PROJECT });
    const queued = await h.deps.queue.list();
    const entries = h.log.entries().length;
    const records = await h.deps.phaseAutoRuns.list();

    const second = await advance(h);
    expect(second.opened).toBe(0);
    expect(await h.deps.workOrders.list({ project: PROJECT })).toEqual(orders);
    expect(await h.deps.queue.list()).toEqual(queued);
    expect(h.log.entries()).toHaveLength(entries);
    expect(await h.deps.phaseAutoRuns.list()).toEqual(records);
  });

  it('A-115: a paused phase starts nothing new but leaves its queued items and work orders untouched; resume continues', async () => {
    const h = await harness();
    await start(h);
    const queued = await h.deps.queue.list();
    await finish(h, A);
    await pausePhase(h.deps, control);

    await advance(h);
    expect(await tasksOpened(h)).toEqual([A, C]);
    expect((await h.deps.queue.list()).map((item) => item.workOrderId)).toEqual(queued.map((item) => item.workOrderId));

    await resumePhase(h.deps, control);
    await advance(h);
    expect(await tasksOpened(h)).toEqual([A, B, C]);
  });

  it('A-116: pause and resume each append one audit entry with project and phase only; refused calls append none', async () => {
    const h = await harness();
    await start(h);
    const base = h.log.entries().length;
    await resumePhase(h.deps, control);
    expect(h.log.entries()).toHaveLength(base);

    await pausePhase(h.deps, control);
    await resumePhase(h.deps, control);
    await pausePhase(h.deps, control);
    await pausePhase(h.deps, control);
    const added = h.log.entries().slice(base);
    expect(added.map((entry) => entry.action)).toEqual(['phase.paused', 'phase.resumed', 'phase.paused']);
    for (const entry of added) {
      expect(entry.subject).toEqual({ kind: 'project', id: PROJECT });
      expect(entry.actor).toEqual(ACTOR);
      expect(entry.detail).toEqual({ project: PROJECT, phase: P1 });
    }
  });
});
