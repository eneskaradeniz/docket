// recommended.test.ts — U-29: the recommendation table is one constant and `settingDiffs` is the
// pure comparison of an account against it. Node environment, no DOM.
import { describe, expect, it } from 'vitest';

import type { SettingsAccountView } from '../../api/queries';

import { RECOMMENDED, isPayPerUse, mayHaveCap, recommendedReserve, recommendedWorkStyle, settingDiffs } from './recommended';

const ACCOUNT: SettingsAccountView = {
  id: 'a-1',
  provider: 'claude',
  label: 'Work',
  authMode: 'subscription',
  billing: 'included',
  plan: 'pro',
  limitPolicy: 'wait_resume',
  reserve: { short: null, long: null },
  hasWeeklyPool: false,
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
    expect(recommendedWorkStyle('planner')).toBe('balanced');
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

  it('A-83: pay-per-use follows the billing view, not the connection kind', () => {
    expect(isPayPerUse({ ...ACCOUNT, authMode: 'api_key', billing: 'included' })).toBe(false);
    expect(isPayPerUse({ ...ACCOUNT, authMode: 'api_key', billing: 'unknown' })).toBe(true);
    expect(isPayPerUse({ ...ACCOUNT, authMode: 'api_key', billing: 'metered' })).toBe(true);
    expect(isPayPerUse({ ...ACCOUNT, authMode: 'subscription', billing: 'included' })).toBe(false);
    expect(mayHaveCap({ ...ACCOUNT, authMode: 'api_key', billing: 'included' })).toBe(false);
    expect(mayHaveCap({ ...ACCOUNT, authMode: 'api_key', billing: 'metered' })).toBe(true);
  });

  it('U-29: a cap that was never set is not a difference, for a subscription or a pay-per-use account', () => {
    const paid = { ...ACCOUNT, authMode: 'api_key', billing: 'unknown' as const };
    expect(settingDiffs(paid)).toEqual([]);
    expect(settingDiffs({ ...ACCOUNT, consentedModels: ['*'] })).toEqual([]);
    expect(settingDiffs({ ...paid, caps: [{ scope: 'account_week', amountUsd: 50, warnPercent: 80 }] }).map((diff) => diff.key)).toEqual(['cap']);
  });

  it('U-29: a zero reserve is no reserve and an absent cap is no diff', () => {
    expect(settingDiffs({ ...ACCOUNT, reserve: { short: 0, long: null } })).toEqual([]);
    expect(settingDiffs({ ...ACCOUNT, reserve: { short: null, long: 0.1 } }).map((diff) => diff.key)).toEqual(['reserve']);
  });

  it('U-29: recommendedReserve is 0/0, and 0/0.1 on a weekly-pooled account', () => {
    expect(recommendedReserve(false)).toEqual({ short: 0, long: 0 });
    expect(recommendedReserve(true)).toEqual({ short: 0, long: 0.1 });
  });

  it('R-198: settingDiffs flags a weekly account whose long reserve differs from 0.1', () => {
    const weekly = { ...ACCOUNT, hasWeeklyPool: true };
    // Unset: the account runs with the default, which is the recommendation.
    expect(settingDiffs(weekly)).toEqual([]);
    expect(settingDiffs({ ...weekly, reserve: { short: 0, long: 0.1 } })).toEqual([]);
    expect(settingDiffs({ ...weekly, reserve: { short: 0, long: 0 } })).toEqual([
      { key: 'reserve', current: '0/0', recommended: '0/0.1' },
    ]);
    expect(settingDiffs({ ...weekly, reserve: { short: null, long: 0.3 } }).map((diff) => diff.key)).toEqual(['reserve']);
    expect(settingDiffs({ ...weekly, reserve: { short: 0.2, long: 0.1 } }).map((diff) => diff.key)).toEqual(['reserve']);
  });

  it('U-42: Sistem is the recommended theme', () => {
    expect(RECOMMENDED.theme).toBe('system');
  });
});
