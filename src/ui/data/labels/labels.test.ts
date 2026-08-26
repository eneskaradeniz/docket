// Runtime belt under the compile-time braces (WO-0035). The REAL completeness gate is `const en:
// Labels` — a missing key fails typecheck. These tests catch a future refactor that loses the type
// link (e.g. a bundle rebuilt by hand, a spread that silently drops members) and pin the formatter
// expectations both locales are built on.
import { describe, expect, it } from 'vitest';
import { en, LABEL_BUNDLES, tr } from './index';

describe('locale bundles (WO-0035)', () => {
  it('en mirrors every tr member key with the same member kind', () => {
    expect(Object.keys(en).sort()).toEqual(Object.keys(tr).sort());
    for (const key of Object.keys(tr)) {
      expect(typeof en[key as keyof typeof en]).toBe(typeof tr[key as keyof typeof tr]);
    }
  });

  it('the UI object mirrors key-for-key', () => {
    expect(Object.keys(en.UI).sort()).toEqual(Object.keys(tr.UI).sort());
  });

  it('bundles are keyed by exactly the Locale union', () => {
    expect(Object.keys(LABEL_BUNDLES).sort()).toEqual(['en', 'tr']);
  });

  it('cost format flips its decimal separator per locale', () => {
    expect(tr.formatUsd(6.27)).toBe('$6,27');
    expect(en.formatUsd(6.27)).toBe('$6.27');
  });

  it('duration units localize', () => {
    expect(tr.UI.formatDuration(65_000)).toBe('1dk 5sn');
    expect(en.UI.formatDuration(65_000)).toBe('1m 5s');
  });

  it('month abbreviations localize', () => {
    // 17:15Z stays inside August in every timezone (±14h) — the month, not the hour, is the assertion
    expect(tr.formatDateTime('2026-08-15T17:15:00Z')).toContain('Ağu');
    expect(en.formatDateTime('2026-08-15T17:15:00Z')).toContain('Aug');
  });

  it('the budget warn line carries the locale’s money voice + the known-spend basis (WO-0047)', () => {
    // The honesty qualifier rides the Known variants only; both figures in, both rendered.
    expect(tr.UI.budgetWarnLineKnown(4.2, 5)).toContain('$4,20');
    expect(tr.UI.budgetWarnLineKnown(4.2, 5)).toContain('bilinen harcama');
    expect(tr.UI.budgetWarnLine(4.2, 5)).not.toContain('bilinen harcama');
    expect(en.UI.budgetWarnLineKnown(4.2, 5)).toContain('$4.20');
    expect(en.UI.budgetWarnLineKnown(4.2, 5)).toContain('known spend');
  });
});
