// Machine-local repo registry over the repoId key: the parity suite runs the same behaviour
// cases against the in-memory fake and the SQLite adapter (I-5); durability (I-8) runs on a
// throw-away file under os.tmpdir().
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import type { ReadRepoFingerprint, RepoFingerprint, RepoRegistry, RepoRegistryEntry } from '../../../application/index';
import { createFakeRepoRegistry } from '../../../application/ports/fakes/index';
import type { RepoSlug } from '../../../domain/index';
import { isUlid, parseSlug } from '../../../domain/index';

import { openDatabase, type DocketDb } from './database';
import { createSqliteRepoRegistry } from './repo-registry';

const slug = (s: string): RepoSlug => {
  const parsed = parseSlug<'repo'>(s);
  if (!parsed.ok) throw new Error('fixture slug must parse');
  return parsed.value;
};

const fingerprint = (rootCommit: string, remote?: string): RepoFingerprint =>
  remote === undefined ? { rootCommit } : { rootCommit, remote };

const entry = (overrides?: Partial<RepoRegistryEntry>): RepoRegistryEntry => ({
  repoId: '01ARZ3NDEKTSV4RRFFQ69G5FR01',
  slug: slug('acme'),
  path: '/x/acme',
  fingerprint: { rootCommit: 'sha-root-1' },
  ...overrides,
});

/** The relink cases need a folder state the reader answers from; one map per suite keeps the fake
 *  and the SQLite registry reading the same folders. */
const fingerprintSource = (): {
  readonly read: ReadRepoFingerprint;
  set(path: string, value: RepoFingerprint | undefined): void;
} => {
  const map = new Map<string, RepoFingerprint>();
  return {
    read: async (path: string): Promise<RepoFingerprint | undefined> => map.get(path),
    set: (path: string, value: RepoFingerprint | undefined): void => {
      if (value === undefined) map.delete(path);
      else map.set(path, value);
    },
  };
};

interface Suite {
  readonly registry: RepoRegistry;
  readonly folders: ReturnType<typeof fingerprintSource>;
}

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

const suites: readonly (readonly [string, () => Suite])[] = [
  [
    'fake',
    (): Suite => {
      const folders = fingerprintSource();
      return { registry: createFakeRepoRegistry(folders.read), folders };
    },
  ],
  [
    'sqlite',
    (): Suite => {
      const folders = fingerprintSource();
      return { registry: createSqliteRepoRegistry(openDb(':memory:'), folders.read), folders };
    },
  ],
];

