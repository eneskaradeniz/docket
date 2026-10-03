// vcs/checkpoints.ts — the CheckpointCommitter port over runGit (P-38 item 4, A-57 … A-59):
// `git add -A` + commit in the work order's worktree, the redacted diff since a base, and the
// worktree base ref. Every command runs with the worktree as its cwd, so a checkpoint can only
// ever touch that worktree's own branch and index (I-20's guarantee, A-58). Commits are local:
// nothing here pushes — travelling is the forge flow's business, never a checkpoint's.
import type { CheckpointCommitter } from '../../application/index';
import { err, ok, type Result, type RunId } from '../../domain/index';

import { runGit } from './git';
import { BASE_REF_PREFIX } from './worktrees';

export interface CheckpointsConfig {
  /** Applied to every patch at this boundary — the scanner's `redactSecrets`, handed in by the
   *  composition root (the module map keeps vcs off gates); application and domain never see
   *  unredacted patch text. */
  readonly redact: (text: string) => string;
}

// The `-c` flags outrank repo and global config alike, so a checkpoint is authored by the Docket
// identity even inside a repo that carries a user's own name and email (A-57: never a user).
const IDENTITY_ARGS = ['-c', 'user.name=Docket', '-c', 'user.email=checkpoints@docket.local'] as const;

const gitFailed = <T>(): Result<T, 'git_failed'> => err('git_failed');

/** A checkpoint names its run and its sequence, so a worktree's history reads as a run's progress. */
const commitMessage = (runId: RunId, seq: number): string => `Docket checkpoint ${seq} (run ${runId})`;

export function createCheckpoints(config: CheckpointsConfig): CheckpointCommitter {
  return {
    commit: async (input) => {
      const staged = await runGit(input.cwd, ['add', '-A']);
      if (staged.exitCode !== 0) return gitFailed();
      // --quiet exits 1 exactly when the index differs from HEAD: exit 0 is the clean-tree no-op
      // (a result, never an error); anything but 0 or 1 is a real git failure.
      const dirty = await runGit(input.cwd, ['diff', '--cached', '--quiet']);
      if (dirty.exitCode === 0) return ok({ sha: '', changed: false });
      if (dirty.exitCode !== 1) return gitFailed();
      const committed = await runGit(input.cwd, [
        ...IDENTITY_ARGS,
        'commit',
        '-m',
        commitMessage(input.runId, input.seq),
      ]);
      if (committed.exitCode !== 0) return gitFailed();
      const head = await runGit(input.cwd, ['rev-parse', 'HEAD']);
      if (head.exitCode !== 0) return gitFailed();
      return ok({ sha: head.stdout.trim(), changed: true });
    },

    diffSince: async (input) => {
      const names = await runGit(input.cwd, ['diff', '--name-only', input.since]);
      if (names.exitCode !== 0) return gitFailed();
      const patch = await runGit(input.cwd, ['diff', input.since]);
      if (patch.exitCode !== 0) return gitFailed();
      const files = names.stdout.split('\n').filter((line) => line.length > 0);
      return ok({ files, patch: config.redact(patch.stdout) });
    },

    base: async (input) => {
      const resolved = await runGit(input.cwd, [
        'rev-parse',
        '--verify',
        '--quiet',
        `${BASE_REF_PREFIX}${input.workOrderId}`,
      ]);
      if (resolved.exitCode !== 0) return gitFailed();
      return ok(resolved.stdout.trim());
    },
  };
}
