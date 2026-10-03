// Git worktree management for runs: one worktree per (repo, work order) under the data dir.
import { mkdir, realpath } from 'node:fs/promises';
import { dirname, join } from 'node:path';

import type { Worktrees } from '../../application/index';
import { err, ok, type Result, type WorkOrderId } from '../../domain/index';
import type { RepoPaths } from '../system/index';
import { runGit } from './git';

export interface WorktreesConfig {
  readonly root: string; // root = <dataDir>/worktrees
  readonly repos: RepoPaths;
}

// + work-order id -> the commit the worktree started from
export const BASE_REF_PREFIX = 'refs/docket/bases/';

type EnsureResult = Result<{ readonly path: string }, 'no_repo'>;

// git registers worktrees by their real path; the caller's path may ride a symlinked prefix
// (macOS /var -> /private/var), so both sides are resolved before comparing.
async function resolvedPath(path: string): Promise<string> {
  try {
    return await realpath(path);
  } catch {
    return path; // not on disk (yet): the literal path decides
  }
}

export function worktreeBranch(id: WorkOrderId): string {
  return 'docket/wo-' + id.toLowerCase();
}

export function createWorktrees(config: WorktreesConfig): Worktrees {
  // One shared creation per (repo, id): concurrent ensure calls must not race
  // `git worktree add` against each other.
  const creating = new Map<string, Promise<EnsureResult>>();

  async function isListed(checkout: string, path: string): Promise<boolean> {
    const list = await runGit(checkout, ['worktree', 'list', '--porcelain']);
    if (list.exitCode !== 0) return false;
    const target = await resolvedPath(path);
    for (const line of list.stdout.split('\n')) {
      if (!line.startsWith('worktree ')) continue;
      if ((await resolvedPath(line.slice('worktree '.length))) === target) return true;
    }
    return false;
  }

  async function createWorktree(
    checkout: string,
    path: string,
    id: WorkOrderId,
    base: string,
  ): Promise<EnsureResult> {
    await mkdir(dirname(path), { recursive: true });

    const branch = worktreeBranch(id);
    const branchExists = await runGit(checkout, ['rev-parse', '--verify', '--quiet', `refs/heads/${branch}`]);
    // `-b` refuses an existing branch; attaching to it keeps a re-ensure working after the
    // worktree directory disappeared while the branch was kept.
    const args =
      branchExists.exitCode === 0
        ? ['worktree', 'add', path, branch]
        : ['worktree', 'add', '-b', branch, path, base];
    const added = await runGit(checkout, args);
    if (added.exitCode !== 0) throw new Error(`git worktree add failed (exit ${added.exitCode})`);

    const baseRef = `${BASE_REF_PREFIX}${id}`;
    const refExists = await runGit(checkout, ['rev-parse', '--verify', '--quiet', baseRef]);
    // The first creation fixes the base; a later one must not move it.
    if (refExists.exitCode !== 0) {
      const updated = await runGit(checkout, ['update-ref', baseRef, base]);
      if (updated.exitCode !== 0) throw new Error(`git update-ref failed (exit ${updated.exitCode})`);
    }
    return ok({ path });
  }

  return {
    async ensure(repo, id): Promise<EnsureResult> {
      const checkout = await config.repos.path(repo);
      if (checkout === undefined) return err('no_repo');

      // Fails on a non-repo path and on an unborn HEAD alike: neither can anchor a worktree.
      const head = await runGit(checkout, ['rev-parse', 'HEAD']);
      if (head.exitCode !== 0) return err('no_repo');
      const base = head.stdout.trim();

      const path = join(config.root, repo, id);
      if (await isListed(checkout, path)) return ok({ path });

      const key = `${repo}/${id}`;
      const inFlight = creating.get(key);
      if (inFlight !== undefined) return inFlight;
      const creation = (async (): Promise<EnsureResult> => {
        try {
          return await createWorktree(checkout, path, id, base);
        } finally {
          creating.delete(key);
        }
      })();
      creating.set(key, creation);
      return creation;
    },
  };
}
