// Tests for the RepoFolders adapter (rule I-36). Real folders and real git in fs.mkdtemp folders;
// HOME is redirected so no test ever reads or writes the user's real git config.
import { mkdir, mkdtemp, readdir, readFile, rm, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { createGitProbe, runGit } from './git';
import { createRepoFolders } from './repo-folders';

let scratch = '';
let parent = '';
let savedHome: string | undefined;
let savedPath: string | undefined;

beforeEach(async () => {
  scratch = await mkdtemp(join(tmpdir(), 'docket-repo-folders-'));
  parent = join(scratch, 'parent');
  await mkdir(parent);
  savedHome = process.env.HOME;
  savedPath = process.env.PATH;
  process.env.HOME = join(scratch, 'home');
});

afterEach(async () => {
  if (savedHome === undefined) delete process.env.HOME;
  else process.env.HOME = savedHome;
  if (savedPath === undefined) delete process.env.PATH;
  else process.env.PATH = savedPath;
  await rm(scratch, { recursive: true, force: true });
});

describe('createRepo', () => {
  it('I-36: creates <parent>/<folder> as a git work tree on branch main and writes nothing else', async () => {
    const result = await createRepoFolders().createRepo(parent, 'atolye');

    expect(result).toEqual({ ok: true, value: { path: join(parent, 'atolye') } });
    expect(await createGitProbe().isWorkTree(join(parent, 'atolye'))).toBe(true);
    const head = await runGit(join(parent, 'atolye'), ['symbolic-ref', '--short', 'HEAD']);
    expect(head.stdout.trim()).toBe('main');
    expect(await readdir(parent)).toEqual(['atolye']);
    expect((await readdir(join(parent, 'atolye'))).sort()).toEqual(['.git']);
  });

  it('I-36: a parent that does not exist or is a file is not_a_folder and nothing is created', async () => {
    const file = join(scratch, 'a-file');
    await writeFile(file, 'x', 'utf8');

    expect(await createRepoFolders().createRepo(join(scratch, 'missing'), 'atolye')).toEqual({ ok: false, error: 'not_a_folder' });
    expect(await createRepoFolders().createRepo(file, 'atolye')).toEqual({ ok: false, error: 'not_a_folder' });
    expect(await readdir(scratch)).toEqual(['a-file', 'parent']);
  });

  it('I-36: a folder that exists in any form is folder_exists and stays untouched', async () => {
    await mkdir(join(parent, 'dir'));
    await writeFile(join(parent, 'dir', 'keep.txt'), 'mine', 'utf8');
    await writeFile(join(parent, 'file'), 'mine', 'utf8');
    await symlink(join(scratch, 'nowhere'), join(parent, 'dangling'));

    for (const name of ['dir', 'file', 'dangling']) {
      expect(await createRepoFolders().createRepo(parent, name)).toEqual({ ok: false, error: 'folder_exists' });
    }

    expect(await readdir(join(parent, 'dir'))).toEqual(['keep.txt']);
    expect(await readFile(join(parent, 'file'), 'utf8')).toBe('mine');
  });

  it('I-36: a git failure is io_failed, logged by name only, and the created folder is not removed', async () => {
    process.env.PATH = '';
    const names: string[] = [];

    const result = await createRepoFolders({ onError: (name) => names.push(name) }).createRepo(parent, 'atolye');

    expect(result).toEqual({ ok: false, error: 'io_failed' });
    expect(await readdir(parent)).toEqual(['atolye']);
    expect(names).toEqual(['git-init-exit-127']);
  });

  it('I-36: a folder name that could leave the parent is refused and nothing is created', async () => {
    for (const name of ['', '.', '..', 'a/b', 'a\\b']) {
      expect(await createRepoFolders().createRepo(parent, name)).toEqual({ ok: false, error: 'io_failed' });
    }
    expect(await readdir(parent)).toEqual([]);
  });
});
