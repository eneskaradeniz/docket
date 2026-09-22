// Realises the `SessionRunner` port (src/core/runner.ts) off the preload's
// callback-form bridge. The AsyncIterable lives here in the renderer because
// contextBridge does not proxy Symbol-keyed properties (Symbol.asyncIterator) — so
// the bridge exposes `drive(input, onEvent)` and this wraps it into the port shape
// the UI consumes. Browser-legal: no Node, no IPC directly (the bridge owns that).
//
// WO-0088: the event channel is a BROADCAST — with N owners driving, every live drive() listener
// receives every drive's events. This port is the renderer's ONE filter: each drive() folds only
// the events carrying ITS owner tag (driveOwnerTag of the input — the same derivation main makes
// when sending), so everything downstream (the drive-store folds, the panes) stays key-honest.
// The keyed control methods (interruptDrive etc.) address exactly one live drive by the same tag.
import { driveOwnerTag } from '../core/runner';
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
    // The tag filter: events arrive (ev, tag); only THIS input's owner tag folds.
    drive: (input: DriveInput) => {
      const tag = driveOwnerTag(input);
      return fromCallback<RunnerEvent>((emit) => bridge.drive(input, (ev, arrived) => { if (arrived === tag) emit(ev); }));
    },
    decide: (requestId: string, decision: PermissionDecision) => bridge.decide(requestId, decision),
    pendingAsks: () => bridge.pendingAsks(),
    interrupt: () => bridge.interrupt(),
    abort: () => bridge.abort(),
    // WO-0045: steering travels its own IPC round-trip (it targets the pipeline's live-drive slot,
    // not this port's event stream); the resulting steer_queued/delivered events arrive via drive().
    // The noteId is minted MAIN-side (pipeline.steer) — the UI reads it off the steer_queued event,
    // so the port's boolean return suffices.
    steer: async (note: string) => {
      const noteId = await bridge.steer(note);
      return noteId !== null;
    },
    retractSteer: (noteId: string) => bridge.retractSteer(noteId),
    // WO-0088 — keyed control: exactly one live drive per call, named by its owner tag.
    interruptDrive: (owner: string) => bridge.interruptDrive(owner),
    abortDrive: (owner: string) => bridge.abortDrive(owner),
    steerDrive: (owner: string, note: string) => bridge.steerDrive(owner, note),
    retractSteerDrive: (owner: string, noteId: string) => bridge.retractSteerDrive(owner, noteId),
  };
}
