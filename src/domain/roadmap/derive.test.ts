import { describe, expect, it } from 'vitest';
import type { WorkOrderStatus } from '../flow';
import type { PhaseSlug, TaskSlug } from '../shared';
import { deriveRoadmap } from './derive';
import type { LinkedWorkOrder, PhaseDef, Roadmap, TaskDef } from './types';

const taskOf = (id: string): TaskSlug => id as TaskSlug;
const phaseOf = (id: string): PhaseSlug => id as PhaseSlug;

const task = (id: string, dependsOn: readonly string[] = []): TaskDef => ({
  id: taskOf(id),
  title: `Task ${id}`,
  dependsOn: dependsOn.map(taskOf),
  acceptance: [`acceptance of ${id}`],
});

const phase = (id: string, tasks: readonly TaskDef[] = [], blockedBy: readonly string[] = []): PhaseDef => ({
  id: phaseOf(id),
  name: `Phase ${id}`,
  blockedBy: blockedBy.map(phaseOf),
  tasks,
});

const wo = (taskId: string, status: WorkOrderStatus): LinkedWorkOrder => ({ task: taskOf(taskId), status });

const deepFreeze = <T>(value: T): T => {
  if (value !== null && typeof value === 'object') {
    Object.values(value as Record<string, unknown>).forEach((inner) => deepFreeze(inner));
    Object.freeze(value);
  }
  return value;
};

// Acceptance fixture: a 3-task dependency chain across 2 phases, the second phase gated by the first.
const CHAIN: Roadmap = {
  phases: [phase('p-1', [task('t-1')]), phase('p-2', [task('t-2', ['t-1']), task('t-3', ['t-2'])], ['p-1'])],
};

// Every WorkOrderStatus except 'done' leaves the linked task running (R-40).
const NOT_DONE: readonly WorkOrderStatus[] = ['ready', 'running', 'gating', 'awaiting_human', 'limit_waiting', 'blocked'];

