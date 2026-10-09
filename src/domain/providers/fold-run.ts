// Folds a run's event stream into one summary. Contract: docs/v2/domain.md section 11.
import type { RunOutcome } from '../shared/index';
import type { AgentEvent, CostKind } from './agent-event';

export interface RunSummary {
  readonly sessionRef?: string;
  readonly inputTokens: number;
  readonly outputTokens: number;
  readonly cachedInputTokens: number;
  readonly reasoningTokens: number; // part of outputTokens, shown as its own line
  readonly costUsd?: number; // sum of events that carried a cost
  readonly costKind?: CostKind; // the kind of the first costed event
  readonly toolCalls: number;
  readonly failedToolCalls: number;
  readonly openPermissionAsks: readonly string[]; // ask ids without a later tool_result or permission_answered of the same id
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
  let reasoningTokens = 0;
  let costUsd: number | undefined;
  let costKind: CostKind | undefined;
  let toolCalls = 0;
  let failedToolCalls = 0;
  let lastLimit: Extract<AgentEvent, { readonly type: 'limit_hit' }> | undefined;
  let lastFinishedReason: FinishedEvent['reason'] | undefined;
  let sawUsage = false;
  let sawCost = false;
  let sawText = false;
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
      case 'permission_answered':
        closeAsk(openAsks, event.id);
        break;
      case 'usage':
        sawUsage = true;
        inputTokens += event.inputTokens;
        outputTokens += event.outputTokens;
        cachedInputTokens += event.cachedInputTokens ?? 0;
        reasoningTokens += event.reasoningTokens ?? 0;
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
      case 'text':
        // Whitespace-only deltas are framing noise; only spoken content is an answer.
        if (event.delta.trim() !== '') sawText = true;
        break;
      case 'finished':
        lastFinishedReason = event.reason;
        break;
      default:
        break;
    }
  }

  // A completed run that reported usage yet accumulated no tokens did no work — the CLI's
  // model notices arrive as plain text, so only the token totals expose them. A stream that
  // never reported usage keeps its completed outcome: a missing report proves nothing.
  // A completed run that tried only tools, every one of which failed, and answered in no text
  // did no work either — but a spoken answer (a plan, a refusal) is work, so text rescues it.
  const allToolCallsFailed = toolCalls > 0 && failedToolCalls === toolCalls;
  const outcome: RunOutcome | undefined =
    lastFinishedReason === undefined
      ? undefined
      : lastFinishedReason === 'completed' && sawUsage && inputTokens === 0 && outputTokens === 0
        ? 'failed'
        : lastFinishedReason === 'completed' && allToolCallsFailed && !sawText
          ? 'failed'
          : OUTCOME_BY_REASON[lastFinishedReason];

  return {
    sessionRef,
    inputTokens,
    outputTokens,
    cachedInputTokens,
    reasoningTokens,
    costUsd,
    costKind,
    toolCalls,
    failedToolCalls,
    openPermissionAsks: openAsks,
    lastLimit,
    outcome,
  };
}
