import { lstat, open, realpath, stat } from 'node:fs/promises';
import { isAbsolute, resolve, sep } from 'node:path';

import { err, ok, type Result } from '../../domain/index';
import type { WorktreeFileEntry, WorktreeFileError, WorktreeFilePreview, WorktreeFiles } from '../../application/index';
import { runGit } from './git';

const MAX_SIZE = 256 * 1024;

// fs rejections are plain objects carrying a string errno `code`; narrow instead of assuming a type.
function hasErrnoCode(e: unknown, code: string): boolean {
  return typeof e === 'object' && e !== null && 'code' in e && e.code === code;
}

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
      const segments = relativePath.split(/[/\\]/);
      if (segments.includes('..') || isAbsolute(relativePath)) {
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
      } catch (e: unknown) {
        if (hasErrnoCode(e, 'ENOENT')) return err('not_found');
        throw e;
      }

      if (!realTarget.startsWith(realWorktree + sep)) {
        return err('outside_worktree');
      }

      let s;
      try {
        s = await stat(realTarget);
      } catch {
        return err('not_found');
      }
      if (!s.isFile()) return err('not_found');

      if (s.size > MAX_SIZE) return err('too_large');

      let buffer: Buffer;
      try {
        const handle = await open(realTarget, 'r');
        try {
          buffer = await handle.readFile();
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
