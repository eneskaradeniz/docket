// live-pane.test.ts — U-5: the live pane store folds a run's AgentEvent stream into display
// items in arrival order (thought, message, tool call with status, usage, quota signal), keeps
// the earliest still-open permission ask with an answer intent, and marks the stream ended on
// `finished` — events after it are ignored. The stream is faked: tests push synthetic events;
// no transport, no DOM.
import { describe, expect, it } from 'vitest';

import type { Api } from '../../api/api';
import type { Command, CommandResult } from '../../api/commands';
import type { Actor, AgentEvent, CostKind } from '../../domain/index';
import { createLivePaneStore, type LivePaneStore, type QuotaSignalMeter } from './live-pane';

const RUN = 'run-1';
const ACTOR: Actor = { kind: 'user', id: 'user-1' };

let tick = 0;
const at = (): number => {
  tick += 1;
  return tick;
};

const thinking = (delta: string): AgentEvent => ({ type: 'thinking', at: at(), delta });
const text = (delta: string): AgentEvent => ({ type: 'text', at: at(), delta });
const toolCall = (id: string, name: string, target?: string): AgentEvent => ({
  type: 'tool_call',
  at: at(),
  id,
  name,
  target,
});
const toolResult = (id: string, ok: boolean): AgentEvent => ({ type: 'tool_result', at: at(), id, ok });
const permissionAsk = (id: string, tool: string, options: readonly string[], target?: string): AgentEvent => ({
  type: 'permission_ask',
  at: at(),
  id,
  tool,
  options,
  target,
});
const usageEvent = (fields: {
  readonly inputTokens: number;
  readonly outputTokens: number;
  readonly cachedInputTokens?: number;
  readonly costUsd?: number;
  readonly costKind?: CostKind;
}): AgentEvent => ({ type: 'usage', at: at(), ...fields });
const quotaSignal = (meter: QuotaSignalMeter): AgentEvent => ({ type: 'quota_signal', at: at(), meter });
const finished = (reason: 'completed' | 'failed' | 'cancelled' | 'limit'): AgentEvent => ({
  type: 'finished',
  at: at(),
  reason,
});
const limitHit = (): AgentEvent => ({
  type: 'limit_hit',
  at: at(),
  hit: { class: 'window_exhausted', remedies: ['wait'] },
});

const meterShape = (overrides: Partial<QuotaSignalMeter> = {}): QuotaSignalMeter => ({
  label: '5 saatlik pencere',
  cadence: 'rolling_continuous',
  unit: 'percent',
  used: 40,
  limit: 100,
  remaining: 60,
  resetsAt: 5_000,
  resetPrecision: 'relative',
  observedAt: 1_000,
  source: 'pushed',
  poolLabel: 'Havuz A',
  ...overrides,
});

interface FakeCommandApi extends Pick<Api, 'command'> {
  readonly issued: Command[];
  readonly actors: Actor[];
}

/** Every issued command and its actor are recorded; replies come back in issue order. */
const fakeApi = (replies: readonly CommandResult[] = []): FakeCommandApi => {
  const issued: Command[] = [];
  const actors: Actor[] = [];
  return {
    issued,
    actors,
    command: async (actor, command) => {
      actors.push(actor);
      issued.push(command);
      const reply = replies[issued.length - 1];
      return reply ?? { ok: true };
    },
  };
};

const store = (api: FakeCommandApi): LivePaneStore => createLivePaneStore({ runId: RUN, api, actor: ACTOR });

/** Deep-freezes an event so any input mutation throws in the strict-mode test runtime. */
const freezeEvent = (event: AgentEvent): AgentEvent => {
  const walk = (node: unknown): void => {
    if (Array.isArray(node)) {
      for (const item of node) walk(item);
      Object.freeze(node);
      return;
    }
    if (typeof node === 'object' && node !== null) {
      for (const value of Object.values(node)) walk(value);
      Object.freeze(node);
    }
  };
  walk(event);
  return event;
};

