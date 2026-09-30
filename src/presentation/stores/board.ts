// stores/board.ts — the repo board store (U-3 + U-18): it mirrors the `repo.board` query
// (columns in stage order, done as its own lane), shows the repo-problem state on a failed
// query instead of an empty board, and its create intent validates title and flow before issuing
// `workOrder.open`. U-18 adds the Kanban ⇄ Liste choice — persisted per repo through the
// injected persistence, so it survives a reload — and both views' derivations: each card's
// tone, the Kanban columns and the list's groups, each with the done work last, and which of them
// stand shut (an explicit choice per repo, else a default). Re-queries on work-order changes; run events
// do not move cards.
import type { Api } from '../../api/api';
import type { BoardView, ProjectTree, Query } from '../../api/queries';
import type { Actor } from '../../domain/index';
import { isQueryFailure } from './results';

/** Same coarse events the cockpit listens to (docs/v2/ui.md, U-12); the wiring lands with U-12,
 *  tests inject a fake, so the type lives here until then. */
export type BoardChange =
  | { readonly type: 'workOrders.changed' }
  | { readonly type: 'run.updated'; readonly runId: string }
  | { readonly type: 'update.changed' };

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
  /** The operator's explicit open/shut choices for Kanban columns, per repo (U-18); a column
   *  without an entry stands at its default. */
  readonly columnOverrides: ColumnOverrides;
  /** The same for the list's groups (U-18), kept apart: an empty stage is open on a short Kanban
   *  flow but never open in the list. */
  readonly groupOverrides: ColumnOverrides;
}

/** A Kanban column's standing the operator chose — anything else is the default. */
export type ColumnOverrides = Readonly<Record<string, 'open' | 'shut'>>;

/** The storage key a repo's Kanban column choices persist under. */
export const boardColumnsKey = (repo: string): string => `docket.board.columns.${repo}`;

/** The storage key a repo's list group choices persist under. */
export const boardGroupsKey = (repo: string): string => `docket.board.groups.${repo}`;

/** Flows longer than this start their empty stages shut, so a long flow does not spend its width
 *  on stages with no work. */
export const EMPTY_SHUT_ABOVE_STAGES = 6;

/** The one hue a card's status stands for: waiting kinds share the attention tone, a status
 *  outside the closed set stays unknown instead of pretending a known state. */
export type CardTone = 'ready' | 'running' | 'gating' | 'attention' | 'blocked' | 'done' | 'unknown';

const TONES: Readonly<Record<string, CardTone>> = {
  ready: 'ready',
  running: 'running',
  gating: 'gating',
  awaiting_human: 'attention',
  limit_waiting: 'attention',
  blocked: 'blocked',
  done: 'done',
};

export const cardTone = (status: string): CardTone => TONES[status] ?? 'unknown';

export interface KanbanCard {
  readonly id: string;
  readonly number: number;
  readonly title: string;
  readonly status: string;
  readonly tone: CardTone;
}

/** One Kanban column: a stage of the flow, or the done work as the last column. */
export interface KanbanColumn {
  readonly key: string;
  readonly kind: 'stage' | 'done';
  readonly name: string;
  readonly cards: readonly KanbanCard[];
  /** Cards that wait on a person (awaiting, blocked, limit). */
  readonly waiting: number;
  readonly shut: boolean;
}

/** Anything missing or unreadable in storage means Kanban, never a broken view (U-18). */
export const storedBoardView = (persistence: BoardPersistence, repo: string): BoardViewMode => {
  const raw = persistence.getItem(boardViewKey(repo));
  return raw === 'liste' ? 'liste' : 'kanban';
};

/** The statuses that wait on something a person should see: the rail's amber count. */
const WAITING: ReadonlySet<string> = new Set(['awaiting_human', 'blocked', 'limit_waiting']);

const isColumnChoice = (value: unknown): value is 'open' | 'shut' => value === 'open' || value === 'shut';

/** Stored open/shut choices; unreadable storage or a foreign value falls back to the defaults,
 *  entry by entry, never to a broken board (U-18). */
const readOverrides = (persistence: BoardPersistence, key: string): ColumnOverrides => {
  const raw = persistence.getItem(key);
  if (raw === null) return {};
  try {
    const parsed: unknown = JSON.parse(raw);
    if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) return {};
    return Object.fromEntries(Object.entries(parsed).filter((entry): entry is [string, 'open' | 'shut'] => isColumnChoice(entry[1])));
  } catch {
    return {};
  }
};

export const storedColumnOverrides = (persistence: BoardPersistence, repo: string): ColumnOverrides =>
  readOverrides(persistence, boardColumnsKey(repo));

