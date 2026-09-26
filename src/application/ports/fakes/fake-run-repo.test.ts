import { describe, expect, it } from 'vitest';

import type { AgentEvent } from '../../../domain/index';
import { parseSlug, parseUlid, type AccountRoute, type RoleSlug, type StageSlug, type WorkOrderId } from '../../../domain/index';

import type { RunRecord } from '../run-repo';

import { createFakeRunRepo } from './fake-run-repo';

const U1 = '01ARZ3NDEKTSV4RRFFQ69G5FAV';
const U2 = '01ARZ3NDEKTSV4RRFFQ69G5FAW';
const U3 = '01ARZ3NDEKTSV4RRFFQ69G5FAX';
const U4 = '01ARZ3NDEKTSV4RRFFQ69G5FAY';

const runId = (s: string): RunRecord['id'] => {
  const parsed = parseUlid<'run'>(s);
  if (!parsed.ok) throw new Error('fixture ulid must parse');
  return parsed.value;
};

const accountIdOf = (s: string): AccountRoute['accountId'] => {
  const parsed = parseUlid<'account'>(s);
  if (!parsed.ok) throw new Error('fixture ulid must parse');
  return parsed.value;
};

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

const STAGE: StageSlug = slugOf<'stage'>('implement');
const ROLE: RoleSlug = slugOf<'role'>('implementer');
const ROUTE: AccountRoute = { accountId: accountIdOf(U4) };

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

const textEvent = (at: number, delta: string): AgentEvent => ({ type: 'text', at, delta });

describe('createFakeRunRepo', () => {
  it('A-2: listForWorkOrder orders by startedAt ascending and only returns that work order’s runs', async () => {
    const repo = createFakeRunRepo();
    await repo.create(record(U3, U1, 30));
    await repo.create(record(U1, U1, 10));
    await repo.create(record(U2, U1, 20));
    await repo.create(record(U4, U2, 5));

    expect((await repo.listForWorkOrder(woId(U1))).map((r) => r.id)).toEqual([runId(U1), runId(U2), runId(U3)]);
    expect((await repo.listForWorkOrder(woId(U2))).map((r) => r.id)).toEqual([runId(U4)]);
  });

  it('A-2: startedAt ties keep insertion order', async () => {
    const repo = createFakeRunRepo();
    await repo.create(record(U1, U3, 5));
    await repo.create(record(U2, U3, 5));

    expect((await repo.listForWorkOrder(woId(U3))).map((r) => r.id)).toEqual([runId(U1), runId(U2)]);
  });

  it('A-2: listActive returns only runs without endedAt, ordered by startedAt', async () => {
    const repo = createFakeRunRepo();
    await repo.create(record(U1, U3, 10));
    await repo.create(record(U2, U3, 20));
    await repo.create(record(U4, U3, 15));
    await repo.update(runId(U4), { endedAt: 99, outcome: 'succeeded' });

    expect((await repo.listActive()).map((r) => r.id)).toEqual([runId(U1), runId(U2)]);
  });

  it('update applies only the patched fields', async () => {
    const repo = createFakeRunRepo();
    await repo.create(record(U1, U3, 10));

    await repo.update(runId(U1), { outcome: 'failed', sessionRef: 's-1' });

    const updated = await repo.get(runId(U1));
    expect(updated?.outcome).toBe('failed');
    expect(updated?.sessionRef).toBe('s-1');
    expect(updated?.startedAt).toBe(10);
    expect(updated?.workOrderId).toBe(woId(U3));
    expect(updated?.endedAt).toBeUndefined();

    await repo.update(runId(U1), { endedAt: 50, autoResumesUsed: 2 });
    const again = await repo.get(runId(U1));
    expect(again?.endedAt).toBe(50);
    expect(again?.autoResumesUsed).toBe(2);
    expect(again?.outcome).toBe('failed');
  });

  it('A-2: appendEvents keeps arrival order and events returns a copy', async () => {
    const repo = createFakeRunRepo();
    await repo.create(record(U1, U3, 10));

    await repo.appendEvents(runId(U1), [textEvent(1, 'a'), textEvent(2, 'b')]);
    await repo.appendEvents(runId(U1), [textEvent(3, 'c')]);

    const events = await repo.events(runId(U1));
    expect(events.map((e) => (e.type === 'text' ? e.delta : ''))).toEqual(['a', 'b', 'c']);

    const other = await repo.events(runId(U1));
    expect(other).not.toBe(events);
    (events as AgentEvent[]).push(textEvent(4, 'd'));
    expect((await repo.events(runId(U1))).map((e) => (e.type === 'text' ? e.delta : ''))).toEqual(['a', 'b', 'c']);
  });

  it('round-trips created runs, reports unknown ids as undefined/empty, and throws on misuse', async () => {
    const repo = createFakeRunRepo();
    await repo.create(record(U1, U3, 10));

    expect(await repo.get(runId(U1))).toEqual(record(U1, U3, 10));
    expect(await repo.get(runId(U2))).toBeUndefined();
    expect(await repo.events(runId(U2))).toEqual([]);

    await expect(repo.create(record(U1, U3, 11))).rejects.toThrow();
    await expect(repo.update(runId(U2), { outcome: 'failed' })).rejects.toThrow();
    await expect(repo.appendEvents(runId(U2), [textEvent(1, 'a')])).rejects.toThrow();
  });
});
