// Limit policy: what to do when a run hits a limit. Contract: docs/v2/domain.md section 6.
import { MINUTE, type EpochMs, type PoolId } from '../shared/index';
import type { AccountRoute, LimitClass, LimitHit } from './types';

export type LimitPolicy = 'wait_resume' | 'switch_pool' | 'fallback_account' | 'ask';

export interface LimitContext {
  readonly policy: LimitPolicy;
  readonly autoResumesUsed: number;
  readonly maxAutoResumes: number; // default 3
  readonly alternativePools: readonly PoolId[]; // same account, pools with headroom for another model
  readonly fallbackAccounts: readonly AccountRoute[]; // next in the role's chain, with headroom
  readonly now: EpochMs;
}

export type LimitDecision =
  | { readonly kind: 'schedule_resume'; readonly at: EpochMs; readonly requeryFirst: true }
  | { readonly kind: 'switch_pool'; readonly poolId: PoolId }
  | { readonly kind: 'fallback'; readonly route: AccountRoute }
  | {
      readonly kind: 'ask';
      readonly reason: 'policy' | 'no_reset_time' | 'max_resumes' | 'not_resumable' | 'no_alternative';
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

export function decideOnLimit(hit: LimitHit, ctx: LimitContext): LimitDecision {
  // A throughput limit is a transient throttle: waiting always clears it, so it short-circuits
  // every policy and never spends one of the auto-resumes.
  if (hit.class === 'throughput') {
    return { kind: 'schedule_resume', at: ctx.now + (hit.retryAfterMs ?? MINUTE), requeryFirst: true };
  }

  if (NOT_RESUMABLE_CLASSES.includes(hit.class)) {
    return ctx.policy === 'fallback_account' && ctx.fallbackAccounts.length > 0
      ? { kind: 'fallback', route: ctx.fallbackAccounts[0] }
      : { kind: 'ask', reason: 'not_resumable' };
  }

  if (ctx.policy === 'ask') return { kind: 'ask', reason: 'policy' };

  // Without an alternative both policies behave exactly like wait_resume.
  if (ctx.policy === 'switch_pool' && ctx.alternativePools.length > 0) {
    return { kind: 'switch_pool', poolId: ctx.alternativePools[0] };
  }

  if (ctx.policy === 'fallback_account' && ctx.fallbackAccounts.length > 0) {
    return { kind: 'fallback', route: ctx.fallbackAccounts[0] };
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
