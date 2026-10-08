// live-pane.test.ts — U-5: the live pane store folds a run's AgentEvent stream into display
// items in arrival order (thought, message, tool call with status, usage, quota signal), keeps
// the earliest still-open permission ask with an answer intent, and marks the stream ended on
// `finished` — events after it are ignored. The stream has one feed: `attach` binds the pane to
// a run, reads its `run.events` tail (newest last) and re-reads it on every `run.updated` for
// that run; tests fake the query and the change signal, and push synthetic events on top.
import { describe, expect, it } from 'vitest';

import type { Api } from '../../api/api';
import type { Command, CommandResult } from '../../api/commands';
import type { Query } from '../../api/queries';
import type { Actor, AgentEvent, CostKind } from '../../domain/index';
import {
  createLivePaneStore,
  type LivePaneChange,
  type LivePaneChangeSignal,
  type LivePaneStore,
  type QuotaSignalMeter,
} from './live-pane';

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

interface FakePaneApi extends Pick<Api, 'command' | 'query'> {
  readonly issued: Command[];
  readonly actors: Actor[];
  readonly queries: Query[];
  setEvents(events: readonly AgentEvent[]): void;
  failQueries(code: string): void;
}

/** Every issued command, actor and query call is recorded; the tail read answers the scripted
 *  events until failQueries swaps in a failure reply. */
const fakeApi = (replies: readonly CommandResult[] = []): FakePaneApi => {
  const issued: Command[] = [];
  const actors: Actor[] = [];
  const queries: Query[] = [];
  let events: readonly AgentEvent[] = [];
  let failure: string | null = null;
  return {
    issued,
    actors,
    queries,
    setEvents: (next) => {
      events = next;
      failure = null;
    },
    failQueries: (code) => {
      failure = code;
    },
    command: async (actor, command) => {
      actors.push(actor);
      issued.push(command);
      const reply = replies[issued.length - 1];
      return reply ?? { ok: true };
    },
    query: (query) => {
      queries.push(query);
      return Promise.resolve(failure !== null ? { ok: false, code: failure } : events);
    },
  };
};

interface FakeSignal {
  readonly signal: LivePaneChangeSignal;
  emit(change: LivePaneChange): void;
}

/** The change-signal fake: records the subscription and lets tests emit events by hand. */
const fakeSignal = (): FakeSignal => {
  const listeners: ((change: LivePaneChange) => void)[] = [];
  return {
    signal: (listener) => {
      listeners.push(listener);
      return () => {
        const at = listeners.indexOf(listener);
        if (at >= 0) listeners.splice(at, 1);
      };
    },
    emit: (change) => {
      for (const listener of [...listeners]) listener(change);
    },
  };
};

/** Lets the store's fire-and-forget tail re-read finish before assertions read the state. */
const flush = (): Promise<void> => new Promise((resolve) => { setTimeout(resolve, 0); });

