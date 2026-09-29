// stores/roadmap.ts — the roadmap page store (U-17): it mirrors the `roadmap.byProject` view,
// opens the first phase on entry with the rest closed, and keeps both kinds of disclosure —
// phase collapse and cross-repo task expansion — for the session. A failed query shows the
// problem state, never an empty page. Work-order changes re-query the bound project; run events
// do not touch the page.
import type { Api } from '../../api/api';
import type { Query, RoadmapPageView } from '../../api/queries';
import { isQueryFailure } from './results';

/** Same coarse events the board listens to (docs/v2/ui.md, U-12); the api's `subscribe`
 *  satisfies it as-is. */
export type RoadmapChange =
  | { readonly type: 'workOrders.changed' }
  | { readonly type: 'run.updated'; readonly runId: string };

/** Subscription to the change events; the api's `subscribe` (U-12) satisfies it as-is. */
export type RoadmapChangeSignal = (listener: (change: RoadmapChange) => void) => () => void;

export interface RoadmapStoreDeps {
  readonly api: Pick<Api, 'query'>;
  readonly changes: RoadmapChangeSignal;
}

export interface RoadmapState {
  readonly loading: boolean;
  /** The last successful query's view; null while the problem state shows (U-17). */
  readonly view: RoadmapPageView | null;
  /** The failure code of the latest failed query (e.g. `not_found` for a project without a
   *  roadmap): the problem state, never an empty page. Null while a roadmap is shown. */
  readonly problem: string | null;
  /** The open phases' ids, session state: on entry the first phase only (U-17). */
  readonly openPhases: readonly string[];
  /** The expanded cross-repo tasks' ids, session state (U-17). */
  readonly expanded: readonly string[];
}

export interface RoadmapStore {
  load(project: string): Promise<void>;
  /** Flip a phase's collapse; disclosure survives re-queries, not a project change. */
  togglePhase(id: string): void;
  /** Flip a cross-repo task's expansion; disclosure survives re-queries, not a project change. */
  toggleTask(id: string): void;
  state(): RoadmapState;
  subscribe(listener: () => void): () => void;
}

export const createRoadmapStore = (deps: RoadmapStoreDeps): RoadmapStore => {
  const { api, changes } = deps;

  const initial: RoadmapState = { loading: false, view: null, problem: null, openPhases: [], expanded: [] };
  let state: RoadmapState = initial;
  // The project the store is bound to: change events re-query it, and opening another project
  // resets the disclosure to a fresh entry (first phase open, nothing expanded).
  let project: string | null = null;
  const listeners = new Set<() => void>();
  // Only the newest attempt may apply its reply, as in the cockpit store.
  let attempts = 0;

  const set = (next: RoadmapState): void => {
    state = next;
    for (const listener of [...listeners]) listener();
  };

  const load = async (target: string): Promise<void> => {
    const attempt = attempts + 1;
    attempts = attempt;
    // Entry disclosure applies when the project changes (the store's first load included);
    // a re-query of the same project keeps what the operator has opened or expanded.
    const freshProject = project !== target;
    project = target;
    set({
      loading: true,
      view: freshProject ? null : state.view,
      problem: null,
      openPhases: freshProject ? [] : state.openPhases,
      expanded: freshProject ? [] : state.expanded,
    });
    const reply: unknown = await api.query({ type: 'roadmap.byProject', project: target } satisfies Query);
    if (attempt !== attempts) return;
    if (isQueryFailure(reply)) {
      // The problem state replaces the page: an empty roadmap must not pretend health (U-17).
      set({ loading: false, view: null, problem: reply.code, openPhases: state.openPhases, expanded: state.expanded });
      return;
    }
    // The contract of the roadmap query: a reply that is not a failure is a RoadmapPageView.
    const view = reply as RoadmapPageView;
    const openPhases = state.openPhases.length > 0 ? state.openPhases : [view.phases[0]?.id].filter((id) => id !== undefined);
    set({ loading: false, view, problem: null, openPhases, expanded: state.expanded });
  };

  changes((change) => {
    // Only work-order changes move a task's status; run events belong to the cockpit.
    if (change.type !== 'workOrders.changed') return;
    if (project === null) return;
    void load(project);
  });

  return {
    load,
    togglePhase: (id) => {
      const open = state.openPhases.includes(id);
      set({
        ...state,
        openPhases: open ? state.openPhases.filter((entry) => entry !== id) : [...state.openPhases, id],
      });
    },
    toggleTask: (id) => {
      const open = state.expanded.includes(id);
      set({
        ...state,
        expanded: open ? state.expanded.filter((entry) => entry !== id) : [...state.expanded, id],
      });
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
