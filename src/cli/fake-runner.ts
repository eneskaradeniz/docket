// src/cli/fake-runner.ts — a FakeRunner driven by a JSON RunnerEvent[] script read from disk (WO-0024).
//
// For deterministic, token-free pipeline runs: `docket drive --fake script.json`. The script is a JSON array of
// RunnerEvent (the same shape the real adapter yields). On a permission_request the latch is created in the
// Promise executor BEFORE the yield — mirroring the real adapter's hold (src/adapters/runner/index.ts pending
// map) and the test fake (src/core/__tests__/pipeline.test.ts) — so an autoAllow policy resolves it without
// deadlock. Records decide() calls so a run can assert what the operator-side would have answered.
import { readFileSync } from 'node:fs';
import type { DriveInput, PermissionDecision, RunnerEvent, SessionRunner } from '../core/runner';

export function createFakeRunner(scriptPath: string): { runner: SessionRunner; decideCalls: Array<[string, PermissionDecision]> } {
  const script = JSON.parse(readFileSync(scriptPath, 'utf8')) as RunnerEvent[];
  const decideCalls: Array<[string, PermissionDecision]> = [];
  const pending = new Map<string, () => void>();

  const drive = async function* (_input: DriveInput): AsyncIterable<RunnerEvent> {
    for (const ev of script) {
      if (ev.kind === 'permission_request') {
        const latch = new Promise<void>((resolve) => pending.set(ev.requestId, resolve));
        yield ev;
        await latch;
      } else {
        yield ev;
      }
    }
  };

  const runner: SessionRunner = {
    drive,
    async decide(requestId: string, decision: PermissionDecision) {
      decideCalls.push([requestId, decision]);
      pending.get(requestId)?.();
    },
    pendingAsks: async () => [],
    async interrupt() { /* no-op for a scripted runner */ },
  };

  return { runner, decideCalls };
}
