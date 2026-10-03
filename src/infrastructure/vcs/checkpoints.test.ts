// Tests for the CheckpointCommitter over runGit (P-38 item 4) — the companion git-boundary test:
// real git against throw-away repos in fs.mkdtemp folders, HOME redirected so no test ever reads
// or writes the user's git config. The redactor is injected (the module map keeps vcs off gates);
// the composition-root test proves the scanner's real patterns are what gets injected.
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { parseUlid, type RunId, type Ulid, type WorkOrderId } from '../../domain/index';

import { createCheckpoints } from './checkpoints';
import { runGit } from './git';
import { worktreeBranch } from './worktrees';

const ulidOf = <B extends string>(input: string): Ulid<B> => {
  const parsed = parseUlid<B>(input);
  if (!parsed.ok) throw new Error(`fixture ulid must parse: ${input}`);
  return parsed.value;
};

const RUN: RunId = ulidOf<'run'>('01ARZ3NDEKTSV4RRFFQ69G5FAV');
const WO: WorkOrderId = ulidOf<'work-order'>('01ARZ3NDEKTSV4RRFFQ69G5FAV');

// A token-shaped string the injected redactor replaces: the boundary must run every patch
// through it, so the planted token can never survive into the port's answer.
const TOKEN = `ghp_${'a'.repeat(36)}`;
const redactToken = (text: string): string => text.replaceAll(TOKEN, '[redacted]');

const ENV_KEYS = ['PATH', 'HOME'] as const;

let scratch = '';
let homeDir = '';
let savedEnv: Map<string, string | undefined>;

beforeEach(async () => {
  scratch = await mkdtemp(join(tmpdir(), 'docket-checkpoints-'));
  homeDir = await mkdtemp(join(tmpdir(), 'docket-checkpoints-home-'));
  savedEnv = new Map(ENV_KEYS.map((key) => [key, process.env[key]]));
  process.env.HOME = homeDir;
});

