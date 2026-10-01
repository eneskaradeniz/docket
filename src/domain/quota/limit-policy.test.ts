import { describe, expect, it } from 'vitest';
import { HOUR, MINUTE, type AccountId, type Billing, type EpochMs, type PoolId } from '../shared/index';
import { RESUME_JITTER_MS, decideOnLimit } from './limit-policy';
import type {
  FallbackCandidate,
  LimitContext,
  LimitDecision,
  LimitPolicy,
  PoolCandidate,
} from './limit-policy';
import type { AccountRoute, LimitClass, LimitHit } from './types';

const NOW: EpochMs = 1_750_000_000_000;

const ACCOUNT_MAIN = '01ARZ3NDEKTSV4RRFFQ69G5FAV' as AccountId;
const ACCOUNT_NEXT = '01ARZ3NDEKTSV4RRFFQ69G5FBV' as AccountId;
const ACCOUNT_THIRD = '01ARZ3NDEKTSV4RRFFQ69G5FCV' as AccountId;

const POOL_FIRST = '01ARZ3NDEKTSV4RRFFQ69G5FQA' as PoolId;
const POOL_SECOND = '01ARZ3NDEKTSV4RRFFQ69G5FQB' as PoolId;

const ROUTE_NEXT: AccountRoute = { accountId: ACCOUNT_NEXT };
const ROUTE_THIRD: AccountRoute = { accountId: ACCOUNT_THIRD, model: 'sonnet-large' };

const poolCandidate = (poolId: PoolId, billing: Billing = 'included', consented = false): PoolCandidate => ({
  poolId,
  billing,
  consented,
});

const fallbackCandidate = (
  route: AccountRoute,
  billing: Billing = 'included',
  consented = false,
): FallbackCandidate => ({ route, billing, consented });

const NOT_RESUMABLE_CLASSES = [
  'fair_use',
  'entitlement',
  'plan_expired',
  'balance_exhausted',
  'spend_cap',
] as const;

const RESUMABLE_CLASSES = ['window_exhausted', 'unknown'] as const;

interface HitInit {
  readonly class?: LimitClass;
  readonly resetsAt?: EpochMs;
  readonly retryAfterMs?: number;
}

const hitOf = (init: HitInit = {}): LimitHit => ({
  accountId: ACCOUNT_MAIN,
  class: init.class ?? 'window_exhausted',
  resetsAt: init.resetsAt,
  retryAfterMs: init.retryAfterMs,
  remedies: ['wait'],
  at: NOW,
});

interface CtxInit {
  readonly policy?: LimitPolicy;
  readonly autoResumesUsed?: number;
  readonly maxAutoResumes?: number;
  readonly alternativePools?: readonly PoolCandidate[];
  readonly fallbackAccounts?: readonly FallbackCandidate[];
  readonly now?: EpochMs;
}

const ctxOf = (init: CtxInit = {}): LimitContext => ({
  policy: init.policy ?? 'wait_resume',
  autoResumesUsed: init.autoResumesUsed ?? 0,
  maxAutoResumes: init.maxAutoResumes ?? 3,
  alternativePools: init.alternativePools ?? [],
  fallbackAccounts: init.fallbackAccounts ?? [],
  now: init.now ?? NOW,
});

describe('RESUME_JITTER_MS', () => {
  it('R-30: the resume jitter is one minute', () => {
    expect(RESUME_JITTER_MS).toBe(60_000);
    expect(RESUME_JITTER_MS).toBe(MINUTE);
  });
});

