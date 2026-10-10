// In-memory PageFiles — carries the real adapter's contract: paths re-validated, a version written
// whole and only once, reads of anything invalid or absent answer undefined.
import { isUlid, pathsCollide, validatePagePath, type PageId } from '../../../domain/index';

import type { PageFiles } from '../page-files';

export interface FakePageFiles extends PageFiles {
  /** Test helper: the "<page>/v<n>" versions currently stored, sorted. */
  versions(): readonly string[];
}

export const createFakePageFiles = (): FakePageFiles => {
  const stored = new Map<string, ReadonlyMap<string, Uint8Array>>();
  const key = (page: PageId, n: number): string => `${page}/v${n}`;
  const validVersion = (page: PageId, n: number): boolean => isUlid(page) && Number.isInteger(n) && n >= 1;

  return {
    write: async (page, n, files): Promise<void> => {
      if (!validVersion(page, n)) throw new Error('invalid page id or version');
      const next = new Map<string, Uint8Array>();
      for (const file of files) {
        if (!validatePagePath(file.path)) throw new Error('invalid page file path');
        next.set(file.path, new Uint8Array(file.bytes));
      }
      if (pathsCollide(files.map((file) => file.path))) throw new Error('page file paths collide');
      if (stored.has(key(page, n))) throw new Error('page version already exists');
      stored.set(key(page, n), next);
    },

    read: async (page, n, path): Promise<Uint8Array | undefined> => {
      if (!validVersion(page, n) || !validatePagePath(path)) return undefined;
      const found = stored.get(key(page, n))?.get(path);
      return found === undefined ? undefined : new Uint8Array(found);
    },

    remove: async (page, n): Promise<void> => {
      if (!validVersion(page, n)) throw new Error('invalid page id or version');
      stored.delete(key(page, n));
    },

    versions: (): readonly string[] => [...stored.keys()].sort(),
  };
};
