// concurrency-section.test.ts — U-70 … U-74 on the rendered Eşzamanlılık section: the mode
// control and its descriptions, the validation message and the disabled steppers, the machine
// row, the live status card in its three bands, the account rows, and the save / reset buttons.
// The store is the real one over fakes; the markup is the server render, read by text and
// attributes. Rem geometry and the token radii are read off the component's source.
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';

import type { Locale } from '../labels/t';
import { createDispatchSettingsStore, type DispatchSettingsStore } from '../stores/dispatch-settings';
import { ConcurrencySection } from './concurrency-section';

const SOURCES = import.meta.glob('./concurrency-section.tsx', { query: '?raw', import: 'default', eager: true }) as Record<string, string>;
const SOURCE = Object.values(SOURCES)[0] ?? '';
const PANEL_SOURCES = import.meta.glob('../screens/settings.tsx', { query: '?raw', import: 'default', eager: true }) as Record<string, string>;
const PANEL_SOURCE = Object.values(PANEL_SOURCES)[0] ?? '';

const ACCOUNTS = [
  { id: 'a1', name: 'Claude Code · Kişisel' },
  { id: 'a2', name: 'Claude Code · İş' },
];

type Reply = Record<string, unknown>;

const reply = (extra: Reply = {}): Reply => ({
  global: 4,
  perRepo: 3,
  perAccount: {},
  mode: 'auto',
  suggested: 6,
  machine: { cores: 10, totalMemGb: 16 },
  status: { mode: 'auto', cap: 4, effective: 4, band: 'free', load1: 0.3 },
  ...extra,
});

const loaded = async (extra: Reply = {}): Promise<DispatchSettingsStore> => {
  const store = createDispatchSettingsStore({ read: () => Promise.resolve(reply(extra)), write: () => Promise.resolve({ ok: true }) });
  await store.load();
  return store;
};

const render = (store: DispatchSettingsStore, locale: Locale = 'tr', accounts = ACCOUNTS): string =>
  renderToStaticMarkup(createElement(ConcurrencySection, { store, locale, accounts, active: false }));

const button = (html: string, text: string): string => html.match(new RegExp(`<button[^>]*>${text}</button>`))?.[0] ?? '';

describe('U-70: mode', () => {
  it('U-70: Otomatik reads Tavan with its description; Sabit reads Toplam and drops the machine row', async () => {
    const auto = render(await loaded());
    expect(auto).toContain('Makine boşken tavan kadar iş paralel çalışır, yoğunken yeni iş başlatma kendiliğinden azalır. Çalışan işler kesilmez.');
    expect(auto).toContain('>Tavan<');
    expect(auto).toContain('Makine boşken aynı anda çalışan en fazla iş');
    expect(auto).toMatch(/<button[^>]*aria-pressed="true"[^>]*>Otomatik<\/button>/);
    expect(auto).toContain('data-dispatch-machine');

    const fixed = render(await loaded({ mode: 'fixed' }));
    expect(fixed).toContain('Her zaman aşağıdaki sayı kadar iş paralel çalışır.');
    expect(fixed).toContain('>Toplam<');
    expect(fixed).toContain('Tüm projelerde aynı anda çalışan en fazla iş');
    expect(fixed).toMatch(/<button[^>]*aria-pressed="true"[^>]*>Sabit<\/button>/);
    expect(fixed).not.toContain('data-dispatch-machine');
    expect(fixed).not.toContain('data-dispatch-status');
  });

  it('U-70: before the first read there is no form to edit, only the read failure when it failed', async () => {
    const pending = createDispatchSettingsStore({ read: () => new Promise(() => undefined), write: () => Promise.resolve({ ok: true }) });
    const waiting = render(pending);
    expect(waiting).toContain('data-dispatch-loading');
    expect(waiting).not.toContain('data-step=');
    const failed = createDispatchSettingsStore({ read: () => Promise.resolve({ ok: false, code: 'definitions_invalid' }), write: () => Promise.resolve({ ok: true }) });
    await failed.load();
    const html = render(failed);
    expect(html).toContain('data-dispatch-loading');
    expect(html).toContain('role="alert"');
    expect(html).not.toContain('data-step=');
  });

  it('U-70: the copy follows the locale', async () => {
    const html = render(await loaded(), 'en');
    expect(html).toContain('>Automatic<');
    expect(html).toContain('>Cap<');
    expect(html).toContain('Back to default');
  });
});

describe('U-71: validation message and steppers', () => {
  it('U-71: per-repo above the cap shows the backend rule inline and disables Kaydet', async () => {
    const html = render(await loaded({ global: 2, perRepo: 5 }));
    expect(html).toContain('Depo başına sınır tavandan büyük olamaz.');
    expect(button(html, 'Kaydet')).toContain('disabled=""');
    expect(html).toContain('data-step-bad="perRepo"');
  });

  it('U-71: an account limit above the cap names the account row as the bad one', async () => {
    const html = render(await loaded({ global: 2, perRepo: 1, perAccount: { a1: 5 } }));
    expect(html).toContain('Hesap sınırı tavandan büyük olamaz.');
    expect(html).toContain('data-step-bad="acc:a1"');
  });

  it('U-71: a valid form shows no message and the cap stepper stops at 16', async () => {
    const html = render(await loaded({ global: 16, perRepo: 3 }));
    expect(html).not.toContain('olamaz.');
    expect(html).toMatch(/<button[^>]*data-step="global"[^>]*data-dir="1"[^>]*disabled/);
  });
});

