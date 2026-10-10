/// <reference types="vite/client" />
// proposals-screen.test.ts — U-138 (tabs, counts, empty states), U-139 (list item), U-140 (status
// chips), U-141 (detail header and the diff region), U-142 (the bar per status), U-147 (untrusted
// text), U-148 (copy), U-149 (aria and keys) and U-150 (the measure rules, scanned from the
// source) at the markup a person would see: the screen drawn over a real store with the server
// renderer, the way the layer's other screen tests draw.
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';

import type { ProposalDetailView, ProposalListItem, Query } from '../../api/queries';
import type { Actor } from '../../domain/index';
import { EN } from '../labels/en';
import { LABEL_KEYS } from '../labels/keys';
import { TR } from '../labels/tr';
import { createProposalsStore, type ProposalsStore, type ProposalTab } from '../stores/proposals';
import { ProposalsScreen } from './proposals';

const ACTOR: Actor = { kind: 'user', id: 'u-1' };
const NOW = 1_700_000_000_000;
const MINUTE = 60_000;

const listItem = (id: string, patch: Partial<ProposalListItem> = {}): ProposalListItem => ({
  id,
  summary: `Öneri ${id}`,
  target: 'flows/odoo.yaml',
  scopeKind: 'global',
  status: 'pending',
  author: { kind: 'agent', label: 'planlayici' },
  createdAt: NOW - 12 * MINUTE,
  ...patch,
});

type Overrides = Partial<ProposalDetailView>;

const detailOf = (item: ProposalListItem, patch: Overrides = {}): ProposalDetailView => ({
  ...item,
  before: '',
  after: '',
  lines: [
    { kind: 'same', text: 'id: odoo' },
    { kind: 'remove', text: '  - id: uygulama' },
    { kind: 'add', text: '  - id: inceleme' },
  ],
  truncated: false,
  currentlyStale: false,
  ...patch,
});

interface World {
  readonly items: readonly ProposalListItem[];
  readonly details?: Readonly<Record<string, Overrides>>;
  readonly listFails?: string;
}

const load = async (world: World): Promise<ProposalsStore> => {
  const store = createProposalsStore({
    api: {
      query: (query: Query) => {
        if (query.type === 'proposals.list') {
          return Promise.resolve(world.listFails === undefined ? [...world.items] : { ok: false, code: world.listFails });
        }
        if (query.type === 'proposal.detail') {
          const item = world.items.find((row) => row.id === query.id);
          return Promise.resolve(item === undefined ? { ok: false, code: 'not_found' } : detailOf(item, world.details?.[item.id] ?? {}));
        }
        if (query.type === 'project.tree') {
          return Promise.resolve([{ project: 'antero', name: 'Antero', mainRepo: 'antero-api', repos: [{ repo: 'antero-api', name: 'Antero API', main: true }] }]);
        }
        return Promise.resolve(null);
      },
      command: () => Promise.resolve({ ok: true }),
    },
    actor: ACTOR,
  });
  await store.refresh();
  return store;
};

const draw = async (world: World, locale: 'tr' | 'en' = 'tr', tab?: ProposalTab, select?: string): Promise<string> => {
  const store = await load(world);
  if (tab !== undefined) store.setTab(tab);
  if (select !== undefined) store.select(select);
  for (let i = 0; i < 20; i += 1) await Promise.resolve();
  return renderToStaticMarkup(createElement(ProposalsScreen, { store, locale, now: NOW }));
};

const MIXED: World = {
  items: [
    listItem('p1', { summary: 'Odoo akışına inceleme ekle', scopeKind: 'project', scopeId: 'antero' }),
    listItem('p2', { summary: 'Test rolünü sınırla', target: 'roles/test.yaml' }),
    listItem('p3', { status: 'rejected', createdAt: NOW - 26 * 60 * MINUTE }),
    listItem('p4', { status: 'approved', scopeKind: 'repo', scopeId: 'antero-api' }),
  ],
  details: { p2: { currentlyStale: true } },
};

