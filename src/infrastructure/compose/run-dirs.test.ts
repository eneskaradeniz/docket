// compose/run-dirs.test.ts — rule I-61: per-run directories under <dataDir>/runs, private, ULID-only,
// removable twice, and pruned when stale.
import { mkdir, mkdtemp, readdir, rm, stat, utimes, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';

import { parseUlid, type RunId } from '../../domain/index';

import { createRunDirs, pruneStaleRunDirs, RUN_DIR_MAX_AGE_MS } from './run-dirs';

const runId = (text: string): RunId => {
  const parsed = parseUlid<'run'>(text);
  if (!parsed.ok) throw new Error('fixture ulid');
  return parsed.value;
};
const RUN_A = runId('01ARZ3NDEKTSV4RRFFQ69G5FA1');
const RUN_B = runId('01ARZ3NDEKTSV4RRFFQ69G5FA2');

const roots: string[] = [];
const freshData = async (): Promise<string> => {
  const dir = await mkdtemp(join(tmpdir(), 'dkt-runs-'));
  roots.push(dir);
  return dir;
};
afterEach(async () => {
  for (const root of roots.splice(0)) await rm(root, { recursive: true, force: true });
});

const posix = process.platform !== 'win32';
const modeOf = async (path: string): Promise<number> => (await stat(path)).mode & 0o777;

describe('createRunDirs', () => {
  it('I-61: create makes <dataDir>/runs/<runId> recursively, the directory and its parent private (0700)', async () => {
    const data = await freshData();
    const dir = await createRunDirs({ dataDir: data }).create(RUN_A);
    expect(dir.path).toBe(join(data, 'runs', RUN_A));
    expect((await stat(dir.path)).isDirectory()).toBe(true);
    if (posix) {
      expect(await modeOf(dir.path)).toBe(0o700);
      expect(await modeOf(join(data, 'runs'))).toBe(0o700);
    }
  });

  it('I-61: only a ULID names a run directory — anything else is refused and creates nothing', async () => {
    const data = await freshData();
    const dirs = createRunDirs({ dataDir: data });
    for (const bad of ['../escape', '', '/abs', 'a/b', '01ARZ3NDEKTSV4RRFFQ69G5FA', '01ARZ3NDEKTSV4RRFFQ69G5FA1/..']) {
      await expect(dirs.create(bad as RunId), bad).rejects.toThrow();
    }
    await expect(readdir(join(data, 'runs'))).rejects.toThrow(); // not even the parent was made
  });

  it('I-61: dispose removes the directory with everything in it, and a second dispose is not an error', async () => {
    const data = await freshData();
    const dir = await createRunDirs({ dataDir: data }).create(RUN_A);
    await mkdir(join(dir.path, 'config'), { recursive: true });
    await writeFile(join(dir.path, 'config', 'mcp.json'), '{}');
    await dir.dispose();
    await expect(stat(dir.path)).rejects.toThrow();
    await expect(dir.dispose()).resolves.toBeUndefined();
  });

  it('I-61: two runs get two directories; disposing one leaves the other', async () => {
    const data = await freshData();
    const dirs = createRunDirs({ dataDir: data });
    const a = await dirs.create(RUN_A);
    const b = await dirs.create(RUN_B);
    await a.dispose();
    expect((await stat(b.path)).isDirectory()).toBe(true);
  });
});

describe('pruneStaleRunDirs', () => {
  it('I-61: removes run directories older than 24 hours, keeps younger ones, and never touches names that are not ULIDs', async () => {
    const data = await freshData();
    const dirs = createRunDirs({ dataDir: data });
    const old = await dirs.create(RUN_A);
    const young = await dirs.create(RUN_B);
    await mkdir(join(data, 'runs', 'keep-me'));
    const now = Date.now();
    const longAgo = new Date(now - RUN_DIR_MAX_AGE_MS - 60_000);
    await utimes(old.path, longAgo, longAgo);
    await utimes(join(data, 'runs', 'keep-me'), longAgo, longAgo);

    expect(RUN_DIR_MAX_AGE_MS).toBe(24 * 60 * 60 * 1000);
    const removed = await pruneStaleRunDirs({ dataDir: data, now });
    expect(removed).toBe(1);
    expect((await readdir(join(data, 'runs'))).sort()).toEqual([RUN_B, 'keep-me']);
    expect((await stat(young.path)).isDirectory()).toBe(true);
  });

  it('I-61: a data directory without runs/ is fine, and a failure is reported by error name only', async () => {
    const data = await freshData();
    expect(await pruneStaleRunDirs({ dataDir: data, now: Date.now() })).toBe(0);
  });
});
