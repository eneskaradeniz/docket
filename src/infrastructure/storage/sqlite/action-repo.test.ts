// Parity (I-77) of the fake and the SQLite action repository, and the durability / migration pin of
// migration 8.
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import type { ActionRepo } from '../../../application/index';
import { createFakeActionRepo } from '../../../application/ports/fakes/index';
import {
  parseSlug,
  parseUlid,
  type ActionId,
  type ActionRecord,
  type ConversationId,
  type DraftId,
  type ProposalId,
  type Ulid,
} from '../../../domain/index';

import { createSqliteActionRepo } from './action-repo';
import { openDatabase, type DocketDb } from './database';
import { MIGRATIONS } from './schema';

const ulid = <B extends string>(s: string): Ulid<B> => {
  const parsed = parseUlid<B>(s);
  if (!parsed.ok) throw new Error('fixture ulid must parse');
  return parsed.value;
};

const slug = <B extends string>(s: string) => {
  const parsed = parseSlug<B>(s);
  if (!parsed.ok) throw new Error('fixture slug must parse');
  return parsed.value;
};

const C1: ConversationId = ulid('01ARZ3NDEKTSV4RRFFQ69G5FC1');
const C2: ConversationId = ulid('01ARZ3NDEKTSV4RRFFQ69G5FC2');
const A1: ActionId = ulid('01ARZ3NDEKTSV4RRFFQ69G5FA1');
const A2: ActionId = ulid('01ARZ3NDEKTSV4RRFFQ69G5FA2');
const A3: ActionId = ulid('01ARZ3NDEKTSV4RRFFQ69G5FA3');
const A4: ActionId = ulid('01ARZ3NDEKTSV4RRFFQ69G5FA4');
const DRAFT: DraftId = ulid('01ARZ3NDEKTSV4RRFFQ69G5FD1');
const PROPOSAL: ProposalId = ulid('01ARZ3NDEKTSV4RRFFQ69G5FP1');
const GRANT = ulid<'grant'>('01ARZ3NDEKTSV4RRFFQ69G5FG1');

const record = (id: ActionId, conversation: ConversationId, over: Partial<ActionRecord> = {}): ActionRecord => ({
  id,
  conversation,
  action: { kind: 'open_work_order', draft: DRAFT },
  status: 'pending',
  proposedAt: 1_000,
  ...over,
});

let tmp: string;
let openHandles: DocketDb[];

