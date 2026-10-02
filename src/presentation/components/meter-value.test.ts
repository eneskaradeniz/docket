// meter-value.test.ts — every MeterUnit in both locales, and the unknown-unit guard.
import { describe, expect, it } from 'vitest';

import type { MeterUnit } from '../../domain';
import { formatMeterValue, meterUnitLabel } from './meter-value';

const ALL: Readonly<Record<MeterUnit, true>> = {
  percent: true, fraction: true, requests: true, prompts: true, tokens: true, credits: true, usd: true, minutes: true,
};

describe('formatMeterValue', () => {
  it('percent reads %59 in tr and 59% in en', () => {
    expect(formatMeterValue('tr', 'percent', 59)).toBe('%59');
    expect(formatMeterValue('en', 'percent', 59)).toBe('59%');
  });

  it('fraction is multiplied by 100 and rounded', () => {
    expect(formatMeterValue('tr', 'fraction', 0.587)).toBe('%59');
    expect(formatMeterValue('en', 'fraction', 0.587)).toBe('59%');
  });

  it('usd is a currency', () => {
    expect(formatMeterValue('en', 'usd', 12.5)).toBe('$12.50');
    expect(formatMeterValue('tr', 'usd', 12.5)).toContain('12,50');
  });

  it('counted units take their word from the bundle', () => {
    expect(formatMeterValue('tr', 'credits', 40)).toBe('40 kredi');
    expect(formatMeterValue('en', 'credits', 40)).toBe('40 credits');
    expect(formatMeterValue('tr', 'tokens', 1200)).toBe('1.200 token');
    expect(formatMeterValue('en', 'requests', 3)).toBe('3 requests');
    expect(formatMeterValue('tr', 'prompts', 3)).toBe('3 istem');
    expect(formatMeterValue('en', 'minutes', 5)).toBe('5 minutes');
  });

  it('every unit renders in both locales without leaking the raw word', () => {
    for (const unit of Object.keys(ALL)) {
      for (const locale of ['tr', 'en'] as const) {
        const text = formatMeterValue(locale, unit, 5);
        expect(text).toMatch(/\d/);
        expect(text).not.toContain('{');
        expect(text).not.toContain(unit === 'percent' ? 'percent' : '\u0000');
      }
    }
  });

  it('an unknown unit is the plain number, never a percent', () => {
    expect(formatMeterValue('tr', 'furlongs', 59)).toBe('59');
    expect(formatMeterValue('en', 'furlongs', 59)).not.toContain('%');
    expect(meterUnitLabel('en', 'furlongs')).toBeNull();
  });
});
