// page library use cases — rules A-197 … A-201 (docs/v2/application.md), over the in-memory fakes.
import { describe, expect, it } from 'vitest';

import {
  parseSlug,
  parseUlid,
  type Actor,
  type FlowSlug,
  type Page,
  type PageId,
  type PageKind,
  type ProjectSlug,
  type Ulid,
  type WorkOrderId,
} from '../../domain/index';

import type { AppDeps } from '../ports';
import { createFakeDeps } from '../ports/fakes';

import { pageLibrary, pinPage, PAGE_LIBRARY_LIMIT, PAGES_PINNED_KEY, PAGES_PINNED_MAX } from './page-library';

const ulidOf = <B extends string>(input: string): Ulid<B> => {
  const parsed = parseUlid<B>(input);
  if (!parsed.ok) throw new Error(`fixture ulid must parse: ${input}`);
  return parsed.value;
};
const slugOf = <B extends string>(input: string) => {
  const parsed = parseSlug<B>(input);
  if (!parsed.ok) throw new Error(`fixture slug must parse: ${input}`);
  return parsed.value;
};

const pageId = (n: number): PageId => ulidOf<'page'>(`01ARZ3NDEKTSV4RRFFQ69G${String(n).padStart(4, '0')}`);
const WO_12: WorkOrderId = ulidOf('01ARZ3NDEKTSV4RRFFQ69G5FAV');
const WO_NEW: WorkOrderId = ulidOf('01ARZ3NDEKTSV4RRFFQ69G5FAW');
const MOBILE: ProjectSlug = slugOf('mobile');
const WEB: ProjectSlug = slugOf('web');
const USER: Actor = { kind: 'user', id: 'operator' };

const newPage = (
  n: number,
  over: { title?: string; kind?: PageKind; project?: ProjectSlug; workOrder?: WorkOrderId; at?: number } = {},
): Page => {
  const at = over.at ?? n;
  return {
    id: pageId(n),
    title: over.title ?? `Page ${n}`,
    kind: over.kind ?? 'html',
    ...(over.project === undefined ? {} : { project: over.project }),
    ...(over.workOrder === undefined ? {} : { workOrder: over.workOrder }),
    createdBy: USER,
    createdAt: at,
    versions: [{ n: 1, createdAt: at, by: USER, entry: 'index.html', files: [] }],
    approval: 'none',
  };
};

const harness = async (): Promise<AppDeps> => {
  const deps = createFakeDeps();
  const flow = slugOf<'flow'>('f') as FlowSlug;
  await deps.projects.save({ id: MOBILE, name: 'Mobil Uygulama', mainRepo: slugOf('app'), repos: [slugOf('app')] });
  await deps.projects.save({ id: WEB, name: 'Web Sitesi', mainRepo: slugOf('site'), repos: [slugOf('site')] });
  // Numbers are the creation rank: WO_12 is the 12th, WO_NEW the 13th.
  for (let i = 1; i <= 11; i += 1) {
    await deps.workOrders.create({ id: ulidOf(`01ARZ3NDEKTSV4RRFFQ69G6${String(i).padStart(3, '0')}`), project: MOBILE, repo: slugOf('app'), flow, title: 't', createdAt: i, createdBy: USER });
  }
  await deps.workOrders.create({ id: WO_12, project: MOBILE, repo: slugOf('app'), flow, title: 't', createdAt: 12, createdBy: USER });
  await deps.workOrders.create({ id: WO_NEW, project: MOBILE, repo: slugOf('app'), flow, title: 't', createdAt: 13, createdBy: USER });
  return deps;
};

const titles = async (deps: AppDeps, filter: Parameters<typeof pageLibrary>[1]): Promise<string[]> =>
  (await pageLibrary(deps, filter)).map((item) => item.page.title);

