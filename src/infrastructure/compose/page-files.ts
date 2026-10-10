// The PageFiles port over the real filesystem: <root>/pages/<pageId>/v<n>/<path>. A page is
// untrusted content, so every path is re-validated here even though the use case validated it
// first, nothing resolves outside the version directory, and no symlink is created, followed or
// written through. A version is staged in a temporary directory and renamed into place in one
// step, so a reader sees either the whole version or none of it.
import { constants } from 'node:fs';
import { lstat, mkdir, mkdtemp, open, realpath, rename, rm, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';

import type { PageFiles } from '../../application/index';
import { isUlid, pathsCollide, validatePagePath, type PageId } from '../../domain/index';

const NO_FOLLOW = constants.O_NOFOLLOW ?? 0; // absent on Windows, where the realpath check carries it

const validVersion = (page: PageId, n: number): boolean => isUlid(page) && Number.isInteger(n) && n >= 1;

/** The lstat of `path`, or undefined when nothing is there. */
const lstatIfPresent = async (path: string): Promise<Awaited<ReturnType<typeof lstat>> | undefined> => {
  try {
    return await lstat(path);
  } catch (failure) {
    if ((failure as NodeJS.ErrnoException).code === 'ENOENT') return undefined;
    throw failure;
  }
};

/** Makes sure `path` is a real directory (never a symlink to one), creating it when absent. */
const ensureRealDirectory = async (path: string): Promise<void> => {
  const found = await lstatIfPresent(path);
  if (found === undefined) {
    await mkdir(path);
    return;
  }
  if (found.isSymbolicLink() || !found.isDirectory()) throw new Error('page storage path is not a plain directory');
};

export const createFsPageFiles = (root: string): PageFiles => {
  const pagesDir = join(root, 'pages');
  const pageDir = (page: PageId): string => join(pagesDir, page);
  const versionDir = (page: PageId, n: number): string => join(pageDir(page), `v${n}`);

  return {
    write: async (page, n, files): Promise<void> => {
      if (!validVersion(page, n)) throw new Error('invalid page id or version');
      const paths = files.map((file) => file.path);
      if (!paths.every(validatePagePath) || pathsCollide(paths)) throw new Error('invalid page file paths');

      await mkdir(root, { recursive: true });
      await ensureRealDirectory(pagesDir);
      await ensureRealDirectory(pageDir(page));
      if ((await lstatIfPresent(versionDir(page, n))) !== undefined) throw new Error('page version already exists');

      const staging = await mkdtemp(join(pageDir(page), '.staging-'));
      try {
        for (const file of files) {
          const target = join(staging, ...file.path.split('/'));
          await mkdir(dirname(target), { recursive: true });
          // "wx": create-only, and never through a symlink at the target.
          await writeFile(target, file.bytes, { flag: 'wx' });
        }
        await rename(staging, versionDir(page, n));
      } catch (failure) {
        await rm(staging, { recursive: true, force: true });
        throw failure;
      }
    },

    read: async (page, n, path): Promise<Uint8Array | undefined> => {
      if (!validVersion(page, n) || !validatePagePath(path)) return undefined;
      const base = versionDir(page, n);
      const target = join(base, ...path.split('/'));
      try {
        // The resolved file must be exactly where the path says, measured from the resolved data
        // root: a symlink anywhere on the way (the pages, page or version directory included)
        // makes the two differ.
        const expected = join(await realpath(root), 'pages', page, `v${n}`, ...path.split('/'));
        if ((await realpath(target)) !== expected) return undefined;
        const handle = await open(target, constants.O_RDONLY | NO_FOLLOW);
        try {
          if (!(await handle.stat()).isFile()) return undefined;
          return new Uint8Array(await handle.readFile());
        } finally {
          await handle.close();
        }
      } catch {
        return undefined; // missing, unreadable or refused: the caller sees "no such file"
      }
    },

    remove: async (page, n): Promise<void> => {
      if (!validVersion(page, n)) throw new Error('invalid page id or version');
      // rm on a symlink removes the link, never the directory it points at.
      await rm(versionDir(page, n), { recursive: true, force: true });
    },
  };
};
