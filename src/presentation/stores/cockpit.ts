// stores/cockpit.ts — the cockpit store (U-2 + U-21): it mirrors the `cockpit` query's view with
// the api's attention order untouched (the rank is the api's, A-22), ages items from `since`
// through an injected clock, and re-queries on the coarse change events. A failed query keeps the
// previous view and surfaces `retry` — an error never blanks the cockpit. U-21 adds the four
// sections' own facts: for a permission-ask row the asking run and the earliest ask still open in
// its stream (the row's inline answer needs both), the inline answer intent itself, and the
// project cards' default-view rule.
import type { Api } from '../../api/api';
import type { CommandResult } from '../../api/commands';
import type { AgentEvent } from '../../domain/index';
import type { Actor } from '../../domain/index';
import type { AttentionItem, CockpitView, Query } from '../../api/queries';
import { isQueryFailure } from './results';

/** The coarse change events the api emits after any work-order or run change (docs/v2/ui.md,
 *  U-12). Notifications carry no payloads — the store re-queries. The wiring lands with U-12;
 *  tests inject a fake, so the type lives here until then. */
export type CockpitChange =
  | { readonly type: 'workOrders.changed' }
  | { readonly type: 'run.updated'; readonly runId: string }
  | { readonly type: 'update.changed' };

/** Subscription to the change events; the api's `subscribe` (U-12) satisfies it as-is. */
export type CockpitChangeSignal = (listener: (change: CockpitChange) => void) => () => void;

/** The ask a permission-ask row carries: the run that asked and the earliest ask of its stream
 *  still open (U-21) — the pair `permission.answer` needs. */
export interface CockpitAsk {
  readonly runId: string;
  readonly askId: string;
  readonly tool: string;
  readonly target: string | null;
}

/** Where a project card leads (K-4:B): a multi-repo project's default view is its roadmap, a
 *  single-repo project's the main repo's board. */
export type ProjectCardTarget =
  | { readonly kind: 'roadmap'; readonly project: string }
  | { readonly kind: 'board'; readonly repo: string };

export interface CockpitStoreDeps {
  readonly api: Pick<Api, 'query' | 'command'>;
  readonly changes: CockpitChangeSignal;
  /** Wall clock, injected: the store never reads `Date` itself. */
  readonly now: () => number;
  /** Every issued answer travels as this actor — the cockpit acts as the user. */
  readonly actor: Actor;
}

export interface CockpitState {
  readonly loading: boolean;
  /** The last successful query's view; null only before the first success. A failed query
   *  leaves it verbatim on screen (U-2). */
  readonly view: CockpitView | null;
  /** True when the latest finished query failed: components surface the retry intent. */
  readonly failed: boolean;
  /** The permission ask of each waiting row that carries one, keyed by work order id (U-21);
   *  a row without a derivable ask renders its own kind copy instead. */
  readonly asks: Readonly<Record<string, CockpitAsk>>;
}

export interface AnswerIntentInput {
  readonly runId: string;
  readonly askId: string;
  readonly decision: 'allow' | 'deny';
}

export interface CockpitStore {
  load(): Promise<void>;
  /** The retry intent a failed query surfaces (U-2); a plain reload of the same query. */
  retry(): Promise<void>;
  state(): CockpitState;
  /** Elapsed milliseconds since the item started waiting, never negative. Rendering the age
   *  in the active locale is the component's job. */
  ageMs(item: AttentionItem): number;
  /** Elapsed milliseconds since any stamped moment (a run's start, a close), never negative. */
  sinceMs(at: number): number;
  /** The inline answer of a permission-ask row (U-21): `permission.answer` plus the re-query
   *  that must drop the answered row. */
  answerPermission(input: AnswerIntentInput): Promise<CommandResult>;
  subscribe(listener: () => void): () => void;
}

/** The ask facts without the run that owns them; the cockpit joins the run id on. */
export type OpenAskFacts = Omit<CockpitAsk, 'runId'>;

/** The earliest permission ask of a stream still open — the same openness notion as the domain's
 *  run fold (R-44): an ask is open until a tool_result of its id arrives. Pure (U-21). */
export const earliestOpenAsk = (events: readonly AgentEvent[]): OpenAskFacts | null => {
  const closed = new Set(
    events.filter((event) => event.type === 'tool_result').map((event) => (event as { readonly id: string }).id),
  );
  const ask = events.find(
    (event): event is Extract<AgentEvent, { readonly type: 'permission_ask' }> =>
      event.type === 'permission_ask' && !closed.has(event.id),
  );
  return ask === undefined ? null : { askId: ask.id, tool: ask.tool, target: ask.target ?? null };
};

