// api/api.ts — createApi: the transport-free boundary. Every command maps onto one use case and
// every query onto one read model, all results plain JSON. Ids arrive here as strings and are
// parsed once, at the edge, so nothing beyond this file ever sees an unvalidated id (A-21).
// Phase 4 binds this same contract to Electron IPC.
import type {
  AccountId,
  AccountRoute,
  Actor,
  AuthMode,
  EpochMs,
  FlowDef,
  Meter,
  Pool,
  ProjectSlug,
  Result,
  Slug,
  StageSlug,
  TaskSlug,
  Ulid,
  WorkOrderId,
  WorkOrderEvent,
  WorkOrderStatus,
  RepoSlug,
} from '../domain/index';
import { deriveRoadmap, deriveWorkOrderState, foldRun, headroom, parseSlug, parseUlid } from '../domain/index';

import type {
  AccountRecord,
  AppDeps,
  BindingScope,
  DiscoveredProvider,
  PermissionBoard,
  ProviderDiscovery,
  ProviderMarks,
  UpdateChecker,
} from '../application';
import {
  approveAndDeploy,
  applyUpdate,
  attachProject,
  blockWorkOrder,
  checkForUpdates,
  closeWorkOrder,
  decideHumanGate,
  decideProposalUseCase,
  enqueueStage,
  getUpdateState,
  getWorkOrder,
  openTaskWorkOrders,
  openWorkOrder,
  registerRepo,
  removeAccount,
  saveAccount,
  saveBinding,
  unblockWorkOrder,
  unregisterRepo,
} from '../application';

import type { Command, CommandResult } from './commands';
import type {
  AccountDetailView,
  AttentionItem,
  BoardView,
  CockpitView,
  OpenAskView,
  ProjectSpendView,
  ProjectTree,
  ProjectTreeItem,
  Query,
  RepoNode,
  RoadmapPageView,
  SettingsAccountsView,
  SettingsBindingScope,
  SettingsBindingView,
  SettingsMeterView,
  SettingsPoolView,
  RepoListItem,
} from './queries';
import { RUN_EVENTS_TAIL_LIMIT } from './queries';

/** The push channel's events (U-12 of docs/v2/ui.md): coarse by design and never a payload — a
 *  store re-queries on receipt, so the channel survives every change of what the views show. */
export type UiEvent =
  | { readonly type: 'workOrders.changed' }
  | { readonly type: 'run.updated'; readonly runId: string }
  | { readonly type: 'update.changed' };

export interface Api {
  command(actor: Actor, command: Command): Promise<CommandResult>;
  query(query: Query): Promise<unknown>; // narrowed per query type by the caller helpers below
  subscribe(listener: (e: UiEvent) => void): () => void;
}

/** Composition's feed for run-originated changes: the root hands these to the run executor as its
 *  notify hooks — the executor cannot know the api, so the api reaches it only through injection.
 *  `workOrdersChanged` backs the executor's run-finished append to the work order log, the one
 *  append no command ever observes. */
export interface RunEventFeed {
  runUpdated(runId: string): void;
  workOrdersChanged(): void;
}

/** Queries report failure exactly the way commands do, so every boundary result reads the same. */
type QueryFailure = Extract<CommandResult, { readonly ok: false }>;

/** The repo registry's read side: the repos known to this machine. The registry is
 *  composed beside AppDeps (the composition root holds it next to deps), like the board and the
 *  discovery port, and the api sees only this structural slice of it. */
export interface RepoRegistryPort {
  list(): Promise<readonly { readonly slug: RepoSlug; readonly path: string }[]>;
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
 *  Without one no ask can be open, so `permission.answer` answers not_found instead of throwing
 *  and `permissions.open` answers not_found instead of inventing an empty board. The discovery
 *  port is passed the same way: it is composed beside AppDeps at the root, and without it no
 *  provider can be reported, so `providers.discovered` answers not_found too. The repo
 *  registry joins them: without it no repo can be enumerated, so `repos.list` answers
 *  not_found as well. The update checker completes the set: without it no update state exists,
 *  so `app.update` and its intents answer not_found instead of inventing "you are current". The
 *  marks source rides the same pattern: without it there are no provider marks to report, so
 *  `providers.marks` answers not_found instead of inventing an empty record. */
export function createApi(
  deps: AppDeps,
  board?: Pick<PermissionBoard, 'answer' | 'openAsks'>,
  discovery?: ProviderDiscovery,
  registry?: RepoRegistryPort,
  updates?: UpdateChecker,
  marks?: ProviderMarks,
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
      const result = await runCommand(tracked, actor, command, board, updates);
      if (appended) emit({ type: 'workOrders.changed' });
      // update.changed rides the same coarse pattern as workOrders.changed: the command answers
      // ok, the event tells every store to re-query — CommandResult carries no state payload. A
      // refused apply (not_available) changed nothing, so it stays silent.
      if (result.ok && (command.type === 'app.update.check' || command.type === 'app.update.apply')) {
        emit({ type: 'update.changed' });
      }
      return result;
    },
    query: (query) => runQuery(deps, query, discovery, registry, board, updates, marks),
    subscribe: (listener) => {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
    runUpdated: (runId) => emit({ type: 'run.updated', runId }),
    workOrdersChanged: () => emit({ type: 'workOrders.changed' }),
  };
}

