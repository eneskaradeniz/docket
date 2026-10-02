// P-11 tests: fixture-driven mapping for the amp stream dialect. The fixtures are sample
// transcripts derived from the provider's own streaming-json documentation (see fixtures/README.md);
// the dialect never invents shapes the documentation does not show.
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import type { AgentEvent, EpochMs } from '../../../../../../domain/index';
import { BUILTIN_STREAM_DIALECTS } from '../../index';
import { createAmpDialect } from './amp-dialect';

const AT: EpochMs = 1_758_900_000_000;
const clock = { now: (): EpochMs => AT };
const dialect = createAmpDialect(clock);

// Runs one fixture transcript through the dialect the way the transport does: parse each
// NDJSON line, keep the mapped events, skip nothing silently.
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

describe('amp stream dialect', () => {
  it('P-11: the text turn fixture maps to session_started, text, usage and one completed finished', () => {
    expect(eventsOf('text-turn.jsonl')).toEqual([
      { type: 'session_started', at: AT, sessionRef: 'T-fake1001' },
      { type: 'text', at: AT, delta: 'All Markdown files in this folder:\n- README.md (root)' },
      {
        type: 'usage',
        at: AT,
        inputTokens: 1200,
        outputTokens: 340,
        cachedInputTokens: 800,
      },
      // The result repeats the turn's totals as its own usage event, then settles the run.
      {
        type: 'usage',
        at: AT,
        inputTokens: 1200,
        outputTokens: 340,
        cachedInputTokens: 800,
      },
      { type: 'finished', at: AT, reason: 'completed' },
    ]);
  });

  it('P-11: the tool turn fixture pairs tool_call and tool_result on one id, keeps the tool name verbatim and maps the thinking block', () => {
    const events = eventsOf('tool-turn.jsonl');
    expect(kindsOf(events)).toEqual([
      'session_started',
      'thinking',
      'tool_call',
      // every assistant message carries its own token counts, then the result repeats the totals
      'usage',
      'tool_result',
      'text',
      'usage',
      'usage',
      'finished',
    ]);
    // Tool names are documented inconsistently (Bash, read, create_file, …): the name passes
    // through verbatim, never validated against a list.
    expect(events[2]).toEqual({
      type: 'tool_call',
      at: AT,
      id: 'toolu_01ABCD',
      name: 'read',
      target: '/tmp/amp-probe/config.json',
    });
    expect(events[4]).toEqual({ type: 'tool_result', at: AT, id: 'toolu_01ABCD', ok: true });
    expect(events[1]).toEqual({ type: 'thinking', at: AT, delta: 'The config file is asked for by path; read it.' });
    expect(events.at(-1)).toEqual({ type: 'finished', at: AT, reason: 'completed' });
    // The CLI raises no permission ask (the def says permissionAsk: false).
    expect(events.some((event) => event.type === 'permission_ask')).toBe(false);
  });

  it('P-11: an error result ends usage, error and one failed finished, so failed runs still fold into one finished', () => {
    const events = eventsOf('error-result.jsonl');
    expect(kindsOf(events)).toEqual(['session_started', 'text', 'usage', 'usage', 'error', 'finished']);
    expect(events[4]).toEqual({
      type: 'error',
      at: AT,
      class: 'crash',
      message: 'tool execution failed after 3 retries',
    });
    expect(events.at(-1)).toEqual({ type: 'finished', at: AT, reason: 'failed' });
  });

  it('P-11: recognised-but-silent shapes return an empty list and unknown shapes are not recognised', () => {
    // The echoed user text is framing, not agent output; an assistant message without a content
    // array says nothing mappable.
    expect(
      dialect.parse({ type: 'user', message: { role: 'user', content: [{ type: 'text', text: 'do the thing' }] } }),
    ).toEqual([]);
    expect(dialect.parse({ type: 'assistant', message: { role: 'assistant' }, session_id: 'T-x' })).toEqual([]);
    // Anything else — system error notices, unknown types, non-objects — is left to the
    // transport's raw fallback, never guessed at.
    expect(dialect.parse({ type: 'system', subtype: 'error_max_turns', error: 'too many turns' })).toBeNull();
    expect(dialect.parse({ type: 'notification', subtype: 'status' })).toBeNull();
    expect(dialect.parse(42)).toBeNull();
    expect(dialect.parse(null)).toBeNull();
    expect(dialect.parse('plain text line')).toBeNull();
  });

  it('P-11: the dialect is registered in the framework lookup under amp', () => {
    const registered = BUILTIN_STREAM_DIALECTS['amp'];
    expect(registered?.id).toBe('amp');
  });
});
