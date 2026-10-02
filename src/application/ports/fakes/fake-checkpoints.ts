// In-memory CheckpointCommitter — scripted commits, diffs and bases. Commits answer with a
// deterministic, strictly increasing synthetic sha; a marked-clean tree answers { changed: false }.
import type { Result, RunId, WorkOrderId } from '../../../domain/index';

import type { CheckpointCommitter, CheckpointDiff, CheckpointError, CheckpointRef } from '../checkpoints';

export interface CheckpointCommitCall {
  readonly cwd: string;
  readonly runId: RunId;
  readonly seq: number;
}

export interface FakeCheckpointCommitter extends CheckpointCommitter {
  /** Every commit call so far, in arrival order (a copy). */
  commitCalls(): readonly CheckpointCommitCall[];
  /** Marks the tree at `cwd` clean: a commit there answers { changed: false } and records no sha. */
  markClean(cwd: string): void;
  /** Makes the next commit/diffSince/base call fail with 'git_failed' (one shot). */
  failNext(): void;
  /** Scripts the diff `diffSince` answers for a `since` sha. */
  setDiff(since: string, diff: CheckpointDiff): void;
  /** Scripts the base sha `base` answers for a work order id. */
  setBase(workOrderId: WorkOrderId, sha: string): void;
}

export const createFakeCheckpointCommitter = (
  config: {
    readonly diffs?: Readonly<Record<string, CheckpointDiff>>;
    readonly bases?: Readonly<Record<string, string>>;
  } = {},
): FakeCheckpointCommitter => {
  const calls: CheckpointCommitCall[] = [];
  const clean = new Set<string>();
  const diffs = new Map<string, CheckpointDiff>(Object.entries(config.diffs ?? {}));
  const bases = new Map<string, string>(Object.entries(config.bases ?? {}));
  let nextSha = 0;
  let failing = false;

  return {
    commitCalls: (): readonly CheckpointCommitCall[] => calls.map((call) => ({ ...call })),

    markClean: (cwd: string): void => {
      clean.add(cwd);
    },

    failNext: (): void => {
      failing = true;
    },

    setDiff: (since: string, diff: CheckpointDiff): void => {
      diffs.set(since, { files: [...diff.files], patch: diff.patch });
    },

    setBase: (workOrderId: WorkOrderId, sha: string): void => {
      bases.set(workOrderId, sha);
    },

    commit: async (input): Promise<Result<CheckpointRef, CheckpointError>> => {
      if (failing) {
        failing = false;
        return { ok: false, error: 'git_failed' };
      }
      calls.push({ cwd: input.cwd, runId: input.runId, seq: input.seq });
      if (clean.has(input.cwd)) return { ok: true, value: { sha: '', changed: false } };
      nextSha += 1;
      return { ok: true, value: { sha: `checkpoint-${nextSha}`, changed: true } };
    },

    diffSince: async (input): Promise<Result<CheckpointDiff, CheckpointError>> => {
      if (failing) {
        failing = false;
        return { ok: false, error: 'git_failed' };
      }
      const diff = diffs.get(input.since);
      // Copies: the patch is data the pack keeps; the scripted object stays the test's own.
      return diff === undefined
        ? { ok: true, value: { files: [], patch: '' } }
        : { ok: true, value: { files: [...diff.files], patch: diff.patch } };
    },

    base: async (input): Promise<Result<string, CheckpointError>> => {
      if (failing) {
        failing = false;
        return { ok: false, error: 'git_failed' };
      }
      return { ok: true, value: bases.get(input.workOrderId) ?? '' };
    },
  };
};
