// stores/library.ts — the Artifact'lar library's store (U-84 … U-89): the `pages.library` reader
// with the filter bar's four filters, the pin command with its optimistic toggle and rollback, and
// the whole refresh story — the 200 ms search debounce, the newest-request-wins rule, the silent
// re-read on `workOrders.changed` and every 10 s while the screen is open. Besides the filtered list
// the store keeps the unfiltered one (`all`): it is the sidebar's count and the source of the
// project and kind option lists, so a chosen filter never shrinks the list it was chosen from. A
// page's title and project name are untrusted text: the store only carries them to the screen.
import type { Api } from '../../api/api';
import type { CommandResult } from '../../api/commands';
import type { PageLibraryItemView, Query } from '../../api/queries';
import type { Actor, PageKind } from '../../domain/index';
import { isQueryFailure } from './results';

/** The coarse change events the api emits (U-12); only work-order changes move the library. */
export type LibraryChange =
  | { readonly type: 'workOrders.changed' }
  | { readonly type: 'run.updated'; readonly runId: string }
  | { readonly type: 'update.changed' }
  | { readonly type: 'accounts.changed' };

export type LibraryChangeSignal = (listener: (change: LibraryChange) => void) => () => void;

/** How long typing must rest before the search is sent. */
export const LIBRARY_DEBOUNCE_MS = 200;
/** How often an open library is re-read, besides the change events. */
export const LIBRARY_POLL_MS = 10_000;
/** The api answers at most this many pages; reaching it means the list may be cut. */
export const LIBRARY_CAP = 500;

export type LibraryKind = 'all' | PageKind;
export type LibraryView = 'new' | 'pinned';

export interface LibraryFilters {
  /** The text as typed; the request carries it trimmed. */
  readonly q: string;
  readonly kind: LibraryKind;
  /** A project slug; '' is every project. */
  readonly project: string;
  readonly view: LibraryView;
}

export const DEFAULT_LIBRARY_FILTERS: LibraryFilters = { q: '', kind: 'all', project: '', view: 'new' };

export interface LibraryState {
  readonly filters: LibraryFilters;
  /** The pages the filters select, as the screen draws them. */
  readonly items: readonly PageLibraryItemView[];
  /** The whole library, unfiltered; null until the first reply. */
  readonly all: readonly PageLibraryItemView[] | null;
  /** Whether a first reply has ever landed — until then the screen shows its skeleton. */
  readonly loaded: boolean;
  /** A first load is in flight (never set by a silent refresh or a filter change). */
  readonly loading: boolean;
  /** The failure code of the last read the operator asked for; null while it works. */
  readonly failed: string | null;
  /** The filtered reply reached the api's cap, so older pages may be missing. */
  readonly capped: boolean;
}

export type LibraryPhase = 'loading' | 'error' | 'empty' | 'filtered-empty' | 'ready';

/** The screen's standing, decided in one place (U-88): an error never shows a blank grid, and a
 *  library with nothing in it reads differently from a filter that matches nothing. */
export const libraryPhase = (state: LibraryState): LibraryPhase => {
  if (state.failed !== null) return 'error';
  if (!state.loaded) return 'loading';
  if (state.items.length > 0) return 'ready';
  return state.all !== null && state.all.length === 0 ? 'empty' : 'filtered-empty';
};

const KIND_ORDER: readonly PageKind[] = ['html', 'diagram', 'markdown', 'table', 'report'];

/** The kind segment's options (U-85): Tümü and the five kinds; Resim only while the loaded data
 *  holds an image page — or while it is the chosen kind, so the choice never vanishes. */
export const libraryKindOptions = (all: readonly PageLibraryItemView[] | null, current: LibraryKind): readonly LibraryKind[] => {
  const image = current === 'image' || (all?.some((entry) => entry.kind === 'image') ?? false);
  return ['all', ...KIND_ORDER, ...(image ? (['image'] as const) : [])];
};

export interface LibraryProjectOption {
  readonly slug: string;
  readonly name: string;
}

