// api/api.ts — createApi: the transport-free boundary. Every command maps onto one use case and
// every query onto one read model, all results plain JSON. Ids arrive here as strings and are
// parsed once, at the edge, so nothing beyond this file ever sees an unvalidated id (A-21).
// Phase 4 binds this same contract to Electron IPC.
import type {
  AccountRoute,
  Actor,
  AuthMode,
  FlowDef,
  Meter,
  Pool,
  Result,
  Slug,
  StageSlug,
  Ulid,
  WorkOrderId,
  WorkOrderEvent,
  WorkspaceSlug,
} from '../domain/index';
import { deriveWorkOrderState, foldRun, parseSlug, parseUlid } from '../domain/index';

import type {
  AccountRecord,
  AppDeps,
  BindingScope,
  DiscoveredProvider,
  PermissionBoard,
  ProviderDiscovery,
} from '../application';
import {
  approveAndDeploy,
  blockWorkOrder,
  closeWorkOrder,
  decideHumanGate,
  decideProposalUseCase,
  enqueueStage,
  getWorkOrder,
  openWorkOrder,
  removeAccount,
  saveAccount,
  saveBinding,
  unblockWorkOrder,
} from '../application';

import type { Command, CommandResult } from './commands';
import type {
  AttentionItem,
  BoardView,
  CockpitView,
  Query,
  SettingsAccountsView,
  SettingsBindingScope,
  SettingsBindingView,
  SettingsMeterView,
  SettingsPoolView,
  WorkspaceListItem,
} from './queries';

/** The push channel's events (U-12 of docs/v2/ui.md): coarse by design and never a payload — a
 *  store re-queries on receipt, so the channel survives every change of what the views show. */
export type UiEvent =
  | { readonly type: 'workOrders.changed' }
  | { readonly type: 'run.updated'; readonly runId: string };

export interface Api {
  command(actor: Actor, command: Command): Promise<CommandResult>;
  query(query: Query): Promise<unknown>; // narrowed per query type by the caller helpers below
  subscribe(listener: (e: UiEvent) => void): () => void;
}

/** Composition's feed for run-originated changes: the root hands this to the run executor as its
 *  notify hook — the executor cannot know the api, so the api reaches it only through injection. */
export interface RunEventFeed {
  runUpdated(runId: string): void;
}

/** Queries report failure exactly the way commands do, so every boundary result reads the same. */
type QueryFailure = Extract<CommandResult, { readonly ok: false }>;

/** The workspace registry's read side: the workspaces known to this machine. The registry is
 *  composed beside AppDeps (the composition root holds it next to deps), like the board and the
 *  discovery port, and the api sees only this structural slice of it. */
export interface WorkspaceRegistryPort {
  list(): Promise<readonly { readonly slug: WorkspaceSlug; readonly path: string }[]>;
}

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

/** The board is passed separately, like the executor's gate: it is in-process state, not a port.
 *  Without one no ask can be open, so `permission.answer` answers not_found instead of throwing.
 *  The discovery port is passed the same way: it is composed beside AppDeps at the root, and
 *  without it no provider can be reported, so `providers.discovered` answers not_found too. The
 *  workspace registry joins them: without it no workspace can be enumerated, so `workspaces.list`
 *  answers not_found as well. */
