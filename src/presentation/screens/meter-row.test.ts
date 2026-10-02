// meter-row.test.ts — the account card's meter line as markup: the raw unit word never reaches
// the screen, in either locale.
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';

import { MeterRow } from './settings';
import type { MeterDisplay } from '../stores/settings';

const METER: MeterDisplay = {
  id: 'm1', poolId: 'p1', label: 'Weekly', unit: 'percent', remaining: 59, resetsAt: null, resetPrecision: 'exact', source: 'pushed',
};

const html = (locale: 'tr' | 'en', meter: MeterDisplay): string =>
  renderToStaticMarkup(createElement(MeterRow, { meter, locale, resetsAt: null }));

describe('MeterRow', () => {
  it('reads "kalan %59" in tr and "remaining 59%" in en, never the word percent', () => {
    expect(html('tr', METER)).toContain('kalan %59');
    expect(html('en', METER)).toContain('remaining 59%');
    expect(html('tr', METER)).not.toContain('percent');
    expect(html('en', METER)).not.toContain('percent');
  });

  it('an unknown unit shows the bare number, no raw unit word', () => {
    const out = html('tr', { ...METER, unit: 'furlongs' });
    expect(out).toContain('kalan 59');
    expect(out).not.toContain('furlongs');
    expect(out).not.toContain('%');
  });
});