const rowOf = (html: string, id: string): string => {
  const start = html.indexOf(`data-proposals-item="${id}"`);
  expect(start, `item ${id}`).toBeGreaterThan(-1);
  const next = html.indexOf('data-proposals-item="', start + 10);
  return html.slice(start, next === -1 ? html.length : next);
};

describe('proposals screen — tabs and list (U-138, U-139, U-140)', () => {
  it('U-138: the three tabs show with their counts, Bekleyen pressed by default', async () => {
    const html = await draw(MIXED);
    expect(html).toMatch(/aria-pressed="true"[^>]*data-proposals-tab="pending"|data-proposals-tab="pending"[^>]*aria-pressed="true"/);
    for (const label of ['Bekleyen', 'Karar verilen', 'Bayat']) expect(html).toContain(label);
    const counts = [...html.matchAll(/data-proposals-count="(\w+)"[^>]*>(\d+)</g)].map((m) => `${m[1]}:${m[2]}`);
    expect(counts).toEqual(['pending:1', 'decided:2', 'stale:1']);
  });

  it('U-138: the other tabs aria-pressed false, and the list holds only the shown tab', async () => {
    const html = await draw(MIXED, 'tr', 'decided');
    expect(html).toContain('data-proposals-item="p3"');
    expect(html).toContain('data-proposals-item="p4"');
    expect(html).not.toContain('data-proposals-item="p1"');
    expect(html.match(/aria-pressed="true"/g)).toHaveLength(1);
  });

  it('U-138: no proposals at all says "Öneri yok"; an empty tab says "Bu sekmede öneri yok"', async () => {
    expect(await draw({ items: [] })).toContain('Öneri yok');
    const tab = await draw({ items: [listItem('p1')] }, 'tr', 'decided');
    expect(tab).toContain('Bu sekmede öneri yok');
    expect(tab).not.toContain('>Öneri yok<');
  });

  it('U-138: a failed read shows an alert with Yeniden dene, never a blank area', async () => {
    const html = await draw({ items: [], listFails: 'io_failed' });
    expect(html).toContain('role="alert"');
    expect(html).toContain('Yeniden dene');
  });

  it('U-139: an item shows summary, mono target, scope name, status chip, age and author', async () => {
    const row = rowOf(await draw(MIXED), 'p1');
    expect(row).toContain('Odoo akışına inceleme ekle');
    expect(row).toMatch(/font-mono[^>]*>flows\/odoo\.yaml</);
    expect(row).toContain('Antero');
    expect(row).toContain('12 dakika önce');
    expect(row).toContain('planlayici');
    expect(row).toContain('Bekliyor');
  });

  it('U-139: global reads Genel and a repo scope resolves to the repo name', async () => {
    const html = await draw(MIXED, 'tr', 'decided');
    expect(rowOf(html, 'p3')).toContain('Genel');
    expect(rowOf(html, 'p4')).toContain('Antero API');
  });

  it('U-139: the English locale reads Global and the same structure', async () => {
    const html = await draw(MIXED, 'en', 'decided');
    expect(rowOf(html, 'p3')).toContain('Global');
    expect(rowOf(html, 'p3')).toContain('Rejected');
  });

  it('U-140: the chips read Bekliyor with a lamp, ✓ Onaylandı, Reddedildi and Bayat', async () => {
    const pending = rowOf(await draw(MIXED), 'p1');
    expect(pending).toContain('Bekliyor');
    expect(pending).toContain('data-proposals-lamp');
    const decided = await draw(MIXED, 'tr', 'decided');
    expect(rowOf(decided, 'p4')).toContain('✓ Onaylandı');
    expect(rowOf(decided, 'p3')).toContain('Reddedildi');
    expect(rowOf(decided, 'p3')).not.toContain('data-proposals-lamp');
    const stale = await draw(MIXED, 'tr', 'stale');
    expect(rowOf(stale, 'p2')).toContain('Bayat');
  });
});

