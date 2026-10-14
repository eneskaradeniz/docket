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
}
