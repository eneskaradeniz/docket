import { describe, expect, it } from 'vitest';
import { HOUR, MINUTE, type AccountId, type EpochMs, type MeterId, type PoolId } from '../shared/index';
import { headroom, isStale, matchesModel, normalizedRemaining, poolsForModel } from './headroom';
import type { Meter, MeterUnit, ModelMatcher, Pool, PoolKind } from './types';

const NOW: EpochMs = 1_750_000_000_000;

const ACCOUNT_MAIN = '01ARZ3NDEKTSV4RRFFQ69G5FAV' as AccountId;
const ACCOUNT_OTHER = '01ARZ3NDEKTSV4RRFFQ69G5FBV' as AccountId;

const POOL_ATLAS = '01ARZ3NDEKTSV4RRFFQ69G5FP1' as PoolId;
const POOL_SECOND = '01ARZ3NDEKTSV4RRFFQ69G5FP2' as PoolId;
const POOL_SHARED = '01ARZ3NDEKTSV4RRFFQ69G5FP3' as PoolId;
const POOL_TPUT = '01ARZ3NDEKTSV4RRFFQ69G5FP4' as PoolId;
const POOL_OTHER_ACCOUNT = '01ARZ3NDEKTSV4RRFFQ69G5FP5' as PoolId;

const M_ATLAS_WEEKLY = '01ARZ3NDEKTSV4RRFFQ69G5FM1' as MeterId;
const M_ATLAS_5H = '01ARZ3NDEKTSV4RRFFQ69G5FM2' as MeterId;
const M_SECOND_WEEKLY = '01ARZ3NDEKTSV4RRFFQ69G5FM3' as MeterId;
const M_SHARED = '01ARZ3NDEKTSV4RRFFQ69G5FM4' as MeterId;
const M_TPUT = '01ARZ3NDEKTSV4RRFFQ69G5FM5' as MeterId;
const M_OTHER_ACCOUNT = '01ARZ3NDEKTSV4RRFFQ69G5FM6' as MeterId;

interface PoolInit {
  readonly id: PoolId;
  readonly accountId?: AccountId;
  readonly kind?: PoolKind;
  readonly appliesTo?: readonly ModelMatcher[] | 'all' | 'unknown';
  readonly label?: string;
}

const poolOf = (init: PoolInit): Pool => ({
  id: init.id,
  accountId: init.accountId ?? ACCOUNT_MAIN,
  label: init.label ?? 'pool',
  kind: init.kind ?? 'allowance',
  appliesTo: init.appliesTo ?? 'all',
});

interface MeterInit {
  readonly id: MeterId;
  readonly poolId: PoolId;
  readonly unit?: MeterUnit;
  readonly used?: number;
  readonly limit?: number;
  readonly remaining?: number;
  readonly resetsAt?: EpochMs;
  readonly observedAt?: EpochMs;
  readonly staleAfterMs?: number;
}

const meterOf = (init: MeterInit): Meter => ({
  id: init.id,
  poolId: init.poolId,
  cadence: 'fixed',
  unit: init.unit ?? 'requests',
  used: init.used,
  limit: init.limit,
  remaining: init.remaining,
  resetsAt: init.resetsAt,
  resetPrecision: 'exact',
  observedAt: init.observedAt ?? NOW,
  source: 'polled',
  staleAfterMs: init.staleAfterMs,
});

