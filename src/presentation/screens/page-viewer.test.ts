/// <reference types="vite/client" />
// page-viewer.test.ts (screen) — U-76 … U-79 and U-82 at the markup a person would see: the page
// screen drawn over a real store (a scripted api) with the server renderer, the way the layer's
// other screen tests draw. Page text is hostile data here on purpose: markup inside a diff line,
// a comment or a title must come out escaped, and no address of a page ever reaches the DOM.
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';

import type { Api } from '../../api/api';
import type { PageDetailView, PageListItem, Query } from '../../api/queries';
import type { Actor } from '../../domain/index';

import { createPageViewerStore, type PageViewHost, type PageViewStatus } from '../stores/page-viewer';
import { PageViewerScreen } from './page-viewer';

const ACTOR: Actor = { kind: 'user', id: 'u-1' };
const PAGE = '01ARZ3NDEKTSV4RRFFQ69G5FAA';
const NOW = 1_700_000_000_000;
const HOUR = 3_600_000;

const base = (patch: Partial<PageListItem> = {}): PageListItem => ({
  id: PAGE,
  title: 'Giriş ekranı taslağı',
  kind: 'html',
  latestVersion: 2,
  approval: 'pending',
  updatedAt: NOW - 2 * HOUR,
  createdBy: { kind: 'agent', label: 'builder' },
  undeliveredComments: 1,
  ...patch,
});

const detail = (
  patch: {
    readonly latest?: number;
    readonly shown?: number;
    readonly item?: Partial<PageListItem>;
    readonly diff?: PageDetailView['diff'];
    readonly gate?: PageDetailView['gate'];
    readonly comments?: PageDetailView['comments'];
  } = {},
): PageDetailView => {
  const latest = patch.latest ?? 2;
  return {
    page: {
      ...base({ latestVersion: latest, ...patch.item }),
      versions: Array.from({ length: latest }, (_, index) => ({
        n: index + 1,
        createdAt: NOW - (latest - index) * HOUR,
        by: { kind: 'agent' as const, label: 'builder' },
        entry: 'index.html',
        files: [{ path: 'index.html', bytes: 10 }],
      })),
    },
    version: patch.shown ?? latest,
    comments: patch.comments ?? [],
    ...(patch.diff === undefined ? {} : { diff: patch.diff }),
    ...(patch.gate === undefined ? {} : { gate: patch.gate }),
  };
};

const fakeHost = (status: PageViewStatus = 'idle'): PageViewHost & { readonly updates: unknown[] } => {
  const updates: unknown[] = [];
  return {
    updates,
    update: (target) => {
      updates.push(target);
    },
    retry: () => undefined,
    state: () => ({ status }),
    subscribe: () => () => undefined,
    dispose: () => undefined,
  };
};

const draw = async (
  reply: PageDetailView,
  options: { readonly mode?: 'diff'; readonly host?: PageViewHost; readonly locale?: 'tr' | 'en'; readonly overlayOpen?: boolean } = {},
): Promise<string> => {
  const api: Pick<Api, 'query' | 'command'> = {
    query: (query: Query) => Promise.resolve(query.type === 'page.detail' ? reply : null),
    command: () => Promise.resolve({ ok: true }),
  };
  const store = createPageViewerStore({ api, changes: () => () => undefined, actor: ACTOR });
  await store.open(PAGE);
  // A reply for an older version is what the api answers once the operator chose it.
  if (reply.version !== reply.page.latestVersion) await store.select(reply.version);
  if (options.mode === 'diff') store.setMode('diff');
  const html = renderToStaticMarkup(
    createElement(PageViewerScreen, {
      store,
      host: options.host ?? fakeHost(),
      pageId: PAGE,
      locale: options.locale ?? 'tr',
      overlayOpen: options.overlayOpen ?? false,
      now: NOW,
      onBack: () => undefined,
    }),
  );
  return html;
};

const HOSTILE = '<script>alert(1)</script><img src="x" onerror="alert(2)">';

