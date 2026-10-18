// Machine-side ports — what gates and runs need from the local machine.
import type { Result, WorkOrderId, RepoSlug } from '../../domain/index';

export interface CommandResult {
  readonly exitCode: number;
  readonly durationMs: number;
  readonly outputTail: string;
}

export interface CommandRunner {
  /** `env` (Phase 2c) is added to the runner's base environment for this call only; its values are redacted from `outputTail`. */
  run(cwd: string, command: string, timeoutMs: number, env?: Readonly<Record<string, string>>): Promise<CommandResult>;
}

export interface SecretScanner {
  scan(cwd: string): Promise<{ readonly findings: number }>;
}

export interface EvidenceChecker {
  /** True when every `path:line` pointer names an existing file and line in `cwd`. */
  resolvePointers(cwd: string, pointers: readonly string[]): Promise<boolean>;
}

/** The typed refusals of a local merge in the repo checkout (A-425, I-115). */
export type LocalMergeError =
  | 'no_repo' | 'no_branch' | 'dirty_checkout' | 'base_not_checked_out' | 'conflict' | 'git_failed';

export interface Worktrees {
  ensure(repo: RepoSlug, workOrderId: WorkOrderId): Promise<Result<{ readonly path: string }, 'no_repo'>>;
  /** The worktree path when one is already listed. Never creates a worktree, a branch or a ref. */
  existing(repo: RepoSlug, workOrderId: WorkOrderId): Promise<{ readonly path: string } | undefined>;
  /** The head commit of the work order's branch (docket/wo-<id>) in the repo checkout —
   *  `no_branch` when the branch is gone. Never creates anything. */
  branchHead(repo: RepoSlug, workOrderId: WorkOrderId): Promise<Result<string, 'no_repo' | 'no_branch'>>;
  /** `git worktree remove` then `git branch -d docket/wo-<id>` in the repo checkout — `-d`, never
   *  `-D`, so an unmerged branch is a typed refusal, not data loss. The BASE ref stays. */
  release(repo: RepoSlug, workOrderId: WorkOrderId): Promise<Result<'released' | 'branch_not_merged', 'no_repo' | 'git_failed'>>;
  /** The branch the repo checkout stands on — `base_not_checked_out` when HEAD is detached.
   *  A pure read: the base a local merge would land on (A-426). */
  checkedOutBranch(repo: RepoSlug): Promise<Result<string, 'no_repo' | 'base_not_checked_out'>>;
  /** Merges `docket/wo-<id>` into `base` in the repo checkout (I-115): refuses a base that is not
   *  the checked-out branch, a dirty checkout and an absent branch before touching anything; a
   *  conflicting merge is aborted and leaves the tree clean. Never pushes, never deletes. */
  mergeLocal(repo: RepoSlug, workOrderId: WorkOrderId, base: string): Promise<Result<void, LocalMergeError>>;
}
