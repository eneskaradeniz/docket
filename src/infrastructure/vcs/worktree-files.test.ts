import { mkdtemp, rm, writeFile, mkdir, symlink } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { createWorktreeFiles } from './worktree-files';
import { runGit } from './git';
import { createFakeWorktreeFiles } from '../../application/ports/fakes/fake-worktree-files';

describe('WorktreeFiles', () => {
  describe.each([
    ['sqlite', () => createWorktreeFiles()],
    ['fake', () => createFakeWorktreeFiles()]
  ])('%s', (type, factory) => {
    let cwd: string;
    let adapter: ReturnType<typeof factory>;

    beforeEach(async () => {
      cwd = await mkdtemp(join(tmpdir(), 'docket-worktree-files-'));
      adapter = factory();

      if (type === 'sqlite') {
        await runGit(cwd, ['init', '--initial-branch=main']);
        await runGit(cwd, ['config', 'user.name', 'Test']);
        await runGit(cwd, ['config', 'user.email', 'test@example.com']);
        await writeFile(join(cwd, 'tracked.txt'), 'tracked');
        await runGit(cwd, ['add', 'tracked.txt']);
        await runGit(cwd, ['commit', '-m', 'init']);
      }
    });

    afterEach(async () => {
      await rm(cwd, { recursive: true, force: true });
    });

    it('I-39: listChanged lists changed vs HEAD and untracked files', async () => {
      if (type === 'sqlite') {
        await writeFile(join(cwd, 'tracked.txt'), 'changed');
        await writeFile(join(cwd, 'untracked.txt'), 'untracked');
        await mkdir(join(cwd, 'dir'));
        await writeFile(join(cwd, 'dir/new.txt'), 'new');
      } else {
        const fake = adapter as any;
        fake.written('tracked.txt', 'changed');
        fake.written('untracked.txt', 'untracked');
        fake.written('dir/new.txt', 'new');
      }

      const list = await adapter.listChanged(cwd);
      expect(list).toEqual([
        { path: 'dir/new.txt', sizeBytes: 3 },
        { path: 'tracked.txt', sizeBytes: 7 },
        { path: 'untracked.txt', sizeBytes: 9 },
      ]);
    });

    it('I-40: readText guard 1: .. or outside symlink returns outside_worktree', async () => {
      const res = await adapter.readText(cwd, '../foo', 10);
      expect(res.ok).toBe(false);
      if (!res.ok) expect(res.error).toBe('outside_worktree');

      if (type === 'sqlite') {
        const outDir = await mkdtemp(join(tmpdir(), 'docket-out-'));
        await writeFile(join(outDir, 'foo.txt'), 'foo');
        await symlink(join(outDir, 'foo.txt'), join(cwd, 'link.txt'));
        const linkRes = await adapter.readText(cwd, 'link.txt', 10);
        expect(linkRes.ok).toBe(false);
        if (!linkRes.ok) expect(linkRes.error).toBe('outside_worktree');
        await rm(outDir, { recursive: true, force: true });
      }
    });

    it('I-40: readText guard 2: missing file returns not_found', async () => {
      const res = await adapter.readText(cwd, 'missing.txt', 10);
      expect(res.ok).toBe(false);
      if (!res.ok) expect(res.error).toBe('not_found');
    });

    it('I-40: readText guard 3: large file returns too_large', async () => {
      if (type === 'sqlite') {
        await writeFile(join(cwd, 'large.txt'), Buffer.alloc(262145, 'a'));
      } else {
        const fake = adapter as any;
        fake.written('large.txt', Buffer.alloc(262145, 'a'));
      }
      const res = await adapter.readText(cwd, 'large.txt', 10);
      expect(res.ok).toBe(false);
      if (!res.ok) expect(res.error).toBe('too_large');
    });

    it('I-40: readText guard 4: binary file returns not_text', async () => {
      if (type === 'sqlite') {
        await writeFile(join(cwd, 'bin.txt'), Buffer.from([0, 1, 2]));
        await writeFile(join(cwd, 'invalid-utf8.txt'), Buffer.from([0xff, 0xff]));
      } else {
        const fake = adapter as any;
        fake.written('bin.txt', Buffer.from([0, 1, 2]));
        fake.written('invalid-utf8.txt', Buffer.from([0xff, 0xff]));
      }
      const res1 = await adapter.readText(cwd, 'bin.txt', 10);
      expect(res1.ok).toBe(false);
      if (!res1.ok) expect(res1.error).toBe('not_text');

      const res2 = await adapter.readText(cwd, 'invalid-utf8.txt', 10);
      expect(res2.ok).toBe(false);
      if (!res2.ok) expect(res2.error).toBe('not_text');
    });

    it('I-40: readText returns lines and truncates at maxLines', async () => {
      const content = '1\n2\n3\n4\n';
      if (type === 'sqlite') {
        await writeFile(join(cwd, 'lines.txt'), content);
      } else {
        const fake = adapter as any;
        fake.written('lines.txt', content);
      }

      const res1 = await adapter.readText(cwd, 'lines.txt', 10);
      expect(res1.ok).toBe(true);
      if (res1.ok) {
        expect(res1.value).toEqual({
          path: 'lines.txt',
          lines: ['1', '2', '3', '4'],
          truncated: false
        });
      }

      const res2 = await adapter.readText(cwd, 'lines.txt', 2);
      expect(res2.ok).toBe(true);
      if (res2.ok) {
        expect(res2.value).toEqual({
          path: 'lines.txt',
          lines: ['1', '2'],
          truncated: true
        });
      }
    });

    it('I-41: fake adapter keeps the same contract', () => {
      // already tested by describe.each structure
    });
  });
});
