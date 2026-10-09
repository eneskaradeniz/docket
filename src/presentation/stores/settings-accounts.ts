// stores/settings-accounts.ts — Settings → Hesaplar as AccountGroups rows (U-43): each stored
// account becomes the same row shape the wizard's candidates use — mark, label, billing tag,
// `path · host`, status — so one component renders both. The billing tag reads the account's
// billing view and the status keeps U-28's reading (Hazır · Rezervde · Veri yok · Model hatası);
// a row whose provider's login probe proved nothing carries the inline "Test et" (U-39).
import type { AccountDisplay } from './settings';
import { accountStatus, accountStatusTone, type AccountStatus } from './account-editor';
import type { Billing, GroupableRow, RowStanding } from './account-groups';
import { providerUnverified } from './account-test';
import type { LampTone, ProviderRow } from './candidates';

export interface SettingsAccountRow extends GroupableRow {
  readonly id: string;
  readonly label: string;
  readonly billing: Billing;
  /** The account rides a key (its connection is `api_key`): an included one reads "Abonelik · anahtarla". */
  readonly viaKey: boolean;
  /** The stored config folder, verbatim; empty for a machine login. */
  readonly path: string;
  readonly host: string | null;
  readonly status: AccountStatus;
  readonly tone: LampTone;
  /** The provider's login probe proved nothing (U-38): the row offers "Test et". */
  readonly unverified: boolean;
}

/** A stored account's U-45 standing: none of its statuses is needs-login or Doğrulanamadı, so
 *  every stored account — ready, Rezervde, Veri yok, Model hatası — stays in Bulunanlar (U-45a);
 *  an unverified provider keeps its Test et, never a failing section. */
const SETTINGS_STANDING: Readonly<Record<AccountStatus, RowStanding>> = {
  ready: 'ready',
  reserve: 'other',
  noData: 'other',
  modelError: 'other',
};

export const settingsStanding = (status: AccountStatus): RowStanding => SETTINGS_STANDING[status];

export const settingsAccountRows = (
  accounts: readonly AccountDisplay[],
  providers: readonly Pick<ProviderRow, 'id' | 'statusKey'>[],
): readonly SettingsAccountRow[] =>
  accounts.map((account): SettingsAccountRow => {
    const status = accountStatus(account.detail);
    return {
      id: account.id,
      providerId: account.provider === '' ? null : account.provider,
      label: account.label,
      billing: account.detail.billing,
      viaKey: account.detail.authMode === 'api_key',
      path: account.detail.identityDir ?? '',
      host: account.detail.endpointHost,
      status,
      tone: accountStatusTone(status),
      unverified: providerUnverified(providers, account.provider),
    };
  });
