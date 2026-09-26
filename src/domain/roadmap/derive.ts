// roadmap/derive.ts — exact contract from docs/v2/domain.md section 10.
// Task and phase statuses are decided over the two acyclic graphs validation guarantees
// (task dependsOn, phase blockedBy). Memoised per call so each task and phase is decided once.
import type { PhaseSlug, TaskSlug } from '../shared';
import type { LinkedWorkOrder, PhaseDef, PhaseStatus, Roadmap, RoadmapView, TaskDef, TaskStatus } from './types';

export function deriveRoadmap(roadmap: Roadmap, workOrders: readonly LinkedWorkOrder[]): RoadmapView {
  const ordersByTask = new Map<string, readonly LinkedWorkOrder[]>();
  for (const order of workOrders) {
    const existing = ordersByTask.get(order.task);
    ordersByTask.set(order.task, existing === undefined ? [order] : [...existing, order]);
  }

  const taskById = new Map<string, TaskDef>();
  const phaseOfTask = new Map<string, PhaseDef>();
  const phaseById = new Map<string, PhaseDef>();
  for (const phase of roadmap.phases) {
    if (!phaseById.has(phase.id)) phaseById.set(phase.id, phase);
    for (const task of phase.tasks) {
      if (!taskById.has(task.id)) {
        taskById.set(task.id, task);
        phaseOfTask.set(task.id, phase);
      }
    }
  }

  const taskStatusCache = new Map<string, TaskStatus>();
  const phaseStatusCache = new Map<string, PhaseStatus>();
  const blockedCache = new Map<string, boolean>();
  // Re-entrancy guards: a roadmap that skipped validation could be cyclic, and derive must never
  // loop on it. A node still being derived reports a not-done status, which is the only answer
  // its dependents and blockers would ever act on.
  const taskVisiting = new Set<string>();
  const phaseVisiting = new Set<string>();

  const dependencyStatus = (dep: TaskSlug): TaskStatus => {
    const def = taskById.get(dep);
    // An unknown dependency never counts as done, so dependents stay waiting instead of crashing.
    return def === undefined ? 'waiting' : taskStatus(def);
  };

  const phaseBlocked = (phase: PhaseDef): boolean => {
    const cached = blockedCache.get(phase.id);
    if (cached !== undefined) return cached;
    const blocked = phase.blockedBy.some((blocker: PhaseSlug) => phaseStatusOf(blocker) !== 'done');
    blockedCache.set(phase.id, blocked);
    return blocked;
  };

  const taskStatus = (task: TaskDef): TaskStatus => {
    if (taskVisiting.has(task.id)) return 'waiting';
    const cached = taskStatusCache.get(task.id);
    if (cached !== undefined) return cached;
    taskVisiting.add(task.id);
    const orders = ordersByTask.get(task.id);
    let status: TaskStatus;
    if (orders !== undefined && orders.length > 0) {
      status = orders.some((order) => order.status !== 'done') ? 'running' : 'done';
    } else {
      const ownPhase = phaseOfTask.get(task.id);
      const blocked = ownPhase === undefined ? false : phaseBlocked(ownPhase);
      status = task.dependsOn.every((dep) => dependencyStatus(dep) === 'done') && !blocked ? 'planned' : 'waiting';
    }
    taskVisiting.delete(task.id);
    taskStatusCache.set(task.id, status);
    return status;
  };

  const phaseStatusOf = (id: string): PhaseStatus => {
    const def = phaseById.get(id);
    // An unknown blocker never counts as done, so the blocked branch fires instead of crashing.
    if (def === undefined) return 'planned';
    return phaseStatus(def);
  };

  const phaseStatus = (phase: PhaseDef): PhaseStatus => {
    if (phaseVisiting.has(phase.id)) return 'planned';
    const cached = phaseStatusCache.get(phase.id);
    if (cached !== undefined) return cached;
    phaseVisiting.add(phase.id);
    // First matching rule wins: running beats all-done beats blocked, so finished work is never
    // reported as waiting even while a blocker is still open.
    let status: PhaseStatus;
    if (phase.tasks.some((task) => taskStatus(task) === 'running')) {
      status = 'running';
    } else if (phase.tasks.length > 0 && phase.tasks.every((task) => taskStatus(task) === 'done')) {
      status = 'done';
    } else if (phaseBlocked(phase)) {
      status = 'waiting';
    } else {
      status = 'planned';
    }
    phaseVisiting.delete(phase.id);
    phaseStatusCache.set(phase.id, status);
    return status;
  };

  const tasks: Record<string, TaskStatus> = {};
  const phases: Record<string, PhaseStatus> = {};
  const runnable: TaskSlug[] = [];
  for (const phase of roadmap.phases) {
    phases[phase.id] = phaseStatus(phase);
    for (const task of phase.tasks) {
      const firstDeclaration = !(task.id in tasks);
      const status = taskStatus(task);
      tasks[task.id] = status;
      if (status === 'planned' && firstDeclaration) runnable.push(task.id);
    }
  }
  return { tasks, phases, runnable };
}
