// services/dispatcher.ts — one dispatcher tick, the enqueue that feeds it, and the queue state a
// limit decision turns into (docs/v2/application.md rules A-17a, A-19, A-20). Every decision rule
// lives in the domain (`decideDispatch`, `headroom`, `combinedSpendStatus`); this file only gathers
// the snapshot through ports and writes the outcomes back.
import type {
  AccountId,
  CatalogModel,
  AccountRoute,
  DispatchDecision,
  DispatchLimits,
  DispatchSnapshot,
  EpochMs,
  Headroom,
  LimitDecision,
  QueueItem,
  QueueItemId,
  QuotaReserve,
  Result,
  RunId,
  RunningRun,
  ScopedSpend,
  SpendStatus,
  WorkOrderId,
  StageSlug,
  ChainEntry,
} from '../../domain/index';
import { combinedSpendStatus, decideDispatch, deriveWorkOrderState, err, headroom, nextAction, ok, orderForReview, stageRouting } from '../../domain/index';

import { catalogOrEmpty, matchIdFor } from './match-id';
import { spendWindow } from './spend-window';
import type { AccountRecord, AppDeps, QuotaProbeResolver, RunRecord } from '../ports/index';
import { pollQuota, resolveRoute, type RouteError } from '../use-cases/index';

export { spendWindow } from './spend-window';

export interface DispatcherConfig {
  readonly limits: DispatchLimits;
  /** Without it a `requeryFirst` item is not re-queried and starts like any other (A-102). */
  readonly probes?: QuotaProbeResolver;
}

/** A failed poll for one item is counted; this many in a row release it so it is never stuck (A-104). */
const REQUERY_FAILURES_MAX = 3;

// Consecutive failed re-queries per queue item. It lives beside the queue port it describes rather
// than on the item: the item's shape is fixed by the domain, and a restart losing the count only
// grants the item a few more polls before the release.
const requeryFailures = new WeakMap<object, Map<QueueItemId, number>>();

/**
 * A-102/A-104: one poll per account for the due `requeryFirst` items. Returns the ids held back
 * this tick; the next tick decides with the polled meters.
 */
async function requeryDue(
  deps: Pick<AppDeps, 'clock' | 'ids' | 'log' | 'queue' | 'accounts' | 'capabilities'>,
  probes: QuotaProbeResolver,
  queue: readonly QueueItem[],
  now: EpochMs,
): Promise<ReadonlySet<QueueItemId>> {
  const due = queue.filter((item) => item.requeryFirst === true && item.notBefore !== undefined && item.notBefore <= now);
  const failures = requeryFailures.get(deps.queue) ?? new Map<QueueItemId, number>();
  requeryFailures.set(deps.queue, failures);

  const byAccount = new Map<AccountId, QueueItem[]>();
  for (const item of due) byAccount.set(item.route.accountId, [...(byAccount.get(item.route.accountId) ?? []), item]);

  for (const [accountId, items] of byAccount) {
    const polled = await pollQuota(deps, probes, { accountId });
    for (const item of items) {
      const failed = (failures.get(item.id) ?? 0) + (polled.ok ? 0 : 1);
      if (polled.ok || failed >= REQUERY_FAILURES_MAX) {
        const { requeryFirst: _cleared, ...released } = item;
        await deps.queue.put(released);
        failures.delete(item.id);
      } else {
        failures.set(item.id, failed);
      }
    }
  }
  return new Set(due.map((item) => item.id));
}

export interface TickResult {
  readonly decisions: readonly DispatchDecision[];
  readonly started: readonly QueueItemId[];
}

type AccountCap = AccountRecord['caps'][number];