describe('proposals screen — detail (U-141, U-142)', () => {
  it('U-141: the header shows summary, target, scope, author, age and the chip', async () => {
    const html = await draw(MIXED);
    const header = html.slice(html.indexOf('data-proposals-header'), html.indexOf('data-proposals-diff'));
    for (const part of ['Odoo akışına inceleme ekle', 'flows/odoo.yaml', 'Antero', 'planlayici', '12 dakika önce', 'Bekliyor']) {
      expect(header, part).toContain(part);
    }
  });

  it('U-141: the diff is a labelled region with − and + gutters, pre-formatted monospace and horizontally scrollable', async () => {
    const html = await draw(MIXED);
    const diff = html.slice(html.indexOf('data-proposals-diff'));
    expect(diff).toContain('role="region"');
    expect(diff).toContain('aria-label="Fark"');
    expect(diff).toMatch(/overflow-auto|overflow-x-auto/);
    expect(diff).toContain('whitespace-pre');
    expect(diff).toContain('font-mono');
    expect(diff).toMatch(/data-proposals-line="remove"[^>]*>(?:(?!<\/div>).)*−/s);
    expect(diff).toMatch(/data-proposals-line="add"[^>]*>(?:(?!<\/div>).)*\+/s);
    expect(diff).toContain('data-proposals-line="same"');
    expect(diff).toContain('  - id: inceleme');
  });

  it('U-141: a truncated diff ends with one short row "Fark kısaltıldı"', async () => {
    const html = await draw({ items: [listItem('p1')], details: { p1: { truncated: true } } });
    expect(html.match(/Fark kısaltıldı/g)).toHaveLength(1);
    expect(await draw({ items: [listItem('p1')] })).not.toContain('Fark kısaltıldı');
  });

  it('U-142: a pending proposal has the bar with Reddet and an enabled Onayla and the hint', async () => {
    const html = await draw(MIXED);
    const bar = html.slice(html.indexOf('data-proposals-bar'));
    expect(bar).toContain('Reddet');
    expect(bar).toContain('Onayla');
    expect(bar).toContain('Onaylarsan dosya yazılır');
    expect(bar).not.toMatch(/data-proposals-approve=""[^>]*disabled=""/);
    expect(html).not.toContain('Dosya değişti; öneri geçersiz.');
  });

  it('U-142: a stale proposal disables Onayla, keeps Reddet open, shows the note and its hint', async () => {
    const html = await draw(MIXED, 'tr', 'stale');
    expect(html).toContain('Dosya değişti; öneri geçersiz.');
    expect(html).toContain('Önce güncel hâli gerek');
    expect(html).toMatch(/<button[^>]*data-proposals-approve=""[^>]*disabled=""/);
    expect(html).not.toMatch(/<button[^>]*data-proposals-reject=""[^>]*disabled=""/);
  });

  it('U-142: a decided proposal has no bar', async () => {
    const html = await draw(MIXED, 'tr', 'decided');
    expect(html).not.toContain('data-proposals-bar');
    expect(html).not.toContain('Onayla<');
  });

  it('U-142: a proposal the api saved as stale shows the note and no bar', async () => {
    const html = await draw({ items: [listItem('p5', { status: 'stale' })] }, 'tr', 'stale');
    expect(html).toContain('Dosya değişti; öneri geçersiz.');
    expect(html).not.toContain('data-proposals-bar');
  });
});

