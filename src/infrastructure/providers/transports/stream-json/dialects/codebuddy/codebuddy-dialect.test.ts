// P-11 tests: fixture-driven mapping for the codebuddy stream dialect. The fixtures are sample
// transcripts derived from the provider's own SDK documentation (see fixtures/README.md); the
// dialect never invents shapes the documentation does not show.
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import type { AgentEvent, EpochMs } from '../../../../../../domain/index';
import { BUILTIN_STREAM_DIALECTS } from '../../index';
import { createCodebuddyDialect } from './codebuddy-dialect';

const AT: EpochMs = 1_758_900_000_000;
const clock = { now: (): EpochMs => AT };
const dialect = createCodebuddyDialect(clock);

// Runs one fixture transcript through the dialect the way the transport does: parse each NDJSON
// line, keep the mapped events, skip nothing silently.
const eventsOf = (fixture: string): readonly AgentEvent[] => {
  const text = readFileSync(fileURLToPath(new URL(`./fixtures/${fixture}`, import.meta.url)), 'utf8');
  const events: AgentEvent[] = [];
  for (const line of text.split('\n')) {
    if (line === '') continue;
    const mapped = dialect.parse(JSON.parse(line));
    if (mapped === null) throw new Error(`fixture line not recognised: ${line}`);
    events.push(...mapped);
  }
  return events;
};

// The kinds-only view of an event list, for sequence assertions.
const kindsOf = (events: readonly AgentEvent[]): readonly string[] => events.map((event) => event.type);

const finishedCount = (events: readonly AgentEvent[]): number =>
  events.filter((event) => event.type === 'finished').length;

describe('codebuddy stream dialect', () => {
  it('P-11: the text turn fixture maps to session_started, one text, usage with the reported cost and one completed finished', () => {
    const events = eventsOf('text-turn.jsonl');
    expect(events).toEqual([
      { type: 'session_started', at: AT, sessionRef: 'cbf1001' },
      // The echoed user message is framing: its text block reports nothing, so the turn opens
      // with the assistant's own text and its token counts.
      { type: 'text', at: AT, delta: 'hello' },
      { type: 'usage', at: AT, inputTokens: 40, outputTokens: 8 },
      // The result's own usage carries the turn total, the cached share and the CLI's own USD
      // number, so the cost kind is reported.
      {
        type: 'usage',
        at: AT,
        inputTokens: 40,
        outputTokens: 8,
        cachedInputTokens: 12,
        costUsd: 0.0025,
        costKind: 'reported',
      },
      { type: 'finished', at: AT, reason: 'completed' },
    ]);
    expect(finishedCount(events)).toBe(1);
  });

  it('P-11: the tool turn fixture pairs tool_call and tool_result on one id and still finishes completed', () => {
    const events = eventsOf('tool-turn.jsonl');
    expect(kindsOf(events)).toEqual([
      'session_started',
      'tool_call',
      'usage',
      'tool_result',
      'text',
      'usage',
      'usage',
      'finished',
    ]);
    expect(events[1]).toEqual({
      type: 'tool_call',
      at: AT,
      id: 'toolu_b1',
      name: 'read_file',
      target: '/tmp/cb-probe/config.json',
    });
    expect(events[3]).toEqual({ type: 'tool_result', at: AT, id: 'toolu_b1', ok: true });
    expect(finishedCount(events)).toBe(1);
    expect(events.at(-1)).toEqual({ type: 'finished', at: AT, reason: 'completed' });
  });

  it('P-11: a quota result ends usage, limit_hit and one finished limit, so exhausted runs still fold into one finished', () => {
    const events = eventsOf('quota-result.jsonl');
    expect(events.at(-2)).toEqual({
      type: 'limit_hit',
      at: AT,
      hit: { class: 'window_exhausted', remedies: ['wait'] },
    });
    expect(events.at(-1)).toEqual({ type: 'finished', at: AT, reason: 'limit' });
    expect(finishedCount(events)).toBe(1);
  });

  it('P-11: an auth-category result reports the login requirement and fails the run', () => {
    const events = eventsOf('auth-result.jsonl');
    expect(kindsOf(events)).toEqual(['session_started', 'usage', 'error', 'finished']);
    expect(events[2]).toEqual({ type: 'error', at: AT, class: 'auth', message: 'login required' });
    expect(events.at(-1)).toEqual({ type: 'finished', at: AT, reason: 'failed' });
    expect(finishedCount(events)).toBe(1);
  });

  it('P-11: an error result without a mapped category still ends one error and one failed finished', () => {
    const events = eventsOf('error-result.jsonl');
    expect(events.at(-2)).toEqual({ type: 'error', at: AT, class: 'unknown', message: 'internal_error' });
    expect(events.at(-1)).toEqual({ type: 'finished', at: AT, reason: 'failed' });
    expect(finishedCount(events)).toBe(1);
  });

  it('P-11: recognised-but-silent shapes return an empty list and unknown shapes are not recognised', () => {
    // The echoed user text is framing and an assistant message without content blocks is a
    // degenerate line; a result line without its verdict boolean settles nothing by itself.
    expect(dialect.parse({ type: 'user', message: { role: 'user', content: [{ type: 'text', text: 'echo' }] } })).toEqual([]);
    expect(dialect.parse({ type: 'assistant', message: { role: 'assistant' } })).toEqual([]);
    expect(dialect.parse({ type: 'result', subtype: 'success' })).toEqual([]);
    // Anything else — the task lifecycle notices, unknown event kinds, non-objects — is left to
    // the transport's raw fallback, never guessed at.
    expect(dialect.parse({ type: 'system', subtype: 'task_started' })).toBeNull();
    expect(dialect.parse({ type: 'stream_event' })).toBeNull();
    expect(dialect.parse('plain diagnostic text on stdout')).toBeNull();
    expect(dialect.parse(42)).toBeNull();
    expect(dialect.parse(null)).toBeNull();
  });

  it('P-11: a thinking block maps to a thinking delta and a network-category error reads as network', () => {
    const thinking = dialect.parse({
      type: 'assistant',
      message: {
        role: 'assistant',
        content: [{ type: 'thinking', thinking: 'considering the file' }, { type: 'text', text: 'done' }],
        usage: { input_tokens: 5, output_tokens: 2 },
      },
    });
    expect(thinking).toEqual([
      { type: 'thinking', at: AT, delta: 'considering the file' },
      { type: 'text', at: AT, delta: 'done' },
      { type: 'usage', at: AT, inputTokens: 5, outputTokens: 2 },
    ]);
    const network = dialect.parse({
      type: 'result',
      is_error: true,
      errors_info: [{ status: 503, code: 'upstream_unreachable', category: 'network' }],
    });
    expect(network).toEqual([
      { type: 'error', at: AT, class: 'network', message: 'upstream_unreachable' },
      { type: 'finished', at: AT, reason: 'failed' },
    ]);
  });

  it('P-11: the dialect defines no input envelope — the prompt travels as one bare stdin line', () => {
    // Print mode reads the prompt from stdin when no prompt argument is given, so unlike the
    // envelope dialects this one must leave wrapInput undefined.
    expect(dialect.wrapInput).toBeUndefined();
  });

  it('P-11: the dialect is registered in the framework lookup under codebuddy', () => {
    const registered = BUILTIN_STREAM_DIALECTS['codebuddy'];
    expect(registered?.id).toBe('codebuddy');
  });
});
