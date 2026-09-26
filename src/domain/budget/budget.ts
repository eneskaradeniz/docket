export interface SpendCap {
  readonly amountUsd: number;
  readonly warnPercent: number; // 1..100, default 80
}

export type SpendStatus = 'ok' | 'warn' | 'hard_stop';

export type CapScope = 'account_day' | 'account_month' | 'workspace_month' | 'work_order';

export interface ScopedSpend {
  readonly scope: CapScope;
  readonly observedUsd: number;
  readonly cap?: SpendCap;
}

export function spendStatus(observedUsd: number, cap: SpendCap | undefined): SpendStatus {
  if (cap === undefined || cap.amountUsd <= 0) return 'ok';
  if (observedUsd >= cap.amountUsd) return 'hard_stop';
  // The threshold is expressed in cents first so float error cannot move it off
  // the cent boundary: 4.35 at 80% warns at exactly 3.48, never a hair above.
  const warnThresholdUsd = Math.ceil(cap.amountUsd * cap.warnPercent) / 100;
  if (observedUsd >= warnThresholdUsd) return 'warn';
  return 'ok';
}

/** The most restrictive status across all scopes, with the scope that caused it. */
export function combinedSpendStatus(spends: readonly ScopedSpend[]): {
  readonly status: SpendStatus;
  readonly scope?: CapScope;
} {
  const RANK: Readonly<Record<SpendStatus, number>> = { ok: 0, warn: 1, hard_stop: 2 };
  let bestStatus: SpendStatus = 'ok';
  let bestScope: CapScope | undefined;
  for (const spend of spends) {
    const status = spendStatus(spend.observedUsd, spend.cap);
    if (RANK[status] > RANK[bestStatus]) {
      bestStatus = status;
      bestScope = spend.scope;
    }
  }
  if (bestStatus === 'ok') return { status: 'ok' };
  return { status: bestStatus, scope: bestScope };
}