afterEach(async () => {
  for (const [key, value] of savedEnv) {
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
  await rm(scratch, { recursive: true, force: true });
  await rm(homeDir, { recursive: true, force: true });
});

async function git(cwd: string, args: readonly string[]): Promise<string> {
  const result = await runGit(cwd, args);
  if (result.exitCode !== 0) throw new Error(`fixture git failed (exit ${result.exitCode}): ${args.join(' ')}`);
  return result.stdout;
}

/** A repo with one commit and a repo-local user identity, so a checkpoint's Docket identity has
 *  a real user config to override. Returns the seed commit's sha. */
async function initRepo(cwd: string): Promise<string> {
  await mkdir(cwd, { recursive: true });
  await git(cwd, ['init', '-b', 'main']);
  await git(cwd, ['config', 'user.name', 'Real User']);
  await git(cwd, ['config', 'user.email', 'real@user.example']);
  await writeFile(join(cwd, 'seed.ts'), 'l1\n', 'utf8');
  await git(cwd, ['add', 'seed.ts']);
  await git(cwd, ['commit', '-m', 'seed']);
  return (await git(cwd, ['rev-parse', 'HEAD'])).trim();
}

/** A checkout plus the work tree I-20 would have made for WO: branch docket/wo-<id> and the
 *  refs/docket/bases/<id> ref pointing at the base commit. */
async function initWorktree(): Promise<{ readonly checkout: string; readonly worktree: string; readonly base: string }> {
  const checkout = join(scratch, 'checkout');
  const base = await initRepo(checkout);
  const worktree = join(scratch, 'worktree');
  await git(checkout, ['worktree', 'add', '-b', worktreeBranch(WO), worktree, base]);
  await git(checkout, ['update-ref', `refs/docket/bases/${WO}`, base]);
  return { checkout, worktree, base };
}

const committer = createCheckpoints({ redact: redactToken });

describe('createCheckpoints (the CheckpointCommitter over runGit)', () => {
  it('commit creates a sha over a real repo; a second commit with no changes is { changed: false } and records no commit', async () => {
    const repo = join(scratch, 'repo');
    await initRepo(repo);
    await writeFile(join(repo, 'a.ts'), 'change\n', 'utf8');

    const first = await committer.commit({ cwd: repo, runId: RUN, seq: 1 });
    expect(first).toEqual({ ok: true, value: { sha: expect.stringMatching(/^[0-9a-f]{40,64}$/), changed: true } });

    const second = await committer.commit({ cwd: repo, runId: RUN, seq: 2 });
    expect(second).toEqual({ ok: true, value: { sha: '', changed: false } });
    // The clean tree created nothing: HEAD count stays at seed + one checkpoint.
    expect((await git(repo, ['rev-list', '--count', 'HEAD'])).trim()).toBe('2');
  });

  it('commits are authored by the Docket checkpoint identity, never the user, and carry run and seq', async () => {
    const repo = join(scratch, 'repo');
    await initRepo(repo);
    await writeFile(join(repo, 'a.ts'), 'change\n', 'utf8');

    const committed = await committer.commit({ cwd: repo, runId: RUN, seq: 1 });
    expect(committed.ok).toBe(true);

    // The repo's own config says "Real User"; the -c identity outranks it.
    expect((await git(repo, ['log', '-1', '--format=%an <%ae>'])).trim()).toBe(
      'Docket <checkpoints@docket.local>',
    );
    const message = (await git(repo, ['log', '-1', '--format=%s'])).trim();
    expect(message).toBe(`Docket checkpoint 1 (run ${RUN})`);
  });

  it('diffSince returns the changed files and the patch redacted through the injected redactor', async () => {
    const repo = join(scratch, 'repo');
    const base = await initRepo(repo);
    await writeFile(join(repo, 'changed.ts'), `line\n${TOKEN}\n`, 'utf8');
    expect((await committer.commit({ cwd: repo, runId: RUN, seq: 1 })).ok).toBe(true);

    const diff = await committer.diffSince({ cwd: repo, since: base });

    expect(diff).toEqual({
      ok: true,
      value: { files: ['changed.ts'], patch: expect.stringContaining('[redacted]') },
    });
    if (diff.ok) expect(diff.value.patch).not.toContain(TOKEN);
  });

  it('base resolves the worktree base ref (refs/docket/bases/<id>)', async () => {
    const { worktree, base } = await initWorktree();

    const resolved = await committer.base({ cwd: worktree, workOrderId: WO });

    expect(resolved).toEqual({ ok: true, value: base });
  });

  it('a checkpoint commit in the worktree leaves the user checkout, its branch and its index untouched (A-58)', async () => {
    const { checkout, worktree } = await initWorktree();
    const headBefore = (await git(checkout, ['rev-parse', 'HEAD'])).trim();
    await writeFile(join(worktree, 'work.ts'), 'work\n', 'utf8');

    const committed = await committer.commit({ cwd: worktree, runId: RUN, seq: 1 });
    expect(committed.ok).toBe(true);

    // The commit lands on the worktree's own branch; the checkout's HEAD, branch and tree are
    // exactly what they were.
    expect((await git(checkout, ['rev-parse', 'HEAD'])).trim()).toBe(headBefore);
    expect((await git(checkout, ['rev-parse', '--abbrev-ref', 'HEAD'])).trim()).toBe('main');
    expect(await git(checkout, ['status', '--porcelain'])).toBe('');
    expect((await git(worktree, ['rev-parse', '--abbrev-ref', 'HEAD'])).trim()).toBe(worktreeBranch(WO));
  });

  it('git failures are Results, never throws: a non-repo commit, an unknown diff base, a missing base ref', async () => {
    const notARepo = join(scratch, 'empty');
    await mkdir(notARepo, { recursive: true });
    const repo = join(scratch, 'repo');
    await initRepo(repo);

    await expect(committer.commit({ cwd: notARepo, runId: RUN, seq: 1 })).resolves.toEqual({
      ok: false,
      error: 'git_failed',
    });
    await expect(committer.diffSince({ cwd: repo, since: 'f'.repeat(40) })).resolves.toEqual({
      ok: false,
      error: 'git_failed',
    });
    await expect(committer.base({ cwd: repo, workOrderId: WO })).resolves.toEqual({
      ok: false,
      error: 'git_failed',
    });
  });
});