const runCommand = async (
  deps: AppDeps,
  actor: Actor,
  command: Command,
  board: Pick<PermissionBoard, 'answer'> | undefined,
  updates: UpdateChecker | undefined,
): Promise<CommandResult> => {
  switch (command.type) {
    case 'workOrder.open': {
      const project = slugValue<'project'>(command.project);
      if (project === undefined) return invalidId();
      const repo = slugValue<'repo'>(command.repo);
      if (repo === undefined) return invalidId();
      const flow = command.flow === undefined ? undefined : slugValue<'flow'>(command.flow);
      if (flow === undefined && command.flow !== undefined) return invalidId();
      const task = command.task === undefined ? undefined : slugValue<'task'>(command.task);
      if (task === undefined && command.task !== undefined) return invalidId();

      const opened = await openWorkOrder(
        { clock: deps.clock, ids: deps.ids, log: deps.log, workOrders: deps.workOrders, definitions: deps.definitions, projects: deps.projects },
        { project, repo, title: command.title, flow, task, actor },
      );
      return opened.ok ? { ok: true, id: opened.value } : { ok: false, code: opened.error };
    }

    case 'task.open': {
      const project = slugValue<'project'>(command.project);
      if (project === undefined) return invalidId();
      const task = slugValue<'task'>(command.task);
      if (task === undefined) return invalidId();
      const opened = await openTaskWorkOrders(
        { clock: deps.clock, ids: deps.ids, log: deps.log, workOrders: deps.workOrders, definitions: deps.definitions, projects: deps.projects },
        { project, task, actor },
      );
      return opened.ok ? { ok: true } : { ok: false, code: opened.error };
    }

    case 'project.attach': {
      // The optional repo registrations ride along as plain slugs; one bad slug rejects the
      // whole command before any port is touched (A-21).
      const repos: { readonly repo: RepoSlug; readonly path: string }[] = [];
      for (const entry of command.repos ?? []) {
        const repo = slugValue<'repo'>(entry.repo);
        if (repo === undefined) return invalidId();
        repos.push({ repo, path: entry.path });
      }
      const attached = await attachProject(
        { clock: deps.clock, ids: deps.ids, log: deps.log, projects: deps.projects, repos: deps.repos, definitions: deps.definitions, git: deps.git },
        { path: command.path, repos: repos.length === 0 ? undefined : repos, actor },
      );
      return attached.ok ? { ok: true, id: attached.value.id } : { ok: false, code: attached.error };
    }

    case 'repo.register': {
      const project = slugValue<'project'>(command.project);
      if (project === undefined) return invalidId();
      const repo = slugValue<'repo'>(command.repo);
      if (repo === undefined) return invalidId();
      return commandOf(
        await registerRepo(
          { clock: deps.clock, ids: deps.ids, log: deps.log, projects: deps.projects, repos: deps.repos, workOrders: deps.workOrders },
          { project, repo, path: command.path, actor },
        ),
      );
    }

    case 'repo.unregister': {
      const project = slugValue<'project'>(command.project);
      if (project === undefined) return invalidId();
      const repo = slugValue<'repo'>(command.repo);
      if (repo === undefined) return invalidId();
      return commandOf(
        await unregisterRepo(
          { clock: deps.clock, ids: deps.ids, log: deps.log, projects: deps.projects, repos: deps.repos, workOrders: deps.workOrders },
          { project, repo, actor },
        ),
      );
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
          projects: deps.projects,
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

      // The command owns only the editable surface; policy, caps, the secret ref and the route
      // fields belong to later surfaces and to the vault, so an update keeps whatever the store
      // already holds — an account saved with a route keeps riding it.
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
        routeKind: existing?.routeKind,
        endpoint: existing?.endpoint,
        identityDir: existing?.identityDir,
        tierModels: existing?.tierModels,
      };
      const saved = await saveAccount(
        {
          clock: deps.clock,
          ids: deps.ids,
          log: deps.log,
          accounts: deps.accounts,
          secrets: deps.secrets,
          capabilities: deps.capabilities,
        },
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
      // repo inherits unless a more specific level overrides it.
      return commandOf(
        await saveBinding(
          { clock: deps.clock, ids: deps.ids, log: deps.log, bindings: deps.bindings },
          { scope: { level: 'global' }, binding: { role, accounts }, actor },
        ),
      );
    }

    case 'app.update.check': {
      if (updates === undefined) return { ok: false, code: 'not_found' };
      // The re-check runs for its side effect on the checker's state; the answer itself travels
      // through update.changed and the re-query it triggers.
      await checkForUpdates(updates);
      return { ok: true };
    }

    case 'app.update.apply': {
      if (updates === undefined) return { ok: false, code: 'not_found' };
      return commandOf(await applyUpdate(updates));
    }
  }
};

