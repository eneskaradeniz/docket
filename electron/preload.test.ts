// preload.test.ts — the event side of the bridge, proven without Electron: every subscriber
// shares ONE ipcRenderer listener on docket:event, however many stores subscribe for the session,
// so the renderer's EventEmitter limit is respected by design instead of tripping its
// MaxListenersExceededWarning; the unsubscribe still drops exactly its own subscriber.
import { beforeEach, describe, expect, it, vi } from 'vitest';

type Listener = (event: unknown, payload: unknown) => void;

// vi.mock factories run before any import of the module under test, so the fake electron and the
// bookkeeping it exposes live in vi.hoisted — the test and the factory share one object.
const harness = vi.hoisted(() => {
  const channels = new Map<string, Set<Listener>>();
  const exposed = new Map<string, unknown>();
  const listeners = (channel: string): Set<Listener> => {
    const set = channels.get(channel) ?? new Set<Listener>();
    channels.set(channel, set);
    return set;
  };
  return {
    exposed,
    listenerCount: (channel: string) => listeners(channel).size,
    emit: (channel: string, payload: unknown) => {
      for (const listener of [...listeners(channel)]) listener({}, payload);
    },
    reset: () => {
      channels.clear();
      exposed.clear();
    },
    mocks: {
      contextBridge: {
        exposeInMainWorld: (key: string, value: unknown) => {
          exposed.set(key, value);
        },
      },
      ipcRenderer: {
        on: (channel: string, listener: Listener) => {
          listeners(channel).add(listener);
        },
        removeListener: (channel: string, listener: Listener) => {
          listeners(channel).delete(listener);
        },
        invoke: async () => undefined,
      },
    },
  };
});

vi.mock('electron', () => harness.mocks);

const subscribe = async (): Promise<(listener: (event: unknown) => void) => () => void> => {
  await import('./preload');
  const bridge = harness.exposed.get('docket') as {
    readonly subscribe: (listener: (event: unknown) => void) => () => void;
  };
  return bridge.subscribe;
};

beforeEach(() => {
  vi.resetModules();
  harness.reset();
});

describe('preload subscribe (docket:event)', () => {
  it('however many subscribers, exactly one ipcRenderer listener rides the channel', async () => {
    const subscribeOne = await subscribe();
    const SUBSCRIBERS = 12; // past the EventEmitter limit of 10 — the count that tripped the warning
    for (let index = 0; index < SUBSCRIBERS; index += 1) subscribeOne(() => undefined);
    expect(harness.listenerCount('docket:event')).toBe(1);
  });

  it('one ipc event reaches every subscriber, and only its own unsubscribe stops one', async () => {
    const subscribeOne = await subscribe();
    const received: string[] = [];
    const stops = ['a', 'b', 'c'].map((id) => subscribeOne(() => received.push(id)));
    const EVENT = { type: 'workOrders.changed' };
    harness.emit('docket:event', EVENT);
    expect(received).toEqual(['a', 'b', 'c']);
    stops[1]();
    harness.emit('docket:event', EVENT);
    expect(received).toEqual(['a', 'b', 'c', 'a', 'c']);
    // Dropping a subscriber never drops the shared listener the rest still ride on.
    expect(harness.listenerCount('docket:event')).toBe(1);
  });

  it('a subscriber that unsubscribes inside its own dispatch does not break the fan-out', async () => {
    const subscribeOne = await subscribe();
    const received: string[] = [];
    const stopFirst = subscribeOne(() => {
      received.push('first');
      stopFirst();
    });
    subscribeOne(() => received.push('second'));
    harness.emit('docket:event', { type: 'runs.changed' });
    harness.emit('docket:event', { type: 'runs.changed' });
    expect(received).toEqual(['first', 'second', 'second']);
  });
});
