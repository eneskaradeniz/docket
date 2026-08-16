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
        yield { kind: 'started', sessionId: `e2e-${input.role}` };
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
      // The wind-down: close the current turn with an interrupted stop reason and a small honest cost.
      push?.({ kind: 'turn_complete', stopReason: 'interrupted', cost: { tokensIn: 120, tokensOut: 24, usd: 0.02 } });
      finish?.();
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
