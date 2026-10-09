// components/sidebar-accounts.tsx — the sidebar's Hesaplar section (U-16, cards per U-51, its
// visible count per U-51b): the one collapsible part of the sidebar, collapsed when the session
// starts, its header a chevron, the section name and the account count, with the usage refresh
// beside it. Open, one dim line says what the bars read, and every account is one equal 56 px
// card — mark, the account's name only, a status dot, then one bar for the tightest limit with
// its percent on the right (or the dim no-data line); the bar and the dot colour by what remains
// (U-51's thresholds). Click or Enter opens the limits popover; Esc or an outside click closes
// it and the focus never leaves the card. The body is one fixed height — two cards with the top
// of a third peeking beneath — and the rest scroll inside it, never the sidebar. The refresh
// intent re-polls usage through the store while the icon spins.
import { useEffect, useId, useRef, useState, useLayoutEffect, useSyncExternalStore, type CSSProperties, type ReactNode } from 'react';

import { ACTIVE_CLASS } from './active-state';
import { MARK_SIZE, ProviderMark } from './provider-mark';
import { ACCOUNTS_BODY_MAX_HEIGHT } from './sidebar-geometry';
import { SIDEBAR_HEADER_BUTTON } from './sidebar-header-button';
import { Skeleton, SkeletonReveal, SkeletonStyle, useSkeleton } from './skeleton';
import { t, type Locale } from '../labels/t';
import {
  remainingTone,
  type AccountCard,
  type AccountLimit,
  type AccountsFrameStore,
  unaddedRow,
} from '../stores/accounts-frame';
import { meterResetText } from '../stores/meter-list';
import type { ProviderMark as ProviderMarkValue, ProviderMarksStore } from '../stores/provider-marks';

const LOCALE_TAG: Readonly<Record<Locale, string>> = { tr: 'tr-TR', en: 'en-US' };

const percentLabel = (locale: Locale, share: number): string =>
  new Intl.NumberFormat(LOCALE_TAG[locale], { style: 'percent', maximumFractionDigits: 0 }).format(share);

