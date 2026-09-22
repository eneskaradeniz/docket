// WO-0088 — the drive-store's PARALLEL semantics: one active drive per OWNER, N owners at once.
// The store is the renderer's second keyed layer: the owner guard, the plural active snapshots and
// the keyed control (interrupt/abort/steer reach exactly the addressed key's drive).
import { describe, expect, it } from 'vitest';
import { createDriveStore } from './drive-store';
import { driveOwnerTag } from '../../../core/runner';
import type { DriveInput, PermissionDecision, RunnerEvent, SessionRunner } from '../../../core/runner';
import type { WorkOrderId, WorkspaceId } from '../../../core/types';

const WO_A = 'WO-A' as WorkOrderId;
const WO_B = 'WO-B' as WorkOrderId;
const WS = 'ws-t' as WorkspaceId;

const woFree = (id: WorkOrderId): DriveInput => ({ role: 'architect', workOrderId: id, mode: 'plan', prompt: 'p' });
const draftInput = (): DriveInput => ({ role: 'architect', workspaceId: WS, mode: 'plan', prompt: 'p', goalNote: 'n', docPaths: [] });

const started = (id: string): RunnerEvent => ({ kind: 'started', sessionId: id });
const doneEv = (): RunnerEvent => ({ kind: 'turn_complete', stopReason: 'end_turn', cost: { tokensIn: 0, tokensOut: 0, usd: 0 } });

/** A controllable multi-drive port fake: a BUFFERED event queue per owner tag, every control call
 *  recorded. `settle()` lets the store's fold loop drain before assertions (real streams race the
 *  same way; the store's contract is eventual fold, not synchronous). */
function fakePort() {
  const queues = new Map<string, RunnerEvent[]>();
  const wakes = new Map<string, Array<() => void>>();
  const calls: { method: string; args: unknown[] }[] = [];
  const runner = {
    drive(input: DriveInput): AsyncIterable<RunnerEvent> {
      const tag = driveOwnerTag(input);
      const q = queues.get(tag) ?? [];
      queues.set(tag, q);
      let drained = false; // the stream closes AFTER a terminal event was delivered (the provider's shape)
      return {
        [Symbol.asyncIterator]() {
          return {
            next: () =>
              new Promise<IteratorResult<RunnerEvent>>((res) => {
                if (drained) {
                  res({ value: undefined as unknown as RunnerEvent, done: true });
                  return;
                }
                const ev = q.shift();
                if (ev !== undefined) {
                  if (ev.kind === 'turn_complete' || ev.kind === 'error') drained = true;
                  res({ value: ev, done: false });
                  return;
                }
                wakes.set(tag, [...(wakes.get(tag) ?? []), () => {
                  const next = q.shift();
                  if (next !== undefined && (next.kind === 'turn_complete' || next.kind === 'error')) drained = true;
                  res(next !== undefined ? { value: next, done: false } : { value: undefined as unknown as RunnerEvent, done: drained });
                }]);
              }),
          };
        },
      };
    },
    async decide(_requestId: string, _d: PermissionDecision): Promise<void> {},
    pendingAsks: async () => [],
    interrupt: () => {
      calls.push({ method: 'interrupt', args: [] });
      return Promise.resolve();
    },
    abort: () => {
      calls.push({ method: 'abort', args: [] });
      return Promise.resolve();
    },
    interruptDrive: (tag: string) => {
      calls.push({ method: 'interruptDrive', args: [tag] });
      return Promise.resolve();
    },
    abortDrive: (tag: string) => {
      calls.push({ method: 'abortDrive', args: [tag] });
      return Promise.resolve();
    },
    steerDrive: (tag: string, note: string) => {
      calls.push({ method: 'steerDrive', args: [tag, note] });
      return Promise.resolve(`note-${calls.length}`);
    },
    retractSteerDrive: (tag: string, noteId: string) => {
      calls.push({ method: 'retractSteerDrive', args: [tag, noteId] });
      return Promise.resolve(true);
    },
  } as unknown as SessionRunner;
  const push = (tag: string, ev: RunnerEvent): void => {
    const q = queues.get(tag) ?? [];
    queues.set(tag, q);
    q.push(ev);
    for (const w of wakes.get(tag) ?? []) w();
    wakes.set(tag, []);
  };
  const settle = async (): Promise<void> => {
    for (let i = 0; i < 20; i++) await Promise.resolve();
    await new Promise((r) => setTimeout(r, 0));
    for (let i = 0; i < 20; i++) await Promise.resolve();
  };
  return { runner, push, settle, calls };
}

const tagA = driveOwnerTag(woFree(WO_A));
const tagB = driveOwnerTag(woFree(WO_B));

