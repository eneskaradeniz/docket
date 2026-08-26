import { describe, expect, it } from 'vitest';
import {
  DEFAULT_WARN_PERCENT,
  budgetStatus,
  monthWindow,
  parseAmount,
  warnThresholdUsd,
  workspaceBudgetView,
} from '../budget';

describe('monthWindow — the UTC calendar month as an ISO string range', () => {
  it('brackets the month containing the instant', () => {
    const w = monthWindow(new Date('2026-08-26T09:41:00.123Z'));
    expect(w.startIso).toBe('2026-08-01T00:00:00.000Z');
    expect(w.endIso).toBe('2026-09-01T00:00:00.000Z');
  });

  it('rolls the year over December', () => {
    const w = monthWindow(new Date('2026-12-31T23:59:59.999Z'));
    expect(w.startIso).toBe('2026-12-01T00:00:00.000Z');
    expect(w.endIso).toBe('2027-01-01T00:00:00.000Z');
  });

  it('windows by the UTC fields of a locally-constructed date (no local drift)', () => {
    // Local parts at mid-month noon: whatever the runner's zone (±14h), the UTC instant stays
    // inside the same month — only the UTC fields may be trusted, never the local ones.
    const w = monthWindow(new Date(2026, 7, 15, 12, 0, 0));
    expect(w.startIso).toBe('2026-08-01T00:00:00.000Z');
    expect(w.endIso).toBe('2026-09-01T00:00:00.000Z');
  });
});

describe('warnThresholdUsd — cent-exact ceil', () => {
  it('is exact on clean numbers', () => {
    expect(warnThresholdUsd(5, 80)).toBe(4);
  });

  it('rounds UP to the next cent (Paperclip ceil)', () => {
    expect(warnThresholdUsd(5.01, 80)).toBe(4.01); // 4.008 → 4.01
  });

  it('does not buy a phantom cent on a float artifact', () => {
    expect(warnThresholdUsd(4.35, 80)).toBe(3.48); // 4.35·80 = 348.00000000000006 in float
  });
});

describe('budgetStatus — the ok/warn/hard_stop boundaries', () => {
  const t = { capUsd: 5, warnPercent: 80 };

  it('walks ok → warn → hard_stop across the exact boundaries', () => {
    expect(budgetStatus(3.99, t)).toBe('ok');
    expect(budgetStatus(4.0, t)).toBe('warn'); // exactly at the warn line
    expect(budgetStatus(4.99, t)).toBe('warn');
    expect(budgetStatus(5.0, t)).toBe('hard_stop'); // exactly at the cap
  });

  it('ceils the warn line: 4.01-cap of 5.01 warns at 4.01, not 4.008', () => {
    expect(budgetStatus(4.0, { capUsd: 5.01, warnPercent: 80 })).toBe('ok');
    expect(budgetStatus(4.01, { capUsd: 5.01, warnPercent: 80 })).toBe('warn');
  });

  it('collapses the warn band at warnPercent 100 (the line IS the cap)', () => {
    expect(budgetStatus(4.99, { capUsd: 5, warnPercent: 100 })).toBe('ok');
    expect(budgetStatus(5.0, { capUsd: 5, warnPercent: 100 })).toBe('hard_stop');
  });

  it('fails open on an unconfigured or nonsense cap', () => {
    expect(budgetStatus(999, { capUsd: 0, warnPercent: 80 })).toBe('ok');
    expect(budgetStatus(999, { capUsd: -3, warnPercent: 80 })).toBe('ok');
  });

  it('a fresh month (observed 0) under a configured cap is ok', () => {
    expect(budgetStatus(0, t)).toBe('ok');
  });
});

describe('workspaceBudgetView — the composed read', () => {
  it('carries the threshold, the sum, the honesty qualifier, and the derived status', () => {
    const view = workspaceBudgetView(4.2, true, { capUsd: 5, warnPercent: 80 });
    expect(view).toEqual({
      threshold: { capUsd: 5, warnPercent: 80 },
      monthUsd: 4.2,
      hasUnknown: true,
      status: 'warn',
    });
  });
});

describe('DEFAULT_WARN_PERCENT', () => {
  it('is Paperclip’s default 80', () => {
    expect(DEFAULT_WARN_PERCENT).toBe(80);
  });
});

describe('parseAmount — both separators, the operator’s keyboard', () => {
  it('accepts dot, comma, integers, decimals, and surrounding space', () => {
    expect(parseAmount('20')).toBe(20);
    expect(parseAmount('20.50')).toBe(20.5);
    expect(parseAmount('20,50')).toBe(20.5);
    expect(parseAmount(' 15 ')).toBe(15);
    expect(parseAmount('0')).toBe(0); // the CALLER owns the > 0 check
  });

  it('rejects signs, thousand separators, and garbage as NaN', () => {
    expect(parseAmount('-5')).toBeNaN();
    expect(parseAmount('1.234,56')).toBeNaN();
    expect(parseAmount('abc')).toBeNaN();
    expect(parseAmount('')).toBeNaN();
    expect(parseAmount('20.')).toBeNaN();
  });
});
