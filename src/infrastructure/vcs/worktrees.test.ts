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
});

describe('worktreeBranch', () => {
  it('I-20: the branch name is docket/wo- plus the lowercased work-order id', () => {
    expect(worktreeBranch(woId(U1))).toBe(`docket/wo-${U1.toLowerCase()}`);
  });

  it('I-20: the base ref prefix is refs/docket/bases/', () => {
    expect(BASE_REF_PREFIX).toBe('refs/docket/bases/');
  });
});
