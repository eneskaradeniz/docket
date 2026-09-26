// api/api.ts — createApi: the transport-free boundary. Every command maps onto one use case and
// every query onto one read model, all results plain JSON. Ids arrive here as strings and are
// parsed once, at the edge, so nothing beyond this file ever sees an unvalidated id (A-21).
// Phase 4 binds this same contract to Electron IPC.
import type { Actor, FlowDef, Result, Slug, StageSlug, Ulid, WorkOrderId, WorkspaceSlug } from '../domain/index';
import { deriveWorkOrderState, foldRun, parseSlug, parseUlid } from '../domain/index';

import type { AppDeps } from '../application';
import {
  blockWorkOrder,
  closeWorkOrder,
  decideHumanGate,
  decideProposalUseCase,
  enqueueStage,
  getWorkOrder,
  openWorkOrder,
  unblockWorkOrder,
} from '../application';

import type { Command, CommandResult } from './commands';
import type { AttentionItem, BoardView, CockpitView, Query } from './queries';

export interface Api {
  command(actor: Actor, command: Command): Promise<CommandResult>;
  query(query: Query): Promise<unknown>; // narrowed per query type by the caller helpers below
}

/** Queries report failure exactly the way commands do, so every boundary result reads the same. */
type QueryFailure = Extract<CommandResult, { readonly ok: false }>;

/** A fresh literal every time: results are the caller's data, never shared module state. */
const invalidId = (): CommandResult => ({ ok: false, code: 'invalid_id' });

/** undefined = the input is not a valid slug; the caller answers with invalid_id and runs nothing. */
const slugValue = <B extends string>(input: string): Slug<B> | undefined => {
  const parsed = parseSlug<B>(input);
  return parsed.ok ? parsed.value : undefined;
};

/** undefined = the input is not a valid ULID; the caller answers with invalid_id and runs nothing. */
const ulidValue = <B extends string>(input: string): Ulid<B> | undefined => {
  const parsed = parseUlid<B>(input);
  return parsed.ok ? parsed.value : undefined;
};

const commandOf = <E extends string>(outcome: Result<unknown, E>): CommandResult =>
  outcome.ok ? { ok: true } : { ok: false, code: outcome.error };

export function createApi(deps: AppDeps): Api {
  return {
    command: (actor, command) => runCommand(deps, actor, command),
    query: (query) => runQuery(deps, query),
  };
}

