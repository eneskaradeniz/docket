// Persistence port for accounts plus their pools, meters and recorded spend.
import type {
  AccountId,
  AuthMode,
  EpochMs,
  LimitPolicy,
  Meter,
  Pool,
  ProjectSlug,
  SpendCap,
  WorkOrderId,
  RepoSlug,
} from '../../domain/index';

export interface AccountRecord {
  readonly id: AccountId;
  readonly provider: string; // provider definition id (data)
  readonly label: string; // user-given, verbatim
  readonly authMode: AuthMode;
  readonly plan?: string;
  readonly limitPolicy: LimitPolicy;
  readonly secretRef?: string; // key into SecretVault; never the secret itself
  readonly caps: readonly { readonly scope: 'account_day' | 'account_month'; readonly cap: SpendCap }[];
}

export interface AccountRepo {
  save(record: AccountRecord): Promise<void>; // upsert
  get(id: AccountId): Promise<AccountRecord | undefined>;
  list(): Promise<readonly AccountRecord[]>;
  remove(id: AccountId): Promise<void>;
  savePools(accountId: AccountId, pools: readonly Pool[]): Promise<void>; // replaces the account's pools
  saveMeter(meter: Meter): Promise<void>; // upsert by id
  pools(accountId?: AccountId): Promise<readonly Pool[]>;
  meters(accountId?: AccountId): Promise<readonly Meter[]>;
  recordSpend(entry: {
    readonly accountId: AccountId;
    readonly project: ProjectSlug;
    readonly repo: RepoSlug;
    readonly workOrderId: WorkOrderId;
    readonly at: EpochMs;
    readonly usd: number;
  }): Promise<void>;
  spend(filter: {
    readonly accountId?: AccountId;
    readonly project?: ProjectSlug;
    readonly repo?: RepoSlug;
    readonly workOrderId?: WorkOrderId;
    readonly from: EpochMs;
    readonly to: EpochMs;
  }): Promise<number>;
}
