// The amp stream dialect: maps the CLI's Claude-Code-compatible stream-json objects onto
// AgentEvents. Every mapped shape comes from the provider's streaming-json documentation — no
// operator capture exists yet, so the dialect stays inside the documented schema and leaves
// everything else to the transport's raw fallback. Contract: docs/v2/providers.md → P-11.
import type { AgentEvent, EpochMs } from '../../../../../../domain/index';
import type { StreamDialect } from '../../stream-json';

type Clock = { readonly now: () => EpochMs };

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null;

// The prompt travels as one bare text line on stdin (`-x` reads it from stdin), so this dialect
// defines no input envelope: `--stream-json-input` and its NDJSON user envelope are a different
// input mode the launch does not use.

// Tool names are documented inconsistently across the CLI's own surfaces (Bash, read, create_file,
// …), so the name passes through verbatim. The target is the first string-valued parameter —
// which parameter that is varies by tool the same way.
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
      // Present only when the CLI runs with its --stream-json-thinking extension; mapped
      // whenever it appears, never requested by the launch.
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
// framing, only a tool_result block reports a tool's outcome.
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

// The final object settles the run: `is_error` decides the verdict, the optional usage block
// rides ahead of it, and the error text becomes the run's error event — never a second finish.
const resultEvents = (line: Record<string, unknown>, at: EpochMs): readonly AgentEvent[] => {
  if (line.is_error !== true && line.is_error !== false) return [];
  const events: AgentEvent[] = [];
  const usage = usageOf(line.usage, at);
  if (usage !== undefined) events.push(usage);
  if (line.is_error) {
    events.push({
      type: 'error',
      at,
      class: 'crash',
      message: typeof line.error === 'string' && line.error !== '' ? line.error : 'The agent run ended with an error.',
    });
    events.push({ type: 'finished', at, reason: 'failed' });
    return events;
  }
  events.push({ type: 'finished', at, reason: 'completed' });
  return events;
};

export function createAmpDialect(clock: Clock): StreamDialect {
  return {
    id: 'amp',
    parse: (line: unknown): readonly AgentEvent[] | null => {
      if (!isRecord(line)) return null;
      const at = clock.now();
      switch (line.type) {
        case 'system':
          if (line.subtype !== 'init') return null; // mid-stream system notices stay raw
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