describe.each(suites)('repo registry (%s)', (_kind, make) => {
  it('I-5: register, byRepoId and list answer the same cases — slug asc, unknown ids undefined', async () => {
    const { registry } = make();
    const acme = entry();
    const zulu = entry({ repoId: '01ARZ3NDEKTSV4RRFFQ69G5FR02', slug: slug('zulu'), path: '/x/zulu' });

    await registry.register(acme);
    await registry.register(zulu);

    expect(await registry.byRepoId(acme.repoId)).toEqual(acme);
    expect(await registry.byRepoId(zulu.repoId)).toEqual(zulu);
    expect(await registry.byRepoId('01ARZ3NDEKTSV4RRFFQ69G5F999')).toBeUndefined();
    expect(await registry.list()).toEqual([acme, zulu]);
  });

  it('I-94: register upserts by repoId; a slug held by another repoId throws', async () => {
    const { registry } = make();
    await registry.register(entry());

    // Same repoId, new folder: an upsert, not a second identity.
    await registry.register(entry({ path: '/x/acme-moved' }));
    expect(await registry.byRepoId(entry().repoId)).toEqual(entry({ path: '/x/acme-moved' }));
    expect(await registry.list()).toHaveLength(1);

    // The slug belongs to the first repoId; the unique index refuses a second owner.
    await expect(
      registry.register(entry({ repoId: '01ARZ3NDEKTSV4RRFFQ69G5FR03' })),
    ).rejects.toThrow();
  });

  it('I-6: a registry entry read back deep-equals the record written — absent optionals stay absent', async () => {
    const { registry } = make();
    const bare = entry({ repoId: '01ARZ3NDEKTSV4RRFFQ69G5FR04' });
    const full = entry({
      repoId: '01ARZ3NDEKTSV4RRFFQ69G5FR05',
      slug: slug('full'),
      path: '/x/full',
      fingerprint: fingerprint('sha-root-9', 'git@host:team/full'),
    });

    await registry.register(bare);
    await registry.register(full);

    expect(await registry.byRepoId(bare.repoId)).toStrictEqual(bare);
    expect(await registry.byRepoId(full.repoId)).toStrictEqual(full);
    expect((await registry.byRepoId(bare.repoId))?.fingerprint).toStrictEqual({ rootCommit: 'sha-root-1' });
  });

  it('I-88: relink refuses a missing folder, accepts an equal rootCommit, refuses a different one — never applied silently', async () => {
    const { registry, folders } = make();
    const stored = entry({ fingerprint: fingerprint('sha-root-1') });
    await registry.register(stored);

    // The candidate folder reads no fingerprint: not a work tree with commits.
    folders.set('/x/acme-moved', undefined);
    expect(await registry.relink(stored.repoId, '/x/acme-moved')).toEqual({ ok: false, error: 'folder_not_found' });

    // An equal rootCommit is the relink the operator confirmed.
    folders.set('/x/acme-moved', fingerprint('sha-root-1'));
    expect(await registry.relink(stored.repoId, '/x/acme-moved')).toEqual({ ok: true, value: undefined });
    expect(await registry.byRepoId(stored.repoId)).toEqual(entry({ path: '/x/acme-moved' }));

    // A different rootCommit is refused and the stored entry keeps its folder.
    const other = entry({ repoId: '01ARZ3NDEKTSV4RRFFQ69G5FR07', slug: slug('other'), fingerprint: fingerprint('sha-other') });
    await registry.register(other);
    folders.set('/x/clone-of-something-else', fingerprint('sha-root-2'));
    expect(await registry.relink(other.repoId, '/x/clone-of-something-else')).toEqual({ ok: false, error: 'fingerprint_mismatch' });
    expect(await registry.byRepoId(other.repoId)).toEqual(other);
  });

  it('I-94: relink refuses folder_not_found and fingerprint_mismatch, accepts equal (or backfills "") rootCommit', async () => {
    const { registry, folders } = make();

    // An unknown repoId has no folder to offer: the port's union has no not_found (the api adds it).
    expect(await registry.relink('01ARZ3NDEKTSV4RRFFQ69G5F998', '/x/anywhere')).toEqual({ ok: false, error: 'folder_not_found' });

    // Migration 11's stance: a stored '' rootCommit is backfilled from the candidate folder.
    const seeded = entry({ repoId: '01ARZ3NDEKTSV4RRFFQ69G5FR08', fingerprint: fingerprint('') });
    await registry.register(seeded);
    folders.set('/x/acme-moved', fingerprint('sha-root-1', 'https://example.com/acme'));
    expect(await registry.relink(seeded.repoId, '/x/acme-moved')).toEqual({ ok: true, value: undefined });
    expect(await registry.byRepoId(seeded.repoId)).toEqual(
      entry({ repoId: seeded.repoId, path: '/x/acme-moved', fingerprint: fingerprint('sha-root-1', 'https://example.com/acme') }),
    );
  });
});

describe('repo registry (sqlite durability)', () => {
  it('I-8: registry entries survive close and reopen', async () => {
    const file = join(tmp, 'docket.db');
    const first = openDatabase(file);
    if (!first.ok) throw new Error('open must succeed');
    const folders = fingerprintSource();
    await createSqliteRepoRegistry(first.value, folders.read).register(entry({ fingerprint: fingerprint('sha-root-1', 'git@host:team/acme') }));
    first.value.close();

    const second = openDatabase(file);
    if (!second.ok) throw new Error('reopen must succeed');
    openDbs.push(second.value);
    const reopened = createSqliteRepoRegistry(second.value, folders.read);
    expect(await reopened.list()).toEqual([entry({ fingerprint: fingerprint('sha-root-1', 'git@host:team/acme') })]);
    expect(await reopened.byRepoId(entry().repoId)).toEqual(entry({ fingerprint: fingerprint('sha-root-1', 'git@host:team/acme') }));
  });

  it('I-8: many entries round-trip with unique identities, each repoId passing the domain pattern', async () => {
    const db = openDb(':memory:');
    const folders = fingerprintSource();
    const registry = createSqliteRepoRegistry(db, folders.read);
    for (let i = 0; i < 50; i += 1) {
      await registry.register(
        entry({ repoId: `01ARZ3NDEKTSV4RRFFQ69G5F${String(i).padStart(2, '0')}`, slug: slug(`repo-${i}`) }),
      );
    }
    const listed = await registry.list();
    expect(listed).toHaveLength(50);
    expect(new Set(listed.map((item) => item.repoId)).size).toBe(50);
    for (const item of listed) expect(isUlid(item.repoId)).toBe(true);
  });
});