describe('pageLibrary filters and order', () => {
  it('A-197: items carry the page, the project name, the work order number and the pin flag', async () => {
    const deps = await harness();
    await deps.pages.save(newPage(1, { project: MOBILE, workOrder: WO_12 }));
    await deps.pages.save(newPage(2));
    const items = await pageLibrary(deps, {});
    const withOrder = items.find((item) => item.page.id === pageId(1));
    expect(withOrder).toMatchObject({ projectName: 'Mobil Uygulama', workOrderNumber: 12, pinned: false });
    const bare = items.find((item) => item.page.id === pageId(2));
    expect(bare?.projectName).toBeUndefined();
    expect(bare?.workOrderNumber).toBeUndefined();
  });

  it('A-197: kind, project, workOrder and pinned filters narrow the list', async () => {
    const deps = await harness();
    await deps.pages.save(newPage(1, { title: 'a', kind: 'html', project: MOBILE, workOrder: WO_12 }));
    await deps.pages.save(newPage(2, { title: 'b', kind: 'markdown', project: WEB }));
    await deps.pages.save(newPage(3, { title: 'c', kind: 'html', project: WEB }));
    expect(await titles(deps, { kind: 'html' })).toEqual(['c', 'a']);
    expect(await titles(deps, { project: WEB })).toEqual(['c', 'b']);
    expect(await titles(deps, { workOrder: WO_12 })).toEqual(['a']);
    expect(await titles(deps, { kind: 'html', project: WEB })).toEqual(['c']);
    expect(await pinPage(deps, { page: pageId(2), pinned: true })).toEqual({ ok: true, value: undefined });
    expect(await titles(deps, { pinned: true })).toEqual(['b']);
    expect((await pageLibrary(deps, {})).map((item) => item.pinned)).toEqual([false, true, false]);
    expect(await titles(deps, { pinned: false })).toEqual(['c', 'a']);
  });

  it('A-198: newest update first (latest version time, then id descending) and at most 500', async () => {
    const deps = await harness();
    await deps.pages.save(newPage(1, { title: 'old', at: 10 }));
    await deps.pages.save(newPage(2, { title: 'tie-low', at: 50 }));
    await deps.pages.save(newPage(3, { title: 'tie-high', at: 50 }));
    // Page 1 gets a later version: its update time is the latest version's, not the creation.
    const first = newPage(1, { title: 'old', at: 10 });
    await deps.pages.save({ ...first, versions: [...first.versions, { n: 2, createdAt: 90, by: USER, entry: 'index.html', files: [] }] });
    expect(await titles(deps, {})).toEqual(['old', 'tie-high', 'tie-low']);

    const many = await harness();
    for (let i = 1; i <= PAGE_LIBRARY_LIMIT + 5; i += 1) await many.pages.save(newPage(i, { at: i }));
    const items = await pageLibrary(many, {});
    expect(items).toHaveLength(500);
    expect(items[0]?.page.id).toBe(pageId(505));
    expect(items[499]?.page.id).toBe(pageId(6));
  });
});

describe('pageLibrary text search', () => {
  it('A-199: q finds Turkish text through the title, softened endings included', async () => {
    const deps = await harness();
    await deps.pages.save(newPage(1, { title: 'Giriş Ekranı taslağı', kind: 'markdown' }));
    await deps.pages.save(newPage(2, { title: 'İSTEK listesi', kind: 'markdown' }));
    await deps.pages.save(newPage(3, { title: 'Kitabı okuma', kind: 'markdown' }));
    await deps.pages.save(newPage(4, { title: 'Kalem seti', kind: 'markdown' }));
    expect(await titles(deps, { q: 'taslak' })).toEqual(['Giriş Ekranı taslağı']);
    expect(await titles(deps, { q: 'giris ekrani' })).toEqual(['Giriş Ekranı taslağı']);
    expect(await titles(deps, { q: 'istek' })).toEqual(['İSTEK listesi']);
    expect(await titles(deps, { q: 'İSTEK' })).toEqual(['İSTEK listesi']);
    expect(await titles(deps, { q: 'kitap' })).toEqual(['Kitabı okuma']);
    expect(await titles(deps, { q: '   ' })).toHaveLength(4);
  });

  it('A-199: q is a substring match — "kal" honestly finds "kalem" — and every token must match', async () => {
    const deps = await harness();
    await deps.pages.save(newPage(1, { title: 'Kalem seti', kind: 'markdown' }));
    await deps.pages.save(newPage(2, { title: 'Defter' }));
    expect(await titles(deps, { q: 'kal' })).toEqual(['Kalem seti']);
    expect(await titles(deps, { q: 'kal defter' })).toEqual([]);
  });

  it('A-199: q also matches the kind name, the project name and the work order code', async () => {
    const deps = await harness();
    await deps.pages.save(newPage(1, { title: 'x', kind: 'html', project: MOBILE, workOrder: WO_12 }));
    await deps.pages.save(newPage(2, { title: 'y', kind: 'markdown', project: WEB }));
    await deps.pages.save(newPage(3, { title: 'z', kind: 'diagram', workOrder: WO_NEW }));
    expect(await titles(deps, { q: 'taslak' })).toEqual(['x']);
    expect(await titles(deps, { q: 'metin' })).toEqual(['y']);
    expect(await titles(deps, { q: 'mobil' })).toEqual(['x']);
    expect(await titles(deps, { q: 'web sitesi' })).toEqual(['y']);
    expect(await titles(deps, { q: 'ie-0012' })).toEqual(['x']);
    expect(await titles(deps, { q: 'İE-0013' })).toEqual(['z']);
    expect(await titles(deps, { q: 'ie-0099' })).toEqual([]);
  });
});

