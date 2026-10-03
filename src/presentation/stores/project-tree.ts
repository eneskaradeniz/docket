// stores/project-tree.ts — the sidebar's project → repo tree (U-15): it mirrors the
// `project.tree` query and re-queries on the same coarse change events the shell listens to, so
// the status dots and pills move with the work orders and runs. The row shapes (group vs flat),
// the selection states (K-2/K-3/K-7) and the pill's zero rule are pure derivations here, so the
// shell renders without deciding anything. The groups' expanded state lives in memory — it is
// kept for the session, not across restarts. The sort mode cycles stored → A→Z → recently used
// and persists through the injected persistence; "recently used" reads the stamps the store
// records whenever the operator opens a project from the tree.
import type { Api } from '../../api/api';
import type { ProjectTree, ProjectTreeItem, Query } from '../../api/queries';
import { isQueryFailure } from './results';
import type { ShellChangeSignal } from './shell';

export const TREE_SORT_STORAGE_KEY = 'docket.tree.sort';

/** The sort modes of the projects header: the query's own order, A→Z by name, most recently
 *  used first. */
export type TreeSort = 'stored' | 'alpha' | 'recent';

/** The structural slice of DOM storage the sort choice persists through; localStorage satisfies
 *  it as-is (the locale store's persistence, narrowed the same way). */
export interface TreePersistence {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
}

export interface ProjectTreeStoreDeps {
  readonly api: Pick<Api, 'query'>;
  readonly changes: ShellChangeSignal;
  /** Milliseconds source for the recently-used stamps; composition passes the clock, tests a
   *  fixed one. */
  readonly now: () => number;
  readonly persistence: TreePersistence;
}

/** The tree state the shell renders. A failed query keeps the last tree — a failure must not
 *  blank the navigation. */
export interface ProjectTreeState {
  readonly loading: boolean;
  readonly tree: ProjectTree;
  /** The failure code of the latest failed query; null while healthy. */
  readonly problem: string | null;
  readonly sort: TreeSort;
  /** The projects whose repo groups are open; groups start open, a flat row never enters. */
  readonly expanded: readonly string[];
  /** Project → the millisecond it was last opened from the tree (the recently-used order). */
  readonly usedAt: Readonly<Record<string, number>>;
}

export interface ProjectTreeStore {
  load(): Promise<void>;
  /** Opens or closes one project's repo group; flat rows ignore it. */
  toggle(project: string): void;
  /** Steps the sort mode stored → alpha → recent → stored and persists the choice. */
  cycleSort(): void;
  /** Stamps the project as just opened, feeding the recently-used order. */
  recordUse(project: string): void;
  state(): ProjectTreeState;
  subscribe(listener: () => void): () => void;
}

const SORTS: readonly TreeSort[] = ['stored', 'alpha', 'recent'];

const isTreeSort = (value: string): value is TreeSort =>
  value === 'stored' || value === 'alpha' || value === 'recent';

/** Anything missing or unreadable in storage means the query's own order, never a broken sort. */
const storedSort = (persistence: TreePersistence): TreeSort => {
  const raw = persistence.getItem(TREE_SORT_STORAGE_KEY);
  return raw !== null && isTreeSort(raw) ? raw : 'stored';
};

/** One sidebar row: a multi-repo project renders a collapsible group, a project that is one
 *  repo renders one flat row that opens that repo's board. */
export type TreeRow =
  | { readonly kind: 'group'; readonly item: ProjectTreeItem }
  | { readonly kind: 'flat'; readonly item: ProjectTreeItem; readonly repo: string | null };

export const projectRows = (tree: ProjectTree): readonly TreeRow[] =>
  tree.map((item) =>
    item.repos.length === 1
      ? { kind: 'flat' as const, item, repo: item.repos[0]?.repo ?? null }
      : { kind: 'group' as const, item },
  );

/** The pill count of a row: the total active work orders, present only above zero — a zero is
 *  absent, never rendered (U-10). */
export const pillCount = (active: number): number | null => (active > 0 ? active : null);

/** The tree in the sort mode's order; the input is not mutated. A→Z reads case-insensitively so
 *  the case of a slug never moves a project. */
export const orderTree = (
  tree: ProjectTree,
  sort: TreeSort,
  usedAt: Readonly<Record<string, number>>,
): ProjectTree => {
  if (sort === 'stored') return tree;
  const rows = [...tree];
  if (sort === 'alpha') {
    rows.sort((a, b) => {
      const left = a.name.toLowerCase();
      const right = b.name.toLowerCase();
      return left < right ? -1 : left > right ? 1 : 0;
    });
    return rows;
  }
  // Recently used first, most recent stamp winning; a project never used keeps the stored order
  // after every used one.
  rows.sort((a, b) => (usedAt[b.project] ?? 0) - (usedAt[a.project] ?? 0));
  return rows;
};

