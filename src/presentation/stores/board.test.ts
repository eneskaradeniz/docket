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
  cardTone,
  createBoardStore,
  kanbanColumns,
  listGroups,
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
    { stage: 'test', name: 'Test', workOrders: [{ id: 'wo-2', number: 2, title: 'Book binding', status: 'ready', account: null, since: '1970-01-01T00:00:00.400Z' }] },
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
    expect(store.state()).toEqual({ loading: false, view: null, problem: null, viewMode: 'kanban', columnOverrides: {}, groupOverrides: {} });

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
        { id: 'wo-1', number: 1, title: 'Rol matrisi', status: 'ready', account: null, since: '1970-01-01T00:00:00.100Z' },
        { id: 'wo-2', number: 2, title: 'Önbellek', status: 'running', account: 'Zincir dışı', since: '1970-01-01T00:00:00.200Z' },
      ],
    },
    { stage: 'cozum', name: 'Çözüm', workOrders: [] },
    {
      stage: 'gelistir',
      name: 'Geliştir',
      workOrders: [
        { id: 'wo-3', number: 3, title: 'Hız sınırı', status: 'running', account: 'Zincir dışı', since: '1970-01-01T00:00:00.300Z' },
        { id: 'wo-4', number: 4, title: 'Fatura raporu', status: 'awaiting_human', account: null, since: '1970-01-01T00:00:00.400Z' },
      ],
    },
    { stage: 'test', name: 'Test', workOrders: [{ id: 'wo-5', number: 5, title: 'Stok uyarısı', status: 'limit_waiting', account: null, since: '1970-01-01T00:00:00.500Z' }] },
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
  it('U-18: the list groups rows by stage in flow order, closes with the done group, and counts running and waiting', () => {
    const groups = listGroups(listView, {});
    expect(groups.map((group) => [group.key, group.kind, group.rows.length, group.running, group.waiting])).toEqual([
      ['stage:analiz', 'stage', 2, 1, 0],
      ['stage:cozum', 'stage', 0, 0, 0],
      ['stage:gelistir', 'stage', 2, 1, 1],
      ['stage:test', 'stage', 1, 0, 1],
      ['done', 'done', 2, 0, 0],
    ]);
    expect(groups[0]?.rows.map((row) => row.id)).toEqual(['wo-1', 'wo-2']);
    expect(groups[0]?.rows.map((row) => row.tone)).toEqual(['ready', 'running']);
    expect(groups[4]?.rows.map((row) => [row.id, row.status, row.tone])).toEqual([
      ['wo-6', 'done', 'done'],
      ['wo-7', 'done', 'done'],
    ]);
  });

  it('U-18: a filled stage starts open, an empty stage and the done group start closed', () => {
    expect(listGroups(listView, {}).map((group) => group.open)).toEqual([true, false, true, true, false]);
  });

  it('U-18: an explicit choice closes a filled group or opens done; an empty group never opens', () => {
    const groups = listGroups(listView, { 'stage:analiz': 'shut', done: 'open', 'stage:cozum': 'open' });
    expect(groups.map((group) => group.open)).toEqual([false, false, true, true, true]);
  });

  it('U-18: toggling a group flips it, persists per repo and survives a reload', async () => {
    const persistence = fakePersistence();
    const api = fakeBoardApi(listView);
    const store = createBoardStore({ api, changes: fakeSignal().signal, actor: userActor, persistence });
    await store.load('atolye');
    store.toggleGroup('atolye', 'stage:analiz');
    store.toggleGroup('atolye', 'done');
    expect(store.state().groupOverrides).toEqual({ 'stage:analiz': 'shut', done: 'open' });
    expect(persistence.store.get('docket.board.groups.atolye')).toBe(JSON.stringify({ 'stage:analiz': 'shut', done: 'open' }));
    store.toggleGroup('atolye', 'done');
    expect(store.state().groupOverrides).toEqual({ 'stage:analiz': 'shut', done: 'shut' });

    const reloaded = createBoardStore({ api, changes: fakeSignal().signal, actor: userActor, persistence });
    await reloaded.load('atolye');
    expect(reloaded.state().groupOverrides).toEqual({ 'stage:analiz': 'shut', done: 'shut' });
    await reloaded.load('depo');
    expect(reloaded.state().groupOverrides).toEqual({});
  });

  it('U-18: toggling an empty group changes nothing', async () => {
    const persistence = fakePersistence();
    const store = createBoardStore({ api: fakeBoardApi(listView), changes: fakeSignal().signal, actor: userActor, persistence });
    await store.load('atolye');
    store.toggleGroup('atolye', 'stage:cozum');
    expect(store.state().groupOverrides).toEqual({});
    expect(persistence.store.has('docket.board.groups.atolye')).toBe(false);
  });

  it('U-18: unreadable stored group choices mean the defaults; foreign entries are dropped', async () => {
    const persistence = fakePersistence();
    persistence.store.set('docket.board.groups.atolye', 'not json');
    const store = createBoardStore({ api: fakeBoardApi(listView), changes: fakeSignal().signal, actor: userActor, persistence });
    await store.load('atolye');
    expect(store.state().groupOverrides).toEqual({});
    persistence.store.set('docket.board.groups.atolye', '{"done":"open","stage:test":"sideways"}');
    await store.load('atolye');
    expect(store.state().groupOverrides).toEqual({ done: 'open' });
  });
});

