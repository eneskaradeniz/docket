// use-cases/work-orders.ts — exact contract from docs/v2/application.md § 2 (rules A-5..A-7).
// The use cases only orchestrate: validation lives in the domain, decisions in `deriveWorkOrderState`.
import type {
  Actor,
  EnvironmentDef,
  FlowAction,
  FlowDef,
  FlowSlug,
  Result,
  TaskSlug,
  WorkOrderEvent,
  WorkOrderId,
  WorkOrderState,
  WorkspaceSlug,
} from '../../domain/index';
import { deriveWorkOrderState, err, nextAction, ok } from '../../domain/index';

import type { AppDeps, RunRecord, WorkOrderRecord } from '../ports';

export type OpenError = 'definitions_invalid' | 'unknown_flow' | 'flow_not_enabled' | 'unknown_task' | 'empty_title';

export async function openWorkOrder(
  deps: Pick<AppDeps, 'clock' | 'ids' | 'log' | 'workOrders' | 'definitions'>,
  input: {
    readonly workspace: WorkspaceSlug;
    readonly title: string;
    readonly flow?: FlowSlug;
    readonly task?: TaskSlug;
    readonly actor: Actor;
  },
): Promise<Result<WorkOrderId, OpenError>> {
  const title = input.title.trim();
  if (title === '') return err('empty_title');

  const loaded = await deps.definitions.load(input.workspace);
  if (!loaded.ok) return err('definitions_invalid');
  const workspace = loaded.value.workspace;
  // Opening needs a default flow and an enabled-flow list; definitions without a workspace
  // section cannot supply either.
  if (workspace === undefined) return err('definitions_invalid');

  const flow = input.flow ?? workspace.defaultFlow;
  if (!loaded.value.flows.some((candidate) => candidate.id === flow)) return err('unknown_flow');
  if (!workspace.flows.includes(flow)) return err('flow_not_enabled');

  if (input.task !== undefined) {
    const roadmap = await deps.definitions.loadRoadmap(input.workspace);
    if (roadmap === undefined) return err('unknown_task');
    if (!roadmap.ok) return err('definitions_invalid');
    const known = roadmap.value.phases.some((phase) => phase.tasks.some((task) => task.id === input.task));
    if (!known) return err('unknown_task');
  }

  const id = deps.ids.next<'work-order'>();
  const at = deps.clock.now();
  await deps.workOrders.create({
    id,
    workspace: input.workspace,
    flow,
    title,
    ...(input.task !== undefined ? { task: input.task } : {}),
    createdAt: at,
    createdBy: input.actor,
  });
  await deps.workOrders.appendEvent(id, { type: 'created', at, by: input.actor, flow });
  await deps.log.append({
    id: deps.ids.next<'audit'>(),
    at,
    actor: input.actor,
    action: 'work_order.opened',
    subject: { kind: 'work_order', id },
  });
  return ok(id);
}

export interface WorkOrderView {
  readonly record: WorkOrderRecord;
  readonly state: WorkOrderState;
  readonly next: FlowAction;
  readonly runs: readonly RunRecord[];
  /** The work order own flow from the current definitions: the detail screen derives its stage
   *  and gate list from it, so the renderer needs no definitions read of its own. */
  readonly flow: FlowDef;
  /** The workspace section's environments (protected, promoteFrom), same reason as `flow`. */
  readonly environments: readonly EnvironmentDef[];
}
export type ViewError = 'not_found' | 'definitions_invalid' | 'unknown_flow';

export async function getWorkOrder(
  deps: Pick<AppDeps, 'workOrders' | 'runs' | 'definitions'>,
  id: WorkOrderId,
): Promise<Result<WorkOrderView, ViewError>> {
  const record = await deps.workOrders.get(id);
  if (record === undefined) return err('not_found');

  const loaded = await deps.definitions.load(record.workspace);
  if (!loaded.ok) return err('definitions_invalid');
  const flow = loaded.value.flows.find((candidate) => candidate.id === record.flow);
  if (flow === undefined) return err('unknown_flow');

  // Everything below is derived per read from the current definitions; none of it is stored.
  const state = deriveWorkOrderState(flow, await deps.workOrders.events(id));
  const runs = await deps.runs.listForWorkOrder(id);
  return ok({
    record,
    state,
    next: nextAction(flow, state),
    runs,
    flow,
    environments: loaded.value.workspace?.environments ?? [],
  });
}

export type ControlError = 'not_found' | 'already_done' | 'not_blocked';

/** The done check available without a definitions pick: a `closed` event is final (R-23), so a
 *  work order carrying one is `already_done` for every control write. */
const isClosed = (events: readonly WorkOrderEvent[]): boolean =>
  events.some((event) => event.type === 'closed');

export async function blockWorkOrder(
  deps: Pick<AppDeps, 'clock' | 'ids' | 'log' | 'workOrders'>,
  input: { readonly id: WorkOrderId; readonly reason: string; readonly actor: Actor },
): Promise<Result<void, ControlError>> {
  const record = await deps.workOrders.get(input.id);
  if (record === undefined) return err('not_found');
  if (isClosed(await deps.workOrders.events(input.id))) return err('already_done');

  const at = deps.clock.now();
  await deps.workOrders.appendEvent(input.id, { type: 'blocked', at, by: input.actor, reason: input.reason });
  await deps.log.append({
    id: deps.ids.next<'audit'>(),
    at,
    actor: input.actor,
    action: 'work_order.blocked',
    subject: { kind: 'work_order', id: input.id },
  });
  return ok(undefined);
}

export async function unblockWorkOrder(
  deps: Pick<AppDeps, 'clock' | 'ids' | 'log' | 'workOrders' | 'definitions'>,
  input: { readonly id: WorkOrderId; readonly actor: Actor },
): Promise<Result<void, ControlError>> {
  const record = await deps.workOrders.get(input.id);
  if (record === undefined) return err('not_found');

  // `blocked` is a derived status (a failed gate blocks without any `blocked` event), so the
  // precondition can only be established by deriving the real state. When the state cannot be
  // derived at all, the precondition does not verifiably hold and nothing is written.
  const loaded = await deps.definitions.load(record.workspace);
  if (loaded.ok) {
    const flow: FlowDef | undefined = loaded.value.flows.find((candidate) => candidate.id === record.flow);
    if (flow !== undefined) {
      const events = await deps.workOrders.events(input.id);
      if (deriveWorkOrderState(flow, events).status !== 'blocked') return err('not_blocked');

      const at = deps.clock.now();
      await deps.workOrders.appendEvent(input.id, { type: 'unblocked', at, by: input.actor });
      await deps.log.append({
        id: deps.ids.next<'audit'>(),
        at,
        actor: input.actor,
        action: 'work_order.unblocked',
        subject: { kind: 'work_order', id: input.id },
      });
      return ok(undefined);
    }
  }
  return err('not_blocked');
}

export async function closeWorkOrder(
  deps: Pick<AppDeps, 'clock' | 'ids' | 'log' | 'workOrders'>,
  input: { readonly id: WorkOrderId; readonly actor: Actor },
): Promise<Result<void, ControlError>> {
  const record = await deps.workOrders.get(input.id);
  if (record === undefined) return err('not_found');
  if (isClosed(await deps.workOrders.events(input.id))) return err('already_done');

  const at = deps.clock.now();
  await deps.workOrders.appendEvent(input.id, { type: 'closed', at, by: input.actor });
  await deps.log.append({
    id: deps.ids.next<'audit'>(),
    at,
    actor: input.actor,
    action: 'work_order.closed',
    subject: { kind: 'work_order', id: input.id },
  });
  return ok(undefined);
}
