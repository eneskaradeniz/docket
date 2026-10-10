// services/advance-phases.ts — unattended phase advance (docs/v2/application.md A-111 … A-115).
// For every phase the operator started and has not paused, it opens and queues the tasks that just
// became runnable and refreshes which work orders need a person. It never starts another phase and
// never bypasses a refusal of the queueing flow (spend consent surfaces as before, A-15).
import type { Actor, PhaseAutoRun, WorkOrderId } from '../../domain/index';
import { deriveRoadmap, foldRun } from '../../domain/index';

import type { AppDeps } from '../ports/index';
import { listTaskWorkOrders, openAndQueueTask } from './run-phase';

export type AdvancePhasesDeps = Pick<
  AppDeps,
  'clock' | 'ids' | 'log' | 'queue' | 'workOrders' | 'definitions' | 'bindings' | 'accounts' | 'projects' | 'runs' | 'phaseAutoRuns'
>;

export interface AdvancePhasesResult {
  /** Tasks opened across every advanced phase in this call. */
  readonly opened: number;
}

const SYSTEM_ACTOR: Actor = { kind: 'system', component: 'phase-advance' };

/** Work orders with an unanswered permission ask, folded from each active run's stream (the cockpit's rule). */
const openAskOrders = async (deps: Pick<AppDeps, 'runs'>): Promise<ReadonlySet<WorkOrderId>> => {
  const asking = new Set<WorkOrderId>();
  for (const run of await deps.runs.listActive()) {
    if (foldRun(await deps.runs.events(run.id)).openPermissionAsks.length > 0) asking.add(run.workOrderId);
  }
  return asking;
};

const sameIds = (a: readonly WorkOrderId[], b: readonly WorkOrderId[]): boolean => a.length === b.length && a.every((id, index) => id === b[index]);

export async function advancePhases(deps: AdvancePhasesDeps): Promise<AdvancePhasesResult> {
  let opened = 0;
  for (const record of await deps.phaseAutoRuns.list()) {
    if (record.state !== 'running') continue;
    if ((await deps.projects.get(record.project)) === undefined) continue;
    const roadmap = await deps.definitions.loadRoadmap(record.project);
    if (roadmap === undefined || !roadmap.ok) continue;
    const phase = roadmap.value.phases.find((candidate) => candidate.id === record.phase);
    if (phase === undefined) continue;

    const linked = await listTaskWorkOrders(deps, record.project);
    const view = deriveRoadmap(roadmap.value, linked.map(({ task, status }) => ({ task, status })));
    if (view.phases[phase.id] === 'done') {
      await deps.phaseAutoRuns.put({ ...record, state: 'done', attention: [] });
      continue;
    }

    // A phase waiting on an earlier one has no runnable task (R-42), so this opens nothing for it.
    for (const task of phase.tasks) {
      if (!view.runnable.includes(task.id)) continue;
      const result = await openAndQueueTask(deps, { project: record.project, task: task.id, actor: SYSTEM_ACTOR });
      if (result.opened !== undefined) opened += 1;
    }

    // The cockpit's attention rule (A-22): blocked, waiting on a human or on a limit, or asking permission.
    const asking = await openAskOrders(deps);
    const taskIds = new Set(phase.tasks.map((task) => task.id));
    const attention = linked
      .filter(
        (order) =>
          taskIds.has(order.task) &&
          (asking.has(order.id) || order.status === 'blocked' || order.status === 'awaiting_human' || order.status === 'limit_waiting'),
      )
      .map((order) => order.id);
    if (!sameIds(attention, record.attention)) {
      const next: PhaseAutoRun = { ...record, attention };
      await deps.phaseAutoRuns.put(next);
    }
  }
  return { opened };
}
