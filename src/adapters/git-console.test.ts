import { describe, expect, it } from 'vitest';
import {
  carriedLine,
  gitDiff,
  gitProcessRunner,
  gitStatus,
  unifiedPatchToDiff,
  type CommandResult,
  type CommandRunner,
} from './git-console';

// WO-0068 — the console adapter against observed git shapes. No live call: the CommandRunner seam
// is fed the real output shapes (porcelain v1 -b, a unified patch), so the parse and every
// degraded path are pinned offline. The jail is NOT here — it is the composition root's concern,
// verified by running (the house rule).

const res = (over: Partial<CommandResult>): CommandResult => ({ exit: 0, stdout: '', stderr: '', ...over });
const runWith = (expectArgs: string[], r: CommandResult): CommandRunner => (args) => {
  expect(args).toEqual(expectArgs);
  return Promise.resolve(r);
};

const STATUS_ARGS = [
  '-C', '/src/api',
  '-c', 'core.quotepath=false',
  '--no-optional-locks', 'status', '--porcelain=v1', '-b', '--untracked-files=normal',
];

describe('gitStatus (WO-0068)', () => {
  it('a clean tree: the branch from the ## header, no files, no ahead without an upstream', async () => {
    const run = runWith(STATUS_ARGS, res({ stdout: '## main\n' }));
    expect(await gitStatus(run, '/src/api')).toEqual({ kind: 'ok', branch: 'main', files: [] });
  });

  it('branch + ahead from the upstream header; the changed file letters survive', async () => {
    const run = runWith(
      STATUS_ARGS,
      res({
        stdout: [
          '## wo-0068-degisiklikler-konsolu...origin/wo-0068-degisiklikler-konsolu [ahead 2]',
          ' M src/core/console.ts',
          'M  src/adapters/git-console.ts',
          'A  docs/new.md',
          'D  docs/old.md',
          '',
        ].join('\n'),
      }),
    );
    expect(await gitStatus(run, '/src/api')).toEqual({
      kind: 'ok',
      branch: 'wo-0068-degisiklikler-konsolu',
      ahead: 2,
      files: [
        { path: 'src/core/console.ts', status: 'M' }, // unstaged-only: the Y letter is the fact
        { path: 'src/adapters/git-console.ts', status: 'M' },
        { path: 'docs/new.md', status: 'A' },
        { path: 'docs/old.md', status: 'D' },
      ],
    });
  });

  it('a detached HEAD carries NO branch — absence, never a guessed name', async () => {
    const run = runWith(STATUS_ARGS, res({ stdout: '## HEAD (no branch)\n M a.ts\n' }));
    const status = await gitStatus(run, '/src/api');
    expect(status.kind).toBe('ok');
    if (status.kind === 'ok') {
      expect('branch' in status).toBe(false);
      expect(status.files).toEqual([{ path: 'a.ts', status: 'M' }]);
    }
  });

  it('an UNBORN branch (`No commits yet on main`) names no branch either — nothing to push or open a PR from', async () => {
    const run = runWith(STATUS_ARGS, res({ stdout: '## No commits yet on main\n?? docs/new.md\n' }));
    const status = await gitStatus(run, '/src/api');
    expect(status.kind).toBe('ok');
    if (status.kind === 'ok') {
      expect('branch' in status).toBe(false);
      expect(status.files).toEqual([{ path: 'docs/new.md', status: '??' }]);
    }
  });

  it('a rename line parses to the TARGET path', async () => {
    const run = runWith(STATUS_ARGS, res({ stdout: '## main\nR  docs/eski-ad.md -> docs/yeni-ad.md\n' }));
    const status = await gitStatus(run, '/src/api');
    expect(status.kind === 'ok' && status.files).toEqual([{ path: 'docs/yeni-ad.md', status: 'R' }]);
  });

  it('an untracked file carries the ?? letter verbatim', async () => {
    const run = runWith(STATUS_ARGS, res({ stdout: '## main\n?? docs/yeni-not.md\n' }));
    expect(await gitStatus(run, '/src/api')).toEqual({
      kind: 'ok',
      branch: 'main',
      files: [{ path: 'docs/yeni-not.md', status: '??' }],
    });
  });

  it('a non-ASCII path arrives verbatim (core.quotepath switched off at the call)', async () => {
    const run = runWith(STATUS_ARGS, res({ stdout: '## main\n M docs/тürkçe-not.md\n' }));
    const status = await gitStatus(run, '/src/api');
    expect(status.kind === 'ok' && status.files[0]!.path).toBe('docs/тürkçe-not.md');
  });

  it('non-zero exit is the error arm with git’s own line — never a fake clean tree', async () => {
    const run = runWith(STATUS_ARGS, res({ exit: 128, stderr: 'fatal: not a git repository (or any of the parent directories)\n' }));
    expect(await gitStatus(run, '/src/api')).toEqual({
      kind: 'error',
      error: 'fatal: not a git repository (or any of the parent directories)',
    });
  });

  it('spawn failure (exit 127) degrades with the carried message; a blank stderr falls back to the exit', async () => {
    expect(await gitStatus(runWith(STATUS_ARGS, res({ exit: 127, stderr: 'spawn git ENOENT' })), '/src/api')).toEqual({
      kind: 'error',
      error: 'spawn git ENOENT',
    });
    expect(await gitStatus(runWith(STATUS_ARGS, res({ exit: 128 })), '/src/api')).toEqual({
      kind: 'error',
      error: 'git status failed (exit 128)',
    });
  });
});

