// Billing evidence from the account's own usage report (P-40, docs/v2/provider-capabilities.md
// section 14). A model the catalog cannot place on a plan (plan-split billing) is `unknown`; the
// report settles it — a bucket scoped to that model by name exists only on plans that include it.
import type { Billing } from '../shared/index';
import { matchesModel } from './headroom';
import type { Pool } from './types';

/** Resolves a model's billing with the account's current pools: `unknown` becomes `included` when
 *  an `allowance` pool applies to the model through an explicit matcher list. `'metered'` and
 *  `'included'` are verified states and pass through unchanged; with no such pool the answer stays
 *  `unknown` — the absence of a bucket proves nothing, so this never produces `'metered'`. */
export function billingFromPools(billing: Billing, modelId: string, pools: readonly Pool[]): Billing {
  if (billing !== 'unknown') return billing;
  // 'all' and 'unknown' applicability name no model, so they are not evidence that this model
  // rides the plan; balance and spend-cap buckets are money, not plan coverage.
  const covered = pools.some(
    (pool) =>
      pool.kind === 'allowance' &&
      pool.appliesTo !== 'all' &&
      pool.appliesTo !== 'unknown' &&
      matchesModel(pool, modelId),
  );
  return covered ? 'included' : billing;
}
