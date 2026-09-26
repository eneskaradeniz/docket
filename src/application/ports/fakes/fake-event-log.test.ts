import { describe, expect, it } from 'vitest';

import { parseSlug, parseUlid } from '../../../domain/index';

import type { AuditEntry, AuditSubject } from '../event-log';

import { createFakeEventLog } from './fake-event-log';

const U1 = '01ARZ3NDEKTSV4RRFFQ69G5FAV';
const U2 = '01ARZ3NDEKTSV4RRFFQ69G5FAW';
const U3 = '01ARZ3NDEKTSV4RRFFQ69G5FAX';
const U4 = '01ARZ3NDEKTSV4RRFFQ69G5FAY';

const auditId = (s: string): AuditEntry['id'] => {
  const parsed = parseUlid<'audit'>(s);
  if (!parsed.ok) throw new Error('fixture ulid must parse');
  return parsed.value;
};

const workOrderSubject = (s: string): AuditSubject => {
  const parsed = parseUlid<'work-order'>(s);
  if (!parsed.ok) throw new Error('fixture ulid must parse');
  return { kind: 'work_order', id: parsed.value };
};

const entry = (id: string, at: number, subject: AuditSubject): AuditEntry => ({
  id: auditId(id),
  at,
  actor: { kind: 'user', id: 'u1' },
  action: 'account.saved',
  subject,
});

const SUBJECT_A: AuditSubject = workOrderSubject(U1);
const SUBJECT_B: AuditSubject = workOrderSubject(U2);

describe('createFakeEventLog', () => {
  it('A-2: list returns the subject’s entries newest first', async () => {
    const log = createFakeEventLog();
    await log.append(entry(U1, 1, SUBJECT_A));
    await log.append(entry(U2, 5, SUBJECT_A));
    await log.append(entry(U3, 3, SUBJECT_A));
    await log.append(entry(U4, 9, SUBJECT_B));

    const listed = await log.list(SUBJECT_A, 10);
    expect(listed.map((e) => e.id)).toEqual([auditId(U2), auditId(U3), auditId(U1)]);
  });

  it('A-2: keeps the latest append first when two entries share the same `at`', async () => {
    const log = createFakeEventLog();
    await log.append(entry(U1, 7, SUBJECT_A));
    await log.append(entry(U2, 7, SUBJECT_A));

    const listed = await log.list(SUBJECT_A, 10);
    expect(listed.map((e) => e.id)).toEqual([auditId(U2), auditId(U1)]);
  });

  it('A-2: list honours the limit — 0 yields none, beyond count yields all', async () => {
    const log = createFakeEventLog();
    await log.append(entry(U1, 1, SUBJECT_A));
    await log.append(entry(U2, 2, SUBJECT_A));
    await log.append(entry(U3, 3, SUBJECT_A));

    expect(await log.list(SUBJECT_A, 0)).toEqual([]);
    expect((await log.list(SUBJECT_A, 2)).map((e) => e.id)).toEqual([auditId(U3), auditId(U2)]);
    expect((await log.list(SUBJECT_A, 99)).map((e) => e.id)).toEqual([
      auditId(U3),
      auditId(U2),
      auditId(U1),
    ]);
  });

  it('A-2: list and entries return copies, never internal arrays', async () => {
    const log = createFakeEventLog();
    await log.append(entry(U1, 1, SUBJECT_A));

    const first = await log.list(SUBJECT_A, 10);
    const second = await log.list(SUBJECT_A, 10);
    expect(first).not.toBe(second);

    (first as AuditEntry[]).push(entry(U2, 2, SUBJECT_A));
    (log.entries() as AuditEntry[]).push(entry(U3, 3, SUBJECT_A));
    expect(await log.list(SUBJECT_A, 10)).toEqual([entry(U1, 1, SUBJECT_A)]);
    expect(log.entries()).toEqual([entry(U1, 1, SUBJECT_A)]);
  });

  it('matches binding subjects by role and ignores other kinds', async () => {
    const role = parseSlug<'role'>('reviewer');
    if (!role.ok) throw new Error('fixture slug must parse');
    const binding: AuditSubject = { kind: 'binding', role: role.value };
    const otherRole = parseSlug<'role'>('implementer');
    if (!otherRole.ok) throw new Error('fixture slug must parse');

    const log = createFakeEventLog();
    await log.append({ ...entry(U1, 1, binding), action: 'binding.saved' });
    await log.append({ ...entry(U2, 2, { kind: 'binding', role: otherRole.value }), action: 'binding.saved' });

    const listed = await log.list(binding, 10);
    expect(listed).toHaveLength(1);
    expect(listed[0]?.id).toBe(auditId(U1));
  });

  it('entries() reports every append in append order regardless of subject', async () => {
    const log = createFakeEventLog();
    await log.append(entry(U1, 3, SUBJECT_A));
    await log.append(entry(U2, 1, SUBJECT_B));
    await log.append(entry(U3, 2, SUBJECT_A));

    expect(log.entries().map((e) => e.id)).toEqual([auditId(U1), auditId(U2), auditId(U3)]);
  });
});
