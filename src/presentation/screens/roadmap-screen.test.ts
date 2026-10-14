// roadmap-screen.test.ts — U-63 … U-65 and U-67 on the rendered roadmap page: the chips and
// buttons per phase state, the inline confirmation, the attention panel, and the header's rem
// geometry. The store is the real one over a fake api; the markup is the server render, asserted
// on by its text and attributes, never cleaned up.
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';

import type { Api } from '../../api/api';
import type { Query, RoadmapPageView } from '../../api/queries';
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

const SINGLE_TREE = [
  {
    project: 'antero',
    name: 'Antero',
    mainRepo: 'api',
    repos: [{ repo: 'api', name: 'api', main: true, active: 0, running: 0, waiting: 0, status: 'idle' as const }],
    active: 0,
    running: 0,
    waiting: 0,
    status: 'idle' as const,
  },
];

const apiOf = (handlers: {
  readonly project?: unknown;
  readonly tree?: unknown;
  readonly repo?: (repo: string) => unknown;
}): Pick<Api, 'query' | 'command'> => ({
  query: (query) => {
    if (query.type === 'project.tree') return Promise.resolve(handlers.tree ?? SINGLE_TREE);
    if (query.type === 'roadmap.byProject') return Promise.resolve(handlers.project ?? VIEW);
    if (query.type === 'roadmap.byRepo') return Promise.resolve(handlers.repo?.(query.repo) ?? { ok: false, code: 'not_found' });
    return Promise.resolve({ ok: false, code: 'not_found' });
  },
  command: () => Promise.resolve({ ok: true }),
});

const loaded = async (): Promise<RoadmapStore> => {
  const store = createRoadmapStore({ api: apiOf({}), changes: () => () => undefined });
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

describe('roadmap page — layer tabs (U-324)', () => {
  it('U-324: the page opens on Proje katmanı; Depo katmanı does not reload the project query', async () => {
    const queries: Query[] = [];
    const api: Pick<Api, 'query' | 'command'> = {
      query: (query) => {
        queries.push(query);
        return apiOf({}).query(query);
      },
      command: () => Promise.resolve({ ok: true }),
    };
    const store = createRoadmapStore({ api, changes: () => () => undefined });
    await store.load('antero');
    const html = render(store);
    expect(html).toContain('>Proje katmanı<');
    expect(html).toContain('>Depo katmanı<');
    expect(html).toContain('data-phase="p1"');

    store.setLayer('repo');
    for (let i = 0; i < 5; i += 1) await Promise.resolve();
    store.setLayer('project');
    await Promise.resolve();

    expect(queries.filter((q) => q.type === 'roadmap.byProject')).toHaveLength(1);
  });

  it('U-324: one repo omits the depo tab bar; two repos draw it', async () => {
    const repoView = {
      milestones: [{ id: 'm1', title: 'M1', state: 'open', source: { kind: 'local' } }],
      issues: [],
    };
    const store = createRoadmapStore({
      api: apiOf({ tree: SINGLE_TREE, repo: () => repoView }),
      changes: () => () => undefined,
    });
    await store.load('antero');
    store.setLayer('repo');
    for (let i = 0; i < 5; i += 1) await Promise.resolve();
    expect(render(store)).not.toContain('Depo seçimi');

    const multiTree = [
      {
        project: 'antero',
        name: 'Antero',
        mainRepo: 'api',
        repos: [
          { repo: 'api', name: 'api', main: true, active: 0, running: 0, waiting: 0, status: 'idle' as const },
          { repo: 'web', name: 'web', main: false, active: 0, running: 0, waiting: 0, status: 'idle' as const },
        ],
        active: 0,
        running: 0,
        waiting: 0,
        status: 'idle' as const,
      },
    ];
    const multi = createRoadmapStore({
      api: apiOf({ tree: multiTree, repo: () => repoView }),
      changes: () => () => undefined,
    });
    await multi.load('antero');
    multi.setLayer('repo');
    for (let i = 0; i < 5; i += 1) await Promise.resolve();
    expect(render(multi)).toContain('Depo seçimi');
  });
});

describe('roadmap page — repository layer (U-325)', () => {
  const projectWithLink: RoadmapPageView = {
    phases: [
      {
        id: 'faz-1',
        name: 'Faz 1 · Çekirdek',
        status: 'planned',
        blockedBy: [],
        items: [{ kind: 'repo_item', ref: { repo: 'api', kind: 'issue', id: 'i1' } }],
        tasks: [],
      },
    ],
    runnable: [],
  };

  const repoPopulated = {
    milestones: [{ id: 'm1', title: 'M1', state: 'open', source: { kind: 'local' } }],
    issues: [
      { id: 'i1', title: 'Ana iş', state: 'open', milestone: 'm1', labels: [], source: { kind: 'local' } },
      { id: 's1', title: 'Alt görev', state: 'open', parent: 'i1', labels: [], source: { kind: 'local' } },
      { id: 's2', title: 'Derin alt', state: 'open', parent: 's1', labels: [], source: { kind: 'local' } },
    ],
  };

  const loadRepo = async (project: RoadmapPageView, repo: unknown): Promise<RoadmapStore> => {
    const store = createRoadmapStore({
      api: apiOf({ project, repo: () => repo }),
      changes: () => () => undefined,
    });
    await store.load('antero');
    store.setLayer('repo');
    for (let i = 0; i < 5; i += 1) await Promise.resolve();
    return store;
  };

  it('U-325: lists milestones and issues; subtasks stay one level deep', async () => {
    const store = await loadRepo(projectWithLink, repoPopulated);
    store.toggleRepoIssue('i1');
    const html = render(store);
    expect(html).toContain('data-milestone="m1"');
    expect(html).toContain('Ana iş');
    expect(html).toContain('yerel alt görev');
    expect(html).not.toContain('Derin alt');
  });

  it('U-325: a phase badge jumps to the project layer and highlights that phase', async () => {
    const store = await loadRepo(projectWithLink, repoPopulated);
    const before = render(store);
    expect(before).toContain('Faz: Faz 1 · Çekirdek');
    const match = before.match(/Faz: Faz 1 · Çekirdek/);
    expect(match).not.toBeNull();
    store.jumpToPhase('faz-1');
    const after = render(store);
    expect(after).toContain('data-phase="faz-1"');
    expect(after).toContain('border-signal');
    expect(after).not.toContain('data-milestone=');
  });

  it('U-325: not_found shows Bu depoda yol haritası yok without an action button', async () => {
    const html = render(await loadRepo(projectWithLink, { ok: false, code: 'not_found' }));
    expect(html).toContain('Bu depoda yol haritası yok');
    expect(html).not.toContain('>Tekrar dene<');
    expect(html).not.toContain('Kaydet');
  });

  it('U-325: empty repo roadmap shows the empty card', async () => {
    const html = render(await loadRepo(projectWithLink, { milestones: [], issues: [] }));
    expect(html).toContain('Bu depoda henüz kilometre taşı veya iş yok.');
  });

  it('U-325: the repository layer is read-only — no run or save controls', async () => {
    const html = render(await loadRepo(projectWithLink, repoPopulated));
    expect(html).not.toContain('Fazı çalıştır');
    expect(html).not.toContain('>Kaydet<');
    expect(html).not.toContain('>Başlat<');
  });
});
