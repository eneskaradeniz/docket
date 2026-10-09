// stores/nav-history.ts — the shell's navigation history (U-25): where the operator has been and
// where back/forward go. One entry per place — the cockpit, a repo's board, a project's roadmap, a
// work order's detail, an account's view; the settings panel and the search palette are overlays
// and never entries. The whole standing is a pure reducer over `{ entries, index }` the shell
// dispatches into: a push truncates the forward part and stamps the left screen's scroll into its
// entry, back/forward move the index restoring the target's scroll, and entries whose subject no
// longer exists are skipped silently — the walk that finds nothing valid lands on the cockpit.
// Nothing persists: the scroll lives in memory per entry, and the board's Kanban/Liste choice and
// the roadmap/cockpit folds keep their own state elsewhere.
/** Where the shell can be — the routes the history records. Ids only; the screens load their own
 *  data. */
export type NavRoute =
  | { readonly name: 'cockpit' }
  | { readonly name: 'board'; readonly repo: string }
  | { readonly name: 'roadmap'; readonly project: string }
  | { readonly name: 'workOrder'; readonly id: string }
  | { readonly name: 'account'; readonly id: string }
  | { readonly name: 'newProject' };

/** One place the operator stood, with the main column's scroll it had when it was last left. */
export interface NavEntry {
  readonly route: NavRoute;
  readonly scroll: number;
}

export interface NavHistory {
  readonly entries: readonly NavEntry[];
  /** The current entry — the route the shell renders. */
  readonly index: number;
}

/** Whether a route's subject still exists — what the shell answers from the tree and the accounts
 *  it already holds. The history itself never queries anything. */
export type NavExists = (route: NavRoute) => boolean;

/** The history's ceiling: the oldest entry drops once it is passed. */
export const NAV_LIMIT = 50;

const COCKPIT_ROUTE: NavRoute = { name: 'cockpit' };

/** The shell starts on the cockpit — the history's first entry. */
export const START_NAV_HISTORY: NavHistory = { entries: [{ route: COCKPIT_ROUTE, scroll: 0 }], index: 0 };

export const canBack = (state: NavHistory): boolean => state.index > 0;
export const canForward = (state: NavHistory): boolean => state.index < state.entries.length - 1;

/** A route's identity: its kind and its subject — a navigation to the route already current is
 *  nothing and must not become an entry. */
const routeKey = (route: NavRoute): string =>
  route.name === 'board'
    ? `board:${route.repo}`
    : route.name === 'roadmap'
      ? `roadmap:${route.project}`
      : route.name === 'workOrder'
        ? `workOrder:${route.id}`
        : route.name === 'account'
          ? `account:${route.id}`
          : route.name === 'newProject'
            ? 'newProject'
            : 'cockpit';

/** Stamps the scroll of the screen being left into the current entry — every move does this, so
 *  each entry remembers its main column's scroll for the return. */
const stamped = (state: NavHistory, scroll: number): NavHistory => {
  const entry = state.entries[state.index];
  if (entry.scroll === scroll) return state;
  const entries = state.entries.slice();
  entries[state.index] = { ...entry, scroll };
  return { entries, index: state.index };
};

/** Appends the route as the new current entry — the forward part gives way and a fresh arrival
 *  starts at scroll 0 — keeping the history within NAV_LIMIT by dropping the oldest. */
const appended = (state: NavHistory, route: NavRoute): NavHistory => {
  const entries = [...state.entries.slice(0, state.index + 1), { route, scroll: 0 }];
  const kept = entries.length > NAV_LIMIT ? entries.slice(entries.length - NAV_LIMIT) : entries;
  return { entries: kept, index: kept.length - 1 };
};

export type NavAction =
  | { readonly type: 'push'; readonly route: NavRoute; readonly scroll: number }
  | { readonly type: 'back'; readonly exists: NavExists; readonly scroll: number }
  | { readonly type: 'forward'; readonly exists: NavExists; readonly scroll: number };

export const navHistoryReducer = (state: NavHistory, action: NavAction): NavHistory => {
  switch (action.type) {
    case 'push': {
      // A navigation to the route already current adds no entry — not even a scroll stamp.
      if (routeKey(state.entries[state.index].route) === routeKey(action.route)) return state;
      return appended(stamped(state, action.scroll), action.route);
    }
    case 'back': {
      if (!canBack(state)) return state;
      const from = stamped(state, action.scroll);
      let i = from.index - 1;
      while (i >= 0 && !action.exists(from.entries[i].route)) i -= 1;
      if (i >= 0) {
        // The dead entries walked past drop; the forward part stays where it was.
        return { entries: [...from.entries.slice(0, i + 1), ...from.entries.slice(from.index)], index: i };
      }
      // Nothing valid behind: the cockpit is the destination, a push-like landing that keeps only
      // the current entry — unless the current already is the cockpit, which keeps its place.
      const kept = from.entries.slice(from.index);
      if (routeKey(kept[0].route) === 'cockpit') return { entries: kept, index: 0 };
      return appended({ entries: kept, index: 0 }, COCKPIT_ROUTE);
    }
    case 'forward': {
      if (!canForward(state)) return state;
      const from = stamped(state, action.scroll);
      let i = from.index + 1;
      while (i < from.entries.length && !action.exists(from.entries[i].route)) i += 1;
      if (i < from.entries.length) {
        return { entries: [...from.entries.slice(0, from.index + 1), ...from.entries.slice(i)], index: from.index + 1 };
      }
      // Nothing valid ahead: the same cockpit landing, forward of the current entry.
      const kept = from.entries.slice(0, from.index + 1);
      if (routeKey(kept[kept.length - 1].route) === 'cockpit') {
        return { entries: kept, index: kept.length - 1 };
      }
      return appended({ entries: kept, index: kept.length - 1 }, COCKPIT_ROUTE);
    }
  }
};
