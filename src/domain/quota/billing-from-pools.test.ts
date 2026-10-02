// billingFromPools: the account's own usage report as billing evidence (P-40,
// docs/v2/provider-capabilities.md section 14 — a model-scoped allowance bucket on the account
// proves the plan covers the model).
import { describe, expect, it } from 'vitest';
import type { AccountId, PoolId } from '../shared/index';
import { billingFromPools } from './billing-from-pools';
import type { ModelMatcher, Pool, PoolKind } from './types';

const ACCOUNT: AccountId = '01ARZ3NDEKTSV4RRFFQ69G5FAV' as AccountId;
const POOL_MODEL: PoolId = '01ARZ3NDEKTSV4RRFFQ69G5FP1' as PoolId;
const POOL_CREDITS: PoolId = '01ARZ3NDEKTSV4RRFFQ69G5FP2' as PoolId;
const POOL_EVERYTHING: PoolId = '01ARZ3NDEKTSV4RRFFQ69G5FP3' as PoolId;
const POOL_UNSORTED: PoolId = '01ARZ3NDEKTSV4RRFFQ69G5FP4' as PoolId;
const POOL_SPEND: PoolId = '01ARZ3NDEKTSV4RRFFQ69G5FP5' as PoolId;
const POOL_PREFIX: PoolId = '01ARZ3NDEKTSV4RRFFQ69G5FP6' as PoolId;

const MODEL = 'atlas-pro';

interface PoolInit {
  readonly id: PoolId;
  readonly kind?: PoolKind;
  readonly appliesTo?: readonly ModelMatcher[] | 'all' | 'unknown';
}

const poolOf = (init: PoolInit): Pool => ({
  id: init.id,
  accountId: ACCOUNT,
  label: 'pool',
  kind: init.kind ?? 'allowance',
  appliesTo: init.appliesTo ?? 'all',
});

/** The bucket the top plans report for the model family: an allowance scoped to it by name. */
const modelBucket = (): Pool => poolOf({ id: POOL_MODEL, appliesTo: [{ exact: MODEL }] });

describe('billingFromPools', () => {
  it('P-40: unknown becomes included when an allowance pool matches the model exactly', () => {
    expect(billingFromPools('unknown', MODEL, [modelBucket()])).toBe('included');
  });

  it('P-40: a prefix matcher counts too, case-insensitively as everywhere', () => {
    const family = poolOf({ id: POOL_PREFIX, appliesTo: [{ prefix: 'atlas-' }] });
    expect(billingFromPools('unknown', 'Atlas-Pro', [family])).toBe('included');
  });

  it('P-40: a balance pool alone proves nothing — the model stays unknown', () => {
    const credits = poolOf({ id: POOL_CREDITS, kind: 'balance', appliesTo: [{ exact: MODEL }] });
    expect(billingFromPools('unknown', MODEL, [credits])).toBe('unknown');
  });

  it('P-40: a spend cap pool that names the model stays unknown as well', () => {
    const cap = poolOf({ id: POOL_SPEND, kind: 'spend_cap', appliesTo: [{ exact: MODEL }] });
    expect(billingFromPools('unknown', MODEL, [cap])).toBe('unknown');
  });

  it("P-40: an 'all' pool never counts — it says nothing about this model", () => {
    const everything = poolOf({ id: POOL_EVERYTHING, appliesTo: 'all' });
    expect(billingFromPools('unknown', MODEL, [everything])).toBe('unknown');
  });

  it("P-40: an 'unknown' pool never counts — information, not coverage", () => {
    const unsorted = poolOf({ id: POOL_UNSORTED, appliesTo: 'unknown' });
    expect(billingFromPools('unknown', MODEL, [unsorted])).toBe('unknown');
  });

  it('P-40: an allowance pool whose matchers name other models does not apply', () => {
    const otherModel = poolOf({ id: POOL_MODEL, appliesTo: [{ exact: 'other-model' }] });
    const otherFamily = poolOf({ id: POOL_PREFIX, appliesTo: [{ prefix: 'other-' }] });
    expect(billingFromPools('unknown', MODEL, [otherModel, otherFamily])).toBe('unknown');
  });

  it('P-40: with no pools at all — no reading yet — the billing stays as the catalog said', () => {
    expect(billingFromPools('unknown', MODEL, [])).toBe('unknown');
  });

  it('P-40: metered stays metered even when a matching allowance pool exists', () => {
    expect(billingFromPools('metered', MODEL, [modelBucket()])).toBe('metered');
  });

  it('P-40: included stays included — a pool reading never demotes a verified state', () => {
    expect(billingFromPools('included', MODEL, [modelBucket()])).toBe('included');
    expect(billingFromPools('included', MODEL, [])).toBe('included');
  });

  it('P-40: one matching allowance among several non-matching pools is enough', () => {
    const credits = poolOf({ id: POOL_CREDITS, kind: 'balance', appliesTo: 'all' });
    const otherModel = poolOf({ id: POOL_SPEND, kind: 'allowance', appliesTo: [{ exact: 'other-model' }] });
    expect(billingFromPools('unknown', MODEL, [credits, otherModel, modelBucket()])).toBe('included');
  });
});
