// reset-line.test.ts — U-20: a window's reset as "…'de sıfırlanır · … kaldı", shared by the account
// view's blocks and the Kullanım bars of Settings.
import { describe, expect, it } from 'vitest';

import { remainingText, resetLine, trLocativeSuffix } from './reset-line';

const AT = Date.UTC(2026, 9, 3, 14, 30);
const NOW = Date.UTC(2026, 9, 3, 11, 18); // 3 h 12 m earlier

describe('reset line (U-20)', () => {
  it('U-20: Turkish reads "14:30\'da sıfırlanır · 3 sa 12 dk kaldı"', () => {
    expect(resetLine('tr', 'UTC', AT, NOW)).toBe("14:30'da sıfırlanır · 3 sa 12 dk kaldı");
  });

  it('U-20: English reads "Resets at 14:30 · 3h 12m left"', () => {
    expect(resetLine('en', 'UTC', AT, NOW)).toBe('Resets at 14:30 · 3h 12m left');
  });

  it('U-20: the remaining span is compact — minutes, hours and minutes, days and hours; never negative', () => {
    expect(remainingText('tr', 45 * 60_000)).toBe('45 dk');
    expect(remainingText('tr', (2 * 24 + 4) * 3_600_000)).toBe('2 gün 4 sa');
    expect(remainingText('en', (2 * 24 + 4) * 3_600_000)).toBe('2d 4h');
    expect(remainingText('tr', -5)).toBe('0 dk');
  });

  it('U-20: a reset more than a day away names its weekday so the time is not ambiguous', () => {
    const later = AT + 3 * 24 * 3_600_000;
    expect(resetLine('en', 'UTC', later, NOW)).toBe('Resets at Tue 14:30 · 3d 3h left');
  });

  it('U-20: the Turkish locative follows the last spoken number of the time', () => {
    expect(trLocativeSuffix(14, 30)).toBe('da');
    expect(trLocativeSuffix(9, 15)).toBe('te');
    expect(trLocativeSuffix(14, 0)).toBe('te');
    expect(trLocativeSuffix(0, 0)).toBe('da');
    expect(trLocativeSuffix(8, 20)).toBe('de');
    expect(trLocativeSuffix(16, 40)).toBe('ta');
  });
});
