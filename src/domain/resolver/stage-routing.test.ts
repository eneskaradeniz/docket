// resolver/stage-routing.test.ts — R-52: stage overrides and review ordering.
import { describe, expect, it } from 'vitest';
import type { StageDef } from '../definitions/index';
import type { AccountId, RoleSlug, StageSlug } from '../shared/index';
import { orderForReview, stageRouting, type ChainEntry, type RoleBinding } from './index';

const stage = (over: Partial<StageDef> = {}): StageDef => ({
  id: 'review' as StageSlug,
  name: 'Review',
  role: 'reviewer' as RoleSlug,
  exit: [],
  ...over,
});

const binding = (over: Partial<RoleBinding> = {}): RoleBinding => ({
  role: 'reviewer' as RoleSlug,
  accounts: [],
  ...over,
});

const entry = (account: string, provider: string): ChainEntry => ({
  route: { accountId: account as AccountId },
  provider,
});

describe('stageRouting', () => {
  it('R-52: the stage tier and thinking win over the binding', () => {
    const result = stageRouting(
      stage({ tier: 'strong', thinking: { level: 'deep' } }),
      binding({ tier: 'fast', thinking: { level: 'fast' } }),
    );
    expect(result).toEqual({ tier: 'strong', thinking: { level: 'deep' } });
  });

  it('R-52: each field falls back to the binding independently', () => {
    const result = stageRouting(stage({ tier: 'balanced' }), binding({ tier: 'fast', thinking: { effort: 'high' } }));
    expect(result).toEqual({ tier: 'balanced', thinking: { effort: 'high' } });
  });

  it('R-52: fields set nowhere are absent, not undefined-valued', () => {
    const result = stageRouting(stage(), binding());
    expect(result).toEqual({});
    expect(Object.keys(result)).toEqual([]);
    expect(stageRouting(stage(), binding({ tier: 'fast' }))).toEqual({ tier: 'fast' });
  });
});

describe('orderForReview', () => {
  const chain = [entry('a1', 'p1'), entry('a2', 'p2'), entry('a3', 'p1'), entry('a4', 'p3')];

  it('R-52: an undefined reviewed provider leaves the chain unchanged', () => {
    const result = orderForReview(chain, undefined);
    expect(result.chain).toEqual(chain);
    expect(result.sameProvider).toBe(false);
  });

  it('R-52: other-provider accounts come first in their relative order, then the same provider', () => {
    const result = orderForReview(chain, 'p1');
    expect(result.chain.map((e) => e.route.accountId)).toEqual(['a2', 'a4', 'a1', 'a3']);
    expect(result.sameProvider).toBe(false);
  });

  it('R-52: only the reviewed provider available sets sameProvider and keeps the order', () => {
    const only = [entry('a1', 'p1'), entry('a3', 'p1')];
    const result = orderForReview(only, 'p1');
    expect(result.chain).toEqual(only);
    expect(result.sameProvider).toBe(true);
  });

  it('R-52: a chain already led by another provider is unchanged and not same-provider', () => {
    const led = [entry('a2', 'p2'), entry('a1', 'p1')];
    const result = orderForReview(led, 'p1');
    expect(result.chain).toEqual(led);
    expect(result.sameProvider).toBe(false);
  });

  it('R-52: an empty chain is empty and not same-provider', () => {
    expect(orderForReview([], 'p1')).toEqual({ chain: [], sameProvider: false });
  });

  it('R-52: inputs are never mutated and the result is a new array', () => {
    const input = Object.freeze([...chain]);
    const result = orderForReview(input, 'p1');
    expect(input.map((e) => e.route.accountId)).toEqual(['a1', 'a2', 'a3', 'a4']);
    expect(result.chain).not.toBe(input);
    const frozenStage = Object.freeze(stage({ tier: 'strong' }));
    const frozenBinding = Object.freeze(binding({ tier: 'fast' }));
    expect(stageRouting(frozenStage, frozenBinding)).toEqual({ tier: 'strong' });
  });
});