describe('matchesModel', () => {
  it('R-25: appliesTo "all" matches every model', () => {
    const pool = poolOf({ id: POOL_SHARED });
    expect(matchesModel(pool, 'atlas-pro')).toBe(true);
    expect(matchesModel(pool, 'claude-opus-4-6')).toBe(true);
    expect(matchesModel(pool, '')).toBe(true);
  });

  it('R-25: an exact matcher compares case-insensitively', () => {
    const pool = poolOf({ id: POOL_ATLAS, appliesTo: [{ exact: 'atlas-pro' }] });
    expect(matchesModel(pool, 'atlas-pro')).toBe(true);
    expect(matchesModel(pool, 'ATLAS-PRO')).toBe(true);
    expect(matchesModel(pool, 'Atlas-Pro')).toBe(true);
    expect(matchesModel(pool, 'atlas-pro-preview')).toBe(false);
    expect(matchesModel(pool, 'atlaspro')).toBe(false);
  });

  it('R-25: a prefix matcher is a case-insensitive prefix of the model name', () => {
    const pool = poolOf({ id: POOL_ATLAS, appliesTo: [{ prefix: 'atlas-' }] });
    expect(matchesModel(pool, 'ATLAS-PRO')).toBe(true);
    expect(matchesModel(pool, 'atlas-flash-lite')).toBe(true);
    expect(matchesModel(pool, 'gpt-5-code')).toBe(false);
    expect(matchesModel(pool, 'xatlas-pro')).toBe(false);
  });

  it('R-25: a pool matches when any matcher in the list matches, and an empty list matches nothing', () => {
    const pool = poolOf({
      id: POOL_ATLAS,
      appliesTo: [{ exact: 'claude-opus-4-6' }, { prefix: 'atlas-' }],
    });
    expect(matchesModel(pool, 'atlas-pro')).toBe(true);
    expect(matchesModel(pool, 'claude-opus-4-6')).toBe(true);
    expect(matchesModel(pool, 'gpt-5')).toBe(false);

    const empty = poolOf({ id: POOL_ATLAS, appliesTo: [] });
    expect(matchesModel(empty, 'atlas-pro')).toBe(false);
  });

  it('R-25: a pool with unknown applicability matches no model', () => {
    const pool = poolOf({ id: POOL_ATLAS, appliesTo: 'unknown' });
    expect(matchesModel(pool, 'atlas-pro')).toBe(false);
    expect(matchesModel(pool, 'gpt-5')).toBe(false);
    expect(matchesModel(pool, '')).toBe(false);
  });
});

describe('poolsForModel', () => {
  it('R-25: keeps only the account\'s pools whose matchers fit the model', () => {
    const pools: readonly Pool[] = [
      poolOf({ id: POOL_OTHER_ACCOUNT, accountId: ACCOUNT_OTHER, appliesTo: [{ prefix: 'atlas-' }] }),
      poolOf({ id: POOL_SHARED }),
      poolOf({ id: POOL_ATLAS, appliesTo: [{ prefix: 'atlas-' }] }),
      poolOf({ id: POOL_SECOND, appliesTo: [{ prefix: 'claude-' }] }),
    ];
    const ids = poolsForModel(pools, ACCOUNT_MAIN, 'atlas-pro').map((pool) => pool.id);
    expect(ids).toEqual([POOL_SHARED, POOL_ATLAS]);
  });

  it('preserves the input order and returns a new array', () => {
    const pools: readonly Pool[] = [
      poolOf({ id: POOL_ATLAS, appliesTo: [{ prefix: 'atlas-' }] }),
      poolOf({ id: POOL_SHARED }),
    ];
    const result = poolsForModel(pools, ACCOUNT_MAIN, 'atlas-pro');
    expect(result.map((pool) => pool.id)).toEqual([POOL_ATLAS, POOL_SHARED]);
    expect(result).not.toBe(pools);
  });

  it('returns an empty array for empty input', () => {
    expect(poolsForModel([], ACCOUNT_MAIN, 'atlas-pro')).toEqual([]);
  });

  it('R-25: a pool with unknown applicability is never returned, whatever the model', () => {
    const pools: readonly Pool[] = [
      poolOf({ id: POOL_SHARED }),
      poolOf({ id: POOL_ATLAS, appliesTo: 'unknown' }),
    ];
    expect(poolsForModel(pools, ACCOUNT_MAIN, 'atlas-pro').map((pool) => pool.id)).toEqual([POOL_SHARED]);
    expect(poolsForModel([poolOf({ id: POOL_ATLAS, appliesTo: 'unknown' })], ACCOUNT_MAIN, 'gpt-5')).toEqual([]);
  });
});

