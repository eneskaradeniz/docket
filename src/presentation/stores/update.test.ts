// update.test.ts — U-24: the app-update store. The title bar's button and the settings panel's
// Güncelleme section read the same standing: the `app.update` query's verbatim state, re-queried
// on `update.changed`, with the two intents (`app.update.check`, `app.update.apply`) issued as
// the actor and mapped through results.ts (U-8). A download mutates the checker while the apply
// command is still in flight and `update.changed` fires only when it resolves, so the store
// polls the query through the flight — otherwise the button would never show a percent. Api and
// the change signal are injected fakes.
import { describe, expect, it } from 'vitest';

import type { Api } from '../../api/api';
import type { Command, CommandResult } from '../../api/commands';
import type { Query } from '../../api/queries';
import type { Actor } from '../../domain/index';

import { createUpdateStore, updateButton, updateStatusTone, type UpdateChange, type UpdateChangeSignal, type UpdateStatus } from './update';

const ACTOR: Actor = { kind: 'user', id: 'u-1' };

const NONE: UpdateStatus = { kind: 'none', current: '0.8.0' };
const AVAILABLE: UpdateStatus = { kind: 'available', current: '0.8.0', next: '0.9.0' };
const downloading = (percent: number): UpdateStatus => ({ kind: 'downloading', current: '0.8.0', next: '0.9.0', percent });
const READY: UpdateStatus = { kind: 'ready', current: '0.8.0', next: '0.9.0' };
const OFFLINE: UpdateStatus = { kind: 'error', current: '0.8.0', reason: 'offline' };

interface FakeUpdateApi extends Pick<Api, 'query' | 'command'> {
  readonly queries: Query[];
  readonly commands: Command[];
  setReply(reply: unknown): void;
  /** Holds the next apply command until `releaseApply` — a command in flight, like the walk. */
  holdApply(): void;
  releaseApply(): void;
  setCommandResult(result: CommandResult): void;
}

/** Every call is recorded; the reply is the scripted one until setReply swaps it. */
const fakeUpdateApi = (): FakeUpdateApi => {
  const queries: Query[] = [];
  const commands: Command[] = [];
  let reply: unknown = NONE;
  let applyHeld = false;
  let applyResolve: (() => void) | null = null;
  let nextCommandResult: CommandResult = { ok: true };
  return {
    queries,
    commands,
    setReply: (next) => {
      reply = next;
    },
    holdApply: () => {
      applyHeld = true;
    },
    releaseApply: () => {
      applyHeld = false;
      applyResolve?.();
      applyResolve = null;
    },
    setCommandResult: (result) => {
      nextCommandResult = result;
    },
    query: (query) => {
      queries.push(query);
      return Promise.resolve(reply);
    },
    command: (_actor, command) => {
      commands.push(command);
      const result = nextCommandResult;
      nextCommandResult = { ok: true };
      if (command.type !== 'app.update.apply' || !applyHeld) return Promise.resolve(result);
      return new Promise((resolve) => {
        applyResolve = () => resolve(result);
      });
    },
  };
};

interface FakeSignal {
  readonly signal: UpdateChangeSignal;
  emit(change: UpdateChange): void;
}

