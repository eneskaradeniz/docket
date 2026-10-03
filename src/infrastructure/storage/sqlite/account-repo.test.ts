// Parity (I-5), round-trip (I-6) and durability (I-8) tests for the SQLite account repository.
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import type { AccountRecord, AccountRepo } from '../../../application/index';
import { createFakeAccountRepo } from '../../../application/ports/fakes/index';
import {
  parseUlid,
  type AccountId,
  type Meter,
  type MeterId,
  type Pool,
  type PoolId,
  type WorkOrderId,
  type RepoSlug,
  type ProjectSlug,
} from '../../../domain/index';

import { createSqliteAccountRepo } from './account-repo';
import { openDatabase, type DocketDb } from './database';

const A1 = '01ARZ3NDEKTSV4RRFFQ69G5FAV';
const A2 = '01ARZ3NDEKTSV4RRFFQ69G5FAW';
const A3 = '01ARZ3NDEKTSV4RRFFQ69G5FAX';
const P1 = '01ARZ3NDEKTSV4RRFFQ69G5FAY';
const P2 = '01ARZ3NDEKTSV4RRFFQ69G5FAZ';
const P3 = '01ARZ3NDEKTSV4RRFFQ69G5FB0';
const M1 = '01ARZ3NDEKTSV4RRFFQ69G5FB1';
const M2 = '01ARZ3NDEKTSV4RRFFQ69G5FB4';
const W1 = '01ARZ3NDEKTSV4RRFFQ69G5FB2';
const W2 = '01ARZ3NDEKTSV4RRFFQ69G5FB3';

const accountId = (s: string): AccountId => {
  const parsed = parseUlid<'account'>(s);
  if (!parsed.ok) throw new Error('fixture ulid must parse');
  return parsed.value;
};

const poolId = (s: string): PoolId => {
  const parsed = parseUlid<'pool'>(s);
  if (!parsed.ok) throw new Error('fixture ulid must parse');
  return parsed.value;
};

const meterId = (s: string): MeterId => {
  const parsed = parseUlid<'meter'>(s);
  if (!parsed.ok) throw new Error('fixture ulid must parse');
  return parsed.value;
};

const workOrderId = (s: string): WorkOrderId => {
  const parsed = parseUlid<'work-order'>(s);
  if (!parsed.ok) throw new Error('fixture ulid must parse');
  return parsed.value;
};

const REPO = 'acme' as RepoSlug;
const PROJECT = 'atolye' as ProjectSlug;
const OTHER_REPO = 'other' as RepoSlug;

const account = (id: string, label: string): AccountRecord => ({
  id: accountId(id),
  provider: 'provider-x',
  label,
  authMode: 'subscription',
  limitPolicy: 'ask',
  caps: [],
});

const pool = (id: string, owner: string): Pool => ({
  id: poolId(id),
  accountId: accountId(owner),
  label: `pool ${id}`,
  kind: 'allowance',
  appliesTo: 'all',
});

const meter = (id: string, owner: string): Meter => ({
  id: meterId(id),
  poolId: poolId(owner),
  cadence: 'none',
  unit: 'usd',
  resetPrecision: 'exact',
  observedAt: 1,
  source: 'pushed',
});

let tmp: string;
let openHandles: DocketDb[];