export async function dispatcherTick(
  deps: Pick<
    AppDeps,
    'clock' | 'ids' | 'log' | 'capabilities' | 'queue' | 'runs' | 'accounts' | 'workOrders' | 'definitions' | 'projects' | 'modelCatalog'
  >,
  config: DispatcherConfig,
  start: (item: QueueItem) => void,
): Promise<TickResult> {
  const now = deps.clock.now();
  const listed = await deps.queue.list();
  // Held-back items take no part in this tick's decisions: the poll that releases them is this
  // tick's whole work for them (A-102).
  const heldBack = config.probes === undefined ? new Set<QueueItemId>() : await requeryDue(deps, config.probes, listed, now);
  const queue = listed.filter((item) => !heldBack.has(item.id));

  // The join with the work orders names each run's repo; a run whose work order is gone
  // cannot be attributed and therefore takes part in no limit.
  const running: RunningRun[] = [];
  for (const run of await deps.runs.listActive()) {
    const workOrder = await deps.workOrders.get(run.workOrderId);
    if (workOrder === undefined) continue;
    running.push({
      workOrderId: run.workOrderId,
      repo: workOrder.repo,
      accountId: run.route.accountId,
    });
  }

  const pools = await deps.accounts.pools();
  const meters = await deps.accounts.meters();
  const capsOf = async (accountId: AccountId): Promise<readonly AccountCap[]> => {
    const record = await deps.accounts.get(accountId);
    return record === undefined ? [] : record.caps;
  };
  const reserveOf = async (accountId: AccountId): Promise<QuotaReserve | undefined> =>
    (await deps.accounts.get(accountId))?.reserve;

  const catalogs = new Map<AccountId, readonly CatalogModel[]>();
  const catalogOf = async (accountId: AccountId): Promise<readonly CatalogModel[]> => {
    const known = catalogs.get(accountId);
    if (known !== undefined) return known;
    const listed = await catalogOrEmpty(() => deps.modelCatalog.list(accountId));
    catalogs.set(accountId, listed);
    return listed;
  };

  const headroomByItem: Record<string, Headroom> = {};
  const spendByItem: Record<string, SpendStatus> = {};
  for (const item of queue) {
    headroomByItem[item.id] = headroom(
      pools,
      meters,
      item.route.accountId,
      matchIdFor(await catalogOf(item.route.accountId), item.route.model),
      now,
      await reserveOf(item.route.accountId),
    );

    const scoped: ScopedSpend[] = [];
    for (const cap of await capsOf(item.route.accountId)) {
      const window = spendWindow(cap.scope, now);
      const observedUsd = await deps.accounts.spend({
        accountId: item.route.accountId,
        from: window.from,
        to: window.to,
      });
      scoped.push({ scope: cap.scope, observedUsd, cap: cap.cap });
    }

    // Repo limit first, then project ceiling: the order decides which scope a tie reports (R-32).
    // Both read spend across every account, and the ceiling across every repo of the project, so
    // a repo with no spend of its own is still held once the ceiling is used up.
    const month = spendWindow('account_month', now);
    const loaded = await deps.definitions.load(item.repo);
    const repoBudget = loaded.ok ? loaded.value.repo?.budget : undefined;
    if (repoBudget !== undefined) {
      const observedUsd = await deps.accounts.spend({ repo: item.repo, from: month.from, to: month.to });
      scoped.push({ scope: 'repo_month', observedUsd, cap: repoBudget });
    }
    const project = await deps.projects.projectOfRepo(item.repo);
    if (project?.budget !== undefined) {
      const observedUsd = await deps.accounts.spend({ project: project.id, from: month.from, to: month.to });
      scoped.push({ scope: 'project_month', observedUsd, cap: project.budget });
    }
    spendByItem[item.id] = combinedSpendStatus(scoped).status;
  }

  const snapshot: DispatchSnapshot = {
    now,
    running,
    limits: config.limits,
    headroom: headroomByItem,
    spend: spendByItem,
  };
  const decisions = decideDispatch(queue, snapshot);

  // Started items leave the queue before anything runs, so a crash between the two cannot
  // double-start them on the next tick.
  const startedItems: QueueItem[] = [];
  for (const decision of decisions) {
    if (decision.kind !== 'start') continue;
    const item = queue.find((candidate) => candidate.id === decision.item);
    if (item === undefined) continue;
    await deps.queue.remove(decision.item);
    startedItems.push(item);
  }
  for (const item of startedItems) start(item);

  return { decisions, started: startedItems.map((item) => item.id) };
}

/** Turns a limit decision into queue state. */
export async function applyLimitDecision(
  deps: Pick<AppDeps, 'clock' | 'ids' | 'queue' | 'runs' | 'workOrders'>,
  input: { readonly runId: RunId; readonly decision: LimitDecision },
): Promise<Result<{ readonly queued?: QueueItemId }, 'not_found'>> {
  const run = await deps.runs.get(input.runId);
  if (run === undefined) return err('not_found');
  const workOrder = await deps.workOrders.get(run.workOrderId);
  if (workOrder === undefined) return err('not_found');

  // `ask` leaves the queue empty on purpose: the work order stays `limit_waiting` and surfaces in
  // the cockpit until a person decides.
  if (input.decision.kind === 'ask') return ok({});

  const route: AccountRoute =
    input.decision.kind === 'fallback'
      ? { ...input.decision.route }
      : input.decision.kind === 'switch_pool'
        ? { accountId: run.route.accountId } // the pool (and so the model) is re-chosen at dispatch
        : { ...run.route };

  const queued = deps.ids.next<'queue-item'>();
  await deps.queue.put({
    id: queued,
    workOrderId: run.workOrderId,
    repo: workOrder.repo,
    stage: run.stage,
    route,
    priority: 0,
    enqueuedAt: deps.clock.now(),
    ...(input.decision.kind === 'schedule_resume'
      ? { notBefore: input.decision.at, ...(input.decision.requeryFirst ? { requeryFirst: true as const } : {}) }
      : {}),
    // A-65: the pack rule keys on the ACCOUNT, not the provider — a second account of the same
    // provider is a different identity directory, so native resume cannot be assumed to see the
    // earlier history and the handoff pack is the one continuation mechanism.
    ...(input.decision.kind === 'fallback' && input.decision.route.accountId !== run.route.accountId
      ? { handoffOf: run.id }
      : {}),
  });

  // A scheduled resume is the one decision that spends one of the run's auto-resumes.
  if (input.decision.kind === 'schedule_resume') {
    await deps.runs.update(run.id, { autoResumesUsed: run.autoResumesUsed + 1 });
  }
  return ok({ queued });
}

