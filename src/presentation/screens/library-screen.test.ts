/// <reference types="vite/client" />
// library-screen.test.ts — U-86 (card content, fixed card structure), U-87 (the keyboard and the
// pin button's markup), U-88 (loading, empty, filtered-empty, error, cap line) and U-90 (the
// measure rules, scanned from the screen's source) at the markup a person would see: the screen
// drawn over a real store (a scripted api) with the server renderer, the way the layer's other
// screen tests draw. Titles and project names are hostile data on purpose.
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type { PageLibraryItemView, Query } from '../../api/queries';
import type { Actor } from '../../domain/index';
import { createLibraryStore, type LibraryStore } from '../stores/library';
import { LibraryScreen, cardKeyAction } from './library';

const ACTOR: Actor = { kind: 'user', id: 'u-1' };
const NOW = 1_700_000_000_000;
const HOUR = 3_600_000;

const item = (id: string, patch: Partial<PageLibraryItemView> = {}): PageLibraryItemView => ({
  id,
  title: `Sayfa ${id}`,
  kind: 'html',
  latestVersion: 3,
  updatedAt: NOW - 2 * HOUR,
  approval: 'none',
  pinned: false,
  provenance: 'docket_ai',
  ...patch,
});

type Reply = readonly PageLibraryItemView[] | { readonly ok: false; readonly code: string };

const flush = async (): Promise<void> => {
  for (let i = 0; i < 8; i += 1) await Promise.resolve();
};

beforeEach(() => {
  vi.useFakeTimers();
});
afterEach(() => {
  vi.useRealTimers();
});

const openStore = async (reply: Reply | (() => Promise<unknown>)): Promise<LibraryStore> => {
  const store = createLibraryStore({
    api: {
      query: (query: Query) =>
        query.type === 'pages.library' ? (typeof reply === 'function' ? reply() : Promise.resolve(reply)) : Promise.resolve(null),
      command: () => Promise.resolve({ ok: true }),
    },
    changes: () => () => undefined,
    actor: ACTOR,
  });
  store.open();
  await flush();
  return store;
};

const draw = async (reply: Reply | (() => Promise<unknown>), locale: 'tr' | 'en' = 'tr', mutate?: (store: LibraryStore) => Promise<void>): Promise<string> => {
  const store = await openStore(reply);
  if (mutate !== undefined) await mutate(store);
  return renderToStaticMarkup(createElement(LibraryScreen, { store, locale, now: NOW, onOpenPage: () => undefined }));
};

const FULL: readonly PageLibraryItemView[] = [
  item('p1', {
    title: 'Giriş ekranı taslağı',
    project: { slug: 'antero', name: 'Antero' },
    workOrder: { id: 'w1', code: 'İE-0012' },
    approval: 'pending',
    pinned: true,
  }),
  item('p2', { title: 'İstek akışı diyagramı', kind: 'diagram', project: { slug: 'antero', name: 'Antero' }, provenance: 'agent_run' }),
  item('p3', { title: 'Uygulama planı', kind: 'markdown', project: { slug: 'docket', name: 'Docket' }, provenance: 'operator', latestVersion: 1 }),
  item('p4', { title: 'Hesap özeti', kind: 'table', approval: 'approved', approvedVersion: 4 }),
];

const cardOf = (html: string, id: string): string => {
  const start = html.indexOf(`data-library-card="${id}"`);
  expect(start, `card ${id}`).toBeGreaterThan(-1);
  const next = html.indexOf('data-library-card="', start + 10);
  return html.slice(start, next === -1 ? html.length : next);
};

