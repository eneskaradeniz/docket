// stores/live-pane.ts — the live pane store (U-5): it folds a run's AgentEvent stream into
// display items in arrival order (thought, message, tool call with status, usage, quota signal),
// keeps the earliest still-open permission ask with an answer intent, and marks the stream ended
// on `finished` — events after it are ignored. The transport that feeds events in is
// composition's concern (out of scope here): callers push arrived events; tests fake the stream.
import type { Api } from '../../api/api';
import type { CommandResult } from '../../api/commands';
import type { Actor, AgentEvent, CostKind, Meter } from '../../domain/index';

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
  readonly items: readonly LivePaneItem[];
  /** The earliest ask still open — the one the answer intent addresses. */
  readonly ask: OpenPermissionAsk | null;
  /** True once `finished` arrived; every later event is ignored. */
  readonly ended: boolean;
}

export interface LivePaneStoreDeps {
  /** The run whose stream this pane folds; every answer command names it. */
  readonly runId: string;
  readonly api: Pick<Api, 'command'>;
  /** Every issued answer travels as this actor — the pane acts as the user. */
  readonly actor: Actor;
}

export interface LivePaneStore {
  /** Fold one arrived event; arrival order is call order. */
  push(event: AgentEvent): void;
  state(): LivePaneState;
  /** Answer the earliest open ask via `permission.answer`; with nothing open it issues nothing
   *  and reports `not_found` — the api's own reply for an ask that is gone. */
  answer(decision: AnswerDecision): Promise<CommandResult>;
  subscribe(listener: () => void): () => void;
}

export const createLivePaneStore = (deps: LivePaneStoreDeps): LivePaneStore => {
  const { runId, api, actor } = deps;

  let items: readonly LivePaneItem[] = [];
  // Ask ids in arrival order; an ask is open until a tool_result of its id — the same openness
  // notion as the domain's run fold (R-44).
  let openAsks: readonly OpenPermissionAsk[] = [];
  let ended = false;
  const listeners = new Set<() => void>();

  const notify = (): void => {
    for (const listener of [...listeners]) listener();
  };

  const earliestAsk = (): OpenPermissionAsk | null => (openAsks.length === 0 ? null : openAsks[0]);

  const push = (event: AgentEvent): void => {
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
    notify();
  };

  const answer = async (decision: AnswerDecision): Promise<CommandResult> => {
    const ask = earliestAsk();
    if (ask === null) return { ok: false, code: 'not_found' };
    return api.command(actor, { type: 'permission.answer', runId, askId: ask.askId, decision });
  };

  return {
    push,
    state: () => ({ items, ask: earliestAsk(), ended }),
    answer,
    subscribe: (listener) => {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
  };
};