describe('live pane store', () => {
  it('U-5: display items fold in arrival order — thought, message, tool call, usage, quota signal', () => {
    const api = fakeApi();
    const pane = store(api);
    expect(pane.state()).toEqual({ items: [], ask: null, ended: false });

    const shape = meterShape();
    pane.push(thinking('planı kuruyorum'));
    pane.push(text('Merhaba, '));
    pane.push(toolCall('t1', 'read_file', 'src/a.ts'));
    pane.push(usageEvent({ inputTokens: 100, outputTokens: 20 }));
    pane.push(quotaSignal(shape));

    const state = pane.state();
    expect(state.ended).toBe(false);
    expect(state.ask).toBeNull();
    expect(state.items.map((item) => item.kind)).toEqual(['thought', 'message', 'toolCall', 'usage', 'quotaSignal']);
    expect(state.items[2]).toEqual({
      kind: 'toolCall',
      id: 't1',
      name: 'read_file',
      target: 'src/a.ts',
      status: 'running',
    });
    expect(state.items[3]).toEqual({
      kind: 'usage',
      inputTokens: 100,
      outputTokens: 20,
      cachedInputTokens: 0,
      costUsd: null,
      costKind: null,
    });
    expect(state.items[4]).toEqual({ kind: 'quotaSignal', meter: shape });
  });

  it('U-5: consecutive thinking and text deltas merge into the trailing item of their kind', () => {
    const pane = store(fakeApi());
    pane.push(thinking('Bir '));
    pane.push(thinking('düşünce.'));
    pane.push(text('Mer'));
    pane.push(text('haba'));
    pane.push(toolCall('t1', 'shell', 'ls'));
    pane.push(text(' — araçtan sonra'));

    expect(pane.state().items).toEqual([
      { kind: 'thought', text: 'Bir düşünce.' },
      { kind: 'message', text: 'Merhaba' },
      { kind: 'toolCall', id: 't1', name: 'shell', target: 'ls', status: 'running' },
      { kind: 'message', text: ' — araçtan sonra' },
    ]);
  });

  it('U-5: a tool_result flips its call\'s status in place — ok, failed, and target-less calls', () => {
    const pane = store(fakeApi());
    pane.push(toolCall('t1', 'read_file', 'a.ts'));
    pane.push(toolCall('t2', 'shell', 'npm test'));
    pane.push(toolCall('t3', 'list_dir'));
    pane.push(toolResult('t2', false));
    pane.push(toolResult('t1', true));

    const items = pane.state().items;
    expect(items[0]).toEqual({ kind: 'toolCall', id: 't1', name: 'read_file', target: 'a.ts', status: 'ok' });
    expect(items[1]).toEqual({ kind: 'toolCall', id: 't2', name: 'shell', target: 'npm test', status: 'failed' });
    expect(items[2]).toEqual({ kind: 'toolCall', id: 't3', name: 'list_dir', target: null, status: 'running' });
  });

  it('U-5: usage and quota signal items snapshot their event — absent fields normalize', () => {
    const pane = store(fakeApi());
    pane.push(usageEvent({ inputTokens: 10, outputTokens: 5 }));
    pane.push(usageEvent({ inputTokens: 30, outputTokens: 12, cachedInputTokens: 8, costUsd: 0.5, costKind: 'computed' }));
    const shape = meterShape({ unit: 'tokens', used: 900, limit: 2000, remaining: 1100, source: 'polled' });
    pane.push(quotaSignal(shape));

    const items = pane.state().items;
    expect(items[0]).toEqual({
      kind: 'usage',
      inputTokens: 10,
      outputTokens: 5,
      cachedInputTokens: 0,
      costUsd: null,
      costKind: null,
    });
    expect(items[1]).toEqual({
      kind: 'usage',
      inputTokens: 30,
      outputTokens: 12,
      cachedInputTokens: 8,
      costUsd: 0.5,
      costKind: 'computed',
    });
    expect(items[2]).toEqual({ kind: 'quotaSignal', meter: shape });
  });

  it('U-5: the earliest still-open ask carries the answer intent — allow and deny', async () => {
    const api = fakeApi([{ ok: true }, { ok: false, code: 'stale' }]);
    const pane = store(api);
    pane.push(permissionAsk('a1', 'shell', ['allow', 'deny'], 'rm -rf build'));
    pane.push(permissionAsk('a2', 'write_file', ['allow', 'deny']));

    expect(pane.state().ask).toEqual({
      askId: 'a1',
      tool: 'shell',
      target: 'rm -rf build',
      options: ['allow', 'deny'],
    });

    const first = await pane.answer('allow');
    expect(first).toEqual({ ok: true });
    expect(api.actors).toEqual([ACTOR]);
    expect(api.issued).toEqual([{ type: 'permission.answer', runId: RUN, askId: 'a1', decision: 'allow' }]);

    pane.push(toolResult('a1', true));
    expect(pane.state().ask).toEqual({
      askId: 'a2',
      tool: 'write_file',
      target: null,
      options: ['allow', 'deny'],
    });

    const second = await pane.answer('deny');
    expect(second).toEqual({ ok: false, code: 'stale' });
    expect(api.issued[1]).toEqual({ type: 'permission.answer', runId: RUN, askId: 'a2', decision: 'deny' });
  });

  it('U-5: an ask stays open until a tool_result of its id — a repeated ask id does not double-open', () => {
    const pane = store(fakeApi());
    pane.push(permissionAsk('a1', 'shell', ['allow', 'deny']));
    pane.push(permissionAsk('a1', 'shell', ['allow', 'deny']));
    expect(pane.state().ask?.askId).toBe('a1');

    pane.push(toolResult('a1', true));
    expect(pane.state().ask).toBeNull();
  });

  it('U-5: answering with no open ask issues nothing and reports not_found', async () => {
    const api = fakeApi();
    const pane = store(api);

    const result = await pane.answer('allow');
    expect(result).toEqual({ ok: false, code: 'not_found' });
    expect(api.issued).toEqual([]);
  });

  it('U-5: session_started, error, limit_hit and raw events create no display item', () => {
    const pane = store(fakeApi());
    pane.push({ type: 'session_started', at: at(), sessionRef: 's-1' });
    pane.push({ type: 'error', at: at(), class: 'network', message: 'bağlantı koptu' });
    pane.push(limitHit());
    pane.push({ type: 'raw', at: at(), line: '{"x":1}' });

    const state = pane.state();
    expect(state.items).toEqual([]);
    expect(state.ended).toBe(false);
  });

  it('U-5: finished marks the stream ended and drops the open ask', async () => {
    const api = fakeApi();
    const pane = store(api);
    pane.push(permissionAsk('a1', 'shell', ['allow', 'deny']));
    pane.push(finished('completed'));

    const state = pane.state();
    expect(state.ended).toBe(true);
    expect(state.ask).toBeNull();

    const result = await pane.answer('allow');
    expect(result.ok).toBe(false);
    expect(api.issued).toEqual([]);
  });

  it('U-5: events after finished are ignored', () => {
    const pane = store(fakeApi());
    pane.push(text('son mesaj'));
    pane.push(finished('completed'));
    const ended = pane.state();

    pane.push(text('geç kalan'));
    pane.push(toolCall('t9', 'shell', 'ls'));
    pane.push(toolResult('t9', true));
    pane.push(usageEvent({ inputTokens: 1, outputTokens: 1 }));
    pane.push(quotaSignal(meterShape()));
    pane.push(permissionAsk('a9', 'shell', ['allow', 'deny']));
    pane.push(finished('failed'));

    expect(pane.state()).toEqual(ended);
  });

  it('U-5: input events are handled immutably', () => {
    const pane = store(fakeApi());
    const stream = [
      thinking('a'),
      text('b'),
      toolCall('t1', 'shell', 'ls'),
      toolResult('t1', true),
      usageEvent({ inputTokens: 1, outputTokens: 2, cachedInputTokens: 3, costUsd: 0.1, costKind: 'reported' }),
      quotaSignal(meterShape()),
      permissionAsk('a1', 'shell', ['allow', 'deny']),
      finished('completed'),
    ].map(freezeEvent);

    for (const event of stream) pane.push(event);

    expect(pane.state().items.map((item) => item.kind)).toEqual([
      'thought',
      'message',
      'toolCall',
      'usage',
      'quotaSignal',
    ]);
    expect(pane.state().ended).toBe(true);
  });

  it('U-5: subscribers hear each fold until they unsubscribe', () => {
    const pane = store(fakeApi());
    let heard = 0;
    const unsubscribe = pane.subscribe(() => {
      heard += 1;
    });

    pane.push(thinking('x'));
    pane.push(text('y'));
    expect(heard).toBe(2);

    unsubscribe();
    pane.push(text('z'));
    expect(heard).toBe(2);
  });
});
