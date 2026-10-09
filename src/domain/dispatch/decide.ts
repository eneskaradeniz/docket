// The dispatcher's decision rule: which queued items start now, and why the others wait.
// Contract: docs/v2/domain.md section 8.
import type { AccountId, EpochMs, QueueItemId, RunId, StageSlug, WorkOrderId, RepoSlug, ThinkingChoice, Tier } from '../shared/index';
import type { AccountRoute, Headroom } from '../quota/index';
import type { SpendStatus } from '../budget/index';

export interface QueueItem {
  readonly id: QueueItemId;
  readonly workOrderId: WorkOrderId;
  readonly repo: RepoSlug;
  readonly stage: StageSlug;
  readonly route: AccountRoute;
  readonly priority: number; // higher first
  readonly enqueuedAt: EpochMs;
  readonly notBefore?: EpochMs; // e.g. a scheduled resume
  readonly thinking?: ThinkingChoice; // from the resolved binding; absent → balanced
  readonly tier?: Tier; // from stageRouting; the executor resolves it to a model for an unpinned route
  readonly sameProviderReview?: true; // a review stage found no other provider in the chain
  readonly handoffOf?: RunId; // the failed run this item continues from through the handoff pack (A-65)
  readonly requeryFirst?: true; // a scheduled resume: the account's quota is re-read before the item may start (A-101)
}

export interface RunningRun {
  readonly workOrderId: WorkOrderId;
  readonly repo: RepoSlug;
  readonly accountId: AccountId;
}

export interface DispatchLimits {
  readonly global: number; // default 4
  readonly perRepo: number; // default 3
  readonly perAccount: Readonly<Record<string, number>>; // AccountId → max concurrent; absent = no extra limit
}

export interface DispatchSnapshot {
  readonly now: EpochMs;
  readonly running: readonly RunningRun[];
  readonly limits: DispatchLimits;
  readonly headroom: Readonly<Record<string, Headroom>>; // QueueItemId → headroom for its route
  readonly spend: Readonly<Record<string, SpendStatus>>; // QueueItemId → combined spend status
}

export type WaitReason =
  | 'not_before'
  | 'work_order_busy'
  | 'global_limit'
  | 'repo_limit'
  | 'account_limit'
  | 'quota'
  | 'budget';

export type DispatchDecision =
  | { readonly item: QueueItemId; readonly kind: 'start' }
  | { readonly item: QueueItemId; readonly kind: 'wait'; readonly reason: WaitReason; readonly until?: EpochMs };

/** Consideration order: priority desc, then enqueuedAt asc, then id asc. */
function byConsiderationOrder(a: QueueItem, b: QueueItem): number {
  if (a.priority !== b.priority) return b.priority - a.priority;
  if (a.enqueuedAt !== b.enqueuedAt) return a.enqueuedAt - b.enqueuedAt;
  return a.id < b.id ? -1 : a.id > b.id ? 1 : 0;
}

function wait(item: QueueItemId, reason: WaitReason, until?: EpochMs): DispatchDecision {
  // `until` is omitted rather than set to undefined so callers can distinguish "no relief known".
  return until === undefined ? { item, kind: 'wait', reason } : { item, kind: 'wait', reason, until };
}

function countBy<K extends string>(runs: readonly RunningRun[], keyOf: (run: RunningRun) => K): Map<K, number> {
  const counts = new Map<K, number>();
  for (const run of runs) {
    const key = keyOf(run);
    counts.set(key, (counts.get(key) ?? 0) + 1);
  }
  return counts;
}

export function decideDispatch(queue: readonly QueueItem[], snapshot: DispatchSnapshot): readonly DispatchDecision[] {
  const busyWorkOrders = new Set<WorkOrderId>(snapshot.running.map((run) => run.workOrderId));
  const repoLoad = countBy(snapshot.running, (run) => run.repo);
  const accountLoad = countBy(snapshot.running, (run) => run.accountId);
  let globalLoad = snapshot.running.length;

  // Sort a copy: the caller's array keeps its order.
  const decisions: DispatchDecision[] = [];
  for (const item of [...queue].sort(byConsiderationOrder)) {
    // The check order is the contract: the first failing check names the wait reason.
    if (item.notBefore !== undefined && item.notBefore > snapshot.now) {
      decisions.push(wait(item.id, 'not_before', item.notBefore));
      continue;
    }
    if (busyWorkOrders.has(item.workOrderId)) {
      decisions.push(wait(item.id, 'work_order_busy'));
      continue;
    }
    if (globalLoad >= snapshot.limits.global) {
      decisions.push(wait(item.id, 'global_limit'));
      continue;
    }
    if ((repoLoad.get(item.repo) ?? 0) >= snapshot.limits.perRepo) {
      decisions.push(wait(item.id, 'repo_limit'));
      continue;
    }
    // Record indexing reports `number` while an absent key is undefined at runtime.
    const accountCap: number | undefined = snapshot.limits.perAccount[item.route.accountId];
    if (accountCap !== undefined && (accountLoad.get(item.route.accountId) ?? 0) >= accountCap) {
      decisions.push(wait(item.id, 'account_limit'));
      continue;
    }
    if (snapshot.spend[item.id] === 'hard_stop') {
      decisions.push(wait(item.id, 'budget'));
      continue;
    }
    const room: Headroom | undefined = snapshot.headroom[item.id];
    if (room !== undefined && room.ok === false) {
      decisions.push(wait(item.id, 'quota', room.earliestRelief));
      continue;
    }
    // Unknown or absent headroom never blocks: the transport learns the truth on start.

    // A start in this call consumes capacity for every item considered after it.
    globalLoad += 1;
    busyWorkOrders.add(item.workOrderId);
    repoLoad.set(item.repo, (repoLoad.get(item.repo) ?? 0) + 1);
    accountLoad.set(item.route.accountId, (accountLoad.get(item.route.accountId) ?? 0) + 1);
    decisions.push({ item: item.id, kind: 'start' });
  }

  return decisions;
}
