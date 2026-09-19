// src/core/console.ts — the operator's Changes console (WO-0068, ADR-0018). The reads: one port,
// `ChangesWatch`, implemented by the composition root over git (the `woRepoPaths` jail is the
// composition root's concern). The writes are deliberately NOT here as a port — ADR-0018 decision
// 4 keeps every write surface out of core so the drive pipeline can hold no reference; what
// crosses below is only the honest result DATA the console channels carry back to the renderer.

import type { LineDiff } from './diff';
import type { WorkOrderId } from './types';

/** One changed file as git's porcelain reports it: the repo-relative path and the status letter —
 *  the first significant letter of the porcelain XY pair ('M' modified, 'A' added, 'D' deleted,
 *  'R' renamed…), or '??' for untracked. git's own vocabulary, carried verbatim. */
export interface RepoFileChange {
  path: string;
  status: string;
}

/** One connected repo's observed working-tree state — what git SAYS, never a Docket-side claim. */
export interface RepoChanges {
  /** The repo's local working-tree path — the jail's own key; every console act takes it back
   *  and the composition root re-checks it against the same list. */
  path: string;
  /** The repo's own name (the path's last segment), resolved where the look happened. */
  repo: string;
  /** The checked-out branch. ABSENT on a detached HEAD (git says `HEAD (no branch)`) — absence
   *  is absence, never a guess at a branch name. */
  branch?: string;
  /** How many commits the branch is ahead of its upstream. ABSENT with no upstream configured. */
  ahead?: number;
  /** The working-tree changes (porcelain). [] when the tree is clean. */
  files: RepoFileChange[];
  /** A failed look speaks its reason verbatim (git's stderr line) and carries NO facts — files is
   *  [] and branch/ahead stay absent. A look that did not happen never renders as a clean tree
   *  (the forge scan's degraded-meta ruling, applied to git). */
  degraded?: string;
}

/** The console's read port (WO-0068). Reads only — the write ops are NOT a core port (ADR-0018
 *  decision 4): they live as adapter-extra methods only the composition root's channels reach. */
export interface ChangesWatch {
  /** Per connected repo of the work order: branch + porcelain + ahead. [] when no repo resolves. */
  changesFor(workOrderId: WorkOrderId): Promise<RepoChanges[]>;
  /** ONE file's unified diff — the same capped LineDiff structure `diffPeek` returns (the ask-card
   *  peek's grammar). null = no look happened (the path is outside the jail), not "no changes". */
  diffFor(workOrderId: WorkOrderId, repoPath: string, file: string): Promise<LineDiff | null>;
}

// ===== The honest write results (data crossing the `docket:console:*` channels; ADR-0018) =====
//
// Every write answers ok WITH the act's own fact, or not-ok WITH the carried line — never a
// silent success (the order's stop-and-ask gate). These are shapes, not a port: no interface
// names the writes, so core cannot make the agent path one autocomplete away from them.

/** The operator's commit: ok carries the sha the repo itself reports (rev-parse HEAD). */
export type CommitResult = { ok: true; sha: string } | { ok: false; error: string };

/** The push: ok carries the branch it pushed (resolved main-side from the repo's own HEAD). */
export type PushResult = { ok: true; branch: string } | { ok: false; error: string };

/** The PR: ok carries the forge's url and the number parsed from it — the session's merge scope. */
export type CreatePrResult = { ok: true; number: number; url: string } | { ok: false; error: string };

/** The merge: ok is bare — the durable record is the scan's own observation, never a console
 *  event (the console records nothing of its own; wo_event gains NO console kinds). */
export type MergeResult = { ok: true } | { ok: false; error: string };