export const storedGroupOverrides = (persistence: BoardPersistence, repo: string): ColumnOverrides =>
  readOverrides(persistence, boardGroupsKey(repo));

/** The Kanban columns in flow order with the done work last. A column with a waiting card is
 *  never shut — the operator's next move must stay visible; otherwise an explicit choice wins,
 *  else done and (on a long flow) empty stages start shut (U-18). */
export const kanbanColumns = (view: BoardView, overrides: ColumnOverrides): readonly KanbanColumn[] => {
  const long = view.columns.length > EMPTY_SHUT_ABOVE_STAGES;
  const build = (key: string, kind: 'stage' | 'done', name: string, cards: readonly KanbanCard[]): KanbanColumn => {
    const waiting = cards.filter((card) => WAITING.has(card.status)).length;
    const standing = overrides[key] ?? (kind === 'done' || (long && cards.length === 0) ? 'shut' : 'open');
    return { key, kind, name, cards, waiting, shut: waiting === 0 && standing === 'shut' };
  };
  return [
    ...view.columns.map((column) =>
      build(`stage:${column.stage}`, 'stage', column.name, column.workOrders.map((card) => ({ ...card, tone: cardTone(card.status) }))),
    ),
    build('done', 'done', '', view.done.map((card) => ({ ...card, status: 'done', tone: 'done' as const }))),
  ];
};

/** One group of the list view (U-18): a stage of the flow, or the done work as the last group. */
export interface ListGroup {
  readonly key: string;
  readonly kind: 'stage' | 'done';
  readonly name: string;
  readonly rows: readonly KanbanCard[];
  readonly running: number;
  readonly waiting: number;
  readonly open: boolean;
}

/** The list's groups in flow order with the done work last. A filled stage starts open, an empty
 *  stage and the done group start closed; an explicit choice wins, except that an empty group
 *  has nothing to show and never opens (U-18). */
export const listGroups = (view: BoardView, overrides: ColumnOverrides): readonly ListGroup[] => {
  const build = (key: string, kind: 'stage' | 'done', name: string, rows: readonly KanbanCard[]): ListGroup => {
    const standing = overrides[key] ?? (kind === 'stage' && rows.length > 0 ? 'open' : 'shut');
    return {
      key,
      kind,
      name,
      rows,
      running: rows.filter((row) => row.status === 'running').length,
      waiting: rows.filter((row) => WAITING.has(row.status)).length,
      open: rows.length > 0 && standing === 'open',
    };
  };
  return [
    ...view.columns.map((column) =>
      build(`stage:${column.stage}`, 'stage', column.name, column.workOrders.map((card) => ({ ...card, tone: cardTone(card.status) }))),
    ),
    build('done', 'done', '', view.done.map((card) => ({ ...card, status: 'done', tone: 'done' as const }))),
  ];
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
  /** Flips a list group open/closed and persists the choice for this repo (U-18); an empty
   *  group stays closed. */
  toggleGroup(repo: string, key: string): void;
  /** Flips a Kanban column open/shut and persists the choice for this repo (U-18); a column that
   *  waits on a person stays open. */
  toggleColumn(repo: string, key: string): void;
  subscribe(listener: () => void): () => void;
}

export const createBoardStore = (deps: BoardStoreDeps): BoardStore => {
  const { api, changes, actor, persistence } = deps;

  let state: BoardState = { loading: false, view: null, problem: null, viewMode: 'kanban', columnOverrides: {}, groupOverrides: {} };
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
    // Every load re-reads the stored choices — a reload restores the repo's standing (U-18).
    set({
      loading: true,
      view: state.view,
      problem: null,
      viewMode: storedBoardView(persistence, target),
      columnOverrides: storedColumnOverrides(persistence, target),
      groupOverrides: storedGroupOverrides(persistence, target),
    });
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
    toggleGroup: (target, key) => {
      const group = state.view === null ? undefined : listGroups(state.view, state.groupOverrides).find((candidate) => candidate.key === key);
      if (group === undefined || group.rows.length === 0) return;
      const next: ColumnOverrides = { ...state.groupOverrides, [key]: group.open ? 'shut' : 'open' };
      persistence.setItem(boardGroupsKey(target), JSON.stringify(next));
      if (target === repo) set({ ...state, groupOverrides: next });
    },
    toggleColumn: (target, key) => {
      const column = state.view === null ? undefined : kanbanColumns(state.view, state.columnOverrides).find((candidate) => candidate.key === key);
      if (column === undefined || column.waiting > 0) return;
      const next: ColumnOverrides = { ...state.columnOverrides, [key]: column.shut ? 'open' : 'shut' };
      persistence.setItem(boardColumnsKey(target), JSON.stringify(next));
      if (target === repo) set({ ...state, columnOverrides: next });
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
