// Folds a run's event stream into one summary. Contract: docs/v2/domain.md section 11.
import type { RunOutcome } from '../shared/index';
import type { AgentEvent, CostKind } from './agent-event';

export interface RunSummary {
  readonly sessionRef?: string;
  readonly inputTokens: number;
  readonly outputTokens: number;
  readonly cachedInputTokens: number;
  readonly costUsd?: number; // sum of events that carried a cost
  readonly costKind?: CostKind; // the kind of the first costed event
  readonly toolCalls: number;
  readonly failedToolCalls: number;
  readonly openPermissionAsks: readonly string[]; // ask ids without a later tool_result of the same id
  readonly lastLimit?: Extract<AgentEvent, { readonly type: 'limit_hit' }>;
  readonly outcome?: RunOutcome; // maps the last finished event: completed→succeeded, failed, cancelled, limit
}

type FinishedEvent = Extract<AgentEvent, { readonly type: 'finished' }>;

const OUTCOME_BY_REASON: Readonly<Record<FinishedEvent['reason'], RunOutcome>> = {
  completed: 'succeeded',
  failed: 'failed',
  cancelled: 'cancelled',
  limit: 'limit',
};

/** Closes a still-open ask; results that arrive before their ask match nothing. */
const closeAsk = (open: string[], id: string): void => {
  const index = open.indexOf(id);
  if (index >= 0) open.splice(index, 1);
};

export function foldRun(events: readonly AgentEvent[]): RunSummary {
  let sessionRef: string | undefined;
  let inputTokens = 0;
  let outputTokens = 0;
  let cachedInputTokens = 0;
  let costUsd: number | undefined;
  let costKind: CostKind | undefined;
  let toolCalls = 0;
  let failedToolCalls = 0;
  let lastLimit: Extract<AgentEvent, { readonly type: 'limit_hit' }> | undefined;
  let outcome: RunOutcome | undefined;
  let sawCost = false;
  // Accumulator only — the input stream is never touched.
  const openAsks: string[] = [];

  for (const event of events) {
    switch (event.type) {
      case 'session_started':
        sessionRef = event.sessionRef;
        break;
      case 'tool_call':
        toolCalls += 1;
        break;
      case 'tool_result':
        if (!event.ok) failedToolCalls += 1;
        closeAsk(openAsks, event.id);
        break;
      case 'permission_ask':
        if (!openAsks.includes(event.id)) openAsks.push(event.id);
        break;
      case 'usage':
        inputTokens += event.inputTokens;
        outputTokens += event.outputTokens;
        cachedInputTokens += event.cachedInputTokens ?? 0;
        if (event.costUsd !== undefined) {
          costUsd = (costUsd ?? 0) + event.costUsd;
          if (!sawCost) {
            sawCost = true;
            costKind = event.costKind;
          }
        }
        break;
      case 'limit_hit':
        lastLimit = event;
        break;
      case 'finished':
        outcome = OUTCOME_BY_REASON[event.reason];
        break;
      default:
        break;
    }
  }

  return {
    sessionRef,
    inputTokens,
    outputTokens,
    cachedInputTokens,
    costUsd,
    costKind,
    toolCalls,
    failedToolCalls,
    openPermissionAsks: openAsks,
    lastLimit,
    outcome,
  };
}