const runCommand = async (deps: AppDeps, actor: Actor, command: Command): Promise<CommandResult> => {
  switch (command.type) {
    case 'workOrder.open': {
      const workspace = slugValue<'workspace'>(command.workspace);
      if (workspace === undefined) return invalidId();
      const flow = command.flow === undefined ? undefined : slugValue<'flow'>(command.flow);
      if (flow === undefined && command.flow !== undefined) return invalidId();
      const task = command.task === undefined ? undefined : slugValue<'task'>(command.task);
      if (task === undefined && command.task !== undefined) return invalidId();

      const opened = await openWorkOrder(
        { clock: deps.clock, ids: deps.ids, log: deps.log, workOrders: deps.workOrders, definitions: deps.definitions },
        { workspace, title: command.title, flow, task, actor },
      );
      return opened.ok ? { ok: true, id: opened.value } : { ok: false, code: opened.error };
    }

    case 'workOrder.block': {
      const id = ulidValue<'work-order'>(command.id);
      if (id === undefined) return invalidId();
      return commandOf(
        await blockWorkOrder(
          { clock: deps.clock, ids: deps.ids, log: deps.log, workOrders: deps.workOrders },
          { id, reason: command.reason, actor },
        ),
      );
    }

    case 'workOrder.unblock': {
      const id = ulidValue<'work-order'>(command.id);
      if (id === undefined) return invalidId();
      return commandOf(
        await unblockWorkOrder(
          { clock: deps.clock, ids: deps.ids, log: deps.log, workOrders: deps.workOrders, definitions: deps.definitions },
          { id, actor },
        ),
      );
    }

    case 'workOrder.close': {
      const id = ulidValue<'work-order'>(command.id);
      if (id === undefined) return invalidId();
      return commandOf(
        await closeWorkOrder(
          { clock: deps.clock, ids: deps.ids, log: deps.log, workOrders: deps.workOrders },
          { id, actor },
        ),
      );
    }

    case 'workOrder.enqueue': {
      const id = ulidValue<'work-order'>(command.id);
      if (id === undefined) return invalidId();
      const queued = await enqueueStage(
        {
          clock: deps.clock,
          ids: deps.ids,
          queue: deps.queue,
          workOrders: deps.workOrders,
          definitions: deps.definitions,
          bindings: deps.bindings,
          accounts: deps.accounts,
        },
        { id },
      );
      return queued.ok ? { ok: true, id: queued.value } : { ok: false, code: queued.error };
    }

    case 'gate.decide': {
      const id = ulidValue<'work-order'>(command.workOrderId);
      if (id === undefined) return invalidId();
      const gate = slugValue<'gate'>(command.gate);
      if (gate === undefined) return invalidId();
      return commandOf(
        await decideHumanGate(
          { clock: deps.clock, ids: deps.ids, log: deps.log, workOrders: deps.workOrders, definitions: deps.definitions },
          { id, gate, decision: command.decision, note: command.note, actor },
        ),
      );
    }

    case 'proposal.decide': {
      const id = ulidValue<'proposal'>(command.id);
      if (id === undefined) return invalidId();
      const decided = await decideProposalUseCase(
        { clock: deps.clock, ids: deps.ids, log: deps.log, proposals: deps.proposals, definitions: deps.definitions },
        { id, decision: command.decision, actor },
      );
      return decided.ok ? { ok: true, id: decided.value.id } : { ok: false, code: decided.error };
    }
  }
};

const runQuery = async (deps: AppDeps, query: Query): Promise<unknown> => {
  switch (query.type) {
    case 'workOrder.detail': {
      const id = ulidValue<'work-order'>(query.id);
      if (id === undefined) return invalidId();
      const view = await getWorkOrder(
        { workOrders: deps.workOrders, runs: deps.runs, definitions: deps.definitions },
        id,
      );
      return view.ok ? view.value : { ok: false, code: view.error };
    }

    case 'cockpit':
      return cockpitView(deps);

    case 'workspace.board': {
      const workspace = slugValue<'workspace'>(query.workspace);
      if (workspace === undefined) return invalidId();
      return boardView(deps, workspace);
    }
  }
};

/** Attention kinds in the order the cockpit shows them (A-22): what a human can answer fastest first. */
const KIND_RANK: Readonly<Record<AttentionItem['kind'], number>> = {
  permission_ask: 0,
  awaiting_human: 1,
  blocked: 2,
  limit_waiting: 3,
};

/** The flows of one workspace, loaded once per query no matter how many work orders sit in it. */
const flowCache = (deps: AppDeps) => {
  const byWorkspace = new Map<WorkspaceSlug, readonly FlowDef[]>();
  return async (workspace: WorkspaceSlug): Promise<readonly FlowDef[]> => {
    const cached = byWorkspace.get(workspace);
    if (cached !== undefined) return cached;
    const loaded = await deps.definitions.load(workspace);
    const flows = loaded.ok ? loaded.value.flows : [];
    byWorkspace.set(workspace, flows);
    return flows;
  };
};

