// stores/library.test.ts — U-84 (the sidebar count), U-85 (filter bar behaviour), U-87 (pin with
// optimistic rollback), U-88 (phases and the cap) and U-89 (refresh triggers) over a scripted api
// and the runner's fake clock. The api and the change signal are injected fakes.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type { CommandResult } from '../../api/commands';
import type { PageLibraryItemView, Query } from '../../api/queries';
import type { Actor } from '../../domain/index';
import {
  LIBRARY_CAP,
  LIBRARY_DEBOUNCE_MS,
  LIBRARY_POLL_MS,
  libraryKindOptions,
  libraryPhase,
  libraryProjectOptions,
  createLibraryStore,
  type LibraryChange,
  type LibraryStore,
} from './library';

const ACTOR: Actor = { kind: 'user', id: 'u-1' };

const item = (id: string, patch: Partial<PageLibraryItemView> = {}): PageLibraryItemView => ({
  id,
  title: `Sayfa ${id}`,
  kind: 'html',
  latestVersion: 1,
  updatedAt: 1_700_000_000_000,
  approval: 'none',
  pinned: false,
  provenance: 'docket_ai',
  ...patch,
});

type LibraryQuery = Extract<Query, { type: 'pages.library' }>;

interface FakeApi {
  readonly queries: LibraryQuery[];
  readonly commands: unknown[];
  /** Answers a query; replaced per test. */
  answer: (query: LibraryQuery) => Promise<unknown>;
  result: CommandResult;
  query: (query: Query) => Promise<unknown>;
  command: (actor: Actor, command: unknown) => Promise<CommandResult>;
}

const fakeApi = (rows: readonly PageLibraryItemView[] = []): FakeApi => {
  const api: FakeApi = {
    queries: [],
    commands: [],
    result: { ok: true },
    answer: (query) =>
      Promise.resolve(
        rows.filter(
          (row) =>
            (query.kind === undefined || row.kind === query.kind) &&
            (query.project === undefined || row.project?.slug === query.project) &&
            (query.pinned !== true || row.pinned) &&
            (query.q === undefined || row.title.toLowerCase().includes(query.q.toLowerCase())),
        ),
      ),
    query: (query) => {
      if (query.type !== 'pages.library') return Promise.resolve(null);
      api.queries.push(query);
      return api.answer(query);
    },
    command: (_actor, command) => {
      api.commands.push(command);
      return Promise.resolve(api.result);
    },
  };
  return api;
};

