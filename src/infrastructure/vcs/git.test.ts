// Tests for runGit (rule I-19). Real git against throw-away repos in fs.mkdtemp folders;
// HOME is redirected so no test ever reads or writes the user's real git config.
import { existsSync } from 'node:fs';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { runGit } from './git';

const IDENTITY_ARGS = ['-c', 'user.name=t', '-c', 'user.email=t@t'] as const;

// Environment variables these tests overwrite; every test gets its original value back.
const ENV_KEYS = ['PATH', 'HOME', 'GIT_CONFIG_COUNT', 'GIT_CONFIG_KEY_0', 'GIT_CONFIG_VALUE_0'] as const;

let dir = '';
let homeDir = '';
let savedEnv: Map<string, string | undefined>;

beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), 'docket-git-runner-'));
  homeDir = await mkdtemp(join(tmpdir(), 'docket-git-home-'));
  savedEnv = new Map(ENV_KEYS.map((key) => [key, process.env[key]]));
  process.env.HOME = homeDir;
});

afterEach(async () => {
  for (const [key, value] of savedEnv) {
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
  await rm(dir, { recursive: true, force: true });
  await rm(homeDir, { recursive: true, force: true });
});

describe('runGit', () => {
  it('I-19: a successful git invocation resolves with exit code 0', async () => {
    const result = await runGit(dir, ['--version']);

    expect(result.exitCode).toBe(0);
    expect(result.stdout).toContain('git version');
  });

  it('I-19: a non-zero git exit is returned as a result, not thrown', async () => {
    const result = await runGit(dir, ['status']);

    expect(result.exitCode).not.toBe(0);
    expect(result.stderr.length).toBeGreaterThan(0);
  });

  it('I-19: a missing git binary resolves with exit code 127', async () => {
    process.env.PATH = '';

    const result = await runGit(dir, ['--version']);

    expect(result.exitCode).toBe(127);
  });

  it('I-19: a timed-out git process is killed and reported with exit code 124', async () => {
    await runGit(dir, ['init']);

    // cat-file --batch reads object names from stdin, which runGit keeps open — it blocks
    // until killed, without touching the network.
    const result = await runGit(dir, ['cat-file', '--batch'], { timeoutMs: 400 });

    expect(result.exitCode).toBe(124);
  });

  it('I-19: the child environment drops parent variables instead of inheriting them', async () => {
    // Env-based config injection: if runGit forwarded these, `git config user.name`
    // would print the injected value instead of exiting 1 for an unset key.
    process.env.GIT_CONFIG_COUNT = '1';
    process.env.GIT_CONFIG_KEY_0 = 'user.name';
    process.env.GIT_CONFIG_VALUE_0 = 'leaked-identity';

    const result = await runGit(dir, ['config', 'user.name']);

    expect(result.exitCode).toBe(1);
    expect(result.stdout).toBe('');
  });

  it('I-19: HOME is passed through to the child environment', async () => {
    const global = await runGit(dir, ['config', '--global', 'user.name', 'env-home']);
    expect(global.exitCode).toBe(0);

    const result = await runGit(dir, ['config', 'user.name']);

    expect(result.exitCode).toBe(0);
    expect(result.stdout.trim()).toBe('env-home');
  });

  it('I-19: arguments reach git verbatim, never through a shell', async () => {
    await runGit(dir, ['init']);
    const marker = join(dir, 'docket-shell-marker');

    const result = await runGit(dir, ['rev-parse', '--verify', `HEAD; touch ${marker}`]);

    expect(result.exitCode).not.toBe(0);
    expect(existsSync(marker)).toBe(false);
  });

  it('I-19: identity variables are not inherited, so commits carry the explicit -c identity', async () => {
    // An inherited GIT_AUTHOR_NAME would override the -c config for the author identity,
    // so the committed author name proves which source the child actually saw.
    process.env.GIT_AUTHOR_NAME = 'leaked-name';
    process.env.GIT_AUTHOR_EMAIL = 'leaked-name@example.com';

    await runGit(dir, ['init']);
    await writeFile(join(dir, 'a.ts'), 'l1\n', 'utf8');
    await runGit(dir, ['add', 'a.ts']);
    const commit = await runGit(dir, [...IDENTITY_ARGS, 'commit', '-m', 'x']);
    expect(commit.exitCode).toBe(0);

    const log = await runGit(dir, ['log', '-1', '--format=%an <%ae>']);
    expect(log.stdout.trim()).toBe('t <t@t>');
  });
});
