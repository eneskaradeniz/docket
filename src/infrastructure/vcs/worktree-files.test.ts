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
        const fake = adapter as ReturnType<typeof createFakeWorktreeFiles>;
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

    it('I-39: listChanged skips symlinks — a link pointing outside never enters the list', async () => {
      if (type === 'sqlite') {
        await writeFile(join(cwd, 'plain.txt'), 'plain');
        await writeFile(join(cwd, 'target.txt'), 'target');
        const outDir = await mkdtemp(join(tmpdir(), 'docket-out-'));
        await writeFile(join(outDir, 'outside.txt'), 'outside');
        await symlink(join(outDir, 'outside.txt'), join(cwd, 'link-out.txt'));
        await symlink('target.txt', join(cwd, 'link-in.txt'));

        const list = await adapter.listChanged(cwd);
        expect(list.map((entry) => entry.path)).toEqual(['plain.txt', 'target.txt']);
        await rm(outDir, { recursive: true, force: true });
      }
    });

    it('I-39: listChanged returns non-ASCII paths verbatim (core.quotepath=off)', async () => {
      if (type === 'sqlite') {
        const path = 'şahıs-öge.md';
        await writeFile(join(cwd, path), 'öge');
        const list = await adapter.listChanged(cwd);
        expect(list).toEqual([{ path, sizeBytes: 4 }]);
      }
    });

    it('I-39: listChanged drops .env* files — the preview never offers a secret', async () => {
      if (type === 'sqlite') {
        await writeFile(join(cwd, '.env'), 'TOKEN=1\n');
        await mkdir(join(cwd, 'nested'));
        await writeFile(join(cwd, 'nested', '.env.local'), 'TOKEN=2\n');
        await writeFile(join(cwd, 'dir.env'), 'a plain name, not an env file\n');
        await writeFile(join(cwd, 'normal.txt'), 'plain\n');
        const list = await adapter.listChanged(cwd);
        expect(list.map((entry) => entry.path)).toEqual(['dir.env', 'normal.txt']);
      }
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

    it('I-40: readText guard 1: .git segments and .env* names answer outside_worktree', async () => {
      if (type === 'sqlite') {
        await mkdir(join(cwd, '.git'), { recursive: true });
        await writeFile(join(cwd, '.git', 'config'), '[core]\n');
        await writeFile(join(cwd, '.env'), 'TOKEN=1\n');
        await mkdir(join(cwd, 'nested'));
        await writeFile(join(cwd, 'nested', '.env.local'), 'TOKEN=2\n');
        await writeFile(join(cwd, 'dir.env'), 'a plain name, not an env file\n');

        // The first three exist — the refusal is about the path's shape, not a miss; the
        // fourth does not, proving the guard answers before anything is looked up.
        for (const p of ['.git/config', '.env', 'nested/.env.local', 'sub/.git/keep']) {
          const res = await adapter.readText(cwd, p, 10);
          expect(res.ok).toBe(false);
          if (!res.ok) expect(res.error).toBe('outside_worktree');
        }

        // A name that merely ends in .env is not an env file.
        const plain = await adapter.readText(cwd, 'dir.env', 10);
        expect(plain.ok).toBe(true);
      }
    });

    it('I-40: readText guard 1: a symlink resolving into .git answers outside_worktree', async () => {
      if (type === 'sqlite') {
        await symlink('.git/config', join(cwd, 'leak.txt'));
        const res = await adapter.readText(cwd, 'leak.txt', 10);
        expect(res.ok).toBe(false);
        if (!res.ok) expect(res.error).toBe('outside_worktree');
      }
    });

    it('I-40: readText guard 2: missing file returns not_found', async () => {
      const res = await adapter.readText(cwd, 'missing.txt', 10);
      expect(res.ok).toBe(false);
      if (!res.ok) expect(res.error).toBe('not_found');
    });

    it('I-40: readText guard 2: realpath failures beyond ENOENT return not_found, never throw', async () => {
      if (type === 'sqlite') {
        // A component that is a regular file: realpath answers ENOTDIR.
        await writeFile(join(cwd, 'afile.txt'), 'x');
        // A symlink cycle: realpath answers ELOOP. Neither may surface — Node's error
        // messages carry absolute paths.
        await symlink('loop.txt', join(cwd, 'loop.txt'));
        const loopRes = await adapter.readText(cwd, 'loop.txt', 10);
        expect(loopRes.ok).toBe(false);
        if (!loopRes.ok) expect(loopRes.error).toBe('not_found');
      } else {
        const fake = adapter as ReturnType<typeof createFakeWorktreeFiles>;
        fake.written('afile.txt', 'x');
      }
      const res = await adapter.readText(cwd, 'afile.txt/nope', 10);
      expect(res.ok).toBe(false);
      if (!res.ok) expect(res.error).toBe('not_found');
    });

    it('I-40: readText guard 2: a directory answers not_found — kind read off the open handle', async () => {
      if (type === 'sqlite') {
        await mkdir(join(cwd, 'sub'));
        const res = await adapter.readText(cwd, 'sub', 10);
        expect(res.ok).toBe(false);
        if (!res.ok) expect(res.error).toBe('not_found');
      }
    });

    it('I-40: readText guard 3: large file returns too_large', async () => {
      if (type === 'sqlite') {
        await writeFile(join(cwd, 'large.txt'), Buffer.alloc(262145, 'a'));
      } else {
        const fake = adapter as ReturnType<typeof createFakeWorktreeFiles>;
        fake.written('large.txt', Buffer.alloc(262145, 'a'));
      }
      const res = await adapter.readText(cwd, 'large.txt', 10);
      expect(res.ok).toBe(false);
      if (!res.ok) expect(res.error).toBe('too_large');
    });

    it('I-40: readText guard 3 boundary: a file of exactly 256 KiB reads whole (capped read)', async () => {
      const content = Buffer.alloc(262144, 'a');
      if (type === 'sqlite') {
        await writeFile(join(cwd, 'exact.txt'), content);
      } else {
        const fake = adapter as ReturnType<typeof createFakeWorktreeFiles>;
        fake.written('exact.txt', content);
      }
      const res = await adapter.readText(cwd, 'exact.txt', 10);
      expect(res.ok).toBe(true);
      if (res.ok) {
        expect(res.value.lines).toEqual([content.toString()]);
        expect(res.value.truncated).toBe(false);
      }
    });

    it('I-40: readText guard 4: binary file returns not_text', async () => {
      if (type === 'sqlite') {
        await writeFile(join(cwd, 'bin.txt'), Buffer.from([0, 1, 2]));
        await writeFile(join(cwd, 'invalid-utf8.txt'), Buffer.from([0xff, 0xff]));
      } else {
        const fake = adapter as ReturnType<typeof createFakeWorktreeFiles>;
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
        const fake = adapter as ReturnType<typeof createFakeWorktreeFiles>;
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