describe('pinPage', () => {
  it('A-200: pins are a JSON array of page ids under pages.pinned; pinning is idempotent and unpinning removes', async () => {
    const deps = await harness();
    await deps.pages.save(newPage(1));
    await deps.pages.save(newPage(2));
    expect(PAGES_PINNED_KEY).toBe('pages.pinned');
    await pinPage(deps, { page: pageId(1), pinned: true });
    await pinPage(deps, { page: pageId(1), pinned: true });
    await pinPage(deps, { page: pageId(2), pinned: true });
    expect(await deps.settings.get('pages.pinned')).toEqual([pageId(1), pageId(2)]);
    await pinPage(deps, { page: pageId(1), pinned: false });
    await pinPage(deps, { page: pageId(1), pinned: false });
    expect(await deps.settings.get('pages.pinned')).toEqual([pageId(2)]);
  });

  it('A-200: an unknown page is not_found and nothing is stored', async () => {
    const deps = await harness();
    expect(await pinPage(deps, { page: pageId(9), pinned: true })).toEqual({ ok: false, error: { code: 'not_found' } });
    expect(await deps.settings.get('pages.pinned')).toBeUndefined();
  });

  it('A-200: at most 200 pins; the 201st is too_many_pinned, re-pinning a pinned page still works at the cap', async () => {
    const deps = await harness();
    for (let i = 1; i <= PAGES_PINNED_MAX + 1; i += 1) await deps.pages.save(newPage(i));
    for (let i = 1; i <= PAGES_PINNED_MAX; i += 1) expect((await pinPage(deps, { page: pageId(i), pinned: true })).ok).toBe(true);
    expect(await pinPage(deps, { page: pageId(201), pinned: true })).toEqual({ ok: false, error: { code: 'too_many_pinned' } });
    expect((await pinPage(deps, { page: pageId(5), pinned: true })).ok).toBe(true);
    expect(((await deps.settings.get('pages.pinned')) as unknown[]).length).toBe(200);
    expect((await pinPage(deps, { page: pageId(5), pinned: false })).ok).toBe(true);
    expect((await pinPage(deps, { page: pageId(201), pinned: true })).ok).toBe(true);
  });

  it('A-201: ids of pages that no longer exist are dropped on write, damaged stored values are ignored', async () => {
    const deps = await harness();
    await deps.pages.save(newPage(1));
    await deps.pages.save(newPage(2));
    await deps.settings.set('pages.pinned', [pageId(7), pageId(1), 42, 'x']);
    await pinPage(deps, { page: pageId(2), pinned: true });
    expect(await deps.settings.get('pages.pinned')).toEqual([pageId(1), pageId(2)]);
    await deps.settings.set('pages.pinned', 'not an array');
    await pinPage(deps, { page: pageId(1), pinned: true });
    expect(await deps.settings.get('pages.pinned')).toEqual([pageId(1)]);
  });

  it('A-201: a dead pin never shows in the library', async () => {
    const deps = await harness();
    await deps.pages.save(newPage(1));
    await deps.settings.set('pages.pinned', [pageId(1), pageId(7)]);
    expect((await pageLibrary(deps, { pinned: true })).map((item) => item.page.id)).toEqual([pageId(1)]);
  });
});