const runQuery = async (
  deps: AppDeps,
  query: Query,
  discovery: ProviderDiscovery | undefined,
  registry: RepoRegistryPort | undefined,
  board: Pick<PermissionBoard, 'answer' | 'openAsks'> | undefined,
  updates: UpdateChecker | undefined,
  marks: ProviderMarks | undefined,
): Promise<unknown> => {
  switch (query.type) {
    case 'workOrder.detail': {
      const id = ulidValue<'work-order'>(query.id);
      if (id === undefined) return invalidId();
      const view = await getWorkOrder(
        { workOrders: deps.workOrders, runs: deps.runs, definitions: deps.definitions },
        id,
      );
      if (!view.ok) return { ok: false, code: view.error };
      // The detail names its work order, so it carries the A-29 number like every view item. The
      // record the use case just read always numbers; undefined would mean it vanished between
      // the two reads, which the never-deleted rule rules out.
      const number = await deps.workOrders.number(id);
      return number === undefined ? { ok: false, code: 'not_found' } : { ...view.value, number };
    }

    case 'cockpit': {
      const project = query.project === undefined ? undefined : slugValue<'project'>(query.project);
      if (project === undefined && query.project !== undefined) return invalidId();
      return cockpitView(deps, project);
    }

    case 'project.tree':
      return projectTree(deps);

    case 'roadmap.byProject': {
      const project = slugValue<'project'>(query.project);
      if (project === undefined) return invalidId();
      return roadmapView(deps, project);
    }

    case 'account.detail': {
      const id = ulidValue<'account'>(query.id);
      if (id === undefined) return invalidId();
      return accountDetailView(deps, id);
    }

    case 'project.spend': {
      const project = slugValue<'project'>(query.project);
      if (project === undefined) return invalidId();
      return projectSpendView(deps, project);
    }

    case 'repo.board': {
      const repo = slugValue<'repo'>(query.repo);
      if (repo === undefined) return invalidId();
      return boardView(deps, repo);
    }

    case 'repos.list':
      return repoList(registry);

    case 'settings.accounts':
      return settingsAccountsView(deps);

    case 'providers.discovered':
      return discoveredProviders(discovery);

    case 'providers.marks': {
      // The defs' own static data, read off the composed marks source verbatim — no derivation,
      // no stored copy. Without a source there is nothing to report.
      if (marks === undefined) return { ok: false, code: 'not_found' };
      return marks.marks();
    }

    case 'run.events': {
      const runId = ulidValue<'run'>(query.runId);
      if (runId === undefined) return invalidId();
      // The repo answers an empty stream for an unknown id too, so existence is checked first:
      // a missing run is a failure, an eventless run is a legitimate empty tail.
      if ((await deps.runs.get(runId)) === undefined) return { ok: false, code: 'not_found' };
      // Arrival order is the fold order (newest last); the bound keeps the reply a tail.
      return (await deps.runs.events(runId)).slice(-RUN_EVENTS_TAIL_LIMIT);
    }

    case 'permissions.open': {
      if (board === undefined) return { ok: false, code: 'not_found' };
      const asks: OpenAskView[] = [];
      for (const ask of board.openAsks()) {
        const run = await deps.runs.get(ask.runId);
        const workOrder = run === undefined ? undefined : await deps.workOrders.get(run.workOrderId);
        asks.push({ runId: ask.runId, askId: ask.askId, since: ask.since, title: workOrder?.title ?? null });
      }
      return asks;
    }

    case 'app.update': {
      // The state is already the view: plain JSON, no derivation, nothing stored.
      if (updates === undefined) return { ok: false, code: 'not_found' };
      return getUpdateState(updates);
    }
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

/** The machine's known repos, read straight off the registry: the rows are already plain
 *  JSON, only the branded slug travels as its string. No registry, no enumeration — the query
 *  answers not_found instead of inventing an empty machine. */
const repoList = async (
  registry: RepoRegistryPort | undefined,
): Promise<readonly RepoListItem[] | QueryFailure> => {
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
    : scope.level === 'project'
      ? { level: 'project', project: scope.project }
      : scope.level === 'repo'
        ? { level: 'repo', repo: scope.repo }
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

/** The flows of one repo, loaded once per query no matter how many work orders sit in it. */
const flowCache = (deps: AppDeps) => {
  const byRepo = new Map<RepoSlug, readonly FlowDef[]>();
  return async (repo: RepoSlug): Promise<readonly FlowDef[]> => {
    const cached = byRepo.get(repo);
    if (cached !== undefined) return cached;
    const loaded = await deps.definitions.load(repo);
    const flows = loaded.ok ? loaded.value.flows : [];
    byRepo.set(repo, flows);
    return flows;
  };
};

/** The derived status of every listed work order, plus its attention kind. Records whose flow no
 *  longer loads have no derivable state — they count as active but carry no attention kind, so one
 *  broken repo never blanks the whole cockpit. */
interface DerivedOrder {
  readonly record: WorkOrderRecordView;
  readonly status: string | undefined;
  readonly stage: string | null;
  readonly kind: AttentionItem['kind'] | undefined;
  readonly since: number;
}

type WorkOrderRecordView = Awaited<ReturnType<AppDeps['workOrders']['list']>>[number];

const deriveOrders = async (
  deps: AppDeps,
  records: readonly WorkOrderRecordView[],
  askSinceByWorkOrder: ReadonlyMap<WorkOrderId, number>,
  flowsOf: (repo: RepoSlug) => Promise<readonly FlowDef[]> = flowCache(deps),
): Promise<readonly DerivedOrder[]> => {
  const derived: DerivedOrder[] = [];
  for (const record of records) {
    const flow = (await flowsOf(record.repo)).find((candidate) => candidate.id === record.flow);
    if (flow === undefined) {
      derived.push({ record, status: undefined, stage: null, kind: undefined, since: record.createdAt });
      continue;
    }
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

    // `since` is when the wait was last established: the unanswered ask's arrival, else the newest
    // event of the work order (its creation time stands in for a history that should not be empty).
    const lastEvent = events[events.length - 1];
    derived.push({
      record,
      status: state.status,
      stage: state.stage,
      kind,
      since: askSince ?? (lastEvent === undefined ? record.createdAt : lastEvent.at),
    });
  }
  return derived;
};

/** The earliest still-open permission ask per work order, folded from each active run's stream. */
const openAskSince = async (deps: AppDeps): Promise<Map<WorkOrderId, number>> => {
  const askSinceByWorkOrder = new Map<WorkOrderId, number>();
  for (const run of await deps.runs.listActive()) {
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
  return askSinceByWorkOrder;
};

const cockpitView = async (deps: AppDeps, projectFilter?: ProjectSlug): Promise<CockpitView> => {
  const askSinceByWorkOrder = await openAskSince(deps);
  // Attention, cards and the closed list all read the same derivation pass — the filter narrows
  // attention, running and recentlyClosed, while the cards always see every project (K-4:B).
  const flowsOf = flowCache(deps);
  const allDerived = await deriveOrders(deps, await deps.workOrders.list({}), askSinceByWorkOrder, flowsOf);
  const scoped = projectFilter === undefined ? allDerived : allDerived.filter((entry) => entry.record.project === projectFilter);

  // Attention rows carry the A-29 number beside the id they name; a derived record always
  // numbers, so the undefined branch only keeps the type honest.
  const attention: AttentionItem[] = [];
  for (const entry of scoped) {
    if (entry.kind === undefined) continue;
    const number = await deps.workOrders.number(entry.record.id);
    if (number === undefined) continue;
    attention.push({
      workOrderId: entry.record.id,
      number,
      project: entry.record.project,
      repo: entry.record.repo,
      title: entry.record.title,
      kind: entry.kind,
      stage: entry.stage,
      since: entry.since,
    });
  }
  attention.sort((a, b) => KIND_RANK[a.kind] - KIND_RANK[b.kind] || a.since - b.since);

  // The stage strip (A-35): where a row's stage sits in its work order's flow. Zeroes hide the
  // strip — a stage the flow no longer lists, or a flow that no longer loads.
  const stagePosition = async (
    record: WorkOrderRecordView,
    stage: string,
  ): Promise<{ readonly stageIndex: number; readonly stageCount: number }> => {
    const flow = (await flowsOf(record.repo)).find((candidate) => candidate.id === record.flow);
    if (flow === undefined) return { stageIndex: 0, stageCount: 0 };
    const stageIndex = flow.stages.findIndex((candidate) => candidate.id === stage) + 1;
    return stageIndex === 0 ? { stageIndex: 0, stageCount: 0 } : { stageIndex, stageCount: flow.stages.length };
  };

  const active = await deps.runs.listActive();
  const scopedIds = new Set(scoped.map((entry) => entry.record.id));
  // A-40: the def id of a row's route account, resolved once per account — never once per row
  // (the board's label cache stance). A removed account's rows resolve '' rather than a guess.
  const providerByAccount = new Map<AccountId, string>();
  const providerOf = async (accountId: AccountId): Promise<string> => {
    const cached = providerByAccount.get(accountId);
    if (cached !== undefined) return cached;
    const provider = (await deps.accounts.get(accountId))?.provider ?? '';
    providerByAccount.set(accountId, provider);
    return provider;
  };
  const running: CockpitView['running'][number][] = [];
  for (const run of active) {
    if (projectFilter !== undefined && !scopedIds.has(run.workOrderId)) continue;
    // A run always rides a stored work order; the guard only keeps the type honest.
    const record = await deps.workOrders.get(run.workOrderId);
    const number = await deps.workOrders.number(run.workOrderId);
    if (record === undefined || number === undefined) continue;
    const { stageIndex, stageCount } = await stagePosition(record, run.stage);
    running.push({
      workOrderId: run.workOrderId,
      number,
      stage: run.stage,
      accountId: run.route.accountId,
      provider: await providerOf(run.route.accountId),
      startedAt: run.startedAt,
      title: record.title,
      stageIndex,
      stageCount,
      queued: false,
      limitResetsAt: null,
    });
  }

  // The queue rides the same list after the running rows (A-36); its wait is explained by the
  // same headroom call the dispatcher's tick makes, read at query time (A-37).
  const queuedItems = (await deps.queue.list())
    .filter((item) => projectFilter === undefined || scopedIds.has(item.workOrderId))
    .sort((a, b) => a.enqueuedAt - b.enqueuedAt || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
  if (queuedItems.length > 0) {
    const pools = await deps.accounts.pools();
    const meters = await deps.accounts.meters();
    const now = deps.clock.now();
    for (const item of queuedItems) {
      const record = await deps.workOrders.get(item.workOrderId);
      const number = await deps.workOrders.number(item.workOrderId);
      if (record === undefined || number === undefined) continue;
      const { stageIndex, stageCount } = await stagePosition(record, item.stage);
      const room = headroom(pools, meters, item.route.accountId, item.route.model ?? '', now);
      const limit = room.ok === false;
      running.push({
        workOrderId: item.workOrderId,
        number,
        stage: item.stage,
        accountId: item.route.accountId,
        provider: await providerOf(item.route.accountId),
        startedAt: item.enqueuedAt,
        title: record.title,
        stageIndex,
        stageCount,
        queued: true,
        queuedReason: limit ? 'limit' : 'queue',
        limitResetsAt: limit ? room.earliestRelief ?? null : null,
      });
    }
  }

  const projects: CockpitView['projects'][number][] = [];
  for (const def of await deps.projects.list()) {
    const own = allDerived.filter((entry) => entry.record.project === def.id);
    // A-38: the project's latest status change on A-31's basis. An order whose flow no longer
    // loads still contributes its creation; no orders at all leaves null.
    let lastActivityAt: number | null = null;
    for (const entry of own) {
      const flow = (await flowsOf(entry.record.repo)).find((candidate) => candidate.id === entry.record.flow);
      const stamp =
        flow === undefined
          ? entry.record.createdAt
          : statusSince(flow, await deps.workOrders.events(entry.record.id), entry.record.createdAt);
      if (lastActivityAt === null || stamp > lastActivityAt) lastActivityAt = stamp;
    }
    projects.push({
      project: def.id,
      name: def.name,
      mainRepo: def.mainRepo,
      repoCount: def.repos.length,
      active: own.filter((entry) => entry.status !== 'done').length,
      waiting: own.filter((entry) => entry.kind === 'permission_ask' || entry.kind === 'awaiting_human' || entry.kind === 'blocked').length,
      lastActivityAt,
    });
  }

  // recentlyClosed: the five most recent done work orders by when they finished — a `closed`
  // event or the closure gate that completed them, whichever the history ends with.
  const closed: CockpitView['recentlyClosed'][number][] = [];
  for (const entry of scoped) {
    if (entry.status !== 'done') continue;
    const number = await deps.workOrders.number(entry.record.id);
    if (number === undefined) continue;
    const events = await deps.workOrders.events(entry.record.id);
    const last = events[events.length - 1];
    // The done status itself came from this flow, so the fallback only keeps the type honest.
    const flow = (await flowsOf(entry.record.repo)).find((candidate) => candidate.id === entry.record.flow);
    closed.push({
      workOrderId: entry.record.id,
      number,
      title: entry.record.title,
      project: entry.record.project,
      repo: entry.record.repo,
      closedAt: last === undefined ? entry.record.createdAt : last.at,
      outcome: flow === undefined ? 'merged' : closeOutcome(flow, events),
    });
  }
  closed.sort((a, b) => b.closedAt - a.closedAt);

  return { attention, running, projects, recentlyClosed: closed.slice(0, 5) };
};

/** A-27: one item per attached project (id asc), repos in `project.repos` order. */
const projectTree = async (deps: AppDeps): Promise<ProjectTree> => {
  const askSinceByWorkOrder = await openAskSince(deps);
  const records = await deps.workOrders.list({});
  const derived = await deriveOrders(deps, records, askSinceByWorkOrder);
  const derivedByRepo = new Map<RepoSlug, readonly DerivedOrder[]>();
  for (const entry of derived) {
    const own = derivedByRepo.get(entry.record.repo);
    if (own === undefined) derivedByRepo.set(entry.record.repo, [entry]);
    else derivedByRepo.set(entry.record.repo, [...own, entry]);
  }

  const runningByRepo = new Map<RepoSlug, number>();
  for (const run of await deps.runs.listActive()) {
    const workOrder = await deps.workOrders.get(run.workOrderId);
    if (workOrder === undefined) continue;
    runningByRepo.set(workOrder.repo, (runningByRepo.get(workOrder.repo) ?? 0) + 1);
  }

  // Status precedence (A-27): waiting > running > idle.
  const statusOf = (waiting: number, running: number): RepoNode['status'] =>
    waiting > 0 ? 'waiting' : running > 0 ? 'running' : 'idle';

  const items: ProjectTreeItem[] = [];
  for (const def of await deps.projects.list()) {
    const repos: RepoNode[] = def.repos.map((repo) => {
      const own = derivedByRepo.get(repo) ?? [];
      const waiting = own.filter(
        (entry) => entry.kind === 'permission_ask' || entry.kind === 'awaiting_human' || entry.kind === 'blocked',
      ).length;
      const running = runningByRepo.get(repo) ?? 0;
      return {
        repo,
        name: repo,
        main: repo === def.mainRepo,
        active: own.filter((entry) => entry.status !== 'done').length,
        running,
        waiting,
        status: statusOf(waiting, running),
      };
    });

    const waiting = repos.reduce((sum, node) => sum + node.waiting, 0);
    const running = repos.reduce((sum, node) => sum + node.running, 0);
    items.push({
      project: def.id,
      name: def.name,
      mainRepo: def.mainRepo,
      repos,
      active: repos.reduce((sum, node) => sum + node.active, 0),
      running,
      waiting,
      status: statusOf(waiting, running),
    });
  }
  return items;
};

const roadmapView = async (
  deps: AppDeps,
  project: ProjectSlug,
): Promise<RoadmapPageView | QueryFailure> => {
  if ((await deps.projects.get(project)) === undefined) return { ok: false, code: 'not_found' };
  const roadmap = await deps.definitions.loadRoadmap(project);
  if (roadmap === undefined) return { ok: false, code: 'not_found' };
  if (!roadmap.ok) return { ok: false, code: 'definitions_invalid' };

  // A task's status is decided over its linked work orders — every non-done order of the project
  // that names the task.
  const askSinceByWorkOrder = await openAskSince(deps);
  const linked = (await deriveOrders(deps, await deps.workOrders.list({ project }), askSinceByWorkOrder))
    .filter((entry) => entry.record.task !== undefined && entry.status !== undefined)
    .map((entry) => ({
      task: entry.record.task as TaskSlug,
      status: entry.status as WorkOrderStatus,
      record: entry.record,
    }));
  const view = deriveRoadmap(roadmap.value, linked);

  // Each task's orders travel per its targets order, then by display number ascending — the page
  // reads a cross-repo task's rows straight off this list. A repo outside the task's targets (an
  // order opened directly there) sorts after the targeted ones.
  const ordersByTask = new Map<TaskSlug, readonly { readonly repo: RepoSlug; readonly id: WorkOrderId; readonly number: number; readonly title: string; readonly status: WorkOrderStatus }[]>();
  for (const phase of roadmap.value.phases) {
    for (const task of phase.tasks) {
      const rank = (repo: RepoSlug): number => {
        const at = task.targets.indexOf(repo);
        return at === -1 ? task.targets.length : at;
      };
      const orders = await Promise.all(
        linked
          .filter((entry) => entry.task === task.id)
          .map(async (entry) => ({
            repo: entry.record.repo,
            id: entry.record.id,
            number: (await deps.workOrders.number(entry.record.id)) ?? 0,
            title: entry.record.title,
            status: entry.status,
            rank: rank(entry.record.repo),
          })),
      );
      ordersByTask.set(
        task.id,
        orders
          .slice()
          .sort((a, b) => a.rank - b.rank || a.number - b.number)
          .map(({ repo, id, number, title, status }) => ({ repo, id, number, title, status })),
      );
    }
  }

  return {
    phases: roadmap.value.phases.map((phase) => ({
      id: phase.id,
      name: phase.name,
      status: view.phases[phase.id] ?? 'planned',
      tasks: phase.tasks.map((task) => ({
        id: task.id,
        title: task.title,
        status: view.tasks[task.id] ?? 'planned',
        targets: [...task.targets],
        workOrders: ordersByTask.get(task.id) ?? [],
      })),
    })),
    runnable: [...view.runnable],
  };
};

const accountDetailView = async (
  deps: AppDeps,
  id: AccountId,
): Promise<AccountDetailView | QueryFailure> => {
  const record = await deps.accounts.get(id);
  if (record === undefined) return { ok: false, code: 'not_found' };

  const pools = await deps.accounts.pools(id);
  const meters = await deps.accounts.meters(id);
  const poolLabel = new Map(pools.map((pool) => [pool.id, pool.label] as const));
  const windows = meters.map((meter) => ({
    label: meter.label ?? poolLabel.get(meter.poolId),
    unit: meter.unit,
    used: meter.used ?? undefined,
    limit: meter.limit ?? undefined,
    remaining: meter.remaining ?? undefined,
    resetsAt: meter.resetsAt ?? undefined,
    resetPrecision: meter.resetPrecision,
    source: meter.source,
  }));

  // activeWork: non-done work orders with a run on this account, the oldest active run first.
  const askSinceByWorkOrder = await openAskSince(deps);
  const collected: {
    readonly workOrderId: string;
    readonly number: number;
    readonly title: string;
    readonly stage: string | null;
    readonly status: string;
    readonly since: number;
  }[] = [];
  for (const entry of await deriveOrders(deps, await deps.workOrders.list({}), askSinceByWorkOrder)) {
    if (entry.status === 'done') continue;
    const runs = await deps.runs.listForWorkOrder(entry.record.id);
    const onAccount = runs.filter((run) => run.route.accountId === id);
    if (onAccount.length === 0) continue;
    onAccount.sort((a, b) => a.startedAt - b.startedAt);
    const first = onAccount[0];
    if (first === undefined) continue;
    const number = await deps.workOrders.number(entry.record.id);
    if (number === undefined) continue;
    collected.push({
      workOrderId: entry.record.id,
      number,
      title: entry.record.title,
      stage: entry.stage,
      status: entry.status ?? '',
      since: first.startedAt,
    });
  }

  return {
    account: {
      id: record.id,
      provider: record.provider,
      label: record.label,
      authMode: record.authMode,
      plan: record.plan,
      limitPolicy: record.limitPolicy,
    },
    windows,
    activeWork: [...collected]
      .sort((a, b) => a.since - b.since)
      .map(({ workOrderId, number, title, stage, status }) => ({ workOrderId, number, title, stage, status })),
  };
};

const projectSpendView = async (
  deps: AppDeps,
  project: ProjectSlug,
): Promise<ProjectSpendView | QueryFailure> => {
  const def = await deps.projects.get(project);
  if (def === undefined) return { ok: false, code: 'not_found' };

  // The page answers "how much of this month's ceiling is gone", so the window is the current
  // UTC month — the same window the project ceiling will be enforced over.
  const now = deps.clock.now();
  const from = startOfUtcMonth(now);
  const to = startOfNextUtcMonth(now) - 1;

  const perRepo: { readonly repo: string; readonly usd: number }[] = [];
  for (const repo of def.repos) {
    perRepo.push({ repo, usd: await deps.accounts.spend({ project, repo, from, to }) });
  }
  const totalUsd = perRepo.reduce((sum, entry) => sum + entry.usd, 0);

  return {
    totalUsd,
    perRepo,
    ...(def.budget !== undefined ? { cap: { amountUsd: def.budget.amountUsd, warnPercent: def.budget.warnPercent } } : {}),
  };
};

// Civil-from-days month bounds without a Date object (banned in this layer); the same algorithm
// the dispatcher uses for its account-month windows.
const MS_PER_DAY: EpochMs = 86_400_000;

const civilFromDays = (days: number): { readonly year: number; readonly month: number } => {
  const z = days + 719_468;
  const era = Math.floor(z / 146_097);
  const doe = z - era * 146_097;
  const yoe = Math.floor((doe - Math.floor(doe / 1_460) + Math.floor(doe / 36_524) - Math.floor(doe / 146_096)) / 365);
  const year = yoe + era * 400;
  const doy = doe - (365 * yoe + Math.floor(yoe / 4) - Math.floor(yoe / 100));
  const mp = Math.floor((5 * doy + 2) / 153);
  const month = mp < 10 ? mp + 3 : mp - 9;
  return { year: month <= 2 ? year + 1 : year, month };
};

const daysFromCivilMonth = (year: number, month: number): number => {
  const shifted = month <= 2 ? year - 1 : year;
  const era = Math.floor(shifted / 400);
  const yoe = shifted - era * 400;
  const mp = month > 2 ? month - 3 : month + 9;
  const doy = Math.floor((153 * mp + 2) / 5);
  const doe = yoe * 365 + Math.floor(yoe / 4) - Math.floor(yoe / 100) + doy;
  return era * 146_097 + doe - 719_468;
};

const startOfUtcMonth = (at: EpochMs): EpochMs => {
  const { year, month } = civilFromDays(Math.floor(at / MS_PER_DAY));
  return daysFromCivilMonth(year, month) * MS_PER_DAY;
};

const startOfNextUtcMonth = (at: EpochMs): EpochMs => {
  const { year, month } = civilFromDays(Math.floor(at / MS_PER_DAY));
  return (month === 12 ? daysFromCivilMonth(year + 1, 1) : daysFromCivilMonth(year, month + 1)) * MS_PER_DAY;
};

/** A-31: the instant the work order entered its current status — the `at` of the last event that
 *  changed the derived status, its creation time while nothing has. Re-folding the domain fold
 *  over growing prefixes keeps the definition honest without duplicating it; a work order's
 *  history is short enough that the quadratic walk stays cheap. */
const statusSince = (flow: FlowDef, events: readonly WorkOrderEvent[], createdAt: EpochMs): EpochMs => {
  let previous = deriveWorkOrderState(flow, []).status;
  let since = createdAt;
  for (const [index, event] of events.entries()) {
    const status = deriveWorkOrderState(flow, events.slice(0, index + 1)).status;
    if (status !== previous) {
      since = event.at;
      previous = status;
    }
  }
  return since;
};

/** A-39: which event ended a done work order — a `closed` event reads cancelled, the flow's own
 *  completion merged. The same prefix refold as statusSince over the same short histories. */
const closeOutcome = (flow: FlowDef, events: readonly WorkOrderEvent[]): 'merged' | 'cancelled' => {
  for (const [index, event] of events.entries()) {
    if (deriveWorkOrderState(flow, events.slice(0, index + 1)).status === 'done') {
      return event.type === 'closed' ? 'cancelled' : 'merged';
    }
  }
  return 'merged';
};

/** A-31: a card's `since` travels as an ISO-8601 UTC instant. `Date` stays banned in this layer,
 *  so the same civil-date walk that bounds the month windows formats the stored epoch. */
const isoInstant = (at: EpochMs): string => {
  const days = Math.floor(at / MS_PER_DAY);
  const msOfDay = at - days * MS_PER_DAY;
  const { year, month } = civilFromDays(days);
  const dayOfMonth = days - daysFromCivilMonth(year, month) + 1;
  const pad = (value: number, width = 2): string => String(value).padStart(width, '0');
  return `${pad(year, 4)}-${pad(month)}-${pad(dayOfMonth)}T${pad(Math.floor(msOfDay / 3_600_000))}:${pad(Math.floor((msOfDay % 3_600_000) / 60_000))}:${pad(Math.floor((msOfDay % 60_000) / 1000))}.${pad(msOfDay % 1000, 3)}Z`;
};

const boardView = async (deps: AppDeps, repo: RepoSlug): Promise<BoardView | QueryFailure> => {
  const loaded = await deps.definitions.load(repo);
  if (!loaded.ok) return { ok: false, code: 'definitions_invalid' };
  // Without a repo section there is no default flow to build columns from.
  const def = loaded.value.repo;
  if (def === undefined) return { ok: false, code: 'definitions_invalid' };
  const flow = loaded.value.flows.find((candidate) => candidate.id === def.defaultFlow);
  if (flow === undefined) return { ok: false, code: 'definitions_invalid' };

  const placed = new Map<StageSlug, { readonly id: string; readonly number: number; readonly title: string; readonly status: string; readonly account: string | null; readonly since: string }[]>();
  const done: { readonly id: string; readonly number: number; readonly title: string }[] = [];
  // Account labels resolve once per account, not once per card (A-30).
  const labelOf = new Map<AccountId, string | null>();
  for (const record of await deps.workOrders.list({ repo })) {
    // State derives from the work order's own flow; the columns come from the default flow.
    const ownFlow = loaded.value.flows.find((candidate) => candidate.id === record.flow);
    if (ownFlow === undefined) continue;
    const events = await deps.workOrders.events(record.id);
    const state = deriveWorkOrderState(ownFlow, events);
    // Every listed record numbers (A-29); the guard only keeps the type honest.
    const number = await deps.workOrders.number(record.id);
    if (number === undefined) continue;

    if (state.status === 'done') {
      done.push({ id: record.id, number, title: record.title });
      continue;
    }
    // A current stage the default flow does not have leaves the work order off this board: there
    // is no column to sit in and it is not finished.
    if (state.stage === null || !flow.stages.some((stage) => stage.id === state.stage)) continue;
    // A-30: the label of the account of the current or most recent run — the newest by startedAt,
    // active or finished; null when there never was a run or the account no longer loads.
    const runs = await deps.runs.listForWorkOrder(record.id);
    const lastRun = runs[runs.length - 1];
    let account: string | null = null;
    if (lastRun !== undefined) {
      if (!labelOf.has(lastRun.route.accountId)) {
        labelOf.set(lastRun.route.accountId, (await deps.accounts.get(lastRun.route.accountId))?.label ?? null);
      }
      account = labelOf.get(lastRun.route.accountId) ?? null;
    }
    const item = { id: record.id, number, title: record.title, status: state.status, account, since: isoInstant(statusSince(ownFlow, events, record.createdAt)) };
    const column = placed.get(state.stage);
    if (column === undefined) placed.set(state.stage, [item]);
    else column.push(item);
  }

  return {
    repo,
    flow: def.defaultFlow,
    columns: flow.stages.map((stage) => ({ stage: stage.id, name: stage.name, workOrders: placed.get(stage.id) ?? [] })),
    done,
  };
};
