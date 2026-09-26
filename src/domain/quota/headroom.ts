// Headroom: whether a model on an account has usable quota right now. Contract: docs/v2/domain.md section 6.
import type { AccountId, EpochMs, MeterId, PoolId } from '../shared/index';
import type { Meter, Pool, PoolKind } from './types';

export type Headroom =
  | { readonly ok: true; readonly lowest?: number } // lowest normalized remaining seen
  | { readonly ok: false; readonly blockedBy: readonly MeterId[]; readonly earliestRelief?: EpochMs }
  | { readonly ok: 'unknown'; readonly reason: 'no_data' | 'stale' };

export function matchesModel(pool: Pool, model: string): boolean {
  if (pool.appliesTo === 'all') return true;
  const lower = model.toLowerCase();
  return pool.appliesTo.some((matcher) =>
    'exact' in matcher ? matcher.exact.toLowerCase() === lower : lower.startsWith(matcher.prefix.toLowerCase()),
  );
}

export function poolsForModel(pools: readonly Pool[], accountId: AccountId, model: string): readonly Pool[] {
  return pools.filter((pool) => pool.accountId === accountId && matchesModel(pool, model));
}

export function normalizedRemaining(meter: Meter): number | undefined {
  const clamp01 = (value: number): number => Math.min(1, Math.max(0, value));

  // fraction and percent carry their own scale, so no limit is needed to normalize them.
  if (meter.unit === 'fraction') {
    return meter.remaining === undefined ? undefined : clamp01(meter.remaining);
  }
  if (meter.unit === 'percent') {
    return meter.remaining === undefined ? undefined : clamp01(meter.remaining / 100);
  }

  // Count-like and money-like units need a limit. A non-positive limit would divide by
  // zero, which is not a usable number either.
  const { remaining, used, limit } = meter;
  if (limit !== undefined && limit > 0) {
    if (remaining !== undefined) return clamp01(remaining / limit);
    if (used !== undefined) return clamp01(1 - used / limit);
  }
  return undefined;
}

export function isStale(meter: Meter, now: EpochMs): boolean {
  return meter.staleAfterMs !== undefined && now - meter.observedAt > meter.staleAfterMs;
}

export function headroom(
  pools: readonly Pool[],
  meters: readonly Meter[],
  accountId: AccountId,
  model: string,
  now: EpochMs,
): Headroom {
  const kindByPoolId = new Map<PoolId, PoolKind>(
    poolsForModel(pools, accountId, model).map((pool) => [pool.id, pool.kind] as const),
  );
  const relevant = meters.filter((meter) => kindByPoolId.has(meter.poolId));

  if (relevant.length === 0) return { ok: 'unknown', reason: 'no_data' };
  // Staleness only collapses the verdict when nothing fresh is left; while fresh data
  // exists the stale meters still take part, erring on the conservative side.
  if (relevant.every((meter) => isStale(meter, now))) return { ok: 'unknown', reason: 'stale' };

  const blockedBy: MeterId[] = [];
  let earliestRelief: EpochMs | undefined;
  let lowest: number | undefined;

  for (const meter of relevant) {
    // A reset that has already passed says nothing about the present: unknown, not blocking.
    if (meter.resetsAt !== undefined && meter.resetsAt <= now) continue;

    const normalized = normalizedRemaining(meter);
    if (normalized !== undefined && (lowest === undefined || normalized < lowest)) lowest = normalized;

    // Throughput pools are transient rate limits: they throttle, they never block.
    if (kindByPoolId.get(meter.poolId) === 'throughput') continue;

    const exhausted = normalized === 0 || (meter.remaining !== undefined && meter.remaining <= 0);
    if (exhausted) {
      blockedBy.push(meter.id);
      if (meter.resetsAt !== undefined && (earliestRelief === undefined || meter.resetsAt < earliestRelief)) {
        earliestRelief = meter.resetsAt;
      }
    }
  }

  if (blockedBy.length > 0) {
    return earliestRelief === undefined ? { ok: false, blockedBy } : { ok: false, blockedBy, earliestRelief };
  }
  return lowest === undefined ? { ok: true } : { ok: true, lowest };
}
