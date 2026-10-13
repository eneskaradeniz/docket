// roadmap/derive.ts — exact contract from docs/v2/domain.md section 10.
// Task and phase statuses are decided over the two acyclic graphs validation guarantees
// (task dependsOn, phase blockedBy). Memoised per call so each task and phase is decided once.
import type { PhaseSlug, RepoSlug, TaskSlug } from '../shared';
import type {
  LinkedWorkOrder,
  PhaseDef,
  PhaseItem,
  PhaseStatus,
  Progress,
  RepoIssue,
  RepoRoadmap,
  Roadmap,
  RoadmapView,
  TaskDef,
  TaskStatus,
} from './types';

const roadmapByRepo = (repoRoadmaps: readonly RepoRoadmap[]): ReadonlyMap<RepoSlug, RepoRoadmap> => {
  const out = new Map<RepoSlug, RepoRoadmap>();
  for (const entry of repoRoadmaps) {
    if (!out.has(entry.repo)) out.set(entry.repo, entry);
  }
  return out;
};

const issueById = (roadmap: RepoRoadmap): ReadonlyMap<string, RepoIssue> => {
  const out = new Map<string, RepoIssue>();
  for (const issue of roadmap.issues) {
    if (!out.has(issue.id)) out.set(issue.id, issue);
  }
  return out;
};

const milestoneById = (roadmap: RepoRoadmap): ReadonlySet<string> => {
  const out = new Set<string>();
  for (const milestone of roadmap.milestones) {
    out.add(milestone.id);
  }
  return out;
};

const leafDone = (issue: RepoIssue): boolean => issue.state === 'closed';

/** R-137: counts progress leaves for one phase item; unresolved refs count as one not-done leaf. */
const progressLeavesOfItem = (
  item: PhaseItem,
  repos: ReadonlyMap<RepoSlug, RepoRoadmap>,
): Progress => {
  if (item.kind === 'manual') {
    return { done: item.done ? 1 : 0, total: 1 };
  }
  const roadmap = repos.get(item.ref.repo);
  if (roadmap === undefined) return { done: 0, total: 1 };
  if (item.ref.kind === 'issue') {
    const issue = issueById(roadmap).get(item.ref.id);
    if (issue === undefined) return { done: 0, total: 1 };
    return { done: leafDone(issue) ? 1 : 0, total: 1 };
  }
  const milestones = milestoneById(roadmap);
  if (!milestones.has(item.ref.id)) return { done: 0, total: 1 };
  const issues = roadmap.issues.filter(
    (candidate) => candidate.milestone === item.ref.id && candidate.parent === undefined,
  );
  if (issues.length === 0) {
    const milestone = roadmap.milestones.find((entry) => entry.id === item.ref.id);
    const closed = milestone?.state === 'closed';
    return { done: closed ? 1 : 0, total: 1 };
  }
  let done = 0;
  for (const issue of issues) {
    if (leafDone(issue)) done += 1;
  }
  return { done, total: issues.length };
};

/** R-137: derived progress for a phase; never stored. */
export function deriveProgress(phase: PhaseDef, repoRoadmaps: readonly RepoRoadmap[]): Progress {
  const items = phase.items ?? [];
  if (items.length === 0) return { done: 0, total: 0 };
  const repos = roadmapByRepo(repoRoadmaps);
  let done = 0;
  let total = 0;
  for (const item of items) {
    const leaves = progressLeavesOfItem(item, repos);
    done += leaves.done;
    total += leaves.total;
  }
  return { done, total };
}

const phaseHasItems = (phase: PhaseDef): boolean => phase.items !== undefined && phase.items.length > 0;

export function deriveRoadmap(
  roadmap: Roadmap,
  workOrders: readonly LinkedWorkOrder[],
  repoRoadmaps: readonly RepoRoadmap[] = [],
): RoadmapView {
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
  const taskVisiting = new Set<string>();
  const phaseVisiting = new Set<string>();

  const dependencyStatus = (dep: TaskSlug): TaskStatus => {
    const def = taskById.get(dep);
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
    if (def === undefined) return 'planned';
    return phaseStatus(def);
  };

  /** R-41 phase status — used when R-138 does not apply or as its fallback branch. */
  const phaseStatusR41 = (phase: PhaseDef): PhaseStatus => {
    if (phase.tasks.some((entry) => taskStatus(entry) === 'running')) return 'running';
    if (phase.tasks.length > 0 && phase.tasks.every((entry) => taskStatus(entry) === 'done')) return 'done';
    if (phaseBlocked(phase)) return 'waiting';
    return 'planned';
  };

  const phaseStatus = (phase: PhaseDef): PhaseStatus => {
    if (phaseVisiting.has(phase.id)) return 'planned';
    const cached = phaseStatusCache.get(phase.id);
    if (cached !== undefined) return cached;
    phaseVisiting.add(phase.id);

    let status: PhaseStatus;
    if (!phaseHasItems(phase)) {
      status = phaseStatusR41(phase);
    } else {
      const progress = deriveProgress(phase, repoRoadmaps);
      if (progress.total === 0 && phase.tasks.length === 0) {
        status = phaseStatusR41(phase);
      } else if (phase.tasks.some((entry) => taskStatus(entry) === 'running')) {
        status = 'running';
      } else if (
        progress.total > 0 &&
        progress.done === progress.total &&
        (phase.tasks.length === 0 || phase.tasks.every((entry) => taskStatus(entry) === 'done'))
      ) {
        status = 'done';
      } else if (progress.done > 0) {
        status = 'running';
      } else if (phase.tasks.length > 0 && phase.tasks.every((entry) => taskStatus(entry) === 'done') && progress.total === 0) {
        status = 'done';
      } else {
        status = phaseStatusR41(phase);
      }
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
