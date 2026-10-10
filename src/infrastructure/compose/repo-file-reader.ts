// The RepoFileReader port over the real filesystem: text files of a registered repo's main
// checkout, for the assistant's `docket_read_file`. The path-by-path containment (realpath,
// O_NOFOLLOW, symlink refusal, size and text checks) is the worktree preview's own, reused here
// rather than rewritten; on top of it this adapter refuses secret-bearing names on the requested
// path AND on the path a symlink resolves to, slices by line and byte budget, and redacts what it
// hands out.
import { realpath } from 'node:fs/promises';
import { relative, sep } from 'node:path';

import { isSecretRepoPath, type RepoFileError, type RepoFileReader, type WorktreeFiles } from '../../application/index';
import { err, ok, validatePagePath, type RepoSlug } from '../../domain/index';
import { createWorktreeFiles } from '../vcs/index';

export interface RepoFileReaderConfig {
  /** The registered main checkout of a repo; undefined for a repo that is not registered. */
  readonly repoPath: (repo: RepoSlug) => Promise<string | undefined>;
  /** Applied to every line handed out (the evidence redaction, wired by the composition root). */
  readonly redact: (text: string) => string;
  /** The containment logic; the worktree preview's by default. */
  readonly files?: WorktreeFiles;
}

const encoder = new TextEncoder();

/** Whether the real path behind `path` is a secret-bearing name: a link with an innocent name must
 *  not smuggle `.env` or `.git/config` out. A path that cannot be resolved is left to the read. */
const resolvesToSecret = async (root: string, path: string): Promise<boolean> => {
  try {
    const realRoot = await realpath(root);
    const realTarget = await realpath(`${root}${sep}${path}`);
    const inside = relative(realRoot, realTarget);
    return !inside.startsWith('..') && isSecretRepoPath(inside);
  } catch {
    return false;
  }
};

export function createRepoFileReader(config: RepoFileReaderConfig): RepoFileReader {
  const files = config.files ?? createWorktreeFiles();
  return {
    read: async (repo, path, options) => {
      const root = await config.repoPath(repo);
      if (root === undefined) return err<RepoFileError>('repo_unknown');
      // The page-path rules refuse traversal, absolute and drive paths, backslashes, `%`, NUL and
      // format characters before the filesystem is touched.
      if (!validatePagePath(path) || isSecretRepoPath(path)) return err<RepoFileError>('outside_repo');
      if (await resolvesToSecret(root, path)) return err<RepoFileError>('outside_repo');

      const read = await files.readText(root, path, Number.MAX_SAFE_INTEGER);
      if (!read.ok) {
        switch (read.error) {
          case 'outside_worktree':
            return err<RepoFileError>('outside_repo');
          default:
            return err<RepoFileError>(read.error);
        }
      }

      const all = read.value.lines;
      const start = Math.max(1, Math.floor(options.from)) - 1;
      const lines: string[] = [];
      let used = 0;
      for (let i = start; i < all.length && lines.length < options.maxLines; i += 1) {
        const line = all[i] ?? '';
        used += encoder.encode(line).length + 1;
        // At least one line is always returned, so a single long line can still be paged past.
        if (used > options.maxBytes && lines.length > 0) break;
        lines.push(line);
      }
      const end = start + lines.length;
      const slice = lines.map((line) => config.redact(line));
      return end < all.length ? ok({ lines: slice, truncated: true, nextFrom: end + 1 }) : ok({ lines: slice, truncated: false });
    },
  };
}
