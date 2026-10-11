// scan-surfaces.test.ts — U-162 … U-164: where the scan shows. A skeleton stands only while no
// result exists yet; a rescan keeps the list; an error is one short sentence and the button. The
// sidebar's accounts block drops its noise lines. One component draws every rescan button.
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';

import type { Api } from '../../api/api';
import type { SettingsAccountsView } from '../../api/queries';
import { EN as en } from '../labels/en';
import { TR as tr } from '../labels/tr';
import type { ProviderFact } from '../stores/candidates';
import { createAccountsFrameStore } from '../stores/accounts-frame';
import { createProviderMarksStore } from '../stores/provider-marks';
import { createProvidersStore } from '../stores/providers';
import type { ShellChangeSignal } from '../stores/shell';
import { AccountsScanning, type AccountsScanningProps } from './accounts-scanning';
import { ProviderList } from './provider-list';
import { SidebarAccounts } from './sidebar-accounts';

// Sources are read through the bundler's raw imports: the presentation layer names no Node builtin.
const RAW = import.meta.glob(['../**/*.ts', '../**/*.tsx', '!../**/*.test.ts', '!../**/*.test.tsx'], { query: '?raw', import: 'default', eager: true }) as Record<string, string>;
/** Keys come relative to this folder: "./x.tsx" is components/x.tsx, "../screens/y.tsx" is screens/y.tsx. */
const norm = (key: string): string => (key.startsWith('./') ? `components/${key.slice(2)}` : key.replace(/^\.\.\//, ''));
const SOURCE_BY_PATH = new Map(Object.entries(RAW).map(([key, text]) => [norm(key), text]));
const read = (path: string): string => SOURCE_BY_PATH.get(path) ?? '';
const sources = (): { readonly file: string; readonly text: string }[] => [...SOURCE_BY_PATH].map(([file, text]) => ({ file, text }));

const body = () => createElement('div', { 'data-scan-body': '' });
const accountsHtml = (props: Partial<AccountsScanningProps> = {}): string =>
  renderToStaticMarkup(
    createElement(AccountsScanning, {
      locale: 'tr',
      titleKey: 'accountGroups.added',
      scanning: false,
      onRescan: () => undefined,
      totals: { accounts: 3, assistants: 2 },
      now: () => 1_000,
      children: body,
      ...props,
    }),
  );

describe('Hesaplar scan states (U-162)', () => {
  it('U-162: the first load (no result yet) draws the skeleton and the busy button', () => {
    const out = accountsHtml({ scanning: true, busy: true });
    expect(out).toContain('data-scan-skeleton-group');
    expect(out).toContain('<span>Taranıyor…</span>');
    expect(out).not.toContain('data-scan-body');
  });

  it('U-162: a rescan over a result keeps the list on screen — no skeleton — and only the button goes busy', () => {
    const out = accountsHtml({ scanning: false, busy: true, scannedAt: 0 });
    expect(out).toContain('data-scan-body');
    expect(out).not.toContain('data-scan-skeleton-group');
    expect(out).toContain('<span>Taranıyor…</span>');
    expect(out).toContain('aria-busy="true"');
  });

  it('U-162: the toolbar button is the shared RescanButton, right-aligned, with the age text once a scan exists', () => {
    const out = accountsHtml({ scannedAt: 0, now: () => 120_000 });
    expect(out).toContain('Yeniden tara');
    expect(out).toContain('Son tarama: 2 dakika önce');
    expect(out).toContain('ml-auto');
  });

  it('U-162: an error before any result is one short sentence and the Yeniden tara button, not a blank', () => {
    const out = accountsHtml({ failed: true });
    expect(out).toContain('Tarama olmadı.');
    expect(out).toContain('Yeniden tara');
    expect(out).not.toContain('data-scan-body');
    expect(out).not.toContain('data-scan-skeleton-group');
  });
});

const provider: ProviderFact = { defId: 'p-a', name: 'Alpha', installUrl: null, binPath: '/usr/bin/a', version: '1.0.0', loggedIn: true, optionalFlags: [] };
const noMarks = createProviderMarksStore({ api: { query: () => Promise.resolve({ ok: false, code: 'absent' }) } });
const providersHtml = (store: ReturnType<typeof createProvidersStore>): string =>
  renderToStaticMarkup(createElement(ProviderList, { store, marks: noMarks, locale: 'tr' }));

describe('Sağlayıcılar scan states (U-162)', () => {
  it('U-162: before the first result the section shows skeleton rows, never a blank', async () => {
    const store = createProvidersStore({ api: { query: () => new Promise(() => undefined) } });
    void store.ensure();
    const out = providersHtml(store);
    expect(out).toContain('data-provider-skeleton');
    expect(out).toContain('data-skeleton-block');
    expect(out).toContain('<span>Taranıyor…</span>');
  });

  it('U-162: once a result exists the skeleton never returns — a rescan keeps the rows and goes busy', async () => {
    let release: (value: unknown) => void = () => undefined;
    let calls = 0;
    const store = createProvidersStore({
      api: {
        query: () => {
          calls += 1;
          return calls === 1 ? Promise.resolve([provider]) : new Promise((resolve) => { release = resolve; });
        },
      },
      now: () => 0,
    });
    await store.ensure();
    const ready = providersHtml(store);
    expect(ready).not.toContain('data-provider-skeleton');
    expect(ready).toContain('Alpha');
    const done = store.rescan();
    const busy = providersHtml(store);
    expect(busy).not.toContain('data-provider-skeleton');
    expect(busy).toContain('Alpha');
    expect(busy).toContain('<span>Taranıyor…</span>');
    release([provider]);
    await done;
  });

  it('U-162: an error before any result is one short sentence and the button', async () => {
    const store = createProvidersStore({ api: { query: () => Promise.resolve({ ok: false, code: 'x' }) } });
    await store.ensure();
    const out = providersHtml(store);
    expect(out).toContain('Tarama olmadı.');
    expect(out).toContain('Yeniden tara');
    expect(out).not.toContain('data-provider-skeleton');
  });

  it('U-162: the button rides the header row at the right', async () => {
    const store = createProvidersStore({ api: { query: () => Promise.resolve([provider]) }, now: () => 0 });
    await store.ensure();
    expect(providersHtml(store)).toContain('ml-auto');
  });
});

const noChange: ShellChangeSignal = () => () => undefined;
const frame = async (accounts: SettingsAccountsView['accounts']): Promise<string> => {
  const api: Pick<Api, 'query'> = { query: () => Promise.resolve({ accounts, bindings: [] } satisfies SettingsAccountsView) };
  const store = createAccountsFrameStore({ api, changes: noChange });
  await store.load();
  store.toggle();
  return renderToStaticMarkup(
    createElement(SidebarAccounts, {
      store,
      marks: noMarks,
      locale: 'tr',
      activeAccountId: null,
      providerName: () => null,
      now: 0,
      onAddAccount: () => undefined,
      onOpenAccount: () => undefined,
    }),
  );
};

describe('Sidebar accounts block (U-163)', () => {
  it('U-163: the helper line and the "n hesap eklenmedi · Gör" row are gone, in every state and both locales', async () => {
    {
      const out = await frame([]);
      expect(out).not.toContain('Çubuk en dar limiti gösterir.');
      expect(out).not.toContain('eklenmedi');
      expect(out).not.toContain('Gör ›');
      expect(out).not.toContain('Henüz hesap yok.');
      expect(out).not.toContain('data-unadded-row');
    }
    const keys = Object.keys(tr);
    expect(keys).not.toContain('accounts.barHint');
    expect(Object.values(tr)).not.toContain('Çubuk en dar limiti gösterir.');
    expect(Object.values(en)).not.toContain('The bar shows the tightest limit.');
  });

  it('U-163: with no account the block is one compact card — "Hesap yok" and a small "Hesap ekle" button', async () => {
    const out = await frame([]);
    expect(out).toContain('data-accounts-empty');
    expect(out).toContain('Hesap yok');
    expect(out).toContain('Hesap ekle');
    expect(/<button[^>]*data-accounts-add[^>]*>/.test(out)).toBe(true);
    expect(out).toContain('rounded-card');
  });

  it('U-163: the refresh button is icon-only — aria-label and tooltip "Yeniden tara" — and the old "Kullanımı yenile" label is gone', async () => {
    const out = await frame([]);
    const tag = /<button[^>]*data-rescan-icon[^>]*>/.exec(out)?.[0] ?? '';
    expect(tag).toContain('aria-label="Yeniden tara"');
    expect(tag).toContain('title="Yeniden tara"');
    expect(out).not.toContain('Kullanımı yenile');
  });

  it('U-163: the sidebar draws its refresh through the shared RescanButton, and its icon — not the button — rotates', () => {
    const source = read('components/sidebar-accounts.tsx');
    expect(source).toContain('RescanButton');
    expect(source).toContain("variant=\"icon\"");
    expect(source).not.toContain('animate-spin');
  });
});

describe('One rescan button (U-164)', () => {
  it('U-164: no file but rescan-button.tsx draws a spinning icon or a refresh/rescan label button', () => {
    for (const { file, text } of sources()) {
      if (file === 'components/rescan-button.tsx' || file.startsWith('labels/')) continue;
      if (file === 'components/cockpit-running.tsx' || file === 'screens/wizard.tsx') continue; // run and finish spinners, not scans
      expect(text, file).not.toMatch(/(^|[^-])animate-spin/m);
      expect(text, file).not.toContain("'candidates.rescan'");
      expect(text, file).not.toContain("'providers.rescan'");
      expect(text, file).not.toContain("'accounts.refresh'");
    }
  });

  it('U-164: every screen that offers a scan imports RescanButton', () => {
    expect(read('components/accounts-scanning.tsx')).toContain('RescanButton');
    expect(read('components/provider-list.tsx')).toContain('RescanButton');
    expect(read('components/sidebar-accounts.tsx')).toContain('RescanButton');
  });

  it('U-164: opening a section reads the cache — Settings and the shell call ensure, never load or rescan on open', () => {
    const settings = read('screens/settings.tsx');
    expect(settings).toContain('candidates.ensure()');
    expect(settings).toContain('providers.ensure()');
    expect(settings).not.toContain('candidates.load()');
    expect(settings).not.toContain('providers.load()');
    const shell = read('screens/shell.tsx');
    expect(shell).toContain('candidateList.ensure()');
    expect(shell).not.toContain('candidates.load()');
  });

  it('U-164: copy — every new key is in both bundles and none exceeds 8 words', () => {
    const keys = ['scan.rescan', 'scan.scanning', 'scan.last', 'scan.failed', 'accounts.none', 'accounts.add'] as const;
    for (const key of keys) {
      for (const bundle of [tr, en]) {
        const text = bundle[key];
        expect(text.length, key).toBeGreaterThan(0);
        expect(text.split(/\s+/).length, key).toBeLessThanOrEqual(8);
      }
    }
  });

  it('U-164: measure — the new component uses rem lengths and the radius tokens only', () => {
    const source = read('components/rescan-button.tsx').replace(/^\s*\/\/.*$/gm, '').replace(/\/\*\*[^]*?\*\//g, '');
    expect(source).not.toMatch(/\d(px)\b/);
    expect(source).not.toMatch(/rounded-(sm|md|lg|xl|2xl|3xl|none)\b/);
    expect(source).not.toContain('Yeniden tara');
    expect(source).not.toContain('Taranıyor');
  });
});
