// services/dispatcher.ts — one dispatcher tick, the enqueue that feeds it, and the queue state a
// limit decision turns into (docs/v2/application.md rules A-17a, A-19, A-20). Every decision rule
// lives in the domain (`decideDispatch`, `headroom`, `combinedSpendStatus`); this file only gathers
// the snapshot through ports and writes the outcomes back.
import type {
  AccountId,
  AccountRoute,
  DispatchDecision,
  DispatchLimits,
  DispatchSnapshot,
  EpochMs,
  Headroom,
  LimitDecision,
  QueueItem,
  QueueItemId,
  Result,
  RunId,
  RunningRun,
  ScopedSpend,
  SpendStatus,
  WorkOrderId,
} from '../../domain/index';
import { combinedSpendStatus, decideDispatch, deriveWorkOrderState, err, headroom, nextAction, ok } from '../../domain/index';

import type { AccountRecord, AppDeps } from '../ports/index';
import { resolveRoute, type RouteError } from '../use-cases/index';

export interface DispatcherConfig {
  readonly limits: DispatchLimits;
}

export interface TickResult {
  readonly decisions: readonly DispatchDecision[];
  readonly started: readonly QueueItemId[];
}

type AccountCap = AccountRecord['caps'][number];

const MS_PER_DAY: EpochMs = 86_400_000;

/** Civil-from-days over a day count: the UTC calendar date without a Date object (banned here). */
const civilFromDays = (days: number): { readonly year: number; readonly month: number } => {
  const z = days + 719_468;
  const era = Math.floor(z / 146_097);
  const doe = z - era * 146_097; // [0, 146096]
  const yoe = Math.floor((doe - Math.floor(doe / 1_460) + Math.floor(doe / 36_524) - Math.floor(doe / 146_096)) / 365); // [0, 399]
  const year = yoe + era * 400;
  const doy = doe - (365 * yoe + Math.floor(yoe / 4) - Math.floor(yoe / 100)); // [0, 365]
  const mp = Math.floor((5 * doy + 2) / 153); // [0, 11]
  const month = mp < 10 ? mp + 3 : mp - 9; // [1, 12]
  return { year: month <= 2 ? year + 1 : year, month };
};

/** Days from 1970-01-01 to the first of the given month. */
const daysFromCivilMonth = (year: number, month: number): number => {
  const shifted = month <= 2 ? year - 1 : year;
  const era = Math.floor(shifted / 400);
  const yoe = shifted - era * 400;
  const mp = month > 2 ? month - 3 : month + 9;
  const doy = Math.floor((153 * mp + 2) / 5);
  const doe = yoe * 365 + Math.floor(yoe / 4) - Math.floor(yoe / 100) + doy;
  return era * 146_097 + doe - 719_468;
};

const startOfUtcDay = (at: EpochMs): EpochMs => Math.floor(at / MS_PER_DAY) * MS_PER_DAY;

/** Monday 00:00 UTC of the ISO week; the epoch day 0 is a Thursday, hence the +3 shift. */
const startOfUtcIsoWeek = (at: EpochMs): EpochMs => {
  const days = Math.floor(at / MS_PER_DAY);
  return (Math.floor((days + 3) / 7) * 7 - 3) * MS_PER_DAY;
};

const startOfUtcMonth = (at: EpochMs): EpochMs => {
  const { year, month } = civilFromDays(Math.floor(at / MS_PER_DAY));
  return daysFromCivilMonth(year, month) * MS_PER_DAY;
};

const startOfNextUtcMonth = (at: EpochMs): EpochMs => {
  const { year, month } = civilFromDays(Math.floor(at / MS_PER_DAY));
  return (month === 12 ? daysFromCivilMonth(year + 1, 1) : daysFromCivilMonth(year, month + 1)) * MS_PER_DAY;
};

/** Both bounds inclusive: the spend port's window is `[from, to]`, so a boundary entry counts. */
const spendWindow = (
  scope: 'account_day' | 'account_week' | 'account_month',
  now: EpochMs,
): { readonly from: EpochMs; readonly to: EpochMs } => {
  if (scope === 'account_day') return { from: startOfUtcDay(now), to: startOfUtcDay(now) + MS_PER_DAY - 1 };
  if (scope === 'account_week') {
    const from = startOfUtcIsoWeek(now);
    return { from, to: from + 7 * MS_PER_DAY - 1 };
  }
  return { from: startOfUtcMonth(now), to: startOfNextUtcMonth(now) - 1 };
};

export async function dispatcherTick(
  deps: Pick<AppDeps, 'clock' | 'queue' | 'runs' | 'accounts' | 'workOrders' | 'definitions' | 'projects'>,
  config: DispatcherConfig,
  start: (item: QueueItem) => void,
): Promise<TickResult> {
  const now = deps.clock.now();
  const queue = await deps.queue.list();

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

  const headroomByItem: Record<string, Headroom> = {};
  const spendByItem: Record<string, SpendStatus> = {};
  for (const item of queue) {
    headroomByItem[item.id] = headroom(pools, meters, item.route.accountId, item.route.model ?? '', now);

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
    ...(input.decision.kind === 'schedule_resume' ? { notBefore: input.decision.at } : {}),
  });

  // A scheduled resume is the one decision that spends one of the run's auto-resumes.
  if (input.decision.kind === 'schedule_resume') {
    await deps.runs.update(run.id, { autoResumesUsed: run.autoResumesUsed + 1 });
  }
  return ok({ queued });
}

export async function enqueueStage(
  deps: Pick<AppDeps, 'clock' | 'ids' | 'queue' | 'workOrders' | 'definitions' | 'bindings' | 'accounts' | 'projects'>,
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
    route: { ...routed.value.chain[0] },
    priority: input.priority ?? 0,
    enqueuedAt: deps.clock.now(),
  });
  return ok(queued);
}
