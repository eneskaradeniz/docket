// In-memory AccountTestRepo and ScratchDirs (A-1: every port has a fake; A-3: scripted helpers
// record their calls).
import { describe, expect, it } from 'vitest';

import { parseUlid, type AccountId } from '../../../domain/index';

import { createFakeAccountTestRepo } from './fake-account-test-repo';
import { createFakeScratchDirs } from './fake-scratch-dirs';

const parsed = parseUlid<'account'>('01ARZ3NDEKTSV4RRFFQ69G5FA4');
if (!parsed.ok) throw new Error('fixture ulid must parse');
const ACCOUNT: AccountId = parsed.value;

describe('createFakeAccountTestRepo', () => {
  it('A-1: save upserts by account, get reads it back, clear forgets it', async () => {
    const repo = createFakeAccountTestRepo();
    expect(await repo.get(ACCOUNT)).toBeUndefined();
    await repo.save({ accountId: ACCOUNT, model: null, state: 'running', startedAt: 1 });
    await repo.save({ accountId: ACCOUNT, model: 'm', state: 'ok', startedAt: 1, endedAt: 2 });
    expect(await repo.get(ACCOUNT)).toEqual({ accountId: ACCOUNT, model: 'm', state: 'ok', startedAt: 1, endedAt: 2 });
    await repo.clear(ACCOUNT);
    expect(await repo.get(ACCOUNT)).toBeUndefined();
  });
});

describe('createFakeScratchDirs', () => {
  it('A-3: records created and disposed paths in call order', async () => {
    const scratch = createFakeScratchDirs();
    const a = await scratch.create('account-test');
    const b = await scratch.create('account-test');
    expect(a.path).not.toBe(b.path);
    await b.dispose();
    expect(scratch.created()).toEqual([a.path, b.path]);
    expect(scratch.disposed()).toEqual([b.path]);
  });
});
