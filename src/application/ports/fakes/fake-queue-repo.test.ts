import { describe, expect, it } from 'vitest';

import type { QueueItem } from '../../../domain/index';
import { parseUlid, type AccountId, type StageSlug, type WorkOrderId, type WorkspaceSlug } from '../../../domain/index';

import { createFakeQueueRepo } from './fake-queue-repo';

const U1 = '01ARZ3NDEKTSV4RRFFQ69G5FAV';
const U2 = '01ARZ3NDEKTSV4RRFFQ69G5FAW';

const queueIdOf = (s: string): QueueItem['id'] => {
  const parsed = parseUlid<'queue-item'>(s);
  if (!parsed.ok) throw new Error('fixture ulid must parse');
  return parsed.value;
};

const woIdOf = (s: string): WorkOrderId => {
  const parsed = parseUlid<'work-order'>(s);
  if (!parsed.ok) throw new Error('fixture ulid must parse');
  return parsed.value;
};

const accountIdOf = (s: string): AccountId => {
  const parsed = parseUlid<'account'>(s);
  if (!parsed.ok) throw new Error('fixture ulid must parse');
  return parsed.value;
};

const WS = 'acme' as WorkspaceSlug;
const STAGE = 'implement' as StageSlug;

const item = (id: string, priority = 0): QueueItem => ({
  id: queueIdOf(id),
  workOrderId: woIdOf(id),
  workspace: WS,
  stage: STAGE,
  route: { accountId: accountIdOf(U1) },
  priority,
  enqueuedAt: 1,
});

describe('createFakeQueueRepo', () => {
  it('put upserts by id, keeping the first insertion position', async () => {
    const repo = createFakeQueueRepo();
    await repo.put(item(U1, 1));
    await repo.put(item(U2, 2));
    await repo.put({ ...item(U1), priority: 9 });

    const listed = await repo.list();
    expect(listed.map((i) => i.id)).toEqual([queueIdOf(U1), queueIdOf(U2)]);
    expect(listed[0]?.priority).toBe(9);
  });

  it('remove deletes an item and is a no-op for unknown ids', async () => {
    const repo = createFakeQueueRepo();
    await repo.put(item(U1));
    await repo.put(item(U2));

    await repo.remove(queueIdOf(U1));
    expect((await repo.list()).map((i) => i.id)).toEqual([queueIdOf(U2)]);
    await expect(repo.remove(queueIdOf(U1))).resolves.toBeUndefined();
    expect(await repo.list()).toHaveLength(1);
  });

  it('A-2: list returns a copy, never the internal array', async () => {
    const repo = createFakeQueueRepo();
    await repo.put(item(U1));

    const first = await repo.list();
    const second = await repo.list();
    expect(first).not.toBe(second);
    (first as QueueItem[]).push(item(U2));
    expect(await repo.list()).toHaveLength(1);
  });
});
