// stores/board.ts — the repo board store (U-3): it mirrors the `repo.board` query
// (columns in stage order, done as its own lane), shows the repo-problem state on a failed
// query instead of an empty board, and its create intent validates title and flow before issuing
// `workOrder.open`. Re-queries on work-order changes; run events do not move cards.
import type { Api } from '../../api/api';
import type { BoardView, Query } from '../../api/queries';
import type { Actor } from '../../domain/index';
import { isQueryFailure } from './results';

/** Same coarse events the cockpit listens to (docs/v2/ui.md, U-12); the wiring lands with U-12,
 *  tests inject a fake, so the type lives here until then. */
export type BoardChange =
  | { readonly type: 'workOrders.changed' }
  | { readonly type: 'run.updated'; readonly runId: string };

/** Subscription to the change events; the api's `subscribe` (U-12) satisfies it as-is. */
export type BoardChangeSignal = (listener: (change: BoardChange) => void) => () => void;

export interface BoardStoreDeps {
  readonly api: Pick<Api, 'query' | 'command'>;
  readonly changes: BoardChangeSignal;
  /** Every issued command travels as this actor — the board acts as the user. */
  readonly actor: Actor;
}

export interface BoardState {
  readonly loading: boolean;
  /** The last successful query's board; null while the repo-problem state shows (U-3). */
  readonly view: BoardView | null;
  /** The failure code of the latest failed query (e.g. `definitions_invalid`): the
   *  repo-problem state, never an empty board. Null while a board is shown. */
  readonly problem: string | null;
}

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
  subscribe(listener: () => void): () => void;
}

export const createBoardStore = (deps: BoardStoreDeps): BoardStore => {
  const { api, changes, actor } = deps;

  let state: BoardState = { loading: false, view: null, problem: null };
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
    set({ loading: true, view: state.view, problem: null });
    const reply: unknown = await api.query({ type: 'repo.board', repo: target } satisfies Query);
    if (attempt !== attempts) return;
    if (isQueryFailure(reply)) {
      // The problem state replaces the board: an empty board must not pretend health (U-3).
      set({ loading: false, view: null, problem: reply.code });
      return;
    }
    // The contract of the board query: a reply that is not a failure is a BoardView.
    set({ loading: false, view: reply as BoardView, problem: null });
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

      const result = await api.command(actor, {
        type: 'workOrder.open',
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
