// screens/account-view.tsx — the account view (U-20's window): the back row, the account's name
// with its plan pill, one window block per window — the big labelled bar, the percent, the reset
// time — the active-work rows that navigate to their work orders, and the limit-behaviour band:
// read-only, its ⓘ explains, its "Ayarlar'da düzenle" carries the edit to the Settings window
// (K-5's rule: bilgi → ⓘ, düzenleme → Ayarlar penceresi). The screen renders the store's view and
// forwards clicks; time formatting is the only thing computed here, and every user-visible string
// arrives through a label key (U-1).
import { useEffect, useSyncExternalStore } from 'react';
import { t, type Locale } from '../labels/t';
import { ActionButton } from '../components/action-button';
import { StateBadge } from '../components/state-badge';
import { formatWorkOrderCode } from '../stores/work-order-code';
import type { AccountViewStore } from '../stores/account-view';
import { policyKey, windowBars } from '../stores/account-view';
import { failureKey } from '../stores/results';

export interface AccountViewScreenProps {
  readonly store: AccountViewStore;
  readonly accountId: string;
  readonly locale: Locale;
  readonly timeZone: string;
  readonly onOpenWorkOrder: (workOrderId: string) => void;
  readonly onOpenSettings: () => void;
  readonly onBack: () => void;
}

const LOCALE_TAG: Readonly<Record<Locale, string>> = { tr: 'tr-TR', en: 'en-US' };

/** A reset stamp as the machine's zone reads it; only the time — the windows reset within a day
 *  or at a week's turn, and the kalan line carries the rest. */
const formatReset = (locale: Locale, timeZone: string, at: number): string =>
  new Intl.DateTimeFormat(LOCALE_TAG[locale], { hour: '2-digit', minute: '2-digit', timeZone }).format(at);

/** A duration in the locale's compact wording: hours and minutes under a day, days beyond. */
const formatRemaining = (locale: Locale, ms: number): string => {
  const minutes = Math.floor(ms / 60_000);
  if (minutes < 60) return new Intl.NumberFormat(LOCALE_TAG[locale]).format(minutes);
  if (minutes < 60 * 24) {
    const hours = Math.floor(minutes / 60);
    return `${new Intl.NumberFormat(LOCALE_TAG[locale]).format(hours)}:${String(minutes % 60).padStart(2, '0')}`;
  }
  return new Intl.NumberFormat(LOCALE_TAG[locale]).format(Math.floor(minutes / (60 * 24)));
};

/** The band's info dot: the band speaks the account's standing, never a control (U-20). */
const InfoGlyph = ({ title, label }: { readonly title: string; readonly label: string }) => (
  <button
    type="button"
    title={title}
    aria-label={label}
    className="grid h-[18px] w-[18px] flex-none place-items-center rounded-full text-[10px] text-inkdim hover:text-ink"
  >
    ⓘ
  </button>
);

