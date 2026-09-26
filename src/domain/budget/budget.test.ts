import { describe, expect, it } from 'vitest';
import { combinedSpendStatus, spendStatus, type ScopedSpend, type SpendCap } from './budget';

const cap = (amountUsd: number, warnPercent = 80): SpendCap => ({ amountUsd, warnPercent });
const spend = (scope: ScopedSpend['scope'], observedUsd: number, c?: SpendCap): ScopedSpend => ({
  scope,
  observedUsd,
  cap: c,
});

describe('spendStatus', () => {
  it('R-31: no cap is ok', () => {
    expect(spendStatus(100, undefined)).toBe('ok');
    expect(spendStatus(Number.MAX_SAFE_INTEGER, undefined)).toBe('ok');
  });

  it('R-31: a zero-amount cap is ok', () => {
    expect(spendStatus(0.01, cap(0))).toBe('ok');
  });

  it('R-31: a negative-amount cap is ok', () => {
    expect(spendStatus(10, cap(-5))).toBe('ok');
  });

  it('R-31: observed at the amount is hard_stop', () => {
    expect(spendStatus(10, cap(10))).toBe('hard_stop');
  });

  it('R-31: observed above the amount is hard_stop', () => {
    expect(spendStatus(10.01, cap(10))).toBe('hard_stop');
  });

  it('R-31: observed below the warn threshold is ok', () => {
    expect(spendStatus(7.99, cap(10, 80))).toBe('ok');
  });

  it('R-31: observed at the warn threshold is warn', () => {
    expect(spendStatus(8, cap(10, 80))).toBe('warn');
  });

  it('R-31: observed above the warn threshold but below the amount is warn', () => {
    expect(spendStatus(9.99, cap(10, 80))).toBe('warn');
  });

  it('R-31: hard_stop wins over warn at the same observed value', () => {
    expect(spendStatus(10, cap(10, 100))).toBe('hard_stop');
  });

  it('R-31: warn threshold is cent-exact and float-safe — cap 4.35 at 80% warns at exactly 3.48, not at 3.4800000001', () => {
    expect(spendStatus(3.48, cap(4.35, 80))).toBe('warn');
    expect(spendStatus(3.4800000001, cap(4.35, 80))).toBe('warn');
    expect(spendStatus(3.4799999999, cap(4.35, 80))).toBe('ok');
  });

  it('R-31: the warn threshold rounds up to the next cent', () => {
    // 1.25 * 50 = 62.5 cents -> threshold 63 cents
    expect(spendStatus(0.62, cap(1.25, 50))).toBe('ok');
    expect(spendStatus(0.63, cap(1.25, 50))).toBe('warn');
  });

  it('R-31: warnPercent 1 warns only at the full amount boundary and above', () => {
    // 10 * 1 = 10 cents -> threshold 0.10
    expect(spendStatus(0.09, cap(10, 1))).toBe('ok');
    expect(spendStatus(0.1, cap(10, 1))).toBe('warn');
  });

  it('R-31: warnPercent 100 puts the warn threshold at the amount, so hard_stop shadows warn', () => {
    expect(spendStatus(9.99, cap(10, 100))).toBe('ok');
    expect(spendStatus(10, cap(10, 100))).toBe('hard_stop');
  });

  it('R-31: a negative observed spend is ok', () => {
    expect(spendStatus(-1, cap(10, 80))).toBe('ok');
  });
});

describe('combinedSpendStatus', () => {
  it('R-32: an empty list is ok with no scope', () => {
    expect(combinedSpendStatus([])).toEqual({ status: 'ok' });
    expect(combinedSpendStatus([]).scope).toBeUndefined();
  });

  it('R-32: ok ranks below warn', () => {
    const spends = [spend('account_day', 1), spend('account_month', 9, cap(10, 80))];
    expect(combinedSpendStatus(spends)).toEqual({ status: 'warn', scope: 'account_month' });
  });

  it('R-32: warn ranks below hard_stop', () => {
    const spends = [
      spend('account_day', 9, cap(10, 80)),
      spend('account_month', 11, cap(10)),
    ];
    expect(combinedSpendStatus(spends)).toEqual({ status: 'hard_stop', scope: 'account_month' });
  });

  it('R-32: hard_stop wins regardless of input position', () => {
    const spends = [
      spend('workspace_month', 1),
      spend('account_day', 12, cap(10)),
      spend('work_order', 1),
    ];
    expect(combinedSpendStatus(spends)).toEqual({ status: 'hard_stop', scope: 'account_day' });
  });

  it('R-32: a warn tie keeps the first scope in input order', () => {
    const spends = [
      spend('account_day', 8, cap(10, 80)),
      spend('workspace_month', 4, cap(5, 80)),
    ];
    expect(combinedSpendStatus(spends)).toEqual({ status: 'warn', scope: 'account_day' });
  });

  it('R-32: a hard_stop tie keeps the first scope in input order', () => {
    const spends = [
      spend('work_order', 5, cap(5)),
      spend('account_day', 20, cap(10)),
    ];
    expect(combinedSpendStatus(spends)).toEqual({ status: 'hard_stop', scope: 'work_order' });
  });

  it('R-32: all scopes ok is ok with no scope', () => {
    const spends = [spend('account_day', 1, cap(10)), spend('work_order', 0, cap(10))];
    const result = combinedSpendStatus(spends);
    expect(result.status).toBe('ok');
    expect(result.scope).toBeUndefined();
  });

  it('R-32: uncapped scopes do not mask a capped one', () => {
    const spends = [spend('account_month', 500), spend('work_order', 8, cap(10, 80))];
    expect(combinedSpendStatus(spends)).toEqual({ status: 'warn', scope: 'work_order' });
  });

  it('R-32: a single scope reports its own status and scope', () => {
    expect(combinedSpendStatus([spend('work_order', 6, cap(5))])).toEqual({
      status: 'hard_stop',
      scope: 'work_order',
    });
  });

  it('R-32: does not mutate the input list', () => {
    const spends: readonly ScopedSpend[] = [
      spend('account_day', 1),
      spend('work_order', 8, cap(10, 80)),
    ];
    const snapshot = JSON.parse(JSON.stringify(spends)) as readonly ScopedSpend[];
    combinedSpendStatus(spends);
    expect(spends).toEqual(snapshot);
  });
});