const cockpitView = async (deps: AppDeps): Promise<CockpitView> => {
  const flowsOf = flowCache(deps);
  const active = await deps.runs.listActive();

  // The earliest still-open permission ask per work order, folded from each active run's stream:
  // an ask is open until a tool_result of the same id arrives.
  const askSinceByWorkOrder = new Map<WorkOrderId, number>();
  for (const run of active) {
    const events = await deps.runs.events(run.id);
    const open = foldRun(events).openPermissionAsks;
    if (open.length === 0) continue;
    const openIds = new Set(open);
    for (const event of events) {
      if (event.type !== 'permission_ask' || !openIds.has(event.id)) continue;
      const known = askSinceByWorkOrder.get(run.workOrderId);
      if (known === undefined || event.at < known) askSinceByWorkOrder.set(run.workOrderId, event.at);
    }
  }

  const attention: AttentionItem[] = [];
  for (const record of await deps.workOrders.list({})) {
    const flow = (await flowsOf(record.workspace)).find((candidate) => candidate.id === record.flow);
    // A work order whose definitions no longer load has no derivable state and so no attention
    // kind; one broken workspace must not blank the whole cockpit.
    if (flow === undefined) continue;
    const events = await deps.workOrders.events(record.id);
    const state = deriveWorkOrderState(flow, events);

    const askSince = askSinceByWorkOrder.get(record.id);
    const kind: AttentionItem['kind'] | undefined =
      askSince !== undefined
        ? 'permission_ask'
        : state.status === 'awaiting_human'
          ? 'awaiting_human'
          : state.status === 'blocked'
            ? 'blocked'
            : state.status === 'limit_waiting'
              ? 'limit_waiting'
              : undefined;
    if (kind === undefined) continue;

    // `since` is when the wait was last established: the unanswered ask's arrival, else the newest
    // event of the work order (its creation time stands in for a history that should not be empty).
    const lastEvent = events[events.length - 1];
    const since = askSince ?? (lastEvent === undefined ? record.createdAt : lastEvent.at);
    attention.push({
      workOrderId: record.id,
      workspace: record.workspace,
      title: record.title,
      kind,
      stage: state.stage,
      since,
    });
  }

  attention.sort((a, b) => KIND_RANK[a.kind] - KIND_RANK[b.kind] || a.since - b.since);

  return {
    attention,
    running: active.map((run) => ({
      workOrderId: run.workOrderId,
      stage: run.stage,
      accountId: run.route.accountId,
      startedAt: run.startedAt,
    })),
  };
};

const boardView = async (deps: AppDeps, workspace: WorkspaceSlug): Promise<BoardView | QueryFailure> => {
  const loaded = await deps.definitions.load(workspace);
  if (!loaded.ok) return { ok: false, code: 'definitions_invalid' };
  // Without a workspace section there is no default flow to build columns from.
  const def = loaded.value.workspace;
  if (def === undefined) return { ok: false, code: 'definitions_invalid' };
  const flow = loaded.value.flows.find((candidate) => candidate.id === def.defaultFlow);
  if (flow === undefined) return { ok: false, code: 'definitions_invalid' };

  const placed = new Map<StageSlug, { readonly id: string; readonly title: string; readonly status: string }[]>();
  const done: { readonly id: string; readonly title: string }[] = [];
  for (const record of await deps.workOrders.list({ workspace })) {
    // State derives from the work order's own flow; the columns come from the default flow.
    const ownFlow = loaded.value.flows.find((candidate) => candidate.id === record.flow);
    if (ownFlow === undefined) continue;
    const state = deriveWorkOrderState(ownFlow, await deps.workOrders.events(record.id));

    if (state.status === 'done') {
      done.push({ id: record.id, title: record.title });
      continue;
    }
    // A current stage the default flow does not have leaves the work order off this board: there
    // is no column to sit in and it is not finished.
    if (state.stage === null || !flow.stages.some((stage) => stage.id === state.stage)) continue;
    const item = { id: record.id, title: record.title, status: state.status };
    const column = placed.get(state.stage);
    if (column === undefined) placed.set(state.stage, [item]);
    else column.push(item);
  }

  return {
    workspace,
    flow: def.defaultFlow,
    columns: flow.stages.map((stage) => ({ stage: stage.id, name: stage.name, workOrders: placed.get(stage.id) ?? [] })),
    done,
  };
};
