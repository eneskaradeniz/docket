// stores/shell.ts — the shell store (U-10): it mirrors the `cockpit` query's attention items into
// the shell's badge, ranked by kind with permission asks first, and re-queries on the same coarse
// change events the cockpit listens to. At zero attention the badge is absent — `shellBadge`
// returns null, so a zero count never reaches the screen. The repo switcher's entries come
// from an injected listing: no api query enumerates repos, so the observation is injected
// the same way the wizard store injects its repo-existence check.
import type { Api } from '../../api/api';
import type { AttentionItem, CockpitView, Query } from '../../api/queries';
import { isQueryFailure } from './results';

/** The coarse change events the api emits after any work-order or run change (docs/v2/ui.md,
 *  U-12). Notifications carry no payloads — the store re-queries. */
export type ShellChange =
  | { readonly type: 'workOrders.changed' }
  | { readonly type: 'run.updated'; readonly runId: string };

/** Subscription to the change events; the api's `subscribe` (U-12) satisfies it as-is. */
export type ShellChangeSignal = (listener: (change: ShellChange) => void) => () => void;

/** One switcher entry; the label is display copy the composition supplies already resolved. */
export interface ShellRepo {
  readonly id: string;
  readonly label: string;
}

/** The badge view (U-10): the cockpit's attention items, ranked by kind with permission asks
 *  first, plus their count — the number the shell renders. */
export interface ShellBadge {
  readonly count: number;
  readonly items: readonly AttentionItem[];
}

/** The badge's kind rank: an unanswered ask stops a run cold, so it outranks every other wait.
 *  Within a kind the older wait comes first, matching the api's attention order. */
export const ATTENTION_KIND_RANK: Readonly<Record<AttentionItem['kind'], number>> = {
  permission_ask: 0,
  awaiting_human: 1,
  blocked: 2,
  limit_waiting: 3,
};

/** Pure (U-10): the badge for the cockpit's attention items, or null at zero — a zero count is
 *  absent, never rendered. The input is not mutated; the ranking is a stable copy. */
export const shellBadge = (attention: readonly AttentionItem[]): ShellBadge | null => {
  if (attention.length === 0) return null;
  const items = [...attention].sort(
    (a, b) => ATTENTION_KIND_RANK[a.kind] - ATTENTION_KIND_RANK[b.kind] || a.since - b.since,
  );
  return { count: items.length, items };
};

export interface ShellStoreDeps {
  readonly api: Pick<Api, 'query'>;
  readonly changes: ShellChangeSignal;
  /** The repo switcher's entries. The repo registry lives below the api (no query
   *  enumerates repos), so the listing is injected; tests pass fakes, composition supplies
   *  the real source. */
  readonly repos: () => Promise<readonly ShellRepo[]>;
}

export interface ShellState {
  readonly loading: boolean;
  /** Null when nothing waits on the user: the badge is absent, never a rendered zero (U-10). */
  readonly badge: ShellBadge | null;
  readonly repos: readonly ShellRepo[];
}

export interface ShellStore {
  load(): Promise<void>;
  state(): ShellState;
  subscribe(listener: () => void): () => void;
}

export const createShellStore = (deps: ShellStoreDeps): ShellStore => {
  const { api, changes, repos } = deps;

  let state: ShellState = { loading: false, badge: null, repos: [] };
  const listeners = new Set<() => void>();
  // Only the newest attempt may apply its reply: a slow earlier query must not overwrite a
  // fresher badge when change events stack up.
  let attempts = 0;

  const set = (next: ShellState): void => {
    state = next;
    for (const listener of [...listeners]) listener();
  };

  const load = async (): Promise<void> => {
    const attempt = attempts + 1;
    attempts = attempt;
    set({ ...state, loading: true });
    const [reply, entries] = await Promise.all([
      api.query({ type: 'cockpit' } satisfies Query),
      repos(),
    ]);
    if (attempt !== attempts) return;
    if (isQueryFailure(reply)) {
      // A failed query keeps the previous badge and entries (the cockpit screen owns the visible
      // retry intent) — a failure must not blank the shell (U-2's stance, applied to the badge).
      set({ ...state, loading: false });
      return;
    }
    // The contract of the cockpit query: a reply that is not a failure is a CockpitView.
    const view = reply as CockpitView;
    set({ loading: false, badge: shellBadge(view.attention), repos: entries });
  };

  // Both event kinds concern the badge — work orders change and runs move — so every
  // notification triggers the same re-query (U-10: the same events as the cockpit).
  changes(() => {
    void load();
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
  };
};
