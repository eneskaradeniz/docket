// services/run-phase.ts — "run phase" (docs/v2/application.md rules A-97..A-100). Composes the
// existing task opening (A-25) and stage queueing (A-19) over one roadmap phase; it decides nothing
// the roadmap derivation (R-40, R-42) has not already decided.
import type { Actor, FlowDef, PhaseSlug, ProjectSlug, RepoSlug, Result, TaskSlug, WorkOrderId, WorkOrderStatus } from '../../domain/index';
import { deriveRoadmap, deriveWorkOrderState, err, ok } from '../../domain/index';

import type { AppDeps } from '../ports/index';
import { enqueueStage } from './dispatcher';
import { openTaskWorkOrders } from '../use-cases/index';

export type RunPhaseError = 'unknown_project' | 'no_roadmap' | 'definitions_invalid' | 'unknown_phase' | 'phase_not_runnable';

export interface PhaseRunOpened {
  readonly task: TaskSlug;
  readonly workOrders: readonly WorkOrderId[];
}

export interface PhaseRunFailure {
  readonly task: TaskSlug;
  /** Set when the work order was opened but could not be queued; it stays on the board. */
  readonly workOrder?: WorkOrderId;
  readonly error: string;
}

export interface PhaseRunResult {
  readonly opened: readonly PhaseRunOpened[];
  readonly failed: readonly PhaseRunFailure[];
}

type OpenTaskDeps = Pick<
  AppDeps,
  'clock' | 'ids' | 'log' | 'queue' | 'workOrders' | 'definitions' | 'bindings' | 'accounts' | 'projects' | 'runs'
>;

type RunPhaseDeps = OpenTaskDeps & Pick<AppDeps, 'phaseAutoRuns'>;

/** A work order of the project that names a task, with the status its events derive. */
export interface TaskWorkOrder {
  readonly id: WorkOrderId;
  readonly task: TaskSlug;
  readonly status: WorkOrderStatus;
}

/** Only work orders that name a task take part; one whose flow no longer loads has no derivable
 *  status and is left out, as the roadmap page does. */
export async function listTaskWorkOrders(deps: Pick<AppDeps, 'definitions' | 'workOrders'>, project: ProjectSlug): Promise<readonly TaskWorkOrder[]> {
  const flows = new Map<RepoSlug, readonly FlowDef[]>();
  const flowsOf = async (repo: RepoSlug): Promise<readonly FlowDef[]> => {
    const known = flows.get(repo);
    if (known !== undefined) return known;
    const loaded = await deps.definitions.load(repo);
    const found = loaded.ok ? loaded.value.flows : [];
    flows.set(repo, found);
    return found;
  };
  const linked: TaskWorkOrder[] = [];
  for (const record of await deps.workOrders.list({ project })) {
    if (record.task === undefined) continue;
    const flow = (await flowsOf(record.repo)).find((candidate) => candidate.id === record.flow);
    if (flow === undefined) continue;
    linked.push({ id: record.id, task: record.task, status: deriveWorkOrderState(flow, await deps.workOrders.events(record.id)).status });
  }
  return linked;
}

/** Opens one task's work orders (A-25) and queues each (A-19). Shared by `runPhase` and
 *  `advancePhases` so both open a task exactly alike; a task that cannot open is `opened: undefined`. */
export async function openAndQueueTask(
  deps: OpenTaskDeps,
  input: { readonly project: ProjectSlug; readonly task: TaskSlug; readonly actor: Actor },
): Promise<{ readonly opened?: PhaseRunOpened; readonly failed: readonly PhaseRunFailure[] }> {
  const created = await openTaskWorkOrders(deps, input);
  if (!created.ok) return { failed: [{ task: input.task, error: created.error }] };
  const failed: PhaseRunFailure[] = [];
  for (const id of created.value) {
    const queued = await enqueueStage(deps, { id });
    if (!queued.ok) failed.push({ task: input.task, workOrder: id, error: queued.error });
  }
  return { opened: { task: input.task, workOrders: created.value }, failed };
}

export async function runPhase(
  deps: RunPhaseDeps,
  input: { readonly project: ProjectSlug; readonly phase: PhaseSlug; readonly actor: Actor },
): Promise<Result<PhaseRunResult, RunPhaseError>> {
  if ((await deps.projects.get(input.project)) === undefined) return err('unknown_project');
  const roadmap = await deps.definitions.loadRoadmap(input.project);
  if (roadmap === undefined) return err('no_roadmap');
  if (!roadmap.ok) return err('definitions_invalid');
  const phase = roadmap.value.phases.find((candidate) => candidate.id === input.phase);
  if (phase === undefined) return err('unknown_phase');

  const linked = (await listTaskWorkOrders(deps, input.project)).map(({ task, status }) => ({ task, status }));

  const view = deriveRoadmap(roadmap.value, linked);
  const status = view.phases[phase.id];
  if (status === 'waiting' || status === 'done') return err('phase_not_runnable');

  const opened: PhaseRunOpened[] = [];
  const failed: PhaseRunFailure[] = [];
  for (const task of phase.tasks) {
    if (!view.runnable.includes(task.id)) continue;

    const result = await openAndQueueTask(deps, { project: input.project, task: task.id, actor: input.actor });
    if (result.opened !== undefined) opened.push(result.opened);
    failed.push(...result.failed);
  }

  // The operator's start (or restart) is what makes the phase advance unattended (A-109).
  const known = await deps.phaseAutoRuns.get(input.project, input.phase);
  if (known === undefined || known.state !== 'running') {
    await deps.phaseAutoRuns.put({ project: input.project, phase: input.phase, state: 'running', startedAt: deps.clock.now(), attention: [] });
  }

  await deps.log.append({
    id: deps.ids.next<'audit'>(),
    at: deps.clock.now(),
    actor: input.actor,
    action: 'phase.run',
    subject: { kind: 'project', id: input.project },
    detail: { project: input.project, phase: input.phase, opened: opened.length, failed: failed.length },
  });
  return ok({ opened, failed });
}
