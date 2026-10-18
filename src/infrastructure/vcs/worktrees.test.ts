// Tests for createWorktrees / worktreeBranch (rule I-20). Every fixture is a throw-away git repo
// in an fs.mkdtemp folder; HOME is redirected so no test reads or writes the user's git config.
import { mkdtemp, realpath, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { parseSlug, parseUlid, type WorkOrderId } from '../../domain/index';
import type { RepoPaths } from '../system/index';
import { runGit } from './git';
import { BASE_REF_PREFIX, createWorktrees, worktreeBranch } from './worktrees';

const U1 = '01ARZ3NDEKTSV4RRFFQ69G5FAV';
const U2 = '01ARZ3NDEKTSV4RRFFQ69G5FAW';

const woId = (s: string): WorkOrderId => {
  const parsed = parseUlid<'work-order'>(s);
  if (!parsed.ok) throw new Error('fixture ulid must parse');
  return parsed.value;
};

const ACME = (() => {
  const parsed = parseSlug<'repo'>('acme');
  if (!parsed.ok) throw new Error('fixture slug must parse');
  return parsed.value;
})();
const OTHER = (() => {
  const parsed = parseSlug<'repo'>('other');
  if (!parsed.ok) throw new Error('fixture slug must parse');
  return parsed.value;
})();

// Environment keys these tests overwrite; every test gets its original value back.
const ENV_KEYS = ['PATH', 'HOME'] as const;

let repoDir = '';
let otherRepoDir = '';
let rootDir = '';
let homeDir = '';
let savedEnv: Map<string, string | undefined>;

beforeEach(async () => {
  repoDir = await mkdtemp(join(tmpdir(), 'docket-wt-repo-'));
  otherRepoDir = await mkdtemp(join(tmpdir(), 'docket-wt-other-'));
  rootDir = await mkdtemp(join(tmpdir(), 'docket-wt-root-'));
  homeDir = await mkdtemp(join(tmpdir(), 'docket-wt-home-'));
  savedEnv = new Map(ENV_KEYS.map((key) => [key, process.env[key]]));
  process.env.HOME = homeDir;
});

afterEach(async () => {
  for (const [key, value] of savedEnv) {
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
  await rm(repoDir, { recursive: true, force: true });
  await rm(otherRepoDir, { recursive: true, force: true });
  await rm(rootDir, { recursive: true, force: true });
  await rm(homeDir, { recursive: true, force: true });
});

async function git(cwd: string, args: readonly string[]): Promise<string> {
  const result = await runGit(cwd, args);
  if (result.exitCode !== 0) throw new Error(`fixture git failed (exit ${result.exitCode}): ${args.join(' ')}`);
  return result.stdout;
}

async function initRepo(cwd: string): Promise<void> {
  await git(cwd, ['init', '-b', 'main']);
}

async function commitFile(cwd: string, name: string, content: string): Promise<string> {
  await writeFile(join(cwd, name), content, 'utf8');
  await git(cwd, ['add', name]);
  await git(cwd, ['-c', 'user.name=t', '-c', 'user.email=t@t', 'commit', '-m', `add ${name}`]);
  return (await git(cwd, ['rev-parse', 'HEAD'])).trim();
}

async function listedWorktrees(cwd: string): Promise<readonly string[]> {
  const out = await git(cwd, ['worktree', 'list', '--porcelain']);
  return out
    .split('\n')
    .filter((line) => line.startsWith('worktree '))
    .map((line) => line.slice('worktree '.length));
}

// git registers worktrees by their real path; the caller's path may ride a symlinked prefix.
async function realIfExists(path: string): Promise<string> {
  try {
    return await realpath(path);
  } catch {
    return path;
  }
}

const pathsOf = (paths: Record<string, string>): RepoPaths => ({
  path: async (slug) => paths[slug],
});

const worktreeOf = (id: string, repo = 'acme'): string => join(rootDir, repo, id);

describe('createWorktrees', () => {
  describe('ensure', () => {
    it('I-20: an unknown repo errs with no_repo', async () => {
      const worktrees = createWorktrees({ root: rootDir, repos: pathsOf({}) });

      const result = await worktrees.ensure(ACME, woId(U1));

      expect(result).toEqual({ ok: false, error: 'no_repo' });
    });

    it('I-20: a repo path that is not a git work tree errs with no_repo', async () => {
      // repoDir exists but was never git-init'ed.
      const worktrees = createWorktrees({ root: rootDir, repos: pathsOf({ acme: repoDir }) });

      const result = await worktrees.ensure(ACME, woId(U1));

      expect(result).toEqual({ ok: false, error: 'no_repo' });
    });

    it('I-20: a repository without commits errs with no_repo', async () => {
      await initRepo(repoDir);
      const worktrees = createWorktrees({ root: rootDir, repos: pathsOf({ acme: repoDir }) });

      const result = await worktrees.ensure(ACME, woId(U1));

      expect(result).toEqual({ ok: false, error: 'no_repo' });
    });

    it('I-20: creates the worktree at <root>/<repo>/<id>, on its own branch at the checkout HEAD', async () => {
      await initRepo(repoDir);
      const base = await commitFile(repoDir, 'a.ts', 'l1\n');
      const worktrees = createWorktrees({ root: rootDir, repos: pathsOf({ acme: repoDir }) });
      const id = woId(U1);

      const result = await worktrees.ensure(ACME, id);

      expect(result).toEqual({ ok: true, value: { path: worktreeOf(U1) } });
      expect((await git(worktreeOf(U1), ['rev-parse', '--abbrev-ref', 'HEAD'])).trim()).toBe(worktreeBranch(id));
      expect((await git(worktreeOf(U1), ['rev-parse', 'HEAD'])).trim()).toBe(base);
    });

    it('I-20: records the starting commit under the base ref for the work order', async () => {
      await initRepo(repoDir);
      const base = await commitFile(repoDir, 'a.ts', 'l1\n');
      const worktrees = createWorktrees({ root: rootDir, repos: pathsOf({ acme: repoDir }) });
      await worktrees.ensure(ACME, woId(U1));

      const ref = await git(repoDir, ['rev-parse', `${BASE_REF_PREFIX}${U1}`]);

      expect(ref.trim()).toBe(base);
    });

    it('I-20: keeps an existing base ref instead of moving it to the new HEAD', async () => {
      await initRepo(repoDir);
      const first = await commitFile(repoDir, 'a.ts', 'l1\n');
      await git(repoDir, ['update-ref', `${BASE_REF_PREFIX}${U1}`, first]);
      const second = await commitFile(repoDir, 'b.ts', 'l2\n');
      const worktrees = createWorktrees({ root: rootDir, repos: pathsOf({ acme: repoDir }) });

      const result = await worktrees.ensure(ACME, woId(U1));

      expect(result).toEqual({ ok: true, value: { path: worktreeOf(U1) } });
      expect((await git(repoDir, ['rev-parse', `${BASE_REF_PREFIX}${U1}`])).trim()).toBe(first);
      expect((await git(worktreeOf(U1), ['rev-parse', 'HEAD'])).trim()).toBe(second);
    });

    it('I-20: attaches the worktree to an already existing branch instead of creating it', async () => {
      await initRepo(repoDir);
      const base = await commitFile(repoDir, 'a.ts', 'l1\n');
      const id = woId(U1);
      // `git worktree add -b` refuses an existing branch, so this can only pass without -b.
      await git(repoDir, ['branch', worktreeBranch(id)]);
      const worktrees = createWorktrees({ root: rootDir, repos: pathsOf({ acme: repoDir }) });

      const result = await worktrees.ensure(ACME, id);

      expect(result).toEqual({ ok: true, value: { path: worktreeOf(U1) } });
      expect((await git(worktreeOf(U1), ['rev-parse', '--abbrev-ref', 'HEAD'])).trim()).toBe(worktreeBranch(id));
      expect((await git(worktreeOf(U1), ['rev-parse', 'HEAD'])).trim()).toBe(base);
    });

    it('I-20: a second ensure returns the same path and changes nothing', async () => {
      await initRepo(repoDir);
      await commitFile(repoDir, 'a.ts', 'l1\n');
      const worktrees = createWorktrees({ root: rootDir, repos: pathsOf({ acme: repoDir }) });
      const first = await worktrees.ensure(ACME, woId(U1));
      const before = {
        worktrees: await listedWorktrees(repoDir),
        refs: await git(repoDir, ['for-each-ref', '--format=%(refname) %(objectname)']),
      };

      const second = await worktrees.ensure(ACME, woId(U1));

      expect(second).toEqual(first);
      expect(await listedWorktrees(repoDir)).toEqual(before.worktrees);
      expect(await git(repoDir, ['for-each-ref', '--format=%(refname) %(objectname)'])).toBe(before.refs);
    });

    it('I-20: two concurrent ensure calls share one creation', async () => {
      await initRepo(repoDir);
      await commitFile(repoDir, 'a.ts', 'l1\n');
      const worktrees = createWorktrees({ root: rootDir, repos: pathsOf({ acme: repoDir }) });
      const id = woId(U1);

      const [a, b] = await Promise.all([worktrees.ensure(ACME, id), worktrees.ensure(ACME, id)]);

      expect(a).toEqual({ ok: true, value: { path: worktreeOf(U1) } });
      expect(b).toEqual(a);
      const real = await realpath(worktreeOf(U1));
      const listed = await Promise.all((await listedWorktrees(repoDir)).map(realIfExists));
      expect(listed.filter((path) => path === real).length).toBe(1);
    });

    it('I-20: distinct work orders get distinct paths, branches and base refs', async () => {
      await initRepo(repoDir);
      await commitFile(repoDir, 'a.ts', 'l1\n');
      const worktrees = createWorktrees({ root: rootDir, repos: pathsOf({ acme: repoDir }) });

      const r1 = await worktrees.ensure(ACME, woId(U1));
      const r2 = await worktrees.ensure(ACME, woId(U2));

      expect(r1).toEqual({ ok: true, value: { path: worktreeOf(U1) } });
      expect(r2).toEqual({ ok: true, value: { path: worktreeOf(U2) } });
      const refs = (await git(repoDir, ['for-each-ref', '--format=%(refname)', `${BASE_REF_PREFIX}`]))
        .split('\n')
        .map((line) => line.trim())
        .filter((line) => line.length > 0)
        .sort();
      expect(refs).toEqual([`${BASE_REF_PREFIX}${U1}`, `${BASE_REF_PREFIX}${U2}`].sort());
    });

    it('I-20: the same work order in two repos creates two worktrees in two repos', async () => {
      await initRepo(repoDir);
      await initRepo(otherRepoDir);
      await commitFile(repoDir, 'a.ts', 'l1\n');
      await commitFile(otherRepoDir, 'a.ts', 'l1\n');
      const worktrees = createWorktrees({
        root: rootDir,
        repos: pathsOf({ acme: repoDir, other: otherRepoDir }),
      });
      const id = woId(U1);

      const inAcme = await worktrees.ensure(ACME, id);
      const inOther = await worktrees.ensure(OTHER, id);

      expect(inAcme).toEqual({ ok: true, value: { path: worktreeOf(U1, 'acme') } });
      expect(inOther).toEqual({ ok: true, value: { path: worktreeOf(U1, 'other') } });
      expect((await git(worktreeOf(U1, 'acme'), ['rev-parse', 'HEAD'])).trim()).toBe(
        (await git(repoDir, ['rev-parse', 'HEAD'])).trim(),
      );
      expect((await git(worktreeOf(U1, 'other'), ['rev-parse', 'HEAD'])).trim()).toBe(
        (await git(otherRepoDir, ['rev-parse', 'HEAD'])).trim(),
      );
    });

    it('I-20: the repo checkout working tree and branch stay untouched', async () => {
      await initRepo(repoDir);
      const head = await commitFile(repoDir, 'a.ts', 'l1\n');
      await writeFile(join(repoDir, 'uncommitted.txt'), 'scratch\n', 'utf8');
      const worktrees = createWorktrees({ root: rootDir, repos: pathsOf({ acme: repoDir }) });

      await worktrees.ensure(ACME, woId(U1));
      await worktrees.ensure(ACME, woId(U2));

      const status = await git(repoDir, ['status', '--porcelain']);
      expect(status.trim().split('\n')).toEqual(['?? uncommitted.txt']);
      expect((await git(repoDir, ['rev-parse', '--abbrev-ref', 'HEAD'])).trim()).toBe('main');
      expect((await git(repoDir, ['rev-parse', 'HEAD'])).trim()).toBe(head);
    });
  });

  describe('existing', () => {
    it('returns the path only after the worktree is listed, and listing it creates nothing', async () => {
      await initRepo(repoDir);
      await commitFile(repoDir, 'a.ts', 'l1\n');
      const worktrees = createWorktrees({ root: rootDir, repos: pathsOf({ acme: repoDir }) });
      const before = await listedWorktrees(repoDir);

      expect(await worktrees.existing(ACME, woId(U1))).toBeUndefined();
      expect(await listedWorktrees(repoDir)).toEqual(before);

      await worktrees.ensure(ACME, woId(U1));

      expect(await worktrees.existing(ACME, woId(U1))).toEqual({ path: worktreeOf(U1) });
    });
  });

  describe('branchHead', () => {
    it('I-105: answers the work order branch head, and no_branch once the branch is gone', async () => {
      await initRepo(repoDir);
      const base = await commitFile(repoDir, 'a.ts', 'l1\n');
      const worktrees = createWorktrees({ root: rootDir, repos: pathsOf({ acme: repoDir }) });
      await worktrees.ensure(ACME, woId(U1));
      await commitFile(worktreeOf(U1), 'w.ts', 'work\n');
      const head = (await git(worktreeOf(U1), ['rev-parse', 'HEAD'])).trim();
      expect(head).not.toBe(base); // the worktree really moved past the base

      expect(await worktrees.branchHead(ACME, woId(U1))).toEqual({ ok: true, value: head });

      // The branch is checked out in the worktree, so it can only disappear once that is gone.
      await git(repoDir, ['worktree', 'remove', worktreeOf(U1)]);
      await git(repoDir, ['branch', '-D', worktreeBranch(woId(U1))]);
      expect(await worktrees.branchHead(ACME, woId(U1))).toEqual({ ok: false, error: 'no_branch' });
    });

    it('I-105: an unknown repo errs with no_repo', async () => {
      const worktrees = createWorktrees({ root: rootDir, repos: pathsOf({}) });
      expect(await worktrees.branchHead(ACME, woId(U1))).toEqual({ ok: false, error: 'no_repo' });
    });
  });

  describe('release', () => {
    it('I-105: removes the worktree, deletes the branch with -d, keeps the base ref', async () => {
      await initRepo(repoDir);
      const base = await commitFile(repoDir, 'a.ts', 'l1\n');
      const worktrees = createWorktrees({ root: rootDir, repos: pathsOf({ acme: repoDir }) });
      const id = woId(U1);
      await worktrees.ensure(ACME, id);
      await commitFile(worktreeOf(U1), 'w.ts', 'work\n');
      // The branch must be merged for -d to let it go: the human step has happened.
      await git(repoDir, ['merge', worktreeBranch(id)]);

      const result = await worktrees.release(ACME, id);

      expect(result).toEqual({ ok: true, value: 'released' });
      const listed = await listedWorktrees(repoDir);
      expect(listed.map((path) => path)).not.toContain(await realIfExists(worktreeOf(U1)));
      const branch = await runGit(repoDir, ['rev-parse', '--verify', '--quiet', `refs/heads/${worktreeBranch(id)}`]);
      expect(branch.exitCode).not.toBe(0);
      expect((await git(repoDir, ['rev-parse', `${BASE_REF_PREFIX}${U1}`])).trim()).toBe(base);
    });

    it('I-105: an unmerged branch answers branch_not_merged and the branch survives', async () => {
      await initRepo(repoDir);
      await commitFile(repoDir, 'a.ts', 'l1\n');
      const worktrees = createWorktrees({ root: rootDir, repos: pathsOf({ acme: repoDir }) });
      const id = woId(U1);
      await worktrees.ensure(ACME, id);
      const head = await commitFile(worktreeOf(U1), 'w.ts', 'work\n'); // never merged

      const result = await worktrees.release(ACME, id);

      expect(result).toEqual({ ok: true, value: 'branch_not_merged' });
      expect((await git(repoDir, ['rev-parse', `refs/heads/${worktreeBranch(id)}`])).trim()).toBe(head);
    });

    it('I-105: a worktree that refuses removal (a dirty tree) errs with git_failed', async () => {
      await initRepo(repoDir);
      await commitFile(repoDir, 'a.ts', 'l1\n');
      const worktrees = createWorktrees({ root: rootDir, repos: pathsOf({ acme: repoDir }) });
      const id = woId(U1);
      await worktrees.ensure(ACME, id);
      await writeFile(join(worktreeOf(U1), 'dirty.ts'), 'uncommitted\n', 'utf8');

      const result = await worktrees.release(ACME, id);

      expect(result).toEqual({ ok: false, error: 'git_failed' });
      expect((await listedWorktrees(repoDir)).length).toBe(2); // checkout and the worktree remain
    });

    it('I-105: an unknown repo errs with no_repo', async () => {
      const worktrees = createWorktrees({ root: rootDir, repos: pathsOf({}) });
      expect(await worktrees.release(ACME, woId(U1))).toEqual({ ok: false, error: 'no_repo' });
    });
  });

  describe('mergeLocal', () => {
    const ready = async (): Promise<{ worktrees: ReturnType<typeof createWorktrees>; id: WorkOrderId }> => {
      await initRepo(repoDir);
      await commitFile(repoDir, 'a.ts', 'l1\n');
      const worktrees = createWorktrees({ root: rootDir, repos: pathsOf({ acme: repoDir }) });
      const id = woId(U1);
      await worktrees.ensure(ACME, id);
      return { worktrees, id };
    };

    it('I-115: checkedOutBranch answers the branch the checkout stands on, and base_not_checked_out when HEAD is detached', async () => {
      const { worktrees } = await ready();
      expect(await worktrees.checkedOutBranch(ACME)).toEqual({ ok: true, value: 'main' });
      await git(repoDir, ['checkout', '--detach']);
      expect(await worktrees.checkedOutBranch(ACME)).toEqual({ ok: false, error: 'base_not_checked_out' });
      expect(await createWorktrees({ root: rootDir, repos: pathsOf({}) }).checkedOutBranch(ACME)).toEqual({ ok: false, error: 'no_repo' });
    });

    it('I-115: a clean merge brings the work into the base, keeps the branch and leaves the tree clean', async () => {
      const { worktrees, id } = await ready();
      const head = await commitFile(worktreeOf(U1), 'w.ts', 'work\n');

      const result = await worktrees.mergeLocal(ACME, id, 'main');

      expect(result).toEqual({ ok: true, value: undefined });
      const contained = await runGit(repoDir, ['merge-base', '--is-ancestor', head, 'main']);
      expect(contained.exitCode).toBe(0);
      expect(await git(repoDir, ['show', 'main:w.ts'])).toBe('work\n');
      expect((await git(repoDir, ['rev-parse', `refs/heads/${worktreeBranch(id)}`])).trim()).toBe(head);
      expect(await git(repoDir, ['status', '--porcelain'])).toBe('');
      // The merged branch can now be released with -d.
      expect(await worktrees.release(ACME, id)).toEqual({ ok: true, value: 'released' });
    });

    it('I-115: a diverged base merges with a Docket-authored merge commit even without any git identity', async () => {
      const { worktrees, id } = await ready();
      await commitFile(worktreeOf(U1), 'w.ts', 'work\n');
      await commitFile(repoDir, 'b.ts', 'base moved\n');

      expect(await worktrees.mergeLocal(ACME, id, 'main')).toEqual({ ok: true, value: undefined });
      expect((await git(repoDir, ['log', '-1', '--format=%an'])).trim()).toBe('Docket');
      expect(await git(repoDir, ['show', 'main:w.ts'])).toBe('work\n');
      expect(await git(repoDir, ['show', 'main:b.ts'])).toBe('base moved\n');
      expect(await git(repoDir, ['status', '--porcelain'])).toBe('');
    });

    it('I-115: a dirty checkout answers dirty_checkout and nothing changes', async () => {
      const { worktrees, id } = await ready();
      await commitFile(worktreeOf(U1), 'w.ts', 'work\n');
      await writeFile(join(repoDir, 'a.ts'), 'edited\n', 'utf8');
      const before = (await git(repoDir, ['rev-parse', 'main'])).trim();

      expect(await worktrees.mergeLocal(ACME, id, 'main')).toEqual({ ok: false, error: 'dirty_checkout' });
      expect((await git(repoDir, ['rev-parse', 'main'])).trim()).toBe(before);
      expect(await git(repoDir, ['status', '--porcelain'])).toBe(' M a.ts\n');
    });

    it('I-115: a base that is not the checked-out branch answers base_not_checked_out', async () => {
      const { worktrees, id } = await ready();
      await commitFile(worktreeOf(U1), 'w.ts', 'work\n');
      expect(await worktrees.mergeLocal(ACME, id, 'develop')).toEqual({ ok: false, error: 'base_not_checked_out' });
      await git(repoDir, ['checkout', '--detach']);
      expect(await worktrees.mergeLocal(ACME, id, 'main')).toEqual({ ok: false, error: 'base_not_checked_out' });
    });

    it('I-115: a conflicting branch answers conflict, the merge is aborted and the tree is clean', async () => {
      const { worktrees, id } = await ready();
      await commitFile(worktreeOf(U1), 'a.ts', 'from the branch\n');
      const before = await commitFile(repoDir, 'a.ts', 'from the base\n');

      expect(await worktrees.mergeLocal(ACME, id, 'main')).toEqual({ ok: false, error: 'conflict' });
      expect(await git(repoDir, ['status', '--porcelain'])).toBe('');
      expect((await git(repoDir, ['rev-parse', 'main'])).trim()).toBe(before);
      const mergeHead = await runGit(repoDir, ['rev-parse', '-q', '--verify', 'MERGE_HEAD']);
      expect(mergeHead.exitCode).not.toBe(0);
    });

    it('I-115: a missing branch answers no_branch and an unknown repo no_repo', async () => {
      const { worktrees } = await ready();
      expect(await worktrees.mergeLocal(ACME, woId(U2), 'main')).toEqual({ ok: false, error: 'no_branch' });
      const bare = createWorktrees({ root: rootDir, repos: pathsOf({}) });
      expect(await bare.mergeLocal(ACME, woId(U1), 'main')).toEqual({ ok: false, error: 'no_repo' });
    });
  });
});

describe('worktreeBranch', () => {
  it('I-20: the branch name is docket/wo- plus the lowercased work-order id', () => {
    expect(worktreeBranch(woId(U1))).toBe(`docket/wo-${U1.toLowerCase()}`);
  });

  it('I-20: the base ref prefix is refs/docket/bases/', () => {
    expect(BASE_REF_PREFIX).toBe('refs/docket/bases/');
  });
});
