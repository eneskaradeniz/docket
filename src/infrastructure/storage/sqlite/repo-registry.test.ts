// Machine-local repo registry over SQLite: the parity suite runs the same behaviour cases
// against the in-memory fake and the SQLite adapter (I-5); durability (I-8) runs on a throw-away
// file under os.tmpdir().
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import type { RepoRegistry } from '../../../application/index';
import { createFakeRepoRegistry } from '../../../application/ports/fakes/index';
import type { RepoSlug } from '../../../domain/index';
import { parseSlug } from '../../../domain/index';

import { openDatabase, type DocketDb } from './database';
import { createSqliteRepoRegistry } from './repo-registry';

const slug = (s: string): RepoSlug => {
  const parsed = parseSlug<'repo'>(s);
  if (!parsed.ok) throw new Error('fixture slug must parse');
  return parsed.value;
};

let tmp: string;
const openDbs: DocketDb[] = [];

beforeEach(() => {
  tmp = mkdtempSync(join(tmpdir(), 'docket-sqlite-registry-'));
});

afterEach(() => {
  for (const db of openDbs.splice(0)) db.close();
  rmSync(tmp, { recursive: true, force: true });
});

function openDb(path: string): DocketDb {
  const opened = openDatabase(path);
  if (!opened.ok) throw new Error('openDatabase must succeed');
  openDbs.push(opened.value);
  return opened.value;
}

/** Closes now without tripping the afterEach sweep a second time. */
function closeDb(db: DocketDb): void {
  db.close();
  const index = openDbs.indexOf(db);
  if (index >= 0) openDbs.splice(index, 1);
}

const suites: readonly (readonly [string, () => RepoRegistry])[] = [
  ['fake', (): RepoRegistry => createFakeRepoRegistry()],
  ['sqlite', (): RepoRegistry => createSqliteRepoRegistry(openDb(':memory:'))],
];

describe.each(suites)('repo registry (%s)', (_kind, make) => {
  it('I-6: register then path and list round-trip the slug and the absolute path exactly', async () => {
    const registry = make();
    const path = join(tmp, 'acme');

    await registry.register(slug('acme'), path);

    expect(await registry.path(slug('acme'))).toBe(path);
    expect(await registry.list()).toEqual([{ slug: slug('acme'), path }]);
  });

  it('register is an upsert — a second register for the same slug replaces the path', async () => {
    const registry = make();

    await registry.register(slug('acme'), join(tmp, 'one'));
    await registry.register(slug('acme'), join(tmp, 'two'));

    expect(await registry.path(slug('acme'))).toBe(join(tmp, 'two'));
    expect(await registry.list()).toEqual([{ slug: slug('acme'), path: join(tmp, 'two') }]);
  });

  it('list orders by slug asc regardless of registration order', async () => {
    const registry = make();

    await registry.register(slug('zulu'), join(tmp, 'zulu'));
    await registry.register(slug('alpha'), join(tmp, 'alpha'));
    await registry.register(slug('mid-2'), join(tmp, 'mid2'));
    await registry.register(slug('mid-1'), join(tmp, 'mid1'));

    expect((await registry.list()).map((entry) => entry.slug)).toEqual([slug('alpha'), slug('mid-1'), slug('mid-2'), slug('zulu')]);
  });

  it('remove deletes the row, makes path undefined, and is a no-op for unknown slugs', async () => {
    const registry = make();

    await registry.register(slug('acme'), join(tmp, 'acme'));
    await registry.remove(slug('acme'));
    await registry.remove(slug('ghost'));

    expect(await registry.path(slug('acme'))).toBeUndefined();
    expect(await registry.list()).toEqual([]);
  });

  it('an empty registry lists as an empty array and every path is undefined', async () => {
    const registry = make();

    expect(await registry.list()).toEqual([]);
    expect(await registry.path(slug('acme'))).toBeUndefined();
  });
});

describe('createSqliteRepoRegistry (sqlite rules)', () => {
  it('I-8: registrations and removes survive a close and reopen on the same file', async () => {
    const file = join(tmp, 'docket.db');
    const first = openDb(file);

    await createSqliteRepoRegistry(first).register(slug('acme'), join(tmp, 'acme'));
    await createSqliteRepoRegistry(first).register(slug('zulu'), join(tmp, 'zulu'));
    await createSqliteRepoRegistry(first).remove(slug('zulu'));
    closeDb(first);

    const second = openDb(file);
    const registry = createSqliteRepoRegistry(second);
    expect(await registry.list()).toEqual([{ slug: slug('acme'), path: join(tmp, 'acme') }]);
    expect(await registry.path(slug('zulu'))).toBeUndefined();
  });
});