/** The project select's options (U-85): the projects of the whole loaded library, once each, by name. */
export const libraryProjectOptions = (all: readonly PageLibraryItemView[] | null): readonly LibraryProjectOption[] => {
  const seen = new Map<string, LibraryProjectOption>();
  for (const entry of all ?? []) {
    if (entry.project !== undefined && !seen.has(entry.project.slug)) seen.set(entry.project.slug, entry.project);
  }
  return [...seen.values()].sort((a, b) => a.name.localeCompare(b.name, 'tr'));
};

export interface LibraryStoreDeps {
  readonly api: Pick<Api, 'query' | 'command'>;
  readonly changes: LibraryChangeSignal;
  readonly actor: Actor;
}

export interface LibraryStore {
  state(): LibraryState;
  subscribe(listener: () => void): () => void;
  /** Reads the unfiltered library only — the sidebar's count — without touching the screen's list. */
  warm(): Promise<void>;
  /** The screen opens: reads at once (silently when a list already stands) and polls until the
   *  returned close is called. Filters survive a close. */
  open(): () => void;
  /** Re-reads on the operator's request — the error state's Yeniden dene. */
  retry(): Promise<void>;
  /** The search text changed: shown at once, requested after the debounce. */
  setQuery(text: string): void;
  /** Escape in the field: the text goes and the list follows at once. */
  clearQuery(): void;
  setKind(kind: LibraryKind): void;
  setProject(project: string): void;
  setView(view: LibraryView): void;
  /** Pins or unpins a page: the card toggles at once and goes back if the api refuses. */
  pin(page: string, pinned: boolean): Promise<CommandResult>;
}

const isDefault = (filters: LibraryFilters): boolean =>
  filters.q.trim() === '' && filters.kind === 'all' && filters.project === '' && filters.view === 'new';

const queryOf = (filters: LibraryFilters): Query => {
  const q = filters.q.trim();
  return {
    type: 'pages.library',
    ...(q === '' ? {} : { q }),
    ...(filters.kind === 'all' ? {} : { kind: filters.kind }),
    ...(filters.project === '' ? {} : { project: filters.project }),
    ...(filters.view === 'pinned' ? { pinned: true } : {}),
  };
};

const UNFILTERED: Query = { type: 'pages.library' };

type Rows = readonly PageLibraryItemView[];

/** A reply is a list, a failure with a code, or something the contract does not allow. */
const rowsOf = (reply: unknown): Rows | { readonly code: string } => {
  if (isQueryFailure(reply)) return { code: reply.code };
  if (!Array.isArray(reply)) return { code: 'unknown' };
  return reply as Rows;
};

const isFailure = (value: Rows | { readonly code: string }): value is { readonly code: string } => !Array.isArray(value);

