// Audit event log over SQLite: the parity suite runs the same behaviour cases against the
// in-memory fake and the SQLite adapter (I-5); the durability rule (I-8) runs on a throw-away file
// under os.tmpdir().
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import type { AuditEntry, AuditSubject, EventLog } from '../../../application/index';
import { createFakeEventLog } from '../../../application/ports/fakes/index';
import type { AccountId, Actor, CapabilitySlug, RoleSlug, RunId, WorkOrderId } from '../../../domain/index';
import { parseSlug, parseUlid } from '../../../domain/index';

import { openDatabase, type DocketDb } from './database';
import { createSqliteEventLog } from './event-log';

const U1 = '01ARZ3NDEKTSV4RRFFQ69G5FAV';
const U2 = '01ARZ3NDEKTSV4RRFFQ69G5FAW';
const U3 = '01ARZ3NDEKTSV4RRFFQ69G5FAX';
const U4 = '01ARZ3NDEKTSV4RRFFQ69G5FAY';

const auditId = (s: string): AuditEntry['id'] => {
  const parsed = parseUlid<'audit'>(s);
  if (!parsed.ok) throw new Error('fixture ulid must parse');
  return parsed.value;
};

const runIdOf = (s: string): RunId => {
  const parsed = parseUlid<'run'>(s);
  if (!parsed.ok) throw new Error('fixture ulid must parse');
  return parsed.value;
};

const woSubject = (s: string): WorkOrderId => {
  const parsed = parseUlid<'work-order'>(s);
  if (!parsed.ok) throw new Error('fixture ulid must parse');
  return parsed.value;
};

const accountSubject = (s: string): AccountId => {
  const parsed = parseUlid<'account'>(s);
  if (!parsed.ok) throw new Error('fixture ulid must parse');
  return parsed.value;
};

const roleOf = (s: string): RoleSlug => {
  const parsed = parseSlug<'role'>(s);
  if (!parsed.ok) throw new Error('fixture slug must parse');
  return parsed.value;
};

const capabilityOf = (s: string): CapabilitySlug => {
  const parsed = parseSlug<'capability'>(s);
  if (!parsed.ok) throw new Error('fixture slug must parse');
  return parsed.value;
};

const USER_ACTOR: Actor = { kind: 'user', id: 'u1', label: 'operator' };
const AGENT_ACTOR: Actor = { kind: 'agent', runId: runIdOf(U4), role: roleOf('implementer') };

const entry = (id: string, at: number, subject: AuditSubject): AuditEntry => ({
  id: auditId(id),
  at,
  actor: USER_ACTOR,
  action: 'work_order.opened',
  subject,
});

// The same id value under two kinds proves subject matching never crosses kinds.
const SUBJECT_WO: AuditSubject = { kind: 'work_order', id: woSubject(U1) };
const SUBJECT_ACC: AuditSubject = { kind: 'account', id: accountSubject(U1) };

let tmp = '';
const openDbs: DocketDb[] = [];

