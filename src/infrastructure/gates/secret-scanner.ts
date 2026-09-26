// File-level secret scanner: scopes the scan to what a work order changed when run in a Docket worktree.
import { open } from 'node:fs/promises';
import type { FileHandle } from 'node:fs/promises';
import { resolve } from 'node:path';

import type { SecretScanner } from '../../application/index';
import { BASE_REF_PREFIX, runGit } from '../vcs/index';
import { findSecrets } from './secret-patterns';

const ONE_MIB = 1024 * 1024;
const NUL_PROBE_BYTES = 8192;
const BRANCH_PREFIX = 'docket/wo-';

function outputLines(stdout: string): readonly string[] {
  return stdout.split('\n').filter((line) => line.length > 0);
}

// The work order's changed files plus untracked ones when cwd is a Docket worktree
// (branch docket/wo-<id> with refs/docket/bases/<id> present); every tracked and
// untracked file in any other repository.
async function listScannedFiles(cwd: string): Promise<readonly string[]> {
  const branch = await runGit(cwd, ['rev-parse', '--abbrev-ref', 'HEAD']);
  const name = branch.stdout.trim();
  if (branch.exitCode === 0 && name.startsWith(BRANCH_PREFIX)) {
    const baseRef = BASE_REF_PREFIX + name.slice(BRANCH_PREFIX.length);
    const base = await runGit(cwd, ['rev-parse', '--verify', '--quiet', baseRef]);
    if (base.exitCode === 0) {
      const changed = await runGit(cwd, ['diff', '--name-only', '--diff-filter=ACMR', baseRef]);
      const untracked = await runGit(cwd, ['ls-files', '--others', '--exclude-standard']);
      return [...new Set([...outputLines(changed.stdout), ...outputLines(untracked.stdout)])];
    }
  }
  const all = await runGit(cwd, ['ls-files', '--cached', '--others', '--exclude-standard']);
  return outputLines(all.stdout);
}

// The file's full text, or undefined when it must be skipped: over 1 MiB, a NUL byte in its
// first 8 KiB (binary), or gone between the listing and the read.
async function readScannableText(absolutePath: string): Promise<string | undefined> {
  let handle: FileHandle | undefined;
  try {
    handle = await open(absolutePath, 'r');
    const { size } = await handle.stat();
    if (size > ONE_MIB) return undefined;
    const head = Buffer.alloc(Math.min(NUL_PROBE_BYTES, size));
    await handle.read(head, 0, head.length, 0);
    if (head.includes(0)) return undefined;
    const rest = Buffer.alloc(size - head.length);
    if (rest.length > 0) await handle.read(rest, 0, rest.length, head.length);
    return Buffer.concat([head, rest]).toString('utf8');
  } catch {
    return undefined;
  } finally {
    if (handle !== undefined) await handle.close();
  }
}

export function createSecretScanner(): SecretScanner {
  return {
    scan: async (cwd: string) => {
      const inside = await runGit(cwd, ['rev-parse', '--is-inside-work-tree']);
      if (inside.exitCode !== 0 || inside.stdout.trim() !== 'true') {
        throw new Error('not a git work tree');
      }
      let findings = 0;
      for (const name of await listScannedFiles(cwd)) {
        const text = await readScannableText(resolve(cwd, name));
        if (text !== undefined) findings += findSecrets(text).length;
      }
      return { findings };
    },
  };
}
