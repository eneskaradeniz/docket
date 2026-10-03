// recommended.test.ts — U-29: the recommendation table is one constant and `settingDiffs` is the
// pure comparison of an account against it. Node environment, no DOM.
import { describe, expect, it } from 'vitest';

import type { SettingsAccountView } from '../../api/queries';

import { RECOMMENDED, recommendedWorkStyle, settingDiffs } from './recommended';

const ACCOUNT: SettingsAccountView = {
  id: 'a-1',
  provider: 'claude',
  label: 'Work',
  authMode: 'subscription',
  plan: 'pro',
  limitPolicy: 'wait_resume',
  reserve: { short: null, long: null },
  caps: [],
  consentedModels: [],
  routeKind: null,
  identityDir: null,
  endpointHost: null,
  hasSecret: false,
  test: null,
  pools: [],
  meters: [],
};

describe('recommended', () => {
  it('U-29: the table holds wait_resume, no reserve, warn 80, $50 per month', () => {
    expect(RECOMMENDED.limitPolicy).toBe('wait_resume');
    expect(RECOMMENDED.reserve).toEqual({ short: 0, long: 0 });
    expect(RECOMMENDED.warnPercent).toBe(80);
    expect(RECOMMENDED.cap).toEqual({ scope: 'account_month', amountUsd: 50 });
  });

  it('U-29: a role work style follows the role, and an unlisted role is balanced', () => {
    expect(recommendedWorkStyle('planner')).toBe('careful');
    expect(recommendedWorkStyle('reviewer')).toBe('careful');
    expect(recommendedWorkStyle('security-auditor')).toBe('careful');
    expect(recommendedWorkStyle('developer')).toBe('balanced');
    expect(recommendedWorkStyle('test-writer')).toBe('balanced');
    expect(recommendedWorkStyle('analyst')).toBe('fast');
    expect(recommendedWorkStyle('documenter')).toBe('fast');
    expect(recommendedWorkStyle('something-else')).toBe('balanced');
  });

  it('U-29: an account on the recommendation has no diffs', () => {
    expect(settingDiffs(ACCOUNT)).toEqual([]);
    const capped = { ...ACCOUNT, caps: [{ scope: 'account_month' as const, amountUsd: 50, warnPercent: 80 }] };
    expect(settingDiffs(capped)).toEqual([]);
  });

  it('U-29: settingDiffs lists each differing setting with current and recommended', () => {
    const diffs = settingDiffs({
      ...ACCOUNT,
      limitPolicy: 'ask',
      reserve: { short: 0.1, long: 0.2 },
      caps: [{ scope: 'account_day', amountUsd: 20, warnPercent: 90 }],
    });
    expect(diffs).toEqual([
      { key: 'limitPolicy', current: 'ask', recommended: 'wait_resume' },
      { key: 'reserve', current: '0.1/0.2', recommended: '0/0' },
      { key: 'cap', current: 'account_day:20', recommended: 'account_month:50' },
      { key: 'warnPercent', current: 90, recommended: 80 },
    ]);
  });

  it('U-29: a cap that was never set is not a difference, for a subscription or a pay-per-use account', () => {
    const paid = { ...ACCOUNT, authMode: 'api_key' };
    expect(settingDiffs(paid)).toEqual([]);
    expect(settingDiffs({ ...ACCOUNT, consentedModels: ['*'] })).toEqual([]);
    expect(settingDiffs({ ...paid, caps: [{ scope: 'account_week', amountUsd: 50, warnPercent: 80 }] }).map((diff) => diff.key)).toEqual(['cap']);
  });

  it('U-29: a zero reserve is no reserve and an absent cap is no diff', () => {
    expect(settingDiffs({ ...ACCOUNT, reserve: { short: 0, long: null } })).toEqual([]);
    expect(settingDiffs({ ...ACCOUNT, reserve: { short: null, long: 0.1 } }).map((diff) => diff.key)).toEqual(['reserve']);
  });
});
