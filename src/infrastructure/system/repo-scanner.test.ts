import { mkdtemp, mkdir, writeFile, symlink } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { describe, expect, it } from 'vitest';

import { createRepoScanner } from './repo-scanner';

describe('createRepoScanner', () => {
  it('A-382: skips hidden directories and does not follow symlinks', async () => {
    const parent = await mkdtemp(join(tmpdir(), 'docket-scan-'));
    await mkdir(join(parent, 'visible'));
    await mkdir(join(parent, '.hidden'));
    await symlink(join(parent, 'visible'), join(parent, 'linked'), 'dir');
    const scanner = createRepoScanner();
    const listed = await scanner.list(parent);
    expect(listed.ok).toBe(true);
    if (!listed.ok) return;
    expect(listed.value.map((entry) => entry.name).sort()).toEqual(['visible']);
  });

  it('A-382: treats a .git file as a git repository', async () => {
    const parent = await mkdtemp(join(tmpdir(), 'docket-scan-'));
    const repo = join(parent, 'worktree');
    await mkdir(repo);
    await writeFile(join(repo, '.git'), 'gitdir: /elsewhere/.git\n', 'utf8');
    const scanner = createRepoScanner();
    const listed = await scanner.list(parent);
    expect(listed.ok).toBe(true);
    if (!listed.ok) return;
    expect(listed.value[0]?.isGit).toBe(true);
  });

  it('A-382: answers not_found for a missing parent', async () => {
    const scanner = createRepoScanner();
    const listed = await scanner.list('/no/such/parent');
    expect(listed.ok).toBe(false);
    if (listed.ok) return;
    expect(listed.error).toBe('not_found');
  });
});
