// board.test.ts — U-3: the board store mirrors BoardView (columns in stage order, done as its
// own lane), shows the repo-problem state on a failed query instead of an empty board,
// validates the create intent before issuing workOrder.open, and re-queries the loaded repo
// on workOrders.changed. Api and change signal are injected fakes; the events wiring lands with U-12.
import { describe, expect, it } from 'vitest';

import type { Api } from '../../api/api';
import type { Command, CommandResult } from '../../api/commands';
import type { BoardView, Query } from '../../api/queries';
import type { Actor } from '../../domain/index';
import { createBoardStore, type BoardChange, type BoardChangeSignal } from './board';

const userActor: Actor = { kind: 'user', id: 'user-1' };

const boardView: BoardView = {
  repo: 'atolye',
  flow: 'bakim',
  // Deliberately not in slug order: the store mirrors the api's stage order untouched.
  columns: [
    { stage: 'test', name: 'Test', workOrders: [{ id: 'wo-2', title: 'Book binding', status: 'ready' }] },
    { stage: 'planla', name: 'Planla', workOrders: [] },
  ],
  done: [{ id: 'wo-1', title: 'Paper marbling' }],
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
  return {
    queries,
    commands,
    setReply: (next) => {
      reply = next;
    },
    query: (query) => {
      queries.push(query);
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
    const api = fakeBoardApi(boardView);
    const store = createBoardStore({ api, changes: fakeSignal().signal, actor: userActor });
    expect(store.state()).toEqual({ loading: false, view: null, problem: null });

    await store.load('atolye');

    expect(api.queries).toEqual([{ type: 'repo.board', repo: 'atolye' }]);
    const state = store.state();
    expect(state.loading).toBe(false);
    expect(state.problem).toBeNull();
    expect(state.view).toEqual(boardView);
    expect(state.view?.columns.map((column) => column.stage)).toEqual(['test', 'planla']);
    expect(state.view?.done).toEqual([{ id: 'wo-1', title: 'Paper marbling' }]);
  });

  it('U-3: a definitions_invalid reply shows the repo-problem state, not an empty board', async () => {
    const api = fakeBoardApi({ ok: false, code: 'definitions_invalid' });
    const store = createBoardStore({ api, changes: fakeSignal().signal, actor: userActor });

    await store.load('atolye');

    const state = store.state();
    expect(state.problem).toBe('definitions_invalid');
    expect(state.view).toBeNull();
    expect(state.loading).toBe(false);
  });

  it('U-3: the create intent validates title and flow before issuing workOrder.open', async () => {
    const api = fakeBoardApi(boardView);
    const store = createBoardStore({ api, changes: fakeSignal().signal, actor: userActor });
    await store.load('atolye');

    // No title — nothing is issued.
    const noTitle = await store.create({ repo: 'atolye', title: '   ', flow: 'bakim' });
    expect(noTitle).toEqual({ ok: false, validation: 'title_required' });
    expect(api.commands.length).toBe(0);

    // No flow choice — nothing is issued.
    const noFlow = await store.create({ repo: 'atolye', title: 'Oil change', flow: '  ' });
    expect(noFlow).toEqual({ ok: false, validation: 'flow_required' });
    expect(api.commands.length).toBe(0);

    // Valid — the command carries the actor, the repo, the trimmed title and the chosen flow.
    const opened = await store.create({ repo: 'atolye', title: '  Oil change  ', flow: 'bakim' });
    expect(opened).toEqual({ ok: true, id: 'wo-new' });
    expect(api.commands).toEqual([
      {
        actor: userActor,
        command: { type: 'workOrder.open', repo: 'atolye', title: 'Oil change', flow: 'bakim' },
      },
    ]);
    // The board mirrors its own mutation: a successful create re-queries the repo.
    expect(api.queries.length).toBe(2);
    expect(api.queries[1]).toEqual({ type: 'repo.board', repo: 'atolye' });
  });

  it('U-3: a rejected workOrder.open surfaces the api code and leaves the board untouched', async () => {
    const api = fakeBoardApi(boardView, [{ ok: false, code: 'unknown_flow' }]);
    const store = createBoardStore({ api, changes: fakeSignal().signal, actor: userActor });
    await store.load('atolye');

    const outcome = await store.create({ repo: 'atolye', title: 'Oil change', flow: 'yok' });

    expect(outcome).toEqual({ ok: false, code: 'unknown_flow' });
    const state = store.state();
    expect(state.view).toEqual(boardView);
    expect(state.problem).toBeNull();
    // A failed create did not open anything, so the board is not re-queried either.
    expect(api.queries.length).toBe(1);
  });

  it('U-3: workOrders.changed re-queries the loaded repo; run.updated does not', async () => {
    const api = fakeBoardApi(boardView);
    const emitter = fakeSignal();
    const store = createBoardStore({ api, changes: emitter.signal, actor: userActor });

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
