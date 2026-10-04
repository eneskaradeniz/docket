// components/account-groups.tsx — the AccountGroups (U-41): one card per assistant (mark, name,
// account count) and one row per account — label, billing tag, `path · host` in mono, status, ✎,
// and the selection circle where the host selects (the wizard's Hesaplar; Settings has none). The
// same component draws discovery candidates and stored accounts: the host maps its rows to
// `AccountRowView`. Extras a host owns (the key-move card, the test line) are passed per row.
import type { ReactNode } from 'react';

import { t, type Locale } from '../labels/t';
import { billingTag, type AccountGroup, type Billing, type GroupableRow } from '../stores/account-groups';
import { candidateStatusTone, type CandidateRow, type LampTone } from '../stores/candidates';
import { InfoBubble } from './info-bubble';
import { ProviderMark, type ProviderMarkProps } from './provider-mark';
import { StatusLamp } from './status-lamp';

export interface AccountRowView extends GroupableRow {
  readonly id: string;
  readonly label: string;
  readonly billing: Billing;
  readonly viaKey: boolean;
  /** The folder the account reads from; empty for a machine login. */
  readonly path: string;
  readonly host: string | null;
  /** The status word, resolved, with its lamp hue. */
  readonly status: { readonly tone: LampTone; readonly text: string };
  /** A sentence under the row, resolved (needs a login, test it after setup). */
  readonly hint?: string;
  /** Selection standing; only meaningful when the host selects. */
  readonly selected?: boolean;
  readonly disabled?: boolean;
  /** Why a disabled row is disabled, resolved. */
  readonly reason?: string;
  /** Warning tags with their ⓘ text, resolved. */
  readonly warnings?: readonly { readonly text: string; readonly info: string }[];
}

/** A discovery candidate as AccountGroups draws it: its status word and hue, the login or "test it
 *  after setup" sentence, its warning tags and, when it cannot be selected, the reason. `source`
 *  keeps the candidate row for the host's handlers. */
export const candidateRowView = <R extends CandidateRow>(
  row: R,
  locale: Locale,
  label: string,
  providerName: string | null,
): AccountRowView & { readonly source: R } => ({
  id: row.id,
  providerId: row.provider,
  label,
  billing: row.billing,
  viaKey: row.viaKey,
  path: row.displayPath,
  host: row.endpointHost,
  status: { tone: candidateStatusTone(row.statusKey), text: t(locale, row.statusKey) },
  ...(row.hintKey === null ? {} : { hint: t(locale, row.hintKey).replace('{name}', providerName ?? '') }),
  selected: row.selected,
  disabled: !row.selectable,
  ...(row.disabledReasonKey === null ? {} : { reason: t(locale, row.disabledReasonKey) }),
  warnings: row.warnKeys.map((key) => ({ text: t(locale, key), info: t(locale, 'candidates.info.env_overrides_login') })),
  source: row,
});

export interface AccountGroupsProps<R extends AccountRowView> {
  readonly locale: Locale;
  readonly groups: readonly AccountGroup<R>[];
  readonly markFor: (provider: string) => ProviderMarkProps['mark'];
  /** The assistant's display name for a group the provider list does not name. */
  readonly nameOf: (group: AccountGroup<R>) => string;
  /** The wizard selects: a click or Space/Enter toggles. Absent = a plain list. */
  readonly onToggle?: (row: R) => void;
  readonly onEdit?: (row: R) => void;
  /** An element at the row's right before the status (Test et). */
  readonly trailing?: (row: R) => ReactNode;
  /** Content under the row's own lines (a test result, the key-move card). */
  readonly below?: (row: R) => ReactNode;
}

const Pencil = () => (
  <svg viewBox="0 0 16 16" aria-hidden="true" className="h-[15px] w-[15px]" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
    <path d="M3 13h3l7.8-7.8a1.4 1.4 0 0 0-2-2L4 11v2Z" />
    <path d="m10.8 4.2 1 1" />
  </svg>
);

const Check = () => (
  <svg viewBox="0 0 16 16" aria-hidden="true" className="h-3 w-3" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <path d="m3.5 8.2 3 3 6-6.4" />
  </svg>
);

/** The billing tag beside an account's name. */
export function BillingTag({ locale, billing, viaKey }: { readonly locale: Locale; readonly billing: Billing; readonly viaKey: boolean }) {
  const tag = billingTag(billing, viaKey);
  return (
    <span
      data-billing-tag={billing}
      className={`whitespace-nowrap rounded-control border px-1.5 text-[11px] font-bold ${tag.tone === 'warn' ? 'border-signal/40 text-signal-soft' : 'border-hairline text-inkdim'}`}
    >
      {t(locale, tag.key)}
    </span>
  );
}

