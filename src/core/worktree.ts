// src/core/worktree.ts — the worktree automation's PURE half (WO-0093). The convention is the
// contract: one derived branch + one derived path per work order, under the app home — never a
// stored value (the order's frozen decision: "the worktree is disposable state, never the
// record"). The adapter (src/adapters/worktree.ts) runs git through this naming; the store
// derives the view-time path from it. Pure: no Node, no I/O — the caller joins paths.
//
// Naming (ADR-0017's convention, the branch the agent inherits): `wo-NNNN-<slug>`, lowercase —
// the same words the order document's dir carries (`WO-NNNN-<slug>`), lowercased for git.
// Path: `<appHome>/worktrees/<workspaceId>/<wo-NNNN>-<slug>` — appHome is DOCKET_DB_PATH's
// directory (the WO-0075 home rule: `~/.docket`, never process.cwd()).

/** The branch AND directory name for a work order's working copy: `wo-0093-<slug>`. */
export function worktreeName(woId: string, slug: string): string {
  return `${woId.toLowerCase()}-${slug}`;
}

/** The derived working-copy path under the app home. Path segments are joined with `/` (core
 *  imports no Node path module — the same string discipline as `isUnder`). */
export function worktreePathUnder(appHome: string, workspaceId: string, woId: string, slug: string): string {
  return `${appHome}/worktrees/${workspaceId}/${worktreeName(woId, slug)}`;
}
