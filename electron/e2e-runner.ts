// electron/e2e-runner.ts — a scripted fake SessionRunner, wired ONLY under DOCKET_E2E (WO-0031c).
// The GUI E2E specs drive REAL UI clicks; this runner answers with scripted RunnerEvents pushed from
// the test via the `docket:e2e:emit` IPC — token-free, deterministic, and through the same pipeline +
// IPC path the real SDK uses (the composition root swaps only the runner, exactly like the CLI's
// --fake). Permission asks behave like the provider: the event streams AND a latch is held until
// decide() answers, which then emits ask_resolved.
import type { DriveInput, PermissionAsk, PermissionDecision, RunnerEvent, SessionRunner } from '../src/core/runner';

export interface E2eRunner extends SessionRunner {
  /** Push a scripted event into the active drive's stream (test-only). */
  emit(ev: RunnerEvent): void;
}

export function createE2eRunner(): E2eRunner {
  let push: ((ev: RunnerEvent) => void) | undefined; // the active drive's queue push
  let finish: (() => void) | undefined; // closes the active drive's generator
  const held = new Map<string, { ask: PermissionAsk; release: () => void }>();
  // WO-0045: the steer queue the fake acknowledges (the pipeline mirrors optimistically; the tests
  // script DELIVERY by emitting steer_delivered with the noteId the steer_queued event carried).
  let seq = 0;
  const queuedNotes = new Set<string>();

  return {
    drive(input: DriveInput): AsyncIterable<RunnerEvent> {
      return (async function* (): AsyncGenerator<RunnerEvent> {
        const queue: RunnerEvent[] = [];
        let wake: (() => void) | undefined;
        let closed = false;
        push = (ev) => {
          queue.push(ev);
          wake?.();
        };
        finish = () => {
          closed = true;
          wake?.();
        };
        // 2026-08-24: the id is unique per (work order, role) — the real SDK never reuses a session
        // id across work orders, and the store's upsert is GLOBAL by provider id: one shared
        // `e2e-<role>` id let a later drive on ANOTHER work order inherit (and, via the
        // longer-transcript-wins merge, keep) a foreign transcript. Re-drives on the SAME work
        // order still share the id — the resume-like single accumulating row.
        yield { kind: 'started', sessionId: `e2e-${String(input.workOrderId).toLowerCase()}-${input.role}`, at: new Date().toISOString() };
        let read = 0; // (renamed from the obvious word — the vendor-name grep matches it)
        for (;;) {
          if (read < queue.length) {
            const ev = queue[read++]!;
            // A terminal event is YIELDED (the pipeline folds it: cost/idle records) and then the
            // stream closes — exactly like the provider ending the turn.
            if (ev.kind === 'turn_complete' || ev.kind === 'error') {
              yield ev;
              return;
            }
            yield ev;
            continue;
          }
          if (closed) return;
          await new Promise<void>((resolve) => {
            wake = resolve;
          });
        }
      })();
    },
    async decide(requestId: string, _decision: PermissionDecision): Promise<void> {
      const h = held.get(requestId);
      if (!h) return; // answering an unknown ask is a no-op (the resolvers live in the real host only)
      held.delete(requestId);
      h.release();
      push?.({ kind: 'ask_resolved', requestId });
    },
    async pendingAsks(): Promise<PermissionAsk[]> {
      return [...held.values()].map((h) => h.ask);
    },
    async interrupt(): Promise<void> {
      // The wind-down: the SAME calm terminal the real adapter emits on an intentional abort
      // (WO-0039 stabilization) — `interrupted` folds to 'stopped' (Durduruldu + ▶ Sürdür), no
      // step report, no verdict. The scripted cost is the fake's "observed" one; the real adapter
      // has none (the abort beats the result message).
      push?.({ kind: 'interrupted', cost: { tokensIn: 120, tokensOut: 24, usd: 0.02 }, at: new Date().toISOString() });
      finish?.();
    },
    async abort(): Promise<void> {
      // Zorla kes: no synthesized turn — the stream just ends (the pipeline's finally records idle).
      finish?.();
    },
    // WO-0045: acknowledge a note into the fake's queue — steer_queued streams like the real adapter
    // (command_lifecycle → steer_queued); delivery is the TEST's scripted steer_delivered emit.
    async steer(note: string, opts?: { noteId: string; emit?: boolean }): Promise<boolean> {
      if (!push) return false;
      const noteId = opts?.noteId ?? `e2e-steer-${++seq}`;
      queuedNotes.add(noteId);
      if (opts?.emit !== false) push({ kind: 'steer_queued', noteId, note, at: new Date().toISOString() });
      return true;
    },
    async retractSteer(noteId: string): Promise<boolean> {
      if (!queuedNotes.delete(noteId)) return false;
      push?.({ kind: 'steer_retracted', noteId, at: new Date().toISOString() });
      return true;
    },
    emit(ev: RunnerEvent): void {
      if (ev.kind === 'permission_request') {
        // Hold it like the provider would: the card shows, decide() answers, ask_resolved streams.
        held.set(ev.requestId, {
          ask: { requestId: ev.requestId, tool: ev.tool, input: ev.input, ...(ev.title ? { title: ev.title } : {}), ...(ev.reason ? { reason: ev.reason } : {}) },
          release: () => undefined,
        });
      }
      if (ev.kind === 'turn_complete' || ev.kind === 'error') {
        push?.(ev);
        finish?.();
        return;
      }
      push?.(ev);
    },
  };
}
