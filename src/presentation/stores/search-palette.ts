// stores/search-palette.ts — the centered search palette's pure state (U-15). The palette
// searches the sidebar tree's own names and nothing else: a project result opens the roadmap, a
// repo result the board, exactly as the tree's rows do. The index is the `project.tree` query the
// shell already holds — no second query, no other entity kinds. The reducer owns open/close, the
// query's results and the keyboard's selection; the component renders these decisions and adds
// only the DOM (focus, trap, scrim).
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
 *  input row alone), the rows once a typed query matches, the no-results line once it does not. */
export type PaletteBody = 'none' | 'results' | 'no-results';

/** The visible body is a pure function of the query and the result count — the component renders
 *  it and nothing else decides it. */
export const paletteBody = (query: string, resultCount: number): PaletteBody => {
  if (query.trim() === '') return 'none';
  return resultCount > 0 ? 'results' : 'no-results';
};

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
