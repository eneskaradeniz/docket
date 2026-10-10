// roadmap-screen.test.ts — U-63 … U-65 and U-67 on the rendered roadmap page: the chips and
// buttons per phase state, the inline confirmation, the attention panel, and the header's rem
// geometry. The store is the real one over a fake api; the markup is the server render, asserted
// on by its text and attributes, never cleaned up.
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';

import type { Api } from '../../api/api';
import type { RoadmapPageView } from '../../api/queries';
import { t, type Locale } from '../labels/t';
import { createRoadmapStore, type RoadmapStore } from '../stores/roadmap';
import { formatWorkOrderCode } from '../stores/work-order-code';
import { RoadmapScreen } from './roadmap';

const SOURCES = import.meta.glob('./roadmap.tsx', { query: '?raw', import: 'default', eager: true }) as Record<string, string>;
const SOURCE = Object.values(SOURCES)[0] ?? '';

type Phase = RoadmapPageView['phases'][number];

const orderRow = (id: string, number: number, status: string) => ({ repo: 'api', id, number, title: 'iş', status });

const PHASES: readonly Phase[] = [
  { id: 'p1', name: 'Temel altyapı', status: 'done', blockedBy: [], tasks: [{ id: 't1', title: 'Depo', status: 'done', targets: ['api'], workOrders: [] }] },
  {
    id: 'p2',
    name: 'Kimlik ve oturum',
    status: 'running',
    blockedBy: [],
    autoRun: { state: 'running', attention: ['wo-42'] },
    tasks: [
      { id: 't2', title: 'Parola sıfırlama', status: 'running', targets: ['api'], workOrders: [orderRow('wo-42', 42, 'blocked')] },
    ],
  },
  {
    id: 'p3',
    name: 'Ödeme akışı',
    status: 'running',
    blockedBy: [],
    autoRun: { state: 'paused', attention: [] },
    tasks: [{ id: 't3', title: 'Sepet', status: 'planned', targets: ['api'], workOrders: [] }],
  },
  {
    id: 'p4',
    name: 'Bildirimler',
    status: 'waiting',
    blockedBy: ['p2', 'p3'],
    tasks: [{ id: 't4', title: 'Tercihler', status: 'waiting', targets: ['api'], workOrders: [] }],
  },
  {
    id: 'p5',
    name: 'Yayın hazırlığı',
    status: 'planned',
    blockedBy: [],
    tasks: [
      { id: 't5', title: 'Yük testi', status: 'planned', targets: ['api', 'web'], workOrders: [] },
      { id: 't6', title: 'Gizlilik metni', status: 'planned', targets: ['docs'], workOrders: [] },
    ],
  },
  { id: 'p6', name: 'Boş faz', status: 'planned', blockedBy: [], tasks: [{ id: 't7', title: 'Bekleyen', status: 'planned', targets: ['api'], workOrders: [] }] },
  { id: 'p7', name: 'Elle açılan', status: 'running', blockedBy: [], tasks: [{ id: 't8', title: 'Elle', status: 'running', targets: ['api'], workOrders: [] }] },
];

const VIEW: RoadmapPageView = { phases: PHASES, runnable: ['t5', 't6'] };

const loaded = async (): Promise<RoadmapStore> => {
  const api: Pick<Api, 'query' | 'command'> = { query: () => Promise.resolve(VIEW), command: () => Promise.resolve({ ok: true }) };
  const store = createRoadmapStore({ api, changes: () => () => undefined });
  await store.load('antero');
  return store;
};

const render = (store: RoadmapStore, locale: Locale = 'tr'): string =>
  renderToStaticMarkup(
    createElement(RoadmapScreen, {
      store,
      project: 'antero',
      name: 'Antero',
      locale,
      onOpenRepo: () => undefined,
      onOpenWorkOrder: () => undefined,
    }),
  );

/** One phase card's markup, cut out by its data attribute and the next card's opening. */
const card = (html: string, id: string): string => {
  const start = html.indexOf(`data-phase="${id}"`);
  if (start === -1) throw new Error(`no card ${id}`);
  const next = html.indexOf('data-phase="', start + 1);
  return html.slice(start, next === -1 ? undefined : next);
};

