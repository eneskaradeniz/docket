// Run watchdogs: a hung CLI must not block a run forever. Wraps a started run so that no first
// event, or silence after output began, stops the run and reports a timeout instead.
// Contract: docs/v2/providers.md → "Launch" rule 4.
import type { Clock, RunHandle } from '../../../application/index';
import type { AgentEvent } from '../../../domain/index';

/** Schedules one callback; the returned function cancels it. Injected so tests never wait. */
export interface WatchdogTimers {
  set(fn: () => void, ms: number): () => void;
}

export const realWatchdogTimers: WatchdogTimers = {
  set: (fn, ms) => {
    const handle = setTimeout(fn, ms);
    return () => clearTimeout(handle);
  },
};

export interface WatchdogConfig {
  readonly clock: Clock;
  readonly timers: WatchdogTimers;
  /** Milliseconds allowed before the first event; 0 disables. */
  readonly firstOutputTimeoutMs: number;
  /** Milliseconds of silence allowed once output has started; 0 disables. */
  readonly inactivityTimeoutMs: number;
}

// Fixed text: vendor output is never relayed, so the message stays stable and safe to show.
const FIRST_OUTPUT_MESSAGE = 'The provider produced no output in time.';
const INACTIVITY_MESSAGE = 'The provider went silent.';

export function wrapWithWatchdog(inner: RunHandle, config: WatchdogConfig): RunHandle {
  const queue: AgentEvent[] = [];
  let wake: (() => void) | undefined;
  let closed = false;
  let failure: unknown;
  let hasFailure = false;
  let started = false;
  // A user stop must stay a cancel: once requested, no timer may arm or fire.
  let userStopped = false;
  let cancelTimer: (() => void) | undefined;
  let stopPromise: Promise<void> | undefined;
  const openAsks = new Set<string>();
  const openTools = new Set<string>();

  const notify = (): void => {
    const resolve = wake;
    wake = undefined;
    resolve?.();
  };
  const close = (): void => {
    closed = true;
    cancelTimer?.();
    cancelTimer = undefined;
    notify();
  };
  const stopOnce = (): Promise<void> => {
    stopPromise ??= inner.stop();
    return stopPromise;
  };

  const arm = (): void => {
    cancelTimer?.();
    cancelTimer = undefined;
    if (closed || userStopped || openAsks.size > 0 || openTools.size > 0) return;
    const ms = started ? config.inactivityTimeoutMs : config.firstOutputTimeoutMs;
    if (ms <= 0) return;
    cancelTimer = config.timers.set(() => fire(started ? 'inactivity_timeout' : 'first_output_timeout'), ms);
  };

  const fire = (reason: 'first_output_timeout' | 'inactivity_timeout'): void => {
    if (closed || userStopped) return;
    const at = config.clock.now();
    queue.push(
      {
        type: 'error',
        at,
        class: 'timeout',
        reason,
        message: reason === 'first_output_timeout' ? FIRST_OUTPUT_MESSAGE : INACTIVITY_MESSAGE,
      },
      { type: 'finished', at, reason: 'failed' },
    );
    close();
    stopOnce().catch(() => undefined);
  };

  const observe = (event: AgentEvent): void => {
    started = true;
    if (event.type === 'permission_ask') openAsks.add(event.id);
    else if (event.type === 'tool_call') openTools.add(event.id);
    else if (event.type === 'tool_result') openTools.delete(event.id);
  };

  const pump = async (): Promise<void> => {
    try {
      for await (const event of inner.events) {
        if (closed) return;
        observe(event);
        queue.push(event);
        if (event.type === 'finished') {
          close();
          return;
        }
        arm();
        notify();
      }
    } catch (error) {
      hasFailure = true;
      failure = error;
    }
    close();
  };

  arm();
  void pump();

  const events: AsyncIterable<AgentEvent> = {
    [Symbol.asyncIterator]: () => ({
      next: async (): Promise<IteratorResult<AgentEvent>> => {
        for (;;) {
          const event = queue.shift();
          if (event !== undefined) return { done: false, value: event };
          if (hasFailure) {
            hasFailure = false;
            throw failure;
          }
          if (closed) return { done: true, value: undefined };
          await new Promise<void>((resolve) => {
            wake = resolve;
          });
        }
      },
    }),
  };

  return {
    events,
    answerPermission: (askId, decision) => {
      inner.answerPermission(askId, decision);
      if (openAsks.delete(askId)) arm();
    },
    steer: (note) => inner.steer(note),
    stop: () => {
      userStopped = true;
      cancelTimer?.();
      cancelTimer = undefined;
      return stopOnce();
    },
  };
}