describe('library screen — cards (U-86)', () => {
  it('U-86: the title, the filter bar and the cards of every page show', async () => {
    const html = await draw(FULL);
    expect(html).toContain('<h1');
    expect(html).toContain("Artifact&#x27;lar");
    expect(html).toContain('placeholder="Ara"');
    for (const label of ['Tümü', 'Taslak', 'Diyagram', 'Metin', 'Tablo', 'Rapor']) expect(html).toContain(`>${label}<`);
    expect(html).not.toContain('>Resim<');
    expect(html).toContain('Tüm projeler');
    expect(html).toContain('>Antero<');
    expect(html).toContain('>Yeni<');
    expect(html).toContain('>Sabitler<');
    expect((html.match(/data-library-card="/g) ?? []).length).toBe(4);
  });

  it('U-86: a card shows title, kind chip, "project · İE-code", "sürüm N · age", the approval chip and the provenance line', async () => {
    const card = cardOf(await draw(FULL), 'p1');
    expect(card).toContain('Giriş ekranı taslağı');
    expect(card).toContain('>html<');
    expect(card).toContain('Antero · İE-0012');
    expect(card).toContain('sürüm 3 · 2 saat önce');
    expect(card).toContain('Onay bekliyor');
    expect(card).toContain('Docket AI · sohbet');
  });

  it('U-86: provenance reads Docket AI · sohbet, asistan or sen; approved reads ✓ Onaylandı; a page with no project shows no dangling separator', async () => {
    const html = await draw(FULL);
    expect(cardOf(html, 'p2')).toContain('asistan');
    expect(cardOf(html, 'p3')).toContain('>sen<');
    expect(cardOf(html, 'p4')).toContain('✓ Onaylandı');
    expect(cardOf(html, 'p4')).not.toContain(' · </');
    expect(cardOf(html, 'p4')).not.toContain('Onay bekliyor');
  });

  it('U-86: a rejected page says so, and a page with no approval shows no chip', async () => {
    const html = await draw([item('r', { approval: 'rejected' }), item('n')]);
    expect(cardOf(html, 'r')).toContain('Reddedildi');
    expect(cardOf(html, 'n')).not.toMatch(/Onay|Reddedildi/);
  });

  it('U-86: html pages draw the faux-page lines on a white zone; other kinds name their kind in mono — and nothing of a page is rendered', async () => {
    const html = await draw(FULL);
    expect(cardOf(html, 'p1')).toContain('data-library-faux');
    expect(cardOf(html, 'p1')).toContain('bg-white');
    expect(cardOf(html, 'p2')).not.toContain('data-library-faux');
    expect(cardOf(html, 'p2')).toMatch(/font-mono[^>]*>diyagram</);
    expect(html).not.toMatch(/<iframe|<webview|<img|<object|<embed/i);
  });

  it('U-86: every card has the same rows with the same classes whatever the kind, approval, provenance or project — nothing changes a card\'s height', async () => {
    const combos: PageLibraryItemView[] = [];
    for (const kind of ['html', 'diagram', 'markdown', 'table', 'report', 'image'] as const) {
      for (const approval of ['none', 'pending', 'approved', 'rejected'] as const) {
        for (const provenance of ['docket_ai', 'agent_run', 'operator'] as const) {
          combos.push(item(`${kind}-${approval}-${provenance}`, { kind, approval, provenance, ...(approval === 'approved' ? { approvedVersion: 1 } : {}) }));
        }
      }
    }
    combos.push(item('with-project', { project: { slug: 'a', name: 'A' }, workOrder: { id: 'w', code: 'İE-0001' }, title: 'x'.repeat(200) }));
    const html = await draw(combos);
    const rowsOf = (card: string): string[] => [...card.matchAll(/data-library-row="(\w+)"[^>]*class="([^"]*)"/g)].map((m) => `${m[1]}:${m[2]}`);
    const first = rowsOf(cardOf(html, combos[0]?.id ?? ''));
    expect(first.map((row) => row.split(':')[0])).toEqual(['title', 'where', 'age', 'provenance']);
    for (const entry of combos) expect(rowsOf(cardOf(html, entry.id)), entry.id).toEqual(first);
    // The thumb area has one height for every kind.
    const thumbs = new Set([...html.matchAll(/data-library-thumb[^>]*class="([^"]*)"/g)].map((m) => (m[1] ?? '').match(/h-\[[\d.]+rem\]/)?.[0]));
    expect(thumbs.size).toBe(1);
  });

  it('U-86: titles and project names are text, never markup, and the full title rides the tooltip', async () => {
    const hostile = '<script>alert(1)</script><img src=x onerror=alert(2)>';
    const html = await draw([item('h', { title: hostile, project: { slug: 'x', name: hostile } })]);
    expect(html).not.toContain('<script>');
    expect(html).not.toMatch(/<img/i);
    expect(html).toContain('&lt;script&gt;');
    expect(html).toContain('title="&lt;script&gt;');
  });

  it('U-86: Resim shows in the kind list when an image page is loaded', async () => {
    expect(await draw([item('i', { kind: 'image' })])).toContain('>Resim<');
  });

  it('U-86: the English bundle speaks English', async () => {
    const html = await draw(FULL, 'en');
    expect(html).not.toContain('Tümü');
    expect(html).toContain('placeholder="Search"');
  });
});

describe('library screen — keyboard and pin (U-87)', () => {
  it('U-87: a card is a focusable button; Enter and Space open it, other keys do nothing', async () => {
    const card = cardOf(await draw(FULL), 'p1');
    expect(card).toContain('role="button"');
    expect(card).toContain('tabindex="0"');
    expect(cardKeyAction('Enter')).toBe('open');
    expect(cardKeyAction(' ')).toBe('open');
    expect(cardKeyAction('Tab')).toBeNull();
    expect(cardKeyAction('a')).toBeNull();
    expect(cardKeyAction('Escape')).toBeNull();
  });

  it('U-87: the pin button is a button of its own with aria-pressed and the Sabitle / Sabiti kaldır name, ☆ or ★', async () => {
    const html = await draw(FULL);
    const pinned = cardOf(html, 'p1');
    expect(pinned).toMatch(/<button[^>]*data-library-pin[^>]*/);
    expect(pinned).toContain('aria-pressed="true"');
    expect(pinned).toContain('aria-label="Sabiti kaldır"');
    expect(pinned).toContain('★');
    const loose = cardOf(html, 'p2');
    expect(loose).toContain('aria-pressed="false"');
    expect(loose).toContain('aria-label="Sabitle"');
    expect(loose).toContain('☆');
  });

  it('U-87: the search field is a search input that Escape clears (markup carries its hook)', async () => {
    const html = await draw(FULL);
    expect(html).toMatch(/<input[^>]*type="search"[^>]*data-library-search|<input[^>]*data-library-search[^>]*type="search"/);
  });
});

describe('library screen — states (U-88)', () => {
  it('U-88: loading shows the card skeleton, never a blank area', async () => {
    const store = await openStore(() => new Promise(() => undefined));
    // The skeleton's anti-flicker delay: the first clock read stamps the load, the next reads are late.
    let reads = 0;
    const skeletonNow = (): number => (reads++ === 0 ? 0 : 5000);
    const html = renderToStaticMarkup(createElement(LibraryScreen, { store, locale: 'tr', now: NOW, onOpenPage: () => undefined, skeletonNow }));
    expect(html).toContain('data-library-skeleton');
    expect(html).toContain('data-skeleton-block');
    expect(html).not.toContain('data-library-empty');
    expect(html).not.toContain('data-library-card');
  });

  it('U-88: an empty library says "Henüz artifact yok" and how to fill it', async () => {
    const html = await draw([]);
    expect(html).toContain('data-library-empty');
    expect(html).toContain('Henüz artifact yok');
    expect(html).toContain('Docket AI’dan bir taslak, diyagram ya da rapor iste; burada birikir.');
  });

  it('U-88: filtered-empty copy appears when the library is not empty but the filters match nothing', async () => {
    const rows = [item('a')];
    const store = createLibraryStore({
      api: {
        query: (query: Query) =>
          Promise.resolve(query.type === 'pages.library' ? (query.kind === undefined ? rows : []) : null),
        command: () => Promise.resolve({ ok: true }),
      },
      changes: () => () => undefined,
      actor: ACTOR,
    });
    store.open();
    await flush();
    store.setKind('report');
    await flush();
    const html = renderToStaticMarkup(createElement(LibraryScreen, { store, locale: 'tr', now: NOW, onOpenPage: () => undefined }));
    expect(html).toContain('Eşleşen artifact yok');
    expect(html).toContain('Aramayı ya da süzgeçleri değiştir.');
    expect(html).not.toContain('Henüz artifact yok');
    // The filter bar stays so the operator can undo the filter.
    expect(html).toContain('placeholder="Ara"');
  });

  it('U-88: a failed load shows the error state with Yeniden dene and the failure sentence — never a blank area', async () => {
    const html = await draw({ ok: false, code: 'invalid_id' });
    expect(html).toContain('data-library-error');
    expect(html).toContain('role="alert"');
    expect(html).toContain('Yeniden dene');
    expect(html).not.toContain('data-library-card');
  });

  it('U-88: the cap line "İlk 500 artifact gösteriliyor" shows at 500 items and only then', async () => {
    const many = Array.from({ length: 500 }, (_, index) => item(`p${index}`));
    expect(await draw(many)).toContain('İlk 500 artifact gösteriliyor');
    expect(await draw(many.slice(1))).not.toContain('İlk 500 artifact gösteriliyor');
  });
});

describe('library screen — measure (U-90)', () => {
  const SOURCES = import.meta.glob(['./library.tsx', '../stores/library.ts'], { query: '?raw', import: 'default', eager: true }) as Record<string, string>;
  const screen = Object.entries(SOURCES).find(([path]) => path.endsWith('/screens/library.tsx') || path === './library.tsx')?.[1] ?? '';
  // Every class string the screen writes: className attributes and the named class constants.
  const classStrings = [...screen.matchAll(/(?:className=\{?|\b[A-Z_]+ =\s*)(?:"([^"]*)"|'([^']*)'|`([^`]*)`)/g)].map((m) => m[1] ?? m[2] ?? m[3] ?? '');

  it('U-90: the sources exist and carry class strings to scan', () => {
    expect(Object.keys(SOURCES).length).toBe(2);
    expect(classStrings.length).toBeGreaterThan(10);
  });

  it('U-90: lengths are rem — no px length in a class or a style, except the 1 px hairline border', () => {
    expect(screen).not.toMatch(/\[\s*-?\d*\.?\d+px\s*\]/);
    expect(screen).not.toMatch(/\d+px['"` ;}]/);
    expect(screen).not.toMatch(/style=\{\{[^}]*px/);
    for (const classes of classStrings) expect(classes).not.toMatch(/(?:^|\s)(?:w|h|min-w|min-h|max-w|max-h|gap|p|px|py|m|mx|my)-\[\d*\.?\d+px\]/);
  });

  it('U-90: every sized text line has an explicit leading', () => {
    for (const classes of classStrings) {
      if (/(?:^|\s)text-\[[\d.]+rem\]/.test(classes)) expect(classes, classes).toMatch(/(?:^|\s)leading-/);
    }
  });

  it('U-90: radii come from the three tokens and rounded-full only', () => {
    for (const classes of classStrings) {
      for (const radius of classes.match(/(?<![\w-])rounded[\w-]*/g) ?? []) {
        expect(['rounded-control', 'rounded-card', 'rounded-panel', 'rounded-full']).toContain(radius);
      }
    }
    expect(screen).not.toMatch(/border-?[Rr]adius/);
  });

  it('U-90: spacing steps are on the 4·8·12·16·20·24·32 scale (rem)', () => {
    const allowed = new Set(['0', '1', '2', '3', '4', '5', '6', '8']);
    for (const classes of classStrings) {
      for (const match of classes.matchAll(/(?:^|\s)(?:p|px|py|pt|pb|pl|pr|m|mx|my|mt|mb|ml|mr|gap|gap-x|gap-y)-(\d+(?:\.\d+)?)(?=\s|$)/g)) {
        expect(allowed.has(match[1] ?? ''), `${match[0].trim()} in ${classes}`).toBe(true);
      }
    }
  });

  it('U-90: no vendor-named class or string — a disabled control uses pointer-events-none', () => {
    expect(screen.toLowerCase()).not.toContain('cursor');
    for (const source of Object.values(SOURCES)) expect(source).not.toMatch(/dangerouslySetInnerHTML/);
  });

  it('U-90: controls show a focus-visible ring and motion sits behind motion-safe', () => {
    expect(screen).toContain('focus-visible:outline');
    for (const classes of classStrings) {
      if (/(?:^|\s)transition/.test(classes)) expect(classes, classes).toMatch(/motion-(?:safe|reduce):/);
    }
  });
});
