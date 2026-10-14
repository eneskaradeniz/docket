import { lstat, readdir, readFile } from 'node:fs/promises';
import { join } from 'node:path';

import type { DiscoveredRepo } from '../../domain/index';
import { err, ok } from '../../domain/index';
import type { RepoScanner } from '../../application/ports/repo-scanner';

const MAX_READ = 200;
const MAX_RETURN = 50;

const isGitAt = async (dir: string): Promise<boolean> => {
  try {
    const dotGit = await lstat(join(dir, '.git'));
    return dotGit.isDirectory() || dotGit.isFile();
  } catch {
    return false;
  }
};

export const detectRepoPaths = async (folder: string): Promise<{ readonly docsRoot: string; readonly testGlobs: readonly string[] }> => {
  let names: readonly string[] = [];
  try {
    const entries = await readdir(folder, { withFileTypes: true });
    names = entries.filter((entry) => entry.isFile() || entry.isDirectory()).map((entry) => entry.name);
  } catch {
    return { docsRoot: 'docs', testGlobs: ['**/*.test.ts'] };
  }
  const docsRoot = names.includes('docs') ? 'docs' : names.includes('doc') ? 'doc' : 'docs';
  let testGlobs: readonly string[] = ['**/*.test.ts'];
  if (names.includes('package.json')) {
    try {
      const raw = await readFile(join(folder, 'package.json'), 'utf8');
      const parsed = JSON.parse(raw) as { scripts?: Record<string, string> };
      if (parsed.scripts?.test !== undefined) testGlobs = ['**/*.test.ts', '**/*.spec.ts'];
    } catch {
      testGlobs = ['**/*.test.ts'];
    }
  }
  return { docsRoot, testGlobs };
};

export const createRepoScanner = (): RepoScanner => ({
  detect: detectRepoPaths,
  list: async (parent) => {
    let entries;
    try {
      entries = await readdir(parent, { withFileTypes: true });
    } catch (cause: unknown) {
      const code = (cause as { code?: string }).code;
      if (code === 'ENOENT') return err('not_found');
      if (code === 'ENOTDIR') return err('not_a_directory');
      return err('unreadable');
    }
    const found: DiscoveredRepo[] = [];
    let read = 0;
    for (const entry of entries) {
      if (entry.name.startsWith('.')) continue;
      if (entry.isSymbolicLink()) continue;
      if (!entry.isDirectory()) continue;
      if (read >= MAX_READ) break;
      read += 1;
      const path = join(parent, entry.name);
      found.push({ name: entry.name, path, isGit: await isGitAt(path) });
    }
    found.sort((left, right) => left.name.localeCompare(right.name, undefined, { sensitivity: 'accent' }));
    const truncated = found.length > MAX_RETURN;
    return ok(truncated ? found.slice(0, MAX_RETURN) : found);
  },
});