/** The ✎ button every account row and budget row carries. */
export function EditButton({ locale, onClick }: { readonly locale: Locale; readonly onClick: () => void }) {
  return (
    <button
      type="button"
      aria-label={t(locale, 'accountGroups.edit')}
      title={t(locale, 'accountGroups.edit')}
      onClick={(event) => {
        event.stopPropagation();
        onClick();
      }}
      className="grid h-[30px] w-[30px] flex-none place-items-center rounded-control text-inkdim hover:bg-raised hover:text-ink"
    >
      <Pencil />
    </button>
  );
}

function Row<R extends AccountRowView>({ row, locale, onToggle, onEdit, trailing, below }: Pick<AccountGroupsProps<R>, 'locale' | 'onToggle' | 'onEdit' | 'trailing' | 'below'> & { readonly row: R }) {
  const selectable = onToggle !== undefined;
  const meta = [row.path, row.host].filter((part): part is string => part !== null && part !== '').join(' · ');
  const toggle = (): void => {
    if (selectable && row.disabled !== true) onToggle(row);
  };
  return (
    <li data-account-row={row.id} className="border-t border-hairline first:border-t-0">
      <div
        {...(selectable ? { role: 'checkbox', tabIndex: 0, 'aria-checked': row.selected === true, 'aria-disabled': row.disabled === true } : {})}
        onClick={toggle}
        onKeyDown={(event) => {
          if (selectable && (event.key === ' ' || event.key === 'Enter')) {
            event.preventDefault();
            toggle();
          }
        }}
        className={`flex min-h-[56px] items-center gap-3 px-3.5 py-2.5 ${selectable ? 'hover:bg-raised' : ''} ${row.disabled === true ? 'opacity-60' : ''}`}
      >
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2 font-bold text-ink">
            <span className="min-w-0 truncate">{row.label}</span>
            <BillingTag locale={locale} billing={row.billing} viaKey={row.viaKey} />
            {row.warnings?.map((warning) => (
              <span key={warning.text} className="inline-flex items-center gap-1 text-[12px] font-normal text-signal-soft">
                {warning.text}
                <InfoBubble locale={locale} subject={warning.text} body={warning.info} />
              </span>
            ))}
          </div>
          {meta !== '' ? (
            <div className="truncate font-mono text-[12px] text-inkdim" title={meta}>
              {meta}
            </div>
          ) : null}
          {row.reason !== undefined ? <div className="mt-0.5 text-[12.5px] text-inkdim">{row.reason}</div> : null}
          {row.hint !== undefined ? <div className="mt-0.5 text-[12.5px] text-inkdim">{row.hint}</div> : null}
        </div>
        {trailing?.(row)}
        <span className="flex w-[118px] flex-none">
          <StatusLamp tone={row.status.tone}>{row.status.text}</StatusLamp>
        </span>
        {onEdit !== undefined ? <EditButton locale={locale} onClick={() => onEdit(row)} /> : null}
        {selectable ? (
          <span
            aria-hidden="true"
            className={`grid h-5 w-5 flex-none place-items-center rounded-full border-[1.5px] ${row.selected === true ? 'border-signal bg-signal text-signal-ink' : 'border-bord text-transparent'}`}
          >
            <Check />
          </span>
        ) : null}
      </div>
      {below?.(row)}
    </li>
  );
}

export function AccountGroups<R extends AccountRowView>({ locale, groups, markFor, nameOf, onToggle, onEdit, trailing, below }: AccountGroupsProps<R>) {
  return (
    <div className="grid gap-2.5" data-account-groups="">
      {groups.map((group) => {
        const name = nameOf(group);
        return (
          <section key={group.providerId ?? 'unknown'} role="group" aria-label={name} className="overflow-hidden rounded-card border border-hairline bg-surface" data-account-group={group.providerId ?? ''}>
            <div className="flex items-center gap-2.5 border-b border-hairline bg-band px-3.5 py-2.5">
              <span className="grid h-[26px] w-[26px] flex-none place-items-center rounded-control border border-hairline bg-raised text-ink">
                <ProviderMark provider={group.providerId ?? ''} mark={group.providerId === null ? null : markFor(group.providerId)} size={15} />
              </span>
              <span className="font-bold text-ink">{name}</span>
              <span className="text-[12.5px] text-inkdim">{t(locale, 'accountGroups.count').replace('{n}', String(group.rows.length))}</span>
            </div>
            {group.rows.length > 0 ? (
              <ul className="m-0 list-none p-0">
                {group.rows.map((row) => (
                  <Row key={row.id} row={row} locale={locale} onToggle={onToggle} onEdit={onEdit} trailing={trailing} below={below} />
                ))}
              </ul>
            ) : null}
          </section>
        );
      })}
    </div>
  );
}
