// stores/account-groups.ts — how AccountGroups arranges accounts (U-41): one card per assistant
// holding that assistant's accounts, every installed assistant present even with no account, and a
// billing tag on each row read from the P-51 billing view — never from the connection kind alone.
// The wizard feeds it discovery candidates and Settings feeds it stored accounts; both rows carry
// the same grouping fields, so one component renders both.
export type Billing = 'included' | 'metered' | 'unknown';

export type BillingTagKey =
  | 'accountGroups.billing.sub'
  | 'accountGroups.billing.subKey'
  | 'accountGroups.billing.payg'
  | 'accountGroups.billing.unknown';

export interface BillingTag {
  readonly key: BillingTagKey;
  /** `warn` tags (pay per use, unknown) read in the amber tone: they may spend money. */
  readonly tone: 'plain' | 'warn';
}

/** The billing tag of an account: included is a subscription ("anahtarla" when it rides a key),
 *  metered is pay per use, unknown is "Ücret bilinmiyor". */
export const billingTag = (billing: Billing, viaKey: boolean): BillingTag => {
  if (billing === 'included') return { key: viaKey ? 'accountGroups.billing.subKey' : 'accountGroups.billing.sub', tone: 'plain' };
  if (billing === 'metered') return { key: 'accountGroups.billing.payg', tone: 'warn' };
  return { key: 'accountGroups.billing.unknown', tone: 'warn' };
};

/** The tag a row's sub-line uses on the order list: the same words without the colour. */
export const billingTagKey = (billing: Billing, viaKey: boolean): BillingTagKey => billingTag(billing, viaKey).key;

/** Whether an account's billing means it may spend money (anything not included). */
export const spendsMoney = (billing: Billing): boolean => billing !== 'included';

export interface GroupableRow {
  /** The provider the row belongs to; null when discovery does not know it. */
  readonly providerId: string | null;
}

export interface GroupProvider {
  readonly id: string;
  readonly name: string;
  /** Whether the assistant is installed on this machine; an installed one always has a group. */
  readonly installed: boolean;
}

export interface AccountGroup<R extends GroupableRow> {
  readonly providerId: string | null;
  readonly name: string | null;
  readonly rows: readonly R[];
}

/** Groups rows by provider. Groups follow the provider list's order, then providers only the rows
 *  know; an installed provider with no row still gets its (empty) group, one not installed gets
 *  none. Rows keep their order inside a group. */
export const groupAccountRows = <R extends GroupableRow>(
  rows: readonly R[],
  providers: readonly GroupProvider[],
): readonly AccountGroup<R>[] => {
  const groups: AccountGroup<R>[] = [];
  const seen = new Set<string | null>();
  for (const provider of providers) {
    const own = rows.filter((row) => row.providerId === provider.id);
    if (own.length === 0 && !provider.installed) continue;
    seen.add(provider.id);
    groups.push({ providerId: provider.id, name: provider.name, rows: own });
  }
  for (const row of rows) {
    if (seen.has(row.providerId)) continue;
    seen.add(row.providerId);
    groups.push({ providerId: row.providerId, name: null, rows: rows.filter((other) => other.providerId === row.providerId) });
  }
  return groups;
};

/** The toolbar's counts: accounts listed and assistants (groups) holding them. */
export const groupTotals = <R extends GroupableRow>(groups: readonly AccountGroup<R>[]): { readonly accounts: number; readonly assistants: number } => ({
  accounts: groups.reduce((sum, group) => sum + group.rows.length, 0),
  assistants: groups.length,
});
