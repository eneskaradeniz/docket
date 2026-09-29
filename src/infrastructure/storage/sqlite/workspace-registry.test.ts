// Direct tests for the machine-local repo registry (rules I-6, I-8); the port has no fake.
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import type { RepoSlug } from '../../../domain/index';

import { openDatabase, type DocketDb } from './database';
import { createSqliteRepoRegistry } from './workspace-registry';

const slug = (s: string): RepoSlug => s as RepoSlug;

let tmp: string;
let openHandles: DocketDb[];

beforeEach(() => {
  tmp = mkdtempSync(join(tmpdir(), 'docket-sqlite-registry-'));
  openHandles = [];
});

afterEach(() => {
  for (const db of openHandles.splice(0)) db.close();
  rmSync(tmp, { recursive: true, force: true });
});

function openDb(path: string): DocketDb {
  const result = openDatabase(path);
  if (!result.ok) throw new Error(`expected openDatabase(${path}) to succeed`);
  openHandles.push(result.value);
  return result.value;
}

function closeDb(db: DocketDb): void {
  db.close();
  const index = openHandles.indexOf(db);
  if (index >= 0) openHandles.splice(index, 1);
}

describe('createSqliteRepoRegistry', () => {
  it('I-6: register then path and list round-trip the slug and the absolute path exactly', async () => {
    const registry = createSqliteRepoRegistry(openDb(':memory:'));
    const checkoutA = join(tmp, 'checkout-a');
    const checkoutB = join(tmp, 'nested', 'checkout-b');
    await registry.register(slug('acme'), checkoutA);
    await registry.register(slug('other'), checkoutB);

    expect(await registry.path(slug('acme'))).toBe(checkoutA);
    expect(await registry.path(slug('other'))).toBe(checkoutB);
    expect(await registry.path(slug('unknown'))).toBeUndefined();
    expect(await registry.list()).toEqual([
      { slug: slug('acme'), path: checkoutA },
      { slug: slug('other'), path: checkoutB },
    ]);
  });

  it('register is an upsert — a second register for the same slug replaces the path', async () => {
    const registry = createSqliteRepoRegistry(openDb(':memory:'));
    const first = join(tmp, 'first');
    const second = join(tmp, 'second');
    await registry.register(slug('acme'), first);
    await registry.register(slug('acme'), second);

    expect(await registry.path(slug('acme'))).toBe(second);
    expect(await registry.list()).toEqual([{ slug: slug('acme'), path: second }]);
  });

  it('list orders by slug asc regardless of registration order', async () => {
    const registry = createSqliteRepoRegistry(openDb(':memory:'));
    await registry.register(slug('zulu'), join(tmp, 'zulu'));
    await registry.register(slug('alpha'), join(tmp, 'alpha'));
    await registry.register(slug('mid-2'), join(tmp, 'mid2'));
    await registry.register(slug('mid-1'), join(tmp, 'mid1'));

    expect((await registry.list()).map((entry) => entry.slug)).toEqual([slug('alpha'), slug('mid-1'), slug('mid-2'), slug('zulu')]);
  });

  it('remove deletes the row, makes path undefined, and is a no-op for unknown slugs', async () => {
    const registry = createSqliteRepoRegistry(openDb(':memory:'));
    await registry.register(slug('acme'), join(tmp, 'acme'));
    await registry.register(slug('other'), join(tmp, 'other'));

    await registry.remove(slug('acme'));
    expect(await registry.path(slug('acme'))).toBeUndefined();
    expect(await registry.list()).toEqual([{ slug: slug('other'), path: join(tmp, 'other') }]);

    await expect(registry.remove(slug('acme'))).resolves.toBeUndefined();
    expect(await registry.list()).toHaveLength(1);
  });

  it('an empty registry lists as an empty array and every path is undefined', async () => {
    const registry = createSqliteRepoRegistry(openDb(':memory:'));
    expect(await registry.list()).toEqual([]);
    expect(await registry.path(slug('acme'))).toBeUndefined();
  });

  it('I-8: registrations and removes survive a close and reopen on the same file', async () => {
    const path = join(tmp, 'docket.db');
    const first = openDb(path);
    const registry = createSqliteRepoRegistry(first);
    const kept = join(tmp, 'kept');
    await registry.register(slug('acme'), kept);
    await registry.register(slug('gone'), join(tmp, 'gone'));
    await registry.remove(slug('gone'));
    await registry.register(slug('later'), join(tmp, 'later'));
    closeDb(first);

    const second = openDb(path);
    const reopened = createSqliteRepoRegistry(second);
    expect(await reopened.path(slug('acme'))).toBe(kept);
    expect(await reopened.path(slug('gone'))).toBeUndefined();
    expect(await reopened.list()).toEqual([
      { slug: slug('acme'), path: kept },
      { slug: slug('later'), path: join(tmp, 'later') },
    ]);
  });
});
