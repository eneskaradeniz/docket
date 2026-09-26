// Tests for createSecretScanner (rule I-23). Real git against throw-away repos in fs.mkdtemp
// folders; HOME is redirected so no test reads or writes the user's real git config.
// Credential-looking fixtures are assembled at runtime, never written as one literal.
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { runGit } from '../vcs/index';
import { createSecretScanner } from './secret-scanner';

const awsKey = (): string => 'AKIA' + 'X'.repeat(16);
const secondAwsKey = (): string => 'ASIA' + 'Y'.repeat(16);

let dir = '';
let homeDir = '';
let savedEnv: Map<string, string | undefined>;

beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), 'docket-secret-scan-'));
  homeDir = await mkdtemp(join(tmpdir(), 'docket-git-home-'));
  savedEnv = new Map([['HOME', process.env['HOME']]]);
  process.env['HOME'] = homeDir;
});

afterEach(async () => {
  for (const [key, value] of savedEnv) {
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
  await rm(dir, { recursive: true, force: true });
  await rm(homeDir, { recursive: true, force: true });
});

const git = async (...args: readonly string[]): Promise<void> => {
  const result = await runGit(dir, args);
  expect(result.exitCode, `git ${args.join(' ')} failed: ${result.stderr}`).toBe(0);
};

const commitAll = async (message: string): Promise<void> => {
  await git('add', '-A');
  await git('-c', 'user.name=t', '-c', 'user.email=t@t', 'commit', '-m', message);
};

// A Docket-style worktree: branch docket/wo-1 on top of a base commit recorded in refs/docket/bases/1,
// base.txt carrying a secret that the work order never touched.
const initDocketWorktree = async (): Promise<void> => {
  await git('init');
  await writeFile(join(dir, 'base.txt'), 'untouched\n' + awsKey() + '\n', 'utf8');
  await writeFile(join(dir, 'changed.txt'), 'original\n', 'utf8');
  await commitAll('base');
  await git('update-ref', 'refs/docket/bases/1', 'HEAD');
  await git('checkout', '-b', 'docket/wo-1');
};

describe('createSecretScanner', () => {
  it('I-23: in a Docket worktree the untouched base file is not counted, a changed and an untracked file are', async () => {
    await initDocketWorktree();
    await writeFile(join(dir, 'changed.txt'), 'changed ' + secondAwsKey() + '\n', 'utf8');
    await commitAll('change');
    await writeFile(join(dir, 'untracked.txt'), awsKey() + '\n', 'utf8');

    const { findings } = await createSecretScanner().scan(dir);

    expect(findings).toBe(2);
  });

  it('I-23: in a Docket worktree an uncommitted modification of a tracked file is scanned too', async () => {
    await initDocketWorktree();
    await writeFile(join(dir, 'changed.txt'), 'edited ' + secondAwsKey() + '\n', 'utf8');

    const { findings } = await createSecretScanner().scan(dir);

    expect(findings).toBe(1);
  });

  it('I-23: a file deleted in a Docket worktree does not break the scan', async () => {
    await initDocketWorktree();
    await rm(join(dir, 'changed.txt'));

    const { findings } = await createSecretScanner().scan(dir);

    expect(findings).toBe(0);
  });

  it('I-23: a cwd that is not a Docket worktree scans every tracked and untracked file', async () => {
    await git('init');
    await writeFile(join(dir, 'tracked.txt'), awsKey() + '\n', 'utf8');
    await commitAll('initial');
    await writeFile(join(dir, 'untracked.txt'), secondAwsKey() + '\n' + secondAwsKey() + '\n', 'utf8');

    const { findings } = await createSecretScanner().scan(dir);

    expect(findings).toBe(3);
  });

  it('I-23: a docket branch without its base ref falls back to the full scan', async () => {
    await git('init');
    await writeFile(join(dir, 'base.txt'), awsKey() + '\n', 'utf8');
    await commitAll('initial');
    await git('checkout', '-b', 'docket/wo-7');

    const { findings } = await createSecretScanner().scan(dir);

    expect(findings).toBe(1);
  });

  it('I-23: a branch that is not docket/wo-… never scopes the scan, even with a base ref present', async () => {
    await git('init');
    await writeFile(join(dir, 'base.txt'), awsKey() + '\n', 'utf8');
    await commitAll('initial');
    await git('update-ref', 'refs/docket/bases/1', 'HEAD');
    await writeFile(join(dir, 'second.txt'), secondAwsKey() + '\n', 'utf8');
    await commitAll('second');

    const { findings } = await createSecretScanner().scan(dir);

    expect(findings).toBe(2);
  });

  it('I-23: a repository without commits still scans its untracked files', async () => {
    await git('init');
    await writeFile(join(dir, 'only.txt'), awsKey() + '\n', 'utf8');

    const { findings } = await createSecretScanner().scan(dir);

    expect(findings).toBe(1);
  });

  it('I-23: a file over 1 MiB is skipped, a file of exactly 1 MiB is scanned', async () => {
    await git('init');
    await writeFile(join(dir, 'exact.txt'), awsKey() + '\n' + 'a'.repeat(1024 * 1024 - awsKey().length - 1), 'utf8');
    await writeFile(join(dir, 'over.txt'), secondAwsKey() + '\n' + 'a'.repeat(1024 * 1024 - secondAwsKey().length), 'utf8');
    await commitAll('sized');

    const { findings } = await createSecretScanner().scan(dir);

    expect(findings).toBe(1);
  });

  it('I-23: a file with a NUL byte in its first 8 KiB is skipped', async () => {
    await git('init');
    const binary = [Buffer.from('header', 'utf8'), Buffer.from([0]), Buffer.from(awsKey(), 'utf8')];
    await writeFile(join(dir, 'binary.bin'), Buffer.concat(binary));
    await commitAll('binary');

    const { findings } = await createSecretScanner().scan(dir);

    expect(findings).toBe(0);
  });

  it('I-23: a NUL byte after the first 8 KiB does not skip the file', async () => {
    await git('init');
    const lateNul = [Buffer.alloc(9000, 0x61), Buffer.from([0]), Buffer.from(secondAwsKey(), 'utf8')];
    await writeFile(join(dir, 'late-nul.bin'), Buffer.concat(lateNul));
    await commitAll('late nul');

    const { findings } = await createSecretScanner().scan(dir);

    expect(findings).toBe(1);
  });

  it('I-23: gitignored untracked files are not scanned', async () => {
    await git('init');
    await writeFile(join(dir, '.gitignore'), 'ignored.txt\n', 'utf8');
    await commitAll('gitignore');
    await writeFile(join(dir, 'ignored.txt'), awsKey() + '\n', 'utf8');

    const { findings } = await createSecretScanner().scan(dir);

    expect(findings).toBe(0);
  });

  it('I-23: files in subdirectories are scanned', async () => {
    await git('init');
    await mkdir(join(dir, 'src'), { recursive: true });
    await writeFile(join(dir, 'src', 'nested.ts'), awsKey() + '\n', 'utf8');
    await commitAll('nested');

    const { findings } = await createSecretScanner().scan(dir);

    expect(findings).toBe(1);
  });

  it('I-23: a folder that is not a git work tree throws', async () => {
    await expect(createSecretScanner().scan(dir)).rejects.toThrow();
  });
});
