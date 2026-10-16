// The agy stream dialect: maps the Antigravity CLI's stream-json output objects onto
// AgentEvents. Every mapped shape comes from operator-captured transcripts (fixtures/, the
// probe issue) — print-mode objects never appear here, the def launches stream-json mode.
// Contract: docs/v2/providers.md → P-11 and the mapping table on the probe issue.
import type { AgentEvent, EpochMs } from '../../../../../../domain/index';
import type { DialectContext, StreamDialect } from '../../stream-json';

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

// Headless mode cannot prompt for permissions, so a tool needing `command`, `mcp` or
// `write_file` permission is auto-denied while the stream still ends SUCCESS — the ERROR tool
// step reports the tool's failure, but the run-level verdict lives only in `denied_actions`.
// Exactly one `error` event (never `text`: that would read as the agent's own words and leak
// into handoff summaries) surfaces it; `foldRun` ignores error events, so the outcome stands.
const deniedActionEvent = (body: Record<string, unknown>, at: EpochMs): AgentEvent | null => {
  const denied = body.denied_actions;
  if (!Array.isArray(denied) || denied.length === 0) return null;
  const names: string[] = [];
  for (const entry of denied) {
    if (!isRecord(entry)) continue;
    if (typeof entry.action === 'string' && entry.action !== '') names.push(entry.action);
    else if (typeof entry.display_name === 'string' && entry.display_name !== '') names.push(entry.display_name);
  }
  const listed = names.join(', ').slice(0, 200); // first few names, ≤200 characters
  return { type: 'error', at, class: 'unknown', message: `agy denied ${denied.length} action(s): ${listed}` };
};

// The final object carries the run's statistics and verdict. The CLI reports no money figure,
// so the usage event carries tokens plus the route's cost kind from the dialect context — the
// consumer reads costs the way the route's registry row defines them.
const resultEvents = (body: unknown, at: EpochMs, context: DialectContext): readonly AgentEvent[] | null => {
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
      costKind: context.costKind,
    });
  }
  const denial = deniedActionEvent(body, at);
  if (denial !== null) events.push(denial);
  events.push({ type: 'finished', at, reason: body.status === 'SUCCESS' ? 'completed' : 'failed' });
  return events;
};

export function createAgyDialect(clock: Clock): StreamDialect {
  return {
    id: 'agy',
    wrapInput: wrapUserLine,
    parse: (line: unknown, context: DialectContext): readonly AgentEvent[] | null => {
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
          return resultEvents(line.result, at, context);
        default:
          return null;
      }
    },
  };
}