const fakeSignal = (): FakeSignal => {
  const listeners: ((change: UpdateChange) => void)[] = [];
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

interface Harness {
  readonly api: FakeUpdateApi;
  readonly emitter: FakeSignal;
  readonly store: ReturnType<typeof createUpdateStore>;
}

const createHarness = (pollMs = 400): Harness => {
  const api = fakeUpdateApi();
  const emitter = fakeSignal();
  const store = createUpdateStore({ api, changes: emitter.signal, actor: ACTOR, pollMs });
  return { api, emitter, store };
};

describe('updateButton', () => {
  it('U-24: the bar button mapping — available applies, downloading shows a disabled percent, ready restarts, none and error render nothing', () => {
    expect(updateButton(AVAILABLE)).toStrictEqual({
      visible: true,
      labelKey: 'update.button.now',
      percent: null,
      disabled: false,
    });
    expect(updateButton(downloading(25))).toStrictEqual({
      visible: true,
      labelKey: 'update.button.now',
      percent: 25,
      disabled: true,
    });
    expect(updateButton(READY)).toStrictEqual({
      visible: true,
      labelKey: 'update.button.restart',
      percent: null,
      disabled: false,
    });
    expect(updateButton(NONE).visible).toBe(false);
    expect(updateButton(OFFLINE).visible).toBe(false);
  });
});

describe('createUpdateStore', () => {
  it('load mirrors the app.update query verbatim — the state is already the view (A-32)', async () => {
    const { api, store } = createHarness();
    api.setReply(AVAILABLE);
    await store.load();
    expect(api.queries).toStrictEqual([{ type: 'app.update' }]);
    expect(store.state().status).toStrictEqual(AVAILABLE);
  });

  it('a failed query keeps the prior status — a failure never invents "you are current"', async () => {
    const { api, store } = createHarness();
    api.setReply(AVAILABLE);
    await store.load();
    api.setReply({ ok: false, code: 'not_found' });
    await store.load();
    expect(store.state().status).toStrictEqual(AVAILABLE);
  });

  it('update.changed re-queries; the coarse work-order and run events leave the status alone', async () => {
    const { api, emitter, store } = createHarness();
    await store.load();
    api.setReply(READY);
    expect(store.state().status).toStrictEqual(NONE);
    emitter.emit({ type: 'workOrders.changed' });
    emitter.emit({ type: 'run.updated', runId: 'run-1' });
    emitter.emit({ type: 'update.changed' });
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(store.state().status).toStrictEqual(READY);
  });

  it('check issues app.update.check as the actor, keeps the button honest while it runs, and maps the result (U-8)', async () => {
    const { api, store } = createHarness();
    await store.load();
    api.setCommandResult({ ok: false, code: 'not_available' });
    const checking = store.check();
    expect(store.state().checking).toBe(true);
    await checking;
    expect(api.commands).toStrictEqual([{ type: 'app.update.check' }]);
    expect(store.state().checking).toBe(false);
    expect(store.state().lastOutcome).toStrictEqual({
      command: 'app.update.check',
      result: { ok: false, code: 'not_available' },
      labelKey: 'error.unknown',
    });
  });

  it('apply polls the query while its command is in flight, so the percent shows during the walk', async () => {
    const { api, store } = createHarness(5);
    api.setReply(AVAILABLE);
    await store.load();
    api.holdApply();
    const flying = store.apply();
    // The checker mutates mid-flight: the poll must land the percent before the command resolves.
    api.setReply(downloading(50));
    await new Promise((resolve) => setTimeout(resolve, 30));
    expect(store.state().status).toStrictEqual(downloading(50));
    api.setReply(READY);
    api.releaseApply();
    await flying;
    expect(store.state().status).toStrictEqual(READY);
    expect(api.commands).toStrictEqual([{ type: 'app.update.apply' }]);
    expect(store.state().lastOutcome?.labelKey).toBe('success.app.update.apply');
  });

  it('only the newest query may apply its reply — a slow earlier load cannot undo a newer one', async () => {
    const { api, store } = createHarness();
    // The first load's reply arrives after the second's: the guard keeps the newer standing.
    // The resolver rides a box — a bare local would narrow to its null initializer across the
    // callback boundary and refuse the late call.
    const held: { resolve: ((reply: unknown) => void) | null } = { resolve: null };
    api.query = (query) => {
      api.queries.push(query);
      if (api.queries.length === 1) {
        return new Promise((resolve) => {
          held.resolve = resolve;
        });
      }
      return Promise.resolve(READY);
    };
    const first = store.load();
    await store.load();
    expect(store.state().status).toStrictEqual(READY);
    held.resolve?.(AVAILABLE);
    await first;
    expect(store.state().status).toStrictEqual(READY);
  });
});

describe('Güncelleme status lamp (U-28)', () => {
  it('U-28: the status line carries a lamp — up to date proceed, waiting or ready signal, downloading dim, failed error', () => {
    expect(updateStatusTone('none')).toBe('proceed');
    expect(updateStatusTone('available')).toBe('signal');
    expect(updateStatusTone('ready')).toBe('signal');
    expect(updateStatusTone('downloading')).toBe('dim');
    expect(updateStatusTone('error')).toBe('error');
  });
});