describe('normalizedRemaining', () => {
  it('R-26: fraction returns remaining as-is', () => {
    expect(normalizedRemaining(meterOf({ id: M_SHARED, poolId: POOL_SHARED, unit: 'fraction', remaining: 0.37 }))).toBe(0.37);
  });

  it('R-26: fraction clamps to 0..1 and is undefined without remaining', () => {
    expect(normalizedRemaining(meterOf({ id: M_SHARED, poolId: POOL_SHARED, unit: 'fraction', remaining: 1.9 }))).toBe(1);
    expect(normalizedRemaining(meterOf({ id: M_SHARED, poolId: POOL_SHARED, unit: 'fraction', remaining: -0.4 }))).toBe(0);
    // fraction is already normalized; used/limit is not consulted for it.
    expect(normalizedRemaining(meterOf({ id: M_SHARED, poolId: POOL_SHARED, unit: 'fraction', used: 80, limit: 100 }))).toBeUndefined();
  });

  it('R-26: percent returns remaining / 100', () => {
    expect(normalizedRemaining(meterOf({ id: M_SHARED, poolId: POOL_SHARED, unit: 'percent', remaining: 42 }))).toBe(0.42);
  });

  it('R-26: percent clamps to 0..1 and is undefined without remaining', () => {
    expect(normalizedRemaining(meterOf({ id: M_SHARED, poolId: POOL_SHARED, unit: 'percent', remaining: 250 }))).toBe(1);
    expect(normalizedRemaining(meterOf({ id: M_SHARED, poolId: POOL_SHARED, unit: 'percent', remaining: -7 }))).toBe(0);
    expect(normalizedRemaining(meterOf({ id: M_SHARED, poolId: POOL_SHARED, unit: 'percent', used: 30, limit: 100 }))).toBeUndefined();
  });

  it('R-26: other units return remaining / limit when both are known', () => {
    expect(normalizedRemaining(meterOf({ id: M_SHARED, poolId: POOL_SHARED, unit: 'requests', remaining: 25, limit: 100 }))).toBe(0.25);
  });

  it('R-26: remaining / limit wins over used / limit when both pairs are known', () => {
    const meter = meterOf({ id: M_SHARED, poolId: POOL_SHARED, unit: 'tokens', remaining: 10, used: 90, limit: 100 });
    expect(normalizedRemaining(meter)).toBe(0.1);
  });

  it('R-26: other units fall back to 1 - used / limit when remaining is unknown', () => {
    expect(normalizedRemaining(meterOf({ id: M_SHARED, poolId: POOL_SHARED, unit: 'credits', used: 75, limit: 100 }))).toBe(0.25);
  });

  it('R-26: the used / limit fallback clamps at both ends', () => {
    expect(normalizedRemaining(meterOf({ id: M_SHARED, poolId: POOL_SHARED, unit: 'usd', used: 150, limit: 100 }))).toBe(0);
    expect(normalizedRemaining(meterOf({ id: M_SHARED, poolId: POOL_SHARED, unit: 'usd', used: -20, limit: 100 }))).toBe(1);
  });

  it('R-26: returns undefined when the meter carries no usable pair', () => {
    // nothing at all
    expect(normalizedRemaining(meterOf({ id: M_SHARED, poolId: POOL_SHARED }))).toBeUndefined();
    // remaining alone, no limit
    expect(normalizedRemaining(meterOf({ id: M_SHARED, poolId: POOL_SHARED, remaining: 30 }))).toBeUndefined();
    // used alone, no limit
    expect(normalizedRemaining(meterOf({ id: M_SHARED, poolId: POOL_SHARED, used: 70 }))).toBeUndefined();
    // a non-positive limit cannot normalize anything: it would divide by zero.
    expect(normalizedRemaining(meterOf({ id: M_SHARED, poolId: POOL_SHARED, remaining: 5, limit: 0 }))).toBeUndefined();
    expect(normalizedRemaining(meterOf({ id: M_SHARED, poolId: POOL_SHARED, remaining: 5, limit: -10 }))).toBeUndefined();
  });
});

describe('isStale', () => {
  it('R-27: is stale when staleAfterMs is given and now - observedAt exceeds it', () => {
    const meter = meterOf({ id: M_SHARED, poolId: POOL_SHARED, observedAt: NOW - 10 * MINUTE, staleAfterMs: 5 * MINUTE });
    expect(isStale(meter, NOW)).toBe(true);
  });

  it('R-27: the boundary now - observedAt === staleAfterMs is not stale', () => {
    const meter = meterOf({ id: M_SHARED, poolId: POOL_SHARED, observedAt: NOW - 5 * MINUTE, staleAfterMs: 5 * MINUTE });
    expect(isStale(meter, NOW)).toBe(false);
    expect(isStale(meter, NOW + 1)).toBe(true);
  });

  it('R-27: a meter without staleAfterMs is never stale, however old', () => {
    const meter = meterOf({ id: M_SHARED, poolId: POOL_SHARED, observedAt: NOW - 100 * HOUR });
    expect(isStale(meter, NOW)).toBe(false);
  });

  it('R-27: a fresh observation is not stale', () => {
    const meter = meterOf({ id: M_SHARED, poolId: POOL_SHARED, observedAt: NOW, staleAfterMs: MINUTE });
    expect(isStale(meter, NOW)).toBe(false);
  });
});