/** A board of `stages` stages named s1…sN: the cards given per stage index, everything else empty. */
const boardOf = (stages: number, cards: Readonly<Record<number, readonly { readonly id: string; readonly status: string }[]>> = {}, done = 0): BoardView => ({
  repo: 'atolye',
  flow: 'bakim',
  columns: Array.from({ length: stages }, (_, index) => ({
    stage: `s${index + 1}`,
    name: `Stage ${index + 1}`,
    workOrders: (cards[index] ?? []).map((card, order) => ({ id: card.id, number: index * 10 + order + 1, title: `Card ${card.id}`, status: card.status, account: null, since: '1970-01-01T00:00:00.000Z' })),
  })),
  done: Array.from({ length: done }, (_, index) => ({ id: `d${index + 1}`, number: 100 + index, title: `Closed ${index + 1}` })),
});

describe('board store — Kanban columns (U-18)', () => {
  it('U-18: a card status maps to one tone — waiting kinds share amber, unknown stays unknown', () => {
    expect(cardTone('ready')).toBe('ready');
    expect(cardTone('running')).toBe('running');
    expect(cardTone('gating')).toBe('gating');
    expect(cardTone('awaiting_human')).toBe('attention');
    expect(cardTone('limit_waiting')).toBe('attention');
    expect(cardTone('blocked')).toBe('blocked');
    expect(cardTone('done')).toBe('done');
    expect(cardTone('archived')).toBe('unknown');
  });

  it('U-18: columns follow the flow order, done closes them, cards keep the api order', () => {
    const columns = kanbanColumns(boardOf(3, { 1: [{ id: 'b', status: 'ready' }, { id: 'a', status: 'running' }] }, 2), {});
    expect(columns.map((column) => column.key)).toEqual(['stage:s1', 'stage:s2', 'stage:s3', 'done']);
    expect(columns.map((column) => column.kind)).toEqual(['stage', 'stage', 'stage', 'done']);
    expect(columns[1]?.cards.map((card) => card.id)).toEqual(['b', 'a']);
    expect(columns[3]?.cards.map((card) => [card.id, card.status, card.tone])).toEqual([
      ['d1', 'done', 'done'],
      ['d2', 'done', 'done'],
    ]);
  });

  it('U-18: a column counts the cards that wait on a person — awaiting, blocked, limit', () => {
    const columns = kanbanColumns(
      boardOf(1, { 0: [{ id: 'a', status: 'awaiting_human' }, { id: 'b', status: 'blocked' }, { id: 'c', status: 'limit_waiting' }, { id: 'd', status: 'running' }, { id: 'e', status: 'ready' }] }),
      {},
    );
    expect(columns[0]?.waiting).toBe(3);
  });

  it('U-18: done is shut by default; an empty stage stays open on a short flow', () => {
    const columns = kanbanColumns(boardOf(5, { 0: [{ id: 'a', status: 'ready' }] }, 3), {});
    expect(columns.map((column) => column.shut)).toEqual([false, false, false, false, false, true]);
  });

  it('U-18: on a flow of more than six stages the empty stages start shut, the filled ones open', () => {
    const six = kanbanColumns(boardOf(6), {});
    expect(six.slice(0, 6).every((column) => !column.shut)).toBe(true);
    const seven = kanbanColumns(boardOf(7, { 2: [{ id: 'a', status: 'ready' }] }), {});
    expect(seven.slice(0, 7).map((column) => column.shut)).toEqual([true, true, false, true, true, true, true]);
  });

  it('U-18: an explicit choice beats the default; a column with a waiting card is never shut', () => {
    const view = boardOf(7, { 0: [{ id: 'a', status: 'awaiting_human' }], 1: [{ id: 'b', status: 'ready' }] }, 1);
    const overridden = kanbanColumns(view, { 'stage:s2': 'shut', 'stage:s3': 'open', done: 'open', 'stage:s1': 'shut' });
    const byKey = Object.fromEntries(overridden.map((column) => [column.key, column.shut]));
    expect(byKey['stage:s1']).toBe(false);
    expect(byKey['stage:s2']).toBe(true);
    expect(byKey['stage:s3']).toBe(false);
    expect(byKey['done']).toBe(false);
  });

  it('U-18: toggling a column flips its standing, persists per repo and survives a reload', async () => {
    const persistence = fakePersistence();
    const api = fakeBoardApi(boardOf(3, { 0: [{ id: 'a', status: 'ready' }] }, 1));
    const store = createBoardStore({ api, changes: fakeSignal().signal, actor: userActor, persistence });
    await store.load('atolye');
    store.toggleColumn('atolye', 'stage:s1');
    store.toggleColumn('atolye', 'done');
    expect(store.state().columnOverrides).toEqual({ 'stage:s1': 'shut', done: 'open' });
    expect(persistence.store.get('docket.board.columns.atolye')).toBe(JSON.stringify({ 'stage:s1': 'shut', done: 'open' }));
    store.toggleColumn('atolye', 'done');
    expect(store.state().columnOverrides).toEqual({ 'stage:s1': 'shut', done: 'shut' });

    const reloaded = createBoardStore({ api, changes: fakeSignal().signal, actor: userActor, persistence });
    await reloaded.load('atolye');
    expect(reloaded.state().columnOverrides).toEqual({ 'stage:s1': 'shut', done: 'shut' });
    await reloaded.load('other');
    expect(reloaded.state().columnOverrides).toEqual({});
  });

  it('U-18: toggling a column that waits on a person changes nothing', async () => {
    const persistence = fakePersistence();
    const api = fakeBoardApi(boardOf(2, { 0: [{ id: 'a', status: 'blocked' }] }));
    const store = createBoardStore({ api, changes: fakeSignal().signal, actor: userActor, persistence });
    await store.load('atolye');
    store.toggleColumn('atolye', 'stage:s1');
    expect(store.state().columnOverrides).toEqual({});
    expect(persistence.store.has('docket.board.columns.atolye')).toBe(false);
  });

  it('U-18: unreadable stored column choices mean the defaults, never a broken board', async () => {
    const persistence = fakePersistence();
    persistence.store.set('docket.board.columns.atolye', '{"stage:s1":"sideways","done":"open",');
    const store = createBoardStore({ api: fakeBoardApi(boardOf(2)), changes: fakeSignal().signal, actor: userActor, persistence });
    await store.load('atolye');
    expect(store.state().columnOverrides).toEqual({});
    persistence.store.set('docket.board.columns.atolye', '{"stage:s1":"sideways","done":"open"}');
    await store.load('atolye');
    expect(store.state().columnOverrides).toEqual({ done: 'open' });
  });
});
