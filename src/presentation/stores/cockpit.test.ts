// cockpit.test.ts — U-2: the cockpit store mirrors the api's attention order, ages items from
// `since` through the injected clock, re-queries on both change events, and never blanks the
// view — a failed query keeps the previous view and exposes retry. Api and change signal are
// injected fakes; the real events wiring lands with U-12.
import { describe, expect, it } from 'vitest';

import type { Api } from '../../api/api';
import type { AttentionItem, CockpitView, Query } from '../../api/queries';
import { createCockpitStore, type CockpitChange, type CockpitChangeSignal } from './cockpit';

const attentionItem = (id: string, kind: AttentionItem['kind'], since: number): AttentionItem => ({
  workOrderId: id,
  workspace: 'atolye',
  title: `title-${id}`,
  kind,
  stage: null,
  since,
});

const cockpitView = (attention: readonly AttentionItem[]): CockpitView => ({ attention, running: [] });

interface FakeCockpitApi extends Pick<Api, 'query'> {
  readonly queries: Query[];
  setReply(reply: unknown): void;
}

/** Every query call is recorded; the reply is the scripted one until setReply swaps it. */
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
    const store = createCockpitStore({ api, changes: fakeSignal().signal, now: () => 1_000 });

    expect(store.state()).toEqual({ loading: false, view: null, failed: false });
    const loading = store.load();
    expect(store.state().loading).toBe(true);
    await loading;

    expect(api.queries).toEqual([{ type: 'cockpit' }]);
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
    const store = createCockpitStore({ api, changes: fakeSignal().signal, now: () => current });
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
    const store = createCockpitStore({ api, changes: emitter.signal, now: () => 0 });
    await store.load();
    expect(api.queries.length).toBe(1);
    expect(store.state().view).toEqual(first);
    api.setReply(second);

    emitter.emit({ type: 'workOrders.changed' });
    await flush();
    expect(api.queries.length).toBe(2);
    expect(store.state().view).toEqual(second);

    emitter.emit({ type: 'run.updated', runId: 'run-1' });
    await flush();
    expect(api.queries.length).toBe(3);
    expect(store.state().view).toEqual(second);
  });

  it('U-2: a failed query keeps the previous view and exposes retry', async () => {
    const good = cockpitView([attentionItem('wo-1', 'awaiting_human', 100)]);
    const api = fakeCockpitApi(good);
    const store = createCockpitStore({ api, changes: fakeSignal().signal, now: () => 0 });
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
    expect(api.queries.length).toBe(3);
    expect(store.state()).toEqual({ loading: false, view: recovered, failed: false });
  });

  it('U-2: a first failed query leaves no view but still exposes retry', async () => {
    const api = fakeCockpitApi({ ok: false, code: 'not_found' });
    const store = createCockpitStore({ api, changes: fakeSignal().signal, now: () => 0 });
    await store.load();

    const failed = store.state();
    expect(failed.view).toBeNull();
    expect(failed.failed).toBe(true);

    const good = cockpitView([]);
    api.setReply(good);
    await store.retry();
    expect(store.state()).toEqual({ loading: false, view: good, failed: false });
  });
});