describe('decideOnLimit', () => {
  // Both directions must hold, so a union member can be neither added nor dropped silently.
  type UnionIsExactly<Actual, Expected> = [Actual] extends [Expected]
    ? [Expected] extends [Actual]
      ? true
      : never
    : never;

  it('R-30: a throughput hit schedules a resume at now + retryAfterMs', () => {
    const decision = decideOnLimit(hitOf({ class: 'throughput', retryAfterMs: 5 * MINUTE }), ctxOf());
    expect(decision).toEqual({ kind: 'schedule_resume', at: NOW + 5 * MINUTE, requeryFirst: true });
  });

  it('R-30: a throughput hit without retryAfterMs schedules a resume one minute out', () => {
    const decision = decideOnLimit(hitOf({ class: 'throughput' }), ctxOf());
    expect(decision).toEqual({ kind: 'schedule_resume', at: NOW + MINUTE, requeryFirst: true });
  });

  it('R-30: a throughput hit ignores resetsAt — only retryAfterMs or the minute default applies', () => {
    const decision = decideOnLimit(hitOf({ class: 'throughput', resetsAt: NOW + HOUR }), ctxOf());
    expect(decision).toEqual({ kind: 'schedule_resume', at: NOW + MINUTE, requeryFirst: true });
  });

  it('R-30: a throughput hit short-circuits every policy, even ask', () => {
    for (const policy of ['wait_resume', 'switch_pool', 'fallback_account', 'ask'] as const) {
      const decision = decideOnLimit(
        hitOf({ class: 'throughput', retryAfterMs: MINUTE }),
        ctxOf({
        policy,
        alternativePools: [poolCandidate(POOL_FIRST)],
        fallbackAccounts: [fallbackCandidate(ROUTE_NEXT)],
      }),
      );
      expect(decision).toEqual({ kind: 'schedule_resume', at: NOW + MINUTE, requeryFirst: true });
    }
  });

  it('R-30: a throughput hit never checks autoResumesUsed, so it consumes no auto-resume', () => {
    const decision = decideOnLimit(
      hitOf({ class: 'throughput' }),
      ctxOf({ autoResumesUsed: 5, maxAutoResumes: 3 }),
    );
    expect(decision).toEqual({ kind: 'schedule_resume', at: NOW + MINUTE, requeryFirst: true });
  });

  it('R-30: fair_use, entitlement, plan_expired, balance_exhausted and spend_cap ask with not_resumable', () => {
    // a reset time does not make these classes waitable
    for (const cls of NOT_RESUMABLE_CLASSES) {
      expect(decideOnLimit(hitOf({ class: cls, resetsAt: NOW + HOUR }), ctxOf())).toEqual({
        kind: 'ask',
        reason: 'not_resumable',
      });
    }
    // the class check precedes the policy check: even policy ask reports not_resumable
    expect(decideOnLimit(hitOf({ class: 'fair_use' }), ctxOf({ policy: 'ask' }))).toEqual({
      kind: 'ask',
      reason: 'not_resumable',
    });
  });

  it('R-30: a not-resumable class with policy fallback_account and a fallback routes to the first account', () => {
    const decision = decideOnLimit(
      hitOf({ class: 'balance_exhausted' }),
      ctxOf({
        policy: 'fallback_account',
        fallbackAccounts: [fallbackCandidate(ROUTE_NEXT), fallbackCandidate(ROUTE_THIRD)],
      }),
    );
    expect(decision).toEqual({ kind: 'fallback', route: ROUTE_NEXT });
  });

  it('R-30: a not-resumable class with policy fallback_account but no fallback asks with not_resumable', () => {
    const decision = decideOnLimit(
      hitOf({ class: 'plan_expired' }),
      ctxOf({ policy: 'fallback_account', fallbackAccounts: [] }),
    );
    expect(decision).toEqual({ kind: 'ask', reason: 'not_resumable' });
  });

  it('R-30: a not-resumable class ignores alternative pools under switch_pool policy', () => {
    const decision = decideOnLimit(
      hitOf({ class: 'spend_cap' }),
      ctxOf({ policy: 'switch_pool', alternativePools: [poolCandidate(POOL_FIRST)] }),
    );
    expect(decision).toEqual({ kind: 'ask', reason: 'not_resumable' });
  });

  it('R-30: the ask reasons are exactly the four contract members', () => {
    type ContractAskReasons = 'policy' | 'no_reset_time' | 'max_resumes' | 'not_resumable' | 'billing_boundary';
    type AskReason = Extract<LimitDecision, { kind: 'ask' }>['reason'];
    const exact: UnionIsExactly<AskReason, ContractAskReasons> = true;
    expect(exact).toBe(true);
  });

  it('R-30: policy ask asks with reason policy for resumable classes', () => {
    for (const cls of RESUMABLE_CLASSES) {
      expect(decideOnLimit(hitOf({ class: cls, resetsAt: NOW + HOUR }), ctxOf({ policy: 'ask' }))).toEqual({
        kind: 'ask',
        reason: 'policy',
      });
    }
  });

  it('R-30: policy switch_pool switches to the first alternative pool', () => {
    const decision = decideOnLimit(
      hitOf({ class: 'window_exhausted', resetsAt: NOW + HOUR }),
      ctxOf({
        policy: 'switch_pool',
        alternativePools: [poolCandidate(POOL_FIRST), poolCandidate(POOL_SECOND)],
      }),
    );
    expect(decision).toEqual({ kind: 'switch_pool', poolId: POOL_FIRST });
  });

  it('R-30: policy switch_pool with no alternative pool falls through to wait_resume', () => {
    const decision = decideOnLimit(
      hitOf({ class: 'window_exhausted', resetsAt: NOW + HOUR }),
      ctxOf({ policy: 'switch_pool', alternativePools: [] }),
    );
    expect(decision).toEqual({
      kind: 'schedule_resume',
      at: NOW + HOUR + RESUME_JITTER_MS,
      requeryFirst: true,
    });
  });

  it('R-30: policy fallback_account with a route falls back to the first account', () => {
    const decision = decideOnLimit(
      hitOf({ class: 'window_exhausted' }),
      ctxOf({
        policy: 'fallback_account',
        fallbackAccounts: [fallbackCandidate(ROUTE_NEXT), fallbackCandidate(ROUTE_THIRD)],
      }),
    );
    expect(decision).toEqual({ kind: 'fallback', route: ROUTE_NEXT });
  });

  it('R-30: policy fallback_account with no fallback falls through to wait_resume', () => {
    const decision = decideOnLimit(
      hitOf({ class: 'unknown', retryAfterMs: 2 * MINUTE }),
      ctxOf({ policy: 'fallback_account', fallbackAccounts: [] }),
    );
    expect(decision).toEqual({ kind: 'schedule_resume', at: NOW + 2 * MINUTE, requeryFirst: true });
  });

  it('R-30: wait_resume schedules a resume at resetsAt + RESUME_JITTER_MS', () => {
    const decision = decideOnLimit(hitOf({ class: 'window_exhausted', resetsAt: NOW + HOUR }), ctxOf());
    expect(decision).toEqual({ kind: 'schedule_resume', at: NOW + HOUR + RESUME_JITTER_MS, requeryFirst: true });
  });

  it('R-30: wait_resume prefers resetsAt over retryAfterMs when both are known', () => {
    const decision = decideOnLimit(
      hitOf({ class: 'window_exhausted', resetsAt: NOW + HOUR, retryAfterMs: MINUTE }),
      ctxOf(),
    );
    expect(decision).toEqual({ kind: 'schedule_resume', at: NOW + HOUR + RESUME_JITTER_MS, requeryFirst: true });
  });

  it('R-30: wait_resume without resetsAt schedules at now + retryAfterMs, with no jitter', () => {
    const decision = decideOnLimit(hitOf({ class: 'window_exhausted', retryAfterMs: 90_000 }), ctxOf());
    expect(decision).toEqual({ kind: 'schedule_resume', at: NOW + 90_000, requeryFirst: true });
  });

  it('R-30: wait_resume with neither resetsAt nor retryAfterMs asks with no_reset_time', () => {
    const decision = decideOnLimit(hitOf({ class: 'window_exhausted' }), ctxOf());
    expect(decision).toEqual({ kind: 'ask', reason: 'no_reset_time' });
  });

  it('R-30: wait_resume asks with max_resumes at the boundary autoResumesUsed === maxAutoResumes', () => {
    // a reset time is present: the cap is checked before any resume can be scheduled
    const hit = hitOf({ resetsAt: NOW + HOUR });
    expect(decideOnLimit(hit, ctxOf({ autoResumesUsed: 3, maxAutoResumes: 3 }))).toEqual({
      kind: 'ask',
      reason: 'max_resumes',
    });
    expect(decideOnLimit(hit, ctxOf({ autoResumesUsed: 4, maxAutoResumes: 3 }))).toEqual({
      kind: 'ask',
      reason: 'max_resumes',
    });
    // one below the cap still resumes
    expect(decideOnLimit(hit, ctxOf({ autoResumesUsed: 2, maxAutoResumes: 3 }))).toEqual({
      kind: 'schedule_resume',
      at: NOW + HOUR + RESUME_JITTER_MS,
      requeryFirst: true,
    });
  });

  it('does not mutate its inputs', () => {
    const hit = hitOf({ class: 'window_exhausted', resetsAt: NOW + HOUR, retryAfterMs: MINUTE });
    const ctx = ctxOf({
      policy: 'switch_pool',
      alternativePools: [poolCandidate(POOL_FIRST), poolCandidate(POOL_SECOND)],
      fallbackAccounts: [fallbackCandidate(ROUTE_NEXT), fallbackCandidate(ROUTE_THIRD)],
    });
    const hitBefore = { ...hit, remedies: [...hit.remedies] };
    const ctxBefore = {
      ...ctx,
      alternativePools: [...ctx.alternativePools],
      fallbackAccounts: [...ctx.fallbackAccounts],
    };

    decideOnLimit(hit, ctx);

    expect(hit).toStrictEqual(hitBefore);
    expect(ctx).toStrictEqual(ctxBefore);
  });
});