export function createApi(
  deps: AppDeps,
  board?: Pick<PermissionBoard, 'answer'>,
  discovery?: ProviderDiscovery,
  registry?: WorkspaceRegistryPort,
): Api & RunEventFeed {
  // The push channel (U-12): a Set keeps delivery to each listener once and makes unsubscribe a
  // plain delete.
  const listeners = new Set<(e: UiEvent) => void>();
  const emit = (event: UiEvent): void => {
    for (const listener of listeners) {
      try {
        listener(event);
      } catch {
        // Skipped by design: one broken listener must not silence the others or the command path.
      }
    }
  };

  return {
    command: async (actor, command) => {
      // workOrders.changed fires for a command that appended to the work order event log — the log
      // the board, cockpit and detail views derive from. The append is observed through a
      // per-command view, so the ports stay untouched for every other caller; the emission follows
      // the whole command, after its last append has landed.
      let appended = false;
      const tracked: AppDeps = {
        ...deps,
        workOrders: {
          ...deps.workOrders,
          appendEvent: async (id: WorkOrderId, event: WorkOrderEvent) => {
            await deps.workOrders.appendEvent(id, event);
            appended = true;
          },
        },
      };
      const result = await runCommand(tracked, actor, command, board);
      if (appended) emit({ type: 'workOrders.changed' });
      return result;
    },
    query: (query) => runQuery(deps, query, discovery, registry),
    subscribe: (listener) => {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
    runUpdated: (runId) => emit({ type: 'run.updated', runId }),
  };
}

const runCommand = async (
  deps: AppDeps,
  actor: Actor,
  command: Command,
  board: Pick<PermissionBoard, 'answer'> | undefined,
): Promise<CommandResult> => {
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

    case 'permission.answer': {
      const runId = ulidValue<'run'>(command.runId);
      if (runId === undefined) return invalidId();
      // runId is validated at the edge (A-21); the board routes by askId, because it knows which
      // run still owns the ask.
      if (board === undefined) return { ok: false, code: 'not_found' };
      const answered = board.answer(command.askId, command.decision);
      return answered.ok ? { ok: true } : { ok: false, code: answered.error };
    }

    case 'deploy.approve': {
      const id = ulidValue<'work-order'>(command.workOrderId);
      if (id === undefined) return invalidId();
      const gate = slugValue<'gate'>(command.gate);
      if (gate === undefined) return invalidId();
      // The confirmation is user-typed text whose equality with the gate's environment is the
      // whole point, so it travels verbatim: an unparseable value cannot equal one, and the use
      // case then answers the E-8 surface (confirmation_mismatch) instead of a parse error.
      const confirmedEnvironment =
        command.confirmedEnvironment === undefined ? undefined : slugValue<'env'>(command.confirmedEnvironment);
      // The actor passes through as the approver: the use case owns no_approval, so an agent
      // caller is refused exactly where every other approver rule lives.
      return commandOf(
        await approveAndDeploy(
          {
            clock: deps.clock,
            ids: deps.ids,
            log: deps.log,
            workOrders: deps.workOrders,
            definitions: deps.definitions,
            worktrees: deps.worktrees,
            commands: deps.commands,
            secrets: deps.secrets,
          },
          { id, gate, approver: actor, commit: command.commit, confirmedEnvironment },
        ),
      );
    }

    case 'account.save': {
      const id = command.id === undefined ? undefined : ulidValue<'account'>(command.id);
      if (id === undefined && command.id !== undefined) return invalidId();
      // authMode is a closed set in the record but a plain string on the wire; an unknown value is
      // rejected at the edge like a malformed id, because it must never reach a stored record.
      const authMode = AUTH_MODES.find((mode) => mode === command.authMode);
      if (authMode === undefined) return invalidId();

      // The command owns only the editable surface; policy, caps and the secret ref belong to
      // later surfaces and to the vault, so an update keeps whatever the store already holds.
      const existing = id === undefined ? undefined : await deps.accounts.get(id);
      const record: AccountRecord = {
        id: id ?? deps.ids.next<'account'>(),
        provider: command.provider,
        label: command.label,
        authMode,
        plan: command.plan,
        limitPolicy: existing?.limitPolicy ?? 'wait_resume',
        caps: existing?.caps ?? [],
        secretRef: existing?.secretRef,
      };
      const saved = await saveAccount(
        { clock: deps.clock, ids: deps.ids, log: deps.log, accounts: deps.accounts, secrets: deps.secrets },
        { record, actor },
      );
      return saved.ok ? { ok: true, id: record.id } : { ok: false, code: saved.error };
    }

    case 'account.remove': {
      const id = ulidValue<'account'>(command.id);
      if (id === undefined) return invalidId();
      const removed = await removeAccount(
        {
          clock: deps.clock,
          ids: deps.ids,
          log: deps.log,
          accounts: deps.accounts,
          secrets: deps.secrets,
          bindings: deps.bindings,
        },
        { id, actor },
      );
      if (removed.ok) return { ok: true };
      // binding_exists carries the referencing roles so the surface can name what to rebind.
      return typeof removed.error === 'string'
        ? { ok: false, code: removed.error }
        : { ok: false, code: removed.error.code, roles: removed.error.roles };
    }

    case 'binding.save': {
      const role = slugValue<'role'>(command.role);
      if (role === undefined) return invalidId();
      const accounts: AccountRoute[] = [];
      for (const entry of command.accounts) {
        const accountId = ulidValue<'account'>(entry.accountId);
        if (accountId === undefined) return invalidId();
        accounts.push(entry.model === undefined ? { accountId } : { accountId, model: entry.model });
      }
      // The settings command carries no scope: it edits the machine-global baseline that every
      // workspace inherits unless a more specific level overrides it.
      return commandOf(
        await saveBinding(
          { clock: deps.clock, ids: deps.ids, log: deps.log, bindings: deps.bindings },
          { scope: { level: 'global' }, binding: { role, accounts }, actor },
        ),
      );
    }
  }
};

