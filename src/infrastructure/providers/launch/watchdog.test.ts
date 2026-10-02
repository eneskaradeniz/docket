// Watchdog tests (docs/v2/providers.md → Launch rule 4): driven by a fake clock and a fake timer
// queue, so no test waits on real time.
import { describe, expect, it } from 'vitest';

import { createFakeClock } from '../../../application/ports/fakes/index';
import type { RunHandle } from '../../../application/index';
import type { AgentEvent } from '../../../domain/index';
import { wrapWithWatchdog, type WatchdogTimers } from './watchdog';

interface Scheduled {
  readonly at: number;
  readonly fn: () => void;
  cancelled: boolean;
}

function createWorld() {
  const clock = createFakeClock(0);
  const scheduled: Scheduled[] = [];
  const timers: WatchdogTimers = {
    set: (fn, ms) => {
      const entry: Scheduled = { at: clock.now() + ms, fn, cancelled: false };
      scheduled.push(entry);
      return () => {
        entry.cancelled = true;
      };
    },
  };
  /** Moves time forward, firing due timers in order and letting the event pump settle after each. */
  const advance = async (ms: number): Promise<void> => {
    const target = clock.now() + ms;
    for (;;) {
      const due = scheduled
        .filter((entry) => !entry.cancelled && entry.at <= target)
        .sort((a, b) => a.at - b.at)[0];
      if (due === undefined) break;
      due.cancelled = true;
      clock.advance(Math.max(0, due.at - clock.now()));
      due.fn();
      await settle();
    }
    clock.advance(target - clock.now());
    await settle();
  };
  return { clock, timers, advance };
}

const settle = async (): Promise<void> => {
  for (let i = 0; i < 10; i += 1) await Promise.resolve();
};

function createInner() {
  const queue: AgentEvent[] = [];
  let wake: (() => void) | undefined;
  let ended = false;
  const answered: string[] = [];
  const stop = { calls: 0 };
  const handle: RunHandle = {
    events: {
      [Symbol.asyncIterator]: () => ({
        next: async () => {
          for (;;) {
            const event = queue.shift();
            if (event !== undefined) return { done: false, value: event };
            if (ended) return { done: true, value: undefined };
            await new Promise<void>((resolve) => {
              wake = resolve;
            });
          }
        },
      }),
    },
    answerPermission: (askId) => {
      answered.push(askId);
    },
    steer: () => undefined,
    stop: async () => {
      stop.calls += 1;
    },
  };
  return {
    handle,
    answered,
    stop,
    push: async (event: AgentEvent): Promise<void> => {
      queue.push(event);
      wake?.();
      await settle();
    },
    end: (): void => {
      ended = true;
      wake?.();
    },
  };
}

function drain(handle: RunHandle): AgentEvent[] {
  const seen: AgentEvent[] = [];
  void (async () => {
    for await (const event of handle.events) seen.push(event);
  })();
  return seen;
}

const text = (at: number): AgentEvent => ({ type: 'text', at, delta: 'x' });
const types = (events: readonly AgentEvent[]): string[] => events.map((event) => event.type);

describe('watchdog', () => {
  it('fires first_output_timeout when no event arrives in time, then finished failed', async () => {
    const world = createWorld();
    const inner = createInner();
    const handle = wrapWithWatchdog(inner.handle, { ...world, firstOutputTimeoutMs: 1000, inactivityTimeoutMs: 5000 });
    const seen = drain(handle);
    await world.advance(999);
    expect(seen).toEqual([]);
    await world.advance(1);
    expect(seen).toEqual([
      { type: 'error', at: 1000, class: 'timeout', reason: 'first_output_timeout', message: 'The provider produced no output in time.' },
      { type: 'finished', at: 1000, reason: 'failed' },
    ]);
    expect(inner.stop.calls).toBe(1);
  });

  it('fires inactivity_timeout after output has started and then gone silent', async () => {
    const world = createWorld();
    const inner = createInner();
    const handle = wrapWithWatchdog(inner.handle, { ...world, firstOutputTimeoutMs: 1000, inactivityTimeoutMs: 5000 });
    const seen = drain(handle);
    await world.advance(500);
    await inner.push(text(500));
    await world.advance(4999);
    expect(types(seen)).toEqual(['text']);
    await world.advance(1);
    expect(types(seen)).toEqual(['text', 'error', 'finished']);
    expect(seen[1]).toMatchObject({ class: 'timeout', reason: 'inactivity_timeout', message: 'The provider went silent.' });
    expect(inner.stop.calls).toBe(1);
  });

  it('a steady stream never times out', async () => {
    const world = createWorld();
    const inner = createInner();
    const handle = wrapWithWatchdog(inner.handle, { ...world, firstOutputTimeoutMs: 1000, inactivityTimeoutMs: 5000 });
    const seen = drain(handle);
    for (let i = 0; i < 20; i += 1) {
      await world.advance(900);
      await inner.push(text(world.clock.now()));
    }
    expect(types(seen)).not.toContain('error');
    expect(inner.stop.calls).toBe(0);
  });

  it('a permission ask pauses the timers until it is answered, then they restart', async () => {
    const world = createWorld();
    const inner = createInner();
    const handle = wrapWithWatchdog(inner.handle, { ...world, firstOutputTimeoutMs: 1000, inactivityTimeoutMs: 5000 });
    const seen = drain(handle);
    await inner.push({ type: 'permission_ask', at: 0, id: 'a1', tool: 'Bash', options: ['allow', 'deny'] });
    await world.advance(60_000);
    expect(types(seen)).toEqual(['permission_ask']);
    handle.answerPermission('a1', 'allow');
    expect(inner.answered).toEqual(['a1']);
    await world.advance(4999);
    expect(types(seen)).toEqual(['permission_ask']);
    await world.advance(1);
    expect(types(seen)).toEqual(['permission_ask', 'error', 'finished']);
  });

  it('a tool call in flight suspends the timers until its result arrives', async () => {
    const world = createWorld();
    const inner = createInner();
    const handle = wrapWithWatchdog(inner.handle, { ...world, firstOutputTimeoutMs: 1000, inactivityTimeoutMs: 5000 });
    const seen = drain(handle);
    await inner.push({ type: 'tool_call', at: 0, id: 't1', name: 'Bash' });
    await world.advance(60_000);
    expect(types(seen)).toEqual(['tool_call']);
    await inner.push({ type: 'tool_result', at: world.clock.now(), id: 't1', ok: true });
    await world.advance(4999);
    expect(types(seen)).toEqual(['tool_call', 'tool_result']);
    await world.advance(1);
    expect(types(seen)).toEqual(['tool_call', 'tool_result', 'error', 'finished']);
  });

  it('calls the stop path exactly once even when stop() is also called', async () => {
    const world = createWorld();
    const inner = createInner();
    const handle = wrapWithWatchdog(inner.handle, { ...world, firstOutputTimeoutMs: 1000, inactivityTimeoutMs: 5000 });
    drain(handle);
    await world.advance(1000);
    await handle.stop();
    await world.advance(100_000);
    expect(inner.stop.calls).toBe(1);
  });

  it('0 disables a timer', async () => {
    const world = createWorld();
    const inner = createInner();
    const handle = wrapWithWatchdog(inner.handle, { ...world, firstOutputTimeoutMs: 0, inactivityTimeoutMs: 0 });
    const seen = drain(handle);
    await world.advance(10_000_000);
    await inner.push(text(world.clock.now()));
    await world.advance(10_000_000);
    expect(types(seen)).toEqual(['text']);
    expect(inner.stop.calls).toBe(0);
  });
});