describe('headroom', () => {
  it('R-28: model-group routing — only the matching pool\'s meters are ANDed', () => {
    const pools: readonly Pool[] = [
      poolOf({ id: POOL_ATLAS, label: 'atlas group', appliesTo: [{ prefix: 'atlas-' }] }),
      poolOf({ id: POOL_SECOND, label: 'claude group', appliesTo: [{ prefix: 'claude-' }] }),
    ];
    const weeklyReset = NOW + 30 * HOUR;
    const meters: readonly Meter[] = [
      meterOf({ id: M_ATLAS_WEEKLY, poolId: POOL_ATLAS, remaining: 0, limit: 100, resetsAt: weeklyReset }),
      meterOf({ id: M_ATLAS_5H, poolId: POOL_ATLAS, remaining: 40, limit: 200, resetsAt: NOW + 3 * HOUR }),
      // the sibling group is equally exhausted; it must not affect the atlas verdict
      meterOf({ id: M_SECOND_WEEKLY, poolId: POOL_SECOND, remaining: 0, limit: 50, resetsAt: weeklyReset }),
    ];

    expect(headroom(pools, meters, ACCOUNT_MAIN, 'atlas-pro', NOW)).toEqual({
      ok: false,
      blockedBy: [M_ATLAS_WEEKLY],
      earliestRelief: weeklyReset,
    });
    expect(headroom(pools, meters, ACCOUNT_MAIN, 'claude-opus-4-6', NOW)).toEqual({
      ok: false,
      blockedBy: [M_SECOND_WEEKLY],
      earliestRelief: weeklyReset,
    });

    // with the atlas weekly meter healthy, the 5-hour meter is the only constraint left
    const healthy: readonly Meter[] = [
      meterOf({ id: M_ATLAS_WEEKLY, poolId: POOL_ATLAS, remaining: 80, limit: 100, resetsAt: weeklyReset }),
      meters[1],
      meters[2],
    ];
    expect(headroom(pools, healthy, ACCOUNT_MAIN, 'atlas-pro', NOW)).toEqual({ ok: true, lowest: 0.2 });
  });

  it('R-28: a throughput pool at 0 never blocks', () => {
    const pools: readonly Pool[] = [poolOf({ id: POOL_TPUT, kind: 'throughput' })];
    const meters: readonly Meter[] = [
      meterOf({ id: M_TPUT, poolId: POOL_TPUT, remaining: 0, limit: 100 }),
    ];
    expect(headroom(pools, meters, ACCOUNT_MAIN, 'atlas-pro', NOW)).toEqual({ ok: true, lowest: 0 });

    // a throughput pool at 0 next to an exhausted allowance pool blocks on the allowance only
    const mixedPools: readonly Pool[] = [
      poolOf({ id: POOL_TPUT, kind: 'throughput' }),
      poolOf({ id: POOL_ATLAS, appliesTo: [{ prefix: 'atlas-' }] }),
    ];
    const mixedMeters: readonly Meter[] = [
      meterOf({ id: M_TPUT, poolId: POOL_TPUT, remaining: 0, limit: 100 }),
      meterOf({ id: M_ATLAS_WEEKLY, poolId: POOL_ATLAS, remaining: 0, limit: 100, resetsAt: NOW + HOUR }),
    ];
    expect(headroom(mixedPools, mixedMeters, ACCOUNT_MAIN, 'atlas-pro', NOW)).toEqual({
      ok: false,
      blockedBy: [M_ATLAS_WEEKLY],
      earliestRelief: NOW + HOUR,
    });
  });

  it('R-28: a meter whose resetsAt <= now does not block and carries no signal', () => {
    const pools: readonly Pool[] = [poolOf({ id: POOL_ATLAS, appliesTo: [{ prefix: 'atlas-' }] })];

    // boundary: the reset is due exactly now
    const dueNow = meterOf({ id: M_ATLAS_WEEKLY, poolId: POOL_ATLAS, remaining: 0, limit: 100, resetsAt: NOW });
    expect(headroom(pools, [dueNow], ACCOUNT_MAIN, 'atlas-pro', NOW)).toEqual({ ok: true });

    // already reset a while ago, and it must not drag the lowest down either
    const past = meterOf({ id: M_ATLAS_WEEKLY, poolId: POOL_ATLAS, remaining: 0, limit: 100, resetsAt: NOW - MINUTE });
    const healthy = meterOf({ id: M_ATLAS_5H, poolId: POOL_ATLAS, remaining: 30, limit: 100 });
    expect(headroom(pools, [past, healthy], ACCOUNT_MAIN, 'atlas-pro', NOW)).toEqual({ ok: true, lowest: 0.3 });
  });

  it('R-28: blocks on a normalized remaining of 0 computed from used / limit', () => {
    const pools: readonly Pool[] = [poolOf({ id: POOL_ATLAS, appliesTo: [{ prefix: 'atlas-' }] })];
    const meters: readonly Meter[] = [
      meterOf({ id: M_ATLAS_WEEKLY, poolId: POOL_ATLAS, used: 100, limit: 100, resetsAt: NOW + HOUR }),
    ];
    expect(headroom(pools, meters, ACCOUNT_MAIN, 'atlas-pro', NOW)).toEqual({
      ok: false,
      blockedBy: [M_ATLAS_WEEKLY],
      earliestRelief: NOW + HOUR,
    });
  });

  it('R-28: blocks on remaining <= 0 even when the numbers cannot normalize, with no relief time', () => {
    const pools: readonly Pool[] = [poolOf({ id: POOL_ATLAS, appliesTo: [{ prefix: 'atlas-' }] })];
    const meters: readonly Meter[] = [
      meterOf({ id: M_ATLAS_WEEKLY, poolId: POOL_ATLAS, remaining: 0 }),
      meterOf({ id: M_ATLAS_5H, poolId: POOL_ATLAS, remaining: -3, limit: 10 }),
    ];
    expect(headroom(pools, meters, ACCOUNT_MAIN, 'atlas-pro', NOW)).toEqual({
      ok: false,
      blockedBy: [M_ATLAS_WEEKLY, M_ATLAS_5H],
    });
  });

  it('R-28: no meters at all is unknown with reason no_data', () => {
    expect(headroom([], [], ACCOUNT_MAIN, 'atlas-pro', NOW)).toEqual({ ok: 'unknown', reason: 'no_data' });

    // pools exist for the model but nothing has been observed yet
    const pools: readonly Pool[] = [poolOf({ id: POOL_ATLAS, appliesTo: [{ prefix: 'atlas-' }] })];
    expect(headroom(pools, [], ACCOUNT_MAIN, 'atlas-pro', NOW)).toEqual({ ok: 'unknown', reason: 'no_data' });

    // meters exist, but they belong to other pools
    const foreign: readonly Meter[] = [
      meterOf({ id: M_SECOND_WEEKLY, poolId: POOL_SECOND, remaining: 0, limit: 50, resetsAt: NOW + HOUR }),
    ];
    expect(headroom(pools, foreign, ACCOUNT_MAIN, 'atlas-pro', NOW)).toEqual({ ok: 'unknown', reason: 'no_data' });
  });

  it('R-28: all relevant meters stale is unknown with reason stale, even at zero', () => {
    const pools: readonly Pool[] = [poolOf({ id: POOL_ATLAS, appliesTo: [{ prefix: 'atlas-' }] })];
    const meters: readonly Meter[] = [
      meterOf({
        id: M_ATLAS_WEEKLY,
        poolId: POOL_ATLAS,
        remaining: 0,
        limit: 100,
        resetsAt: NOW + HOUR,
        observedAt: NOW - 10 * MINUTE,
        staleAfterMs: 5 * MINUTE,
      }),
      meterOf({
        id: M_ATLAS_5H,
        poolId: POOL_ATLAS,
        remaining: 40,
        limit: 100,
        observedAt: NOW - 6 * MINUTE,
        staleAfterMs: MINUTE,
      }),
    ];
    expect(headroom(pools, meters, ACCOUNT_MAIN, 'atlas-pro', NOW)).toEqual({ ok: 'unknown', reason: 'stale' });
  });

  it('R-28: a meter without staleAfterMs counts as fresh and keeps the verdict off "stale"', () => {
    const pools: readonly Pool[] = [poolOf({ id: POOL_ATLAS, appliesTo: [{ prefix: 'atlas-' }] })];
    const meters: readonly Meter[] = [
      meterOf({
        id: M_ATLAS_WEEKLY,
        poolId: POOL_ATLAS,
        remaining: 0,
        limit: 100,
        resetsAt: NOW + HOUR,
        observedAt: NOW - 10 * MINUTE,
        staleAfterMs: 5 * MINUTE,
      }),
      meterOf({ id: M_ATLAS_5H, poolId: POOL_ATLAS, remaining: 50, limit: 100 }),
    ];
    expect(headroom(pools, meters, ACCOUNT_MAIN, 'atlas-pro', NOW)).toEqual({
      ok: false,
      blockedBy: [M_ATLAS_WEEKLY],
      earliestRelief: NOW + HOUR,
    });
  });

  it('R-28: a stale zero still blocks while at least one fresh meter exists', () => {
    const pools: readonly Pool[] = [poolOf({ id: POOL_ATLAS, appliesTo: [{ prefix: 'atlas-' }] })];
    const meters: readonly Meter[] = [
      meterOf({ id: M_ATLAS_5H, poolId: POOL_ATLAS, remaining: 40, limit: 100, staleAfterMs: 5 * MINUTE }),
      meterOf({
        id: M_ATLAS_WEEKLY,
        poolId: POOL_ATLAS,
        remaining: 0,
        limit: 100,
        resetsAt: NOW + HOUR,
        observedAt: NOW - 10 * MINUTE,
        staleAfterMs: 5 * MINUTE,
      }),
    ];
    expect(headroom(pools, meters, ACCOUNT_MAIN, 'atlas-pro', NOW)).toEqual({
      ok: false,
      blockedBy: [M_ATLAS_WEEKLY],
      earliestRelief: NOW + HOUR,
    });
  });

  it('R-28: ok carries the lowest normalized remaining across every matching pool', () => {
    const pools: readonly Pool[] = [
      poolOf({ id: POOL_ATLAS, appliesTo: [{ prefix: 'atlas-' }] }),
      poolOf({ id: POOL_SHARED }),
    ];
    const meters: readonly Meter[] = [
      meterOf({ id: M_ATLAS_5H, poolId: POOL_ATLAS, remaining: 50, limit: 100 }),
      meterOf({ id: M_SHARED, poolId: POOL_SHARED, remaining: 40, limit: 200 }),
    ];
    expect(headroom(pools, meters, ACCOUNT_MAIN, 'atlas-pro', NOW)).toEqual({ ok: true, lowest: 0.2 });
  });

  it('R-28: ok omits lowest when no relevant meter carries usable numbers', () => {
    const pools: readonly Pool[] = [poolOf({ id: POOL_ATLAS, appliesTo: [{ prefix: 'atlas-' }] })];
    const meters: readonly Meter[] = [meterOf({ id: M_ATLAS_WEEKLY, poolId: POOL_ATLAS })];
    expect(headroom(pools, meters, ACCOUNT_MAIN, 'atlas-pro', NOW)).toEqual({ ok: true });
  });

  it('R-28: only the given account\'s pools are considered', () => {
    const pools: readonly Pool[] = [
      poolOf({ id: POOL_OTHER_ACCOUNT, accountId: ACCOUNT_OTHER, appliesTo: [{ prefix: 'atlas-' }] }),
      poolOf({ id: POOL_ATLAS, appliesTo: [{ prefix: 'atlas-' }] }),
    ];
    const meters: readonly Meter[] = [
      meterOf({ id: M_OTHER_ACCOUNT, poolId: POOL_OTHER_ACCOUNT, remaining: 0, limit: 100, resetsAt: NOW + HOUR }),
      meterOf({ id: M_ATLAS_5H, poolId: POOL_ATLAS, remaining: 70, limit: 100 }),
    ];
    expect(headroom(pools, meters, ACCOUNT_MAIN, 'atlas-pro', NOW)).toEqual({ ok: true, lowest: 0.7 });
  });

  it('R-29: earliestRelief is the minimum resetsAt among blocking meters', () => {
    const pools: readonly Pool[] = [
      poolOf({ id: POOL_ATLAS, appliesTo: [{ prefix: 'atlas-' }] }),
      poolOf({ id: POOL_SHARED }),
    ];
    const meters: readonly Meter[] = [
      meterOf({ id: M_ATLAS_WEEKLY, poolId: POOL_ATLAS, remaining: 0, limit: 100, resetsAt: NOW + 10 * HOUR }),
      meterOf({ id: M_ATLAS_5H, poolId: POOL_ATLAS, remaining: 0 }),
      meterOf({ id: M_SHARED, poolId: POOL_SHARED, remaining: 0, limit: 100, resetsAt: NOW + 2 * HOUR }),
    ];
    expect(headroom(pools, meters, ACCOUNT_MAIN, 'atlas-pro', NOW)).toEqual({
      ok: false,
      blockedBy: [M_ATLAS_WEEKLY, M_ATLAS_5H, M_SHARED],
      earliestRelief: NOW + 2 * HOUR,
    });
  });

  it('R-29: earliestRelief is omitted when no blocking meter carries a resetsAt', () => {
    const pools: readonly Pool[] = [poolOf({ id: POOL_ATLAS, appliesTo: [{ prefix: 'atlas-' }] })];
    const meters: readonly Meter[] = [meterOf({ id: M_ATLAS_WEEKLY, poolId: POOL_ATLAS, remaining: 0, limit: 100 })];
    const result = headroom(pools, meters, ACCOUNT_MAIN, 'atlas-pro', NOW);
    expect(result).toEqual({ ok: false, blockedBy: [M_ATLAS_WEEKLY] });
    expect(result).not.toHaveProperty('earliestRelief');
  });

  it('R-28: a pool with unknown applicability never blocks a run — its meters take no part', () => {
    const pools: readonly Pool[] = [
      poolOf({ id: POOL_SHARED }),
      poolOf({ id: POOL_ATLAS, appliesTo: 'unknown' }),
    ];
    const meters: readonly Meter[] = [
      meterOf({ id: M_SHARED, poolId: POOL_SHARED, remaining: 50, limit: 100 }),
      // exhausted with the reset still ahead, but which models draw from this pool is unknown:
      // the meter is information, never a block.
      meterOf({ id: M_ATLAS_WEEKLY, poolId: POOL_ATLAS, remaining: 0, limit: 100, resetsAt: NOW + HOUR }),
    ];
    expect(headroom(pools, meters, ACCOUNT_MAIN, 'atlas-pro', NOW)).toEqual({ ok: true, lowest: 0.5 });
  });

  it('R-28: an account whose every pool has unknown applicability answers no_data, not a block', () => {
    const pools: readonly Pool[] = [poolOf({ id: POOL_ATLAS, appliesTo: 'unknown' })];
    const meters: readonly Meter[] = [
      meterOf({ id: M_ATLAS_WEEKLY, poolId: POOL_ATLAS, remaining: 0, limit: 100, resetsAt: NOW + HOUR }),
    ];
    expect(headroom(pools, meters, ACCOUNT_MAIN, 'atlas-pro', NOW)).toEqual({ ok: 'unknown', reason: 'no_data' });
  });

  it('does not mutate its inputs', () => {
    const pools: readonly Pool[] = [
      poolOf({ id: POOL_ATLAS, appliesTo: [{ prefix: 'atlas-' }] }),
      poolOf({ id: POOL_TPUT, kind: 'throughput' }),
    ];
    const meters: readonly Meter[] = [
      meterOf({ id: M_ATLAS_WEEKLY, poolId: POOL_ATLAS, remaining: 0, limit: 100, resetsAt: NOW + HOUR, staleAfterMs: MINUTE }),
      meterOf({ id: M_TPUT, poolId: POOL_TPUT, remaining: 3, limit: 100 }),
    ];
    const poolsBefore = pools.map((pool) => ({ ...pool }));
    const metersBefore = meters.map((meter) => ({ ...meter }));

    headroom(pools, meters, ACCOUNT_MAIN, 'atlas-pro', NOW);

    expect(pools).toStrictEqual(poolsBefore);
    expect(meters).toStrictEqual(metersBefore);
  });
});