describe('roadmap page — run controls render (U-63)', () => {
  it('U-63: every state shows exactly its chip and button, in Turkish', async () => {
    const html = render(await loaded());
    const label = (key: Parameters<typeof t>[1]): string => t('tr', key);

    expect(card(html, 'p1')).toContain(label('roadmap.chip.done'));
    expect(card(html, 'p1')).not.toContain(`>${label('roadmap.run')}<`);

    const running = card(html, 'p2');
    expect(running).toContain(label('roadmap.chip.running'));
    expect(running).toContain(`>${label('roadmap.pause')}<`);
    expect(running).toContain('1 dikkat');

    const paused = card(html, 'p3');
    expect(paused).toContain(label('roadmap.chip.paused'));
    expect(paused).toContain(label('roadmap.hint.paused'));
    expect(paused).toContain(`>${label('roadmap.resume')}<`);

    const blocked = card(html, 'p4');
    expect(blocked).toMatch(/<button[^>]*disabled=""[^>]*>Fazı çalıştır<\/button>/);
    expect(blocked).toContain('Önce “Kimlik ve oturum, Ödeme akışı” bitmeli');

    expect(card(html, 'p5')).toMatch(/<button(?![^>]*\sdisabled="")[^>]*>Fazı çalıştır<\/button>/);

    const noButton = card(html, 'p6');
    expect(noButton).not.toContain('Fazı çalıştır');

    const byHand = card(html, 'p7');
    expect(byHand).toContain(label('roadmap.chip.running'));
    expect(byHand).not.toContain('Duraklat');
    expect(byHand).not.toContain('Sürdür');
  });

  it('U-63: the English bundle drives the same states', async () => {
    const html = render(await loaded(), 'en');
    expect(card(html, 'p2')).toContain('>Pause<');
    expect(card(html, 'p3')).toContain('>Resume<');
    expect(card(html, 'p5')).toContain('>Run phase<');
  });
});

describe('roadmap page — confirmation (U-64)', () => {
  it('U-64: nothing is confirmed until Fazı çalıştır opens the panel; then it shows the counts, the note and the only primary', async () => {
    const store = await loaded();
    const before = render(store);
    expect(before).not.toContain('Başlat');

    store.askRun('p5');
    const html = render(store);
    const open = card(html, 'p5');
    expect(open).toContain('<strong class="font-bold">2 görev</strong> başlayacak, <strong class="font-bold">3 iş emri</strong> açılıp sıraya girecek.');
    expect(open).toContain('Ücretli bir model gerekirse izin ayrıca sorulur. Sonraki faz başlamaz.');
    expect(open).toContain('>Başlat<');
    expect(open).toContain('>Vazgeç<');
    // The only primary (amber-filled) button on the page.
    expect(html.split('bg-signal text-signal-ink').length - 1).toBe(1);
  });

  it('U-64: opening a confirmation closes the attention panel, and Vazgeç removes the panel', async () => {
    const store = await loaded();
    store.toggleAttention('p2');
    expect(render(store)).toContain('Dikkat isteyen iş emirleri');
    store.askRun('p5');
    const html = render(store);
    expect(html).not.toContain('Dikkat isteyen iş emirleri');
    expect(html).toContain('>Başlat<');
    store.closePanel();
    expect(render(store)).not.toContain('>Başlat<');
  });
});

describe('roadmap page — attention panel (U-65)', () => {
  it('U-65: the chip toggles a panel listing each work order as its code, its task title and the failed sentence', async () => {
    const store = await loaded();
    expect(render(store)).not.toContain('Dikkat isteyen iş emirleri');
    store.toggleAttention('p2');
    const panel = card(render(store), 'p2');
    expect(panel).toContain('aria-expanded="true"');
    expect(panel).toContain(`>${formatWorkOrderCode(42, 'tr')}<`);
    expect(panel).toContain('Parola sıfırlama');
    expect(panel).toContain('başarısız. Faz sürüyor, bağımsız görevler devam ediyor.');
  });

  it('U-65: the code is a button — the screen wires it to onOpenWorkOrder', () => {
    expect(SOURCE).toContain('onClick={() => onOpenWorkOrder(order.id)}');
    expect(SOURCE).toContain('formatWorkOrderCode(order.number, locale)');
  });
});

describe('roadmap page — header geometry (U-67)', () => {
  it('U-67: every card has the status row, so every header is the same height — a card without a button included', async () => {
    const html = render(await loaded());
    const cards = html.split('data-phase="').length - 1;
    expect(cards).toBe(PHASES.length);
    expect(html.split('min-h-5 flex-wrap').length - 1).toBe(cards);
    expect(html.split('min-h-7 items-center gap-3').length - 1).toBe(cards);
  });

  it('U-67: the button is 1.75 rem tall with 0.75 rem side padding, the chip 1.25 rem; the header is one grid', () => {
    expect(SOURCE).toContain("const BUTTON = `h-7 ");
    expect(SOURCE).toContain(' px-3 ');
    expect(SOURCE).toContain("const CHIP = 'inline-flex h-5 ");
    expect(SOURCE).toContain('grid-cols-[1rem_minmax(0,1fr)_auto]');
    expect(SOURCE).toContain('col-start-2 col-end-4');
  });

  it('U-67: no px length in the page beyond the one hairline-weight ring of the task glyph; radii only from the tokens', () => {
    const pxLengths = SOURCE.match(/\[\d*\.?\d+px\]/g) ?? [];
    expect(pxLengths).toEqual(['[1.5px]']);
    const radii = SOURCE.match(/rounded(?:-[a-z]+)?(?![\w-])/g) ?? [];
    for (const radius of radii) expect(['rounded-full', 'rounded-control', 'rounded-card', 'rounded-panel']).toContain(radius);
  });

  it('U-67: the header is keyboard-reachable and the motion respects reduced-motion', () => {
    expect(SOURCE).toContain('aria-expanded={open}');
    expect(SOURCE).toContain('focus-visible:outline');
    expect(SOURCE).toContain('motion-reduce:transition-none');
  });
});
