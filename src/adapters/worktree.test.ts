import { describe, expect, it } from 'vitest';
import { prepareWorktree, removeWorktree, worktreeCleanStatus, type WorktreeIo, type WorktreeSpec } from './worktree';
import type { CommandResult, CommandRunner } from './git-console';

// WO-0093 — the worktree automation's git half, pinned offline against observed git shapes (the
// git-console.test.ts discipline): the CommandRunner seam is fed real `worktree list --porcelain`
// output and real stderr lines. No live git call here — the composition wiring is E2E's. The
// existsSync/realpath pair is injectable exactly like db-path.ts's PathIo.

const res = (over: Partial<CommandResult>): CommandResult => ({ exit: 0, stdout: '', stderr: '', ...over });
const SPEC: WorktreeSpec = {
  repoPath: '/src/api',
  path: '/home/op/.docket/wt/wo-0093-ornek',
  branch: 'wo-0093-ornek',
  base: 'main',
};
const NO_PATH: WorktreeIo = { existsSync: () => false, realpathSync: (p) => p };
const PATH_THERE: WorktreeIo = { existsSync: () => true, realpathSync: (p) => p };

/** A runner asserting ONE expected argv, answering `r`. */
const runOnce = (expectArgs: string[], r: CommandResult): CommandRunner => (args) => {
  expect(args).toEqual(expectArgs);
  return Promise.resolve(r);
};

const LIST_WITH = (paths: string[]): CommandResult =>
  res({ stdout: paths.map((p) => `worktree ${p}\nHEAD abc\nbranch refs/heads/main\n\n`).join('') });

