import { describe, expect, it } from 'vitest';

import { parseUlid, type AccountId } from '../../domain/index';
import type { AccountTestRecord } from '../../application/index';

import { createMemoryAccountTestRepo } from './account-test-repo';

const parsed = parseUlid<'account'>('01ARZ3NDEKTSV4RRFFQ69G5FA4');
if (!parsed.ok) throw new Error('fixture ulid must parse');
const ACCOUNT: AccountId = parsed.value;

const failed = (detail: string): AccountTestRecord => ({
  accountId: ACCOUNT, model: null, state: 'failed', class: 'auth', detail, startedAt: 1, endedAt: 2,
});

describe('createMemoryAccountTestRepo', () => {
  it('I-35: save upserts by account, get returns it, clear forgets it', async () => {
    const repo = createMemoryAccountTestRepo();
    expect(await repo.get(ACCOUNT)).toBeUndefined();
    await repo.save({ accountId: ACCOUNT, model: null, state: 'running', startedAt: 1 });
    await repo.save({ accountId: ACCOUNT, model: 'm', state: 'ok', startedAt: 1, endedAt: 2 });
    expect(await repo.get(ACCOUNT)).toEqual({ accountId: ACCOUNT, model: 'm', state: 'ok', startedAt: 1, endedAt: 2 });
    await repo.clear(ACCOUNT);
    expect(await repo.get(ACCOUNT)).toBeUndefined();
  });

  it('I-35: a stored detail never carries a token-shaped value', async () => {
    const repo = createMemoryAccountTestRepo();
    const token = 'sk-ant-api03-abcdefghijklmnopqrstuvwxyz0123456789';
    await repo.save(failed(`invalid key ${token} rejected`));
    const stored = await repo.get(ACCOUNT);
    expect(stored?.detail).not.toContain(token);
    expect(stored?.detail).toContain('invalid key');
  });

  it('I-35: a stored detail is cut to 300 code points', async () => {
    const repo = createMemoryAccountTestRepo();
    await repo.save(failed('\u{1F600}'.repeat(500)));
    expect(Array.from((await repo.get(ACCOUNT))?.detail ?? '')).toHaveLength(300);
  });

  it('I-35: a token straddling the cut point is redacted before cutting, not left half-visible', async () => {
    const repo = createMemoryAccountTestRepo();
    const token = 'sk-ant-api03-abcdefghijklmnopqrstuvwxyz0123456789';
    await repo.save(failed(`${'x'.repeat(289)} ${token}`));
    const detail = (await repo.get(ACCOUNT))?.detail ?? '';
    expect(detail).not.toContain('sk-ant');
    expect(detail).not.toContain('abcdef');
  });

  it('I-35: records without a detail are stored as given', async () => {
    const repo = createMemoryAccountTestRepo();
    const record: AccountTestRecord = { accountId: ACCOUNT, model: null, state: 'ok', startedAt: 1, endedAt: 2 };
    await repo.save(record);
    expect(await repo.get(ACCOUNT)).toEqual(record);
    expect(await repo.get(ACCOUNT)).not.toHaveProperty('detail');
  });
});
