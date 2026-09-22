// WO-0088 — the renderer port's owner-tag filter. The preload broadcasts EVERY live drive's
// events to EVERY drive() listener (one channel); the port must fold only ITS drive's events —
// the tag comes from the drive input (driveOwnerTag), the same derivation main makes.
import { describe, expect, it } from 'vitest';
import { createRunnerPort } from './runner';
import { driveOwnerTag } from '../core/runner';
import type { DriveInput, RunnerEvent } from '../core/runner';
import type { WorkOrderId } from '../core/types';
import type { RunnerBridge } from './preload';

const WO_A = 'WO-A';
const WO_B = 'WO-B';
const woDrive = (id: string): DriveInput => ({ role: 'implementer', workOrderId: id as WorkOrderId, mode: 'direct', prompt: '' });

/** A scripted broadcast bridge: every registered listener receives EVERY emitted (tag, ev) pair,
 *  exactly like the shared `docket:runner:event` channel. `end` resolves the Nth drive() promise
 *  (the run's end closes that iterator). */
function broadcastBridge() {
  type Listener = (ev: RunnerEvent, tag: string) => void;
  const listeners = new Set<Listener>();
  const ends: Array<() => void> = [];
  const bridge = {
    drive: (_input: DriveInput, onEvent: (ev: RunnerEvent, tag?: string) => void): Promise<void> => {
      listeners.add(onEvent as Listener);
      return new Promise<void>((resolve) => ends.push(resolve));
    },
    decide: () => Promise.resolve(),
    pendingAsks: () => Promise.resolve([]),
    interrupt: () => Promise.resolve(),
    abort: () => Promise.resolve(),
    steer: () => Promise.resolve(null),
    retractSteer: () => Promise.resolve(false),
    interruptDrive: () => Promise.resolve(),
    abortDrive: () => Promise.resolve(),
    steerDrive: () => Promise.resolve(null),
    retractSteerDrive: () => Promise.resolve(false),
  } as unknown as RunnerBridge;
  return {
    bridge,
    emit: (tag: string, ev: RunnerEvent) => {
      for (const l of listeners) l(ev, tag);
    },
    end: (which: number) => ends[which]?.(),
  };
}

describe('createRunnerPort — the owner-tag filter (WO-0088)', () => {
  it('a drive folds ONLY the events carrying its own owner tag', async () => {
    const { bridge, emit, end } = broadcastBridge();
    const port = createRunnerPort(bridge);
    const tagA = driveOwnerTag(woDrive(WO_A));
    const tagB = driveOwnerTag(woDrive(WO_B));
    const itA = port.drive(woDrive(WO_A))[Symbol.asyncIterator]();
    const itB = port.drive(woDrive(WO_B))[Symbol.asyncIterator]();
    emit(tagA, { kind: 'started', sessionId: 's-a' });
    emit(tagB, { kind: 'started', sessionId: 's-b' });
    emit(tagB, { kind: 'assistant_text', text: 'B ilk satır' });
    emit(tagA, { kind: 'assistant_text', text: 'A satırı' });
    emit(tagB, { kind: 'assistant_text', text: 'B satırı' });
    end(0); // A's run ends → A's iterator drains
    end(1); // B's run ends
    // sequential drain — the port's iterable is a single-consumer stream
    const drain = async (it: { next: () => Promise<IteratorResult<RunnerEvent>> }): Promise<RunnerEvent[]> => {
      const out: RunnerEvent[] = [];
      for (;;) {
        const r = await it.next();
        if (r.done) return out;
        out.push(r.value);
      }
    };
    const [eventsA, eventsB] = await Promise.all([drain(itA), drain(itB)]);
    const texts = (evs: RunnerEvent[]) => evs.map((e) => (e as { text?: string }).text ?? e.kind);
    // each stream folds ONLY its own tag's events — the sibling's words never cross
    expect(texts(eventsA)).toEqual(['started', 'A satırı']);
    expect(texts(eventsB)).toEqual(['started', 'B ilk satır', 'B satırı']);
  });
});
