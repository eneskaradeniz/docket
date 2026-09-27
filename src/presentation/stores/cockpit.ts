// stores/cockpit.ts — the cockpit store (U-2): it mirrors the `cockpit` query's view with the
// api's attention order untouched (the rank is the api's, A-22), ages items from `since` through
// an injected clock, and re-queries on the coarse change events. A failed query keeps the
// previous view and surfaces `retry` — an error never blanks the cockpit.
import type { Api } from '../../api/api';
import type { AttentionItem, CockpitView, Query } from '../../api/queries';
import { isQueryFailure } from './results';

/** The coarse change events the api emits after any work-order or run change (docs/v2/ui.md,
 *  U-12). Notifications carry no payloads — the store re-queries. The wiring lands with U-12;
 *  tests inject a fake, so the type lives here until then. */
export type CockpitChange =
  | { readonly type: 'workOrders.changed' }
  | { readonly type: 'run.updated'; readonly runId: string };

/** Subscription to the change events; the api's `subscribe` (U-12) satisfies it as-is. */
export type CockpitChangeSignal = (listener: (change: CockpitChange) => void) => () => void;

export interface CockpitStoreDeps {
  readonly api: Pick<Api, 'query'>;
  readonly changes: CockpitChangeSignal;
  /** Wall clock, injected: the store never reads `Date` itself. */
  readonly now: () => number;
}

export interface CockpitState {
  readonly loading: boolean;
  /** The last successful query's view; null only before the first success. A failed query
   *  leaves it verbatim on screen (U-2). */
  readonly view: CockpitView | null;
  /** True when the latest finished query failed: components surface the retry intent. */
  readonly failed: boolean;
}

export interface CockpitStore {
  load(): Promise<void>;
  /** The retry intent a failed query surfaces (U-2); a plain reload of the same query. */
  retry(): Promise<void>;
  state(): CockpitState;
  /** Elapsed milliseconds since the item started waiting, never negative. Rendering the age
   *  in the active locale is the component's job. */
  ageMs(item: AttentionItem): number;
  subscribe(listener: () => void): () => void;
}

export const createCockpitStore = (deps: CockpitStoreDeps): CockpitStore => {
  const { api, changes, now } = deps;

  let state: CockpitState = { loading: false, view: null, failed: false };
  const listeners = new Set<() => void>();
  // Only the newest attempt may apply its reply: a slow earlier query must not overwrite a
  // fresher view when change events stack up.
  let attempts = 0;

  const set = (next: CockpitState): void => {
    state = next;
    for (const listener of [...listeners]) listener();
  };

  const load = async (): Promise<void> => {
    const attempt = attempts + 1;
    attempts = attempt;
    set({ loading: true, view: state.view, failed: false });
    const reply: unknown = await api.query({ type: 'cockpit' } satisfies Query);
    if (attempt !== attempts) return;
    if (isQueryFailure(reply)) {
      // The previous view stays exactly as it was; only the retry intent appears (U-2).
      set({ loading: false, view: state.view, failed: true });
      return;
    }
    // The contract of the cockpit query: a reply that is not a failure is a CockpitView.
    set({ loading: false, view: reply as CockpitView, failed: false });
  };

  // Both event kinds concern the cockpit — work orders change and runs move — so every
  // notification triggers the same re-query.
  changes(() => {
    void load();
  });

  return {
    load,
    retry: () => load(),
    state: () => state,
    ageMs: (item) => Math.max(0, now() - item.since),
    subscribe: (listener) => {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
  };
};
