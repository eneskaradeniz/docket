// stores/live-pane.ts — the live pane store (U-5): it folds a run's AgentEvent stream into
// display items in arrival order (thought, message, tool call with status, usage, quota signal),
// keeps the earliest still-open permission ask with an answer intent, and marks the stream ended
// on `finished` — events after it are ignored. The stream reaches it through `attach`: the store
// reads the run's `run.events` tail (newest last, the fold order) and re-reads it on every
// `run.updated` for the attached run — notifications carry no payloads, so the tail is the feed.
import type { Api } from '../../api/api';
import type { CommandResult } from '../../api/commands';
import type { Query } from '../../api/queries';
import type { Actor, AgentEvent, CostKind, Meter } from '../../domain/index';
import { isQueryFailure } from './results';

/** The meter a `quota_signal` event carries: the quota domain's Meter without its ids, plus the
 *  pool's label when the provider named one. */
export type QuotaSignalMeter = Omit<Meter, 'id' | 'poolId'> & { readonly poolLabel?: string };

export type ToolCallStatus = 'running' | 'ok' | 'failed';

export type LivePaneItem =
  | { readonly kind: 'thought'; readonly text: string }
  | { readonly kind: 'message'; readonly text: string }
  | {
      readonly kind: 'toolCall';
      readonly id: string;
      readonly name: string;
      readonly target: string | null;
      readonly status: ToolCallStatus;
    }
  | {
      readonly kind: 'usage';
      readonly inputTokens: number;
      readonly outputTokens: number;
      readonly cachedInputTokens: number;
      readonly costUsd: number | null;
      readonly costKind: CostKind | null;
    }
  | { readonly kind: 'quotaSignal'; readonly meter: QuotaSignalMeter };

export interface OpenPermissionAsk {
  readonly askId: string;
  readonly tool: string;
  readonly target: string | null;
  readonly options: readonly string[];
}

export type AnswerDecision = 'allow' | 'deny';

export interface LivePaneState {
  /** The run this pane folds; null until a run is attached. Every answer command names it. */
  readonly runId: string | null;
  readonly items: readonly LivePaneItem[];
  /** The earliest ask still open — the one the answer intent addresses. */
  readonly ask: OpenPermissionAsk | null;
  /** True once `finished` arrived; every later event is ignored. */
  readonly ended: boolean;
}

/** The coarse change events the api emits after any work-order or run change (docs/v2/ui.md,
 *  U-12). Notifications carry no payloads — the store re-reads. Tests inject a fake, so the
 *  type lives here, as in the sibling stores. */
export type LivePaneChange =
  | { readonly type: 'workOrders.changed' }
  | { readonly type: 'run.updated'; readonly runId: string }
  | { readonly type: 'update.changed' };

/** Subscription to the change events; the api's `subscribe` (U-12) satisfies it as-is. */
export type LivePaneChangeSignal = (listener: (change: LivePaneChange) => void) => () => void;

export interface LivePaneStoreDeps {
  readonly api: Pick<Api, 'command' | 'query'>;
  readonly changes: LivePaneChangeSignal;
  /** Every issued answer travels as this actor — the pane acts as the user. */
  readonly actor: Actor;
}

export interface LivePaneStore {
  /** Bind the pane to a run: the fold resets and the run's event tail is read. Attaching the
   *  already-attached run does nothing — the change signal keeps that fold fresh. */
  attach(runId: string): Promise<void>;
  /** Fold one arrived event; arrival order is call order. */
  push(event: AgentEvent): void;
  state(): LivePaneState;
  /** Answer the earliest open ask of the attached run via `permission.answer`; with nothing
   *  open (or no run attached) it issues nothing and reports `not_found` — the api's own reply
   *  for an ask that is gone. */
  answer(decision: AnswerDecision): Promise<CommandResult>;
  subscribe(listener: () => void): () => void;
}