/** Where the operator currently is, expressed over the tree only — the shell maps its route
 *  here, with a work order's detail carried by the place it was opened from. */
export type TreePlace =
  | { readonly kind: 'cockpit' }
  | { readonly kind: 'settings' }
  | { readonly kind: 'roadmap'; readonly project: string }
  | { readonly kind: 'repo'; readonly repo: string };

export interface TreeSelection {
  /** The project row's standing: `sel` on its own roadmap, `psel` while one of its repos is
   *  active, null when nothing points at it. */
  readonly project: { readonly id: string; readonly state: 'sel' | 'psel' } | null;
  /** The repo row that reads selected, when the place is a repo's board. */
  readonly repo: string | null;
}

/** K-2/K-3/K-7: a project row is selected on the roadmap; a repo row — the main repo ★ included
 *  — opens its board and keeps its project pale-selected. A flat project is both row kinds at
 *  once, so its single row reads selected, not pale. A repo the tree does not know selects
 *  nothing. */
export const treeSelection = (tree: ProjectTree, place: TreePlace): TreeSelection => {
  if (place.kind === 'roadmap') {
    return tree.some((item) => item.project === place.project)
      ? { project: { id: place.project, state: 'sel' }, repo: null }
      : { project: null, repo: null };
  }
  if (place.kind !== 'repo') return { project: null, repo: null };
  const owner = tree.find((item) => item.repos.some((repo) => repo.repo === place.repo));
  if (owner === undefined) return { project: null, repo: null };
  return {
    project: { id: owner.project, state: owner.repos.length === 1 ? 'sel' : 'psel' },
    repo: place.repo,
  };
};

export const createProjectTreeStore = (deps: ProjectTreeStoreDeps): ProjectTreeStore => {
  const { api, changes, now, persistence } = deps;

  let state: ProjectTreeState = {
    loading: false,
    tree: [],
    problem: null,
    sort: storedSort(persistence),
    expanded: [],
    usedAt: {},
  };
  const listeners = new Set<() => void>();
  // Only the newest attempt may apply its reply, so a slow earlier query never overwrites a
  // fresher tree when change events stack up.
  let attempts = 0;
  // The groups this session has already shown: a re-query opens a group only the first time it
  // appears — one the operator collapsed stays collapsed.
  const seenGroups = new Set<string>();

  const set = (next: ProjectTreeState): void => {
    state = next;
    for (const listener of [...listeners]) listener();
  };

  const load = async (): Promise<void> => {
    const attempt = attempts + 1;
    attempts = attempt;
    set({ ...state, loading: true });
    const reply: unknown = await api.query({ type: 'project.tree' } satisfies Query);
    if (attempt !== attempts) return;
    if (isQueryFailure(reply)) {
      set({ ...state, loading: false, problem: reply.code });
      return;
    }
    const tree = reply as ProjectTree;
    const fresh = expandedOf(tree).filter((id) => !seenGroups.has(id));
    for (const id of expandedOf(tree)) seenGroups.add(id);
    set({
      ...state,
      loading: false,
      problem: null,
      tree,
      expanded: fresh.length > 0 ? [...state.expanded, ...fresh] : state.expanded,
    });
  };

  changes(() => {
    void load();
  });

  return {
    load,
    toggle: (project) => {
      // A flat row has nothing to open: only a group's chevron toggles.
      const item = state.tree.find((entry) => entry.project === project);
      if (item === undefined || item.repos.length <= 1) return;
      const open = state.expanded.includes(project);
      set({
        ...state,
        expanded: open ? state.expanded.filter((id) => id !== project) : [...state.expanded, project],
      });
    },
    cycleSort: () => {
      const next = SORTS[(SORTS.indexOf(state.sort) + 1) % SORTS.length] ?? 'stored';
      persistence.setItem(TREE_SORT_STORAGE_KEY, next);
      set({ ...state, sort: next });
    },
    recordUse: (project) => {
      set({ ...state, usedAt: { ...state.usedAt, [project]: now() } });
    },
    state: () => state,
    subscribe: (listener) => {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
  };
};

/** The groups' standing the store boots with: every multi-repo project open, so a fresh session
 *  shows each project's repos (a flat row has nothing to open). */
export const expandedOf = (tree: ProjectTree): readonly string[] =>
  tree.filter((item) => item.repos.length > 1).map((item) => item.project);
