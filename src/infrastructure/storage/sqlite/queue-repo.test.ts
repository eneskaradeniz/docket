// Parity (I-5), round-trip (I-6) and durability (I-8) tests for the SQLite queue repository.
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import type { QueueRepo } from '../../../application/index';
import { createFakeQueueRepo } from '../../../application/ports/fakes/index';
import { parseUlid, type QueueItem, type QueueItemId, type StageSlug, type WorkOrderId, type RepoSlug } from '../../../domain/index';

import { openDatabase, type DocketDb } from './database';
import { createSqliteQueueRepo } from './queue-repo';

const Q1 = '01ARZ3NDEKTSV4RRFFQ69G5FAV';
const Q2 = '01ARZ3NDEKTSV4RRFFQ69G5FAW';
const Q3 = '01ARZ3NDEKTSV4RRFFQ69G5FAX';
const W1 = '01ARZ3NDEKTSV4RRFFQ69G5FAY';
const W2 = '01ARZ3NDEKTSV4RRFFQ69G5FAZ';
const A1 = '01ARZ3NDEKTSV4RRFFQ69G5FB0';

const queueId = (s: string): QueueItemId => {
  const parsed = parseUlid<'queue-item'>(s);
  if (!parsed.ok) throw new Error('fixture ulid must parse');
  return parsed.value;
};

const workOrderId = (s: string): WorkOrderId => {
  const parsed = parseUlid<'work-order'>(s);
  if (!parsed.ok) throw new Error('fixture ulid must parse');
  return parsed.value;
};

const accountId = (s: string) => {
  const parsed = parseUlid<'account'>(s);
  if (!parsed.ok) throw new Error('fixture ulid must parse');
  return parsed.value;
};

const REPO = 'acme' as RepoSlug;
const STAGE = 'implement' as StageSlug;

const item = (id: string, owner: string, priority = 0): QueueItem => ({
  id: queueId(id),
  workOrderId: workOrderId(owner),
  repo: REPO,
  stage: STAGE,
  route: { accountId: accountId(A1) },
  priority,
  enqueuedAt: 1_711_234_567_890,
});

let tmp: string;
let openHandles: DocketDb[];

beforeEach(() => {
  tmp = mkdtempSync(join(tmpdir(), 'docket-sqlite-queue-'));
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

describe('createSqliteQueueRepo', () => {
  describe.each([
    ['fake', (): QueueRepo => createFakeQueueRepo()],
    ['sqlite', (): QueueRepo => createSqliteQueueRepo(openDb(':memory:'))],
  ])('parity against the fake: %s', (_kind, makeRepo) => {
    it('I-5: put upserts by id and remove deletes; remove of an unknown id is a no-op', async () => {
      const repo = makeRepo();
      await repo.put(item(Q1, W1, 1));
      await repo.put(item(Q2, W2, 2));
      await repo.put({ ...item(Q1, W1), priority: 9 });

      const listed = await repo.list();
      expect(listed.map((i) => i.id)).toEqual([queueId(Q1), queueId(Q2)]);
      expect(listed[0]?.priority).toBe(9);

      await repo.remove(queueId(Q1));
      expect((await repo.list()).map((i) => i.id)).toEqual([queueId(Q2)]);
      await expect(repo.remove(queueId(Q1))).resolves.toBeUndefined();
      expect(await repo.list()).toHaveLength(1);
    });

    it('I-5: an empty queue lists as an empty array', async () => {
      const repo = makeRepo();
      expect(await repo.list()).toEqual([]);
    });

    it('I-6: an item read back deep-equals the item written — absent notBefore stays absent, numbers stay numbers', async () => {
      const repo = makeRepo();
      const plain = item(Q1, W1, -5);
      const scheduled: QueueItem = { ...item(Q2, W2), notBefore: 1_711_234_600_000 };
      await repo.put(plain);
      await repo.put(scheduled);

      const byId = new Map((await repo.list()).map((entry) => [entry.id, entry]));
      expect(byId.get(queueId(Q1))).toStrictEqual(plain);
      expect(byId.get(queueId(Q2))).toStrictEqual(scheduled);
      const readPlain = byId.get(queueId(Q1));
      if (readPlain === undefined) throw new Error('item must read back');
      expect('notBefore' in readPlain).toBe(false);
      expect('handoffOf' in readPlain).toBe(false);
      expect(readPlain.priority).toBe(-5);
      expect(readPlain.enqueuedAt).toBe(1_711_234_567_890);
    });

    it('I-6: handoffOf rides the queued item through put and list', async () => {
      const repo = makeRepo();
      const continuation: QueueItem = {
        ...item(Q1, W1),
        handoffOf: '01ARZ3NDEKTSV4RRFFQ69G5FB3' as QueueItem['handoffOf'],
      };
      await repo.put(continuation);

      const listed = await repo.list();
      expect(listed).toStrictEqual([continuation]);
      expect(listed[0]?.handoffOf).toBe('01ARZ3NDEKTSV4RRFFQ69G5FB3');
    });
  });

  describe('sqlite specifics', () => {
    it('I-5: list orders queue items by id asc even when inserted out of order', async () => {
      const db = openDb(':memory:');
      const repo = createSqliteQueueRepo(db);
      await repo.put(item(Q3, W2));
      await repo.put(item(Q1, W1));
      await repo.put(item(Q2, W2));

      expect((await repo.list()).map((i) => i.id)).toEqual([queueId(Q1), queueId(Q2), queueId(Q3)]);
    });

    it('I-8: queue items survive a close and reopen on the same file', async () => {
      const path = join(tmp, 'docket.db');
      const first = openDb(path);
      const repo = createSqliteQueueRepo(first);
      await repo.put(item(Q1, W1, 3));
      const continuation: QueueItem = {
        ...item(Q2, W2),
        handoffOf: '01ARZ3NDEKTSV4RRFFQ69G5FB3' as QueueItem['handoffOf'],
      };
      await repo.put(continuation);
      await repo.remove(queueId(Q1));
      closeDb(first);

      const second = openDb(path);
      const reopened = createSqliteQueueRepo(second);
      expect(await reopened.list()).toStrictEqual([continuation]);
    });
  });
});