describe('page screen — header and stage (U-76)', () => {
  it('U-76: the header carries title, kind chip, author, version with age and the approval chip', async () => {
    const html = await draw(detail());
    const header = html.slice(html.indexOf('data-page-header'), html.indexOf('data-page-stage'));
    expect(header).toContain('Giriş ekranı taslağı');
    expect(header).toContain('html');
    expect(header).toContain('builder');
    expect(header).toContain('sürüm 2 · 1 saat önce');
    expect(header).toContain('Onay bekliyor');
  });

  it('U-76: the guard strip is always there — in Önizleme and in Fark — and says the page is untrusted', async () => {
    for (const mode of [undefined, 'diff'] as const) {
      const html = await draw(detail({ diff: { against: 1, lines: [{ kind: 'add', text: 'x' }] } }), { mode });
      expect(html).toContain('data-page-guard');
      expect(html).toContain('izole');
      expect(html).toContain('güvenilmez içerik');
    }
  });

  it('U-76: Önizleme reserves the rectangle the native view will fill and puts no page into Docket\'s own DOM', async () => {
    const html = await draw(detail());
    expect(html).toContain('data-page-stage-body');
    expect(html).toContain('aria-label="Sayfa önizlemesi"');
    expect(html).not.toMatch(/<iframe|<webview|<object|<embed/i);
    expect(html).not.toContain('docket-page:');
    expect(html).not.toMatch(/\bsrc=|\bhref=/);
  });

  it('U-76: an error from the host shows "Sayfa gösterilemedi" with Yeniden dene — never a blank stage', async () => {
    const html = await draw(detail(), { host: fakeHost('error') });
    expect(html).toContain('data-page-error');
    expect(html).toContain('Sayfa gösterilemedi');
    expect(html).toContain('Yeniden dene');
    expect(await draw(detail())).not.toContain('data-page-error');
  });

  it('U-76: Fark reserves no stage rectangle at all — the native view has nowhere to be', async () => {
    const lines = { against: 1, lines: [{ kind: 'add' as const, text: 'x' }] };
    expect(await draw(detail({ diff: lines }), { mode: 'diff' })).not.toContain('data-page-stage-body');
  });

  it('U-76: an unknown page is a stated problem with a way back, not an empty screen', async () => {
    const api: Pick<Api, 'query' | 'command'> = {
      query: () => Promise.resolve({ ok: false, code: 'not_found' }),
      command: () => Promise.resolve({ ok: true }),
    };
    const store = createPageViewerStore({ api, changes: () => () => undefined, actor: ACTOR });
    await store.open(PAGE);
    const html = renderToStaticMarkup(
      createElement(PageViewerScreen, { store, host: fakeHost(), pageId: PAGE, locale: 'tr', overlayOpen: false, now: NOW, onBack: () => undefined }),
    );
    expect(html).toContain('role="alert"');
    expect(html).toContain('Kayıt bulunamadı.');
    expect(html).toContain('‹ Geri');
  });
});

