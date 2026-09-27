// session/update → AgentEvent mapping for the ACP transport. A `null` return means "no event
// from this update" — the transport degrades the update to a raw event, so an update kind this
// client does not know is never an error. An empty array means "recognised, deliberately
// silent". Contract: docs/v2/providers.md → "ACP transport (P-15)".
import type { AgentEvent, EpochMs } from '../../../../domain/index';

/** One conversation entry observed in a session/update chunk, kept for the resume fallback. */
export interface TranscriptEntry {
  readonly role: 'user' | 'agent';
  readonly text: string;
}

type UnknownRecord = Readonly<Record<string, unknown>>;

const asRecord = (value: unknown): UnknownRecord | null =>
  typeof value === 'object' && value !== null && !Array.isArray(value) ? (value as UnknownRecord) : null;

const asString = (value: unknown): string | undefined => (typeof value === 'string' ? value : undefined);

/** Text of a message-chunk content block; non-text content (images and the like) yields none. */
const textOf = (content: unknown): string | undefined => {
  const block = asRecord(content);
  if (block === null || block.type !== 'text') return undefined;
  return asString(block.text);
};

/** The transcript entry of a user/agent message chunk, or none when the update carries no text. */
export function transcriptEntryOf(update: unknown): TranscriptEntry | null {
  const record = asRecord(update);
  if (record === null) return null;
  if (record.sessionUpdate === 'user_message_chunk') {
    const text = textOf(record.content);
    return text === undefined ? null : { role: 'user', text };
  }
  if (record.sessionUpdate === 'agent_message_chunk') {
    const text = textOf(record.content);
    return text === undefined ? null : { role: 'agent', text };
  }
  return null;
}

const firstLocationPath = (record: UnknownRecord): string | undefined => {
  const locations = Array.isArray(record.locations) ? record.locations : [];
  const location = locations.length > 0 ? asRecord(locations[0]) : null;
  return location === null ? undefined : asString(location.path);
};

const toolCallEvent = (record: UnknownRecord, at: EpochMs): readonly AgentEvent[] | null => {
  const id = asString(record.toolCallId);
  if (id === undefined) return null;
  const name = asString(record.name) ?? asString(record.title) ?? id;
  const target = firstLocationPath(record);
  return [
    { type: 'tool_call', at, id, name, ...(target === undefined ? {} : { target }) },
  ];
};

const toolCallUpdateEvents = (record: UnknownRecord, at: EpochMs): readonly AgentEvent[] | null => {
  const id = asString(record.toolCallId);
  if (id === undefined) return null;
  if (record.status === 'completed') return [{ type: 'tool_result', at, id, ok: true }];
  if (record.status === 'failed') return [{ type: 'tool_result', at, id, ok: false }];
  // pending / in_progress / unstated: the tool call is recognised but has nothing to report yet.
  return [];
};

const usageEvent = (record: UnknownRecord, at: EpochMs): readonly AgentEvent[] | null => {
  if (typeof record.used !== 'number' || typeof record.size !== 'number') return null;
  const cost = asRecord(record.cost);
  const amount = cost === null ? undefined : (typeof cost.amount === 'number' ? cost.amount : undefined);
  const currency = cost === null ? undefined : asString(cost.currency);
  return [
    {
      type: 'usage',
      at,
      // The protocol reports cumulative session context, not an input/output split; the context
      // rides the input side and the (unknown) output side stays zero rather than being invented.
      inputTokens: record.used,
      outputTokens: 0,
      ...(amount !== undefined && currency === 'USD'
        ? { costUsd: amount, costKind: 'reported' as const }
        : {}),
    },
  ];
};

export function mapSessionUpdate(update: unknown, at: EpochMs): readonly AgentEvent[] | null {
  const record = asRecord(update);
  if (record === null) return null;
  switch (record.sessionUpdate) {
    case 'agent_message_chunk': {
      const text = textOf(record.content);
      return text === undefined ? null : [{ type: 'text', at, delta: text }];
    }
    case 'agent_thought_chunk': {
      const text = textOf(record.content);
      return text === undefined ? null : [{ type: 'thinking', at, delta: text }];
    }
    case 'tool_call':
      return toolCallEvent(record, at);
    case 'tool_call_update':
      return toolCallUpdateEvents(record, at);
    case 'usage_update':
      return usageEvent(record, at);
    default:
      // Every other kind — plan, mode and command updates, replayed user messages, and anything
      // a newer protocol version invents — has no dedicated event and degrades to raw.
      return null;
  }
}
