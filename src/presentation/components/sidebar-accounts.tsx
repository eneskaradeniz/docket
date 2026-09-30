// components/sidebar-accounts.tsx — the sidebar's accounts frame (U-16): the one collapsible
// part of the sidebar, collapsed when the session starts, with the usage refresh beside its
// header. The header row is one fixed standing in both states — the same top offset and the same
// height — so expanding only adds the body below it and nothing above or around it moves; the
// row's own padding is the frame's whole vertical padding while collapsed, symmetric so the
// header sits in even breathing room. The header buttons carry a hairline border that raises on
// hover. A card carries the account label plus one mini bar per window — a short cadence label,
// the normalized percent, warn from the warn percent — and the spend line where the account
// carries money. A card opens the account view; the refresh intent re-polls usage through the
// store while the icon spins.
import { useEffect, useState, useSyncExternalStore } from 'react';

import { ACTIVE_CLASS } from './active-state';
import { t, type Locale } from '../labels/t';
import type { LabelKey } from '../labels/keys';
import type { AccountCard, AccountsFrameStore } from '../stores/accounts-frame';

const LOCALE_TAG: Readonly<Record<Locale, string>> = { tr: 'tr-TR', en: 'en-US' };

const percentLabel = (locale: Locale, percent: number): string =>
  new Intl.NumberFormat(LOCALE_TAG[locale], { style: 'percent', maximumFractionDigits: 0 }).format(
    percent / 100,
  );

const moneyLabel = (locale: Locale, value: number): string =>
  new Intl.NumberFormat(LOCALE_TAG[locale], { style: 'currency', currency: 'USD' }).format(value);

const WINDOW_LABEL: Readonly<
  Record<NonNullable<AccountCard['windows'][number]['kind']>, LabelKey>
> = {
  five_hour: 'account.window.five_hour',
  week: 'account.window.week',
  month: 'account.window.month',
};

const Chevron = ({ open }: { readonly open: boolean }) => (
  <svg
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    strokeWidth="2"
    strokeLinecap="round"
    strokeLinejoin="round"
    aria-hidden="true"
    className={`h-3 w-3 transition-transform duration-150 ${open ? '' : '-rotate-90'}`}
  >
    <path d="M6 9l6 6 6-6" />
  </svg>
);

const RefreshIcon = () => (
  <svg
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    strokeWidth="2"
    strokeLinecap="round"
    strokeLinejoin="round"
    aria-hidden="true"
    className="block h-3 w-3"
  >
    <path d="M3 12a9 9 0 0 1 9-9 9.75 9.75 0 0 1 6.74 2.74L21 8" />
    <path d="M21 3v5h-5" />
    <path d="M21 12a9 9 0 0 1-9 9 9.75 9.75 0 0 1-6.74-2.74L3 16" />
    <path d="M8 16H3v5" />
  </svg>
);

const AccountCardView = ({
  card,
  active,
  locale,
  onOpen,
}: {
  readonly card: AccountCard;
  readonly active: boolean;
  readonly locale: Locale;
  readonly onOpen: () => void;
}) => (
  <button
    type="button"
    onClick={onOpen}
    aria-current={active ? 'true' : undefined}
    className={`block w-full rounded-card border p-2 text-left ${
      active ? ACTIVE_CLASS : 'border-hairline bg-surface hover:border-bord'
    }`}
  >
    <span title={card.label} className="block truncate text-xs font-semibold leading-[17px]">
      {card.label}
    </span>
    <span className="mt-1.5 grid gap-[3px]">
      {card.windows.map((window, index) => (
        <span key={index} className="flex min-h-3 items-center gap-1.5">
          <span
            title={window.name ?? undefined}
            className="w-[38px] flex-none truncate font-mono text-[9.5px] leading-3 text-inkdim"
          >
            {window.kind !== null ? t(locale, WINDOW_LABEL[window.kind]) : window.name ?? ''}
          </span>
          <span aria-hidden="true" className="h-1 min-w-0 flex-1 overflow-hidden rounded-full bg-raised">
            <span
              className={`block h-full ${window.warn ? 'bg-signal' : 'bg-proceed'}`}
              style={{ width: `${window.percent}%` }}
            />
          </span>
          <span
            className={`min-w-[26px] flex-none text-right font-mono text-[9.5px] leading-3 ${
              window.warn ? 'text-signal' : 'text-inkdim'
            }`}
          >
            {percentLabel(locale, window.percent)}
          </span>
        </span>
      ))}
      {card.spend !== null ? (
        <span
          title={`${moneyLabel(locale, card.spend.used)} / ${moneyLabel(locale, card.spend.cap)}`}
          className="block truncate pl-[38px] font-mono text-[9.5px] leading-3 text-inkdim"
        >
          {moneyLabel(locale, card.spend.used)} / {moneyLabel(locale, card.spend.cap)}
        </span>
      ) : null}
    </span>
  </button>
);