describe('page screen — tools and Fark (U-77)', () => {
  it('U-77: the version selector lists newest first and marks the latest "(son)"', async () => {
    const html = await draw(detail({ latest: 3 }));
    const select = html.slice(html.indexOf('data-page-version'), html.indexOf('</select>'));
    expect(select.indexOf('Sürüm 3 (son)')).toBeGreaterThan(-1);
    expect(select.indexOf('Sürüm 3 (son)')).toBeLessThan(select.indexOf('Sürüm 2'));
    expect(select.indexOf('Sürüm 2')).toBeLessThan(select.indexOf('Sürüm 1'));
    expect(select).not.toContain('Sürüm 2 (son)');
  });

  it('U-77: Fark renders every line as text with the two gutters: − on removals, + on additions', async () => {
    const html = await draw(
      detail({
        diff: {
          against: 1,
          lines: [
            { kind: 'same', text: '<form class="login">' },
            { kind: 'remove', text: '  <button class="muted">Giriş</button>' },
            { kind: 'add', text: '  <button class="primary">Giriş</button>' },
          ],
        },
      }),
      { mode: 'diff' },
    );
    const diff = html.slice(html.indexOf('data-page-diff'));
    expect(diff).toContain('data-diff-line="same"');
    expect(diff).toContain('data-diff-line="remove"');
    expect(diff).toContain('data-diff-line="add"');
    // Text, escaped — the markup in a line is shown, not parsed.
    expect(diff).toContain('&lt;form class=&quot;login&quot;&gt;');
    expect(diff).not.toContain('<form');
    expect(diff).not.toContain('<button class="primary"');
    // Gutter glyphs: the minus is the real minus sign, the plus the plus sign, once each.
    expect(diff.match(/>−</g)).toHaveLength(1);
    expect(diff.match(/>\+</g)).toHaveLength(1);
    // The tints come from tokens, the lines keep their spaces.
    expect(diff).toMatch(/data-diff-line="add"[^>]*bg-proceed/);
    expect(diff).toMatch(/data-diff-line="remove"[^>]*bg-error/);
    expect(diff).toContain('whitespace-pre');
  });

  it('U-77: hostile diff text cannot become markup', async () => {
    const html = await draw(detail({ diff: { against: 1, lines: [{ kind: 'add', text: HOSTILE }] } }), { mode: 'diff' });
    expect(html).not.toContain('<script');
    expect(html).not.toContain('<img');
    expect(html).toContain('&lt;script&gt;alert(1)&lt;/script&gt;');
  });

  it('U-77: a shortened diff says "Fark kısaltıldı"; a complete one says nothing', async () => {
    const lines = [{ kind: 'add' as const, text: 'x' }];
    expect(await draw(detail({ diff: { against: 1, lines, truncated: true } }), { mode: 'diff' })).toContain('Fark kısaltıldı');
    expect(await draw(detail({ diff: { against: 1, lines } }), { mode: 'diff' })).not.toContain('Fark kısaltıldı');
  });

  it('U-77: without a diff the Fark button is disabled with its reason on the tooltip — version 1 and images differ', async () => {
    const first = await draw(detail({ latest: 1 }));
    expect(first).toMatch(/<button[^>]*data-page-view="diff"[^>]*disabled/);
    expect(first).toContain('title="Karşılaştırılacak önceki sürüm yok"');
    const image = await draw(detail({ item: { kind: 'image' } }));
    expect(image).toContain('title="Resimlerde fark gösterilmez"');
    // With a diff it is enabled and carries no tooltip reason.
    const enabled = await draw(detail({ diff: { against: 1, lines: [{ kind: 'add', text: 'x' }] } }));
    expect(enabled).not.toMatch(/<button[^>]*data-page-view="diff"[^>]*disabled/);
    expect(enabled).not.toContain('Karşılaştırılacak önceki sürüm yok');
  });

  it('U-77: the two modes are a pressed pair — Önizleme pressed by default, Fark when chosen', async () => {
    const lines = { against: 1, lines: [{ kind: 'add' as const, text: 'x' }] };
    const preview = await draw(detail({ diff: lines }));
    expect(preview).toMatch(/data-page-view="preview"[^>]*aria-pressed="true"/);
    expect(preview).toMatch(/data-page-view="diff"[^>]*aria-pressed="false"/);
    const diff = await draw(detail({ diff: lines }), { mode: 'diff' });
    expect(diff).toMatch(/data-page-view="diff"[^>]*aria-pressed="true"/);
  });
});

describe('page screen — comments rail (U-78)', () => {
  const comments = [
    { id: 'a', version: 1, text: 'Eski sürüm yorumu', at: NOW - 30 * HOUR, delivered: true },
    { id: 'b', version: 2, text: 'Giriş düğmesi çok soluk', at: NOW - 2 * HOUR, delivered: false },
    { id: 'c', version: 2, text: HOSTILE, at: NOW - HOUR, delivered: true },
  ];

  it('U-78: the rail lists only the shown version\'s comments, with the count in its header', async () => {
    const html = await draw(detail({ comments }));
    const rail = html.slice(html.indexOf('data-page-rail'));
    expect(rail).toContain('sürüm 2 · 2');
    expect(rail).toContain('Giriş düğmesi çok soluk');
    expect(rail).not.toContain('Eski sürüm yorumu');
  });

  it('U-78: each comment shows "Sen · age" and its delivery state — amber while unread, green once delivered', async () => {
    const html = await draw(detail({ comments }));
    const unread = html.slice(html.indexOf('Giriş düğmesi çok soluk'));
    expect(html).toContain('Sen · 2 saat önce');
    expect(html).toMatch(/data-page-comment="b"[^>]*data-delivered="false"/);
    expect(html).toMatch(/data-page-comment="c"[^>]*data-delivered="true"/);
    expect(unread).toContain('asistana iletilmedi');
    expect(html).toContain('asistana iletildi');
    expect(html).toMatch(/data-delivery="false"[^>]*text-signal/);
    expect(html).toMatch(/data-delivery="true"[^>]*text-proceed/);
  });

  it('U-78: comment text is plain text — pre-wrapped, escaped, never a link', async () => {
    const html = await draw(detail({ comments }));
    expect(html).not.toContain('<script');
    expect(html).not.toContain('<img');
    expect(html).toContain('&lt;script&gt;alert(1)&lt;/script&gt;');
    expect(html).toContain('whitespace-pre-wrap');
    const rail = html.slice(html.indexOf('data-page-rail'));
    expect(rail).not.toMatch(/<a[\s>]/);
  });

  it('U-78: a version without comments says so and what a comment does', async () => {
    const html = await draw(detail());
    expect(html).toContain('Bu sürümde yorum yok.');
    expect(html).toContain('Yorumların asistana ulaşır, o da yeni sürüm yayınlar.');
  });

  it('U-78: the latest version has the composer — 4000 limit, hint, a disabled Yorum ekle while empty', async () => {
    const html = await draw(detail());
    expect(html).toContain('data-page-composer');
    expect(html).toMatch(/<textarea[^>]*maxLength="4000"/);
    expect(html).toContain('Yorumunu asistan bir sonraki turda okur; sayfanın içeriği asistana talimat vermez.');
    expect(html).toMatch(/<button[^>]*data-page-submit[^>]*disabled/);
    expect(html).toContain('Yorum ekle');
    // The counter appears only from 3500 characters.
    expect(html).not.toContain('data-page-counter');
  });

  it('U-78: an older version has no composer, only the hint to switch to the latest', async () => {
    const html = await draw(detail({ latest: 2, shown: 1 }));
    expect(html).not.toContain('<textarea');
    expect(html).toContain('Eski sürüme yorum eklenmez. Son sürüme geç.');
  });
});

