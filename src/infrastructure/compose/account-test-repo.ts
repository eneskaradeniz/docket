// In-memory AccountTestRepo (I-35): records live for the process lifetime, and a stored detail
// never carries a token-shaped value.
import type { AccountId } from '../../domain/index';
import { ACCOUNT_TEST_DETAIL_MAX_CHARS } from '../../domain/index';
import type { AccountTestRecord, AccountTestRepo } from '../../application/index';
import { redactSecrets } from '../gates/index';

// Redact first, then cut: cutting first could slice a token in half and defeat the pattern.
const safeDetail = (detail: string): string =>
  Array.from(redactSecrets(detail)).slice(0, ACCOUNT_TEST_DETAIL_MAX_CHARS).join('');

export function createMemoryAccountTestRepo(): AccountTestRepo {
  const records = new Map<AccountId, AccountTestRecord>();
  return {
    get: async (accountId) => records.get(accountId),
    save: async (record) => {
      records.set(record.accountId, record.detail === undefined ? { ...record } : { ...record, detail: safeDetail(record.detail) });
    },
    clear: async (accountId) => {
      records.delete(accountId);
    },
  };
}
