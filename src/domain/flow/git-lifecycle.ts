// flow/git-lifecycle.ts — the git lifecycle fold (R-160 … R-164, R-185). The work order's branch, pull
// request and release marks derive from the git ledger events exactly the way skippedStages
// derive from the R-133 pair: an event in an order the rules forbid is silently ignored, never an
// error and never an invented state — the writer that appended it is where the refusal belonged.
import type { EpochMs, WorkOrderId } from '../shared';
import type { WorkOrderEvent } from './events';

export interface GitBranchState {
  readonly name: string;
  readonly head: string;
  readonly pushedAt: EpochMs;
}

export interface GitPrState {
  readonly number: number;
  readonly url: string;
  readonly head: string;
  readonly base: string;
  readonly merged: boolean;
}

export interface GitLocalMergeState {
  readonly base: string;
  readonly at: EpochMs;
}

export interface GitLifecycleState {
  readonly branch?: GitBranchState;
  readonly pr?: GitPrState;
  readonly mergedLocal?: GitLocalMergeState;
  readonly released?: true;
}

/** The branch a work order's git lifecycle lives on — the one naming rule the ledger's
 *  `branch_pushed` events, the push command and the worktree port all share. */
export const workOrderBranch = (id: WorkOrderId): string => `docket/wo-${id.toLowerCase()}`;

export function deriveGitLifecycle(events: readonly WorkOrderEvent[]): GitLifecycleState {
  let branch: GitBranchState | undefined;
  let pr: GitPrState | undefined;
  let mergedLocal: GitLocalMergeState | undefined;
  let released = false;
  for (const event of events) {
    if (released) {
      // R-164: the release closed the lifecycle; every later git event is a fact about nothing.
      continue;
    }
    switch (event.type) {
      case 'branch_pushed':
        branch = { name: event.branch, head: event.head, pushedAt: event.at };
        break;
      case 'pr_opened':
        // R-160: only the branch that was pushed, under the name it was pushed as, opens a PR;
        // R-161: an open PR is not replaced by a second opening.
        if (branch !== undefined && event.head === branch.name && (pr === undefined || pr.merged)) {
          pr = { number: event.number, url: event.url, head: event.head, base: event.base, merged: false };
        }
        break;
      case 'pr_merged':
        // R-162: only the open PR's own number merges, and only while it is open.
        if (pr !== undefined && !pr.merged && event.number === pr.number) pr = { ...pr, merged: true };
        break;
      case 'branch_merged_local':
        // R-185: a forge-less merge — never over a pull request, and the first one stands.
        if (pr === undefined && mergedLocal === undefined) mergedLocal = { base: event.base, at: event.at };
        break;
      case 'branch_released':
        // R-163: the release lands on a merged PR; R-185: or on a local merge.
        if ((pr !== undefined && pr.merged) || mergedLocal !== undefined) released = true;
        break;
    }
  }
  return {
    ...(branch === undefined ? {} : { branch }),
    ...(pr === undefined ? {} : { pr }),
    ...(mergedLocal === undefined ? {} : { mergedLocal }),
    ...(released ? { released: true as const } : {}),
  };
}
