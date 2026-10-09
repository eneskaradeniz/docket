import { open, realpath, stat } from 'node:fs/promises';
import { isAbsolute, resolve, sep } from 'node:path';

import { err, ok, type Result } from '../../domain/index';
import type { WorktreeFileEntry, WorktreeFileError, WorktreeFilePreview, WorktreeFiles } from '../../application/index';
import { runGit } from './git';

const MAX_SIZE = 256 * 1024;

export function createWorktreeFiles(): WorktreeFiles {
  return {
    async listChanged(worktreePath: string): Promise<readonly WorktreeFileEntry[]> {
      const inside = await runGit(worktreePath, ['rev-parse', '--is-inside-work-tree']);
      if (inside.exitCode !== 0 || inside.stdout.trim() !== 'true') {
        throw new Error('not a git work tree');
      }

      const changed = await runGit(worktreePath, ['diff', '--name-only', '--diff-filter=ACMR', 'HEAD']);
      if (changed.exitCode !== 0) throw new Error(`git diff failed: ${changed.stderr}`);
      const untracked = await runGit(worktreePath, ['ls-files', '--others', '--exclude-standard']);
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
          const s = await stat(resolve(worktreePath, p));
          if (s.isFile()) {
            entries.push({ path: p, sizeBytes: s.size });
          }
        } catch {
          // ignore stat errors
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
      } catch (e: any) {
        if (e.code === 'ENOENT') return err('not_found');
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
      // if file is empty string, split returns [''] which is 1 line. Wait:
      // "a trailing newline ends the last line, it does not start an empty one"
      // So if text is empty, it returns ['']. Is that correct? Let's check text === ''
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