describe('page screen — approval bar (U-79)', () => {
  const buttons = (html: string): string[] => {
    const bar = html.slice(html.indexOf('data-page-bar'), html.indexOf('data-page-rail'));
    return [...bar.matchAll(/data-page-action="(\w+)"/g)].map((match) => match[1]);
  };

  it('U-79: pending on the latest shows Reddet (ghost) and Onayla — the page\'s only primary button', async () => {
    const html = await draw(detail({ item: { approval: 'pending' }, gate: { pending: true, gate: 'g' } }));
    expect(buttons(html)).toEqual(['reject', 'approve']);
    expect(html).toContain('Onaylarsan iş emri bir sonraki aşamaya geçer');
    const primaries = html.match(/<button[^>]*\bbg-signal\b[^>]*>/g) ?? [];
    expect(primaries).toHaveLength(1);
    expect(primaries[0]).toContain('data-page-action="approve"');
    expect(html).toMatch(/<button[^>]*text-inkdim[^>]*data-page-action="reject"/);
  });

  it('U-79: without a gate the reason reads "Onaylarsan sayfa onaylı işaretlenir"', async () => {
    const html = await draw(detail({ item: { approval: 'pending' } }));
    expect(html).toContain('Onaylarsan sayfa onaylı işaretlenir');
  });

  it('U-79: none and rejected offer Onay iste as the one secondary button', async () => {
    for (const approval of ['none', 'rejected'] as const) {
      const html = await draw(detail({ item: { approval } }));
      expect(buttons(html), approval).toEqual(['request']);
      expect(html).toContain('Onay iste');
      expect(html).not.toMatch(/<button[^>]*\bbg-signal\b[^>]*data-page-action/);
      expect(html).toContain('Asistan yeni sürüm yayınlayınca onay isteyebilirsin');
    }
  });

  it('U-79: approved shows no button, the chip with the approved version and the sentence', async () => {
    const html = await draw(detail({ item: { approval: 'approved', approvedVersion: 2 } }));
    expect(buttons(html)).toEqual([]);
    expect(html).toContain('✓ Onaylandı · sürüm 2');
    expect(html).toContain('Bu sürüm onaylı');
  });

  it('U-79: an older version disables every action and says why', async () => {
    const html = await draw(detail({ latest: 2, shown: 1, item: { approval: 'pending' } }));
    const bar = html.slice(html.indexOf('data-page-bar'), html.indexOf('data-page-rail'));
    expect(buttons(html)).toEqual(['reject', 'approve']);
    expect(bar.match(/<button[^>]*disabled/g)).toHaveLength(2);
    expect(bar).toContain('Eski sürüm: onay işlemleri yalnızca son sürümde');
  });

  it('U-81: the new-version note shows after a newer version reset the approval, and not on an ordinary page', async () => {
    expect(await draw(detail())).not.toContain('data-page-note');
    let reply = detail({ latest: 2, item: { approval: 'pending' } });
    const api: Pick<Api, 'query' | 'command'> = {
      query: () => Promise.resolve(reply),
      command: () => Promise.resolve({ ok: true }),
    };
    const listeners = new Set<(change: { readonly type: 'workOrders.changed' }) => void>();
    const store = createPageViewerStore({
      api,
      changes: (listener) => {
        listeners.add(listener);
        return () => listeners.delete(listener);
      },
      actor: ACTOR,
    });
    await store.open(PAGE);
    reply = detail({ latest: 3, item: { approval: 'none' } });
    for (const listener of listeners) listener({ type: 'workOrders.changed' });
    for (let i = 0; i < 6; i += 1) await Promise.resolve();
    const html = renderToStaticMarkup(
      createElement(PageViewerScreen, { store, host: fakeHost(), pageId: PAGE, locale: 'tr', overlayOpen: false, now: NOW, onBack: () => undefined }),
    );
    expect(html).toContain('data-page-note');
    expect(html).toContain('Yeni sürüm geldi, önceki onay geçersiz. Beğenirsen yeniden onay iste.');
  });
});