describe('U-72: machine row', () => {
  it('U-72: the facts, the suggested cap and Öneriyi uygula', async () => {
    const html = render(await loaded());
    expect(html).toContain('10 çekirdek · 16 GB bellek · önerilen tavan');
    expect(html).toContain('>6<');
    expect(button(html, 'Öneriyi uygula')).not.toContain('disabled=""');
  });

  it('U-72: the button is disabled when the cap equals the suggestion; the row is absent without a reading', async () => {
    expect(button(render(await loaded({ suggested: 4 })), 'Öneriyi uygula')).toContain('disabled=""');
    expect(render(await loaded({ suggested: undefined, machine: undefined }))).not.toContain('data-dispatch-machine');
  });
});

describe('U-73: live status card', () => {
  it('U-73: free, reduced and busy each carry their sentence, the load and the lamp band', async () => {
    const free = render(await loaded());
    expect(free).toContain('Şu an etkin: 4 / 4');
    expect(free).toContain('Makine boş');
    expect(free).toContain('yük 0,3');
    expect(free).toContain('data-dispatch-status="free"');

    const reduced = render(await loaded({ status: { mode: 'auto', cap: 4, effective: 2, band: 'reduced', load1: 0.8 } }));
    expect(reduced).toContain('Şu an etkin: 2 / 4');
    expect(reduced).toContain('Makine meşgul');
    expect(reduced).toContain('data-dispatch-status="reduced"');

    const busy = render(await loaded({ status: { mode: 'auto', cap: 4, effective: 2, band: 'busy', load1: 1.4 } }));
    expect(busy).toContain('Makine yoğun, yeni iş başlamıyor');
    expect(busy).toContain('yük 1,4');
  });

  it('U-73: no card without a status, and none with unsaved edits', async () => {
    expect(render(await loaded({ status: undefined }))).not.toContain('data-dispatch-status');
    const store = await loaded();
    store.setGlobal(5);
    expect(render(store)).not.toContain('data-dispatch-status');
  });

  it('U-73: the section polls the status every DISPATCH_POLL_MS while active and stops when it is not', () => {
    expect(SOURCE).toContain('window.setInterval');
    expect(SOURCE).toContain('DISPATCH_POLL_MS');
    expect(SOURCE).toContain('window.clearInterval');
    expect(SOURCE).toContain('store.refresh()');
    expect(SOURCE).toMatch(/if \(!active\) return;/);
  });
});

describe('U-74: accounts, save and reset', () => {
  it('U-74: one row per account with Sınırsız / Sınırlı; a limited one shows its value', async () => {
    const html = render(await loaded({ perAccount: { a1: 2 } }));
    expect(html).toContain('Claude Code · Kişisel');
    expect(html).toContain('Claude Code · İş');
    expect(html.split('>Sınırsız<').length - 1).toBe(2);
    expect(html).toContain('data-step="acc:a1"');
    expect(html).toMatch(/aria-label="Claude Code · Kişisel"[^>]*>(?:(?!<\/div>).)*aria-pressed="true"[^>]*>Sınırlı</s);
  });

  it('U-74: an unlimited row\'s stepper is disabled and dimmed', async () => {
    const html = render(await loaded());
    expect(html).toMatch(/data-step-off="acc:a2"/);
  });

  it('U-74: Kaydet and Varsayılana dön are disabled on an unchanged default form', async () => {
    const html = render(await loaded());
    expect(button(html, 'Kaydet')).toContain('disabled=""');
    expect(button(html, 'Varsayılana dön')).toContain('disabled=""');
  });

  it('U-74: an edited form enables Kaydet; a non-default form enables Varsayılana dön', async () => {
    const store = await loaded();
    store.setGlobal(5);
    const html = render(store);
    expect(button(html, 'Kaydet')).not.toContain('disabled=""');
    const other = render(await loaded({ global: 8 }));
    expect(button(other, 'Varsayılana dön')).not.toContain('disabled=""');
  });

  it("U-74: a refused save is said inline in the refusal's own sentence", async () => {
    const store = createDispatchSettingsStore({ read: () => Promise.resolve(reply()), write: () => Promise.resolve({ ok: false, code: 'unknown_account' }) });
    await store.load();
    store.setGlobal(5);
    await store.save(null);
    expect(render(store)).toContain('Sınır verilen hesaplardan biri artık yok');
  });

  it('U-74: Kaydedildi sits next to the section title in the panel head, from the store, not a timer', () => {
    expect(PANEL_SOURCE).toContain("'dispatch.saved'");
    expect(PANEL_SOURCE).toContain('justSaved');
  });
});

describe('the section geometry', () => {
  it('U-70: no px length but hairlines, radii only from the tokens, a visible focus ring, no pointer-style cursor classes', () => {
    expect(SOURCE.match(/\[\d*\.?\d+px\]/g) ?? []).toEqual([]);
    const radii = SOURCE.match(/rounded(?:-[a-z]+)?(?![\w-])/g) ?? [];
    for (const radius of radii) expect(['rounded-full', 'rounded-control', 'rounded-card', 'rounded-panel']).toContain(radius);
    expect(SOURCE).toContain('focus-visible:outline');
    expect(SOURCE).toContain('motion-reduce:');
    expect(SOURCE).not.toMatch(/cursor/i);
  });
});
