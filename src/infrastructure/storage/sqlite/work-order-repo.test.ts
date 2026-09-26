// Work order repository over SQLite: the parity suite runs the same behaviour cases against the
// in-memory fake and the SQLite adapter (I-5); SQLite-only rules (I-7 seq, I-8 durability) run on
// ':memory:' and a throw-away file under os.tmpdir() respectively.
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import type { WorkOrderRecord, WorkOrderRepo } from '../../../application/index';
import { createFakeWorkOrderRepo } from '../../../application/ports/fakes/index';
import type {
  Actor,
  FlowSlug,
  StageSlug,
  TaskSlug,
  WorkOrderEvent,
  WorkOrderId,
  WorkspaceSlug,
} from '../../../domain/index';
import { parseSlug, parseUlid } from '../../../domain/index';

import { openDatabase, type DocketDb } from './database';
import { createSqliteWorkOrderRepo } from './work-order-repo';

const U1 = '01ARZ3NDEKTSV4RRFFQ69G5FAV';
const U2 = '01ARZ3NDEKTSV4RRFFQ69G5FAW';
const U3 = '01ARZ3NDEKTSV4RRFFQ69G5FAX';
const U4 = '01ARZ3NDEKTSV4RRFFQ69G5FAY';
const U5 = '01ARZ3NDEKTSV4RRFFQ69G5FAZ';

const woId = (s: string): WorkOrderId => {
  const parsed = parseUlid<'work-order'>(s);
  if (!parsed.ok) throw new Error('fixture ulid must parse');
  return parsed.value;
};

const slugOf = <B extends string>(s: string) => {
  const parsed = parseSlug<B>(s);
  if (!parsed.ok) throw new Error('fixture slug must parse');
  return parsed.value;
};

const ACTOR: Actor = { kind: 'user', id: 'u1', label: 'opener' };
const FLOW: FlowSlug = slugOf<'flow'>('standard');
const STAGE: StageSlug = slugOf<'stage'>('review');
const GATE = slugOf<'gate'>('review-approval');
const TASK: TaskSlug = slugOf<'task'>('setup-auth');
const ACME: WorkspaceSlug = slugOf<'workspace'>('acme');
const OTHER: WorkspaceSlug = slugOf<'workspace'>('other');

const record = (id: string, createdAt: number, workspace: WorkspaceSlug = ACME): WorkOrderRecord => ({
  id: woId(id),
  workspace,
  flow: FLOW,
  title: `title ${id}`,
  createdAt,
  createdBy: ACTOR,
});

const taskedRecord = (id: string, createdAt: number, task: TaskSlug): WorkOrderRecord => ({
  ...record(id, createdAt),
  task,
});

const createdEvent = (at: number): WorkOrderEvent => ({ type: 'created', at, by: ACTOR, flow: FLOW });
const blockedEvent = (at: number, reason: string): WorkOrderEvent => ({ type: 'blocked', at, by: ACTOR, reason });
const gateEvent: WorkOrderEvent = {
  type: 'gate_evaluated',
  at: 12,
  stage: STAGE,
  gate: GATE,
  verdict: { status: 'failed', reason: 'command exited 1' },
};

let tmp = '';
const openDbs: DocketDb[] = [];

