// stores/search-palette.ts — the centered search palette's pure state (U-15). The palette
// searches the sidebar tree's own names and nothing else: a project result opens the roadmap, a
// repo result the board, exactly as the tree's rows do. The index is the `project.tree` query the
// shell already holds — no second query, no other entity kinds. The reducer owns open/close, the
// query's results and the keyboard's selection; the component renders these decisions and adds
// only the DOM (focus, trap, scrim). The module also owns the palette's own memory — the recent
// queries (the history) as pure list computations over an injected storage slice.
import type { ProjectTree } from '../../api/queries';

/** One palette row: a project's roadmap or a repo's board — the tree's two row kinds. */
export type PaletteResult =
  | { readonly kind: 'project'; readonly project: string; readonly name: string }
  | { readonly kind: 'repo'; readonly project: string; readonly repo: string; readonly name: string };

/** How the palette was opened: a pointer press on the Ara button, or the keyboard (⌘K, or key
 *  activation of the button). It decides where focus lands when the palette closes. */
export type PaletteOrigin = 'pointer' | 'keyboard';

export interface PaletteState {
  readonly open: boolean;
  /** The input's text, verbatim; matching trims and lowers its own copy. */
  readonly query: string;
  readonly results: readonly PaletteResult[];
  /** The row the keyboard sits on — an index into `results`, zero while they are empty. */
  readonly selected: number;
  /** Stamped by the open, read by the close. */
  readonly origin: PaletteOrigin;
}

/** The close's focus decision: a pointer-opened palette blurs on close — the opener never asked
 *  for the keyboard, so handing its button keyboard-style focus would leave a focus ring it did
 *  not earn; a keyboard-opened one returns focus to where it was taken from. */
export const focusRestoredOnClose = (origin: PaletteOrigin): boolean => origin === 'keyboard';

/** What the palette shows under the input: nothing while the query is empty (the palette is the
 *  input row alone), the rows once a settled query matches, the no-results line once it does
 *  not — and `keep` while a typed query is still settling, meaning "hold the current standing":
 *  the settled rows stay on screen, a folded body stays folded. The line belongs to its settled
 *  query alone, so a query in flight can never flash it. */
export type PaletteBody = 'none' | 'results' | 'no-results' | 'keep';

/** The visible body is a pure function of the query, the query the settled list answers, and the
 *  settled count — the component renders it and nothing else decides it. */
export const paletteBody = (query: string, settledQuery: string, settledCount: number): PaletteBody => {
  if (query.trim() === '') return 'none';
  if (query !== settledQuery) return 'keep';
  return settledCount > 0 ? 'results' : 'no-results';
};

/** The first typed character settles at once: with nothing settled yet (the palette just opened,
 *  or the field was cleared) there is no previous list to protect, so the debounce has nothing
 *  to buy — it only smooths the change from the second keystroke on. */
export const settlesAtOnce = (settledQuery: string): boolean => settledQuery.trim() === '';

/** A row's identity: its kind and its target — the same key the DOM rows render by, so a project
 *  and a repo that share a name stay two rows. */
export const paletteRowId = (result: PaletteResult): string =>
  result.kind === 'project' ? `project:${result.project}` : `repo:${result.repo}`;

/** How one settled list becomes the next: rows keyed by id, `staying` and `entering` in `next`'s
 *  order, `leaving` in `previous`'s. The component renders `staying` and `entering` where they
 *  stand and walks `leaving` out — the diff is pure so the settling itself stays testable. */
export interface RowDiff {
  readonly entering: readonly PaletteResult[];
  readonly staying: readonly PaletteResult[];
  readonly leaving: readonly PaletteResult[];
}

export const diffRows = (
  previous: readonly PaletteResult[],
  next: readonly PaletteResult[],
): RowDiff => {
  const previousIds = new Set(previous.map(paletteRowId));
  const nextIds = new Set(next.map(paletteRowId));
  const entering: PaletteResult[] = [];
  const staying: PaletteResult[] = [];
  for (const result of next) {
    (previousIds.has(paletteRowId(result)) ? staying : entering).push(result);
  }
  const leaving: PaletteResult[] = previous.filter((result) => !nextIds.has(paletteRowId(result)));
  return { entering, staying, leaving };
};

export type PaletteAction =
  | { readonly type: 'open'; readonly origin: PaletteOrigin }
  | { readonly type: 'close' }
  | { readonly type: 'query'; readonly value: string; readonly tree: ProjectTree }
  | { readonly type: 'move'; readonly delta: -1 | 1 };

/** The standing the shell boots with and returns to once the palette has done its work. The
 *  origin's default never fires: it is read only on a close that follows an open. */
export const CLOSED_PALETTE: PaletteState = {
  open: false,
  query: '',
  results: [],
  selected: 0,
  origin: 'keyboard',
};

/** The palette's whole index: projects and repos by name, case-insensitively, in the tree's own
 *  order (a project, then its matching repos). An empty or blank query matches nothing — the
 *  palette never lists the tree unasked. */
export const searchTree = (tree: ProjectTree, query: string): readonly PaletteResult[] => {
  const needle = query.trim().toLowerCase();
  if (needle === '') return [];
  const out: PaletteResult[] = [];
  for (const item of tree) {
    if (item.name.toLowerCase().includes(needle)) {
      out.push({ kind: 'project', project: item.project, name: item.name });
    }
    for (const node of item.repos) {
      if (node.name.toLowerCase().includes(needle)) {
        out.push({ kind: 'repo', project: item.project, repo: node.repo, name: node.name });
      }
    }
  }
  return out;
};

