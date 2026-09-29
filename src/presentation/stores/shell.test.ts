// shell.test.ts — U-10: the shell's badge mirrors the cockpit query's attention items, ranks them
// by kind with permission asks first, updates on the same coarse events the cockpit listens to,
// and is absent — never a rendered zero — when nothing waits. Api, change signal and the
// repo list are injected fakes.
import { describe, expect, it } from 'vitest';

import type { Api } from '../../api/api';
import type { AttentionItem, CockpitView, Query } from '../../api/queries';
import { createShellStore, shellBadge, type ShellChange, type ShellChangeSignal } from './shell';

const attentionItem = (id: string, kind: AttentionItem['kind'], since: number): AttentionItem => ({
  workOrderId: id,
  repo: 'atolye',
  title: `title-${id}`,
  kind,
  stage: null,
  since,
});

const cockpitView = (attention: readonly AttentionItem[]): CockpitView => ({ attention, running: [] });

interface FakeShellApi extends Pick<Api, 'query'> {
  readonly queries: Query[];
  setReply(reply: unknown): void;
}

/** Every query call is recorded; the reply is the scripted one until setReply swaps it. */
const fakeShellApi = (initial: unknown): FakeShellApi => {
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
  readonly signal: ShellChangeSignal;
  emit(change: ShellChange): void;
}

/** The change signal fake: records the subscription and lets tests emit events by hand. */
const fakeSignal = (): FakeSignal => {
  const listeners: ((change: ShellChange) => void)[] = [];
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

describe('shell store', () => {
  it('U-10: the badge count equals the cockpit\'s attention items', async () => {
    const attention = [
      attentionItem('wo-1', 'permission_ask', 100),
      attentionItem('wo-2', 'blocked', 200),
      attentionItem('wo-3', 'awaiting_human', 300),
    ];
    const api = fakeShellApi(cockpitView(attention));
    const store = createShellStore({ api, changes: fakeSignal().signal, repos: async () => [] });
    await store.load();

    const badge = store.state().badge;
    expect(badge).not.toBeNull();
    expect(badge?.count).toBe(3);
    expect(badge?.items.length).toBe(3);
  });

  it('U-10: badge items rank by kind with permission asks first, oldest first within a kind', async () => {
    // Deliberately scrambled against both the kind rank and the age order.
    const attention = [
      attentionItem('wo-5', 'limit_waiting', 900),
      attentionItem('wo-2', 'awaiting_human', 800),
      attentionItem('wo-4', 'blocked', 700),
      attentionItem('wo-3', 'permission_ask', 600),
      attentionItem('wo-1', 'permission_ask', 500),
    ];
    // The pure helper carries the rule; the store applies it to the query's reply.
    expect(shellBadge(attention)?.items.map((item) => item.workOrderId)).toEqual([
      'wo-1',
      'wo-3',
      'wo-2',
      'wo-4',
      'wo-5',
    ]);

    const api = fakeShellApi(cockpitView(attention));
    const store = createShellStore({ api, changes: fakeSignal().signal, repos: async () => [] });
    await store.load();
    expect(store.state().badge?.items.map((item) => item.workOrderId)).toEqual([
      'wo-1',
      'wo-3',
      'wo-2',
      'wo-4',
      'wo-5',
    ]);
  });

  it('U-10: zero attention leaves the badge absent, never a rendered zero', async () => {
    const api = fakeShellApi(cockpitView([]));
    const emitter = fakeSignal();
    const store = createShellStore({ api, changes: emitter.signal, repos: async () => [] });

    await store.load();
    expect(store.state().badge).toBeNull();

    // Attention arriving and draining again must end absent, not at a zero count.
    api.setReply(cockpitView([attentionItem('wo-1', 'permission_ask', 100)]));
    emitter.emit({ type: 'workOrders.changed' });
    await flush();
    expect(store.state().badge?.count).toBe(1);

    api.setReply(cockpitView([]));
    emitter.emit({ type: 'run.updated', runId: 'run-1' });
    await flush();
    expect(store.state().badge).toBeNull();
  });

  it('U-10: the badge updates on the same events the cockpit listens to', async () => {
    const first = cockpitView([attentionItem('wo-1', 'permission_ask', 100)]);
    const second = cockpitView([
      attentionItem('wo-1', 'permission_ask', 100),
      attentionItem('wo-2', 'blocked', 200),
    ]);
    const api = fakeShellApi(first);
    const emitter = fakeSignal();
    const store = createShellStore({ api, changes: emitter.signal, repos: async () => [] });
    await store.load();
    expect(api.queries).toEqual([{ type: 'cockpit' }]);
    expect(store.state().badge?.count).toBe(1);

    api.setReply(second);
    emitter.emit({ type: 'workOrders.changed' });
    await flush();
    expect(api.queries.length).toBe(2);
    expect(store.state().badge?.count).toBe(2);

    const third = cockpitView([]);
    api.setReply(third);
    emitter.emit({ type: 'run.updated', runId: 'run-1' });
    await flush();
    expect(api.queries.length).toBe(3);
    expect(store.state().badge).toBeNull();
  });

  it('U-10: a failed cockpit query keeps the previous badge instead of blanking it', async () => {
    const good = cockpitView([attentionItem('wo-1', 'permission_ask', 100)]);
    const api = fakeShellApi(good);
    const store = createShellStore({ api, changes: fakeSignal().signal, repos: async () => [] });
    await store.load();
    expect(store.state().badge?.count).toBe(1);

    api.setReply({ ok: false, code: 'definitions_invalid' });
    await store.load();
    expect(store.state().badge?.count).toBe(1);
  });

  it('carries the injected repo entries for the switcher and reloads them with the events', async () => {
    const entries = [{ id: 'atolye', label: 'Atölye' }];
    let injected = entries;
    const api = fakeShellApi(cockpitView([]));
    const emitter = fakeSignal();
    const store = createShellStore({
      api,
      changes: emitter.signal,
      repos: async () => injected,
    });

    await store.load();
    expect(store.state().repos).toEqual(entries);

    injected = [{ id: 'atolye', label: 'Atölye' }, { id: 'siparis-api', label: 'Sipariş API' }];
    emitter.emit({ type: 'workOrders.changed' });
    await flush();
    expect(store.state().repos).toEqual(injected);
  });
});
