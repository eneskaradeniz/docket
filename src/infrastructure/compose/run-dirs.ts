// Run directories (I-61): <dataDir>/runs/<runId>/, private, never inside a repo or worktree. A run
// writes its provider config here; the directory goes away when the run ends, and anything a
// crashed app left behind is pruned at the next start.
import { chmod, mkdir, readdir, rm, stat } from 'node:fs/promises';
import { join } from 'node:path';

import type { RunDirs } from '../../application/index';
import { isUlid } from '../../domain/index';

export const RUN_DIR_MAX_AGE_MS = 24 * 60 * 60 * 1000;

const runsRoot = (dataDir: string): string => join(dataDir, 'runs');

export function createRunDirs(options: { readonly dataDir: string }): RunDirs {
  return {
    create: async (runId) => {
      // The id becomes a path segment, so only the exact ULID shape is accepted.
      if (!isUlid(runId)) throw new Error('run directory needs a run id');
      const root = runsRoot(options.dataDir);
      await mkdir(root, { recursive: true, mode: 0o700 });
      await chmod(root, 0o700);
      const path = join(root, runId);
      await mkdir(path, { mode: 0o700 });
      return {
        path,
        dispose: async () => {
          await rm(path, { recursive: true, force: true });
        },
      };
    },
  };
}

/** Removes run directories older than a day (a crash or a kill skipped their dispose). Best
 *  effort: returns how many went away, reports failures by error name only, and leaves every
 *  entry that is not named like a run id alone. */
export async function pruneStaleRunDirs(options: {
  readonly dataDir: string;
  readonly now: number;
  readonly onError?: (name: string) => void;
}): Promise<number> {
  const root = runsRoot(options.dataDir);
  let removed = 0;
  let names: string[];
  try {
    names = await readdir(root);
  } catch {
    return 0;
  }
  for (const name of names) {
    if (!isUlid(name)) continue;
    try {
      const path = join(root, name);
      if (options.now - (await stat(path)).mtimeMs <= RUN_DIR_MAX_AGE_MS) continue;
      await rm(path, { recursive: true, force: true });
      removed += 1;
    } catch (error) {
      options.onError?.(error instanceof Error ? error.name : 'unknown');
    }
  }
  return removed;
}
