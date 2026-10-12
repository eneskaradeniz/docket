// meter-list.test.ts — U-44 as markup: the list never shows a raw unit word, writes the reset span
// through the bundle, tags rows by scope and says which line replaces missing rows.
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';

import type { SettingsAccountView, SettingsMeterView, SettingsPoolView } from '../../api/queries';
import { meterListView } from '../stores/meter-list';
import { Usage } from './account-editor';
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

const mockAccount = (meters: readonly SettingsMeterView[] = []): SettingsAccountView => ({
  id: 'a-1',
  provider: 'claude',
  label: 'Work',
  authMode: 'subscription',
  billing: 'included',
  plan: 'pro',
  limitPolicy: 'wait_resume',
  reserve: { short: null, long: null },
  caps: [],
  consentedModels: [],
  routeKind: null,
  identityDir: '/home/u/.claude',
  endpointHost: null,
  hasSecret: false,
  test: null,
  pools: [pool('p', 'plan', 'all')],
  meters,
});

describe('Usage honest states (U-266, U-267)', () => {
  it('U-266: while a refresh runs, Yenile is disabled and the skeleton shows after 150 ms; the no-usage message is not rendered', () => {
    // 1. Refreshing with 0 meters before 150 ms: Yenile disabled, skeleton not visible yet, no "no usage" message
    const beforeDelay = renderToStaticMarkup(
      createElement(Usage, {
        account: mockAccount([]),
        locale: 'tr',
        formatTime: () => '12:00',
        onRefresh: () => {},
        refreshing: true,
        skeletonNow: () => 0,
      }),
    );
    expect(beforeDelay).toContain('disabled');
    expect(beforeDelay).not.toContain('data-usage-skeleton');
    expect(beforeDelay).not.toContain('Bu asistan kullanım bilgisi vermiyor');

    // 2. Refreshing with 0 meters after 150 ms: Yenile disabled, skeleton is rendered, no "no usage" message
    let step = 0;
    const afterDelay = renderToStaticMarkup(
      createElement(Usage, {
        account: mockAccount([]),
        locale: 'tr',
        formatTime: () => '12:00',
        onRefresh: () => {},
        refreshing: true,
        skeletonNow: () => {
          const val = step;
          step += 200;
          return val;
        },
      }),
    );
    expect(afterDelay).toContain('disabled');
    expect(afterDelay).toContain('data-usage-skeleton');
    expect(afterDelay).not.toContain('Bu asistan kullanım bilgisi vermiyor');

    // 3. Refreshing with previous bars: Yenile disabled, previous bars remain visible under subtle busy state
    const withBars = renderToStaticMarkup(
      createElement(Usage, {
        account: mockAccount([meter({ id: 'm', poolId: 'p' })]),
        locale: 'tr',
        formatTime: () => '12:00',
        onRefresh: () => {},
        refreshing: true,
      }),
    );
    expect(withBars).toContain('disabled');
    expect(withBars).toContain('data-usage-busy');
    expect(withBars).toContain('aria-busy="true"');
    expect(withBars).toContain('5 saatlik');
    expect(withBars).not.toContain('data-usage-skeleton');
    expect(withBars).not.toContain('Bu asistan kullanım bilgisi vermiyor');
  });

  it('U-267: a failed refresh shows the reason and "Tekrar dene"; a retry re-enters the loading state', () => {
    // 1. Failed refresh shows typed reason and "Tekrar dene"
    const failedHtml = renderToStaticMarkup(
      createElement(Usage, {
        account: mockAccount([]),
        locale: 'tr',
        formatTime: () => '12:00',
        onRefresh: () => {},
        refreshing: false,
        refreshFailure: 'network',
      }),
    );
    expect(failedHtml).toContain('data-usage-error');
    expect(failedHtml).toContain('Bağlantı kurulamadı; kullanım okunamadı.');
    expect(failedHtml).toContain('Tekrar dene');
    expect(failedHtml).not.toContain('Bu asistan kullanım bilgisi vermiyor');

    // In English
    const failedEn = renderToStaticMarkup(
      createElement(Usage, {
        account: mockAccount([]),
        locale: 'en',
        formatTime: () => '12:00',
        onRefresh: () => {},
        refreshing: false,
        refreshFailure: 'rejected',
      }),
    );
    expect(failedEn).toContain('Request rejected; usage could not be read.');
    expect(failedEn).toContain('Try again');

    // 2. Retry re-enters loading state (refreshing=true, no error note)
    let retryStep = 0;
    const retryingHtml = renderToStaticMarkup(
      createElement(Usage, {
        account: mockAccount([]),
        locale: 'tr',
        formatTime: () => '12:00',
        onRefresh: () => {},
        refreshing: true,
        refreshFailure: null,
        skeletonNow: () => {
          const val = retryStep;
          retryStep += 200;
          return val;
        },
      }),
    );
    expect(retryingHtml).not.toContain('data-usage-error');
    expect(retryingHtml).toContain('data-usage-skeleton');
  });
});
