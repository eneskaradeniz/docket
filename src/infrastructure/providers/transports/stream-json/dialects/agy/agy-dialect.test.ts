// P-11 tests: fixture-driven mapping for the agy stream dialect. The fixtures are operator
// captures (see fixtures/README.md); every assertion below is the architect's mapping table on
// the probe issue — the dialect never invents shapes the captures do not show.
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import type { AgentEvent, EpochMs } from '../../../../../../domain/index';
import { BUILTIN_STREAM_DIALECTS } from '../../index';
import { createAgyDialect } from './agy-dialect';

const AT: EpochMs = 1_758_900_000_000;
const clock = { now: (): EpochMs => AT };
const dialect = createAgyDialect(clock);

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

describe('agy stream dialect', () => {
  it('P-11: the text turn fixture maps to session_started, one text, usage and a completed finished', () => {
    expect(eventsOf('text-turn.jsonl')).toEqual([
      { type: 'session_started', at: AT, sessionRef: '4e62b6ca-5db0-4ac6-ab17-1af3f9d9a89e' },
      { type: 'text', at: AT, delta: 'hello\n' },
      { type: 'usage', at: AT, inputTokens: 13389, outputTokens: 136, cachedInputTokens: 0 },
      { type: 'finished', at: AT, reason: 'completed' },
    ]);
  });

  it('P-11: the tool turn fixture pairs tool_call and failed tool_result on one id and still finishes completed', () => {
    const events = eventsOf('tool-turn.jsonl');
    expect(kindsOf(events)).toEqual(['session_started', 'tool_call', 'tool_result', 'usage', 'finished']);
    const call = events[1];
    expect(call).toEqual({
      type: 'tool_call',
      at: AT,
      id: '2',
      name: 'write_to_file',
      target: '/tmp/agy-probe/probe.txt',
    });
    expect(events[2]).toEqual({ type: 'tool_result', at: AT, id: '2', ok: false });
    // A headless auto-denial is not a permission ask (the CLI cannot ask; the def says
    // permissionAsk: false) — the ERROR tool step already carries the denial.
    expect(events.some((event) => event.type === 'permission_ask')).toBe(false);
    expect(events.at(-1)).toEqual({ type: 'finished', at: AT, reason: 'completed' });
  });

  it('P-11: an ERROR result ends usage + finished failed, so malformed-input runs still fold into one finished', () => {
    const events = eventsOf('error-result.jsonl');
    expect(kindsOf(events)).toEqual(['session_started', 'text', 'usage', 'finished']);
    expect(events.at(-1)).toEqual({ type: 'finished', at: AT, reason: 'failed' });
  });

  it('P-11: recognised-but-silent shapes return an empty list and unknown shapes are not recognised', () => {
    // user_input steps are framing, a textless agent_response is a tool turn's non-answer,
    // a tool step in a non-terminal state has nothing to report yet.
    expect(dialect.parse({ event: 'step_update', step_update: { step_index: 0, state: 'DONE', step_type: 'user_input' } })).toEqual([]);
    expect(dialect.parse({ event: 'step_update', step_update: { step_index: 1, state: 'DONE', step_type: 'agent_response' } })).toEqual([]);
    expect(dialect.parse({ event: 'step_update', step_update: { step_index: 2, state: 'PENDING', step_type: 'tool', tool_name: 'read_file' } })).toEqual([]);
    // Anything else — unknown event kinds, unknown step types, non-objects — is left to the
    // transport's raw fallback, never guessed at.
    expect(dialect.parse({ event: 'notification' })).toBeNull();
    expect(dialect.parse({ event: 'step_update', step_update: { step_index: 9, state: 'DONE', step_type: 'checkpoint' } })).toBeNull();
    expect(dialect.parse('jetski: no output produced — a tool required the write_file permission')).toBeNull();
    expect(dialect.parse(42)).toBeNull();
    expect(dialect.parse(null)).toBeNull();
  });

  it('P-11: the input envelope wraps any prompt as exactly one NDJSON user line', () => {
    const wrapInput = dialect.wrapInput;
    expect(wrapInput).toBeDefined();
    if (wrapInput === undefined) throw new Error('wrapInput missing');
    expect(wrapInput('Reply with exactly: hello')).toBe(
      '{"event":"user","message":{"role":"user","content":"Reply with exactly: hello"}}',
    );
    // A multi-line work order still arrives as one line: JSON escapes the newlines.
    const wrapped = wrapInput('line one\nline two');
    expect(wrapped.split('\n')).toHaveLength(1);
    expect(JSON.parse(wrapped)).toEqual({ event: 'user', message: { role: 'user', content: 'line one\nline two' } });
  });

  it('P-11: the dialect is registered in the framework lookup under agy', () => {
    const registered = BUILTIN_STREAM_DIALECTS['agy'];
    expect(registered?.id).toBe('agy');
    expect(registered?.wrapInput).toBeDefined();
  });
});
