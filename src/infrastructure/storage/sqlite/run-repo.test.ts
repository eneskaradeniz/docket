// Run repository over SQLite: the parity suite runs the same behaviour cases against the
// in-memory fake and the SQLite adapter (I-5); SQLite-only rules (I-7 seq, I-8 durability) run on
// ':memory:' and a throw-away file under os.tmpdir() respectively. SQLite runs need their parent
// work order rows, inserted through raw SQL (the work order repo is not this file's subject).
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import type { RunRecord, RunRepo } from '../../../application/index';
import { createFakeRunRepo } from '../../../application/ports/fakes/index';
import type {
  AccountId,
  AccountRoute,
  AgentEvent,
  RoleSlug,
  RollingNote,
  RunId,
  StageSlug,
  WorkOrderId,
} from '../../../domain/index';
import { parseSlug, parseUlid } from '../../../domain/index';

import { openDatabase, type DocketDb } from './database';
import { createSqliteRunRepo } from './run-repo';

const R1 = '01ARZ3NDEKTSV4RRFFQ69G5FAV';
const R2 = '01ARZ3NDEKTSV4RRFFQ69G5FAW';
const R3 = '01ARZ3NDEKTSV4RRFFQ69G5FAX';
const R4 = '01ARZ3NDEKTSV4RRFFQ69G5FAY';
const R5 = '01ARZ3NDEKTSV4RRFFQ69G5FAZ';
const WO1 = '01ARZ3NDEKTSV4RRFFQ69G5FB0';
const WO2 = '01ARZ3NDEKTSV4RRFFQ69G5FB1';
const ACC = '01ARZ3NDEKTSV4RRFFQ69G5FB2';

// Assembled at runtime: session refs look like credentials to push protection.
const SESSION_REF = 'sess_' + 'z'.repeat(16);

const runId = (s: string): RunId => {
  const parsed = parseUlid<'run'>(s);
  if (!parsed.ok) throw new Error('fixture ulid must parse');
  return parsed.value;
};

const woId = (s: string): WorkOrderId => {
  const parsed = parseUlid<'work-order'>(s);
  if (!parsed.ok) throw new Error('fixture ulid must parse');
  return parsed.value;
};

const accountId = (s: string): AccountId => {
  const parsed = parseUlid<'account'>(s);
  if (!parsed.ok) throw new Error('fixture ulid must parse');
  return parsed.value;
};

const slugOf = <B extends string>(s: string) => {
  const parsed = parseSlug<B>(s);
  if (!parsed.ok) throw new Error('fixture slug must parse');
  return parsed.value;
};

const STAGE: StageSlug = slugOf<'stage'>('implement');
const ROLE: RoleSlug = slugOf<'role'>('implementer');
const ROUTE: AccountRoute = { accountId: accountId(ACC) };
const ROUTE_WITH_MODEL: AccountRoute = { accountId: accountId(ACC), model: 'big-model' };

const record = (id: string, workOrderId: string, startedAt: number): RunRecord => ({
  id: runId(id),
  workOrderId: woId(workOrderId),
  stage: STAGE,
  attempt: 1,
  role: ROLE,
  route: ROUTE,
  startedAt,
  autoResumesUsed: 0,
});

const fullRecord = (id: string, workOrderId: string): RunRecord => ({
  ...record(id, workOrderId, 100),
  attempt: 2,
  route: ROUTE_WITH_MODEL,
  endedAt: 200,
  outcome: 'succeeded',
  sessionRef: SESSION_REF,
  autoResumesUsed: 1,
});

const textEvent = (at: number, delta: string): AgentEvent => ({ type: 'text', at, delta });
const askEvent: AgentEvent = {
  type: 'permission_ask',
  at: 5,
  id: 'ask-1',
  tool: 'Bash',
  target: '/tmp/build.sh',
  options: ['allow_once', 'deny'],
};
const usageEvent: AgentEvent = {
  type: 'usage',
  at: 6,
  inputTokens: 11,
  outputTokens: 22,
  cachedInputTokens: 5,
  costUsd: 0.25,
  costKind: 'reported',
};

let tmp = '';
const openDbs: DocketDb[] = [];

beforeEach(() => {
  tmp = mkdtempSync(join(tmpdir(), 'docket-run-repo-'));
});

afterEach(() => {
  for (const db of openDbs.splice(0)) db.close();
  rmSync(tmp, { recursive: true, force: true });
});

