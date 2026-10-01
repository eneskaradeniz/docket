// Quota domain data: accounts, pools, meters, limit hits. Contract: docs/v2/domain.md section 6.
import type { AccountId, EpochMs, MeterId, PoolId } from '../shared/index';

export type AuthMode = 'subscription' | 'api_key' | 'cloud' | 'byok';

/** Which account (and optionally which model) a run is routed to. */
export interface AccountRoute {
  readonly accountId: AccountId;
  readonly model?: string;
}

export interface QuotaSource {
  readonly accountId: AccountId;
  readonly provider: string; // provider def id, data only
  readonly authMode: AuthMode;
  readonly plan?: string; // verbatim from the provider
}

export type PoolKind = 'allowance' | 'balance' | 'spend_cap' | 'throughput';

export interface Pool {
  readonly id: PoolId;
  readonly accountId: AccountId;
  readonly label: string; // server-supplied, verbatim
  readonly kind: PoolKind;
  /** 'unknown': which models draw from this pool is not known — shown for information, never
   * matched (so it takes no part in headroom and never blocks a run). */
  readonly appliesTo: readonly ModelMatcher[] | 'all' | 'unknown';
}

export type ModelMatcher = { readonly exact: string } | { readonly prefix: string };

export type Cadence =
  | 'rolling_from_first_use'
  | 'rolling_continuous'
  | 'fixed'
  | 'calendar'
  | 'billing_cycle'
  | 'none';

export type MeterUnit =
  | 'percent'
  | 'fraction'
  | 'requests'
  | 'prompts'
  | 'tokens'
  | 'credits'
  | 'usd'
  | 'minutes';

export type ObservationSource =
  | 'pushed'
  | 'polled'
  | 'header'
  | 'captured_from_error'
  | 'estimated'
  | 'documented_rule'
  | 'unknown';

export type ResetPrecision = 'exact' | 'clock_only' | 'relative' | 'rule' | 'unknown';

export interface Meter {
  readonly id: MeterId;
  readonly poolId: PoolId;
  readonly label?: string;
  readonly cadence: Cadence;
  readonly durationMs?: number; // from the provider when given; never hard-coded
  readonly unit: MeterUnit;
  readonly used?: number;
  readonly limit?: number;
  readonly remaining?: number;
  readonly resetsAt?: EpochMs;
  readonly resetPrecision: ResetPrecision;
  readonly observedAt: EpochMs;
  readonly source: ObservationSource;
  readonly staleAfterMs?: number;
}

export type LimitClass =
  | 'window_exhausted'
  | 'balance_exhausted'
  | 'spend_cap'
  | 'throughput'
  | 'fair_use'
  | 'entitlement'
  | 'plan_expired'
  | 'unknown';

export type Remedy = 'wait' | 'switch_model' | 'enable_overage' | 'top_up' | 'admin';

export interface LimitHit {
  readonly accountId: AccountId;
  readonly poolId?: PoolId;
  readonly meterId?: MeterId;
  readonly class: LimitClass;
  readonly resetsAt?: EpochMs;
  readonly retryAfterMs?: number;
  readonly remedies: readonly Remedy[];
  readonly at: EpochMs;
}
