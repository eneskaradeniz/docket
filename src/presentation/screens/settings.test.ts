import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';

import type { SettingsAccountView } from '../../api/queries';
import { AccountEditorPanels } from '../components/account-editor';
import { createAccountEditorStore } from '../stores/account-editor';
import { SETTINGS_SECTIONS } from './settings';

const ACCOUNT: SettingsAccountView = {
  id: 'acc-1',
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
  pools: [],
  meters: [],
};

describe('SETTINGS_SECTIONS', () => {
  it('U-24: update stays at the end of the list', () => {
    expect(SETTINGS_SECTIONS.at(-1)).toBe('update');
    expect(SETTINGS_SECTIONS).not.toContain('phone');
  });

  it('every section appears exactly once — a duplicated door would split the menu', () => {
    expect(new Set(SETTINGS_SECTIONS).size).toBe(SETTINGS_SECTIONS.length);
  });
});

describe('Account editor Usage panel states (U-266, U-267)', () => {
  it('U-266: while a refresh runs in Settings, Yenile is disabled and the skeleton shows after 150 ms', () => {
    const store = createAccountEditorStore({
      run: async () => ({ result: { ok: true }, labelKey: 'success.account.save' }),
      now: () => 1000,
    });
    store.setTab('usage');

    // With refreshing: true before 150 ms: Yenile disabled, no skeleton yet, no no-usage message
    const htmlBefore = renderToStaticMarkup(
      createElement(AccountEditorPanels, {
        account: ACCOUNT,
        locale: 'tr',
        store,
        formatTime: () => '12:00',
        onRefresh: () => {},
        refreshing: true,
        skeletonNow: () => 0,
      }),
    );
    expect(htmlBefore).toContain('disabled');
    expect(htmlBefore).not.toContain('data-usage-skeleton');
    expect(htmlBefore).not.toContain('Bu asistan kullanım bilgisi vermiyor');

    // With refreshing: true after 150 ms: skeleton visible
    let step = 0;
    const htmlAfter = renderToStaticMarkup(
      createElement(AccountEditorPanels, {
        account: ACCOUNT,
        locale: 'tr',
        store,
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
    expect(htmlAfter).toContain('disabled');
    expect(htmlAfter).toContain('data-usage-skeleton');
    expect(htmlAfter).not.toContain('Bu asistan kullanım bilgisi vermiyor');
  });

  it('U-267: a failed refresh in Settings shows the reason and "Tekrar dene"; a retry re-enters the loading state', () => {
    const store = createAccountEditorStore({
      run: async () => ({ result: { ok: true }, labelKey: 'success.account.save' }),
      now: () => 1000,
    });
    store.setTab('usage');

    const htmlFailed = renderToStaticMarkup(
      createElement(AccountEditorPanels, {
        account: ACCOUNT,
        locale: 'tr',
        store,
        formatTime: () => '12:00',
        onRefresh: () => {},
        refreshing: false,
        refreshFailure: 'network',
      }),
    );
    expect(htmlFailed).toContain('data-usage-error');
    expect(htmlFailed).toContain('Bağlantı kurulamadı; kullanım okunamadı.');
    expect(htmlFailed).toContain('Tekrar dene');

    // Retry re-enters loading state
    let retryStep = 0;
    const htmlRetrying = renderToStaticMarkup(
      createElement(AccountEditorPanels, {
        account: ACCOUNT,
        locale: 'tr',
        store,
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
    expect(htmlRetrying).not.toContain('data-usage-error');
    expect(htmlRetrying).toContain('data-usage-skeleton');
  });
});
