// meter-list.test.ts — U-44 as markup: the list never shows a raw unit word, writes the reset span
// through the bundle, tags rows by scope and says which line replaces missing rows.
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';

import type { SettingsMeterView, SettingsPoolView } from '../../api/queries';
import { meterListView } from '../stores/meter-list';
import { MeterList } from './meter-list';

const NOW = 1_000_000;

const pool = (id: string, label: string, appliesTo: SettingsPoolView['appliesTo']): SettingsPoolView => ({ id, label, kind: 'allowance', appliesTo });

const meter = (patch: Partial<SettingsMeterView> & Pick<SettingsMeterView, 'id' | 'poolId'>): SettingsMeterView => ({
  label: 'five_hour',
  cadence: 'fixed',
  durationMs: null,
  unit: 'percent',
  used: 41,
  limit: 100,
  remaining: 59,
  resetsAt: NOW + 2 * 3_600_000 + 10 * 60_000,
  resetPrecision: 'exact',
  observedAt: NOW,
  source: 'polled',
  staleAfterMs: null,
  reserveClass: 'short',
  reserveShare: 0,
  ...patch,
});

const html = (
  locale: 'tr' | 'en',
  pools: readonly SettingsPoolView[],
  meters: readonly SettingsMeterView[],
  empty: Parameters<typeof MeterList>[0]['empty'] = null,
): string => renderToStaticMarkup(createElement(MeterList, { locale, view: meterListView(pools, meters), empty, now: NOW }));

describe('MeterList markup', () => {
  it('U-44: a row reads the window name, "%59 kalan" and "2 sa 10 dk sonra sıfırlanır" in tr, never the word percent', () => {
    const out = html('tr', [pool('p', 'plan', 'all')], [meter({ id: 'm', poolId: 'p' })]);
    expect(out).toContain('5 saatlik');
    expect(out).toContain('%59');
    expect(out).toContain('kalan');
    expect(out).toContain('2 sa 10 dk sonra sıfırlanır');
    expect(out).not.toContain('percent');
  });

  it('U-44: the English bundle speaks the same row', () => {
    const out = html('en', [pool('p', 'plan', 'all')], [meter({ id: 'm', poolId: 'p' })]);
    expect(out).toContain('5-hour');
    expect(out).toContain('left');
    expect(out).toContain('resets in 2h 10m');
  });

  it('U-44: an unknown unit shows no raw unit word', () => {
    const out = html('tr', [pool('p', 'plan', 'all')], [meter({ id: 'm', poolId: 'p', unit: 'furlongs', used: 5, limit: null, remaining: null })]);
    expect(out).not.toContain('furlongs');
  });

  it('U-44: with a model-scoped pool every row is tagged and one note names the model', () => {
    const out = html(
      'tr',
      [pool('p', 'plan', 'all'), pool('f', 'Fable', [{ prefix: 'm-' }])],
      [meter({ id: 'a', poolId: 'p' }), meter({ id: 'b', poolId: 'f', label: 'seven_day' })],
    );
    expect(out).toContain('tüm modeller');
    expect(out).toContain('yalnız Fable');
    expect(out).toContain('Fable limiti dolarsa bu hesapta yalnız Fable durur; diğer modeller çalışmaya devam eder.');
    expect(out.match(/limiti dolarsa/g)).toHaveLength(1);
  });

  it('U-44: with no rows it shows the one chosen line, or nothing', () => {
    expect(html('tr', [], [], 'meterList.noMeter')).toContain('Bu asistan kullanım bilgisi vermiyor; limit dolunca hatadan anlarız.');
    expect(html('tr', [], [], 'meterList.needsLogin')).toContain('Giriş yapılınca limitler görünür.');
    expect(html('tr', [], [], 'meterList.afterAdd')).toContain('Limitler hesap eklenince okunur.');
    expect(html('tr', [], [], null)).toBe('');
  });
});