beforeEach(() => {
  tmp = mkdtempSync(join(tmpdir(), 'docket-sqlite-actions-'));
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

describe('createSqliteActionRepo', () => {
  describe.each([
    ['fake', (): ActionRepo => createFakeActionRepo()],
    ['sqlite', (): ActionRepo => createSqliteActionRepo(openDb(':memory:'))],
  ])('parity against the fake: %s', (_kind, makeRepo) => {
    it('I-77: save upserts by id; get round-trips every field of every action kind and is undefined for an unknown id', async () => {
      const repo = makeRepo();
      const full = record(A1, C1, {
        action: { kind: 'definition_edit', scope: { kind: 'project', project: slug<'project'>('mobile') }, target: 'flows/main.yaml', proposal: PROPOSAL },
        status: 'applied',
        decidedAt: 2_000,
        decidedBy: { kind: 'grant', grant: GRANT },
        undo: { kind: 'revert_proposal', ref: PROPOSAL, expiresAt: 9_000 },
      });
      await repo.save(record(A1, C1));
      await repo.save(full);
      await repo.save(record(A2, C1, { action: { kind: 'setting_change', key: 'dispatch.limits', value: { perAccount: 2, nested: [1, null, 'ü'] } } }));
      expect(await repo.get(A1)).toStrictEqual(full);
      expect(await repo.get(A2)).toStrictEqual(record(A2, C1, { action: { kind: 'setting_change', key: 'dispatch.limits', value: { perAccount: 2, nested: [1, null, 'ü'] } } }));
      expect(await repo.get(A3)).toBeUndefined();
    });

    it('I-77: a stored record is a copy — mutating what was read never reaches the store', async () => {
      const repo = makeRepo();
      await repo.save(record(A1, C1));
      const read = await repo.get(A1);
      (read as { status: string }).status = 'applied';
      expect((await repo.get(A1))?.status).toBe('pending');
    });

    it('I-77: forConversation lists one conversation oldest proposal first, ties by id', async () => {
      const repo = makeRepo();
      await repo.save(record(A3, C1, { proposedAt: 300 }));
      await repo.save(record(A2, C1, { proposedAt: 100 }));
      await repo.save(record(A1, C1, { proposedAt: 100 }));
      await repo.save(record(A4, C2, { proposedAt: 50 }));
      expect((await repo.forConversation(C1)).map((r) => r.id)).toEqual([A1, A2, A3]);
      expect((await repo.forConversation(C2)).map((r) => r.id)).toEqual([A4]);
      expect(await repo.forConversation(ulid('01ARZ3NDEKTSV4RRFFQ69G5FZZ'))).toEqual([]);
    });

    it('I-77: pending lists only the conversation\'s records still pending, in the same order, and follows a status change', async () => {
      const repo = makeRepo();
      await repo.save(record(A1, C1, { proposedAt: 100 }));
      await repo.save(record(A2, C1, { proposedAt: 200, status: 'rejected' }));
      await repo.save(record(A3, C1, { proposedAt: 300 }));
      await repo.save(record(A4, C2, { proposedAt: 100 }));
      expect((await repo.pending(C1)).map((r) => r.id)).toEqual([A1, A3]);
      await repo.save(record(A1, C1, { proposedAt: 100, status: 'applied' }));
      expect((await repo.pending(C1)).map((r) => r.id)).toEqual([A3]);
    });

    it('I-77: countFor counts every status of one conversation and an upsert does not count twice', async () => {
      const repo = makeRepo();
      expect(await repo.countFor(C1)).toBe(0);
      await repo.save(record(A1, C1));
      await repo.save(record(A1, C1, { status: 'failed', failure: 'disk_full' }));
      await repo.save(record(A2, C1, { status: 'undone' }));
      await repo.save(record(A3, C2));
      expect(await repo.countFor(C1)).toBe(2);
      expect(await repo.countFor(C2)).toBe(1);
    });
  });

  describe('sqlite specifics', () => {
    it('I-77: records survive closing and reopening the file', async () => {
      const path = join(tmp, 'docket.db');
      const first = openDb(path);
      await createSqliteActionRepo(first).save(record(A1, C1, { status: 'failed', failure: 'disk_full', decidedAt: 5 }));
      first.close();
      openHandles.splice(openHandles.indexOf(first), 1);
      const reopened = createSqliteActionRepo(openDb(path));
      expect(await reopened.get(A1)).toStrictEqual(record(A1, C1, { status: 'failed', failure: 'disk_full', decidedAt: 5 }));
    });

    it('I-77: the columns beside the JSON are rebuilt on every save', async () => {
      const db = openDb(':memory:');
      const repo = createSqliteActionRepo(db);
      await repo.save(record(A1, C1, { proposedAt: 7 }));
      await repo.save(record(A1, C1, { proposedAt: 7, status: 'applied' }));
      expect(db.raw.prepare('SELECT id, conversation, status, proposed_at FROM actions').all().map((row) => ({ ...row }))).toStrictEqual([
        { id: A1, conversation: C1, status: 'applied', proposed_at: 7 },
      ]);
    });

    it('I-77: migration 8 creates actions with its index, pinned exactly', () => {
      expect(MIGRATIONS[7]).toStrictEqual({
        version: 8,
        sql: [
          'CREATE TABLE actions (id TEXT PRIMARY KEY, conversation TEXT NOT NULL, status TEXT NOT NULL, proposed_at INTEGER NOT NULL, data TEXT NOT NULL);',
          'CREATE INDEX actions_by_conversation ON actions (conversation, status);',
        ].join('\n'),
      });
    });
  });
});