export const paletteReducer = (state: PaletteState, action: PaletteAction): PaletteState => {
  switch (action.type) {
    // A fresh open starts empty and stamps how it was opened; an open palette keeps its place,
    // so a stray ⌘K never clears what the operator is typing.
    case 'open':
      return state.open
        ? state
        : { open: true, query: '', results: [], selected: 0, origin: action.origin };
    case 'close':
      return state.open ? { ...state, open: false } : state;
    case 'query': {
      if (!state.open) return state;
      const results = searchTree(action.tree, action.value);
      // A new query makes a new list: the selection returns to its first row. The open's origin
      // outlives the typing — it is the close's business, not the query's.
      return { ...state, open: true, query: action.value, results, selected: 0 };
    }
    case 'move': {
      const count = state.results.length;
      if (!state.open || count === 0) return state;
      return { ...state, selected: (state.selected + action.delta + count) % count };
    }
  }
};

// --- the search history ------------------------------------------------------------------------------
//
// What the palette remembers: recent queries, recorded only when the operator opens a result
// (Enter or a click) — never per keystroke, never on a dismiss without an opening. A recorded
// query is trimmed, at least two characters and cut at sixty; re-querying moves the entry to the
// top instead of duplicating it (compared case-insensitively); the list holds the newest ten,
// most recent first. It persists per viewer in local storage beside the board's view choice — a
// convenience, never a record: queries are project and repo names, nothing secret.

/** The storage key the palette's history persists under. */
export const SEARCH_HISTORY_KEY = 'docket.searchHistory.v1';
export const SEARCH_HISTORY_LIMIT = 10;
export const SEARCH_HISTORY_MIN_CHARS = 2;
export const SEARCH_HISTORY_MAX_CHARS = 60;

/** The remembered queries, most recent first. */
export type SearchHistory = readonly string[];

export const EMPTY_HISTORY: SearchHistory = [];

/** Records one query: trimmed, at least two characters, cut at sixty. The previous copy of the
 *  same query (case-insensitively) leaves so the fresh one can lead; past the limit the oldest
 *  entry drops. A query too short or blank records nothing — the same list returns untouched. */
export const recordSearch = (history: SearchHistory, query: string): SearchHistory => {
  const entry = query.trim().slice(0, SEARCH_HISTORY_MAX_CHARS);
  if (entry.length < SEARCH_HISTORY_MIN_CHARS) return history;
  const fold = entry.toLowerCase();
  return [entry, ...history.filter((kept) => kept.toLowerCase() !== fold)].slice(0, SEARCH_HISTORY_LIMIT);
};

/** Removes every entry that is the query (trimmed, case-insensitively) — the × beside a row. */
export const removeSearch = (history: SearchHistory, query: string): SearchHistory => {
  const fold = query.trim().toLowerCase();
  return history.filter((kept) => kept.toLowerCase() !== fold);
};

/** Temizle: the whole list goes at once — ten old queries never earn a confirmation. */
export const clearSearches = (): SearchHistory => EMPTY_HISTORY;

/** What storage holds: the capped list as JSON. */
export const serializeHistory = (history: SearchHistory): string =>
  JSON.stringify(history.slice(0, SEARCH_HISTORY_LIMIT));

/** What storage says, tolerated: anything unreadable or wrongly shaped reads as empty, and the
 *  survivors are held to the record path's own rules — strings only, trimmed, cut at sixty,
 *  deduped case-insensitively, at most ten — so a corrupt value can never seed the palette with
 *  an entry the record path itself would refuse. */
export const parseHistory = (raw: string | null): SearchHistory => {
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw ?? '');
  } catch {
    return EMPTY_HISTORY;
  }
  if (!Array.isArray(parsed)) return EMPTY_HISTORY;
  const out: string[] = [];
  for (const item of parsed) {
    if (typeof item !== 'string') continue;
    const entry = item.trim().slice(0, SEARCH_HISTORY_MAX_CHARS);
    if (entry.length < SEARCH_HISTORY_MIN_CHARS) continue;
    if (out.some((kept) => kept.toLowerCase() === entry.toLowerCase())) continue;
    out.push(entry);
    if (out.length === SEARCH_HISTORY_LIMIT) break;
  }
  return out;
};

/** The structural slice of DOM storage the history persists through; localStorage satisfies it
 *  as-is (the same narrowing as the board's and the tree's persistence). */
export interface SearchHistoryPersistence {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
}

/** The stored list, or empty when storage answers nothing usable — a failed read never opens a
 *  broken palette. */
export const readSearchHistory = (persistence: SearchHistoryPersistence): SearchHistory => {
  try {
    return parseHistory(persistence.getItem(SEARCH_HISTORY_KEY));
  } catch {
    return EMPTY_HISTORY;
  }
};

/** Persists the list; a store that refuses the write is ignored — the history is a convenience
 *  for this viewer, not a record the app owes anyone. */
export const writeSearchHistory = (persistence: SearchHistoryPersistence, history: SearchHistory): void => {
  try {
    persistence.setItem(SEARCH_HISTORY_KEY, serializeHistory(history));
  } catch {
    // A full or blocked store costs the memory between sessions, nothing more.
  }
};