describe('page screen — copy and locale', () => {
  it('U-76: English is a peer locale — the same screen speaks it, with no Turkish left in the strip or the bar', async () => {
    const html = await draw(detail({ item: { approval: 'pending' } }), { locale: 'en' });
    expect(html).toContain('untrusted content');
    expect(html).toContain('Approve');
    expect(html).toContain('Comments');
    expect(html).not.toContain('Onayla');
    expect(html).not.toContain('izole');
  });
});

// --- U-82: the new components' lengths, radii and leading ----------------------------------------

const SOURCES = import.meta.glob(['../screens/page-viewer.tsx', '../stores/page-viewer.ts', '../screens/detail.tsx'], {
  query: '?raw',
  import: 'default',
  eager: true,
}) as Record<string, string>;
const source = (name: string): string => {
  const hit = Object.entries(SOURCES).find(([path]) => path.endsWith(`/${name}`));
  if (hit === undefined) throw new Error(`source not globbed: ${name}`);
  return hit[1];
};

describe('page screen — measure rules (U-82)', () => {
  it('U-82: every length of the screen is rem — no px utility, no px arbitrary value; only 1px hairlines are borders', () => {
    const text = source('page-viewer.tsx');
    expect(text).not.toMatch(/\[[\d.]+px\]/);
    expect(text).not.toMatch(/\b(?:p|m|gap|w|h|min-w|min-h|max-w|max-h|text|top|left|right|bottom|space-x|space-y)[xytrbl]?-\[?[\d.]+px/);
    expect(text).not.toMatch(/style=\{\{[^}]*px/);
  });

  it('U-82: corners come from the three tokens and rounded-full only', () => {
    const text = source('page-viewer.tsx');
    const used = new Set([...text.matchAll(/(?<![\w-])rounded(?:-[a-z0-9]+)?(?![\w-])/g)].map((match) => match[0]));
    for (const name of used) expect(['rounded-control', 'rounded-card', 'rounded-panel', 'rounded-full'], name).toContain(name);
    expect(used.size).toBeGreaterThan(0);
  });

  it('U-82: text lines whose height matters carry explicit leading — the chips, the buttons\' rows, the diff, the comments', () => {
    const text = source('page-viewer.tsx');
    expect(text).toMatch(/leading-\[1\.25rem\]/);
    expect(text).toMatch(/leading-\[1rem\]/);
    // Every text-[..rem] utility on the screen is paired with a leading-* in the same class string.
    const classStrings = [...text.matchAll(/className=(?:"([^"]*)"|\{`([^`]*)`\})/g)].map((match) => match[1] ?? match[2] ?? '');
    const sized = classStrings.filter((value) => /\btext-\[[\d.]+rem\]/.test(value));
    expect(sized.length).toBeGreaterThan(5);
    for (const value of sized) expect(value, value).toMatch(/\bleading-/);
  });

  it('U-82: nothing renders page content as markup and nothing names a vendor or a page address', () => {
    const text = source('page-viewer.tsx');
    expect(text).not.toContain('dangerouslySetInnerHTML');
    expect(text).not.toContain('innerHTML');
    expect(text).not.toMatch(/<iframe|<webview|<embed|<object/i);
    expect(text).not.toContain('docket-page:');
    expect(text.toLowerCase()).not.toContain('cursor');
    expect(source('page-viewer.ts').toLowerCase()).not.toContain('cursor');
  });

  it('U-82: the narrow window drops the rail below the stage and the section is wired into the detail', () => {
    const text = source('page-viewer.tsx');
    expect(text).toMatch(/@\[[\d.]+rem\]:grid-cols-\[minmax\(0,1fr\)_20rem\]/);
    expect(source('detail.tsx')).toContain('<PagesSection');
    expect(text).toContain('data-pages-section');
    expect(text).toContain('motion-safe:');
    expect(text).toContain('focus-visible:');
  });
});
