// Headroom: whether a model on an account has usable quota right now. Contract: docs/v2/domain.md section 6.
import type { AccountId, EpochMs, MeterId, PoolId } from '../shared/index';
import type { Meter, Pool, PoolKind } from './types';

/** The share of a window the user keeps back for their own use (0..RESERVE_MAX). `short` applies to
 *  windows shorter than one day, `long` to windows of a day or longer. Absent or 0 means no reserve. */
export interface QuotaReserve {
  readonly short?: number;
  readonly long?: number;
}

// A reserve of 1 would block the account forever; the cap keeps some window usable by definition.
export const RESERVE_MAX = 0.95;

const DAY_MS = 86_400_000;

// Which reserve value governs a meter: by window length when the provider gave one, otherwise by
// cadence, and when even that says nothing the stricter of the two values applies.
function reserveFor(meter: Meter, reserve: QuotaReserve): number {
  const short = reserve.short ?? 0;
  const long = reserve.long ?? 0;
  if (meter.durationMs !== undefined) return meter.durationMs < DAY_MS ? short : long;
  if (meter.cadence === 'calendar' || meter.cadence === 'billing_cycle') return long;
  return Math.max(short, long);
}

export type Headroom =
  | { readonly ok: true; readonly lowest?: number } // lowest normalized remaining seen
  | { readonly ok: false; readonly blockedBy: readonly MeterId[]; readonly earliestRelief?: EpochMs; readonly byReserve?: true }
  | { readonly ok: 'unknown'; readonly reason: 'no_data' | 'stale' };

export function matchesModel(pool: Pool, model: string): boolean {
  if (pool.appliesTo === 'all') return true;
  // Unknown applicability is information, not a match: the pool is never routed to a model, so
  // its meters cannot block any run.
  if (pool.appliesTo === 'unknown') return false;
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
  reserve?: QuotaReserve,
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
  let allByReserve = true;

  for (const meter of relevant) {
    // A reset that has already passed says nothing about the present: unknown, not blocking.
    if (meter.resetsAt !== undefined && meter.resetsAt <= now) continue;

    const normalized = normalizedRemaining(meter);
    if (normalized !== undefined && (lowest === undefined || normalized < lowest)) lowest = normalized;

    // Throughput pools are transient rate limits: they throttle, they never block.
    if (kindByPoolId.get(meter.poolId) === 'throughput') continue;

    const exhausted = normalized === 0 || (meter.remaining !== undefined && meter.remaining <= 0);
    // Unknown remaining never blocks by reserve: no number, no claim on the user's share.
    const reserved =
      !exhausted && reserve !== undefined && normalized !== undefined && normalized <= reserveFor(meter, reserve);
    if (exhausted || reserved) {
      if (exhausted) allByReserve = false;
      blockedBy.push(meter.id);
      if (meter.resetsAt !== undefined && (earliestRelief === undefined || meter.resetsAt < earliestRelief)) {
        earliestRelief = meter.resetsAt;
      }
    }
  }

  if (blockedBy.length > 0) {
    return {
      ok: false,
      blockedBy,
      ...(earliestRelief === undefined ? {} : { earliestRelief }),
      ...(allByReserve ? { byReserve: true as const } : {}),
    };
  }
  return lowest === undefined ? { ok: true } : { ok: true, lowest };
}
