// In-memory AccountTestRepo.
import type { AccountId } from '../../../domain/index';

import type { AccountTestRecord, AccountTestRepo } from '../account-test-repo';

export interface FakeAccountTestRepo extends AccountTestRepo {}

export const createFakeAccountTestRepo = (): FakeAccountTestRepo => {
  const records = new Map<AccountId, AccountTestRecord>();
  return {
    get: async (accountId: AccountId): Promise<AccountTestRecord | undefined> => records.get(accountId),
    save: async (record: AccountTestRecord): Promise<void> => {
      records.set(record.accountId, { ...record });
    },
    clear: async (accountId: AccountId): Promise<void> => {
      records.delete(accountId);
    },
  };
};
