// screens/account-view.tsx — the account view (U-20's window): the back row, the account's name
// with its plan pill, one window block per window — the big labelled bar, the percent, the reset
// time — the active-work rows that navigate to their work orders, and the limit-behaviour band:
// read-only, its ⓘ explains, its "Ayarlar'da düzenle" carries the edit to the Settings window
// (K-5's rule: bilgi → ⓘ, düzenleme → Ayarlar penceresi). The screen renders the store's view and
// forwards clicks; the reset wording is the shared reset line, and every user-visible string
// arrives through a label key (U-1).
import { useEffect, useSyncExternalStore } from 'react';
import { t, type Locale } from '../labels/t';
import { ActionButton } from '../components/action-button';
import { InfoBubble } from '../components/info-bubble';
import { ProviderMark } from '../components/provider-mark';
import { StateBadge } from '../components/state-badge';
import { formatWorkOrderCode } from '../stores/work-order-code';
import type { AccountViewStore } from '../stores/account-view';
import { limitBand, windowBars } from '../stores/account-view';
import { failureKey } from '../stores/results';
import type { ProviderMarksStore } from '../stores/provider-marks';

export interface AccountViewScreenProps {
  readonly store: AccountViewStore;
  /** The provider marks the header's badge resolves from (loaded once, session-cached). */
  readonly marks: ProviderMarksStore;
  readonly accountId: string;
  readonly locale: Locale;
  readonly timeZone: string;
  readonly onOpenWorkOrder: (workOrderId: string) => void;
  /** The account's reserve shares for the limit band (U-37); null until the frame's query lands. */
  readonly reserve: { readonly short: number | null; readonly long: number | null } | null;
  /** "Ayarlar'da düzenle": Settings on this account's sub-page, Limitler tab. */
  readonly onOpenSettings: () => void;
  readonly onBack: () => void;
}

/** The window block's info dot (the limit band uses the shared info bubble, U-27). */
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
  marks,
  accountId,
  locale,
  timeZone,
  onOpenWorkOrder,
  reserve,
  onOpenSettings,
  onBack,
}: AccountViewScreenProps) {
  const state = useSyncExternalStore(store.subscribe, store.state);
  // The marks land once, after the first paint; the subscription turns them into a re-render.
  useSyncExternalStore(marks.subscribe, marks.state);
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
            <ProviderMark provider={view.account.provider} mark={marks.markFor(view.account.provider)} />
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
        <div role="alert" className="rounded-card border border-error/40 bg-surface px-3 py-2 text-[13px] text-error">
          {t(locale, failureKey(state.problem))}
        </div>
      ) : null}

      {view !== null ? (
        <>
          <section className="grid gap-2.5">
            <h2 className="text-[12.5px] font-semibold text-inkdim">{t(locale, 'account.section.windows')}</h2>
            {bars.map((bar, index) => (
              <div key={index} className="max-w-[640px] rounded-card border border-hairline bg-surface px-4 py-3.5">
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
                  {bar.resetsAt === null ? '' : store.resetLine(locale, timeZone, bar.resetsAt)}
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
                    className="flex min-h-11 items-center gap-3 rounded-card border border-hairline bg-surface px-3 text-left transition-colors hover:border-bord"
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

          <div className="mt-1.5 flex max-w-[640px] items-center gap-3 rounded-card border border-hairline bg-band px-3.5 py-3 text-[12.5px] text-inkdim">
            <span aria-hidden="true" className="h-2 w-2 flex-none rounded-full bg-info" />
            <span data-limit-band="" className="min-w-0 text-ink">{limitBand(locale, view.account.limitPolicy, reserve)}</span>
            <InfoBubble locale={locale} subject={t(locale, 'account.policy.subject')} body={t(locale, 'account.policy.info')} />
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