export const createLibraryStore = (deps: LibraryStoreDeps): LibraryStore => {
  const { api, changes, actor } = deps;
  let state: LibraryState = { filters: DEFAULT_LIBRARY_FILTERS, items: [], all: null, loaded: false, loading: false, failed: null, capped: false };
  const listeners = new Set<() => void>();
  let opened = 0;
  let poll: ReturnType<typeof setInterval> | null = null;
  let debounce: ReturnType<typeof setTimeout> | null = null;
  // Only the newest request of each kind may land: a slow reply must not overwrite a fresher one.
  let itemsSeq = 0;
  let allSeq = 0;
  // A pin in flight overrides whatever a refresh brings back until the api has answered.
  const pending = new Map<string, boolean>();

  const set = (next: LibraryState): void => {
    state = next;
    for (const listener of [...listeners]) listener();
  };

  const overridden = (rows: Rows, view: LibraryView): Rows => {
    const applied = pending.size === 0 ? rows : rows.map((row) => (pending.has(row.id) ? { ...row, pinned: pending.get(row.id) === true } : row));
    return view === 'pinned' ? applied.filter((row) => row.pinned) : applied;
  };

  /** One read. `scope`: 'screen' re-reads the filtered list (and the unfiltered one when asked or
   *  missing), 'count' only the unfiltered one. Silent reads never show a loading or an error. */
  const read = async (scope: 'screen' | 'count', options: { readonly silent: boolean; readonly withAll: boolean }): Promise<void> => {
    const filters = state.filters;
    const wantItems = scope === 'screen';
    const sameQuery = isDefault(filters);
    const wantAll = !wantItems || options.withAll || state.all === null || sameQuery;
    const mine = wantItems ? ++itemsSeq : itemsSeq;
    const myAll = wantAll ? ++allSeq : allSeq;
    if (wantItems && !options.silent && !state.loaded) set({ ...state, loading: true });

    const itemsReply = wantItems ? api.query(queryOf(filters)) : null;
    // A default filter set asks the same question twice: one reply serves both.
    const allReply = wantAll ? (wantItems && sameQuery ? itemsReply : api.query(UNFILTERED)) : null;
    const [itemsRows, allRows] = await Promise.all([
      itemsReply === null ? Promise.resolve(null) : itemsReply.then(rowsOf),
      allReply === null ? Promise.resolve(null) : allReply.then(rowsOf),
    ]);

    let next = state;
    if (allRows !== null && myAll === allSeq && !isFailure(allRows)) next = { ...next, all: overridden(allRows, 'new') };
    if (itemsRows !== null && mine === itemsSeq) {
      if (isFailure(itemsRows)) {
        // A silent read that fails keeps the list the operator is looking at.
        if (!options.silent) next = { ...next, loading: false, failed: itemsRows.code };
      } else {
        next = { ...next, items: overridden(itemsRows, filters.view), capped: itemsRows.length >= LIBRARY_CAP, loaded: true, loading: false, failed: null };
      }
    }
    if (next !== state) set(next);
  };

  const filterChanged = (patch: Partial<LibraryFilters>): void => {
    if (debounce !== null) clearTimeout(debounce);
    debounce = null;
    set({ ...state, filters: { ...state.filters, ...patch } });
    void read('screen', { silent: false, withAll: false });
  };

  const refresh = (): Promise<void> => (opened > 0 ? read('screen', { silent: true, withAll: true }) : read('count', { silent: true, withAll: true }));

  changes((change) => {
    if (change.type === 'workOrders.changed') void refresh();
  });

  return {
    state: () => state,
    subscribe: (listener) => {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
    warm: () => read('count', { silent: true, withAll: true }),
    open: () => {
      opened += 1;
      if (opened === 1) poll = setInterval(() => void read('screen', { silent: true, withAll: true }), LIBRARY_POLL_MS);
      void read('screen', { silent: state.loaded && state.failed === null, withAll: true });
      let closed = false;
      return () => {
        if (closed) return;
        closed = true;
        opened -= 1;
        if (opened === 0) {
          if (poll !== null) clearInterval(poll);
          poll = null;
          if (debounce !== null) clearTimeout(debounce);
          debounce = null;
        }
      };
    },
    retry: () => read('screen', { silent: false, withAll: true }),
    setQuery: (text) => {
      if (debounce !== null) clearTimeout(debounce);
      set({ ...state, filters: { ...state.filters, q: text } });
      debounce = setTimeout(() => {
        debounce = null;
        void read('screen', { silent: false, withAll: false });
      }, LIBRARY_DEBOUNCE_MS);
    },
    clearQuery: () => filterChanged({ q: '' }),
    setKind: (kind) => filterChanged({ kind }),
    setProject: (project) => filterChanged({ project }),
    setView: (view) => filterChanged({ view }),
    pin: async (page, pinned) => {
      const before = (state.items.find((row) => row.id === page) ?? state.all?.find((row) => row.id === page))?.pinned ?? !pinned;
      const mark = (value: boolean): void => {
        const toggle = (rows: Rows): Rows => rows.map((row) => (row.id === page ? { ...row, pinned: value } : row));
        set({
          ...state,
          items: state.filters.view === 'pinned' ? toggle(state.items).filter((row) => row.pinned) : toggle(state.items),
          all: state.all === null ? null : toggle(state.all),
        });
      };
      pending.set(page, pinned);
      mark(pinned);
      const result = await api.command(actor, { type: 'page.pin', page, pinned });
      pending.delete(page);
      // The api did not confirm: the card goes back to what it was, and the caller says why.
      if (!result.ok) {
        const restore = (rows: Rows): Rows => rows.map((row) => (row.id === page ? { ...row, pinned: before } : row));
        set({ ...state, items: restore(state.items), all: state.all === null ? null : restore(state.all) });
        // Sabitler dropped the card when it was unpinned; only a re-read can bring it back.
        if (state.filters.view === 'pinned') void read('screen', { silent: true, withAll: true });
      }
      return result;
    },
  };
};
