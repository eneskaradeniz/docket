// In-memory RunDirs — hands out fake paths (outside any worktree path a test uses) and records
// which were created and disposed.
import type { RunId } from '../../../domain/index';

import type { RunDir, RunDirs } from '../run-dirs';

export interface FakeRunDirs extends RunDirs {
  /** Paths created, in call order. */
  created(): readonly string[];
  /** Paths disposed, in call order (a repeated dispose is recorded once per call). */
  disposed(): readonly string[];
  /** Paths created and not disposed yet. */
  live(): readonly string[];
  /** Makes every later create reject, for the failing-create path. */
  failCreate(): void;
}

export const createFakeRunDirs = (): FakeRunDirs => {
  const created: string[] = [];
  const disposed: string[] = [];
  let failing = false;
  return {
    create: async (runId: RunId): Promise<RunDir> => {
      if (failing) throw new Error('run dir could not be created');
      const path = `/fake-data/runs/${runId}`;
      created.push(path);
      return {
        path,
        dispose: async (): Promise<void> => {
          disposed.push(path);
        },
      };
    },
    created: () => [...created],
    disposed: () => [...disposed],
    live: () => created.filter((path) => !disposed.includes(path)),
    failCreate: () => {
      failing = true;
    },
  };
};