export const createLivePaneStore = (deps: LivePaneStoreDeps): LivePaneStore => {
  const { api, changes, actor } = deps;

  let runId: string | null = null;
  let items: readonly LivePaneItem[] = [];
  // Ask ids in arrival order; an ask is open until a tool_result of its id — the same openness
  // notion as the domain's run fold (R-44).
  let openAsks: readonly OpenPermissionAsk[] = [];
  let ended = false;
  const listeners = new Set<() => void>();
  // Only the newest tail read may apply its reply: a slow earlier read must not overwrite a
  // fresher fold when change events stack up.
  let attempts = 0;
  // useSyncExternalStore compares snapshots by reference: a fresh object per state() call reads
  // as a change and loops re-renders. The snapshot is rebuilt only when a fold mutates, and
  // state() hands out the stored reference.
  let snapshot: LivePaneState = { runId: null, items: [], ask: null, ended: false };

  const notify = (): void => {
    snapshot = { runId, items, ask: earliestAsk(), ended };
    for (const listener of [...listeners]) listener();
  };

  const earliestAsk = (): OpenPermissionAsk | null => (openAsks.length === 0 ? null : openAsks[0]);

  const fold = (event: AgentEvent): void => {
    // Once the stream has finished, every later event is ignored (U-5).
    if (ended) return;
    switch (event.type) {
      // Events none of U-5's display kinds or pane state are built from.
      case 'session_started':
      case 'error':
      case 'limit_hit':
      case 'raw':
        return;
      // Deltas extend the trailing item of their own kind; a different kind in between starts
      // a new item, so arrival order is what the user read, in the order they read it.
      case 'thinking': {
        const last = items[items.length - 1];
        items =
          last !== undefined && last.kind === 'thought'
            ? [...items.slice(0, -1), { kind: 'thought', text: last.text + event.delta }]
            : [...items, { kind: 'thought', text: event.delta }];
        break;
      }
      case 'text': {
        const last = items[items.length - 1];
        items =
          last !== undefined && last.kind === 'message'
            ? [...items.slice(0, -1), { kind: 'message', text: last.text + event.delta }]
            : [...items, { kind: 'message', text: event.delta }];
        break;
      }
      case 'tool_call':
        items = [
          ...items,
          { kind: 'toolCall', id: event.id, name: event.name, target: event.target ?? null, status: 'running' },
        ];
        break;
      case 'tool_result': {
        openAsks = openAsks.filter((ask) => ask.askId !== event.id);
        const index = items.findIndex((item) => item.kind === 'toolCall' && item.id === event.id);
        if (index < 0) break;
        items = items.map((item, at) => {
          if (at !== index || item.kind !== 'toolCall') return item;
          return {
            kind: 'toolCall',
            id: item.id,
            name: item.name,
            target: item.target,
            status: event.ok ? 'ok' : 'failed',
          };
        });
        break;
      }
      case 'permission_ask':
        if (!openAsks.some((ask) => ask.askId === event.id)) {
          openAsks = [
            ...openAsks,
            { askId: event.id, tool: event.tool, target: event.target ?? null, options: [...event.options] },
          ];
        }
        break;
      case 'usage':
        items = [
          ...items,
          {
            kind: 'usage',
            inputTokens: event.inputTokens,
            outputTokens: event.outputTokens,
            cachedInputTokens: event.cachedInputTokens ?? 0,
            costUsd: event.costUsd ?? null,
            costKind: event.costKind ?? null,
          },
        ];
        break;
      case 'quota_signal':
        items = [...items, { kind: 'quotaSignal', meter: event.meter }];
        break;
      case 'finished':
        // The run's end takes the asks with it: answering an ended run's ask reports not_found
        // (U-11), so the answer intent must not survive the stream.
        ended = true;
        openAsks = [];
        break;
    }
  };

  const push = (event: AgentEvent): void => {
    fold(event);
    notify();
  };

  /** Re-read the attached run's tail and refold it from scratch — the tail is newest last, the
   *  fold order, so a full refold is the same view an uninterrupted push stream would build.
   *  A failed read keeps the fold already on screen: an error never blanks the pane. */
  const refresh = async (): Promise<void> => {
    const target = runId;
    if (target === null) return;
    const attempt = attempts + 1;
    attempts = attempt;
    const reply: unknown = await api.query({ type: 'run.events', runId: target } satisfies Query);
    if (attempt !== attempts || runId !== target) return;
    if (isQueryFailure(reply)) return;
    items = [];
    openAsks = [];
    ended = false;
    for (const event of reply as readonly AgentEvent[]) fold(event);
    notify();
  };

  // Only run updates concern the pane, and only its own run's; work-order changes move nothing
  // in the fold.
  changes((change) => {
    if (change.type !== 'run.updated') return;
    if (change.runId !== runId) return;
    void refresh();
  });

  return {
    attach: (target) => {
      if (runId === target) return Promise.resolve();
      runId = target;
      items = [];
      openAsks = [];
      ended = false;
      notify();
      return refresh();
    },
    push,
    state: () => snapshot,
    answer: async (decision) => {
      const ask = earliestAsk();
      if (ask === null || runId === null) return { ok: false, code: 'not_found' };
      return api.command(actor, { type: 'permission.answer', runId, askId: ask.askId, decision });
    },
    subscribe: (listener) => {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
  };
};