describe('proposals screen — untrusted text (U-147)', () => {
  const HOSTILE = '<img src=x onerror=alert(1)>';
  const world: World = {
    items: [listItem('p1', { summary: HOSTILE, target: '<b>t</b>', author: { kind: 'agent', label: '<i>a</i>' }, scopeKind: 'project', scopeId: '<u>s</u>' })],
    details: { p1: { lines: [{ kind: 'add', text: HOSTILE }, { kind: 'same', text: 'https://example.com/x' }] } },
  };

  it('U-147: summary, target, scope, author and every diff line enter as escaped text, never as markup', async () => {
    const html = await draw(world);
    expect(html).not.toContain('<img');
    expect(html).not.toContain('<b>t</b>');
    expect(html).not.toContain('<i>a</i>');
    expect(html).not.toContain('<u>s</u>');
    expect(html).toContain('&lt;img src=x onerror=alert(1)&gt;');
    expect(html).toContain('&lt;b&gt;t&lt;/b&gt;');
  });

  it('U-147: a URL in a diff line is plain text — no anchor', async () => {
    const html = await draw(world);
    expect(html).toContain('https://example.com/x');
    expect(html).not.toContain('<a ');
    expect(html).not.toContain('href=');
  });
});

describe('proposals screen — keyboard and aria (U-149)', () => {
  it('U-149: the list selection is aria-current and the tabs are aria-pressed buttons', async () => {
    const html = await draw(MIXED);
    expect(rowOf(html, 'p1')).toMatch(/^[^>]*aria-current="true"/);
    expect(html).toMatch(/<button[^>]*data-proposals-tab="pending"/);
  });

  it('U-149: Approve and Reject are explicit buttons of type button — Enter on a list item never decides', async () => {
    const html = await draw(MIXED);
    expect(html).toMatch(/<button[^>]*type="button"[^>]*data-proposals-approve=""|<button[^>]*data-proposals-approve=""[^>]*type="button"/);
    expect(html).not.toContain('type="submit"');
    expect(html).not.toContain('<form');
  });
});

describe('proposals copy (U-148)', () => {
  const KEYS = LABEL_KEYS.filter((key) => key.startsWith('proposals.') || key === 'nav.proposals');
  const words = (text: string): number => text.trim().split(/\s+/).length;

  it('U-148: the proposals keys exist in both bundles', () => {
    expect(KEYS.length).toBeGreaterThan(20);
    for (const key of KEYS) {
      expect(TR[key].length, `tr ${key}`).toBeGreaterThan(0);
      expect(EN[key].length, `en ${key}`).toBeGreaterThan(0);
    }
  });

  it('U-148: no string of the screen is longer than 8 words, in either bundle', () => {
    for (const key of KEYS) {
      expect(words(TR[key]), `tr ${key}: ${TR[key]}`).toBeLessThanOrEqual(8);
      expect(words(EN[key]), `en ${key}: ${EN[key]}`).toBeLessThanOrEqual(8);
    }
  });

  it('U-148: the operator-fixed Turkish sentences read exactly', () => {
    expect(TR['nav.proposals']).toBe('Öneriler');
    expect(TR['proposals.empty']).toBe('Öneri yok');
    expect(TR['proposals.empty.tab']).toBe('Bu sekmede öneri yok');
    expect(TR['proposals.note.stale']).toBe('Dosya değişti; öneri geçersiz.');
    expect(TR['proposals.hint.pending']).toBe('Onaylarsan dosya yazılır');
    expect(TR['proposals.hint.stale']).toBe('Önce güncel hâli gerek');
    expect(TR['proposals.toast.approved']).toBe('Onaylandı');
    expect(TR['proposals.toast.rejected']).toBe('Reddedildi');
    expect(TR['proposals.diff.truncated']).toBe('Fark kısaltıldı');
    expect(EN['nav.proposals']).toBe('Proposals');
  });

  it('U-148: stale and not_found have their own failure sentences', () => {
    const own = new Set([TR['proposals.fail.stale'], TR['proposals.fail.not_found'], TR['proposals.fail.generic']]);
    expect(own.size).toBe(3);
  });

  it('U-148: the screen shows its copy in English too', async () => {
    const html = await draw(MIXED, 'en');
    for (const part of ['Pending', 'Decided', 'Stale', 'Approve', 'Reject']) expect(html).toContain(part);
  });

  it('U-148: the failure sentences render in the note row, per code', async () => {
    const { proposalFailureKey } = await import('../stores/proposals');
    expect(TR[proposalFailureKey('stale')]).toBe(TR['proposals.fail.stale']);
    expect(TR[proposalFailureKey('not_found')]).toBe(TR['proposals.fail.not_found']);
    expect(TR[proposalFailureKey('anything_else')]).toBe(TR['proposals.fail.generic']);
  });
});