describe('drive-store — the parallel spine (WO-0088)', () => {
  it('two owners start concurrently; a second key on an ALREADY-RUNNING owner is refused', async () => {
    const fake = fakePort();
    const store = createDriveStore(fake.runner);
    expect(store.start('WO-A:free', woFree(WO_A))).toBe(true);
    expect(store.start('WO-B:free', woFree(WO_B))).toBe(true); // a different owner: parallel
    await fake.settle();
    expect(store.start('WO-B:step:1', { role: 'implementer', workOrderId: WO_B, mode: 'direct', prompt: 'p', stepIndex: 1 })).toBe(false);
    // re-starting the SAME running key is the no-op true (the old contract)
    expect(store.start('WO-A:free', woFree(WO_A))).toBe(true);
    expect(store.get('WO-A:free')?.running).toBe(true);
    expect(store.get('WO-B:free')?.running).toBe(true);
    expect(store.get('WO-B:step:1')).toBeUndefined();
  });

  it('the same owner runs again only after its current drive ends (the serial per-WO rule)', async () => {
    const fake = fakePort();
    const store = createDriveStore(fake.runner);
    expect(store.start('WO-A:free', woFree(WO_A))).toBe(true);
    fake.push(tagA, doneEv()); // ends the drive
    await fake.settle();
    expect(store.get('WO-A:free')?.running).toBe(false);
    expect(store.start('WO-A:step:1', { role: 'implementer', workOrderId: WO_A, mode: 'direct', prompt: 'p', stepIndex: 1 })).toBe(true);
  });

  it('activeSnapshots carries ONE entry per running WO drive and excludes the draft (the locked ruling)', async () => {
    const fake = fakePort();
    const store = createDriveStore(fake.runner);
    expect(store.activeSnapshots()).toEqual([]);
    store.start('WO-A:free', woFree(WO_A));
    store.start('WO-B:free', woFree(WO_B));
    store.start(`${WS as string}:draft`, draftInput());
    await fake.settle();
    const snaps = store.activeSnapshots();
    expect(snaps.map((s) => s.woId)).toEqual([WO_A, WO_B]); // insertion order; the draft never overlays a card
    // identity-stable between real transitions (no re-render per streamed line)
    expect(store.activeSnapshots()).toBe(snaps);
    fake.push(tagB, doneEv());
    await fake.settle();
    expect(store.activeSnapshots().map((s) => s.woId)).toEqual([WO_A]);
  });

  it('keyed control: interrupt/abort/steer route to exactly the addressed key’s owner tag', async () => {
    const fake = fakePort();
    const store = createDriveStore(fake.runner);
    store.start('WO-A:free', woFree(WO_A));
    store.start('WO-B:free', woFree(WO_B));
    await fake.settle();
    await store.interrupt('WO-B:free');
    await store.abort('WO-B:free');
    await store.steer('WO-A:free', 'A ya not');
    const methods = fake.calls.map((c) => c.method);
    expect(methods).toContain('interruptDrive');
    expect(methods).toContain('abortDrive');
    expect(methods).toContain('steerDrive');
    expect(methods).not.toContain('interrupt');
    expect(methods).not.toContain('abort');
    const byTag = (m: string) => fake.calls.find((c) => c.method === m)?.args[0];
    expect(byTag('interruptDrive')).toBe(tagB);
    expect(byTag('abortDrive')).toBe(tagB);
    expect(byTag('steerDrive')).toBe(tagA);
    // steering a key that is not running refuses BEFORE any transport call
    expect(await store.steer('WO-Z:free', 'x')).toBe(false);
    expect(fake.calls.filter((c) => c.method === 'steerDrive')).toHaveLength(1);
  });

  it('a draft counts in the activity chip (running count) but never in activeSnapshots', async () => {
    const fake = fakePort();
    const store = createDriveStore(fake.runner);
    store.start('WO-A:free', woFree(WO_A));
    store.start(`${WS as string}:draft`, draftInput());
    store.start('WO-B:free', woFree(WO_B));
    await fake.settle();
    expect(store.activitySnapshot()?.running).toBe(3);
    expect(store.activeSnapshots().map((s) => s.woId)).toEqual([WO_A, WO_B]);
  });

  it('events fold into their own key only (per-key folds, per-key sessions)', async () => {
    const fake = fakePort();
    const store = createDriveStore(fake.runner);
    store.start('WO-A:free', woFree(WO_A));
    store.start('WO-B:free', woFree(WO_B));
    await fake.settle();
    fake.push(tagA, started('sess-a'));
    fake.push(tagB, started('sess-b'));
    fake.push(tagA, { kind: 'assistant_text', text: 'A satırı' });
    await fake.settle();
    expect(store.get('WO-A:free')?.state.entries).toHaveLength(2); // the started note + A's line
    expect(store.get('WO-B:free')?.state.entries).toHaveLength(1);
    expect(store.sessionId('WO-B:free')).toBe('sess-b');
    expect(store.sessionId('WO-A:free')).toBe('sess-a');
  });

  it('forgetWo drops the folds of that work order and leaves the others driving', async () => {
    const fake = fakePort();
    const store = createDriveStore(fake.runner);
    store.start('WO-A:free', woFree(WO_A));
    store.start('WO-B:free', woFree(WO_B));
    await fake.settle();
    store.forgetWo(WO_A);
    expect(store.get('WO-A:free')).toBeUndefined();
    expect(store.get('WO-B:free')?.running).toBe(true);
  });

  it('the unkeyed fallbacks still work against a single-drive port (the pre-WO-0088 shape)', async () => {
    const calls: string[] = [];
    let emitted = false;
    const legacy = {
      drive: (): AsyncIterable<RunnerEvent> =>
        ({
          [Symbol.asyncIterator]() {
            return {
              next: () =>
                Promise.resolve<IteratorResult<RunnerEvent>>(
                  emitted ? { value: undefined as unknown as RunnerEvent, done: true } : { value: (emitted = true, doneEv()), done: false },
                ),
            };
          },
        }) as AsyncIterable<RunnerEvent>,
      decide: async (_r: string, _d: PermissionDecision) => {},
      pendingAsks: async () => [],
      interrupt: () => {
        calls.push('interrupt');
        return Promise.resolve();
      },
      abort: () => {
        calls.push('abort');
        return Promise.resolve();
      },
    } as unknown as SessionRunner;
    const store = createDriveStore(legacy);
    store.start('WO-A:free', woFree(WO_A));
    await new Promise((r) => setTimeout(r, 0));
    await store.interrupt('WO-A:free');
    await store.abort('WO-A:free');
    expect(calls).toEqual(['interrupt', 'abort']);
    expect(store.get('WO-A:free')?.running).toBe(false);
  });
});
