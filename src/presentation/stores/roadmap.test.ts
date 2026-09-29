// roadmap.test.ts — U-17: the roadmap store mirrors the `roadmap.byProject` view, opens the
// first phase on entry with the rest closed, keeps the collapse and task-expansion state for the
// session, re-queries its project on workOrders.changed, and shows the problem state on a failed
// query instead of an empty page. Api and change signal are injected fakes.
import { describe, expect, it } from 'vitest';

import type { Api } from '../../api/api';
import type { Query, RoadmapPageView } from '../../api/queries';
import { createRoadmapStore, type RoadmapChange, type RoadmapChangeSignal } from './roadmap';

const view: RoadmapPageView = {
  phases: [
    {
      id: 'faz-1',
      name: 'Faz 1: Kullanıcı yönetimi',
      status: 'running',
      tasks: [
        {
          id: 'mobil-login',
          title: 'Mobil login',
          status: 'running',
          targets: ['antreo-api', 'antreo-mobile'],
          workOrders: [
            { repo: 'antreo-api', id: 'wo-44', number: 26, title: 'Mobil login', status: 'done' },
            { repo: 'antreo-mobile', id: 'wo-45', number: 27, title: 'Mobil login', status: 'ready' },
          ],
        },
        {
          id: 'auth-endpoint',
          title: 'Auth endpoint',
          status: 'done',
          targets: ['antreo-api'],
          workOrders: [{ repo: 'antreo-api', id: 'wo-21', number: 16, title: 'Auth endpoint', status: 'done' }],
        },
      ],
    },
    {
      id: 'faz-2',
      name: 'Faz 2: Bildirimler',
      status: 'planned',
      tasks: [
        { id: 'mobil-bildirim', title: 'Mobil bildirim', status: 'planned', targets: ['docket', 'docket-mobile'], workOrders: [] },
      ],
    },
  ],
  runnable: ['mobil-bildirim'],
};

interface FakeRoadmapApi extends Pick<Api, 'query'> {
  readonly queries: Query[];
  setReply(reply: unknown): void;
}

/** Query calls are recorded; the reply is swappable mid-test. */
const fakeRoadmapApi = (initial: unknown): FakeRoadmapApi => {
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

/** A manual signal: tests emit changes by hand and count the subscriptions. */
const fakeChanges = (): { readonly signal: RoadmapChangeSignal; readonly emit: (change: RoadmapChange) => void } => {
  const listeners = new Set<(change: RoadmapChange) => void>();
  return {
    signal: (listener) => {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
    emit: (change) => {
      for (const listener of [...listeners]) listener(change);
    },
  };
};

/** Drain the microtask queue far enough for a store load to have applied its reply. */
const flush = async (): Promise<void> => {
  for (let i = 0; i < 5; i += 1) await Promise.resolve();
};

describe('roadmap store (U-17)', () => {
  it('U-17: the page loads the project roadmap with phases, task statuses, targets and per-repo work orders', async () => {
    const api = fakeRoadmapApi(view);
    const store = createRoadmapStore({ api, changes: fakeChanges().signal });
    await store.load('antero');

    expect(api.queries).toEqual([{ type: 'roadmap.byProject', project: 'antero' }]);
    const state = store.state();
    expect(state.problem).toBeNull();
    expect(state.view?.phases).toHaveLength(2);
    expect(state.view?.phases[0]?.tasks[0]?.workOrders.map((order) => order.repo)).toEqual(['antreo-api', 'antreo-mobile']);
  });

  it('U-17: on entry the first phase is open and the rest closed; a phase toggles for the session', async () => {
    const store = createRoadmapStore({ api: fakeRoadmapApi(view), changes: fakeChanges().signal });
    await store.load('antero');

    expect(store.state().openPhases).toEqual(['faz-1']);

    store.togglePhase('faz-1');
    expect(store.state().openPhases).toEqual([]);

    store.togglePhase('faz-2');
    expect(store.state().openPhases).toEqual(['faz-2']);
  });

  it('U-17: a workOrders.changed re-query keeps the open phases bound to the loaded project', async () => {
    const api = fakeRoadmapApi(view);
    const changes = fakeChanges();
    const store = createRoadmapStore({ api, changes: changes.signal });
    await store.load('antero');
    store.togglePhase('faz-2');
    store.toggleTask('mobil-login');

    changes.emit({ type: 'workOrders.changed' });
    await flush();

    expect(api.queries).toEqual([
      { type: 'roadmap.byProject', project: 'antero' },
      { type: 'roadmap.byProject', project: 'antero' },
    ]);
    expect(store.state().openPhases).toEqual(['faz-1', 'faz-2']);
    expect(store.state().expanded).toEqual(['mobil-login']);
  });

  it('U-17: a run event does not re-query the roadmap', async () => {
    const api = fakeRoadmapApi(view);
    const changes = fakeChanges();
    const store = createRoadmapStore({ api, changes: changes.signal });
    await store.load('antero');

    changes.emit({ type: 'run.updated', runId: 'run-1' });
    await flush();

    expect(api.queries).toHaveLength(1);
  });

  it('U-17: expanding a cross-repo task is session state; another project resets both kinds', async () => {
    const api = fakeRoadmapApi(view);
    const store = createRoadmapStore({ api, changes: fakeChanges().signal });
    await store.load('antero');
    store.toggleTask('mobil-login');
    store.togglePhase('faz-2');

    await store.load('docket');

    expect(api.queries).toEqual([
      { type: 'roadmap.byProject', project: 'antero' },
      { type: 'roadmap.byProject', project: 'docket' },
    ]);
    expect(store.state().openPhases).toEqual(['faz-1']);
    expect(store.state().expanded).toEqual([]);
  });

  it('U-17: a failed query shows the problem state, never an empty roadmap', async () => {
    const api = fakeRoadmapApi({ ok: false, code: 'not_found' });
    const store = createRoadmapStore({ api, changes: fakeChanges().signal });
    await store.load('ghost');

    const state = store.state();
    expect(state.view).toBeNull();
    expect(state.problem).toBe('not_found');
    expect(state.loading).toBe(false);
  });
});
