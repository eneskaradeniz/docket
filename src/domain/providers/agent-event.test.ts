import { describe, expect, expectTypeOf, it } from 'vitest';
import type { LimitHit, Meter } from '../quota/index';
import type { EpochMs } from '../shared/index';
import type { AgentEvent, CostKind } from './agent-event';

const AT: EpochMs = 1_760_000_000_000;

describe('AgentEvent', () => {
  it('has exactly the contract event kinds', () => {
    expectTypeOf<AgentEvent['type']>().toEqualTypeOf<
      | 'session_started'
      | 'text'
      | 'thinking'
      | 'tool_call'
      | 'tool_result'
      | 'permission_ask'
      | 'permission_answered'
      | 'usage'
      | 'quota_signal'
      | 'limit_hit'
      | 'error'
      | 'finished'
      | 'raw'
    >();
  });

  it('CostKind is the closed cost-provenance union', () => {
    expectTypeOf<CostKind>().toEqualTypeOf<'reported' | 'computed' | 'equivalent' | 'credits'>();
  });

  it('timestamps are EpochMs on every variant', () => {
    expectTypeOf<Extract<AgentEvent, { type: 'session_started' }>['at']>().toEqualTypeOf<EpochMs>();
    expectTypeOf<Extract<AgentEvent, { type: 'usage' }>['at']>().toEqualTypeOf<EpochMs>();
    expectTypeOf<Extract<AgentEvent, { type: 'raw' }>['at']>().toEqualTypeOf<EpochMs>();
  });

  it('stream payloads keep their contract shapes', () => {
    expectTypeOf<Extract<AgentEvent, { type: 'session_started' }>['sessionRef']>().toEqualTypeOf<string>();
    expectTypeOf<Extract<AgentEvent, { type: 'text' }>['delta']>().toEqualTypeOf<string>();
    expectTypeOf<Extract<AgentEvent, { type: 'thinking' }>['delta']>().toEqualTypeOf<string>();
    expectTypeOf<Extract<AgentEvent, { type: 'tool_call' }>['id']>().toEqualTypeOf<string>();
    expectTypeOf<Extract<AgentEvent, { type: 'tool_call' }>['name']>().toEqualTypeOf<string>();
    expectTypeOf<Extract<AgentEvent, { type: 'tool_call' }>['target']>().toEqualTypeOf<string | undefined>();
    expectTypeOf<Extract<AgentEvent, { type: 'tool_result' }>['ok']>().toEqualTypeOf<boolean>();
    expectTypeOf<Extract<AgentEvent, { type: 'permission_ask' }>['tool']>().toEqualTypeOf<string>();
    expectTypeOf<Extract<AgentEvent, { type: 'permission_ask' }>['options']>().toEqualTypeOf<readonly string[]>();
    expectTypeOf<Extract<AgentEvent, { type: 'permission_ask' }>['target']>().toEqualTypeOf<string | undefined>();
    expectTypeOf<Extract<AgentEvent, { type: 'permission_answered' }>['id']>().toEqualTypeOf<string>();
    expectTypeOf<Extract<AgentEvent, { type: 'permission_answered' }>['decision']>().toEqualTypeOf<'allow' | 'deny'>();
  });

  it('usage carries token counts and optional cost provenance', () => {
    expectTypeOf<Extract<AgentEvent, { type: 'usage' }>['inputTokens']>().toEqualTypeOf<number>();
    expectTypeOf<Extract<AgentEvent, { type: 'usage' }>['outputTokens']>().toEqualTypeOf<number>();
    expectTypeOf<Extract<AgentEvent, { type: 'usage' }>['cachedInputTokens']>().toEqualTypeOf<number | undefined>();
    expectTypeOf<Extract<AgentEvent, { type: 'usage' }>['costUsd']>().toEqualTypeOf<number | undefined>();
    expectTypeOf<Extract<AgentEvent, { type: 'usage' }>['costKind']>().toEqualTypeOf<CostKind | undefined>();
  });

  it('quota_signal carries a meter without ids plus an optional pool label', () => {
    type QuotaSignalMeter = Extract<AgentEvent, { type: 'quota_signal' }>['meter'];
    expectTypeOf<QuotaSignalMeter>().toEqualTypeOf<Omit<Meter, 'id' | 'poolId'> & { readonly poolLabel?: string }>();
  });

  it('limit_hit carries a hit without account id and timestamp', () => {
    type LimitHitEvent = Extract<AgentEvent, { type: 'limit_hit' }>;
    expectTypeOf<LimitHitEvent['hit']>().toEqualTypeOf<Omit<LimitHit, 'accountId' | 'at'>>();
  });

  it('error and finished keep their closed unions', () => {
    expectTypeOf<Extract<AgentEvent, { type: 'error' }>['class']>().toEqualTypeOf<
      'auth' | 'network' | 'crash' | 'protocol' | 'timeout' | 'unknown'
    >();
    expectTypeOf<Extract<AgentEvent, { type: 'error' }>['reason']>().toEqualTypeOf<
      'first_output_timeout' | 'inactivity_timeout' | undefined
    >();
    expectTypeOf<Extract<AgentEvent, { type: 'error' }>['message']>().toEqualTypeOf<string>();
    expectTypeOf<Extract<AgentEvent, { type: 'finished' }>['reason']>().toEqualTypeOf<
      'completed' | 'failed' | 'cancelled' | 'limit'
    >();
  });

  it('every contract variant is constructible, optional fields included', () => {
    const meter: Omit<Meter, 'id' | 'poolId'> = {
      label: '5h window',
      cadence: 'rolling_continuous',
      durationMs: 5 * 3_600_000,
      unit: 'percent',
      used: 40,
      limit: 100,
      remaining: 60,
      resetsAt: AT + 60_000,
      resetPrecision: 'relative',
      observedAt: AT,
      source: 'pushed',
    };
    const hit: Omit<LimitHit, 'accountId' | 'at'> = {
      class: 'window_exhausted',
      resetsAt: AT + 60_000,
      remedies: ['wait'],
    };
    const events: readonly AgentEvent[] = [
      { type: 'session_started', at: AT, sessionRef: 'sess-1' },
      { type: 'text', at: AT, delta: 'hello' },
      { type: 'thinking', at: AT, delta: 'hmm' },
      { type: 'tool_call', at: AT, id: 't1', name: 'shell', target: 'npm test' },
      { type: 'tool_call', at: AT, id: 't2', name: 'read' },
      { type: 'tool_result', at: AT, id: 't1', ok: true },
      { type: 'permission_ask', at: AT, id: 'p1', tool: 'shell', target: 'rm -rf build', options: ['allow', 'deny'] },
      { type: 'permission_ask', at: AT, id: 'p2', tool: 'write', options: [] },
      { type: 'permission_answered', at: AT, id: 'p1', decision: 'allow' },
      { type: 'permission_answered', at: AT, id: 'p2', decision: 'deny' },
      { type: 'usage', at: AT, inputTokens: 10, outputTokens: 5, cachedInputTokens: 2, costUsd: 0.01, costKind: 'reported' },
      { type: 'usage', at: AT, inputTokens: 1, outputTokens: 1 },
      { type: 'quota_signal', at: AT, meter },
      { type: 'quota_signal', at: AT, meter: { ...meter, poolLabel: 'Pro pool' } },
      { type: 'limit_hit', at: AT, hit },
      { type: 'error', at: AT, class: 'network', message: 'offline' },
      { type: 'finished', at: AT, reason: 'completed' },
      { type: 'raw', at: AT, line: '{"x":1}' },
    ];
    expect(events).toHaveLength(18);
  });
});