beforeEach(() => {
  tmp = mkdtempSync(join(tmpdir(), 'docket-wo-repo-'));
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

interface Suite {
  readonly repo: WorkOrderRepo;
}

const suites: readonly (readonly [string, () => Suite])[] = [
  ['fake', (): Suite => ({ repo: createFakeWorkOrderRepo() })],
  ['sqlite', (): Suite => ({ repo: createSqliteWorkOrderRepo(openMemory()) })],
];

describe.each(suites)('createSqliteWorkOrderRepo (%s)', (_kind, make) => {
  it('I-5: list orders by createdAt ascending and filters by workspace', async () => {
    const { repo } = make();
    await repo.create(record(U3, 30));
    await repo.create(record(U1, 10));
    await repo.create(record(U2, 20));
    await repo.create(record(U4, 40, OTHER));

    expect((await repo.list({})).map((r) => r.id)).toEqual([woId(U1), woId(U2), woId(U3), woId(U4)]);
    expect((await repo.list({ workspace: ACME })).map((r) => r.id)).toEqual([woId(U1), woId(U2), woId(U3)]);
    expect((await repo.list({ workspace: OTHER })).map((r) => r.id)).toEqual([woId(U4)]);
  });

  it('I-5: createdAt ties keep insertion order (ids ascend with insertion)', async () => {
    const { repo } = make();
    await repo.create(record(U1, 5));
    await repo.create(record(U2, 5));
    await repo.create(record(U3, 5));

    expect((await repo.list({})).map((r) => r.id)).toEqual([woId(U1), woId(U2), woId(U3)]);
  });

  it('I-5: get and events report undefined and [] for an unknown id', async () => {
    const { repo } = make();
    await repo.create(record(U1, 10));

    expect(await repo.get(woId(U2))).toBeUndefined();
    expect(await repo.events(woId(U2))).toEqual([]);
  });

  it('I-5: events come back in append order', async () => {
    const { repo } = make();
    await repo.create(record(U1, 1));
    await repo.appendEvent(woId(U1), createdEvent(1));
    await repo.appendEvent(woId(U1), blockedEvent(2, 'waiting'));
    await repo.appendEvent(woId(U1), gateEvent);

    const events = await repo.events(woId(U1));
    expect(events.map((e) => e.type)).toEqual(['created', 'blocked', 'gate_evaluated']);
  });

  it('I-5: list and events return copies, never internal arrays', async () => {
    const { repo } = make();
    await repo.create(record(U1, 1));
    await repo.appendEvent(woId(U1), createdEvent(1));

    const first = await repo.list({});
    const second = await repo.list({});
    expect(first).not.toBe(second);
    (first as WorkOrderRecord[]).push(record(U2, 2));
    expect(await repo.list({})).toEqual([record(U1, 1)]);

    const events = await repo.events(woId(U1));
    (events as WorkOrderEvent[]).push(blockedEvent(2, 'x'));
    expect(await repo.events(woId(U1))).toEqual([createdEvent(1)]);
  });

  it('I-5: duplicate create and appendEvent for an unknown work order throw', async () => {
    const { repo } = make();
    await repo.create(record(U1, 1));

    await expect(repo.create(record(U1, 2))).rejects.toThrow();
    await expect(repo.appendEvent(woId(U2), createdEvent(1))).rejects.toThrow();
  });

  it('I-6: a record read back deep-equals the record written; absent optionals stay absent', async () => {
    const { repo } = make();
    const bare = record(U1, 10);
    const tasked = taskedRecord(U2, 20, TASK);
    await repo.create(bare);
    await repo.create(tasked);

    const readBare = await repo.get(woId(U1));
    expect(readBare).toStrictEqual(bare);
    expect('task' in (readBare ?? {})).toBe(false);
    expect(await repo.get(woId(U2))).toStrictEqual(tasked);

    await repo.appendEvent(woId(U1), createdEvent(10));
    await repo.appendEvent(woId(U1), gateEvent);
    expect(await repo.events(woId(U1))).toStrictEqual([createdEvent(10), gateEvent]);
  });
});

describe('createSqliteWorkOrderRepo (sqlite rules)', () => {
  it('I-7: appendEvent assigns seq = previous max + 1 inside one transaction and events() returns seq order', async () => {
    const db = openMemory();
    const repo = createSqliteWorkOrderRepo(db);
    await repo.create(record(U1, 10));
    await repo.appendEvent(woId(U1), createdEvent(10));
    await repo.appendEvent(woId(U1), blockedEvent(11, 'waiting'));
    await repo.appendEvent(woId(U1), gateEvent);

    const rows = db.raw
      .prepare('SELECT seq FROM work_order_events WHERE work_order_id = ? ORDER BY seq')
      .all(woId(U1));
    expect(rows.map((row) => Number(row['seq']))).toEqual([1, 2, 3]);
    expect((await repo.events(woId(U1))).map((e) => e.type)).toEqual(['created', 'blocked', 'gate_evaluated']);
  });

  it('I-7: appending to an unknown work order throws and stores nothing (foreign key)', async () => {
    const db = openMemory();
    const repo = createSqliteWorkOrderRepo(db);

    await expect(repo.appendEvent(woId(U5), createdEvent(1))).rejects.toThrow();

    const row = db.raw.prepare('SELECT COUNT(*) AS n FROM work_order_events').get();
    expect(row === undefined ? undefined : row.n).toBe(0);
  });

  it('I-8: work orders and their events are visible through a second openDatabase on the same file', async () => {
    const path = join(tmp, 'docket.db');
    const first = openDatabase(path);
    if (!first.ok) throw new Error('openDatabase must succeed');
    const repo = createSqliteWorkOrderRepo(first.value);
    await repo.create(record(U1, 10));
    await repo.create(record(U2, 20, OTHER));
    await repo.appendEvent(woId(U1), createdEvent(10));
    await repo.appendEvent(woId(U1), blockedEvent(11, 'waiting'));
    first.value.close();

    const second = openDatabase(path);
    if (!second.ok) throw new Error('reopen must succeed');
    openDbs.push(second.value);
    const reopened = createSqliteWorkOrderRepo(second.value);
    expect(await reopened.get(woId(U1))).toStrictEqual(record(U1, 10));
    expect((await reopened.list({})).map((r) => r.id)).toEqual([woId(U1), woId(U2)]);
    expect((await reopened.list({ workspace: OTHER })).map((r) => r.id)).toEqual([woId(U2)]);
    expect(await reopened.events(woId(U1))).toStrictEqual([createdEvent(10), blockedEvent(11, 'waiting')]);
  });
});