/** The one colour word every remaining reading settles to (U-51): the bar's fill and the dot. */
const TONE_CLASS: Readonly<Record<'proceed' | 'warn' | 'error', string>> = {
  proceed: 'bg-proceed',
  warn: 'bg-signal',
  error: 'bg-error',
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
    className={`h-3.5 w-3.5 flex-none transition-transform duration-150 ${open ? '' : '-rotate-90'}`}
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

const InfoIcon = () => (
  <svg viewBox="0 0 16 16" aria-hidden="true" className="mt-0.5 h-3.5 w-3.5 flex-none" fill="none" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round">
    <circle cx="8" cy="8" r="5.5" />
    <path d="M8 7.2v3.2M8 5.2h.01" />
  </svg>
);

/** One account card's shape as a placeholder (U-26): the card's own fixed 56 px wrapper — a mark
 *  box, a name line, the tightest bar's row. */
const AccountCardSkeleton = () => (
  <div className="flex h-14 w-full gap-2 rounded-card border border-hairline p-2.5 px-3">
    <Skeleton radius="control" width="16px" height="16px" className="mt-0.5" />
    <span className="mt-0.5 grid min-w-0 flex-1 content-between gap-1">
      <span className="flex items-center gap-1.5">
        <Skeleton radius="control" width="46%" height="17px" />
        <Skeleton radius="full" width="7px" height="7px" className="ml-auto" />
      </span>
      <span className="flex items-center gap-2">
        <Skeleton radius="full" width="56%" height="5px" />
        <Skeleton radius="control" width="26px" height="14px" />
      </span>
    </span>
  </div>
);

/** The section body's loading composition (U-26), drawn inside the body's own fixed standing
 *  (U-51b): two whole cards with the list's own 0.5 rem gaps and the 1.25 rem peek of a third —
 *  2 × 3.5 rem + 2 × 0.5 rem + 1.25 rem = the 9.25 rem cap exactly, so the cards' arrival moves
 *  nothing and the peek is what says it scrolls, exactly as the ready body's does. */
export function AccountsSkeletonBody() {
  return (
    <div data-skeleton="" className="grid gap-2">
      <SkeletonStyle />
      {[0, 1].map((index) => (
        <AccountCardSkeleton key={index} />
      ))}
      {/* The peek: the third card's top edge — its border and padding, the mark's first pixels,
          and no bottom edge, the way a clipped card's top reads. */}
      <div className="flex h-5 rounded-card border border-b-0 border-hairline bg-surface px-3">
        <Skeleton radius="control" width="16px" height="7px" className="mt-3" />
      </div>
    </div>
  );
}

/** The limits popover (U-51, its way into the account per U-51a): every limit with its name and
 *  reset time, the tightest one marked, ending with the "Hesabı aç" button that opens the
 *  account view. Beyond that one control the focus stays on the card that opened it, and Esc or
 *  an outside click is what closes it (the parent's listeners). */
export function clampPopoverTop(top: number, height: number, viewportHeight: number, margin: number): number {
  return Math.max(margin, Math.min(top, viewportHeight - margin - height));
}

export function AccountLimitsPopover({
  card,
  provider,
  mark,
  locale,
  now,
  left,
  top,
  onOpen,
}: {
  readonly card: AccountCard;
  /** The provider's display name (A-67), when discovery reports one. */
  readonly provider: string | null;
  readonly mark: ProviderMarkValue | null;
  readonly locale: Locale;
  /** The clock the reset spans are read against. */
  readonly now: number;
  readonly left: number;
  readonly top: number;
  /** Opens this account's view (U-51a) — the page the card's own click used to open (U-16). */
  readonly onOpen: () => void;
}) {
  const full = provider === null ? card.label : `${provider} · ${card.label}`;
  const [adjustedTop, setAdjustedTop] = useState<number | null>(null);
  const ref = useRef<HTMLDivElement>(null);

  useLayoutEffect(() => {
    if (ref.current !== null) {
      const h = ref.current.getBoundingClientRect().height;
      setAdjustedTop(clampPopoverTop(top, h, window.innerHeight, 8));
    }
  }, [top, card.limits]);

  const style: CSSProperties = {
    left,
    top: adjustedTop ?? top,
    maxHeight: 'calc(100vh - 16px)',
    overflowY: 'auto',
    visibility: adjustedTop === null ? 'hidden' : 'visible',
  };
  return (
    <div
      ref={ref}
      data-account-popover=""
      role="dialog"
      aria-label={`${full} — ${t(locale, 'accounts.limits')}`}
      className="fixed z-50 w-[300px] max-w-[calc(100vw-24px)] rounded-card border border-bord bg-surface p-3 px-3.5 pb-3.5 shadow-2xl"
      style={style}
    >
      <div className="mb-2.5 flex items-center gap-2 text-[13px] font-bold text-ink">
        <ProviderMark provider={card.provider} mark={mark} size={MARK_SIZE.dense} />
        <span className="min-w-0 truncate">{full}</span>
      </div>
      {card.limits.length === 0 ? (
        <p className="flex items-start gap-1.5 text-[12px] text-inkdim">
          <InfoIcon />
          <span>{t(locale, 'meterList.noMeter')}</span>
        </p>
      ) : (
        card.limits.map((limit) => <LimitRow key={limit.id} limit={limit} tightest={card.tightest} locale={locale} now={now} />)
      )}
      <button
        type="button"
        data-open-account={card.id}
        onClick={onOpen}
        className="mt-3 flex w-full items-center justify-center gap-1.5 rounded-control border border-hairline px-2.5 py-1.5 text-[12.5px] font-semibold text-inkdim hover:bg-raised hover:text-ink focus-visible:bg-raised focus-visible:text-ink"
      >
        {t(locale, 'accounts.open')}
      </button>
    </div>
  );
}

const LimitRow = ({
  limit,
  tightest,
  locale,
  now,
}: {
  readonly limit: AccountLimit;
  readonly tightest: AccountLimit | null;
  readonly locale: Locale;
  readonly now: number;
}) => {
  const name: ReactNode = 'key' in limit.name ? t(locale, limit.name.key) : limit.name.text;
  const remaining = limit.remaining;
  const share = remaining === null ? null : Math.round(remaining * 100) / 100;
  const tone = remaining === null ? null : remainingTone(remaining);
  const reset = meterResetText(locale, limit.resetsAt, now);
  return (
    <div data-limit-row={limit.id} className="mb-2.5 last:mb-0">
      <div className="flex items-center justify-between gap-2.5 text-[12.5px] text-inkdim">
        <span className="flex min-w-0 items-center gap-1.5">
          <span className="truncate">
            {name}
            {limit.fraction !== null ? ` · ${limit.fraction}` : ''}
          </span>
          {tightest?.id === limit.id ? (
            <span
              data-tightest-tag=""
              className="flex-none whitespace-nowrap rounded-control bg-signal-soft px-1.5 py-px text-[11px] font-bold text-signal-ink"
            >
              {t(locale, 'accounts.tightest')}
            </span>
          ) : null}
        </span>
        {share === null ? null : <b className="flex-none tabular-nums text-ink">{percentLabel(locale, share)}</b>}
      </div>
      <div
        aria-hidden="true"
        className="mt-1 h-1.5 overflow-hidden rounded-full bg-hairline"
      >
        <div
          className={`h-full rounded-full ${tone === null ? '' : TONE_CLASS[tone]}`}
          style={{ width: `${share === null ? 0 : Math.round(share * 1000) / 10}%` }}
        />
      </div>
      {reset === null ? null : <p className="mt-1 text-[12px] text-inkdim">{reset}</p>}
    </div>
  );
};

/** One equal card (U-51): the mark, the account's name only — the full "Asistan · ad" rides the
 *  title and the popover — the status dot, then the tightest limit's bar with its percent. */
const AccountCardView = ({
  card,
  provider,
  mark,
  active,
  locale,
  popoverOpen,
  onTogglePopover,
}: {
  readonly card: AccountCard;
  readonly provider: string | null;
  readonly mark: ProviderMarkValue | null;
  readonly active: boolean;
  readonly locale: Locale;
  readonly popoverOpen: boolean;
  readonly onTogglePopover: (card: AccountCard, element: HTMLButtonElement) => void;
}) => {
  const full = provider === null ? card.label : `${provider} · ${card.label}`;
  const tightest = card.tightest;
  const tone = tightest?.remaining === null || tightest === null ? null : remainingTone(tightest.remaining);
  return (
    <button
      type="button"
      data-account-card={card.id}
      aria-current={active ? 'true' : undefined}
      aria-haspopup="dialog"
      aria-expanded={popoverOpen}
      onClick={(event) => onTogglePopover(card, event.currentTarget)}
      className={`flex h-14 w-full gap-2 rounded-card border p-2.5 px-3 text-left ${
        active || popoverOpen ? `${ACTIVE_CLASS} border-bord bg-raised` : 'border-hairline bg-surface hover:bg-raised'
      }`}
    >
      <ProviderMark provider={card.provider} mark={mark} size={MARK_SIZE.default} className="mt-0.5" />
      <span className="grid min-w-0 flex-1 content-between">
        <span className="flex min-w-0 items-center gap-1.5 text-[14px] font-semibold leading-tight text-ink">
          <span title={full} className="min-w-0 flex-1 truncate">
            {card.label}
          </span>
          {card.reserved ? (
            <span
              data-reserved=""
              className="flex-none rounded-full border border-signal/40 px-1.5 py-px text-[11px] leading-none text-signal"
            >
              {t(locale, 'accounts.reserved')}
            </span>
          ) : null}
          <span
            data-account-dot={tone === null ? 'none' : tone}
            aria-hidden="true"
            className={`h-[7px] w-[7px] flex-none rounded-full ${tone === null ? 'bg-inkdim' : TONE_CLASS[tone]}`}
          />
        </span>
        {tightest === null ? (
          <span className="block truncate text-[12px] text-inkdim">{t(locale, 'accounts.noLimit')}</span>
        ) : (
          <span className="flex items-center gap-2">
            <span aria-hidden="true" className="h-[5px] min-w-6 flex-1 overflow-hidden rounded-full bg-hairline">
              <span
                data-account-bar={tone === null ? 'none' : tone}
                className={`block h-full rounded-full ${tone === null ? '' : TONE_CLASS[tone]}`}
                style={{ width: `${Math.round((tightest.remaining ?? 0) * 1000) / 10}%` }}
              />
            </span>
            <span className="flex-none font-mono text-[12px] tabular-nums text-ink">
              {percentLabel(locale, tightest.remaining ?? 0)}
            </span>
          </span>
        )}
      </span>
    </button>
  );
};

export function SidebarAccounts({
  store,
  marks,
  locale,
  activeAccountId,
  providerName,
  now,
  unaddedCount,
  onOpenUnadded,
  onOpenAccount,
}: {
  readonly store: AccountsFrameStore;
  readonly marks: ProviderMarksStore;
  readonly locale: Locale;
  readonly activeAccountId: string | null;
  /** The provider display name (A-67) a provider id goes by, or null when unknown. */
  readonly providerName: (id: string) => string | null;
  /** The clock the popover's reset spans read against. */
  readonly now: number;
  /** The candidates store's count of accounts discovery holds that are not yet added (U-37). */
  readonly unaddedCount: number;
  /** The trailing row: Settings → Hesaplar. */
  readonly onOpenUnadded: () => void;
  /** Opens an account's view — the popover's "Hesabı aç" button (U-51a). */
  readonly onOpenAccount: (id: string) => void;
}) {
  const state = useSyncExternalStore(store.subscribe, store.state, store.state);
  // The marks land once, after the first paint; the subscription turns them into a re-render.
  useSyncExternalStore(marks.subscribe, marks.state, marks.state);
  // The refresh icon spins for a fixed beat, like the prototype's — a fast reply would end the
  // spin before the eye catches it.
  const [spinning, setSpinning] = useState(false);
  useEffect(() => {
    if (!spinning) return;
    const timer = window.setTimeout(() => setSpinning(false), 820);
    return () => window.clearTimeout(timer);
  }, [spinning]);
  // Only a section with no cards yet can carry a skeleton (U-26); a refresh keeps the cards up.
  const { skeleton, reveal } = useSkeleton(state.loading && state.cards === null, () => Date.now());
  const unadded = unaddedRow(locale, unaddedCount);
  const cards = state.cards ?? [];
  const listId = useId();

  // The limits popover (U-51): one at a time, placed beside its card. The card keeps the focus —
  // the popover holds no control — so Esc and an outside click are the closers, and the popover
  // follows its card on scroll instead of being eaten by it.
  const [popover, setPopover] = useState<{ readonly card: AccountCard; readonly left: number; readonly top: number } | null>(null);
  const popoverCardRef = useRef<HTMLButtonElement | null>(null);
  const place = (element: HTMLButtonElement): { left: number; top: number } => {
    const rect = element.getBoundingClientRect();
    const width = 300;
    const left = rect.right + 10 + width < window.innerWidth - 8 ? rect.right + 10 : Math.max(8, rect.left - 10 - width);
    return { left, top: rect.top - 4 };
  };
  const togglePopover = (card: AccountCard, element: HTMLButtonElement): void => {
    popoverCardRef.current = element;
    setPopover((standing) => (standing?.card.id === card.id ? null : { card, ...place(element) }));
  };
  useEffect(() => {
    if (popover === null) return;
    const onKey = (event: KeyboardEvent): void => {
      if (event.key !== 'Escape') return;
      event.preventDefault();
      setPopover(null);
    };
    const onClick = (event: MouseEvent): void => {
      const target = event.target as Node | null;
      if (target !== null && popoverCardRef.current?.contains(target)) return;
      setPopover(null);
    };
    const onScroll = (): void => {
      const element = popoverCardRef.current;
      if (element === null) return;
      setPopover((standing) => (standing === null ? standing : { ...standing, ...place(element) }));
    };
    document.addEventListener('keydown', onKey);
    document.addEventListener('click', onClick);
    window.addEventListener('scroll', onScroll, true);
    return () => {
      document.removeEventListener('keydown', onKey);
      document.removeEventListener('click', onClick);
      window.removeEventListener('scroll', onScroll, true);
    };
  }, [popover]);
  // A card that leaves the list (a refresh, a fold) cannot keep its popover open.
  useEffect(() => {
    if (popover !== null && !cards.some((card) => card.id === popover.card.id)) setPopover(null);
  }, [cards, popover]);

  return (
    <section
      data-accounts-frame=""
      aria-label={t(locale, 'accounts.title')}
      className="mt-2.5 flex flex-none flex-col"
    >
      {/* The header row's classes never change with the state — its top offset and height are the
          same collapsed and expanded, so expanding only adds the body below. The chevron, the
          section name and the account count are one toggle; the refresh rides at the right. */}
      <div className="flex flex-none items-center gap-1 py-1 pl-1.5 pr-1">
        <button
          type="button"
          onClick={() => store.toggle()}
          aria-expanded={state.open}
          aria-controls={listId}
          aria-label={t(locale, 'accounts.toggle')}
          className="flex min-w-0 flex-1 items-center gap-1.5 rounded-control py-0.5 text-left text-inkdim hover:text-ink"
        >
          <Chevron open={state.open} />
          <span className="truncate text-[14px] font-bold">{t(locale, 'accounts.title')}</span>
          <span className="flex-none text-[12px] font-medium">{cards.length}</span>
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
          className={`${SIDEBAR_HEADER_BUTTON} ${spinning || state.refreshing ? 'animate-spin' : ''}`}
        >
          <RefreshIcon />
        </button>
      </div>
      <div
        data-accounts-body=""
        // The closed row hides the body from the eye only; inert is what also drops its cards
        // from the tab order and the accessibility tree while they sit in the DOM for the
        // reopening — a collapsed section can hold neither focus nor a click.
        inert={!state.open}
        className={`grid transition-all duration-200 ${state.open ? 'grid-rows-[1fr]' : 'grid-rows-[0fr]'}`}
      >
        <div className="flex min-h-0 flex-col overflow-hidden">
          <p className="flex-none px-3 pb-1 text-[12px] text-inkdim">{t(locale, 'accounts.barHint')}</p>
          {/* The body's one fixed height (U-51b): two cards with the top of a third peeking
              beneath them, whatever the window's height — the peek is what says it scrolls. */}
          <div
            id={listId}
            data-accounts-list=""
            className={`grid content-start gap-2 overflow-y-auto px-2 pb-1 [scrollbar-width:thin] ${ACCOUNTS_BODY_MAX_HEIGHT}`}
            aria-busy={skeleton ? 'true' : undefined}
          >
            {skeleton ? (
              <AccountsSkeletonBody />
            ) : cards.length === 0 ? (
              <p className="px-1 pb-1 text-xs text-inkdim">{t(locale, 'accounts.empty')}</p>
            ) : (
              <SkeletonReveal active={reveal}>
                {cards.map((card) => (
                  <AccountCardView
                    key={card.id}
                    card={card}
                    provider={providerName(card.provider)}
                    mark={marks.markFor(card.provider)}
                    active={activeAccountId === card.id}
                    locale={locale}
                    popoverOpen={popover?.card.id === card.id}
                    onTogglePopover={togglePopover}
                  />
                ))}
              </SkeletonReveal>
            )}
          </div>
          {unadded === null ? null : (
            <button
              type="button"
              data-unadded-row=""
              onClick={onOpenUnadded}
              className="mt-1 flex w-full flex-none items-center gap-1.5 rounded-control px-2 py-1 text-left text-[12px] text-inkdim hover:bg-raised hover:text-ink focus-visible:bg-raised focus-visible:text-ink"
            >
              <span className="min-w-0 flex-1 truncate">{unadded.text}</span>
              <span className="flex-none text-signal">· {unadded.action}</span>
            </button>
          )}
        </div>
      </div>
      {/* The popover rides at the page level so the section's own scroll never clips it. */}
      {popover === null ? null : (
        <AccountLimitsPopover
          card={popover.card}
          provider={providerName(popover.card.provider)}
          mark={marks.markFor(popover.card.provider)}
          locale={locale}
          now={now}
          left={popover.left}
          top={popover.top}
          onOpen={() => {
            onOpenAccount(popover.card.id);
            setPopover(null);
          }}
        />
      )}
    </section>
  );
}
