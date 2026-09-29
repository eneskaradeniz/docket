// cockpit.test.ts — U-2 + U-21: the cockpit store mirrors the api's attention order, ages items
// from `since` through the injected clock, re-queries on both change events, and never blanks
// the view — a failed query keeps the previous view and exposes retry. U-21 adds the sections'
// derivations: the permission asks a waiting row carries (folded from the asking run's stream),
// the inline answer intent, the project cards' default-view rule and the closed list's ages.
// Api and change signal are injected fakes; the real events wiring lands with U-12.
import { describe, expect, it } from 'vitest';

import type { Api } from '../../api/api';
import type { AttentionItem, CockpitView, Query } from '../../api/queries';
import type { Command, CommandResult } from '../../api/commands';
import type { Actor, AgentEvent } from '../../domain/index';
import {
  createCockpitStore,
  earliestOpenAsk,
  projectCardTarget,
  type CockpitAsk,
  type CockpitChange,
  type CockpitChangeSignal,
} from './cockpit';

const userActor: Actor = { kind: 'user', id: 'user-1' };

const attentionItem = (id: string, kind: AttentionItem['kind'], since: number): AttentionItem => ({
  workOrderId: id,
  number: 1,
  project: 'atolye',
  repo: 'atolye',
  title: `title-${id}`,
  kind,
  stage: null,
  since,
});

const cockpitView = (attention: readonly AttentionItem[]): CockpitView => ({ attention, running: [], projects: [], recentlyClosed: [] });

interface FakeCockpitApi extends Pick<Api, 'query' | 'command'> {
  readonly queries: Query[];
  setReply(reply: unknown): void;
}

/** Every query call is recorded; the reply is the scripted one until setReply swaps it. The
 *  command surface exists to satisfy the store's deps (U-21) — these tests issue none. */
const fakeCockpitApi = (initial: unknown): FakeCockpitApi => {
  const queries: Query[] = [];
  let reply: unknown = initial;
  return {
    queries,
    setReply: (next) => {
      reply = next;
    },
    query: (query) => {
      queries.push(query);
      return Promise.resolve(reply);
    },
    command: () => Promise.resolve({ ok: true }),
  };
};

interface FakeSignal {
  readonly signal: CockpitChangeSignal;
  emit(change: CockpitChange): void;
}

