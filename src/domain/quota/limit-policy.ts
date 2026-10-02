// Limit policy: what to do when a run hits a limit. Contract: docs/v2/domain.md section 6.
import { MINUTE, type Billing, type EpochMs, type PoolId } from '../shared/index';
import type { AccountRoute, LimitClass, LimitHit } from './types';

export type LimitPolicy = 'wait_resume' | 'switch_pool' | 'fallback_account' | 'ask';

/** A pool the switch_pool policy may move to, carrying the target's billing and consent state. */
export interface PoolCandidate {
  readonly poolId: PoolId;
  readonly billing: Billing;
  readonly consented: boolean;
}

/** An account the fallback_account policy may move to, carrying the target's billing and consent state. */
export interface FallbackCandidate {
  readonly route: AccountRoute;
  readonly billing: Billing;
  readonly consented: boolean;
}

export interface LimitContext {
  readonly policy: LimitPolicy;
  readonly autoResumesUsed: number;
  readonly maxAutoResumes: number; // default 3
  readonly alternativePools: readonly PoolCandidate[]; // same account, pools with headroom for another model
  readonly fallbackAccounts: readonly FallbackCandidate[]; // next in the role's chain, with headroom
  readonly now: EpochMs;
}

export type LimitDecision =
  | { readonly kind: 'schedule_resume'; readonly at: EpochMs; readonly requeryFirst: true }
  | { readonly kind: 'switch_pool'; readonly poolId: PoolId }
  | { readonly kind: 'fallback'; readonly route: AccountRoute }
  | {
      readonly kind: 'ask';
      readonly reason: 'policy' | 'no_reset_time' | 'max_resumes' | 'not_resumable' | 'billing_boundary';
    };

/** Resumes are padded so a reset that lands slightly late does not cause an immediate re-hit. */
export const RESUME_JITTER_MS: number = MINUTE;

// These classes do not clear on a timer: waiting cannot rescue them, only another account can.
const NOT_RESUMABLE_CLASSES: readonly LimitClass[] = [
  'fair_use',
  'entitlement',
  'plan_expired',
  'balance_exhausted',
  'spend_cap',
];

// An automatic switch must never cross from an included route to one that may be billed; a metered
// or unknown candidate is usable only when the user's consent is already recorded in the context.
const firstEligible = <C extends { readonly billing: Billing; readonly consented: boolean }>(
  candidates: readonly C[],
): C | undefined => candidates.find((candidate) => candidate.billing === 'included' || candidate.consented);

// Every candidate sits on the far side of the billing boundary: wait when waiting works, and ask
// naming that boundary otherwise — the ask is what offers the user the consent that would unblock
// a switch. Waiting cannot rescue the not-resumable classes, so there the ask is unconditional.
function waitAtBillingBoundary(hit: LimitHit, ctx: LimitContext): LimitDecision {
  if (ctx.autoResumesUsed < ctx.maxAutoResumes) {
    if (hit.resetsAt !== undefined) {
      return { kind: 'schedule_resume', at: hit.resetsAt + RESUME_JITTER_MS, requeryFirst: true };
    }
    if (hit.retryAfterMs !== undefined) {
      return { kind: 'schedule_resume', at: ctx.now + hit.retryAfterMs, requeryFirst: true };
    }
  }
  return { kind: 'ask', reason: 'billing_boundary' };
}

export function decideOnLimit(hit: LimitHit, ctx: LimitContext): LimitDecision {
  // A throughput limit is a transient throttle: waiting always clears it, so it short-circuits
  // every policy and never spends one of the auto-resumes.
  if (hit.class === 'throughput') {
    return { kind: 'schedule_resume', at: ctx.now + (hit.retryAfterMs ?? MINUTE), requeryFirst: true };
  }

  if (NOT_RESUMABLE_CLASSES.includes(hit.class)) {
    if (ctx.policy === 'fallback_account') {
      const fallback = firstEligible(ctx.fallbackAccounts);
      if (fallback !== undefined) return { kind: 'fallback', route: fallback.route };
      if (ctx.fallbackAccounts.length > 0) return { kind: 'ask', reason: 'billing_boundary' };
    }
    return { kind: 'ask', reason: 'not_resumable' };
  }

  if (ctx.policy === 'ask') return { kind: 'ask', reason: 'policy' };

  // Without an alternative both policies behave exactly like wait_resume.
  if (ctx.policy === 'switch_pool' && ctx.alternativePools.length > 0) {
    const pool = firstEligible(ctx.alternativePools);
    if (pool !== undefined) return { kind: 'switch_pool', poolId: pool.poolId };
    return waitAtBillingBoundary(hit, ctx);
  }

  if (ctx.policy === 'fallback_account' && ctx.fallbackAccounts.length > 0) {
    const fallback = firstEligible(ctx.fallbackAccounts);
    if (fallback !== undefined) return { kind: 'fallback', route: fallback.route };
    return waitAtBillingBoundary(hit, ctx);
  }

  if (ctx.autoResumesUsed >= ctx.maxAutoResumes) return { kind: 'ask', reason: 'max_resumes' };
  if (hit.resetsAt !== undefined) {
    return { kind: 'schedule_resume', at: hit.resetsAt + RESUME_JITTER_MS, requeryFirst: true };
  }
  if (hit.retryAfterMs !== undefined) {
    return { kind: 'schedule_resume', at: ctx.now + hit.retryAfterMs, requeryFirst: true };
  }
  return { kind: 'ask', reason: 'no_reset_time' };
}
