// stores/board.ts — the repo board store (U-3 + U-18): it mirrors the `repo.board` query
// (columns in stage order, done as its own lane), shows the repo-problem state on a failed
// query instead of an empty board, and its create intent validates title and flow before issuing
// `workOrder.open`. U-18 adds the Kanban ⇄ Liste choice — persisted per repo through the
// injected persistence, so it survives a reload — and the list view's derivations: the stage
// rail's segments and the rows a filter selects. Re-queries on work-order changes; run events do
// not move cards.
import type { Api } from '../../api/api';
import type { BoardView, ProjectTree, Query } from '../../api/queries';
import type { Actor } from '../../domain/index';
import { isQueryFailure } from './results';

/** Same coarse events the cockpit listens to (docs/v2/ui.md, U-12); the wiring lands with U-12,
 *  tests inject a fake, so the type lives here until then. */
export type BoardChange =
  | { readonly type: 'workOrders.changed' }
  | { readonly type: 'run.updated'; readonly runId: string };

/** Subscription to the change events; the api's `subscribe` (U-12) satisfies it as-is. */
export type BoardChangeSignal = (listener: (change: BoardChange) => void) => () => void;

/** The two standings of the board's content (K-3:A / K-7:B). */
export type BoardViewMode = 'kanban' | 'liste';

/** The storage key a repo's view choice persists under. */
export const boardViewKey = (repo: string): string => `docket.board.view.${repo}`;

/** The structural slice of DOM storage the view choice persists through; localStorage satisfies
 *  it as-is (the locale store's persistence, narrowed the same way). */
export interface BoardPersistence {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
}

/** The list view's rail filter: a stage's column index, the done lane, or null — every open
 *  row, the view's resting stance. */
export type ListFilter = number | 'done' | null;

export interface BoardStoreDeps {
  readonly api: Pick<Api, 'query' | 'command'>;
  readonly changes: BoardChangeSignal;
  /** Every issued command travels as this actor — the board acts as the user. */
  readonly actor: Actor;
  /** The per-repo view choice persists here (U-18); localStorage in the app, a map in tests. */
  readonly persistence: BoardPersistence;
}

export interface BoardState {
  readonly loading: boolean;
  /** The last successful query's board; null while the repo-problem state shows (U-3). */
  readonly view: BoardView | null;
  /** The failure code of the latest failed query (e.g. `definitions_invalid`): the
   *  repo-problem state, never an empty board. Null while a board is shown. */
  readonly problem: string | null;
  /** The loaded repo's view standing (U-18); Kanban until a stored choice says otherwise. */
  readonly viewMode: BoardViewMode;
  /** The list view's rail selection — session state, reset by every load (U-18). */
  readonly listFilter: ListFilter;
}

/** One rail segment of the list view (U-18): a stage's name with its running and waiting counts,
 *  or the done lane's close count. */
export type ListSegment =
  | { readonly stage: string; readonly name: string; readonly running: number; readonly waiting: number; readonly total: number }
  | { readonly done: true; readonly count: number };

/** A row the list view shows (U-18): the card plus the stage it sits in. */
export interface ListRow {
  readonly id: string;
  readonly number: number;
  readonly title: string;
  readonly status: string;
  readonly stageName: string;
}

/** Anything missing or unreadable in storage means Kanban, never a broken view (U-18). */
export const storedBoardView = (persistence: BoardPersistence, repo: string): BoardViewMode => {
  const raw = persistence.getItem(boardViewKey(repo));
  return raw === 'liste' ? 'liste' : 'kanban';
};

/** The statuses that wait on something a person should see: the rail's amber count. */
const WAITING: ReadonlySet<string> = new Set(['awaiting_human', 'blocked', 'limit_waiting']);

/** The rail: one segment per stage in the flow's order, closed by the done lane (U-18). */
export const listSegments = (view: BoardView): readonly ListSegment[] => [
  ...view.columns.map((column) => ({
    stage: column.stage,
    name: column.name,
    running: column.workOrders.filter((card) => card.status === 'running').length,
    waiting: column.workOrders.filter((card) => WAITING.has(card.status)).length,
    total: column.workOrders.length,
  })),
  { done: true, count: view.done.length } as const,
];

/** The rows a rail filter selects: every open row with its stage at no filter, one stage's rows
 *  at an index, the done lane's closes (U-18). */
