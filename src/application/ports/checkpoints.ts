// Checkpoint port (P-38 item 4) — kept narrow (the GitProbe precedent: no worktree powers leak).
// The patch is redacted at this boundary, so application and domain never see unredacted text.
import type { Result, RunId, WorkOrderId } from '../../domain/index';

export interface CheckpointRef { readonly sha: string; readonly changed: boolean }
export interface CheckpointDiff { readonly files: readonly string[]; readonly patch: string }
export type CheckpointError = 'git_failed';
export interface CheckpointCommitter {
  /** `git add -A` + commit in the worktree. A clean tree → { changed: false }, no commit. Commits
   *  are local-only (push stays with the forge flow); author/committer is the Docket checkpoint
   *  identity, never a user. */
  commit(input: { readonly cwd: string; readonly runId: RunId; readonly seq: number }): Promise<Result<CheckpointRef, CheckpointError>>;
  /** The diff since `since`. The patch is redacted through the secret patterns (the scanner's
   *  `redactSecrets`) at this boundary — application and domain never see unredacted patch text. */
  diffSince(input: { readonly cwd: string; readonly since: string }): Promise<Result<CheckpointDiff, CheckpointError>>;
  /** The commit the work order's worktree started from (refs/docket/bases/<id>). */
  base(input: { readonly cwd: string; readonly workOrderId: WorkOrderId }): Promise<Result<string, CheckpointError>>;
}