beforeEach(() => {
  tmp = mkdtempSync(join(tmpdir(), 'docket-event-log-'));
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
  readonly log: EventLog;
}

const suites: readonly (readonly [string, () => Suite])[] = [
  ['fake', (): Suite => ({ log: createFakeEventLog() })],
  ['sqlite', (): Suite => ({ log: createSqliteEventLog(openMemory()) })],
];

describe.each(suites)('createSqliteEventLog (%s)', (_kind, make) => {
  it('I-5: list returns the subject’s entries newest first', async () => {
    const { log } = make();
    await log.append(entry(U1, 1, SUBJECT_WO));
    await log.append(entry(U2, 5, SUBJECT_WO));
    await log.append(entry(U3, 3, SUBJECT_WO));

    const listed = await log.list(SUBJECT_WO, 10);
    expect(listed.map((e) => e.id)).toEqual([auditId(U2), auditId(U3), auditId(U1)]);
  });

  it('I-5: the later append comes first when two entries share the same at', async () => {
    const { log } = make();
    await log.append(entry(U1, 7, SUBJECT_WO));
    await log.append(entry(U2, 7, SUBJECT_WO));

    const listed = await log.list(SUBJECT_WO, 10);
    expect(listed.map((e) => e.id)).toEqual([auditId(U2), auditId(U1)]);
  });

  it('I-5: list honours the limit — 0 yields none, beyond count yields all, negatives clamp to none', async () => {
    const { log } = make();
    await log.append(entry(U1, 1, SUBJECT_WO));
    await log.append(entry(U2, 2, SUBJECT_WO));
    await log.append(entry(U3, 3, SUBJECT_WO));

    expect(await log.list(SUBJECT_WO, 0)).toEqual([]);
    expect((await log.list(SUBJECT_WO, 2)).map((e) => e.id)).toEqual([auditId(U3), auditId(U2)]);
    expect((await log.list(SUBJECT_WO, 99)).map((e) => e.id)).toEqual([auditId(U3), auditId(U2), auditId(U1)]);
    expect(await log.list(SUBJECT_WO, -1)).toEqual([]);
  });

  it('I-5: subject matching never crosses kinds — the same key under another kind sees nothing', async () => {
    const { log } = make();
    await log.append(entry(U1, 1, SUBJECT_WO));
    await log.append(entry(U2, 2, SUBJECT_ACC));
    await log.append(entry(U3, 3, { kind: 'run', id: runIdOf(U4) }));

    expect((await log.list(SUBJECT_WO, 10)).map((e) => e.id)).toEqual([auditId(U1)]);
    expect((await log.list(SUBJECT_ACC, 10)).map((e) => e.id)).toEqual([auditId(U2)]);
    expect((await log.list({ kind: 'run', id: runIdOf(U4) }, 10)).map((e) => e.id)).toEqual([auditId(U3)]);
  });

  it('I-5: binding subjects match by role and ignore other roles', async () => {
    const { log } = make();
    const reviewer = roleOf('reviewer');
    const implementer = roleOf('implementer');
    await log.append({ ...entry(U1, 1, { kind: 'binding', role: reviewer }), action: 'binding.saved' });
    await log.append({ ...entry(U2, 2, { kind: 'binding', role: implementer }), action: 'binding.saved' });

    const listed = await log.list({ kind: 'binding', role: reviewer }, 10);
    expect(listed).toHaveLength(1);
    expect(listed[0]?.id).toBe(auditId(U1));
  });

  it('I-5: capability subjects match by the stored slug — list finds the import from its definition id', async () => {
    const { log } = make();
    const slug = capabilityOf('db-tools');
    await log.append({ ...entry(U1, 1, { kind: 'capability', id: slug }), action: 'capability.imported' });
    await log.append(entry(U2, 2, SUBJECT_WO));

    const listed = await log.list({ kind: 'capability', id: slug }, 10);
    expect(listed).toHaveLength(1);
    expect(listed[0]?.action).toBe('capability.imported');
    expect(listed[0]?.subject).toEqual({ kind: 'capability', id: slug });
  });

  it('I-5: list returns copies, never internal arrays', async () => {
    const { log } = make();
    await log.append(entry(U1, 1, SUBJECT_WO));

    const first = await log.list(SUBJECT_WO, 10);
    const second = await log.list(SUBJECT_WO, 10);
    expect(first).not.toBe(second);

    (first as AuditEntry[]).push(entry(U2, 2, SUBJECT_WO));
    expect(await log.list(SUBJECT_WO, 10)).toEqual([entry(U1, 1, SUBJECT_WO)]);
  });

  it('I-6: an appended entry read back deep-equals the entry written; absent optionals stay absent', async () => {
    const { log } = make();
    const bare = entry(U1, 10, SUBJECT_WO);
    await log.append(bare);
    const readBare = (await log.list(SUBJECT_WO, 10))[0];
    expect(readBare).toStrictEqual(bare);
    expect('detail' in (readBare ?? {})).toBe(false);

    const rich: AuditEntry = {
      id: auditId(U2),
      at: 20,
      actor: AGENT_ACTOR,
      action: 'gate.decided',
      subject: { kind: 'run', id: runIdOf(U4) },
      detail: { gate: 'review-approval', attempt: 2, approved: true },
    };
    await log.append(rich);
    const readRich = (await log.list(rich.subject, 10))[0];
    expect(readRich).toStrictEqual(rich);
    expect(readRich?.detail).toEqual({ gate: 'review-approval', attempt: 2, approved: true });
  });
});

describe('createSqliteEventLog (sqlite rules)', () => {
  it('I-8: appended entries are visible through a second openDatabase on the same file', async () => {
    const path = join(tmp, 'docket.db');
    const first = openDatabase(path);
    if (!first.ok) throw new Error('openDatabase must succeed');
    const log = createSqliteEventLog(first.value);
    await log.append(entry(U1, 1, SUBJECT_WO));
    await log.append(entry(U2, 2, SUBJECT_ACC));
    await log.append({ ...entry(U3, 3, { kind: 'binding', role: roleOf('reviewer') }), action: 'binding.saved' });
    first.value.close();

    const second = openDatabase(path);
    if (!second.ok) throw new Error('reopen must succeed');
    openDbs.push(second.value);
    const reopened = createSqliteEventLog(second.value);
    expect((await reopened.list(SUBJECT_WO, 10)).map((e) => e.id)).toEqual([auditId(U1)]);
    expect((await reopened.list(SUBJECT_ACC, 10)).map((e) => e.id)).toEqual([auditId(U2)]);
    expect((await reopened.list({ kind: 'binding', role: roleOf('reviewer') }, 10)).map((e) => e.id)).toEqual([auditId(U3)]);
  });
});