const runQuery = async (
  deps: AppDeps,
  query: Query,
  discovery: ProviderDiscovery | undefined,
  registry: WorkspaceRegistryPort | undefined,
): Promise<unknown> => {
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

    case 'workspaces.list':
      return workspaceList(registry);

    case 'settings.accounts':
      return settingsAccountsView(deps);

    case 'providers.discovered':
      return discoveredProviders(discovery);
  }
};

/** The closed auth-mode set of the record; the wire type stays a plain string. */
const AUTH_MODES: readonly AuthMode[] = ['subscription', 'api_key', 'cloud', 'byok'];

/** A discovery pass kicks on every query; results arrive per provider and the promise of the pass
 *  ending is the promise of the answer. A provider's failure is its own null fields, never the
 *  query's, so one slow or broken CLI cannot blank the settings screen. */
const discoveredProviders = async (
  discovery: ProviderDiscovery | undefined,
): Promise<readonly DiscoveredProvider[] | QueryFailure> => {
  if (discovery === undefined) return { ok: false, code: 'not_found' };
  const collected: DiscoveredProvider[] = [];
  await discovery.discover((result) => {
    collected.push(result);
  });
  return collected;
};

/** The machine's known workspaces, read straight off the registry: the rows are already plain
 *  JSON, only the branded slug travels as its string. No registry, no enumeration — the query
 *  answers not_found instead of inventing an empty machine. */
const workspaceList = async (
  registry: WorkspaceRegistryPort | undefined,
): Promise<readonly WorkspaceListItem[] | QueryFailure> => {
  if (registry === undefined) return { ok: false, code: 'not_found' };
  const rows = await registry.list();
  return rows.map((row) => ({ id: row.slug, path: row.path }));
};

const poolView = (pool: Pool): SettingsPoolView => ({
  id: pool.id,
  label: pool.label,
  kind: pool.kind,
  appliesTo: pool.appliesTo,
});

const meterView = (meter: Meter): SettingsMeterView => ({
  id: meter.id,
  poolId: meter.poolId,
  label: meter.label ?? null,
  cadence: meter.cadence,
  durationMs: meter.durationMs ?? null,
  unit: meter.unit,
  used: meter.used ?? null,
  limit: meter.limit ?? null,
  remaining: meter.remaining ?? null,
  resetsAt: meter.resetsAt ?? null,
  resetPrecision: meter.resetPrecision,
  observedAt: meter.observedAt,
  source: meter.source,
  staleAfterMs: meter.staleAfterMs ?? null,
});

const bindingScopeView = (scope: BindingScope): SettingsBindingScope =>
  scope.level === 'global'
    ? { level: 'global' }
    : scope.level === 'workspace'
      ? { level: 'workspace', workspace: scope.workspace }
      : { level: 'workOrder', workOrderId: scope.workOrderId };

const settingsAccountsView = async (deps: AppDeps): Promise<SettingsAccountsView> => {
  const records = await deps.accounts.list();
  const pools = await deps.accounts.pools();
  const meters = await deps.accounts.meters();

  const accounts = records.map((record) => {
    const ownPools = pools.filter((pool) => pool.accountId === record.id);
    const ownPoolIds = new Set(ownPools.map((pool) => pool.id));
    return {
      id: record.id,
      provider: record.provider,
      label: record.label,
      authMode: record.authMode,
      plan: record.plan ?? null,
      pools: ownPools.map(poolView),
      meters: meters.filter((meter) => ownPoolIds.has(meter.poolId)).map(meterView),
    };
  });

  const bindings: readonly SettingsBindingView[] = (await deps.bindings.listAll()).map(({ scope, binding }) => ({
    scope: bindingScopeView(scope),
    role: binding.role,
    accounts: binding.accounts.map((route) => ({ accountId: route.accountId, model: route.model ?? null })),
  }));

  return { accounts, bindings };
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
