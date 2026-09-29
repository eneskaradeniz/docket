// board.test.ts — U-3 + U-18: the board store mirrors BoardView (columns in stage order, done as
// its own lane), shows the repo-problem state on a failed query instead of an empty board,
// validates the create intent before issuing workOrder.open, and re-queries the loaded repo
// on workOrders.changed. U-18 adds the Kanban ⇄ Liste choice (persisted per repo, surviving a
// reload) and the list view's derivations: the stage rail's segments and the rows a filter
// selects. Api, change signal and persistence are injected fakes; the events wiring lands with
// U-12.
import { describe, expect, it } from 'vitest';

import type { Api } from '../../api/api';
import type { Command, CommandResult } from '../../api/commands';
import type { BoardView, Query } from '../../api/queries';
import type { Actor } from '../../domain/index';
import {
  createBoardStore,
  listRows,
  listSegments,
  storedBoardView,
  type BoardChange,
  type BoardChangeSignal,
  type BoardPersistence,
} from './board';

const userActor: Actor = { kind: 'user', id: 'user-1' };

/** The storage fake: a plain map, so a "reload" is a second store over the same map. */
const fakePersistence = (): BoardPersistence & { readonly store: Map<string, string> } => {
  const store = new Map<string, string>();
  return {
    store,
    getItem: (key) => store.get(key) ?? null,
    setItem: (key, value) => {
      store.set(key, value);
    },
  };
};

const boardView: BoardView = {
  repo: 'atolye',
  flow: 'bakim',
  // Deliberately not in slug order: the store mirrors the api's stage order untouched.
  columns: [
    { stage: 'test', name: 'Test', workOrders: [{ id: 'wo-2', number: 2, title: 'Book binding', status: 'ready' }] },
    { stage: 'planla', name: 'Planla', workOrders: [] },
  ],
  done: [{ id: 'wo-1', number: 1, title: 'Paper marbling' }],
};

interface RecordedCommand {
  readonly actor: Actor;
  readonly command: Command;
}

interface FakeBoardApi extends Pick<Api, 'query' | 'command'> {
  readonly queries: Query[];
  readonly commands: RecordedCommand[];
  setReply(reply: unknown): void;
}

/** Query calls and issued commands are recorded; the query reply is swappable mid-test. */
const fakeBoardApi = (initial: unknown, commandResults: readonly CommandResult[] = []): FakeBoardApi => {
  const queries: Query[] = [];
  const commands: RecordedCommand[] = [];
  let reply: unknown = initial;
  let issued = 0;
  // One project owning every repo the tests open boards for.
  const replyProjectTree = [
    { project: 'atolye', name: 'Atölye', mainRepo: 'atolye', repos: [{ repo: 'atolye', main: true }], active: 0, running: 0, waiting: 0, status: 'idle' },
  ];
  return {
    queries,
    commands,
    setReply: (next) => {
      reply = next;
    },
    query: (query) => {
      queries.push(query);
      // The create intent resolves the owning project through the tree before opening; the fake
      // answers it from the same scripted reply surface, so tests keep one knob.
      if (query.type === 'project.tree') {
        return Promise.resolve(replyProjectTree);
      }
      return Promise.resolve(reply);
    },
    command: (actor, command) => {
      commands.push({ actor, command });
      const result: CommandResult =
        commandResults.length === 0
          ? { ok: true, id: 'wo-new' }
          : (commandResults[Math.min(issued, commandResults.length - 1)] ?? { ok: true });
      issued += 1;
      return Promise.resolve(result);
    },
  };
};

interface FakeSignal {
  readonly signal: BoardChangeSignal;
  emit(change: BoardChange): void;
}

