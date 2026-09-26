import { describe, expectTypeOf, it } from 'vitest';
import type { AccountId, EpochMs, MeterId, PoolId } from '../shared/index';
import type { AccountRoute, Meter, ModelMatcher, Pool } from './types';

describe('quota types', () => {
  it('AccountRoute targets an account and optionally a model', () => {
    expectTypeOf<AccountRoute>().toEqualTypeOf<{ readonly accountId: AccountId; readonly model?: string }>();
    const route: AccountRoute = { accountId: '01ARZ3NDEKTSV4RRFFQ69G5FAV' as AccountId };
    expectTypeOf(route.model).toEqualTypeOf<string | undefined>();
  });

  it('Pool scopes models with a matcher list or "all"', () => {
    expectTypeOf<Pool['appliesTo']>().toEqualTypeOf<readonly ModelMatcher[] | 'all'>();
    expectTypeOf<ModelMatcher>().toEqualTypeOf<{ readonly exact: string } | { readonly prefix: string }>();
    expectTypeOf<Pool['id']>().toEqualTypeOf<PoolId>();
    expectTypeOf<Pool['accountId']>().toEqualTypeOf<AccountId>();
  });

  it('Meter treats observations as optional and provenance as required', () => {
    expectTypeOf<Meter['id']>().toEqualTypeOf<MeterId>();
    expectTypeOf<Meter['poolId']>().toEqualTypeOf<PoolId>();
    expectTypeOf<Meter['used']>().toEqualTypeOf<number | undefined>();
    expectTypeOf<Meter['limit']>().toEqualTypeOf<number | undefined>();
    expectTypeOf<Meter['remaining']>().toEqualTypeOf<number | undefined>();
    expectTypeOf<Meter['resetsAt']>().toEqualTypeOf<EpochMs | undefined>();
    expectTypeOf<Meter['staleAfterMs']>().toEqualTypeOf<number | undefined>();
    expectTypeOf<Meter['observedAt']>().toEqualTypeOf<EpochMs>();
    expectTypeOf<Meter['resetPrecision']>().toEqualTypeOf<'exact' | 'clock_only' | 'relative' | 'rule' | 'unknown'>();
  });

  it('Meter units and observation sources are closed unions', () => {
    expectTypeOf<Meter['unit']>().toEqualTypeOf<
      'percent' | 'fraction' | 'requests' | 'prompts' | 'tokens' | 'credits' | 'usd' | 'minutes'
    >();
    expectTypeOf<Meter['source']>().toEqualTypeOf<
      'pushed' | 'polled' | 'header' | 'captured_from_error' | 'estimated' | 'documented_rule' | 'unknown'
    >();
    expectTypeOf<Meter['cadence']>().toEqualTypeOf<
      'rolling_from_first_use' | 'rolling_continuous' | 'fixed' | 'calendar' | 'billing_cycle' | 'none'
    >();
  });
});