describe('proposals screen — measure (U-150)', () => {
  const SOURCES = import.meta.glob(['./proposals.tsx', '../stores/proposals.ts'], { query: '?raw', import: 'default', eager: true }) as Record<string, string>;
  const screen = Object.entries(SOURCES).find(([path]) => path.endsWith('/screens/proposals.tsx') || path === './proposals.tsx')?.[1] ?? '';
  const classStrings = [...screen.matchAll(/(?:className=\{?|\b[A-Z_]+ =\s*)(?:"([^"]*)"|'([^']*)'|`([^`]*)`)/g)].map((m) => m[1] ?? m[2] ?? m[3] ?? '');

  it('U-150: the sources exist and carry class strings to scan', () => {
    expect(Object.keys(SOURCES).length).toBe(2);
    expect(classStrings.length).toBeGreaterThan(10);
  });

  it('U-150: lengths are rem — no px length in a class or a style, except the 1 px hairline border', () => {
    expect(screen).not.toMatch(/\[\s*-?\d*\.?\d+px\s*\]/);
    expect(screen).not.toMatch(/\d+px['"` ;}]/);
    expect(screen).not.toMatch(/style=\{\{[^}]*px/);
  });

  it('U-150: every sized text line has an explicit leading', () => {
    for (const classes of classStrings) {
      if (/(?:^|\s)text-\[[\d.]+rem\]/.test(classes)) expect(classes, classes).toMatch(/(?:^|\s)leading-/);
    }
  });

  it('U-150: radii come from the three tokens and rounded-full only', () => {
    for (const classes of classStrings) {
      for (const radius of classes.match(/(?<![\w-])rounded[\w-]*/g) ?? []) {
        expect(['rounded-control', 'rounded-card', 'rounded-panel', 'rounded-full']).toContain(radius);
      }
    }
    expect(screen).not.toMatch(/border-?[Rr]adius/);
  });

  it('U-150: spacing steps are on the 4·8·12·16·20·24·32 scale (rem)', () => {
    const allowed = new Set(['0', '1', '2', '3', '4', '5', '6', '8']);
    for (const classes of classStrings) {
      for (const match of classes.matchAll(/(?:^|\s)(?:[a-z-]+:)*(?:p|px|py|pt|pb|pl|pr|m|mx|my|mt|mb|ml|mr|gap|gap-x|gap-y)-(\d+(?:\.\d+)?)(?=\s|$)/g)) {
        expect(allowed.has(match[1] ?? ''), `${match[0].trim()} in ${classes}`).toBe(true);
      }
    }
  });

  it('U-150: no vendor-named class, no markup built from text', () => {
    expect(screen.toLowerCase()).not.toContain('cursor');
    for (const source of Object.values(SOURCES)) {
      expect(source).not.toMatch(/dangerouslySetInnerHTML|innerHTML/);
    }
  });

  it('U-150: controls show a focus-visible ring, tabs and the list stack at the lg breakpoint, motion sits behind motion-safe', () => {
    expect(screen).toContain('focus-visible:outline');
    expect(screen).toMatch(/lg:grid-cols-/);
    for (const classes of classStrings) {
      if (/(?:^|\s)transition/.test(classes)) expect(classes, classes).toMatch(/motion-(?:safe|reduce):/);
    }
  });
});
