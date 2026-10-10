// cockpit-format.test.ts — U-83: the age formatter reads "now" under a minute and keeps its past
// phrasing for minutes, hours and days.
import { describe, expect, it } from 'vitest';

import { formatAge } from './cockpit-format';

describe('formatAge', () => {
  it('U-83: zero reads şimdi in Turkish', () => {
    expect(formatAge('tr', 0)).toBe('şimdi');
  });

  it('U-83: 30 seconds reads now in English', () => {
    expect(formatAge('en', 30_000)).toBe('now');
  });

  it('U-83: 90 seconds stays a past minute', () => {
    expect(formatAge('tr', 90_000)).toBe('1 dakika önce');
  });

  it('U-83: 59 999 ms is still now', () => {
    expect(formatAge('tr', 59_999)).toBe('şimdi');
  });

  it('U-83: 60 000 ms is one minute ago', () => {
    expect(formatAge('tr', 60_000)).toBe('1 dakika önce');
    expect(formatAge('en', 60_000)).toBe('1 minute ago');
  });

  it('U-83: 3 599 999 ms is 59 minutes ago', () => {
    expect(formatAge('tr', 3_599_999)).toBe('59 dakika önce');
  });

  it('U-83: 3 600 000 ms is one hour ago', () => {
    expect(formatAge('tr', 3_600_000)).toBe('1 saat önce');
  });

  it('U-83: 86 400 000 ms is one day ago', () => {
    expect(formatAge('tr', 86_400_000)).toBe('1 gün önce');
    expect(formatAge('en', 86_400_000)).toBe('1 day ago');
  });
});
