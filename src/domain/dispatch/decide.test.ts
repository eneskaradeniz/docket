// Tests for the dispatcher's decision rule. Contract: docs/v2/domain.md section 8.
import { describe, expect, it } from 'vitest';
import type { AccountId, EpochMs, MeterId, QueueItemId, RunId, StageSlug, WorkOrderId, RepoSlug } from '../shared/index';
import { HOUR, MINUTE } from '../shared/index';
import type { AccountRoute, Headroom } from '../quota/index';
import type { SpendStatus } from '../budget/index';
import { decideDispatch } from './decide';
import type { DispatchDecision, DispatchLimits, DispatchSnapshot, QueueItem, RunningRun, WaitReason } from './decide';

const NOW: EpochMs = 1_750_000_000_000;
const STAGE = 'build' as StageSlug;
const WS_ALPHA = 'alpha' as RepoSlug;
const WS_BETA = 'beta' as RepoSlug;

// Crockford-base32 suffixes keep every id a valid 26-char ULID shape; two chars make
// lexicographic order (the id tie-break) easy to control in tests.
const ulidOf = (suffix: string): string => `01ARZ3NDEKTSV4RRFFQ69G5F${suffix}`;
const qid = (n: number): QueueItemId => ulidOf(String(n).padStart(2, '0')) as QueueItemId;
const woid = (suffix: string): WorkOrderId => ulidOf(suffix) as WorkOrderId;
const accId = (suffix: string): AccountId => ulidOf(suffix) as AccountId;
const meterId = (suffix: string): MeterId => ulidOf(suffix) as MeterId;

const ACCOUNT_A = accId('A0');
const ACCOUNT_B = accId('B0');
const ROUTE_A: AccountRoute = { accountId: ACCOUNT_A };
const ROUTE_B: AccountRoute = { accountId: ACCOUNT_B, model: 'some-model' };

const LIMITS: DispatchLimits = { global: 4, perRepo: 3, perAccount: {} };
const OK_ROOM: Headroom = { ok: true, lowest: 0.7 };

interface ItemInit {
  readonly id: QueueItemId;
  readonly workOrderId: WorkOrderId;
  readonly repo?: RepoSlug;
  readonly priority?: number;
  readonly enqueuedAt?: EpochMs;
  readonly route?: AccountRoute;
  readonly notBefore?: EpochMs;
}

const itemOf = (init: ItemInit): QueueItem => ({
  id: init.id,
  workOrderId: init.workOrderId,
  repo: init.repo ?? WS_ALPHA,
  stage: STAGE,
  route: init.route ?? ROUTE_A,
  priority: init.priority ?? 0,
  enqueuedAt: init.enqueuedAt ?? NOW - 1_000,
  notBefore: init.notBefore,
});

const runOf = (workOrderId: WorkOrderId, repo: RepoSlug, accountId: AccountId): RunningRun => ({
  workOrderId,
  repo,
  accountId,
});

interface SnapshotInit {
  readonly now?: EpochMs;
  readonly running?: readonly RunningRun[];
  readonly limits?: DispatchLimits;
  readonly headroom?: Readonly<Record<string, Headroom>>;
  readonly spend?: Readonly<Record<string, SpendStatus>>;
}

const snapshotOf = (init: SnapshotInit = {}): DispatchSnapshot => ({
  now: init.now ?? NOW,
  running: init.running ?? [],
  limits: init.limits ?? LIMITS,
  headroom: init.headroom ?? {},
  spend: init.spend ?? {},
});

const startFor = (item: QueueItem): DispatchDecision => ({ item: item.id, kind: 'start' });
const waitFor = (item: QueueItem, reason: WaitReason, until?: EpochMs): DispatchDecision =>
  until === undefined ? { item: item.id, kind: 'wait', reason } : { item: item.id, kind: 'wait', reason, until };

// Both directions must hold, so a union member can be neither added nor dropped silently.
type UnionIsExactly<Actual, Expected> = [Actual] extends [Expected]
  ? [Expected] extends [Actual]
    ? true
    : never
  : never;

const idsOf = (decisions: readonly DispatchDecision[]): readonly QueueItemId[] => decisions.map((d) => d.item);

const deepFreeze = (value: unknown): void => {
  if (value === null || typeof value !== 'object') return;
  for (const key of Object.keys(value as Record<string, unknown>)) {
    deepFreeze((value as Record<string, unknown>)[key]);
  }
  Object.freeze(value);
};