export function SidebarAccounts({
  store,
  locale,
  activeAccountId,
  onOpenAccount,
}: {
  readonly store: AccountsFrameStore;
  readonly locale: Locale;
  readonly activeAccountId: string | null;
  readonly onOpenAccount: (id: string) => void;
}) {
  const state = useSyncExternalStore(store.subscribe, store.state);
  // The refresh icon spins for a fixed beat, like the prototype's — a fast reply would end the
  // spin before the eye catches it.
  const [spinning, setSpinning] = useState(false);
  useEffect(() => {
    if (!spinning) return;
    const timer = window.setTimeout(() => setSpinning(false), 820);
    return () => window.clearTimeout(timer);
  }, [spinning]);

  return (
    <div
      data-accounts-frame=""
      className={`mt-2.5 flex-none rounded-card border border-hairline bg-band px-1 ${state.open ? 'pb-2' : ''}`}
    >
      {/* The header row's classes never change with the state — its top offset and height are the
          same collapsed and expanded, so expanding only adds the body below. Collapsed, the row's
          own padding is the frame's whole vertical padding — 4px above and below, so the slim row
          holds no dead space and stays symmetric; expanded, the frame adds its bottom padding
          between the cards and the frame's edge. */}
      <div className="flex items-center gap-1 px-1 py-1">
        <button
          type="button"
          onClick={() => store.toggle()}
          aria-expanded={state.open}
          className="flex min-w-0 flex-1 items-center rounded-control bg-transparent py-0.5 text-left"
        >
          <span className="truncate font-mono text-[10.5px] font-medium text-inkdim">
            {t(locale, 'accounts.title')}
          </span>
        </button>
        <button
          type="button"
          onClick={() => {
            if (spinning) return;
            setSpinning(true);
            void store.refresh();
          }}
          aria-label={t(locale, 'accounts.refresh')}
          title={t(locale, 'accounts.refresh')}
          className={`grid h-[22px] w-[22px] flex-none place-items-center rounded-control border border-hairline text-inkdim hover:border-bord hover:text-ink ${
            spinning || state.refreshing ? 'animate-spin' : ''
          }`}
        >
          <RefreshIcon />
        </button>
        <button
          type="button"
          onClick={() => store.toggle()}
          aria-label={t(locale, 'accounts.toggle')}
          title={t(locale, 'accounts.toggle')}
          className="grid h-[22px] w-[22px] flex-none place-items-center rounded-control border border-hairline text-inkdim hover:border-bord hover:text-ink"
        >
          <Chevron open={state.open} />
        </button>
      </div>
      <div
        data-accounts-body=""
        className={`grid transition-all duration-200 ${state.open ? 'grid-rows-[1fr]' : 'grid-rows-[0fr]'}`}
      >
        <div className="min-h-0 overflow-hidden">
          <div className="max-h-[138px] overflow-y-auto pr-1">
            {state.cards === null ? null : state.cards.length === 0 ? (
              <p className="px-1 pb-1 text-xs text-inkdim">{t(locale, 'accounts.empty')}</p>
            ) : (
              state.cards.map((card) => (
                <AccountCardView
                  key={card.id}
                  card={card}
                  active={activeAccountId === card.id}
                  locale={locale}
                  onOpen={() => onOpenAccount(card.id)}
                />
              ))
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
