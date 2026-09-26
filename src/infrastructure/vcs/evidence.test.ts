// Tests for createEvidenceChecker (rule I-21). All fixtures live in fs.mkdtemp folders;
// escape attempts are built against sibling files the test itself creates, never real system paths.
import { mkdir, mkdtemp, rm, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { createEvidenceChecker } from './evidence';

let outer = '';
let dir = '';

beforeEach(async () => {
  outer = await mkdtemp(join(tmpdir(), 'docket-evidence-'));
  dir = join(outer, 'worktree');
  await mkdir(dir);
  await writeFile(join(dir, 'a.ts'), 'l1\nl2\nl3\n', 'utf8');
  await writeFile(join(dir, 'no-newline.ts'), 'l1\nl2', 'utf8');
});

afterEach(async () => {
  await rm(outer, { recursive: true, force: true });
});

describe('createEvidenceChecker', () => {
  it('I-21: a single-line pointer that exists resolves to true', async () => {
    const checker = createEvidenceChecker();

    await expect(checker.resolvePointers(dir, ['a.ts:2'])).resolves.toBe(true);
  });

  it('I-21: a line-range pointer resolves when the file has at least end lines', async () => {
    const checker = createEvidenceChecker();

    await expect(checker.resolvePointers(dir, ['a.ts:1-3'])).resolves.toBe(true);
  });

  it('I-21: a line beyond the last line of the file does not resolve', async () => {
    const checker = createEvidenceChecker();

    await expect(checker.resolvePointers(dir, ['a.ts:99'])).resolves.toBe(false);
  });

  it('I-21: a range whose end is beyond the last line does not resolve', async () => {
    const checker = createEvidenceChecker();

    await expect(checker.resolvePointers(dir, ['a.ts:2-99'])).resolves.toBe(false);
  });

  it('I-21: a pointer without a line spec does not resolve', async () => {
    const checker = createEvidenceChecker();

    await expect(checker.resolvePointers(dir, ['a.ts'])).resolves.toBe(false);
  });

  it('I-21: a pointer escaping cwd does not resolve', async () => {
    const checker = createEvidenceChecker();

    await expect(checker.resolvePointers(dir, ['../x:1'])).resolves.toBe(false);
  });

  it('I-21: a symlink resolving outside cwd does not resolve', async () => {
    await writeFile(join(outer, 'outside.ts'), 'l1\n', 'utf8');
    await symlink(join(outer, 'outside.ts'), join(dir, 'escape.ts'));
    const checker = createEvidenceChecker();

    await expect(checker.resolvePointers(dir, ['escape.ts:1'])).resolves.toBe(false);
  });

  it('I-21: a symlink resolving to a file inside cwd still resolves', async () => {
    await symlink('a.ts', join(dir, 'inside.ts'));
    const checker = createEvidenceChecker();

    await expect(checker.resolvePointers(dir, ['inside.ts:3'])).resolves.toBe(true);
  });

  it('I-21: an empty pointer list does not resolve', async () => {
    const checker = createEvidenceChecker();

    await expect(checker.resolvePointers(dir, [])).resolves.toBe(false);
  });

  it('I-21: one failing pointer fails the whole list', async () => {
    const checker = createEvidenceChecker();

    await expect(checker.resolvePointers(dir, ['a.ts:2', 'a.ts:99'])).resolves.toBe(false);
  });

  it('I-21: a missing file does not resolve', async () => {
    const checker = createEvidenceChecker();

    await expect(checker.resolvePointers(dir, ['missing.ts:1'])).resolves.toBe(false);
  });

  it('I-21: a pointer naming a directory does not resolve', async () => {
    await mkdir(join(dir, 'sub'));
    const checker = createEvidenceChecker();

    await expect(checker.resolvePointers(dir, ['sub:1'])).resolves.toBe(false);
  });

  it('I-21: line numbers are 1-based, so line 0 does not resolve', async () => {
    const checker = createEvidenceChecker();

    await expect(checker.resolvePointers(dir, ['a.ts:0'])).resolves.toBe(false);
  });

  it('I-21: a range with start greater than end does not resolve', async () => {
    const checker = createEvidenceChecker();

    await expect(checker.resolvePointers(dir, ['a.ts:3-2'])).resolves.toBe(false);
  });

  it('I-21: an absolute path does not resolve', async () => {
    const checker = createEvidenceChecker();

    await expect(checker.resolvePointers(dir, [`${join(dir, 'a.ts')}:1`])).resolves.toBe(false);
  });

  it('I-21: an empty path or an empty line spec does not resolve', async () => {
    const checker = createEvidenceChecker();

    await expect(checker.resolvePointers(dir, [':1'])).resolves.toBe(false);
    await expect(checker.resolvePointers(dir, ['a.ts:'])).resolves.toBe(false);
  });

  it('I-21: a file without a trailing newline counts its final line', async () => {
    const checker = createEvidenceChecker();

    await expect(checker.resolvePointers(dir, ['no-newline.ts:2'])).resolves.toBe(true);
    await expect(checker.resolvePointers(dir, ['no-newline.ts:3'])).resolves.toBe(false);
  });
});
