// src/adapters/worktree.ts — the worktree automation's git half (WO-0093, ADR-0018's grammar:
// these fire only from the operator's OWN start/delete/close actions, never from the drive
// pipeline, never on a timer). The seam is git-console's: ONE CommandRunner, production spawns
// the real binary (gitProcessRunner), tests inject observed shapes. Exit !== 0 is the universal
// degraded signal — the carried stderr line (or the spawn failure's message) is the reason,
// displayable verbatim on the refusal card. Nothing here ever throws: every failure is a value,
// so a prep/removal failure can degrade honest without a half state.
import { existsSync as fsExistsSync, realpathSync as fsRealpathSync } from 'node:fs';
import { carriedLine, gitStatus, type CommandRunner } from './git-console';

/** One work order's derived working copy. Data only — the derivation lives in core/worktree.ts;
 *  the store resolves the facts (the connected repo, the app home) and the composition root
 *  runs the hand here. */
export interface WorktreeSpec {
  /** The connected repo the copy branches from — `git -C` target for every call. */
  repoPath: string;
  /** The derived copy path (the convention; never stored). */
  path: string;
  /** `wo-NNNN-<slug>` — created WITH the worktree (one `git worktree add -b`). */
  branch: string;
  /** The base ref: 'main', fresh at start time (the wave discipline). */
  base: string;
}

/** The filesystem half, injectable (db-path.ts's PathIo pattern). */
export interface WorktreeIo {
  existsSync: (path: string) => boolean;
  /** git LIST worktrees by their REAL path (symlinks resolved — on macOS /var is /private/var);
   *  the spec's path must be resolved the same way before the compare, or an already-prepared
   *  copy reads as unregistered and the resume refuses. */
  realpathSync: (path: string) => string;
}

export const worktreeIo: WorktreeIo = { existsSync: fsExistsSync, realpathSync: fsRealpathSync };

export type PrepareResult = { ok: true; prepared: boolean } | { ok: false; reason: string };
export type RemoveResult = { ok: true; removed: boolean } | { ok: false; reason: string };
export type CleanStatus = { kind: 'clean' } | { kind: 'dirty' } | { kind: 'error'; reason: string };

const listArgs = (repoPath: string): string[] => ['-C', repoPath, 'worktree', 'list', '--porcelain'];

/** Is `path` a REGISTERED worktree of `repoPath`? Reads git's own bookkeeping — a directory that
 *  merely sits on the convention's path is NOT prepared, and preparing never clobbers it. Both
 *  sides are realpath'd (git resolves the worktree root it lists; the caller's path may ride a
 *  symlinked prefix). */
async function isRegisteredWorktree(run: CommandRunner, spec: WorktreeSpec, io: WorktreeIo): Promise<boolean> {
  const r = await run(listArgs(spec.repoPath));
  if (r.exit !== 0) return false;
  let real = spec.path;
  try {
    real = io.realpathSync(spec.path);
  } catch {
    // unresolvable path — the literal compare below decides
  }
  return r.stdout
    .split('\n')
    .some((l) => l.startsWith('worktree ') && l.slice('worktree '.length).replace(/\/+$/, '') === real.replace(/\/+$/, ''));
}

/** The START click's prep (WO-0093): one `git worktree add -b <branch> <path> <base>` per start,
 *  idempotent on resume — an already-registered copy is a no-op (never a re-add, never a reset).
 *  A path collision (the convention's dir exists but git does not know it) refuses: the operator
 *  decides, never a clobber. A base missing / git absent refuses with git's own line. */
export async function prepareWorktree(spec: WorktreeSpec, run: CommandRunner, io: WorktreeIo = worktreeIo): Promise<PrepareResult> {
  if (io.existsSync(spec.path)) {
    if (await isRegisteredWorktree(run, spec, io)) return { ok: true, prepared: false };
    return { ok: false, reason: `${spec.path} exists but is not a registered worktree of ${spec.repoPath} — move it away or remove it by hand` };
  }
  const r = await run(['-C', spec.repoPath, 'worktree', 'add', '-b', spec.branch, spec.path, spec.base]);
  if (r.exit !== 0) return { ok: false, reason: carriedLine(r, `git worktree add failed (exit ${r.exit})`) };
  return { ok: true, prepared: true };
}

/** The porcelain look the close path decides on: clean removes, dirty keeps (the operator
 *  decides), and a FAILED look is the error arm — never a fake clean. */
export async function worktreeCleanStatus(run: CommandRunner, path: string): Promise<CleanStatus> {
  const s = await gitStatus(run, path);
  if (s.kind === 'error') return { kind: 'error', reason: s.error };
  return s.files.length === 0 ? { kind: 'clean' } : { kind: 'dirty' };
}

/** Remove a working copy (the delete cascade's --force; the clean close's plain remove). A
 *  missing path is already gone — ok, removed nothing (the cascade degrades up). A failed
 *  removal is the honest { ok: false, reason } — the delete/close never blocks on it. The
 *  prune after every attempt is best-effort: it only clears stale registrations. */
export async function removeWorktree(spec: WorktreeSpec, run: CommandRunner, force: boolean, io: WorktreeIo = worktreeIo): Promise<RemoveResult> {
  if (!io.existsSync(spec.path)) {
    await run(['-C', spec.repoPath, 'worktree', 'prune']); // the registration may outlive the dir
    return { ok: true, removed: false };
  }
  const r = await run(['-C', spec.repoPath, 'worktree', 'remove', ...(force ? ['--force'] : []), spec.path]);
  if (r.exit !== 0) return { ok: false, reason: carriedLine(r, `git worktree remove failed (exit ${r.exit})`) };
  await run(['-C', spec.repoPath, 'worktree', 'prune']);
  return { ok: true, removed: true };
}