describe('decideOnLimit — billing boundary', () => {
  it('P-40: included → included still switches to the first alternative pool', () => {
    const decision = decideOnLimit(
      hitOf({ class: 'window_exhausted', resetsAt: NOW + HOUR }),
      ctxOf({ policy: 'switch_pool', alternativePools: [poolCandidate(POOL_FIRST), poolCandidate(POOL_SECOND)] }),
    );
    expect(decision).toEqual({ kind: 'switch_pool', poolId: POOL_FIRST });
  });

  it('P-40: included → metered without consent never switches; the run waits instead', () => {
    const decision = decideOnLimit(
      hitOf({ class: 'window_exhausted', resetsAt: NOW + HOUR }),
      ctxOf({ policy: 'switch_pool', alternativePools: [poolCandidate(POOL_FIRST, 'metered')] }),
    );
    expect(decision).toEqual({
      kind: 'schedule_resume',
      at: NOW + HOUR + RESUME_JITTER_MS,
      requeryFirst: true,
    });
  });

  it('P-40: included → metered with consent switches', () => {
    const decision = decideOnLimit(
      hitOf({ class: 'window_exhausted', resetsAt: NOW + HOUR }),
      ctxOf({ policy: 'switch_pool', alternativePools: [poolCandidate(POOL_FIRST, 'metered', true)] }),
    );
    expect(decision).toEqual({ kind: 'switch_pool', poolId: POOL_FIRST });
  });

  it('P-40: unknown billing behaves like metered — no switch without consent, switch with', () => {
    const hit = hitOf({ class: 'window_exhausted', resetsAt: NOW + HOUR });
    expect(
      decideOnLimit(hit, ctxOf({ policy: 'switch_pool', alternativePools: [poolCandidate(POOL_FIRST, 'unknown')] })),
    ).toEqual({ kind: 'schedule_resume', at: NOW + HOUR + RESUME_JITTER_MS, requeryFirst: true });
    expect(
      decideOnLimit(
        hit,
        ctxOf({ policy: 'switch_pool', alternativePools: [poolCandidate(POOL_FIRST, 'unknown', true)] }),
      ),
    ).toEqual({ kind: 'switch_pool', poolId: POOL_FIRST });
  });

  it('P-40: the first eligible candidate wins; ineligible ones are skipped, not fatal', () => {
    const decision = decideOnLimit(
      hitOf({ class: 'window_exhausted', resetsAt: NOW + HOUR }),
      ctxOf({
        policy: 'switch_pool',
        alternativePools: [poolCandidate(POOL_FIRST, 'metered'), poolCandidate(POOL_SECOND)],
      }),
    );
    expect(decision).toEqual({ kind: 'switch_pool', poolId: POOL_SECOND });
  });

  it('P-40: no eligible pool falls back to the existing wait behaviour', () => {
    const decision = decideOnLimit(
      hitOf({ class: 'window_exhausted', resetsAt: NOW + HOUR }),
      ctxOf({
        policy: 'switch_pool',
        alternativePools: [poolCandidate(POOL_FIRST, 'metered'), poolCandidate(POOL_SECOND, 'unknown')],
      }),
    );
    expect(decision).toEqual({
      kind: 'schedule_resume',
      at: NOW + HOUR + RESUME_JITTER_MS,
      requeryFirst: true,
    });
  });

  it('P-40: no eligible pool with no waitable time asks, naming the billing boundary', () => {
    const decision = decideOnLimit(
      hitOf({ class: 'window_exhausted' }),
      ctxOf({ policy: 'switch_pool', alternativePools: [poolCandidate(POOL_FIRST, 'metered')] }),
    );
    expect(decision).toEqual({ kind: 'ask', reason: 'billing_boundary' });
  });

  it('P-40: no eligible pool with resumes exhausted asks, naming the billing boundary', () => {
    const decision = decideOnLimit(
      hitOf({ class: 'window_exhausted', resetsAt: NOW + HOUR }),
      ctxOf({
        policy: 'switch_pool',
        alternativePools: [poolCandidate(POOL_FIRST, 'metered')],
        autoResumesUsed: 3,
        maxAutoResumes: 3,
      }),
    );
    expect(decision).toEqual({ kind: 'ask', reason: 'billing_boundary' });
  });

  it('P-40: a metered fallback route without consent waits instead of switching accounts', () => {
    const decision = decideOnLimit(
      hitOf({ class: 'window_exhausted', resetsAt: NOW + HOUR }),
      ctxOf({ policy: 'fallback_account', fallbackAccounts: [fallbackCandidate(ROUTE_NEXT, 'metered')] }),
    );
    expect(decision).toEqual({
      kind: 'schedule_resume',
      at: NOW + HOUR + RESUME_JITTER_MS,
      requeryFirst: true,
    });
  });

  it('P-40: a consented fallback route switches even when the run is resumable', () => {
    const decision = decideOnLimit(
      hitOf({ class: 'window_exhausted', resetsAt: NOW + HOUR }),
      ctxOf({ policy: 'fallback_account', fallbackAccounts: [fallbackCandidate(ROUTE_NEXT, 'metered', true)] }),
    );
    expect(decision).toEqual({ kind: 'fallback', route: ROUTE_NEXT });
  });

  it('P-40: no eligible fallback route falls back to the existing wait behaviour', () => {
    const decision = decideOnLimit(
      hitOf({ class: 'unknown', retryAfterMs: 2 * MINUTE }),
      ctxOf({ policy: 'fallback_account', fallbackAccounts: [fallbackCandidate(ROUTE_NEXT, 'metered')] }),
    );
    expect(decision).toEqual({ kind: 'schedule_resume', at: NOW + 2 * MINUTE, requeryFirst: true });
  });

  it('P-40: a not-resumable class with only ineligible fallbacks asks at the billing boundary, never switches', () => {
    const decision = decideOnLimit(
      hitOf({ class: 'balance_exhausted' }),
      ctxOf({
        policy: 'fallback_account',
        fallbackAccounts: [fallbackCandidate(ROUTE_NEXT, 'metered'), fallbackCandidate(ROUTE_THIRD, 'unknown')],
      }),
    );
    expect(decision).toEqual({ kind: 'ask', reason: 'billing_boundary' });
  });

  it('P-40: a not-resumable class with a consented fallback falls back', () => {
    const decision = decideOnLimit(
      hitOf({ class: 'balance_exhausted' }),
      ctxOf({ policy: 'fallback_account', fallbackAccounts: [fallbackCandidate(ROUTE_NEXT, 'metered', true)] }),
    );
    expect(decision).toEqual({ kind: 'fallback', route: ROUTE_NEXT });
  });

  it('P-40: a not-resumable class with no fallbacks at all still asks with not_resumable', () => {
    const decision = decideOnLimit(hitOf({ class: 'balance_exhausted' }), ctxOf({ policy: 'fallback_account' }));
    expect(decision).toEqual({ kind: 'ask', reason: 'not_resumable' });
  });
});