function openMemory(): DocketDb {
  const opened = openDatabase(':memory:');
  if (!opened.ok) throw new Error('openDatabase(:memory:) must succeed');
  openDbs.push(opened.value);
  return opened.value;
}

function seedWorkOrder(db: DocketDb, id: string): void {
  db.raw
    .prepare("INSERT INTO work_orders (id, project, repo, created_at, data) VALUES (?, ?, ?, ?, ?)")
    .run(id, 'acme', 'acme', 1, '{}');
}

interface Suite {
  readonly repo: RunRepo;
}

const suites: readonly (readonly [string, () => Suite])[] = [
  ['fake', (): Suite => ({ repo: createFakeRunRepo() })],
  [
    'sqlite',
    (): Suite => {
      const db = openMemory();
      seedWorkOrder(db, WO1);
      seedWorkOrder(db, WO2);
      return { repo: createSqliteRunRepo(db) };
    },
  ],
];

describe.each(suites)('createSqliteRunRepo (%s)', (_kind, make) => {
  it('I-5: listForWorkOrder orders by startedAt ascending and only returns that work order’s runs', async () => {
    const { repo } = make();
    await repo.create(record(R3, WO1, 30));
    await repo.create(record(R1, WO1, 10));
    await repo.create(record(R2, WO1, 20));
    await repo.create(record(R4, WO2, 5));

    expect((await repo.listForWorkOrder(woId(WO1))).map((r) => r.id)).toEqual([runId(R1), runId(R2), runId(R3)]);
    expect((await repo.listForWorkOrder(woId(WO2))).map((r) => r.id)).toEqual([runId(R4)]);
  });

  it('I-5: startedAt ties keep insertion order (ids ascend with insertion)', async () => {
    const { repo } = make();
    await repo.create(record(R1, WO1, 5));
    await repo.create(record(R2, WO1, 5));

    expect((await repo.listForWorkOrder(woId(WO1))).map((r) => r.id)).toEqual([runId(R1), runId(R2)]);
  });

  it('I-5: listActive returns only runs without endedAt, ordered by startedAt', async () => {
    const { repo } = make();
    await repo.create(record(R1, WO1, 10));
    await repo.create(record(R2, WO1, 20));
    await repo.create(record(R3, WO1, 15));
    await repo.update(runId(R3), { endedAt: 99, outcome: 'succeeded' });

    expect((await repo.listActive()).map((r) => r.id)).toEqual([runId(R1), runId(R2)]);
  });

  it('I-5: update applies only the patched fields', async () => {
    const { repo } = make();
    await repo.create(record(R1, WO1, 10));

    await repo.update(runId(R1), { outcome: 'failed', sessionRef: 's-1' });

    const updated = await repo.get(runId(R1));
    expect(updated?.outcome).toBe('failed');
    expect(updated?.sessionRef).toBe('s-1');
    expect(updated?.startedAt).toBe(10);
    expect(updated?.workOrderId).toBe(woId(WO1));
    expect(updated?.endedAt).toBeUndefined();

    await repo.update(runId(R1), { endedAt: 50, autoResumesUsed: 2 });
    const again = await repo.get(runId(R1));
    expect(again?.endedAt).toBe(50);
    expect(again?.autoResumesUsed).toBe(2);
    expect(again?.outcome).toBe('failed');
  });

  it('I-5: get and events report undefined and [] for an unknown id; misuse throws', async () => {
    const { repo } = make();
    await repo.create(record(R1, WO1, 10));

    expect(await repo.get(runId(R2))).toBeUndefined();
    expect(await repo.events(runId(R2))).toEqual([]);

    await expect(repo.create(record(R1, WO1, 11))).rejects.toThrow();
    await expect(repo.update(runId(R2), { outcome: 'failed' })).rejects.toThrow('does not exist');
    await expect(repo.appendEvents(runId(R2), [textEvent(1, 'a')])).rejects.toThrow('does not exist');
  });

  it('I-5: appendEvents keeps arrival order and events returns a copy', async () => {
    const { repo } = make();
    await repo.create(record(R1, WO1, 10));

    await repo.appendEvents(runId(R1), [textEvent(1, 'a'), textEvent(2, 'b')]);
    await repo.appendEvents(runId(R1), [textEvent(3, 'c')]);

    const events = await repo.events(runId(R1));
    expect(events.map((e) => (e.type === 'text' ? e.delta : ''))).toEqual(['a', 'b', 'c']);

    const other = await repo.events(runId(R1));
    expect(other).not.toBe(events);
    (events as AgentEvent[]).push(textEvent(4, 'd'));
    expect((await repo.events(runId(R1))).map((e) => (e.type === 'text' ? e.delta : ''))).toEqual(['a', 'b', 'c']);
  });

  it('I-6: a record read back deep-equals the record written; absent optionals stay absent, arrays keep order', async () => {
    const { repo } = make();
    const bare = record(R1, WO1, 10);
    const full = fullRecord(R2, WO1);
    await repo.create(bare);
    await repo.create(full);

    const readBare = await repo.get(runId(R1));
    expect(readBare).toStrictEqual(bare);
    expect('endedAt' in (readBare ?? {})).toBe(false);
    expect('definitionsRev' in (readBare ?? {})).toBe(false);
    expect(await repo.get(runId(R2))).toStrictEqual(full);

    const events = [askEvent, usageEvent, textEvent(7, 'tail')];
    await repo.appendEvents(runId(R1), events);
    expect(await repo.events(runId(R1))).toStrictEqual(events);
  });

  it('I-6: definitionsRev rides the record through create and update-free reads', async () => {
    const { repo } = make();
    const revised: RunRecord = { ...record(R1, WO1, 10), definitionsRev: 'rev-7f3a' };
    await repo.create(revised);

    expect(await repo.get(runId(R1))).toStrictEqual(revised);
    expect((await repo.get(runId(R1)))?.definitionsRev).toBe('rev-7f3a');
  });

  it('I-5: the handoff note and the stage base save, overwrite and answer independently', async () => {
    const { repo } = make();
    await repo.create(record(R1, WO1, 10));
    await repo.create(record(R2, WO1, 20));

    const first: RollingNote = { text: 'ilk bacak ozeti', capped: false };
    await repo.saveHandoffNote(runId(R1), first);
    await repo.saveStageBase(runId(R1), 'sha-base-1');

    expect(await repo.handoffNote(runId(R1))).toStrictEqual(first);
    expect(await repo.stageBase(runId(R1))).toBe('sha-base-1');

    // Overwrites touch only their own member.
    const second: RollingNote = { text: 'devam', capped: true };
    await repo.saveHandoffNote(runId(R1), second);
    expect(await repo.handoffNote(runId(R1))).toStrictEqual(second);
    expect(await repo.stageBase(runId(R1))).toBe('sha-base-1');
    await repo.saveStageBase(runId(R1), 'sha-base-2');
    expect(await repo.stageBase(runId(R1))).toBe('sha-base-2');
    expect(await repo.handoffNote(runId(R1))).toStrictEqual(second);

    // A run that saved neither answers undefined for both.
    expect(await repo.handoffNote(runId(R2))).toBeUndefined();
    expect(await repo.stageBase(runId(R2))).toBeUndefined();
  });

  it('I-5: saving a note or stage base for an unknown run throws and writes nothing', async () => {
    const { repo } = make();
    await repo.create(record(R1, WO1, 10));

    await expect(repo.saveHandoffNote(runId(R2), { text: 'x', capped: false })).rejects.toThrow('does not exist');
    await expect(repo.saveStageBase(runId(R2), 'sha')).rejects.toThrow('does not exist');
    expect(await repo.handoffNote(runId(R2))).toBeUndefined();
    expect(await repo.stageBase(runId(R2))).toBeUndefined();
  });

  it('I-6: update({ endedAt }) rewrites the index columns and drops the run from listActive', async () => {
    const { repo } = make();
    await repo.create(record(R1, WO1, 10));
    await repo.create(record(R2, WO1, 20));
    expect((await repo.listActive()).map((r) => r.id)).toEqual([runId(R1), runId(R2)]);

    await repo.update(runId(R1), { endedAt: 30 });

    expect((await repo.listActive()).map((r) => r.id)).toEqual([runId(R2)]);
    expect((await repo.listForWorkOrder(woId(WO1))).map((r) => r.id)).toEqual([runId(R1), runId(R2)]);
  });
});