/** The change signal fake: records the subscription and lets tests emit events by hand. */
const fakeSignal = (): FakeSignal => {
  const listeners: ((change: CockpitChange) => void)[] = [];
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

/** Lets the store's fire-and-forget reload finish before assertions read the state. */
const flush = (): Promise<void> => new Promise((resolve) => { setTimeout(resolve, 0); });

/** A view whose closed list carries one entry, built in one literal — the view is readonly. */
const viewWithClosed = (): CockpitView => ({
  attention: [],
  running: [],
  projects: [],
  recentlyClosed: [
    { workOrderId: 'wo-6', number: 6, title: 'Müşteri etiketi', project: 'atolye', repo: 'atolye', closedAt: 2_000 },
  ],
});

describe('cockpit store', () => {
  it('U-2: attention items keep the api\'s order and the view mirrors the cockpit query', async () => {
    // Deliberately neither kind-ranked nor oldest-first: the api owns the order (A-22); the store only mirrors it.
    const ordered: readonly AttentionItem[] = [
      attentionItem('wo-3', 'limit_waiting', 900),
      attentionItem('wo-1', 'permission_ask', 700),
      attentionItem('wo-2', 'blocked', 800),
    ];
    const view = cockpitView(ordered);
    const api = fakeCockpitApi(view);
    const store = createCockpitStore({ api, changes: fakeSignal().signal, now: () => 1_000, actor: userActor });

    expect(store.state()).toEqual({ loading: false, view: null, failed: false, asks: {} });
    const loading = store.load();
    expect(store.state().loading).toBe(true);
    await loading;

    expect(api.queries.filter((query) => query.type === 'cockpit')).toEqual([{ type: 'cockpit' }]);
    const state = store.state();
    expect(state.loading).toBe(false);
    expect(state.failed).toBe(false);
    expect(state.view).toEqual(view);
    expect(state.view?.attention.map((item) => item.workOrderId)).toEqual(['wo-3', 'wo-1', 'wo-2']);
  });

  it('U-2: an item\'s age comes from `since` through the injected clock', async () => {
    let current = 5_000;
    const item = attentionItem('wo-1', 'awaiting_human', 2_000);
    const api = fakeCockpitApi(cockpitView([item]));
    const store = createCockpitStore({ api, changes: fakeSignal().signal, now: () => current, actor: userActor });
    await store.load();

    expect(store.ageMs(item)).toBe(3_000);
    current = 4_500;
    expect(store.ageMs(item)).toBe(2_500);
    // A `since` ahead of the clock never renders a negative age.
    current = 1_000;
    expect(store.ageMs(item)).toBe(0);
  });

  it('U-2: the store re-queries on workOrders.changed and on run.updated', async () => {
    const first = cockpitView([attentionItem('wo-1', 'permission_ask', 100)]);
    const second = cockpitView([attentionItem('wo-2', 'blocked', 200)]);
    const api = fakeCockpitApi(first);
    const emitter = fakeSignal();
    const store = createCockpitStore({ api, changes: emitter.signal, now: () => 0, actor: userActor });
    await store.load();
    expect(api.queries.filter((query) => query.type === 'cockpit').length).toBe(1);
    expect(store.state().view).toEqual(first);
    api.setReply(second);

    emitter.emit({ type: 'workOrders.changed' });
    await flush();
    expect(api.queries.filter((query) => query.type === 'cockpit').length).toBe(2);
    expect(store.state().view).toEqual(second);

    emitter.emit({ type: 'run.updated', runId: 'run-1' });
    await flush();
    expect(api.queries.filter((query) => query.type === 'cockpit').length).toBe(3);
    expect(store.state().view).toEqual(second);
  });

  it('U-2: a failed query keeps the previous view and exposes retry', async () => {
    const good = cockpitView([attentionItem('wo-1', 'awaiting_human', 100)]);
    const api = fakeCockpitApi(good);
    const store = createCockpitStore({ api, changes: fakeSignal().signal, now: () => 0, actor: userActor });
    await store.load();
    expect(store.state().failed).toBe(false);

    api.setReply({ ok: false, code: 'definitions_invalid' });
    await store.load();
    const failed = store.state();
    expect(failed.failed).toBe(true);
    expect(failed.loading).toBe(false);
    expect(failed.view).toEqual(good);

    const recovered = cockpitView([attentionItem('wo-9', 'blocked', 300)]);
    api.setReply(recovered);
    await store.retry();
    expect(api.queries.filter((query) => query.type === 'cockpit').length).toBe(3);
    expect(store.state()).toEqual({ loading: false, view: recovered, failed: false, asks: {} });
  });

  it('U-2: a first failed query leaves no view but still exposes retry', async () => {
    const api = fakeCockpitApi({ ok: false, code: 'not_found' });
    const store = createCockpitStore({ api, changes: fakeSignal().signal, now: () => 0, actor: userActor });
    await store.load();

    const failed = store.state();
    expect(failed.view).toBeNull();
    expect(failed.failed).toBe(true);

    const good = cockpitView([]);
    api.setReply(good);
    await store.retry();
    expect(store.state()).toEqual({ loading: false, view: good, failed: false, asks: {} });
  });
});

// --- U-21: the four sections' derivations -----------------------------------------------------------

/** Answers each query type from its own script, so the enrichment reads ride the same fake. */
const fakeSectionApi = (cockpit: unknown, detail?: unknown, events?: readonly AgentEvent[]) => {
  const queries: Query[] = [];
  const commands: { readonly actor: Actor; readonly command: Command }[] = [];
  return {
    queries,
    commands,
    query: (query: Query): Promise<unknown> => {
      queries.push(query);
      if (query.type === 'workOrder.detail') return Promise.resolve(detail ?? { ok: false, code: 'not_found' });
      if (query.type === 'run.events') return Promise.resolve(events ?? []);
      return Promise.resolve(cockpit);
    },
    command: (actor: Actor, command: Command): Promise<CommandResult> => {
      commands.push({ actor, command });
      return Promise.resolve({ ok: true });
    },
  };
};

describe('cockpit store — sections (U-21)', () => {
  it('U-21: a permission ask row carries its asking run and the earliest open ask of its stream', async () => {
    const ask: CockpitAsk = { runId: 'run-9', askId: 'ask-1', tool: 'Bash', target: 'dotnet ef database update' };
    const waiting = attentionItem('wo-1', 'permission_ask', 500);
    const detail = {
      record: { id: 'wo-1', repo: 'atolye', flow: 'bakim', title: 'title-wo-1' },
      state: { status: 'running', stage: 'gelistir', pendingGates: [] },
      next: { kind: 'none' },
      runs: [{ id: 'run-9', stage: 'gelistir', startedAt: 100 }],
    };
    const events: readonly AgentEvent[] = [
      { type: 'tool_call', at: 50, id: 'ask-1', name: 'Bash', target: 'dotnet ef database update' },
      { type: 'permission_ask', at: 60, id: 'ask-1', tool: 'Bash', target: 'dotnet ef database update', options: ['allow', 'deny'] },
      { type: 'tool_result', at: 70, id: 'baska', ok: true },
    ];
    const api = fakeSectionApi(cockpitView([waiting]), detail, events);
    const store = createCockpitStore({ api, changes: fakeSignal().signal, actor: userActor, now: () => 0 });
    await store.load();
    await flush();

    expect(store.state().asks).toEqual({ 'wo-1': ask });
    expect(api.queries).toEqual([
      { type: 'cockpit' },
      { type: 'workOrder.detail', id: 'wo-1' },
      { type: 'run.events', runId: 'run-9' },
    ]);
  });

  it('U-21: an answered ask leaves the map on the next load — the fold closes it', async () => {
    const waiting = attentionItem('wo-1', 'permission_ask', 500);
    const detail = {
      record: { id: 'wo-1', repo: 'atolye', flow: 'bakim', title: 'title-wo-1' },
      state: { status: 'running', stage: 'gelistir', pendingGates: [] },
      next: { kind: 'none' },
      runs: [{ id: 'run-9', stage: 'gelistir', startedAt: 100 }],
    };
    const withAsk: readonly AgentEvent[] = [
      { type: 'permission_ask', at: 60, id: 'ask-1', tool: 'Bash', target: 'rm -rf', options: ['allow', 'deny'] },
    ];
    const answered: readonly AgentEvent[] = [
      { type: 'permission_ask', at: 60, id: 'ask-1', tool: 'Bash', target: 'rm -rf', options: ['allow', 'deny'] },
      { type: 'tool_result', at: 80, id: 'ask-1', ok: true },
    ];
    const api = fakeSectionApi(cockpitView([waiting]), detail, withAsk);
    const store = createCockpitStore({ api, changes: fakeSignal().signal, actor: userActor, now: () => 0 });
    await store.load();
    await flush();
    expect(store.state().asks).not.toEqual({});

    api.query = (query: Query): Promise<unknown> => {
      if (query.type === 'workOrder.detail') return Promise.resolve(detail);
      if (query.type === 'run.events') return Promise.resolve(answered);
      return Promise.resolve(cockpitView([waiting]));
    };
    await store.load();
    await flush();
    expect(store.state().asks).toEqual({});
  });

  it('U-21: the answer intent issues permission.answer and re-queries the cockpit', async () => {
    const api = fakeSectionApi(cockpitView([]));
    const store = createCockpitStore({ api, changes: fakeSignal().signal, actor: userActor, now: () => 0 });
    await store.load();

    const result = await store.answerPermission({ runId: 'run-9', askId: 'ask-1', decision: 'allow' });
    expect(result).toEqual({ ok: true });
    expect(api.commands).toEqual([
      { actor: userActor, command: { type: 'permission.answer', runId: 'run-9', askId: 'ask-1', decision: 'allow' } },
    ]);
    expect(api.queries.filter((query) => query.type === 'cockpit').length).toBe(2);
  });

  it('U-21: a multi-repo project card opens the roadmap, a single-repo card the main repo board', () => {
    expect(projectCardTarget({ project: 'antero', name: 'Antero', mainRepo: 'antreo-api', repoCount: 7, active: 3, waiting: 2 })).toEqual({
      kind: 'roadmap',
      project: 'antero',
    });
    expect(projectCardTarget({ project: 'kadife', name: 'Kadife Odoo', mainRepo: 'kadife-odoo', repoCount: 1, active: 1, waiting: 0 })).toEqual({
      kind: 'board',
      repo: 'kadife-odoo',
    });
  });

  it('U-21: a closed row\'s age reads from closedAt through the injected clock', async () => {
    const view = viewWithClosed();
    let now = 10_000;
    const api = fakeSectionApi(view);
    const store = createCockpitStore({ api, changes: fakeSignal().signal, actor: userActor, now: () => now });
    await store.load();

    expect(store.sinceMs(2_000)).toBe(8_000);
    now = 1_000;
    expect(store.sinceMs(2_000)).toBe(0);
  });
});

describe('earliestOpenAsk (U-21)', () => {
  it('U-21: the earliest ask still open survives, answered and later asks never show', () => {
    const events: readonly AgentEvent[] = [
      { type: 'permission_ask', at: 10, id: 'ask-1', tool: 'Bash', target: 'bir', options: ['allow', 'deny'] },
      { type: 'permission_ask', at: 20, id: 'ask-2', tool: 'Bash', target: 'iki', options: ['allow', 'deny'] },
      { type: 'tool_result', at: 30, id: 'ask-1', ok: true },
    ];
    expect(earliestOpenAsk(events)).toEqual({ askId: 'ask-2', tool: 'Bash', target: 'iki' });
    expect(earliestOpenAsk([])).toBeNull();
    // The same openness notion as the run fold: a tool_result of the ask's id closes it.
    expect(
      earliestOpenAsk([
        { type: 'permission_ask', at: 10, id: 'ask-1', tool: 'Bash', target: 'bir', options: ['allow', 'deny'] },
        { type: 'tool_result', at: 30, id: 'ask-1', ok: true },
      ]),
    ).toBeNull();
  });
});