export const listRows = (view: BoardView, filter: ListFilter): readonly ListRow[] => {
  if (filter === 'done') {
    return view.done.map((card) => ({ ...card, status: 'done', stageName: '' }));
  }
  const columns = filter === null ? view.columns : [view.columns[filter]].filter((column) => column !== undefined);
  return columns.flatMap((column) =>
    column.workOrders.map((card) => ({ ...card, stageName: column.name })),
  );
};

/** Why the create intent refused to issue `workOrder.open` (U-3 validation). Both have label
 *  keys under `validate.*` (labels/keys.ts). */
export type CreateValidation = 'title_required' | 'flow_required';

export type CreateOutcome =
  | { readonly ok: true; readonly id?: string }
  | { readonly ok: false; readonly validation: CreateValidation }
  | { readonly ok: false; readonly code: string };

export interface CreateIntent {
  readonly repo: string;
  readonly title: string;
  readonly flow: string;
}

export interface BoardStore {
  load(repo: string): Promise<void>;
  state(): BoardState;
  create(intent: CreateIntent): Promise<CreateOutcome>;
  /** Switches the board's standing and persists the choice for this repo (U-18). */
  setViewMode(repo: string, mode: BoardViewMode): void;
  /** Selects the list view's rail segment — session state only (U-18). */
  selectList(filter: ListFilter): void;
  subscribe(listener: () => void): () => void;
}

export const createBoardStore = (deps: BoardStoreDeps): BoardStore => {
  const { api, changes, actor, persistence } = deps;

  let state: BoardState = { loading: false, view: null, problem: null, viewMode: 'kanban', listFilter: null };
  // The repo the store is bound to: change events re-query it, create refreshes it.
  let repo: string | null = null;
  const listeners = new Set<() => void>();
  // Only the newest attempt may apply its reply, as in the cockpit store.
  let attempts = 0;

  const set = (next: BoardState): void => {
    state = next;
    for (const listener of [...listeners]) listener();
  };

  const load = async (target: string): Promise<void> => {
    const attempt = attempts + 1;
    attempts = attempt;
    repo = target;
    // Every load re-reads the stored choice — a reload restores the repo's standing — and
    // starts the list unfiltered (U-18).
    set({ loading: true, view: state.view, problem: null, viewMode: storedBoardView(persistence, target), listFilter: null });
    const reply: unknown = await api.query({ type: 'repo.board', repo: target } satisfies Query);
    if (attempt !== attempts) return;
    if (isQueryFailure(reply)) {
      // The problem state replaces the board: an empty board must not pretend health (U-3).
      set({ ...state, loading: false, view: null, problem: reply.code });
      return;
    }
    // The contract of the board query: a reply that is not a failure is a BoardView.
    set({ ...state, loading: false, view: reply as BoardView, problem: null });
  };

  changes((change) => {
    // Only work-order changes move cards across columns; run events belong to the cockpit.
    if (change.type !== 'workOrders.changed') return;
    if (repo === null) return;
    void load(repo);
  });

  return {
    load,
    state: () => state,
    setViewMode: (target, mode) => {
      persistence.setItem(boardViewKey(target), mode);
      if (target === repo) set({ ...state, viewMode: mode });
    },
    selectList: (filter) => {
      set({ ...state, listFilter: filter });
    },
    subscribe: (listener) => {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
    create: async (intent) => {
      // Pre-flight validation (U-3): a blank title or a missing flow choice never reaches
      // `workOrder.open` as a command.
      const title = intent.title.trim();
      if (title === '') return { ok: false, validation: 'title_required' };
      const flow = intent.flow.trim();
      if (flow === '') return { ok: false, validation: 'flow_required' };

      // A work order opens under a project: the tree says which one owns the repo. The project
      // surfaces own the real chooser; the board only needs the answer to issue the command.
      const tree: unknown = await api.query({ type: 'project.tree' } satisfies Query);
      const owner = (Array.isArray(tree) ? (tree as ProjectTree) : []).find((item) =>
        item.repos.some((node) => node.repo === intent.repo),
      );
      if (owner === undefined) return { ok: false, code: 'unknown_project' };

      const result = await api.command(actor, {
        type: 'workOrder.open',
        project: owner.project,
        repo: intent.repo,
        title,
        flow,
      });
      if (!result.ok) {
        // A command failure is not a repo problem: the board keeps showing as it was.
        return { ok: false, code: result.code };
      }
      // The board mirrors its own mutation: the next query shows the opened work order.
      if (repo !== null) void load(repo);
      return { ok: true, id: result.id };
    },
  };
};
