// A directory per run for what the run writes for its provider CLI (the run-scoped config files).
// It lives outside every repository and worktree, so nothing in it can reach a checkpoint commit.
import type { RunId } from '../../domain/index';

export interface RunDir {
  readonly path: string;
  /** Removes the directory with everything in it; removing it twice is not an error. */
  dispose(): Promise<void>;
}

export interface RunDirs {
  create(runId: RunId): Promise<RunDir>;
}