/** The card's default view (K-4:B, U-21): multi-repo → roadmap, single-repo → the main repo's
 *  board. Pure. */
export const projectCardTarget = (card: Extract<CockpitView['projects'][number], { readonly project: string }>): ProjectCardTarget =>
  card.repoCount > 1
    ? { kind: 'roadmap', project: card.project }
    : { kind: 'board', repo: card.mainRepo };

export const createCockpitStore = (deps: CockpitStoreDeps): CockpitStore => {
  const { api, changes, now, actor } = deps;

  let state: CockpitState = { loading: false, view: null, failed: false, asks: {} };
  const listeners = new Set<() => void>();
  // Only the newest attempt may apply its reply: a slow earlier query must not overwrite a
  // fresher view when change events stack up.
  let attempts = 0;

  const set = (next: CockpitState): void => {
    state = next;
    for (const listener of [...listeners]) listener();
  };

  /** The asking run of a work order: the newest still-active one of its detail view — the same
   *  rule the detail store's live pane mounts by. */
  const askingRunOf = async (
    item: AttentionItem,
  ): Promise<{ readonly runId: string; readonly events: readonly AgentEvent[] } | null> => {
    const detail: unknown = await api.query({ type: 'workOrder.detail', id: item.workOrderId } satisfies Query);
    if (isQueryFailure(detail) || detail === null || typeof detail !== 'object') return null;
    const runs = (detail as { readonly runs?: unknown }).runs;
    if (!Array.isArray(runs)) return null;
    let newest: { readonly id: string; readonly startedAt: number } | undefined;
    for (const run of runs) {
      const record = run as { readonly id?: unknown; readonly startedAt?: unknown; readonly endedAt?: unknown };
      if (record.endedAt !== undefined || typeof record.id !== 'string' || typeof record.startedAt !== 'number') {
        continue;
      }
      if (newest === undefined || record.startedAt > newest.startedAt) {
        newest = { id: record.id, startedAt: record.startedAt };
      }
    }
    if (newest === undefined) return null;
    const events: unknown = await api.query({ type: 'run.events', runId: newest.id } satisfies Query);
    if (isQueryFailure(events) || !Array.isArray(events)) return null;
    return { runId: newest.id, events: events as readonly AgentEvent[] };
  };

  /** Reads every permission-ask row's ask. A row whose ask cannot be derived stays askless —
   *  its kind copy carries the row, never a guessed command. Only the newest load's reads may
   *  apply, so stacked reloads cannot resurrect an answered row's ask. */
  const loadAsks = async (view: CockpitView, attempt: number): Promise<void> => {
    const asking = view.attention.filter((item) => item.kind === 'permission_ask');
    if (asking.length === 0) {
      set({ ...state, asks: {} });
      return;
    }
    const asks: Record<string, CockpitAsk> = {};
    for (const item of asking) {
      const askingRun = await askingRunOf(item);
      if (askingRun === null) continue;
      const ask = earliestOpenAsk(askingRun.events);
      if (ask !== null) asks[item.workOrderId] = { ...ask, runId: askingRun.runId };
    }
    if (attempt !== attempts) return;
    set({ ...state, asks });
  };

  const load = async (): Promise<void> => {
    const attempt = attempts + 1;
    attempts = attempt;
    set({ ...state, loading: true, failed: false });
    const reply: unknown = await api.query({ type: 'cockpit' } satisfies Query);
    if (attempt !== attempts) return;
    if (isQueryFailure(reply)) {
      // The previous view stays exactly as it was; only the retry intent appears (U-2).
      set({ ...state, loading: false, failed: true });
      return;
    }
    // The contract of the cockpit query: a reply that is not a failure is a CockpitView.
    const view = reply as CockpitView;
    set({ loading: false, view, failed: false, asks: {} });
    void loadAsks(view, attempt);
  };

  // Work-order and run events both concern the cockpit, so they trigger the same re-query; the
  // update channel does not — its state belongs to the settings surface.
  changes((change) => {
    if (change.type === 'update.changed') return;
    void load();
  });

  return {
    load,
    retry: () => load(),
    state: () => state,
    ageMs: (item) => Math.max(0, now() - item.since),
    sinceMs: (at) => Math.max(0, now() - at),
    answerPermission: async (input) => {
      const result = await api.command(actor, {
        type: 'permission.answer',
        runId: input.runId,
        askId: input.askId,
        decision: input.decision,
      });
      // The cockpit mirrors its own mutation: the re-query drops the answered row when the api
      // agrees, or keeps it when the ask was already gone.
      void load();
      return result;
    },
    subscribe: (listener) => {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
  };
};
