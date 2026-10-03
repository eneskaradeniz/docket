import { describe, expect, it } from 'vitest';
import type { EpochMs } from '../shared/index';
import type { AgentEvent } from './agent-event';
import { ACCOUNT_TEST_DETAIL_MAX_CHARS, ACCOUNT_TEST_PROMPT, classifyAccountTest } from './account-test';
import type { AccountTestInput } from './account-test';

const AT: EpochMs = 1_760_000_000_000;

const err = (cls: 'auth' | 'network' | 'crash' | 'protocol' | 'timeout' | 'unknown', message: string): AgentEvent => ({ type: 'error', at: AT, class: cls, message });
const finished = (reason: 'completed' | 'failed' | 'cancelled' | 'limit'): AgentEvent => ({ type: 'finished', at: AT, reason });
const limitHit: AgentEvent = { type: 'limit_hit', at: AT, hit: { class: 'throughput', remedies: ['wait'] } };

const run = (over: Partial<AccountTestInput>) => classifyAccountTest({ events: [], timedOut: false, ...over });

describe('classifyAccountTest', () => {
  it('R-58: the fixed prompt and the cut length are the contract values', () => {
    expect(ACCOUNT_TEST_PROMPT).toBe('Reply with the single word OK. Do not use any tools.');
    expect(ACCOUNT_TEST_DETAIL_MAX_CHARS).toBe(300);
  });

  it('R-58: a start failure maps to its class with the message as detail', () => {
    expect(run({ startFailure: { code: 'not_logged_in', message: 'login first' } })).toEqual({ ok: false, class: 'auth', detail: 'login first' });
    expect(run({ startFailure: { code: 'not_installed', message: 'm1' } })).toEqual({ ok: false, class: 'install', detail: 'm1' });
    expect(run({ startFailure: { code: 'spawn_failed', message: 'm2' } })).toEqual({ ok: false, class: 'install', detail: 'm2' });
    expect(run({ startFailure: { code: 'unsupported', message: 'm3' } })).toEqual({ ok: false, class: 'unknown', detail: 'm3' });
  });

  it('R-58: a start failure beats events and timeout', () => {
    const out = run({ startFailure: { code: 'not_logged_in', message: 'x' }, events: [limitHit, finished('completed')], timedOut: true });
    expect(out).toEqual({ ok: false, class: 'auth', detail: 'x' });
  });

  it('R-58: a limit_hit event is class limit with an empty detail and beats an error', () => {
    expect(run({ events: [err('auth', 'secret'), limitHit] })).toEqual({ ok: false, class: 'limit', detail: '' });
  });

  it('R-58: a limit_hit beats the timeout', () => {
    expect(run({ events: [limitHit], timedOut: true })).toEqual({ ok: false, class: 'limit', detail: '' });
  });

  it('R-58: a timeout is class network with detail timeout, before any error', () => {
    expect(run({ timedOut: true, events: [err('auth', 'x')] })).toEqual({ ok: false, class: 'network', detail: 'timeout' });
    expect(run({ timedOut: true, events: [finished('completed')] })).toEqual({ ok: false, class: 'network', detail: 'timeout' });
  });

  it('R-58: error classes auth and network/timeout map directly, detail is the message', () => {
    expect(run({ events: [err('auth', 'bad key')] })).toEqual({ ok: false, class: 'auth', detail: 'bad key' });
    expect(run({ events: [err('network', 'down')] })).toEqual({ ok: false, class: 'network', detail: 'down' });
    expect(run({ events: [err('timeout', 'slow')] })).toEqual({ ok: false, class: 'network', detail: 'slow' });
  });

  it('R-58: protocol, crash and unknown errors are model when the message names a model problem, else unknown', () => {
    for (const cls of ['protocol', 'crash', 'unknown'] as const) {
      expect(run({ events: [err(cls, 'The model foo does not exist')] })).toEqual({ ok: false, class: 'model', detail: 'The model foo does not exist' });
      expect(run({ events: [err(cls, 'boom')] })).toEqual({ ok: false, class: 'unknown', detail: 'boom' });
    }
    expect(run({ events: [err('crash', 'Model is NOT AVAILABLE on your plan')] }).ok).toBe(false);
    expect(run({ events: [err('crash', 'Model is NOT AVAILABLE on your plan')] })).toMatchObject({ class: 'model' });
    expect(run({ events: [err('crash', 'remodel not found')] })).toMatchObject({ class: 'unknown' });
  });

  it('R-58: only the first error event counts', () => {
    expect(run({ events: [err('network', 'first'), err('auth', 'second')] })).toEqual({ ok: false, class: 'network', detail: 'first' });
  });

  it('R-58: an error beats a completed finish', () => {
    expect(run({ events: [err('auth', 'x'), finished('completed')] })).toMatchObject({ ok: false, class: 'auth' });
  });

  it('R-58: finished completed is ok', () => {
    expect(run({ events: [finished('completed')] })).toEqual({ ok: true });
  });

  it('R-58: finished limit is class limit; other reasons or no finish are unknown with empty detail', () => {
    expect(run({ events: [finished('limit')] })).toEqual({ ok: false, class: 'limit', detail: '' });
    expect(run({ events: [finished('failed')] })).toEqual({ ok: false, class: 'unknown', detail: '' });
    expect(run({ events: [finished('cancelled')] })).toEqual({ ok: false, class: 'unknown', detail: '' });
    expect(run({ events: [] })).toEqual({ ok: false, class: 'unknown', detail: '' });
  });

  it('R-58a: a detail longer than 300 code points is returned whole', () => {
    const long = '\u{1F600}'.repeat(400);
    const out = run({ events: [err('auth', long)] });
    expect(out.ok).toBe(false);
    if (!out.ok) expect(out.detail).toBe(long);
    const message = 'a'.repeat(500);
    expect(run({ startFailure: { code: 'spawn_failed', message } })).toEqual({ ok: false, class: 'install', detail: message });
  });

  it('R-58: text and thinking deltas never reach a detail', () => {
    const events: AgentEvent[] = [
      { type: 'text', at: AT, delta: 'SECRET-OUTPUT' },
      { type: 'thinking', at: AT, delta: 'SECRET-THOUGHT' },
      finished('failed'),
    ];
    expect(JSON.stringify(run({ events }))).not.toContain('SECRET');
    expect(JSON.stringify(run({ events: [...events, err('crash', 'x')] }))).not.toContain('SECRET');
  });

  it('R-58: the same input gives the same outcome and the input is not mutated', () => {
    const input: AccountTestInput = { events: [err('auth', 'x')], timedOut: false };
    const copy = JSON.stringify(input);
    expect(classifyAccountTest(input)).toEqual(classifyAccountTest(input));
    expect(JSON.stringify(input)).toBe(copy);
  });
});