describe('deriveRoadmap', () => {
  it('R-42: lists only the head of the chain as runnable before any work order exists', () => {
    const view = deriveRoadmap(CHAIN, []);
    expect(view.tasks).toEqual({ 't-1': 'planned', 't-2': 'waiting', 't-3': 'waiting' });
    expect(view.phases).toEqual({ 'p-1': 'planned', 'p-2': 'waiting' });
    expect(view.runnable).toEqual(['t-1']);
  });

  it('R-40: a task with a linked work order that is not done is running', () => {
    for (const status of NOT_DONE) {
      const view = deriveRoadmap(CHAIN, [wo('t-1', status)]);
      expect(view.tasks['t-1']).toBe('running');
    }
  });

  it('R-40: a task with mixed work orders is running while any one is not done', () => {
    const view = deriveRoadmap(CHAIN, [wo('t-1', 'done'), wo('t-1', 'running')]);
    expect(view.tasks['t-1']).toBe('running');
  });

  it('R-40: a task whose linked work orders are all done is done', () => {
    const view = deriveRoadmap(CHAIN, [wo('t-1', 'done'), wo('t-1', 'done')]);
    expect(view.tasks['t-1']).toBe('done');
  });

  it('R-40: a linked work order outranks unfinished dependencies', () => {
    // t-2 depends on t-1, which has not finished, yet t-2 already has a running work order.
    const view = deriveRoadmap(CHAIN, [wo('t-2', 'running')]);
    expect(view.tasks['t-2']).toBe('running');
  });

  it('R-40: a task without work orders is waiting while any dependency is not done', () => {
    const roadmap: Roadmap = { phases: [phase('p-1', [task('t-1'), task('t-2'), task('t-3', ['t-1', 't-2'])])] };
    const view = deriveRoadmap(roadmap, [wo('t-1', 'done')]);
    expect(view.tasks['t-3']).toBe('waiting');
  });

  it('R-40: a task without work orders is waiting when its phase is blocked, even with all dependencies done', () => {
    // t-inner is finished, so the only thing keeping t-blocked waiting is p-1 not being done.
    const roadmap: Roadmap = {
      phases: [phase('p-1', [task('t-first')]), phase('p-2', [task('t-inner'), task('t-blocked', ['t-inner'])], ['p-1'])],
    };
    const view = deriveRoadmap(roadmap, [wo('t-inner', 'done')]);
    expect(view.tasks['t-blocked']).toBe('waiting');
  });

  it('R-40: a task without work orders is planned when dependencies are done and the phase is not blocked', () => {
    const view = deriveRoadmap(CHAIN, [wo('t-1', 'done')]);
    expect(view.tasks['t-2']).toBe('planned');
  });

  it('R-42: unblocks the next task of the chain as a work order completes', () => {
    const view = deriveRoadmap(CHAIN, [wo('t-1', 'done')]);
    expect(view.tasks['t-1']).toBe('done');
    expect(view.phases['p-1']).toBe('done');
    expect(view.runnable).toEqual(['t-2']);
  });

  it('R-42: walks the whole chain as work orders complete', () => {
    const afterT2 = deriveRoadmap(CHAIN, [wo('t-1', 'done'), wo('t-2', 'done')]);
    expect(afterT2.runnable).toEqual(['t-3']);
    expect(afterT2.phases['p-2']).toBe('planned');

    const afterT3 = deriveRoadmap(CHAIN, [wo('t-1', 'done'), wo('t-2', 'done'), wo('t-3', 'done')]);
    expect(afterT3.tasks).toEqual({ 't-1': 'done', 't-2': 'done', 't-3': 'done' });
    expect(afterT3.phases).toEqual({ 'p-1': 'done', 'p-2': 'done' });
    expect(afterT3.runnable).toEqual([]);
  });

  it('R-41: a phase with a running task is running', () => {
    const view = deriveRoadmap(CHAIN, [wo('t-1', 'running')]);
    expect(view.phases['p-1']).toBe('running');
  });

  it('R-41: a phase blocked by a not-done phase is waiting', () => {
    const view = deriveRoadmap(CHAIN, []);
    expect(view.phases['p-2']).toBe('waiting');
  });

  it('R-41: a blocked phase that already has a running task is running', () => {
    const view = deriveRoadmap(CHAIN, [wo('t-2', 'running')]);
    expect(view.phases['p-2']).toBe('running');
  });

  it('R-41: a phase whose tasks are all done is done', () => {
    const view = deriveRoadmap(CHAIN, [wo('t-1', 'done'), wo('t-2', 'done'), wo('t-3', 'done')]);
    expect(view.phases['p-2']).toBe('done');
  });

  it('R-41: a blocked phase whose tasks are all done is done', () => {
    // All-done outranks blocked: finished work is never reported as waiting.
    const roadmap: Roadmap = {
      phases: [phase('p-1', [task('t-first')]), phase('p-2', [task('t-done')], ['p-1'])],
    };
    const view = deriveRoadmap(roadmap, [wo('t-done', 'done')]);
    expect(view.phases['p-2']).toBe('done');
  });

  it('R-41: a blocked phase with mixed done and unfinished tasks is waiting', () => {
    // Rule 2 needs every task done; one unfinished task falls through to the blocked rule.
    const roadmap: Roadmap = {
      phases: [phase('p-1', [task('t-first')]), phase('p-2', [task('t-done'), task('t-later', ['t-done'])], ['p-1'])],
    };
    const view = deriveRoadmap(roadmap, [wo('t-done', 'done')]);
    expect(view.phases['p-2']).toBe('waiting');
  });

  it('R-41: a running task outranks the all-done rule in the same phase', () => {
    const roadmap: Roadmap = { phases: [phase('p-1', [task('t-a'), task('t-b')])] };
    const view = deriveRoadmap(roadmap, [wo('t-a', 'done'), wo('t-b', 'running')]);
    expect(view.phases['p-1']).toBe('running');
  });

  it('R-41: a finished blocked phase counts as done for its dependents', () => {
    // p-2 finished while blocked by p-1; its done status releases p-3, which can then run.
    const roadmap: Roadmap = {
      phases: [
        phase('p-1', [task('t-first')]),
        phase('p-2', [task('t-done')], ['p-1']),
        phase('p-3', [task('t-next')], ['p-2']),
      ],
    };
    const view = deriveRoadmap(roadmap, [wo('t-done', 'done')]);
    expect(view.phases['p-2']).toBe('done');
    expect(view.phases['p-3']).toBe('planned');
    expect(view.runnable).toEqual(['t-first', 't-next']);
  });

  it('R-41: a phase with zero tasks is planned', () => {
    const roadmap: Roadmap = { phases: [phase('p-1', [])] };
    const view = deriveRoadmap(roadmap, []);
    expect(view.phases['p-1']).toBe('planned');
  });

  it('R-41: a blocked phase with zero tasks is waiting', () => {
    // The blocked branch of the rule fires regardless of the task list.
    const roadmap: Roadmap = { phases: [phase('p-1', [task('t-first')]), phase('p-2', [], ['p-1'])] };
    const view = deriveRoadmap(roadmap, []);
    expect(view.phases['p-2']).toBe('waiting');
  });

  it('R-41: a phase with only planned or waiting tasks is planned', () => {
    const view = deriveRoadmap(CHAIN, []);
    expect(view.phases['p-1']).toBe('planned');
  });

  it('R-41: blocking is transitive through the phase graph', () => {
    const roadmap: Roadmap = {
      phases: [
        phase('p-1', [task('t-first')]),
        phase('p-2', [], ['p-1']),
        phase('p-3', [task('t-last')], ['p-2']),
      ],
    };
    const view = deriveRoadmap(roadmap, []);
    expect(view.phases['p-2']).toBe('waiting');
    expect(view.phases['p-3']).toBe('waiting');
    expect(view.tasks['t-last']).toBe('waiting');
  });

  it('R-41: a phase blocked only by done phases is not blocked', () => {
    const view = deriveRoadmap(CHAIN, [wo('t-1', 'done')]);
    expect(view.phases['p-2']).toBe('planned');
  });

  it('R-42: lists runnable tasks in roadmap order across phases', () => {
    const roadmap: Roadmap = {
      phases: [
        phase('p-1', [task('t-a'), task('t-b', ['t-a'])]),
        phase('p-2', [task('t-c'), task('t-d'), task('t-e')]),
      ],
    };
    const view = deriveRoadmap(roadmap, [wo('t-d', 'running'), wo('t-e', 'done')]);
    expect(view.tasks).toEqual({
      't-a': 'planned',
      't-b': 'waiting',
      't-c': 'planned',
      't-d': 'running',
      't-e': 'done',
    });
    expect(view.phases).toEqual({ 'p-1': 'planned', 'p-2': 'running' });
    expect(view.runnable).toEqual(['t-a', 't-c']);
  });

  it('ignores work orders for tasks outside the roadmap', () => {
    const view = deriveRoadmap(CHAIN, [wo('t-elsewhere', 'running')]);
    expect(Object.keys(view.tasks)).toEqual(['t-1', 't-2', 't-3']);
    expect(view.tasks['t-1']).toBe('planned');
  });

  it('derives an empty view for an empty roadmap', () => {
    const view = deriveRoadmap({ phases: [] }, []);
    expect(view.tasks).toEqual({});
    expect(view.phases).toEqual({});
    expect(view.runnable).toEqual([]);
  });

  it('does not mutate its inputs', () => {
    const roadmap = deepFreeze({
      phases: [
        { id: phaseOf('p-1'), name: 'P1', blockedBy: [], tasks: [task('t-1')] },
        { id: phaseOf('p-2'), name: 'P2', blockedBy: [phaseOf('p-1')], tasks: [task('t-2', ['t-1'])] },
      ],
    } satisfies Roadmap);
    const orders = deepFreeze([wo('t-1', 'done')]);
    expect(() => deriveRoadmap(roadmap, orders)).not.toThrow();
    expect(deriveRoadmap(roadmap, orders).runnable).toEqual(['t-2']);
  });
});