describe('gitDiff (WO-0068)', () => {
  const DIFF_ARGS = ['-C', '/src/api', '--no-optional-locks', 'diff', '--', 'src/core/console.ts'];
  const PATCH = [
    'diff --git a/src/core/console.ts b/src/core/console.ts',
    'index 0000000..1111111 100644',
    '--- a/src/core/console.ts',
    '+++ b/src/core/console.ts',
    '@@ -1,3 +1,4 @@',
    ' import { LineDiff } from \'./diff\';',
    '-import type { WorkOrderId } from \'./types\';',
    '+import type { WorkOrderId } from \'./types\';',
    '+// WO-0068',
    ' ',
  ].join('\n');

  it('the patch passes through verbatim — one spawn, one arg vector', async () => {
    expect(await gitDiff(runWith(DIFF_ARGS, res({ stdout: PATCH })), '/src/api', 'src/core/console.ts')).toBe(PATCH);
  });

  it('an untracked file stays EMPTY — the ?? letter is the (new file) fact, not a --no-index patch', async () => {
    expect(await gitDiff(runWith(DIFF_ARGS, res({ stdout: '' })), '/src/api', 'src/core/console.ts')).toBe('');
  });

  it('a failed spawn resolves empty — no invented patch', async () => {
    expect(await gitDiff(runWith(DIFF_ARGS, res({ exit: 128, stderr: 'fatal: bad object' })), '/src/api', 'src/core/console.ts')).toBe('');
  });
});

describe('unifiedPatchToDiff (WO-0068)', () => {
  it('parses git’s patch into the ask-card peek’s structure; headers are structure, not content', () => {
    const patch = [
      'diff --git a/a.ts b/a.ts',
      'index 0000000..1111111 100644',
      '--- a/a.ts',
      '+++ b/a.ts',
      '@@ -1,2 +1,3 @@',
      ' ctx line',
      '-removed',
      '+added',
      '+added two',
      '\\ No newline at end of file',
      '',
    ].join('\n');
    expect(unifiedPatchToDiff(patch)).toEqual({
      lines: [
        { op: 'ctx', text: 'ctx line' },
        { op: 'del', text: 'removed' },
        { op: 'add', text: 'added' },
        { op: 'add', text: 'added two' },
      ],
      truncated: 0,
    });
  });

  it('a multi-hunk patch continues across the later @@ leads', () => {
    const patch = ['@@ -1 +1,1 @@', '-a', '+b', '@@ -9 +9,1 @@', '+c', ''].join('\n');
    expect(unifiedPatchToDiff(patch).lines).toEqual([
      { op: 'del', text: 'a' },
      { op: 'add', text: 'b' },
      { op: 'add', text: 'c' },
    ]);
  });

  it('an empty or context-only patch is no diff at all', () => {
    expect(unifiedPatchToDiff('')).toEqual({ lines: [], truncated: 0 });
    expect(unifiedPatchToDiff('@@ -1,1 +1,1 @@\n same\n').truncated).toBe(0);
  });

  it('the peek stays capped: 40 lines shown, the rest counted as truncated', () => {
    const body = Array.from({ length: 45 }, (_, i) => `+line ${i + 1}`).join('\n');
    const parsed = unifiedPatchToDiff(`@@ -0,0 +1,45 @@\n${body}\n`);
    expect(parsed.lines).toHaveLength(40);
    expect(parsed.lines[0]!.text).toBe('line 1');
    expect(parsed.truncated).toBe(5);
  });

  it('a long line is sliced to the shared char cap', () => {
    const long = 'x'.repeat(500);
    expect(unifiedPatchToDiff(`@@ -0,0 +1,1 @@\n+${long}\n`).lines[0]!.text).toHaveLength(400);
  });
});

describe('carriedLine + the production runner (health.ts’s seam shape)', () => {
  it('the carried line prefers the stderr line and falls back to the given exit line', () => {
    expect(carriedLine(res({ stderr: 'first line\nsecond line\n' }), 'fallback')).toBe('first line');
    expect(carriedLine(res({ stderr: '' }), 'git push failed (exit 1)')).toBe('git push failed (exit 1)');
  });

  it('is a seam the tests could have written — a function yielding exit/stdout/stderr', () => {
    expect(typeof gitProcessRunner()).toBe('function');
  });
});
