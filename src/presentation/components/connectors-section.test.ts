// connectors-section.test.ts — the Entegrasyonlar rows on the rendered section (U-356): the
// ready row's facts (name, version, what it provides, the network line), the readiness chips,
// the invalid row's error code with its inert switch, the disabled "Hesap ekle" placeholder that
// appears only for a connector that declares settings, and the typed reason a refused switch
// leaves on its row. The store is the real one over fakes; the markup is the server render.
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';

import type { ConnectorListView } from '../../api/queries';
import type { Actor } from '../../domain/index';
import type { Locale } from '../labels/t';
import { createConnectorsStore, type ConnectorsStore } from '../stores/connectors';
import { ConnectorsSection } from './connectors-section';

const USER: Actor = { kind: 'user', id: 'user-1', label: 'Operator' };

const row = (over: Partial<ConnectorListView>): ConnectorListView => ({
  id: 'demo-forge',
  name: 'Demo Forge',
  version: '1.2.0',
  provides: ['forge', 'tracker'],
  hostMatch: ['forge.example'],
  network: ['api.forge.example', 'forge.example'],
  requiresCli: 'demo',
  hasSettings: false,
  enabled: true,
  health: 'ready',
  ...over,
});

const storeWith = async (
  rows: readonly ConnectorListView[],
  switchResult: { readonly ok: true } | { readonly ok: false; readonly code: string } = { ok: true },
): Promise<ConnectorsStore> => {
  const store = createConnectorsStore({
    api: {
      query: async () => rows,
      command: async () => switchResult,
    },
    actor: USER,
  });
  await store.load();
  return store;
};

const render = (store: ConnectorsStore, locale: Locale = 'tr'): string =>
  renderToStaticMarkup(createElement(ConnectorsSection, { store, locale }));

const switchOf = (html: string): string => html.match(/<button[^>]*role="switch"[^>]*>/)?.[0] ?? '';

describe('ConnectorsSection (U-356)', () => {
  it('U-356: a ready row shows the name, the version, what it provides as words, the network line and a checked switch', async () => {
    const html = render(await storeWith([row({})]));
    expect(html).toContain('>Demo Forge<');
    expect(html).toContain('1.2.0');
    expect(html).toContain('Kod deposu · İş takibi');
    expect(html).toContain('Bu bağlayıcı şu adreslere bağlanır: api.forge.example, forge.example');
    expect(html).toContain('Gereken CLI: demo');
    expect(html).toContain('>Hazır<');
    expect(switchOf(html)).toContain('aria-checked="true"');
    // The switch's accessible name is the connector's own manifest name.
    expect(switchOf(html)).toContain('Demo Forge');
  });

  it('U-356: a needs_cli row carries its chip; a needs_account row its own word', async () => {
    const html = render(await storeWith([row({ id: 'cli-less', name: 'Cli Less', health: 'needs_cli' }), row({ id: 'acct', name: 'Acct', health: 'needs_account' })]));
    expect(html).toContain('>CLI gerekli<');
    expect(html).toContain('>Hesap gerekli<');
  });

  it('U-356: an invalid row shows its error code and keeps an inert switch', async () => {
    const html = render(await storeWith([row({ id: 'broken', name: 'Broken', health: 'invalid', error: 'bad_version', enabled: false })]));
    expect(html).toContain('>Geçersiz<');
    expect(html).toContain('>bad_version<');
    const inert = switchOf(html);
    expect(inert).toContain('aria-disabled="true"');
    expect(inert).toContain('aria-checked="false"');
  });

  it('U-356: the disabled "Hesap ekle" row appears only for a connector that declares settings', async () => {
    const withSettings = render(await storeWith([row({ id: 'fields', name: 'Fields', hasSettings: true })]));
    expect(withSettings).toContain('>Hesap ekle<');
    expect(withSettings).toContain('bu bağlayıcı için hesap adımı henüz yok');
    const without = render(await storeWith([row({})]));
    expect(without).not.toContain('>Hesap ekle<');
  });

  it('U-356: a refused switch leaves its typed reason on the row, error-styled', async () => {
    const store = await storeWith([row({})], { ok: false, code: 'invalid' });
    expect(render(store)).not.toContain('role="alert"');
    await store.setEnabled('demo-forge', true);
    expect(render(store)).toMatch(/role="alert"/);
    expect(render(store)).toContain('Bu bağlayıcının tanımı geçersiz; anahtarı kullanılamaz.');
  });

  it('U-356: English renders the peer locale words', async () => {
    const html = render(await storeWith([row({ id: 'fields', name: 'Fields', hasSettings: true })]), 'en');
    expect(html).toContain('Code forge · Issue tracking');
    expect(html).toContain('This connector connects to: api.forge.example, forge.example');
    expect(html).toContain('>Ready<');
    expect(html).toContain('no account step for this connector yet');
  });
});
