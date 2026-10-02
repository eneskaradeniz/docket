// The codebuddy stream dialect: maps the CLI's Claude-Code-style stream-json objects onto
// AgentEvents. Every mapped shape comes from the provider's SDK documentation — no logged-in
// capture exists yet, so the dialect stays inside the documented schema and leaves everything
// else to the transport's raw fallback. Contract: docs/v2/providers.md → P-11 and the mapping
// table on the provider issue.
import type { AgentEvent, EpochMs } from '../../../../../../domain/index';
import type { StreamDialect } from '../../stream-json';

type Clock = { readonly now: () => EpochMs };

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null;

// The prompt travels as one bare text line on stdin (print mode reads stdin when no prompt
// argument is given), so this dialect defines no input envelope: `--input-format stream-json`
// and its NDJSON user envelope are a different input mode the launch does not use.

// Tool names are the CLI's own and pass through verbatim. The target is the first string-valued
// parameter — which parameter that is varies by tool.
const toolTarget = (input: unknown): string | undefined => {
  if (!isRecord(input)) return undefined;
  for (const value of Object.values(input)) {
    if (typeof value === 'string') return value;
  }
  return undefined;
};

const usageOf = (usage: unknown, at: EpochMs): AgentEvent | undefined => {
  if (!isRecord(usage)) return undefined;
  if (typeof usage.input_tokens !== 'number' || typeof usage.output_tokens !== 'number') return undefined;
  const cached = usage.cache_read_input_tokens;
  // The documented usage object carries no reasoning-token count, so `reasoningTokens` stays
  // absent — thinking output is indistinguishable from the rest of output_tokens here.
  return {
    type: 'usage',
    at,
    inputTokens: usage.input_tokens,
    outputTokens: usage.output_tokens,
    ...(typeof cached === 'number' ? { cachedInputTokens: cached } : {}),
  };
};

// An assistant message carries its content blocks in order and its token counts beside them; a
// block the documentation does not show is skipped, not guessed at.
const assistantEvents = (message: unknown, at: EpochMs): readonly AgentEvent[] => {
  if (!isRecord(message) || !Array.isArray(message.content)) return [];
  const events: AgentEvent[] = [];
  for (const block of message.content) {
    if (!isRecord(block)) continue;
    if (block.type === 'text' && typeof block.text === 'string') {
      events.push({ type: 'text', at, delta: block.text });
      continue;
    }
    if (block.type === 'thinking' && typeof block.thinking === 'string') {
      events.push({ type: 'thinking', at, delta: block.thinking });
      continue;
    }
    if (block.type === 'tool_use' && typeof block.id === 'string' && typeof block.name === 'string') {
      const target = toolTarget(block.input);
      events.push({ type: 'tool_call', at, id: block.id, name: block.name, ...(target === undefined ? {} : { target }) });
    }
  }
  const usage = usageOf(message.usage, at);
  if (usage !== undefined) events.push(usage);
  return events;
};

// A user line in the output stream is the CLI's own echo of the turn: its text blocks are
// framing, only a tool_result block reports a tool's outcome. The line's top-level
// `tool_use_result` carries the raw result without the pairing id, so the content block is the
// only place a result can be paired.
const userEvents = (message: unknown, at: EpochMs): readonly AgentEvent[] => {
  if (!isRecord(message) || !Array.isArray(message.content)) return [];
  const events: AgentEvent[] = [];
  for (const block of message.content) {
    if (!isRecord(block)) continue;
    if (block.type === 'tool_result' && typeof block.tool_use_id === 'string') {
      events.push({ type: 'tool_result', at, id: block.tool_use_id, ok: block.is_error !== true });
    }
  }
  return events;
};

const GENERIC_ERROR = 'The agent run ended with an error.';

// The error class an errors_info category reads as; the CLI's own vocabulary names network and
// auth, every other documented category (model_service, cancelled, internal) is a plain failure.
const classOfCategory = (category: unknown): 'auth' | 'network' | 'unknown' =>
  category === 'auth' ? 'auth' : category === 'network' ? 'network' : 'unknown';

// The final object settles the run: `is_error` decides the verdict, the usage block (plus the
// CLI's own USD total) rides ahead of it, and an errors_info category shapes the failure — quota
// is the one limit the CLI names, auth is the logged-out refusal, anything else is a plain error.
// Never a second finish: the events here are the run's whole verdict.
const resultEvents = (line: Record<string, unknown>, at: EpochMs): readonly AgentEvent[] => {
  if (line.is_error !== true && line.is_error !== false) return [];
  const usage = usageOf(line.usage, at);
  const cost = line.total_cost_usd;
  const withCost =
    usage === undefined || typeof cost !== 'number'
      ? usage
      : { ...usage, costUsd: cost, costKind: 'reported' as const };
  const events: AgentEvent[] = [];
  if (withCost !== undefined) events.push(withCost);
  if (line.is_error === false) {
    events.push({ type: 'finished', at, reason: 'completed' });
    return events;
  }
  let hitQuota = false;
  let reported = false;
  for (const info of Array.isArray(line.errors_info) ? line.errors_info : []) {
    if (!isRecord(info)) continue;
    if (info.category === 'quota') {
      hitQuota = true;
      reported = true;
      events.push({ type: 'limit_hit', at, hit: { class: 'window_exhausted', remedies: ['wait'] } });
      continue;
    }
    reported = true;
    // The auth category is the logged-out refusal; its stable wording is the mapping table's own.
    const message =
      info.category === 'auth' ? 'login required' : typeof info.code === 'string' && info.code !== '' ? info.code : GENERIC_ERROR;
    events.push({ type: 'error', at, class: classOfCategory(info.category), message });
  }
  if (!reported) events.push({ type: 'error', at, class: 'unknown', message: GENERIC_ERROR });
  events.push({ type: 'finished', at, reason: hitQuota ? 'limit' : 'failed' });
  return events;
};

export function createCodebuddyDialect(clock: Clock): StreamDialect {
  return {
    id: 'codebuddy',
    parse: (line: unknown): readonly AgentEvent[] | null => {
      if (!isRecord(line)) return null;
      const at = clock.now();
      switch (line.type) {
        case 'system':
          // Only init maps: the session id opens the run. The line's `model` field names the
          // model the CLI started with, but no AgentEvent carries a model — the run's model is
          // the route's own choice, and what a logged-in init reports is an operator-run item.
          // Every other system notice (the task_* lifecycle, compact boundaries) stays raw.
          if (line.subtype !== 'init') return null;
          return [
            {
              type: 'session_started',
              at,
              sessionRef: typeof line.session_id === 'string' ? line.session_id : '',
            },
          ];
        case 'assistant':
          return assistantEvents(line.message, at);
        case 'user':
          return userEvents(line.message, at);
        case 'result':
          return resultEvents(line, at);
        default:
          return null;
      }
    },
  };
}