beforeEach(() => {
  tmp = mkdtempSync(join(tmpdir(), 'docket-sqlite-account-'));
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

describe('createSqliteAccountRepo', () => {
  describe.each([
    ['fake', (): AccountRepo => createFakeAccountRepo()],
    ['sqlite', (): AccountRepo => createSqliteAccountRepo(openDb(':memory:'))],
  ])('parity against the fake: %s', (_kind, makeRepo) => {
    it('I-5: save upserts, get and list round-trip the records, and an unknown id is undefined', async () => {
      const repo = makeRepo();
      await repo.save(account(A1, 'first'));
      await repo.save(account(A2, 'second'));
      await repo.save(account(A1, 'renamed'));

      expect(await repo.get(accountId(A1))).toStrictEqual(account(A1, 'renamed'));
      expect((await repo.list()).map((a) => a.id)).toEqual([accountId(A1), accountId(A2)]);
      expect(await repo.get(accountId(A3))).toBeUndefined();
    });

    it('I-5: savePools replaces the account’s pools; pools() lists all and pools(accountId) filters', async () => {
      const repo = makeRepo();
      await repo.savePools(accountId(A1), [pool(P1, A1)]);
      await repo.savePools(accountId(A2), [pool(P2, A2)]);
      expect((await repo.pools()).map((p) => p.id)).toEqual([poolId(P1), poolId(P2)]);

      await repo.savePools(accountId(A1), [pool(P1, A1), pool(P3, A1)]);
      expect((await repo.pools(accountId(A1))).map((p) => p.id)).toEqual([poolId(P1), poolId(P3)]);
      expect((await repo.pools(accountId(A2))).map((p) => p.id)).toEqual([poolId(P2)]);
      // The port promises no global order once an account’s list is replaced; compare as sets.
      expect((await repo.pools()).map((p) => p.id).sort()).toEqual([poolId(P1), poolId(P2), poolId(P3)].sort());
    });

    it('I-5: saveMeter upserts by id; meters() lists all and meters(accountId) filters through pool ownership', async () => {
      const repo = makeRepo();
      await repo.savePools(accountId(A1), [pool(P1, A1)]);
      await repo.savePools(accountId(A2), [pool(P2, A2)]);

      await repo.saveMeter(meter(M1, P1));
      await repo.saveMeter(meter(M2, P2));
      await repo.saveMeter({ ...meter(M1, P1), used: 5 });

      expect((await repo.meters()).map((m) => m.id)).toEqual([meterId(M1), meterId(M2)]);
      expect((await repo.meters(accountId(A1))).map((m) => m.id)).toEqual([meterId(M1)]);
      expect((await repo.meters(accountId(A1)))[0]?.used).toBe(5);
      expect(await repo.meters(accountId(A2))).toHaveLength(1);
    });

    it('I-5: remove drops the account’s pools and meters but keeps spend history', async () => {
      const repo = makeRepo();
      await repo.save(account(A1, 'first'));
      await repo.savePools(accountId(A1), [pool(P1, A1)]);
      await repo.saveMeter(meter(M1, P1));
      await repo.recordSpend({ accountId: accountId(A1), project: PROJECT, repo: REPO, workOrderId: workOrderId(W2), at: 1, usd: 3 });

      await repo.remove(accountId(A1));

      expect(await repo.get(accountId(A1))).toBeUndefined();
      expect(await repo.list()).toEqual([]);
      expect(await repo.pools()).toEqual([]);
      expect(await repo.meters()).toEqual([]);
      expect(await repo.spend({ from: 0, to: 10 })).toBe(3);
    });

    it('I-5: remove of an unknown account is a no-op', async () => {
      const repo = makeRepo();
      await expect(repo.remove(accountId(A3))).resolves.toBeUndefined();
    });

    it('I-5: spend sums entries filtered by account, repo and work order over inclusive bounds from ≤ at ≤ to', async () => {
      const repo = makeRepo();
      const wo1 = workOrderId(W1);
      const wo2 = workOrderId(W2);
      await repo.recordSpend({ accountId: accountId(A1), project: PROJECT, repo: REPO, workOrderId: wo1, at: 10, usd: 1 });
      await repo.recordSpend({ accountId: accountId(A1), project: PROJECT, repo: REPO, workOrderId: wo1, at: 20, usd: 2 });
      await repo.recordSpend({ accountId: accountId(A1), project: PROJECT, repo: OTHER_REPO, workOrderId: wo2, at: 30, usd: 4 });
      await repo.recordSpend({ accountId: accountId(A2), project: PROJECT, repo: REPO, workOrderId: wo1, at: 40, usd: 8 });

      expect(await repo.spend({ from: 0, to: 100 })).toBe(15);
      expect(await repo.spend({ from: 20, to: 30 })).toBe(6);
      expect(await repo.spend({ from: 10, to: 10 })).toBe(1);
      expect(await repo.spend({ from: 11, to: 19 })).toBe(0);
      expect(await repo.spend({ from: 21, to: 29 })).toBe(0);
      expect(await repo.spend({ accountId: accountId(A1), from: 0, to: 100 })).toBe(7);
      expect(await repo.spend({ repo: OTHER_REPO, from: 0, to: 100 })).toBe(4);
      expect(await repo.spend({ workOrderId: wo1, from: 0, to: 100 })).toBe(11);
      expect(await repo.spend({ from: 100, to: 200 })).toBe(0);
    });

    it('I-35: an account_test spend entry counts for the account filter and never matches a repo, project or work-order filter', async () => {
      const repo = makeRepo();
      await repo.recordSpend({ kind: 'account_test', accountId: accountId(A1), at: 10, usd: 0.5 });
      await repo.recordSpend({ accountId: accountId(A1), project: PROJECT, repo: REPO, workOrderId: workOrderId(W1), at: 10, usd: 2 });

      expect(await repo.spend({ accountId: accountId(A1), from: 0, to: 100 })).toBe(2.5);
      expect(await repo.spend({ accountId: accountId(A2), from: 0, to: 100 })).toBe(0);
      expect(await repo.spend({ repo: REPO, from: 0, to: 100 })).toBe(2);
      expect(await repo.spend({ project: PROJECT, from: 0, to: 100 })).toBe(2);
      expect(await repo.spend({ workOrderId: workOrderId(W1), from: 0, to: 100 })).toBe(2);
    });

    it('I-6: a record read back deep-equals the record written — absent optionals stay absent, arrays keep their order, numbers stay numbers', async () => {
      const repo = makeRepo();
      const full: AccountRecord = {
        id: accountId(A1),
        provider: 'provider-x',
        label: 'work horse',
        authMode: 'api_key',
        limitPolicy: 'wait_resume',
        caps: [
          { scope: 'account_day', cap: { amountUsd: 4.35, warnPercent: 80.5 } },
          { scope: 'account_month', cap: { amountUsd: 100.25, warnPercent: 80 } },
        ],
      };
      await repo.save(full);
      const readAccount = await repo.get(accountId(A1));
      expect(readAccount).toStrictEqual(full);
      if (readAccount === undefined) throw new Error('account must read back');
      expect('plan' in readAccount).toBe(false);
      expect('secretRef' in readAccount).toBe(false);

      const applied: Pool = {
        id: poolId(P1),
        accountId: accountId(A1),
        label: 'five-hour',
        kind: 'throughput',
        appliesTo: [{ exact: 'sonar-mini' }, { prefix: 'atlas' }],
      };
      await repo.savePools(accountId(A1), [applied]);
      expect(await repo.pools(accountId(A1))).toStrictEqual([applied]);

      const measured: Meter = {
        id: meterId(M1),
        poolId: poolId(P1),
        cadence: 'fixed',
        durationMs: 3_600_000,
        unit: 'percent',
        used: 12.5,
        limit: 100,
        remaining: 87.5,
        resetsAt: 1_234_567_890_123,
        resetPrecision: 'clock_only',
        observedAt: 999,
        source: 'header',
        staleAfterMs: 60_000,
      };
      await repo.saveMeter(measured);
      expect(await repo.meters(accountId(A1))).toStrictEqual([measured]);
      const readMeter = (await repo.meters(accountId(A1)))[0];
      if (readMeter === undefined) throw new Error('meter must read back');
      expect('label' in readMeter).toBe(false);
    });

    it('A-44: records are JSON — a record stored before the route fields reads back unchanged, and the new fields round-trip', async () => {
      const repo = makeRepo();
      const old = account(A1, 'before');
      await repo.save(old);
      const readOld = await repo.get(accountId(A1));
      expect(readOld).toStrictEqual(old);
      if (readOld === undefined) throw new Error('account must read back');
      expect('routeKind' in readOld).toBe(false);
      expect('endpoint' in readOld).toBe(false);
      expect('identityDir' in readOld).toBe(false);
      expect('tierModels' in readOld).toBe(false);

      const routed: AccountRecord = {
        ...account(A1, 'after'),
        routeKind: 'compatible-endpoint',
        endpoint: 'https://api.compatible.example/v1',
        identityDir: '/Users/op/.config/agent-a',
        tierModels: { strong: 'm-strong', balanced: 'm-balanced', fast: 'm-fast' },
      };
      await repo.save(routed);
      expect(await repo.get(accountId(A1))).toStrictEqual(routed);
      expect((await repo.list())[0]).toStrictEqual(routed);
    });

    it('I-6: index columns are rewritten from the record on every write — a meter that moves pools changes account ownership', async () => {
      const repo = makeRepo();
      await repo.savePools(accountId(A1), [pool(P1, A1)]);
      await repo.savePools(accountId(A2), [pool(P2, A2)]);
      await repo.saveMeter(meter(M1, P1));

      await repo.saveMeter({ ...meter(M1, P1), poolId: poolId(P2) });

      expect((await repo.meters(accountId(A1))).map((m) => m.id)).toEqual([]);
      expect((await repo.meters(accountId(A2))).map((m) => m.id)).toEqual([meterId(M1)]);
    });
  });

  describe('sqlite on a file', () => {
    it('I-8: everything written is visible through a second openDatabase on the same file after close', async () => {
      const path = join(tmp, 'docket.db');
      const first = openDb(path);
      const repo = createSqliteAccountRepo(first);
      await repo.save(account(A1, 'first'));
      await repo.savePools(accountId(A1), [pool(P1, A1)]);
      await repo.saveMeter(meter(M1, P1));
      await repo.recordSpend({ accountId: accountId(A1), project: PROJECT, repo: REPO, workOrderId: workOrderId(W1), at: 5, usd: 2.5 });
      closeDb(first);

      const second = openDb(path);
      const reopened = createSqliteAccountRepo(second);
      expect(await reopened.get(accountId(A1))).toStrictEqual(account(A1, 'first'));
      expect(await reopened.pools(accountId(A1))).toStrictEqual([pool(P1, A1)]);
      expect(await reopened.meters(accountId(A1))).toStrictEqual([meter(M1, P1)]);
      expect(await reopened.spend({ from: 0, to: 10 })).toBe(2.5);
    });
  });
});
