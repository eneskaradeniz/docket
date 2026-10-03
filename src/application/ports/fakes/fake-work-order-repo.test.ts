import { describe, expect, it } from 'vitest';

import type { Actor } from '../../../domain/index';
import { parseSlug, parseUlid, type FlowSlug, type RepoSlug } from '../../../domain/index';

import type { WorkOrderEvent } from '../../../domain/index';

import type { WorkOrderRecord } from '../work-order-repo';

import { createFakeWorkOrderRepo } from './fake-work-order-repo';

const U1 = '01ARZ3NDEKTSV4RRFFQ69G5FAV';
const U2 = '01ARZ3NDEKTSV4RRFFQ69G5FAW';
const U3 = '01ARZ3NDEKTSV4RRFFQ69G5FAX';
const U4 = '01ARZ3NDEKTSV4RRFFQ69G5FAZ';

const woId = (s: string): WorkOrderRecord['id'] => {
  const parsed = parseUlid<'work-order'>(s);
  if (!parsed.ok) throw new Error('fixture ulid must parse');
  return parsed.value;
};

const slugOf = <B extends string>(s: string) => {
  const parsed = parseSlug<B>(s);
  if (!parsed.ok) throw new Error('fixture slug must parse');
  return parsed.value;
};

const ACTOR: Actor = { kind: 'user', id: 'u1' };
const FLOW: FlowSlug = slugOf<'flow'>('standard');
const ACME: RepoSlug = slugOf<'repo'>('acme');
const OTHER: RepoSlug = slugOf<'repo'>('other');

const record = (id: string, createdAt: number, repo: RepoSlug = ACME): WorkOrderRecord => ({
  id: woId(id),
  project: slugOf<'project'>('proj'),
  repo,
  flow: FLOW,
  title: `title ${id}`,
  createdAt,
  createdBy: ACTOR,
});

const createdEvent = (at: number): WorkOrderEvent => ({ type: 'created', at, by: ACTOR, flow: FLOW });
const blockedEvent = (at: number, reason: string): WorkOrderEvent => ({ type: 'blocked', at, by: ACTOR, reason });

describe('createFakeWorkOrderRepo', () => {
  it('A-2: list orders by createdAt ascending and filters by repo', async () => {
    const repo = createFakeWorkOrderRepo();
    await repo.create(record(U3, 30));
    await repo.create(record(U1, 10));
    await repo.create(record(U2, 20));
    await repo.create(record(U4, 40, OTHER));

    expect((await repo.list({})).map((r) => r.id)).toEqual([woId(U1), woId(U2), woId(U3), woId(U4)]);
    expect((await repo.list({ repo: ACME })).map((r) => r.id)).toEqual([woId(U1), woId(U2), woId(U3)]);
    expect((await repo.list({ repo: OTHER })).map((r) => r.id)).toEqual([woId(U4)]);
  });

  it('A-2: createdAt ties keep insertion order', async () => {
    const repo = createFakeWorkOrderRepo();
    await repo.create(record(U1, 5));
    await repo.create(record(U2, 5));
    await repo.create(record(U3, 5));

    expect((await repo.list({})).map((r) => r.id)).toEqual([woId(U1), woId(U2), woId(U3)]);
  });

  it('A-29: number is the 1-based rank by createdAt asc over every work order, id deciding ties', async () => {
    const repo = createFakeWorkOrderRepo();
    await repo.create(record(U3, 30));
    // U2 is inserted before U1 but carries the larger id: the tie is settled by id, never by
    // insertion order.
    await repo.create(record(U2, 10));
    await repo.create(record(U4, 40, OTHER));
    await repo.create(record(U1, 10));

    expect(await repo.number(woId(U1))).toBe(1);
    expect(await repo.number(woId(U2))).toBe(2);
    expect(await repo.number(woId(U3))).toBe(3);
    // The rank spans every work order on the machine, not just one repo's.
    expect(await repo.number(woId(U4))).toBe(4);
  });

  it('A-29: a later work order never renumbers an earlier one', async () => {
    const repo = createFakeWorkOrderRepo();
    await repo.create(record(U1, 10));
    expect(await repo.number(woId(U1))).toBe(1);
    await repo.create(record(U2, 20));
    await repo.create(record(U3, 30));
    expect(await repo.number(woId(U1))).toBe(1);
    expect(await repo.number(woId(U3))).toBe(3);
  });

  it('A-29: an unknown id numbers undefined', async () => {
    const repo = createFakeWorkOrderRepo();
    await repo.create(record(U1, 10));

    expect(await repo.number(woId(U2))).toBeUndefined();
  });

  it('A-2: list and events return copies, never internal arrays', async () => {
    const repo = createFakeWorkOrderRepo();
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

  it('A-2: events come back in append order', async () => {
    const repo = createFakeWorkOrderRepo();
    await repo.create(record(U1, 1));
    await repo.appendEvent(woId(U1), createdEvent(1));
    await repo.appendEvent(woId(U1), blockedEvent(2, 'waiting'));
    await repo.appendEvent(woId(U1), { type: 'unblocked', at: 3, by: ACTOR });

    const events = await repo.events(woId(U1));
    expect(events.map((e) => e.type)).toEqual(['created', 'blocked', 'unblocked']);
  });

  it('round-trips a created record and reports unknown ids as undefined', async () => {
    const repo = createFakeWorkOrderRepo();
    await repo.create(record(U1, 1));

    expect(await repo.get(woId(U1))).toEqual(record(U1, 1));
    expect(await repo.get(woId(U2))).toBeUndefined();
    expect(await repo.events(woId(U2))).toEqual([]);
  });

  it('throws on fixture misuse: duplicate create, event for an unknown work order', async () => {
    const repo = createFakeWorkOrderRepo();
    await repo.create(record(U1, 1));

    await expect(repo.create(record(U1, 2))).rejects.toThrow();
    await expect(repo.appendEvent(woId(U2), createdEvent(1))).rejects.toThrow();
  });
});