const fakeChanges = (): {
  readonly signal: (listener: (change: LibraryChange) => void) => () => void;
  readonly emit: (change: LibraryChange) => void;
} => {
  const listeners = new Set<(change: LibraryChange) => void>();
  return {
    signal: (listener) => {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    emit: (change) => {
      for (const listener of [...listeners]) listener(change);
    },
  };
};

const flush = async (): Promise<void> => {
  for (let i = 0; i < 8; i += 1) await Promise.resolve();
};

const make = (api: FakeApi, changes = fakeChanges()): LibraryStore =>
  createLibraryStore({ api, changes: changes.signal, actor: ACTOR });

beforeEach(() => {
  vi.useFakeTimers();
});
afterEach(() => {
  vi.useRealTimers();
});

describe('library store — the sidebar count (U-84)', () => {
  it('U-84: warm() reads the unfiltered library once and the count is its length', async () => {
    const api = fakeApi([item('a'), item('b'), item('c')]);
    const store = make(api);
    expect(store.state().all).toBeNull();
    await store.warm();
    expect(api.queries).toEqual([{ type: 'pages.library' }]);
    expect(store.state().all?.length).toBe(3);
  });

  it('U-84: the count follows workOrders.changed even while the screen is closed, and a failed read keeps it', async () => {
    const rows = [item('a')];
    const api = fakeApi(rows);
    const changes = fakeChanges();
    const store = make(api, changes);
    await store.warm();
    rows.push(item('b'));
    changes.emit({ type: 'workOrders.changed' });
    await flush();
    expect(store.state().all?.length).toBe(2);
    api.answer = () => Promise.resolve({ ok: false, code: 'invalid_id' });
    changes.emit({ type: 'workOrders.changed' });
    await flush();
    expect(store.state().all?.length).toBe(2);
    expect(store.state().failed).toBeNull();
  });

  it("U-84: the count ignores the screen's filters — it is always the whole library", async () => {
    const api = fakeApi([item('a'), item('b', { kind: 'markdown' })]);
    const store = make(api);
    const close = store.open();
    await flush();
    store.setKind('markdown');
    await vi.advanceTimersByTimeAsync(0);
    await flush();
    expect(store.state().items.map((row) => row.id)).toEqual(['b']);
    expect(store.state().all?.length).toBe(2);
    close();
  });
});

describe('library store — the filter bar (U-85)', () => {
  it('U-85: typing is debounced 200 ms — two keystrokes inside it make one request with the last text', async () => {
    const api = fakeApi([item('a')]);
    const store = make(api);
    const close = store.open();
    await flush();
    api.queries.length = 0;
    store.setQuery('t');
    await vi.advanceTimersByTimeAsync(LIBRARY_DEBOUNCE_MS - 50);
    store.setQuery('taslak');
    expect(store.state().filters.q).toBe('taslak');
    await vi.advanceTimersByTimeAsync(LIBRARY_DEBOUNCE_MS - 1);
    expect(api.queries.filter((query) => query.q !== undefined)).toEqual([]);
    await vi.advanceTimersByTimeAsync(1);
    await flush();
    expect(api.queries.filter((query) => query.q !== undefined)).toEqual([{ type: 'pages.library', q: 'taslak' }]);
    close();
    expect(LIBRARY_DEBOUNCE_MS).toBe(200);
  });

  it("U-85: kind, project and Sabitler ask at once and are sent as the query's own fields", async () => {
    const api = fakeApi([item('a')]);
    const store = make(api);
    const close = store.open();
    await flush();
    api.queries.length = 0;
    store.setKind('diagram');
    await flush();
    store.setProject('antero');
    await flush();
    store.setView('pinned');
    await flush();
    expect(api.queries.filter((query) => query.kind !== undefined || query.project !== undefined || query.pinned !== undefined)).toEqual([
      { type: 'pages.library', kind: 'diagram' },
      { type: 'pages.library', kind: 'diagram', project: 'antero' },
      { type: 'pages.library', kind: 'diagram', project: 'antero', pinned: true },
    ]);
    store.setKind('all');
    store.setProject('');
    store.setView('new');
    await flush();
    expect(api.queries[api.queries.length - 1]).toEqual({ type: 'pages.library' });
    close();
  });

  it('U-85: the search text is trimmed before it is sent, and a blank text sends no q at all', async () => {
    const api = fakeApi([item('a')]);
    const store = make(api);
    const close = store.open();
    await flush();
    api.queries.length = 0;
    store.setQuery('  giris  ');
    await vi.advanceTimersByTimeAsync(LIBRARY_DEBOUNCE_MS);
    await flush();
    store.setQuery('   ');
    await vi.advanceTimersByTimeAsync(LIBRARY_DEBOUNCE_MS);
    await flush();
    expect(api.queries.map((query) => query.q)).toEqual(['giris', undefined]);
    close();
  });

  it('U-85: a reply that arrives after a newer request is ignored', async () => {
    const api = fakeApi();
    const store = make(api);
    const pending: Array<(value: unknown) => void> = [];
    api.answer = () => new Promise((resolve) => pending.push(resolve));
    const close = store.open();
    await flush();
    pending[0]?.([]);
    await flush();
    store.setKind('html');
    await flush();
    store.setKind('table');
    await flush();
    expect(pending.length).toBe(3);
    // The newest answers first, then the stale one.
    pending[2]?.([item('new', { kind: 'table' })]);
    await flush();
    pending[1]?.([item('stale', { kind: 'html' })]);
    await flush();
    expect(store.state().items.map((row) => row.id)).toEqual(['new']);
    close();
  });

  it('U-85: the kind list is Tümü … Rapor, and Resim only when the loaded data holds an image page or Resim is chosen', () => {
    const none = libraryKindOptions([item('a')], 'all');
    expect(none).toEqual(['all', 'html', 'diagram', 'markdown', 'table', 'report']);
    expect(libraryKindOptions([item('a'), item('b', { kind: 'image' })], 'all')).toEqual([...none, 'image']);
    expect(libraryKindOptions([], 'image')).toEqual([...none, 'image']);
    expect(libraryKindOptions(null, 'all')).toEqual(none);
  });

  it('U-85: the project list is the projects of the loaded library — once each, in name order, pages without a project add none', () => {
    const rows = [
      item('a', { project: { slug: 'docket', name: 'Docket' } }),
      item('b', { project: { slug: 'antero', name: 'Antero' } }),
      item('c', { project: { slug: 'docket', name: 'Docket' } }),
      item('d'),
    ];
    expect(libraryProjectOptions(rows)).toEqual([
      { slug: 'antero', name: 'Antero' },
      { slug: 'docket', name: 'Docket' },
    ]);
    expect(libraryProjectOptions(null)).toEqual([]);
  });

  it('U-85: the option lists come from the whole library, so choosing a project does not shrink its own option list', async () => {
    const rows = [
      item('a', { project: { slug: 'docket', name: 'Docket' } }),
      item('b', { project: { slug: 'antero', name: 'Antero' } }),
    ];
    const store = make(fakeApi(rows));
    const close = store.open();
    await flush();
    store.setProject('antero');
    await flush();
    expect(store.state().items.map((row) => row.id)).toEqual(['b']);
    expect(libraryProjectOptions(store.state().all).map((entry) => entry.slug)).toEqual(['antero', 'docket']);
    close();
  });
});

describe('library store — pinning (U-87)', () => {
  it('U-87: pin toggles at once, sends page.pin and keeps the new standing on ok', async () => {
    const api = fakeApi([item('a')]);
    const store = make(api);
    const close = store.open();
    await flush();
    const done = store.pin('a', true);
    expect(store.state().items[0]?.pinned).toBe(true);
    expect(await done).toEqual({ ok: true });
    expect(api.commands).toEqual([{ type: 'page.pin', page: 'a', pinned: true }]);
    expect(store.state().items[0]?.pinned).toBe(true);
    close();
  });

  it('U-87: a refusal rolls the toggle back and hands the refusal to the caller', async () => {
    const api = fakeApi([item('a')]);
    api.result = { ok: false, code: 'too_many_pinned' };
    const store = make(api);
    const close = store.open();
    await flush();
    const result = await store.pin('a', true);
    expect(result).toEqual({ ok: false, code: 'too_many_pinned' });
    expect(store.state().items[0]?.pinned).toBe(false);
    expect(store.state().all?.[0]?.pinned).toBe(false);
    close();
  });

  it('U-87: a refresh that lands while the pin is in flight does not undo the optimistic toggle', async () => {
    const rows = [item('a')];
    const api = fakeApi(rows);
    const store = make(api);
    const close = store.open();
    await flush();
    let release: (value: CommandResult) => void = () => undefined;
    api.command = () => new Promise((resolve) => (release = resolve));
    const done = store.pin('a', true);
    await vi.advanceTimersByTimeAsync(LIBRARY_POLL_MS);
    await flush();
    expect(store.state().items[0]?.pinned).toBe(true);
    release({ ok: true });
    await done;
    close();
  });

  it('U-87: in Sabitler an unpinned card leaves the list at once', async () => {
    const api = fakeApi([item('a', { pinned: true }), item('b', { pinned: true })]);
    const store = make(api);
    const close = store.open();
    await flush();
    store.setView('pinned');
    await flush();
    expect(store.state().items.map((row) => row.id)).toEqual(['a', 'b']);
    const done = store.pin('a', false);
    expect(store.state().items.map((row) => row.id)).toEqual(['b']);
    await done;
    close();
  });
});

describe('library store — phases and the cap (U-88)', () => {
  it('U-88: before any reply the phase is loading — never an empty or ready flash', () => {
    const api = fakeApi();
    api.answer = () => new Promise(() => undefined);
    const store = make(api);
    const close = store.open();
    expect(libraryPhase(store.state())).toBe('loading');
    close();
  });

  it('U-88: an empty library, a filtered-empty one, a ready one and a failed one are four phases', async () => {
    const api = fakeApi([item('a')]);
    const store = make(api);
    const close = store.open();
    await flush();
    expect(libraryPhase(store.state())).toBe('ready');
    store.setKind('table');
    await flush();
    expect(libraryPhase(store.state())).toBe('filtered-empty');
    store.setKind('all');
    api.answer = () => Promise.resolve([]);
    await flush();
    await store.retry();
    expect(libraryPhase(store.state())).toBe('empty');
    api.answer = () => Promise.resolve({ ok: false, code: 'invalid_id' });
    await store.retry();
    expect(libraryPhase(store.state())).toBe('error');
    expect(store.state().failed).toBe('invalid_id');
    api.answer = () => Promise.resolve([item('z')]);
    await store.retry();
    expect(libraryPhase(store.state())).toBe('ready');
    expect(store.state().failed).toBeNull();
    close();
  });

  it('U-88: a failed first load is an error, not a blank area', async () => {
    const api = fakeApi();
    api.answer = () => Promise.resolve({ ok: false, code: 'definitions_invalid' });
    const store = make(api);
    const close = store.open();
    await flush();
    expect(libraryPhase(store.state())).toBe('error');
    close();
  });

  it('U-88: the cap line shows at 500 filtered items and not at 499', async () => {
    const many = (n: number) => Array.from({ length: n }, (_, index) => item(`p${index}`));
    const api = fakeApi();
    api.answer = () => Promise.resolve(many(LIBRARY_CAP));
    const store = make(api);
    const close = store.open();
    await flush();
    expect(store.state().capped).toBe(true);
    api.answer = () => Promise.resolve(many(LIBRARY_CAP - 1));
    await store.retry();
    expect(store.state().capped).toBe(false);
    close();
    expect(LIBRARY_CAP).toBe(500);
  });
});

describe('library store — refresh (U-89)', () => {
  it('U-89: workOrders.changed re-reads silently — no loading flag, the list stays', async () => {
    const rows = [item('a')];
    const api = fakeApi(rows);
    const changes = fakeChanges();
    const store = make(api, changes);
    const close = store.open();
    await flush();
    rows.push(item('b'));
    const seen: boolean[] = [];
    store.subscribe(() => seen.push(store.state().loading));
    changes.emit({ type: 'workOrders.changed' });
    await flush();
    expect(store.state().items.map((row) => row.id)).toEqual(['a', 'b']);
    expect(seen.some(Boolean)).toBe(false);
    close();
  });

  it('U-89: while the screen is open the library is re-read every 10 s, and no longer after it closes', async () => {
    const api = fakeApi([item('a')]);
    const store = make(api);
    const close = store.open();
    await flush();
    api.queries.length = 0;
    await vi.advanceTimersByTimeAsync(LIBRARY_POLL_MS);
    expect(api.queries.length).toBe(1);
    await vi.advanceTimersByTimeAsync(LIBRARY_POLL_MS);
    expect(api.queries.length).toBe(2);
    close();
    await vi.advanceTimersByTimeAsync(LIBRARY_POLL_MS * 3);
    expect(api.queries.length).toBe(2);
    expect(LIBRARY_POLL_MS).toBe(10_000);
  });

  it('U-89: a silent refresh that fails keeps the list and shows no error', async () => {
    const api = fakeApi([item('a')]);
    const store = make(api);
    const close = store.open();
    await flush();
    api.answer = () => Promise.resolve({ ok: false, code: 'invalid_id' });
    await vi.advanceTimersByTimeAsync(LIBRARY_POLL_MS);
    await flush();
    expect(libraryPhase(store.state())).toBe('ready');
    expect(store.state().items.length).toBe(1);
    close();
  });

  it('U-89: filters survive a close and an open — the screen the operator left comes back as it was', async () => {
    const api = fakeApi([item('a')]);
    const store = make(api);
    let close = store.open();
    await flush();
    store.setKind('html');
    store.setProject('antero');
    close();
    close = store.open();
    expect(store.state().filters).toMatchObject({ kind: 'html', project: 'antero' });
    close();
  });
});
