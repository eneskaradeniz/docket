import { constants, lstat, open, realpath } from 'node:fs/promises';
import { isAbsolute, resolve, sep } from 'node:path';

import { err, ok, type Result } from '../../domain/index';
import type { WorktreeFileEntry, WorktreeFileError, WorktreeFilePreview, WorktreeFiles } from '../../application/index';
import { runGit } from './git';

const MAX_SIZE = 256 * 1024;

const splitSegments = (p: string): readonly string[] => p.split(/[/\\]/);

/** The paths a preview must never surface: repo plumbing under a `.git` segment, and `.env*`
 *  file names — environment secrets ride them. The listing drops them and a read answers
 *  `outside_worktree`, so a staged `.env` can be neither offered nor fetched. */
const isSecretPath = (segments: readonly string[]): boolean =>
  segments.includes('.git') || (segments[segments.length - 1] ?? '').startsWith('.env');

export function createWorktreeFiles(): WorktreeFiles {
  return {
    async listChanged(worktreePath: string): Promise<readonly WorktreeFileEntry[]> {
      const inside = await runGit(worktreePath, ['rev-parse', '--is-inside-work-tree']);
      if (inside.exitCode !== 0 || inside.stdout.trim() !== 'true') {
        throw new Error('not a git work tree');
      }

      // core.quotepath=off: non-ASCII paths must come back verbatim, not as quoted octal escapes.
      const changed = await runGit(worktreePath, ['-c', 'core.quotepath=off', 'diff', '--name-only', '--diff-filter=ACMR', 'HEAD']);
      if (changed.exitCode !== 0) throw new Error(`git diff failed: ${changed.stderr}`);
      const untracked = await runGit(worktreePath, ['-c', 'core.quotepath=off', 'ls-files', '--others', '--exclude-standard']);
      if (untracked.exitCode !== 0) throw new Error(`git ls-files failed: ${untracked.stderr}`);

      const paths = new Set<string>();
      for (const line of changed.stdout.split('\n')) {
        if (line.length > 0) paths.add(line);
      }
      for (const line of untracked.stdout.split('\n')) {
        if (line.length > 0) paths.add(line);
      }

      // I-39: path code-point order
      const sortedPaths = Array.from(paths).sort();
      const entries: WorktreeFileEntry[] = [];
      for (const p of sortedPaths) {
        // Secret paths never enter the listing — the preview cannot offer what it must refuse to read.
        if (isSecretPath(splitSegments(p))) continue;
        try {
          // lstat, not stat: a symlink is not a regular file, so it never enters the list —
          // a link pointing outside the worktree must not surface as a readable entry.
          const s = await lstat(resolve(worktreePath, p));
          if (s.isFile()) {
            entries.push({ path: p, sizeBytes: s.size });
          }
        } catch {
          // The path can vanish between git's listing and this stat; skip it.
        }
      }
      return entries;
    },

    async readText(worktreePath: string, relativePath: string, maxLines: number): Promise<Result<WorktreeFilePreview, WorktreeFileError>> {
      const segments = splitSegments(relativePath);
      if (segments.includes('..') || isAbsolute(relativePath)) {
        return err('outside_worktree');
      }
      // The path's shape alone refuses secret paths — I-40's order: this answers
      // `outside_worktree` even when nothing exists there.
      if (isSecretPath(segments)) {
        return err('outside_worktree');
      }

      let realWorktree: string;
      try {
        realWorktree = await realpath(worktreePath);
      } catch {
        return err('not_found');
      }

      const target = resolve(worktreePath, relativePath);
      let realTarget: string;
      try {
        realTarget = await realpath(target);
      } catch {
        // ENOENT is the honest miss; every other fs failure (ENOTDIR through a file
        // component, ELOOP on a symlink cycle) answers the same way — Node's error
        // messages carry absolute paths, and none of them may surface.
        return err('not_found');
      }

      if (!realTarget.startsWith(realWorktree + sep)) {
        return err('outside_worktree');
      }
      // The resolved path is vetted again: containment already holds, so the worktree-relative
      // segments are what remains — a symlink inside the worktree aimed at `.git` or a linked
      // `.env` must not smuggle its target past the shape check above.
      if (isSecretPath(splitSegments(realTarget.slice(realWorktree.length + sep.length)))) {
        return err('outside_worktree');
      }

      let buffer: Buffer;
      try {
        // O_NOFOLLOW re-vets the final component at open: a symlink swapped in after the
        // realpath fails with ELOOP instead of reading its target. O_NONBLOCK: a FIFO opened
        // read-only would otherwise block forever waiting for a writer; the stat below then
        // answers `not_found` because it is not a regular file.
        const handle = await open(realTarget, constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK);
        try {
          // The kind and size are read off the open descriptor itself, so they can no longer
          // describe a different file than the one the bytes come from.
          const s = await handle.stat();
          if (!s.isFile()) return err('not_found');
          if (s.size > MAX_SIZE) return err('too_large');

          // The file may grow between the stat and this read — the read is capped at MAX_SIZE
          // so nothing beyond the limit ever lands in memory.
          const cap = Buffer.alloc(MAX_SIZE);
          const { bytesRead } = await handle.read(cap, 0, MAX_SIZE, 0);
          buffer = cap.subarray(0, bytesRead);
        } finally {
          await handle.close();
        }
      } catch {
        return err('not_found');
      }

      if (buffer.includes(0)) return err('not_text');

      let text: string;
      try {
        const decoder = new TextDecoder('utf-8', { fatal: true });
        text = decoder.decode(buffer);
      } catch {
        return err('not_text');
      }

      const linesToSplit = text.endsWith('\n') ? text.slice(0, -1) : text;
      // An empty file has no lines: `split('\n')` on '' would answer [''], one phantom line.
      const allLines = linesToSplit === '' ? [] : linesToSplit.split('\n');
      const truncated = allLines.length > maxLines;
      const lines = truncated ? allLines.slice(0, maxLines) : allLines;

      return ok({
        path: relativePath,
        lines,
        truncated
      });
    }
  };
}