/** A pane attached to RUN against an empty tail read; tests push further events on top. */
const store = async (api: FakePaneApi, signal = fakeSignal()): Promise<LivePaneStore> => {
  const pane = createLivePaneStore({ api, changes: signal.signal, actor: ACTOR });
  await pane.attach(RUN);
  return pane;
};

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
  it('U-5: display items fold in arrival order — thought, message, tool call, usage, quota signal', async () => {
    const api = fakeApi();
    const pane = await store(api);
    expect(pane.state()).toEqual({ runId: RUN, items: [], ask: null, ended: false });

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

  it('U-5: consecutive thinking and text deltas merge into the trailing item of their kind', async () => {
    const pane = await store(fakeApi());
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

  it('U-5: a tool_result flips its call\'s status in place — ok, failed, and target-less calls', async () => {
    const pane = await store(fakeApi());
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

  it('U-5: usage and quota signal items snapshot their event — absent fields normalize', async () => {
    const pane = await store(fakeApi());
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
    const pane = await store(api);
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

  it('U-5: an ask stays open until a tool_result of its id — a repeated ask id does not double-open', async () => {
    const pane = await store(fakeApi());
    pane.push(permissionAsk('a1', 'shell', ['allow', 'deny']));
    pane.push(permissionAsk('a1', 'shell', ['allow', 'deny']));
    expect(pane.state().ask?.askId).toBe('a1');

    pane.push(toolResult('a1', true));
    expect(pane.state().ask).toBeNull();
  });

  it('U-5: a permission_answered closes its ask — the pane shows the next open ask, then none (acceptance)', async () => {
    const pane = await store(fakeApi());
    pane.push(permissionAsk('a1', 'shell', ['allow', 'deny'], 'rm -rf build'));
    pane.push(permissionAsk('a2', 'write_file', ['allow', 'deny']));

    pane.push({ type: 'permission_answered', at: at(), id: 'a1', decision: 'allow' });
    expect(pane.state().ask).toEqual({
      askId: 'a2',
      tool: 'write_file',
      target: null,
      options: ['allow', 'deny'],
    });

    pane.push({ type: 'permission_answered', at: at(), id: 'a2', decision: 'deny' });
    expect(pane.state().ask).toBeNull();
  });

  it('U-5: a permission_answered whose id matches no open ask closes nothing', async () => {
    const pane = await store(fakeApi());
    pane.push(permissionAsk('a1', 'shell', ['allow', 'deny']));

    pane.push({ type: 'permission_answered', at: at(), id: 'baska', decision: 'allow' });
    expect(pane.state().ask?.askId).toBe('a1');
  });

  it('U-5: answering with no open ask issues nothing and reports not_found', async () => {
    const api = fakeApi();
    const pane = await store(api);

    const result = await pane.answer('allow');
    expect(result).toEqual({ ok: false, code: 'not_found' });
    expect(api.issued).toEqual([]);
  });

  it('U-5: answering before any run is attached issues nothing and reports not_found', async () => {
    const api = fakeApi();
    const pane = createLivePaneStore({ api, changes: fakeSignal().signal, actor: ACTOR });

    const result = await pane.answer('allow');
    expect(result).toEqual({ ok: false, code: 'not_found' });
    expect(api.issued).toEqual([]);
  });

  it('U-5: session_started, error, limit_hit and raw events create no display item', async () => {
    const pane = await store(fakeApi());
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
    const pane = await store(api);
    pane.push(permissionAsk('a1', 'shell', ['allow', 'deny']));
    pane.push(finished('completed'));

    const state = pane.state();
    expect(state.ended).toBe(true);
    expect(state.ask).toBeNull();

    const result = await pane.answer('allow');
    expect(result.ok).toBe(false);
    expect(api.issued).toEqual([]);
  });

  it('U-5: events after finished are ignored', async () => {
    const pane = await store(fakeApi());
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

  it('U-5: input events are handled immutably', async () => {
    const pane = await store(fakeApi());
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

  it('U-5: subscribers hear each fold until they unsubscribe', async () => {
    const pane = await store(fakeApi());
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

  it('U-5: attaching reads the run.events tail and folds it newest last', async () => {
    const api = fakeApi();
    api.setEvents([
      thinking('plan'),
      toolCall('t1', 'shell', 'ls'),
      toolResult('t1', true),
      finished('completed'),
    ]);
    const pane = createLivePaneStore({ api, changes: fakeSignal().signal, actor: ACTOR });
    expect(pane.state().runId).toBeNull();

    await pane.attach(RUN);

    expect(api.queries).toEqual([{ type: 'run.events', runId: RUN }]);
    const state = pane.state();
    expect(state.runId).toBe(RUN);
    expect(state.items.map((item) => item.kind)).toEqual(['thought', 'toolCall']);
    expect(state.items[1]).toEqual({ kind: 'toolCall', id: 't1', name: 'shell', target: 'ls', status: 'ok' });
    expect(state.ended).toBe(true);
  });

  it('U-5: a run.updated for the attached run re-reads the tail and refolds from scratch', async () => {
    const api = fakeApi();
    const emitter = fakeSignal();
    const pane = createLivePaneStore({ api, changes: emitter.signal, actor: ACTOR });
    await pane.attach(RUN);
    expect(pane.state().items).toEqual([]);

    api.setEvents([thinking('bir'), thinking('iki')]);
    emitter.emit({ type: 'run.updated', runId: RUN });
    await flush();
    expect(api.queries.length).toBe(2);
    expect(pane.state().items).toEqual([{ kind: 'thought', text: 'biriki' }]);

    // The same tail arriving again must not stack: the refold resets before folding.
    emitter.emit({ type: 'run.updated', runId: RUN });
    await flush();
    expect(api.queries.length).toBe(3);
    expect(pane.state().items).toEqual([{ kind: 'thought', text: 'biriki' }]);
  });

  it('U-5: a run.updated for another run and a workOrders.changed do not re-read the tail', async () => {
    const api = fakeApi();
    const emitter = fakeSignal();
    const pane = createLivePaneStore({ api, changes: emitter.signal, actor: ACTOR });
    await pane.attach(RUN);
    expect(api.queries.length).toBe(1);

    emitter.emit({ type: 'run.updated', runId: 'run-2' });
    emitter.emit({ type: 'workOrders.changed' });
    await flush();
    expect(api.queries.length).toBe(1);
  });

  it('U-5: a failed tail read keeps the fold already on screen', async () => {
    const api = fakeApi();
    const emitter = fakeSignal();
    api.setEvents([text('kayıt'), finished('completed')]);
    const pane = createLivePaneStore({ api, changes: emitter.signal, actor: ACTOR });
    await pane.attach(RUN);
    const before = pane.state();

    api.failQueries('not_found');
    emitter.emit({ type: 'run.updated', runId: RUN });
    await flush();

    expect(pane.state()).toEqual(before);
  });

  it('U-5: attaching another run resets the fold to the new run', async () => {
    const api = fakeApi();
    api.setEvents([text('eski koşu')]);
    const pane = createLivePaneStore({ api, changes: fakeSignal().signal, actor: ACTOR });
    await pane.attach(RUN);
    expect(pane.state().items).toEqual([{ kind: 'message', text: 'eski koşu' }]);

    // run-2's tail is empty: the reset fold shows nothing of the old run.
    api.setEvents([]);
    await pane.attach('run-2');
    expect(api.queries).toEqual([
      { type: 'run.events', runId: RUN },
      { type: 'run.events', runId: 'run-2' },
    ]);
    expect(pane.state()).toEqual({ runId: 'run-2', items: [], ask: null, ended: false });
  });

  it('U-5: attaching the already-attached run does not re-read the tail', async () => {
    const api = fakeApi();
    const pane = createLivePaneStore({ api, changes: fakeSignal().signal, actor: ACTOR });
    await pane.attach(RUN);
    await pane.attach(RUN);
    expect(api.queries.length).toBe(1);
  });

  it('U-5: state() returns a cached snapshot — a new reference only after a fold mutates', async () => {
    const pane = await store(fakeApi());
    const first = pane.state();
    expect(pane.state()).toBe(first);

    pane.push(thinking('yeni olay'));
    expect(pane.state()).not.toBe(first);
  });
});
