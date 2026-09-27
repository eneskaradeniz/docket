// The agy stream dialect: maps the Antigravity CLI's stream-json output objects onto
// AgentEvents. Every mapped shape comes from operator-captured transcripts (fixtures/, the
// probe issue) — print-mode objects never appear here, the def launches stream-json mode.
// Contract: docs/v2/providers.md → P-11 and the mapping table on the probe issue.
import type { AgentEvent, EpochMs } from '../../../../../../domain/index';
import type { StreamDialect } from '../../stream-json';

type Clock = { readonly now: () => EpochMs };

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null;

// The CLI requires every user turn as one NDJSON line in this envelope (its Go unmarshal
// rejects a bare string or a missing `event` field), so the prompt is wrapped — never placed
// in argv — and JSON escaping keeps even a multi-line work order on a single line.
const wrapUserLine = (prompt: string): string =>
  JSON.stringify({ event: 'user', message: { role: 'user', content: prompt } });

// Tool activity is correlated by `step_index`: the ACTIVE step is the call, the DONE/ERROR
// step with the same index is its result. The target is the first string-valued parameter.
const toolTarget = (body: Record<string, unknown>): string | undefined => {
  const info = body.tool_info;
  if (!isRecord(info) || !isRecord(info.parameters)) return undefined;
  for (const value of Object.values(info.parameters)) {
    if (typeof value === 'string') return value;
  }
  return undefined;
};

const stepUpdateEvents = (body: unknown, at: EpochMs): readonly AgentEvent[] | null => {
  if (!isRecord(body)) return null;
  switch (body.step_type) {
    case 'user_input':
      return []; // framing, not agent output
    case 'agent_response': {
      if (typeof body.text_delta !== 'string') return []; // a tool turn answers without text
      return [{ type: 'text', at, delta: body.text_delta }];
    }
    case 'tool': {
      const index = body.step_index;
      if (typeof index !== 'number') return null;
      const id = String(index);
      if (body.state === 'ACTIVE') {
        const name = body.tool_name;
        if (typeof name !== 'string' || name === '') return null;
        const target = toolTarget(body);
        return [{ type: 'tool_call', at, id, name, ...(target === undefined ? {} : { target }) }];
      }
      if (body.state === 'DONE' || body.state === 'ERROR') {
        return [{ type: 'tool_result', at, id, ok: body.state === 'DONE' }];
      }
      return []; // a non-terminal tool state has nothing to report yet
    }
    default:
      return null;
  }
};

// The final object carries the run's statistics and verdict; `denied_actions` needs no event
// of its own — the ERROR tool step already reported the denial.
const resultEvents = (body: unknown, at: EpochMs): readonly AgentEvent[] | null => {
  if (!isRecord(body)) return null;
  const events: AgentEvent[] = [];
  const usage = body.usage;
  if (
    isRecord(usage) &&
    typeof usage.input_tokens === 'number' &&
    typeof usage.output_tokens === 'number'
  ) {
    const cached = usage.cache_read_tokens;
    events.push({
      type: 'usage',
      at,
      inputTokens: usage.input_tokens,
      outputTokens: usage.output_tokens,
      ...(typeof cached === 'number' ? { cachedInputTokens: cached } : {}),
    });
  }
  events.push({ type: 'finished', at, reason: body.status === 'SUCCESS' ? 'completed' : 'failed' });
  return events;
};

export function createAgyDialect(clock: Clock): StreamDialect {
  return {
    id: 'agy',
    wrapInput: wrapUserLine,
    parse: (line: unknown): readonly AgentEvent[] | null => {
      if (!isRecord(line)) return null;
      const at = clock.now();
      switch (line.event) {
        case 'init': {
          const id = line.conversation_id;
          return [{ type: 'session_started', at, sessionRef: typeof id === 'string' ? id : '' }];
        }
        case 'step_update':
          return stepUpdateEvents(line.step_update, at);
        case 'result':
          return resultEvents(line.result, at);
        default:
          return null;
      }
    },
  };
}
