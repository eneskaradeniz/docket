// Realises the `SessionRunner` port (src/core/runner.ts) off the preload's
// callback-form bridge. The AsyncIterable lives here in the renderer because
// contextBridge does not proxy Symbol-keyed properties (Symbol.asyncIterator) — so
// the bridge exposes `drive(input, onEvent)` and this wraps it into the port shape
// the UI consumes. Browser-legal: no Node, no IPC directly (the bridge owns that).
import type {
  DriveInput,
  PermissionDecision,
  RunnerEvent,
  SessionRunner,
} from '../core/runner';
import type { RunnerBridge } from './preload';

/** Single-consumer AsyncIterable built from an emit callback + completion promise. */
function fromCallback<T>(run: (emit: (v: T) => void) => Promise<void>): AsyncIterable<T> {
  return {
    [Symbol.asyncIterator]() {
      const queue: Array<IteratorResult<T>> = [];
      let done = false;
      let waiter: ((r: IteratorResult<T>) => void) | null = null;
      const emit = (v: T) => {
        if (waiter) {
          const w = waiter;
          waiter = null;
          w({ value: v, done: false });
        } else {
          queue.push({ value: v, done: false });
        }
      };
      void run(emit).then(() => {
        done = true;
        if (waiter) {
          const w = waiter;
          waiter = null;
          w({ value: undefined as T, done: true });
        }
      });
      return {
        next(): Promise<IteratorResult<T>> {
          if (queue.length) return Promise.resolve(queue.shift()!);
          if (done) return Promise.resolve({ value: undefined as T, done: true });
          return new Promise((res) => {
            waiter = res;
          });
        },
      };
    },
  };
}

export function createRunnerPort(bridge: RunnerBridge): SessionRunner {
  return {
    drive: (input: DriveInput) => fromCallback<RunnerEvent>((emit) => bridge.drive(input, emit)),
    decide: (requestId: string, decision: PermissionDecision) => bridge.decide(requestId, decision),
    pendingAsks: () => bridge.pendingAsks(),
    interrupt: () => bridge.interrupt(),
  };
}