const fakeSignal = (): FakeSignal => {
  const listeners: ((change: BoardChange) => void)[] = [];
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

const flush = (): Promise<void> => new Promise((resolve) => { setTimeout(resolve, 0); });

describe('board store', () => {
  it('U-3: columns and the done lane mirror the BoardView, stage order preserved', async () => {
    const persistence = fakePersistence();
    const api = fakeBoardApi(boardView);
    const store = createBoardStore({ api, changes: fakeSignal().signal, actor: userActor, persistence });
    expect(store.state()).toEqual({ loading: false, view: null, problem: null, viewMode: 'kanban', listFilter: null });

    await store.load('atolye');

    expect(api.queries).toEqual([{ type: 'repo.board', repo: 'atolye' }]);
    const state = store.state();
    expect(state.loading).toBe(false);
    expect(state.problem).toBeNull();
    expect(state.view).toEqual(boardView);
    expect(state.view?.columns.map((column) => column.stage)).toEqual(['test', 'planla']);
    expect(state.view?.done).toEqual([{ id: 'wo-1', number: 1, title: 'Paper marbling' }]);
  });

  it('U-3: a definitions_invalid reply shows the repo-problem state, not an empty board', async () => {
    const persistence = fakePersistence();
    const api = fakeBoardApi({ ok: false, code: 'definitions_invalid' });
    const store = createBoardStore({ api, changes: fakeSignal().signal, actor: userActor, persistence });

    await store.load('atolye');

    const state = store.state();
    expect(state.problem).toBe('definitions_invalid');
    expect(state.view).toBeNull();
    expect(state.loading).toBe(false);
  });

  it('U-3: the create intent validates title and flow before issuing workOrder.open', async () => {
    const persistence = fakePersistence();
    const api = fakeBoardApi(boardView);
    const store = createBoardStore({ api, changes: fakeSignal().signal, actor: userActor, persistence });
    await store.load('atolye');

    // No title — nothing is issued.
    const noTitle = await store.create({ repo: 'atolye', title: '   ', flow: 'bakim' });
    expect(noTitle).toEqual({ ok: false, validation: 'title_required' });
    expect(api.commands.length).toBe(0);

    // No flow choice — nothing is issued.
    const noFlow = await store.create({ repo: 'atolye', title: 'Oil change', flow: '  ' });
    expect(noFlow).toEqual({ ok: false, validation: 'flow_required' });
    expect(api.commands.length).toBe(0);

    // Valid — the command carries the actor, the project the tree resolved, the repo, the
    // trimmed title and the chosen flow.
    const opened = await store.create({ repo: 'atolye', title: '  Oil change  ', flow: 'bakim' });
    expect(opened).toEqual({ ok: true, id: 'wo-new' });
    expect(api.commands).toEqual([
      {
        actor: userActor,
        command: { type: 'workOrder.open', project: 'atolye', repo: 'atolye', title: 'Oil change', flow: 'bakim' },
      },
    ]);
    // The create resolves the owning project (project.tree) and mirrors its own mutation by
    // re-querying the board.
    expect(api.queries.map((query) => query.type)).toEqual(['repo.board', 'project.tree', 'repo.board']);
    expect(api.queries[2]).toEqual({ type: 'repo.board', repo: 'atolye' });
  });

  it('U-3: a rejected workOrder.open surfaces the api code and leaves the board untouched', async () => {
    const persistence = fakePersistence();
    const api = fakeBoardApi(boardView, [{ ok: false, code: 'unknown_flow' }]);
    const store = createBoardStore({ api, changes: fakeSignal().signal, actor: userActor, persistence });
    await store.load('atolye');

    const outcome = await store.create({ repo: 'atolye', title: 'Oil change', flow: 'yok' });

    expect(outcome).toEqual({ ok: false, code: 'unknown_flow' });
    const state = store.state();
    expect(state.view).toEqual(boardView);
    expect(state.problem).toBeNull();
    // A failed create did not open anything, so the board is not re-queried either — only the
    // load and the project lookup happened.
    expect(api.queries.map((query) => query.type)).toEqual(['repo.board', 'project.tree']);
  });

  it('U-3: workOrders.changed re-queries the loaded repo; run.updated does not', async () => {
    const persistence = fakePersistence();
    const api = fakeBoardApi(boardView);
    const emitter = fakeSignal();
    const store = createBoardStore({ api, changes: emitter.signal, actor: userActor, persistence });

    // A change before any load has no repo to re-query.
    emitter.emit({ type: 'workOrders.changed' });
    await flush();
    expect(api.queries.length).toBe(0);

    await store.load('atolye');
    emitter.emit({ type: 'workOrders.changed' });
    await flush();
    expect(api.queries.length).toBe(2);
    expect(api.queries[1]).toEqual({ type: 'repo.board', repo: 'atolye' });

    // Run events do not move cards; only the cockpit listens to them.
    emitter.emit({ type: 'run.updated', runId: 'run-1' });
    await flush();
    expect(api.queries.length).toBe(2);
  });
});

// --- U-18: the Kanban ⇄ Liste choice and the list view's derivations ---------------------------------

/** A board whose stages carry one row of each standing the rail counts. */
const listView: BoardView = {
  repo: 'atolye',
  flow: 'bakim',
  columns: [
    {
      stage: 'analiz',
      name: 'Analiz',
      workOrders: [
        { id: 'wo-1', number: 1, title: 'Rol matrisi', status: 'ready' },
        { id: 'wo-2', number: 2, title: 'Önbellek', status: 'running' },
      ],
    },
    { stage: 'cozum', name: 'Çözüm', workOrders: [] },
    {
      stage: 'gelistir',
      name: 'Geliştir',
      workOrders: [
        { id: 'wo-3', number: 3, title: 'Hız sınırı', status: 'running' },
        { id: 'wo-4', number: 4, title: 'Fatura raporu', status: 'awaiting_human' },
      ],
    },
    { stage: 'test', name: 'Test', workOrders: [{ id: 'wo-5', number: 5, title: 'Stok uyarısı', status: 'limit_waiting' }] },
  ],
  done: [
    { id: 'wo-6', number: 6, title: 'Müşteri etiketi' },
    { id: 'wo-7', number: 7, title: 'Sipariş e-postası' },
  ],
};

describe('board store — view mode (U-18)', () => {
  it('U-18: the view starts at Kanban and switches persist per repo', async () => {
    const persistence = fakePersistence();
    const api = fakeBoardApi(listView);
    const store = createBoardStore({ api, changes: fakeSignal().signal, actor: userActor, persistence });
    await store.load('atolye');
    expect(store.state().viewMode).toBe('kanban');

    store.setViewMode('atolye', 'liste');
    expect(store.state().viewMode).toBe('liste');
    expect(persistence.store.get('docket.board.view.atolye')).toBe('liste');

    // The choice is per repo: another repo's board still starts at Kanban.
    await store.load('depo');
    expect(store.state().viewMode).toBe('kanban');
  });

  it('U-18: a stored choice survives a reload — a second store reads it on load', async () => {
    const persistence = fakePersistence();
    persistence.store.set('docket.board.view.atolye', 'liste');
    const api = fakeBoardApi(listView);
    const store = createBoardStore({ api, changes: fakeSignal().signal, actor: userActor, persistence });
    expect(store.state().viewMode).toBe('kanban');
    await store.load('atolye');
    expect(store.state().viewMode).toBe('liste');
  });

  it('U-18: an unreadable stored value means Kanban, never a broken view', () => {
    const persistence = fakePersistence();
    persistence.store.set('docket.board.view.atolye', 'grid');
    expect(storedBoardView(persistence, 'atolye')).toBe('kanban');
    expect(storedBoardView(persistence, 'yeni')).toBe('kanban');
    expect(storedBoardView(persistence, 'atolye')).toBe('kanban');
  });
});

describe('board store — list view (U-18)', () => {
  it('U-18: the rail counts running and waiting per stage and closes with the done segment', () => {
    const segments = listSegments(listView);
    expect(segments).toEqual([
      { stage: 'analiz', name: 'Analiz', running: 1, waiting: 0, total: 2 },
      { stage: 'cozum', name: 'Çözüm', running: 0, waiting: 0, total: 0 },
      { stage: 'gelistir', name: 'Geliştir', running: 1, waiting: 1, total: 2 },
      { stage: 'test', name: 'Test', running: 0, waiting: 1, total: 1 },
      { done: true, count: 2 },
    ]);
  });

  it('U-18: no filter lists every open row with its stage; a stage filter narrows; done closes', () => {
    const all = listRows(listView, null);
    expect(all.map((row) => row.id)).toEqual(['wo-1', 'wo-2', 'wo-3', 'wo-4', 'wo-5']);
    expect(all[0].stageName).toBe('Analiz');
    expect(all[3].stageName).toBe('Geliştir');

    const staged = listRows(listView, 2);
    expect(staged.map((row) => row.id)).toEqual(['wo-3', 'wo-4']);
    expect(staged.every((row) => row.stageName === 'Geliştir')).toBe(true);

    const done = listRows(listView, 'done');
    expect(done.map((row) => row.id)).toEqual(['wo-6', 'wo-7']);
  });

  it('U-18: the list filter is session state — selection changes it, a load resets it', async () => {
    const persistence = fakePersistence();
    const api = fakeBoardApi(listView);
    const store = createBoardStore({ api, changes: fakeSignal().signal, actor: userActor, persistence });
    await store.load('atolye');
    expect(store.state().listFilter).toBeNull();

    store.selectList(2);
    expect(store.state().listFilter).toBe(2);
    store.selectList('done');
    expect(store.state().listFilter).toBe('done');

    // A reload (another repo, or a change event) starts the list unfiltered again.
    await store.load('depo');
    expect(store.state().listFilter).toBeNull();
  });
});