describe('prepareWorktree (WO-0093)', () => {
  it('fresh: ONE `git worktree add -b <branch> <path> <base>` on the connected repo', async () => {
    const run = (args: string[]): Promise<CommandResult> => {
      if (args.includes('list')) return Promise.resolve(LIST_WITH(['/src/api']));
      expect(args).toEqual(['-C', '/src/api', 'worktree', 'add', '-b', 'wo-0093-ornek', SPEC.path, 'main']);
      return Promise.resolve(res({ stdout: `Preparing worktree (checking out 'main')\n` }));
    };
    const out = await prepareWorktree(SPEC, run, NO_PATH);
    expect(out).toEqual({ ok: true, prepared: true });
  });

  it('already prepared (resume leg): the registered list entry is a NO-OP — never a re-add', async () => {
    const calls: string[][] = [];
    const run: CommandRunner = (args) => {
      calls.push(args);
      return Promise.resolve(LIST_WITH(['/src/api', SPEC.path]));
    };
    const out = await prepareWorktree(SPEC, run, PATH_THERE);
    expect(out).toEqual({ ok: true, prepared: false });
    expect(calls.some((a) => a.includes('add'))).toBe(false);
  });

  it('the registered compare is REALPATHD — git lists the resolved root (macOS /var → /private/var)', async () => {
    // found live: the spec path rides /var/folders/... while git lists /private/var/folders/...
    // — a literal compare read an ALREADY-PREPARED copy as unregistered and the resume refused.
    const io: WorktreeIo = {
      existsSync: () => true,
      realpathSync: (p) => p.replace(/^\/var\//, '/private/var/'),
    };
    const run: CommandRunner = (args) => {
      if (args.includes('list'))
        return Promise.resolve(LIST_WITH(['/src/api', '/private/var/folders/t/worktrees/wt/wo-0093-ornek']));
      return Promise.resolve(res({}));
    };
    const spec: WorktreeSpec = { ...SPEC, path: '/var/folders/t/worktrees/wt/wo-0093-ornek' };
    const out = await prepareWorktree(spec, run, io);
    expect(out).toEqual({ ok: true, prepared: false });
  });

  it('a non-git path squatting on the convention is a REFUSAL — never clobbered', async () => {
    const run: CommandRunner = (args) => {
      if (args.includes('list')) return Promise.resolve(LIST_WITH(['/src/api']));
      return Promise.resolve(res({}));
    };
    const out = await prepareWorktree(SPEC, run, PATH_THERE);
    expect(out.ok).toBe(false);
    if (!out.ok) expect(out.reason).toContain('not a registered worktree');
  });

  it('add failure (base missing): the carried stderr line is the reason, verbatim', async () => {
    const run: CommandRunner = (args) => {
      if (args.includes('list')) return Promise.resolve(LIST_WITH(['/src/api']));
      return Promise.resolve(res({ exit: 128, stderr: 'fatal: invalid reference: main\n' }));
    };
    const out = await prepareWorktree(SPEC, run, NO_PATH);
    expect(out).toEqual({ ok: false, reason: 'fatal: invalid reference: main' });
  });

  it('git absent (spawn failure, exit 127): the failure message is the reason — never a fake ok', async () => {
    const run: CommandRunner = () => Promise.resolve(res({ exit: 127, stderr: 'spawn git ENOENT' }));
    const out = await prepareWorktree(SPEC, run, NO_PATH);
    expect(out).toEqual({ ok: false, reason: 'spawn git ENOENT' });
  });
});

describe('worktreeCleanStatus (WO-0093)', () => {
  it('an empty porcelain body is clean', async () => {
    const run = runOnce(
      ['-C', SPEC.path, '-c', 'core.quotepath=false', '--no-optional-locks', 'status', '--porcelain=v1', '-b', '--untracked-files=normal'],
      res({ stdout: '## wo-0093-ornek\n' }),
    );
    expect(await worktreeCleanStatus(run, SPEC.path)).toEqual({ kind: 'clean' });
  });

  it('an untracked file is dirty (the operator decides)', async () => {
    const run: CommandRunner = () => Promise.resolve(res({ stdout: '## wo-0093-ornek\n?? notes.md\n' }));
    expect(await worktreeCleanStatus(run, SPEC.path)).toEqual({ kind: 'dirty' });
  });

  it("a failed look is the error arm with git's line — never a fake clean", async () => {
    const run: CommandRunner = () => Promise.resolve(res({ exit: 128, stderr: 'fatal: not a git repository' }));
    expect(await worktreeCleanStatus(run, SPEC.path)).toEqual({ kind: 'error', reason: 'fatal: not a git repository' });
  });
});

describe('removeWorktree (WO-0093)', () => {
  it('clean removal: `git worktree remove <path>` + a best-effort prune', async () => {
    const calls: string[][] = [];
    const run: CommandRunner = (args) => {
      calls.push(args);
      return Promise.resolve(res({}));
    };
    const out = await removeWorktree(SPEC, run, false, PATH_THERE);
    expect(out).toEqual({ ok: true, removed: true });
    expect(calls[0]).toEqual(['-C', '/src/api', 'worktree', 'remove', SPEC.path]);
    expect(calls[1]).toEqual(['-C', '/src/api', 'worktree', 'prune']);
  });

  it('forced removal (the delete cascade) carries --force', async () => {
    const calls: string[][] = [];
    const run: CommandRunner = (args) => {
      calls.push(args);
      return Promise.resolve(res({}));
    };
    const out = await removeWorktree(SPEC, run, true, PATH_THERE);
    expect(out).toEqual({ ok: true, removed: true });
    expect(calls[0]).toEqual(['-C', '/src/api', 'worktree', 'remove', '--force', SPEC.path]);
  });

  it('a missing path is already gone: ok, removed nothing (the delete cascade degrades up)', async () => {
    const calls: string[][] = [];
    const run: CommandRunner = (args) => {
      calls.push(args);
      return Promise.resolve(res({}));
    };
    const out = await removeWorktree(SPEC, run, true, NO_PATH);
    expect(out).toEqual({ ok: true, removed: false });
    expect(calls.some((a) => a.includes('remove'))).toBe(false);
  });

  it('a removal failure is the honest { ok: false, reason } — never a throw', async () => {
    const run: CommandRunner = () =>
      Promise.resolve(res({ exit: 1, stderr: 'fatal: contains modified or untracked files' }));
    const out = await removeWorktree(SPEC, run, false, PATH_THERE);
    expect(out).toEqual({ ok: false, reason: 'fatal: contains modified or untracked files' });
  });
});
