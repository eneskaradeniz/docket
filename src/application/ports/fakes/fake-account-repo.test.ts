import { describe, expect, it } from 'vitest';

import type { AccountRecord } from '../account-repo';
import { parseUlid, type AccountId, type Meter, type MeterId, type Pool, type PoolId, type WorkOrderId, type RepoSlug } from '../../../domain/index';

import { createFakeAccountRepo } from './fake-account-repo';

const U1 = '01ARZ3NDEKTSV4RRFFQ69G5FAV';
const U2 = '01ARZ3NDEKTSV4RRFFQ69G5FAW';
const U3 = '01ARZ3NDEKTSV4RRFFQ69G5FAX';
const U4 = '01ARZ3NDEKTSV4RRFFQ69G5FAY';

const idOf = (s: string): AccountId => {
  const parsed = parseUlid<'account'>(s);
  if (!parsed.ok) throw new Error('fixture ulid must parse');
  return parsed.value;
};

const poolIdOf = (s: string): PoolId => {
  const parsed = parseUlid<'pool'>(s);
  if (!parsed.ok) throw new Error('fixture ulid must parse');
  return parsed.value;
};

const woIdOf = (s: string): WorkOrderId => {
  const parsed = parseUlid<'work-order'>(s);
  if (!parsed.ok) throw new Error('fixture ulid must parse');
  return parsed.value;
};

const REPO = 'acme' as RepoSlug;
const OTHER_REPO = 'other' as RepoSlug;

const account = (id: string, label: string): AccountRecord => ({
  id: idOf(id),
  provider: 'provider-x',
  label,
  authMode: 'subscription',
  limitPolicy: 'ask',
  caps: [],
});

const pool = (id: string, accountId: string): Pool => ({
  id: poolIdOf(id),
  accountId: idOf(accountId),
  label: `pool ${id}`,
  kind: 'allowance',
  appliesTo: 'all',
});

const meterIdOf = (s: string): MeterId => {
  const parsed = parseUlid<'meter'>(s);
  if (!parsed.ok) throw new Error('fixture ulid must parse');
  return parsed.value;
};

const meter = (id: string, poolId: string): Meter => ({
  id: meterIdOf(id),
  poolId: poolIdOf(poolId),
  cadence: 'none',
  unit: 'usd',
  resetPrecision: 'exact',
  observedAt: 1,
  source: 'pushed',
});

describe('createFakeAccountRepo', () => {
  it('save upserts, get/list round-trip the records, and list returns a copy', async () => {
    const repo = createFakeAccountRepo();
    await repo.save(account(U1, 'first'));
    await repo.save(account(U2, 'second'));
    await repo.save(account(U1, 'renamed'));

    expect(await repo.get(idOf(U1))).toEqual(account(U1, 'renamed'));
    expect((await repo.list()).map((a) => a.id)).toEqual([idOf(U1), idOf(U2)]);

    const first = await repo.list();
    const second = await repo.list();
    expect(first).not.toBe(second);
    (first as AccountRecord[]).push(account(U3, 'third'));
    expect(await repo.list()).toHaveLength(2);
  });

  it('get of an unknown account is undefined', async () => {
    const repo = createFakeAccountRepo();
    expect(await repo.get(idOf(U1))).toBeUndefined();
  });

  it('savePools replaces the account’s pools; pools() lists all, pools(accountId) filters', async () => {
    const repo = createFakeAccountRepo();
    await repo.savePools(idOf(U1), [pool(U3, U1)]);
    await repo.savePools(idOf(U2), [pool(U4, U2)]);
    expect((await repo.pools()).map((p) => p.id)).toEqual([poolIdOf(U3), poolIdOf(U4)]);

    await repo.savePools(idOf(U1), [pool(U3, U1), pool(U4, U1)]);
    expect((await repo.pools(idOf(U1))).map((p) => p.id)).toEqual([poolIdOf(U3), poolIdOf(U4)]);
    expect((await repo.pools(idOf(U2))).map((p) => p.id)).toEqual([poolIdOf(U4)]);
  });

  it('saveMeter upserts by id; meters() lists all, meters(accountId) filters through pool ownership', async () => {
    const repo = createFakeAccountRepo();
    await repo.savePools(idOf(U1), [pool(U3, U1)]);
    await repo.savePools(idOf(U2), [pool(U4, U2)]);

    await repo.saveMeter(meter(U1, U3));
    await repo.saveMeter(meter(U2, U4));
    await repo.saveMeter({ ...meter(U1, U3), used: 5 });

    expect((await repo.meters()).map((m) => m.id)).toEqual([poolIdOf(U1), poolIdOf(U2)]);
    expect((await repo.meters(idOf(U1))).map((m) => m.id)).toEqual([poolIdOf(U1)]);
    expect((await repo.meters(idOf(U1)))[0]?.used).toBe(5);
    expect(await repo.meters(idOf(U2))).toHaveLength(1);
  });

  it('spend sums entries filtered by account, repo and work order over an inclusive range', async () => {
    const repo = createFakeAccountRepo();
    const wo1 = woIdOf(U1);
    const wo2 = woIdOf(U2);
    await repo.recordSpend({ accountId: idOf(U1), repo: REPO, workOrderId: wo1, at: 10, usd: 1 });
    await repo.recordSpend({ accountId: idOf(U1), repo: REPO, workOrderId: wo1, at: 20, usd: 2 });
    await repo.recordSpend({ accountId: idOf(U1), repo: OTHER_REPO, workOrderId: wo2, at: 30, usd: 4 });
    await repo.recordSpend({ accountId: idOf(U2), repo: REPO, workOrderId: wo1, at: 40, usd: 8 });

    expect(await repo.spend({ from: 0, to: 100 })).toBe(15);
    expect(await repo.spend({ from: 20, to: 30 })).toBe(6);
    expect(await repo.spend({ accountId: idOf(U1), from: 0, to: 100 })).toBe(7);
    expect(await repo.spend({ repo: OTHER_REPO, from: 0, to: 100 })).toBe(4);
    expect(await repo.spend({ workOrderId: wo1, from: 0, to: 100 })).toBe(11);
    expect(await repo.spend({ from: 100, to: 200 })).toBe(0);
  });

  it('remove deletes the account with its pools and meters but keeps spend history', async () => {
    const repo = createFakeAccountRepo();
    await repo.save(account(U1, 'first'));
    await repo.savePools(idOf(U1), [pool(U3, U1)]);
    await repo.saveMeter(meter(U4, U3));
    await repo.recordSpend({ accountId: idOf(U1), repo: REPO, workOrderId: woIdOf(U2), at: 1, usd: 3 });

    await repo.remove(idOf(U1));

    expect(await repo.get(idOf(U1))).toBeUndefined();
    expect(await repo.list()).toEqual([]);
    expect(await repo.pools()).toEqual([]);
    expect(await repo.meters()).toEqual([]);
    expect(await repo.spend({ from: 0, to: 10 })).toBe(3);
  });

  it('remove of an unknown account is a no-op', async () => {
    const repo = createFakeAccountRepo();
    await expect(repo.remove(idOf(U1))).resolves.toBeUndefined();
  });
});