describe('createSqliteRunRepo (sqlite rules)', () => {
  it('I-7: appendEvents assigns seq = previous max + 1 inside one transaction and events() returns seq order', async () => {
    const db = openMemory();
    seedWorkOrder(db, WO1);
    const repo = createSqliteRunRepo(db);
    await repo.create(record(R1, WO1, 10));

    await repo.appendEvents(runId(R1), [textEvent(1, 'a')]);
    await repo.appendEvents(runId(R1), [textEvent(2, 'b'), textEvent(3, 'c')]);

    const rows = db.raw.prepare('SELECT seq FROM run_events WHERE run_id = ? ORDER BY seq').all(runId(R1));
    expect(rows.map((row) => Number(row['seq']))).toEqual([1, 2, 3]);
    expect((await repo.events(runId(R1))).map((e) => (e.type === 'text' ? e.delta : ''))).toEqual(['a', 'b', 'c']);
  });

  it('I-7: appendEvents of N events stores all N or none', async () => {
    const db = openMemory();
    seedWorkOrder(db, WO1);
    const repo = createSqliteRunRepo(db);
    await repo.create(record(R1, WO1, 10));

    await repo.appendEvents(runId(R1), [textEvent(1, 'a'), textEvent(2, 'b'), textEvent(3, 'c')]);
    const stored = db.raw.prepare('SELECT COUNT(*) AS n FROM run_events').get();
    expect(stored === undefined ? undefined : stored.n).toBe(3);

    // An unknown run fails before any insert: nothing is stored.
    await expect(repo.appendEvents(runId(R5), [textEvent(4, 'd'), textEvent(5, 'e')])).rejects.toThrow('does not exist');
    const afterUnknown = db.raw.prepare('SELECT COUNT(*) AS n FROM run_events').get();
    expect(afterUnknown === undefined ? undefined : afterUnknown.n).toBe(3);

    // A failure after the batch inside an outer transaction rolls the batch back with it.
    expect(() =>
      db.transaction(() => {
        void repo.appendEvents(runId(R1), [textEvent(6, 'f'), textEvent(7, 'g')]);
        throw new Error('outer boom');
      }),
    ).toThrow('outer boom');
    const afterRollback = db.raw.prepare('SELECT COUNT(*) AS n FROM run_events').get();
    expect(afterRollback === undefined ? undefined : afterRollback.n).toBe(3);
  });

  it('I-6: update rewrites the ended_at index column from the record', async () => {
    const db = openMemory();
    seedWorkOrder(db, WO1);
    const repo = createSqliteRunRepo(db);
    await repo.create(record(R1, WO1, 10));

    const before = db.raw.prepare('SELECT ended_at FROM runs WHERE id = ?').get(runId(R1));
    expect(before === undefined ? undefined : before.ended_at).toBeNull();

    await repo.update(runId(R1), { endedAt: 50 });

    const after = db.raw.prepare('SELECT ended_at FROM runs WHERE id = ?').get(runId(R1));
    expect(after === undefined ? undefined : after.ended_at).toBe(50);
  });

  it('I-8: runs, their updates, their events, handoff note, stage base and definitionsRev are visible through a second openDatabase on the same file', async () => {
    const path = join(tmp, 'docket.db');
    const first = openDatabase(path);
    if (!first.ok) throw new Error('openDatabase must succeed');
    seedWorkOrder(first.value, WO1);
    const repo = createSqliteRunRepo(first.value);
    await repo.create({ ...record(R1, WO1, 10), definitionsRev: 'rev-7f3a' });
    await repo.update(runId(R1), { endedAt: 30, outcome: 'succeeded' });
    await repo.appendEvents(runId(R1), [askEvent, usageEvent]);
    await repo.saveHandoffNote(runId(R1), { text: 'ozet', capped: true });
    await repo.saveStageBase(runId(R1), 'sha-base-1');
    first.value.close();

    const second = openDatabase(path);
    if (!second.ok) throw new Error('reopen must succeed');
    openDbs.push(second.value);
    const reopened = createSqliteRunRepo(second.value);
    expect(await reopened.get(runId(R1))).toStrictEqual({
      ...record(R1, WO1, 10),
      definitionsRev: 'rev-7f3a',
      endedAt: 30,
      outcome: 'succeeded',
    });
    expect(await reopened.listActive()).toEqual([]);
    expect(await reopened.events(runId(R1))).toStrictEqual([askEvent, usageEvent]);
    expect(await reopened.handoffNote(runId(R1))).toStrictEqual({ text: 'ozet', capped: true });
    expect(await reopened.stageBase(runId(R1))).toBe('sha-base-1');
  });
});
