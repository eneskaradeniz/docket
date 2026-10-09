// Machine-local state of the account test, kept for the app's lifetime (I-35).
import type { AccountId, AccountTestClass, EpochMs } from '../../domain/index';

export interface AccountTestRecord {
  readonly accountId: AccountId;
  readonly model: string | null; // the model tested; null = the route's default model
  readonly state: 'running' | 'ok' | 'failed';
  readonly class?: AccountTestClass; // failed only
  readonly detail?: string; // failed only; redacted by the adapter
  readonly startedAt: EpochMs;
  readonly endedAt?: EpochMs;
}

export interface AccountTestRepo {
  get(accountId: AccountId): Promise<AccountTestRecord | undefined>;
  save(record: AccountTestRecord): Promise<void>; // upsert by accountId
  clear(accountId: AccountId): Promise<void>;
}
