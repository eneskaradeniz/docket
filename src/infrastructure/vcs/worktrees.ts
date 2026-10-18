// Git worktree management for runs: one worktree per (repo, work order) under the data dir.
import { mkdir, realpath } from 'node:fs/promises';
import { dirname, join } from 'node:path';

import type { LocalMergeError, Worktrees } from '../../application/index';
import { err, ok, workOrderBranch, type Result, type WorkOrderId } from '../../domain/index';
import type { RepoPaths } from '../system/index';
import { branchHead as headOf, runGit } from './git';

export interface WorktreesConfig {
  readonly root: string; // root = <dataDir>/worktrees
  readonly repos: RepoPaths;
}

// The merge commit of a local merge carries the same Docket identity the checkpoints do; no
// user identity or signing setup is ever required of the checkout.
const MERGE_IDENTITY_ARGS = ['-c', 'user.name=Docket', '-c', 'user.email=checkpoints@docket.local', '-c', 'commit.gpgsign=false'] as const;

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

/** The domain owns the one naming rule; this is the worktree-side spelling of it. */
export function worktreeBranch(id: WorkOrderId): string {
  return workOrderBranch(id);
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
    async existing(repo, id): Promise<{ readonly path: string } | undefined> {
      const checkout = await config.repos.path(repo);
      if (checkout === undefined) return undefined;
      const path = join(config.root, repo, id);
      // A listed worktree is the only proof one exists. Creating it is `ensure`'s job.
      if (!(await isListed(checkout, path))) return undefined;
      return { path };
    },

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

    async branchHead(repo, id) {
      const checkout = await config.repos.path(repo);
      if (checkout === undefined) return err('no_repo');
      const head = await headOf(checkout, workOrderBranch(id));
      return head === undefined ? err('no_branch') : ok(head);
    },

    async release(repo, id) {
      const checkout = await config.repos.path(repo);
      if (checkout === undefined) return err('no_repo');

      const path = join(config.root, repo, id);
      // An unlisted worktree is already gone from git's books; only the branch may remain.
      if (await isListed(checkout, path)) {
        const removed = await runGit(checkout, ['worktree', 'remove', path]);
        if (removed.exitCode !== 0) return err('git_failed');
      }

      // `-d`, never `-D`: an unmerged branch is a typed refusal, not data loss. The BASE ref is
      // never touched, so the commit the worktree started from stays reachable either way.
      // Commands run under LC_ALL=C, so the refusal message is the one matched here.
      const deleted = await runGit(checkout, ['branch', '-d', workOrderBranch(id)]);
      if (deleted.exitCode === 0) return ok('released');
      if (deleted.stderr.includes('not fully merged')) return ok('branch_not_merged');
      return err('git_failed');
    },

    async checkedOutBranch(repo) {
      const checkout = await config.repos.path(repo);
      if (checkout === undefined) return err('no_repo');
      const current = await runGit(checkout, ['symbolic-ref', '--short', '-q', 'HEAD']);
      const name = current.stdout.trim();
      return current.exitCode === 0 && name !== '' ? ok(name) : err('base_not_checked_out');
    },

    async mergeLocal(repo, id, base): Promise<Result<void, LocalMergeError>> {
      const checkout = await config.repos.path(repo);
      if (checkout === undefined) return err('no_repo');

      // Every refusal below happens before git touches the checkout: the base is the branch the
      // operator saw checked out, the tree has no tracked change a merge could tangle with.
      const branch = workOrderBranch(id);
      if ((await headOf(checkout, branch)) === undefined) return err('no_branch');
      const current = await runGit(checkout, ['symbolic-ref', '--short', '-q', 'HEAD']);
      if (current.exitCode !== 0 || current.stdout.trim() !== base) return err('base_not_checked_out');
      // Untracked files are not "dirty" here: a merge only trips over one it would overwrite, and
      // that case fails below as a plain git_failed with the tree untouched.
      const status = await runGit(checkout, ['status', '--porcelain', '--untracked-files=no']);
      if (status.exitCode !== 0) return err('git_failed');
      if (status.stdout.trim() !== '') return err('dirty_checkout');

      const merged = await runGit(checkout, [...MERGE_IDENTITY_ARGS, 'merge', '--no-edit', branch]);
      if (merged.exitCode === 0) return ok(undefined);
      // A merge stopped half way leaves MERGE_HEAD behind; that is the conflict signature.
      const midMerge = await runGit(checkout, ['rev-parse', '-q', '--verify', 'MERGE_HEAD']);
      if (midMerge.exitCode !== 0) return err('git_failed');
      const aborted = await runGit(checkout, ['merge', '--abort']);
      return aborted.exitCode === 0 ? err('conflict') : err('git_failed');
    },
  };
}
