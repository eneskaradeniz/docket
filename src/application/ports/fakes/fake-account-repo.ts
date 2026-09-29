// In-memory AccountRepo — accounts with their pools, meters and recorded spend.
import type {
  AccountId,
  EpochMs,
  Meter,
  MeterId,
  Pool,
  PoolId,
  WorkOrderId,
  RepoSlug,
} from '../../../domain/index';

import type { AccountRecord, AccountRepo } from '../account-repo';

interface SpendEntry {
  readonly accountId: AccountId;
  readonly repo: RepoSlug;
  readonly workOrderId: WorkOrderId;
  readonly at: EpochMs;
  readonly usd: number;
}

/** The port surface is complete on its own; the named type exists for tests that want it. */
export interface FakeAccountRepo extends AccountRepo {}

export const createFakeAccountRepo = (): FakeAccountRepo => {
  const accounts = new Map<AccountId, AccountRecord>();
  const poolsByAccount = new Map<AccountId, Pool[]>();
  const metersById = new Map<MeterId, Meter>();
  const spendings: SpendEntry[] = [];

  const poolsOf = (): readonly Pool[] => {
    const out: Pool[] = [];
    for (const pools of poolsByAccount.values()) out.push(...pools);
    return out;
  };

  return {
    save: async (record: AccountRecord): Promise<void> => {
      accounts.set(record.id, { ...record });
    },

    get: async (id: AccountId): Promise<AccountRecord | undefined> => accounts.get(id),

    list: async (): Promise<readonly AccountRecord[]> => [...accounts.values()],

    // Pools and meters of a removed account would dangle; spend is history and stays.
    remove: async (id: AccountId): Promise<void> => {
      const poolIds = new Set<PoolId>((poolsByAccount.get(id) ?? []).map((pool) => pool.id));
      for (const [meterId, meter] of metersById) {
        if (poolIds.has(meter.poolId)) metersById.delete(meterId);
      }
      poolsByAccount.delete(id);
      accounts.delete(id);
    },

    savePools: async (accountId: AccountId, pools: readonly Pool[]): Promise<void> => {
      poolsByAccount.set(accountId, pools.map((pool) => ({ ...pool })));
    },

    saveMeter: async (meter: Meter): Promise<void> => {
      metersById.set(meter.id, { ...meter });
    },

    pools: async (accountId?: AccountId): Promise<readonly Pool[]> =>
      accountId === undefined ? poolsOf() : poolsOf().filter((pool) => pool.accountId === accountId),

    // A meter belongs to the account that owns its pool; ownership is derived, not stored twice.
    meters: async (accountId?: AccountId): Promise<readonly Meter[]> => {
      const all = [...metersById.values()];
      if (accountId === undefined) return all;
      const owned = new Set<PoolId>((poolsByAccount.get(accountId) ?? []).map((pool) => pool.id));
      return all.filter((meter) => owned.has(meter.poolId));
    },

    recordSpend: async (entry: SpendEntry): Promise<void> => {
      spendings.push({ ...entry });
    },

    // `from`/`to` are inclusive on purpose: a window [t, t] still sees the entry at t.
    spend: async (filter: {
      readonly accountId?: AccountId;
      readonly repo?: RepoSlug;
      readonly workOrderId?: WorkOrderId;
      readonly from: EpochMs;
      readonly to: EpochMs;
    }): Promise<number> =>
      spendings
        .filter(
          (entry) =>
            (filter.accountId === undefined || entry.accountId === filter.accountId) &&
            (filter.repo === undefined || entry.repo === filter.repo) &&
            (filter.workOrderId === undefined || entry.workOrderId === filter.workOrderId) &&
            entry.at >= filter.from &&
            entry.at <= filter.to,
        )
        .reduce((sum, entry) => sum + entry.usd, 0),
  };
};