export function AccountViewScreen({
  store,
  accountId,
  locale,
  timeZone,
  onOpenWorkOrder,
  onOpenSettings,
  onBack,
}: AccountViewScreenProps) {
  const state = useSyncExternalStore(store.subscribe, store.state);
  useEffect(() => {
    void store.load(accountId);
  }, [store, accountId]);

  const view = state.view;
  const bars = view === null ? [] : windowBars(view);

  return (
    <div className="grid max-w-[960px] gap-5">
      <div className="-mb-2">
        <ActionButton variant="ghost" onClick={onBack}>
          {t(locale, 'account.back')}
        </ActionButton>
      </div>

      <header className="flex items-center gap-3">
        {view === null ? (
          state.loading ? (
            <p className="font-mono text-[11px] uppercase tracking-[0.04em] text-inkdim">{t(locale, 'account.loading')}</p>
          ) : null
        ) : (
          <>
            <h1 className="text-[20px] font-bold tracking-[-0.01em] text-ink">{view.account.label}</h1>
            {view.account.authMode === 'subscription' ? (
              <StateBadge tone="proceed">{t(locale, 'account.plan.subscription')}</StateBadge>
            ) : null}
            {view.account.plan !== undefined ? (
              <span className="font-mono text-[11px] text-inkdim">{view.account.plan}</span>
            ) : null}
          </>
        )}
      </header>

      {state.problem !== null ? (
        <div role="alert" className="rounded-md border border-error/40 bg-surface px-3 py-2 text-[13px] text-error">
          {t(locale, failureKey(state.problem))}
        </div>
      ) : null}

      {view !== null ? (
        <>
          <section className="grid gap-2.5">
            <h2 className="text-[12.5px] font-semibold text-inkdim">{t(locale, 'account.section.windows')}</h2>
            {bars.map((bar, index) => (
              <div key={index} className="max-w-[640px] rounded-lg border border-hairline bg-surface px-4 py-3.5">
                <div className="flex items-center text-[13px] font-semibold text-ink">
                  <span className="min-w-0 truncate" title={bar.label ?? undefined}>{bar.label ?? ''}</span>
                  <InfoGlyph title={t(locale, 'account.window.info')} label={t(locale, 'account.window.info')} />
                </div>
                <div className="mt-2 flex items-center gap-3">
                  <span className="h-2 flex-1 overflow-hidden rounded-full bg-raised">
                    <span className={`block h-full rounded-full ${bar.warn ? 'bg-signal' : 'bg-proceed'}`} style={{ width: `${bar.percent}%` }} />
                  </span>
                  <span className={`min-w-8 text-right font-mono text-[11px] ${bar.warn ? 'text-signal' : 'text-inkdim'}`}>%{bar.percent}</span>
                </div>
                <p className="mt-1.5 text-[11.5px] text-inkdim">
                  {bar.resetsAt === null
                    ? ''
                    : `${t(locale, 'account.window.resets')}: ${formatReset(locale, timeZone, bar.resetsAt)} · ${t(
                        locale,
                        'account.window.remaining',
                      )} ${formatRemaining(locale, store.remainingMs(bar.resetsAt))}`}
                </p>
              </div>
            ))}
          </section>

          <section className="grid gap-2.5">
            <h2 className="text-[12.5px] font-semibold text-inkdim">{t(locale, 'account.section.work')}</h2>
            {view.activeWork.length === 0 ? (
              <p className="text-[13px] text-inkdim">{t(locale, 'account.work.empty')}</p>
            ) : (
              <div className="grid max-w-[640px] gap-2">
                {view.activeWork.map((work) => (
                  <button
                    key={work.workOrderId}
                    type="button"
                    onClick={() => onOpenWorkOrder(work.workOrderId)}
                    className="flex min-h-11 items-center gap-3 rounded-lg border border-hairline bg-surface px-3 text-left transition-colors hover:border-bord"
                  >
                    <span className="flex-none font-mono text-[11px] text-inkdim">{formatWorkOrderCode(work.number, locale)}</span>
                    <span className="min-w-0 flex-1 overflow-hidden text-ellipsis whitespace-nowrap text-[13px] font-semibold text-ink" title={work.title}>
                      {work.title}
                    </span>
                    <span className="flex-none whitespace-nowrap text-[11.5px] text-inkdim">
                      {work.stage ?? work.status}
                    </span>
                  </button>
                ))}
              </div>
            )}
          </section>

          <div className="mt-1.5 flex max-w-[640px] items-center gap-3 rounded-lg border border-hairline bg-band px-3.5 py-3 text-[12.5px] text-inkdim">
            <span aria-hidden="true" className="h-2 w-2 flex-none rounded-full bg-info" />
            <span>{t(locale, 'account.policy.when')}</span>
            <b className="font-semibold text-ink">{t(locale, policyKey(view.account.limitPolicy))}</b>
            <InfoGlyph title={t(locale, 'account.policy.info')} label={t(locale, 'account.policy.info')} />
            <span className="flex-1" />
            <ActionButton variant="ghost" onClick={onOpenSettings}>
              {t(locale, 'account.edit')}
            </ActionButton>
          </div>
        </>
      ) : null}
    </div>
  );
}
