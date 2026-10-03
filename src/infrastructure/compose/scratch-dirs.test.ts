import { existsSync, mkdtempSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { basename, dirname, join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';

import { createScratchDirs } from './scratch-dirs';

const roots: string[] = [];
const freshRoot = (): string => {
  const root = mkdtempSync(join(tmpdir(), 'docket-scratch-test-'));
  roots.push(root);
  return root;
};

afterEach(() => {
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
});

describe('createScratchDirs', () => {
  it('I-35: create makes an empty docket-account-test-* directory under the temp dir', async () => {
    const dirs = createScratchDirs();
    const dir = await dirs.create('account-test');
    try {
      expect(existsSync(dir.path)).toBe(true);
      expect(readdirSync(dir.path)).toEqual([]);
      expect(basename(dir.path).startsWith('docket-account-test-')).toBe(true);
      expect(dirname(dir.path)).toBe(tmpdir());
    } finally {
      await dir.dispose();
    }
  });

  it('I-35: two dirs are distinct and dispose removes exactly its own, recursively', async () => {
    const root = freshRoot();
    const dirs = createScratchDirs({ root });
    const a = await dirs.create('account-test');
    const b = await dirs.create('account-test');
    expect(a.path).not.toBe(b.path);
    writeFileSync(join(a.path, 'file.txt'), 'x');
    await a.dispose();
    expect(existsSync(a.path)).toBe(false);
    expect(existsSync(b.path)).toBe(true);
    expect(existsSync(root)).toBe(true);
  });

  it('I-35: dispose never fails the caller, even when the directory is already gone', async () => {
    const dir = await createScratchDirs({ root: freshRoot() }).create('account-test');
    rmSync(dir.path, { recursive: true, force: true });
    await expect(dir.dispose()).resolves.toBeUndefined();
    await expect(dir.dispose()).resolves.toBeUndefined();
  });
});