describe('decideDispatch', () => {
  // --- R-33: consideration order -------------------------------------------------------------

  it('R-33: considers items by priority desc, then enqueuedAt asc, then id asc', () => {
    const low = itemOf({ id: qid(1), workOrderId: woid('10'), priority: 1, enqueuedAt: NOW - 30 });
    const newerHigh = itemOf({ id: qid(2), workOrderId: woid('20'), priority: 5, enqueuedAt: NOW - 10 });
    const olderHigh = itemOf({ id: qid(0), workOrderId: woid('30'), priority: 5, enqueuedAt: NOW - 50 });
    const olderHighLaterId = itemOf({ id: qid(9), workOrderId: woid('40'), priority: 5, enqueuedAt: NOW - 50 });
    const queue = [newerHigh, olderHighLaterId, low, olderHigh];

    const decisions = decideDispatch(queue, snapshotOf({ limits: { global: 10, perRepo: 10, perAccount: {} } }));

    expect(idsOf(decisions)).toEqual([qid(0), qid(9), qid(2), qid(1)]);
    expect(decisions.every((d) => d.kind === 'start')).toBe(true);
  });

  it('R-33: an empty queue yields no decisions', () => {
    expect(decideDispatch([], snapshotOf())).toEqual([]);
  });

  // --- R-34: the check chain, first failing check wins ----------------------------------------

  it('R-34: notBefore in the future waits with not_before and until = notBefore', () => {
    const item = itemOf({ id: qid(1), workOrderId: woid('10'), notBefore: NOW + 5 * MINUTE });
    expect(decideDispatch([item], snapshotOf())).toEqual([waitFor(item, 'not_before', NOW + 5 * MINUTE)]);
  });

  it('R-34: notBefore at or before now does not wait', () => {
    const atEdge = itemOf({ id: qid(1), workOrderId: woid('10'), notBefore: NOW });
    const past = itemOf({ id: qid(2), workOrderId: woid('20'), notBefore: NOW - MINUTE });
    expect(decideDispatch([atEdge, past], snapshotOf({ limits: { global: 10, perRepo: 10, perAccount: {} } }))).toEqual([
      startFor(atEdge),
      startFor(past),
    ]);
  });

  it('R-34: a running run for the same work order waits with work_order_busy', () => {
    const item = itemOf({ id: qid(1), workOrderId: woid('10') });
    const running = [runOf(woid('10'), WS_ALPHA, ACCOUNT_A)];
    expect(decideDispatch([item], snapshotOf({ running }))).toEqual([waitFor(item, 'work_order_busy')]);
  });

  it('R-34: global limit reached by already-running runs waits with global_limit', () => {
    const item = itemOf({ id: qid(1), workOrderId: woid('10') });
    const running = [runOf(woid('90'), WS_ALPHA, ACCOUNT_A), runOf(woid('91'), WS_BETA, ACCOUNT_B)];
    expect(decideDispatch([item], snapshotOf({ running, limits: { global: 2, perRepo: 3, perAccount: {} } }))).toEqual([
      waitFor(item, 'global_limit'),
    ]);
  });

  it('R-34: repo limit reached by running runs waits with repo_limit', () => {
    const item = itemOf({ id: qid(1), workOrderId: woid('10'), repo: WS_ALPHA });
    const running = [
      runOf(woid('90'), WS_ALPHA, ACCOUNT_A),
      runOf(woid('91'), WS_ALPHA, ACCOUNT_A),
      runOf(woid('92'), WS_ALPHA, ACCOUNT_B),
    ];
    // The global limit (3 running < 4) still passes, so the repo check is what fails.
    expect(decideDispatch([item], snapshotOf({ running }))).toEqual([waitFor(item, 'repo_limit')]);
  });

  it('R-34: an account cap from perAccount waits with account_limit', () => {
    const item = itemOf({ id: qid(1), workOrderId: woid('10'), route: ROUTE_A });
    const running = [runOf(woid('90'), WS_BETA, ACCOUNT_A)];
    expect(
      decideDispatch([item], snapshotOf({ running, limits: { global: 4, perRepo: 3, perAccount: { [ACCOUNT_A]: 1 } } })),
    ).toEqual([waitFor(item, 'account_limit')]);
  });

  it('R-34: an account absent from perAccount has no extra limit', () => {
    const item = itemOf({ id: qid(1), workOrderId: woid('10'), route: ROUTE_A });
    const running = [runOf(woid('90'), WS_ALPHA, ACCOUNT_A)];
    expect(
      decideDispatch([item], snapshotOf({ running, limits: { global: 4, perRepo: 3, perAccount: { [ACCOUNT_B]: 1 } } })),
    ).toEqual([startFor(item)]);
  });

  it('R-34: spend hard_stop waits with budget', () => {
    const item = itemOf({ id: qid(1), workOrderId: woid('10') });
    expect(decideDispatch([item], snapshotOf({ spend: { [qid(1)]: 'hard_stop' } }))).toEqual([waitFor(item, 'budget')]);
  });

  it('R-34: spend warn and ok do not wait', () => {
    const warn = itemOf({ id: qid(1), workOrderId: woid('10') });
    const ok = itemOf({ id: qid(2), workOrderId: woid('20') });
    expect(
      decideDispatch([warn, ok], snapshotOf({ spend: { [qid(1)]: 'warn', [qid(2)]: 'ok' } })),
    ).toEqual([startFor(warn), startFor(ok)]);
  });

  it('R-34: headroom ok:false waits with quota and until = earliestRelief', () => {
    const item = itemOf({ id: qid(1), workOrderId: woid('10') });
    const headroom: Record<string, Headroom> = {
      [qid(1)]: { ok: false, blockedBy: [meterId('M0'), meterId('M1')], earliestRelief: NOW + HOUR },
    };
    expect(decideDispatch([item], snapshotOf({ headroom }))).toEqual([waitFor(item, 'quota', NOW + HOUR)]);
  });

  it('R-34: headroom ok:false without earliestRelief waits with quota and no until', () => {
    const item = itemOf({ id: qid(1), workOrderId: woid('10') });
    const headroom: Record<string, Headroom> = { [qid(1)]: { ok: false, blockedBy: [meterId('M0')] } };
    const decisions = decideDispatch([item], snapshotOf({ headroom }));
    expect(decisions).toEqual([{ item: qid(1), kind: 'wait', reason: 'quota' }]);
    expect('until' in decisions[0]).toBe(false);
  });

  it('R-34: headroom unknown starts — the transport will learn', () => {
    const noData = itemOf({ id: qid(1), workOrderId: woid('10') });
    const stale = itemOf({ id: qid(2), workOrderId: woid('20') });
    const headroom: Record<string, Headroom> = {
      [qid(1)]: { ok: 'unknown', reason: 'no_data' },
      [qid(2)]: { ok: 'unknown', reason: 'stale' },
    };
    expect(decideDispatch([noData, stale], snapshotOf({ headroom }))).toEqual([startFor(noData), startFor(stale)]);
  });

  it('R-34: a queue item missing from the headroom record starts', () => {
    const item = itemOf({ id: qid(1), workOrderId: woid('10') });
    expect(decideDispatch([item], snapshotOf({ headroom: { [qid(7)]: { ok: false, blockedBy: [meterId('M0')] } } }))).toEqual([
      startFor(item),
    ]);
  });

  it('R-34: first failing check wins — not_before precedes work order, limits, budget and quota', () => {
    const item = itemOf({ id: qid(1), workOrderId: woid('10'), route: ROUTE_A, notBefore: NOW + MINUTE });
    const running = [runOf(woid('10'), WS_ALPHA, ACCOUNT_A)];
    const decisions = decideDispatch(
      [item],
      snapshotOf({
        running,
        limits: { global: 0, perRepo: 0, perAccount: { [ACCOUNT_A]: 0 } },
        spend: { [qid(1)]: 'hard_stop' },
        headroom: { [qid(1)]: { ok: false, blockedBy: [meterId('M0')], earliestRelief: NOW + HOUR } },
      }),
    );
    expect(decisions).toEqual([waitFor(item, 'not_before', NOW + MINUTE)]);
  });

  it('R-34: work_order_busy precedes the limits', () => {
    const item = itemOf({ id: qid(1), workOrderId: woid('10') });
    const running = [runOf(woid('10'), WS_ALPHA, ACCOUNT_A)];
    // The global limit (1 running >= 1) would also fail, but the busy check comes first.
    expect(decideDispatch([item], snapshotOf({ running, limits: { global: 1, perRepo: 1, perAccount: {} } }))).toEqual([
      waitFor(item, 'work_order_busy'),
    ]);
  });

  it('R-34: global_limit precedes repo_limit', () => {
    const item = itemOf({ id: qid(1), workOrderId: woid('10') });
    expect(decideDispatch([item], snapshotOf({ limits: { global: 0, perRepo: 0, perAccount: {} } }))).toEqual([
      waitFor(item, 'global_limit'),
    ]);
  });

  it('R-34: repo_limit precedes account_limit', () => {
    const item = itemOf({ id: qid(1), workOrderId: woid('10'), repo: WS_ALPHA, route: ROUTE_A });
    expect(
      decideDispatch([item], snapshotOf({ limits: { global: 4, perRepo: 0, perAccount: { [ACCOUNT_A]: 0 } } })),
    ).toEqual([waitFor(item, 'repo_limit')]);
  });

  it('R-34: account_limit precedes budget', () => {
    const item = itemOf({ id: qid(1), workOrderId: woid('10'), route: ROUTE_A });
    const running = [runOf(woid('90'), WS_ALPHA, ACCOUNT_A)];
    expect(
      decideDispatch(
        [item],
        snapshotOf({
          running,
          limits: { global: 4, perRepo: 3, perAccount: { [ACCOUNT_A]: 1 } },
          spend: { [qid(1)]: 'hard_stop' },
        }),
      ),
    ).toEqual([waitFor(item, 'account_limit')]);
  });

  it('R-34: budget precedes quota', () => {
    const item = itemOf({ id: qid(1), workOrderId: woid('10') });
    const decisions = decideDispatch(
      [item],
      snapshotOf({
        spend: { [qid(1)]: 'hard_stop' },
        headroom: { [qid(1)]: { ok: false, blockedBy: [meterId('M0')], earliestRelief: NOW + HOUR } },
      }),
    );
    expect(decisions).toEqual([{ item: qid(1), kind: 'wait', reason: 'budget' }]);
    expect('until' in decisions[0]).toBe(false);
  });

  it('R-34: the wait reasons are exactly the seven contract members', () => {
    type ContractWaitReasons =
      | 'not_before'
      | 'work_order_busy'
      | 'global_limit'
      | 'repo_limit'
      | 'account_limit'
      | 'quota'
      | 'budget';
    const exact: UnionIsExactly<WaitReason, ContractWaitReasons> = true;
    expect(exact).toBe(true);
  });

  // --- R-35: starts inside this call consume capacity ------------------------------------------

  it('R-35: a start in this call consumes the global limit for later items', () => {
    const first = itemOf({ id: qid(1), workOrderId: woid('10'), priority: 10 });
    const second = itemOf({ id: qid(2), workOrderId: woid('20'), priority: 9 });
    expect(decideDispatch([first, second], snapshotOf({ limits: { global: 1, perRepo: 3, perAccount: {} } }))).toEqual([
      startFor(first),
      waitFor(second, 'global_limit'),
    ]);
  });

  it('R-35: a start in this call consumes the repo limit for later items', () => {
    const first = itemOf({ id: qid(1), workOrderId: woid('10'), priority: 10, repo: WS_ALPHA });
    const second = itemOf({ id: qid(2), workOrderId: woid('20'), priority: 9, repo: WS_ALPHA });
    expect(decideDispatch([first, second], snapshotOf({ limits: { global: 4, perRepo: 1, perAccount: {} } }))).toEqual([
      startFor(first),
      waitFor(second, 'repo_limit'),
    ]);
  });

  it('R-35: a start in this call consumes the account limit for later items', () => {
    const first = itemOf({ id: qid(1), workOrderId: woid('10'), priority: 10, route: ROUTE_A });
    const second = itemOf({ id: qid(2), workOrderId: woid('20'), priority: 9, route: ROUTE_A });
    expect(
      decideDispatch([first, second], snapshotOf({ limits: { global: 4, perRepo: 3, perAccount: { [ACCOUNT_A]: 1 } } })),
    ).toEqual([startFor(first), waitFor(second, 'account_limit')]);
  });

  it('R-35: a waiting item consumes no limit capacity', () => {
    const first = itemOf({ id: qid(1), workOrderId: woid('10'), priority: 30 });
    const blocked = itemOf({ id: qid(2), workOrderId: woid('20'), priority: 20 });
    const last = itemOf({ id: qid(3), workOrderId: woid('30'), priority: 10 });
    const headroom: Record<string, Headroom> = { [qid(2)]: { ok: false, blockedBy: [meterId('M0')] } };
    expect(decideDispatch([first, blocked, last], snapshotOf({ limits: { global: 2, perRepo: 3, perAccount: {} }, headroom }))).toEqual([
      startFor(first),
      waitFor(blocked, 'quota'),
      startFor(last),
    ]);
  });

  // --- purity ----------------------------------------------------------------------------------

  it('does not mutate its inputs', () => {
    const queue = [
      itemOf({ id: qid(2), workOrderId: woid('20'), priority: 1 }),
      itemOf({ id: qid(1), workOrderId: woid('10'), priority: 5 }),
    ];
    const snapshot = snapshotOf({
      running: [runOf(woid('90'), WS_ALPHA, ACCOUNT_A)],
      limits: { global: 1, perRepo: 1, perAccount: { [ACCOUNT_A]: 1 } },
      spend: { [qid(1)]: 'warn' },
    });
    deepFreeze(queue);
    deepFreeze(snapshot);

    expect(() => decideDispatch(queue, snapshot)).not.toThrow();
    expect(queue.map((item) => item.id)).toEqual([qid(2), qid(1)]);
  });

  // --- acceptance scenarios from the issue -------------------------------------------------------

  it('acceptance: 6 items, 2 repos, 2 accounts decide start/start/repo_limit/budget/quota/not_before', () => {
    const first = itemOf({ id: qid(1), workOrderId: woid('10'), repo: WS_ALPHA, priority: 60, enqueuedAt: NOW - 600, route: ROUTE_A });
    const second = itemOf({ id: qid(2), workOrderId: woid('20'), repo: WS_ALPHA, priority: 50, enqueuedAt: NOW - 500, route: ROUTE_B });
    const third = itemOf({ id: qid(3), workOrderId: woid('30'), repo: WS_ALPHA, priority: 40, enqueuedAt: NOW - 400, route: ROUTE_B });
    const fourth = itemOf({ id: qid(4), workOrderId: woid('40'), repo: WS_BETA, priority: 30, enqueuedAt: NOW - 300, route: ROUTE_A });
    const fifth = itemOf({ id: qid(5), workOrderId: woid('50'), repo: WS_BETA, priority: 20, enqueuedAt: NOW - 200, route: ROUTE_B });
    const sixth = itemOf({ id: qid(6), workOrderId: woid('60'), repo: WS_BETA, priority: 10, enqueuedAt: NOW - 100, route: ROUTE_A, notBefore: NOW + MINUTE });
    const queue = [sixth, third, first, fifth, second, fourth];

    const decisions = decideDispatch(
      queue,
      snapshotOf({
        running: [runOf(woid('90'), WS_ALPHA, ACCOUNT_A)],
        limits: { global: 4, perRepo: 3, perAccount: {} },
        headroom: {
          [qid(1)]: OK_ROOM,
          [qid(2)]: OK_ROOM,
          [qid(3)]: OK_ROOM,
          [qid(4)]: OK_ROOM,
          [qid(5)]: { ok: false, blockedBy: [meterId('M0')], earliestRelief: NOW + HOUR },
          [qid(6)]: { ok: 'unknown', reason: 'stale' },
        },
        spend: { [qid(4)]: 'hard_stop' },
      }),
    );

    expect(decisions).toEqual([
      startFor(first),
      startFor(second),
      waitFor(third, 'repo_limit'),
      waitFor(fourth, 'budget'),
      waitFor(fifth, 'quota', NOW + HOUR),
      waitFor(sixth, 'not_before', NOW + MINUTE),
    ]);
  });

  it('acceptance: two items for the same work order — only the first can start', () => {
    const first = itemOf({ id: qid(1), workOrderId: woid('10'), priority: 10 });
    const second = itemOf({ id: qid(2), workOrderId: woid('10'), priority: 9 });
    // Limits would allow both, so the wait reason must be the shared work order.
    expect(decideDispatch([first, second], snapshotOf())).toEqual([startFor(first), waitFor(second, 'work_order_busy')]);
  });

  it('handoffOf rides the item but changes no decision — a continuation starts like any run', () => {
    const continuation: QueueItem = {
      ...itemOf({ id: qid(1), workOrderId: woid('10') }),
      handoffOf: ulidOf('99') as RunId,
    };

    expect(decideDispatch([continuation], snapshotOf())).toEqual([startFor(continuation)]);
  });
});
