import { describe, expect, expectTypeOf, it } from 'vitest';
import type { EpochMs } from '../shared/index';
import type { AgentEvent } from './agent-event';
import { foldRun } from './fold-run';

const AT: EpochMs = 1_760_000_000_000;
const at = (offset: number): EpochMs => AT + offset;

const usage = (over: {
  readonly at: EpochMs;
  readonly inputTokens: number;
  readonly outputTokens: number;
  readonly cachedInputTokens?: number;
  readonly costUsd?: number;
  readonly costKind?: 'reported' | 'computed' | 'equivalent';
}): AgentEvent => ({ type: 'usage', ...over });

describe('foldRun', () => {
  it('R-44: sums token counts across all usage events', () => {
    const events: readonly AgentEvent[] = [
      { type: 'session_started', at: at(0), sessionRef: 'sess-1' },
      usage({ at: at(1), inputTokens: 100, outputTokens: 10 }),
      { type: 'text', at: at(2), delta: 'hello' },
      usage({ at: at(3), inputTokens: 250, outputTokens: 25, cachedInputTokens: 40 }),
      usage({ at: at(4), inputTokens: 50, outputTokens: 5, cachedInputTokens: 10 }),
    ];
    const summary = foldRun(events);
    expect(summary.inputTokens).toBe(400);
    expect(summary.outputTokens).toBe(40);
    expect(summary.cachedInputTokens).toBe(50);
  });

  it('R-44: sessionRef is the session of the last session_started event', () => {
    const events: readonly AgentEvent[] = [
      { type: 'session_started', at: at(0), sessionRef: 'sess-1' },
      { type: 'text', at: at(1), delta: 'hello' },
      { type: 'session_started', at: at(2), sessionRef: 'sess-2' },
    ];
    expect(foldRun(events).sessionRef).toBe('sess-2');
  });

  it('R-44: outcome maps from the last finished event — completed becomes succeeded (acceptance)', () => {
    const events: readonly AgentEvent[] = [
      { type: 'finished', at: at(0), reason: 'completed' },
    ];
    expect(foldRun(events).outcome).toBe('succeeded');
  });

  it('R-44: finished reasons pass through as outcomes — failed, cancelled, limit', () => {
    type FinishedReason = Extract<AgentEvent, { type: 'finished' }>['reason'];
    const reasons: readonly (readonly [FinishedReason, string])[] = [
      ['failed', 'failed'],
      ['cancelled', 'cancelled'],
      ['limit', 'limit'],
    ];
    for (const [reason, outcome] of reasons) {
      const events: readonly AgentEvent[] = [{ type: 'finished', at: at(0), reason }];
      expect(foldRun(events).outcome).toBe(outcome);
    }
  });

  it('R-44: the last finished event decides the outcome', () => {
    const events: readonly AgentEvent[] = [
      { type: 'finished', at: at(0), reason: 'failed' },
      { type: 'finished', at: at(1), reason: 'cancelled' },
    ];
    expect(foldRun(events).outcome).toBe('cancelled');
  });

  it('returns zeroed counts and no optionals for an empty stream', () => {
    expect(foldRun([])).toEqual({
      sessionRef: undefined,
      inputTokens: 0,
      outputTokens: 0,
      cachedInputTokens: 0,
      costUsd: undefined,
      costKind: undefined,
      toolCalls: 0,
      failedToolCalls: 0,
      openPermissionAsks: [],
      lastLimit: undefined,
      outcome: undefined,
    });
  });

  it('counts cachedInputTokens as 0 when usage events omit them', () => {
    const events: readonly AgentEvent[] = [
      usage({ at: at(0), inputTokens: 10, outputTokens: 5 }),
      usage({ at: at(1), inputTokens: 20, outputTokens: 8 }),
    ];
    expect(foldRun(events).cachedInputTokens).toBe(0);
  });

  it('costUsd stays undefined when no usage event carried a cost', () => {
    const events: readonly AgentEvent[] = [
      usage({ at: at(0), inputTokens: 10, outputTokens: 5, cachedInputTokens: 2 }),
    ];
    const summary = foldRun(events);
    expect(summary.costUsd).toBeUndefined();
    expect(summary.costKind).toBeUndefined();
  });

  it('costUsd sums the events that carried a cost', () => {
    const events: readonly AgentEvent[] = [
      usage({ at: at(0), inputTokens: 10, outputTokens: 5, costUsd: 0.1, costKind: 'reported' }),
      usage({ at: at(1), inputTokens: 10, outputTokens: 5 }),
      usage({ at: at(2), inputTokens: 10, outputTokens: 5, costUsd: 0.2, costKind: 'computed' }),
    ];
    const summary = foldRun(events);
    expect(summary.costUsd).toBeCloseTo(0.3);
  });

  it('costKind is the kind of the first costed event', () => {
    const events: readonly AgentEvent[] = [
      usage({ at: at(0), inputTokens: 1, outputTokens: 1, costUsd: 0.1, costKind: 'reported' }),
      usage({ at: at(1), inputTokens: 1, outputTokens: 1, costUsd: 0.2, costKind: 'computed' }),
    ];
    expect(foldRun(events).costKind).toBe('reported');
  });

  it('a first costed event without a kind does not inherit a kind from later events', () => {
    const events: readonly AgentEvent[] = [
      usage({ at: at(0), inputTokens: 1, outputTokens: 1, costUsd: 0.1 }),
      usage({ at: at(1), inputTokens: 1, outputTokens: 1, costUsd: 0.2, costKind: 'equivalent' }),
    ];
    const summary = foldRun(events);
    expect(summary.costUsd).toBeCloseTo(0.3);
    expect(summary.costKind).toBeUndefined();
  });

  it('counts tool calls and counts only failed results as failedToolCalls', () => {
    const events: readonly AgentEvent[] = [
      { type: 'tool_call', at: at(0), id: 't1', name: 'shell' },
      { type: 'tool_result', at: at(1), id: 't1', ok: true },
      { type: 'tool_call', at: at(2), id: 't2', name: 'shell' },
      { type: 'tool_result', at: at(3), id: 't2', ok: false },
      { type: 'tool_call', at: at(4), id: 't3', name: 'read' },
    ];
    const summary = foldRun(events);
    expect(summary.toolCalls).toBe(3);
    expect(summary.failedToolCalls).toBe(1);
  });

  it('lists asks without a later matching tool_result (acceptance)', () => {
    const events: readonly AgentEvent[] = [
      { type: 'permission_ask', at: at(0), id: 'p1', tool: 'shell', options: ['allow', 'deny'] },
      { type: 'permission_ask', at: at(1), id: 'p2', tool: 'write', options: ['allow'] },
      { type: 'tool_result', at: at(2), id: 'p1', ok: true },
    ];
    expect(foldRun(events).openPermissionAsks).toEqual(['p2']);
  });

  it('a tool_result before the ask does not close the ask', () => {
    const events: readonly AgentEvent[] = [
      { type: 'tool_result', at: at(0), id: 'p1', ok: true },
      { type: 'permission_ask', at: at(1), id: 'p1', tool: 'shell', options: ['allow'] },
    ];
    expect(foldRun(events).openPermissionAsks).toEqual(['p1']);
  });

  it('a failed result still closes its ask', () => {
    const events: readonly AgentEvent[] = [
      { type: 'permission_ask', at: at(0), id: 'p1', tool: 'shell', options: ['allow', 'deny'] },
      { type: 'tool_result', at: at(1), id: 'p1', ok: false },
    ];
    expect(foldRun(events).openPermissionAsks).toEqual([]);
  });

  it('lists multiple open asks in ask order', () => {
    const events: readonly AgentEvent[] = [
      { type: 'permission_ask', at: at(0), id: 'p3', tool: 'shell', options: ['allow'] },
      { type: 'permission_ask', at: at(1), id: 'p1', tool: 'write', options: ['allow'] },
      { type: 'permission_ask', at: at(2), id: 'p2', tool: 'shell', options: ['deny'] },
    ];
    expect(foldRun(events).openPermissionAsks).toEqual(['p3', 'p1', 'p2']);
  });

  it('a result closes the id and a later ask reopens it', () => {
    const events: readonly AgentEvent[] = [
      { type: 'permission_ask', at: at(0), id: 'p1', tool: 'shell', options: ['allow'] },
      { type: 'tool_result', at: at(1), id: 'p1', ok: true },
      { type: 'permission_ask', at: at(2), id: 'p1', tool: 'shell', options: ['allow'] },
    ];
    expect(foldRun(events).openPermissionAsks).toEqual(['p1']);
  });

  it('asks repeated with the same id are listed once', () => {
    const events: readonly AgentEvent[] = [
      { type: 'permission_ask', at: at(0), id: 'p1', tool: 'shell', options: ['allow'] },
      { type: 'permission_ask', at: at(1), id: 'p1', tool: 'shell', options: ['allow'] },
    ];
    expect(foldRun(events).openPermissionAsks).toEqual(['p1']);
  });

  it('lastLimit is the whole last limit_hit event', () => {
    const hit = { class: 'window_exhausted', resetsAt: at(10), remedies: ['wait'] } as const;
    const first: AgentEvent = { type: 'limit_hit', at: at(1), hit };
    const last: AgentEvent = { type: 'limit_hit', at: at(2), hit: { class: 'throughput', remedies: ['wait'] } };
    const events: readonly AgentEvent[] = [first, last];
    expect(foldRun(events).lastLimit).toEqual(last);
  });

  it('lastLimit is undefined when no limit was hit', () => {
    const events: readonly AgentEvent[] = [{ type: 'text', at: at(0), delta: 'hello' }];
    expect(foldRun(events).lastLimit).toBeUndefined();
  });

  it('sessionRef and outcome stay undefined without their events', () => {
    const events: readonly AgentEvent[] = [usage({ at: at(0), inputTokens: 1, outputTokens: 1 })];
    const summary = foldRun(events);
    expect(summary.sessionRef).toBeUndefined();
    expect(summary.outcome).toBeUndefined();
  });

  it('does not mutate its input', () => {
    const events: readonly AgentEvent[] = [
      { type: 'session_started', at: at(0), sessionRef: 'sess-1' },
      { type: 'permission_ask', at: at(1), id: 'p1', tool: 'shell', options: ['allow'] },
      usage({ at: at(2), inputTokens: 5, outputTokens: 5, costUsd: 0.5, costKind: 'reported' }),
      { type: 'limit_hit', at: at(3), hit: { class: 'throughput', remedies: ['wait'] } },
      { type: 'finished', at: at(4), reason: 'limit' },
    ];
    const snapshot = structuredClone(events);
    foldRun(events);
    expect(events).toEqual(snapshot);
  });

  it('works on a deeply frozen stream', () => {
    const events: readonly AgentEvent[] = Object.freeze([
      Object.freeze({ type: 'session_started', at: at(0), sessionRef: 'sess-1' }),
      Object.freeze(usage({ at: at(1), inputTokens: 7, outputTokens: 3 })),
      Object.freeze({ type: 'finished', at: at(2), reason: 'completed' }),
    ]);
    const summary = foldRun(events);
    expect(summary.sessionRef).toBe('sess-1');
    expect(summary.inputTokens).toBe(7);
    expect(summary.outcome).toBe('succeeded');
  });

  it('RunSummary keeps its contract field types', () => {
    expectTypeOf<Parameters<typeof foldRun>[0]>().toEqualTypeOf<readonly AgentEvent[]>();
    expectTypeOf<ReturnType<typeof foldRun>['cachedInputTokens']>().toEqualTypeOf<number>();
    expectTypeOf<ReturnType<typeof foldRun>['openPermissionAsks']>().toEqualTypeOf<readonly string[]>();
    expectTypeOf<ReturnType<typeof foldRun>['sessionRef']>().toEqualTypeOf<string | undefined>();
    expectTypeOf<ReturnType<typeof foldRun>['outcome']>().toEqualTypeOf<
      'succeeded' | 'failed' | 'limit' | 'cancelled' | undefined
    >();
  });
});
