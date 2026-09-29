// work-order-code.test.ts — U-22: the one pure code formatter. The locale's prefix plus the
// A-29 number, zero-padded to four digits; a number above 9999 shows in full.
import { describe, expect, it } from 'vitest';

import { EN } from '../labels/en';
import { TR } from '../labels/tr';

import { formatWorkOrderCode } from './work-order-code';

describe('formatWorkOrderCode', () => {
  it('U-22: the locale prefix plus the number padded to four digits', () => {
    expect(formatWorkOrderCode(14, 'tr')).toBe('İE-0014');
    expect(formatWorkOrderCode(14, 'en')).toBe('WO-0014');
    expect(formatWorkOrderCode(1, 'tr')).toBe('İE-0001');
    expect(formatWorkOrderCode(1, 'en')).toBe('WO-0001');
  });

  it('U-22: a number above 9999 shows in full, never truncated', () => {
    expect(formatWorkOrderCode(12345, 'tr')).toBe('İE-12345');
    expect(formatWorkOrderCode(12345, 'en')).toBe('WO-12345');
  });

  it('U-22: the prefixes are the bundles own workOrder.codePrefix copy, never inline literals', () => {
    expect(TR['workOrder.codePrefix']).toBe('İE-');
    expect(EN['workOrder.codePrefix']).toBe('WO-');
  });
});