export async function enqueueStage(
  deps: Pick<AppDeps, 'clock' | 'ids' | 'queue' | 'workOrders' | 'definitions' | 'bindings' | 'accounts' | 'projects' | 'runs'>,
  input: { readonly id: WorkOrderId; readonly priority?: number },
): Promise<Result<QueueItemId, 'not_found' | 'not_ready' | RouteError | 'definitions_invalid'>> {
  const record = await deps.workOrders.get(input.id);
  if (record === undefined) return err('not_found');

  const loaded = await deps.definitions.load(record.repo);
  if (!loaded.ok) return err('definitions_invalid');
  const flow = loaded.value.flows.find((candidate) => candidate.id === record.flow);
  // Without the flow the state machine has nothing to say, so `start_run` is unreachable.
  if (flow === undefined) return err('not_ready');

  const state = deriveWorkOrderState(flow, await deps.workOrders.events(input.id));
  const next = nextAction(flow, state);
  if (next.kind !== 'start_run') return err('not_ready');

  const routed = await resolveRoute(deps, { repo: record.repo, workOrderId: input.id, role: next.role });
  if (!routed.ok) return routed;

  const stageDef = flow.stages.find((candidate) => candidate.id === next.stage);
  const routing = stageDef === undefined ? {} : stageRouting(stageDef, routed.value.binding);

  // A pinned work order routes from its stored stage chain when it names connected accounts;
  // an empty pin chain or none left connected falls back to the live binding (A-325).
  let chain: readonly AccountRoute[] = routed.value.chain;
  if (record.pin !== undefined) {
    const pinned = record.pin.stages.find((entry) => entry.stage.id === next.stage);
    if (pinned !== undefined && pinned.accounts.length > 0) {
      const connected: AccountRoute[] = [];
      for (const route of pinned.accounts) {
        if ((await deps.accounts.get(route.accountId)) !== undefined) connected.push({ ...route });
      }
      if (connected.length > 0) chain = connected;
    }
  }

  // A review stage prefers an account on another provider than the one that wrote the work.
  let sameProviderReview = false;
  if (stageDef?.reviewOf !== undefined) {
    const reviewed = await lastSucceededRun(deps, input.id, stageDef.reviewOf);
    const reviewedProvider =
      reviewed === undefined ? undefined : (await deps.accounts.get(reviewed.route.accountId))?.provider;
    const entries: ChainEntry[] = [];
    for (const route of chain) {
      const provider = (await deps.accounts.get(route.accountId))?.provider;
      if (provider !== undefined) entries.push({ route, provider });
    }
    const ordered = orderForReview(entries, reviewedProvider);
    chain = ordered.chain.map((entry) => entry.route);
    sameProviderReview = ordered.sameProvider;
  }
  const first = chain[0];
  if (first === undefined) return err('no_account');

  const queued = deps.ids.next<'queue-item'>();
  // One item per work order: whatever waited before gives way to the current stage and route.
  for (const existing of await deps.queue.list()) {
    if (existing.workOrderId === input.id) await deps.queue.remove(existing.id);
  }
  await deps.queue.put({
    id: queued,
    workOrderId: input.id,
    repo: record.repo,
    stage: next.stage,
    route: { ...first },
    priority: input.priority ?? 0,
    enqueuedAt: deps.clock.now(),
    ...(routing.thinking !== undefined ? { thinking: routing.thinking } : {}),
    ...(routing.tier !== undefined ? { tier: routing.tier } : {}),
    ...(sameProviderReview ? { sameProviderReview: true as const } : {}),
  });
  return ok(queued);
}

/** The newest run of `stage` in this work order that succeeded; the runs come oldest first. */
async function lastSucceededRun(
  deps: Pick<AppDeps, 'runs'>,
  workOrderId: WorkOrderId,
  stage: StageSlug,
): Promise<RunRecord | undefined> {
  const runs = await deps.runs.listForWorkOrder(workOrderId);
  return runs.filter((run) => run.stage === stage && run.outcome === 'succeeded').at(-1);
}
