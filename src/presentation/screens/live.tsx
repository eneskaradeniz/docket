// screens/live.tsx — the live pane (U-5's window): the folded event items in arrival order, the
// earliest still-open permission ask with its answer actions, and the ended state. The screen
// renders the store's fold and forwards clicks; number formatting is the only thing computed
// here, and every user-visible string arrives through a label key (U-1).
import { useSyncExternalStore } from 'react';
import type { LabelKey } from '../labels/keys';
import { t, type Locale } from '../labels/t';
import { formatMeterValue, meterUnitLabel } from '../components/meter-value';
import { ActionButton } from '../components/action-button';
import { StateBadge, type BadgeTone } from '../components/state-badge';
import type { LivePaneItem, LivePaneStore, LivePaneState, QuotaSignalMeter, ToolCallStatus } from '../stores/live-pane';
import { commandResultKey } from '../stores/results';
import { toastOutcome } from '../stores/toasts';

export interface LivePaneScreenProps {
  readonly store: LivePaneStore;
  readonly locale: Locale;
}

const LOCALE_TAG: Readonly<Record<Locale, string>> = { tr: 'tr-TR', en: 'en-US' };

const TOOL_STATUS_TONE: Readonly<Record<ToolCallStatus, BadgeTone>> = {
  running: 'info',
  ok: 'proceed',
  failed: 'error',
};

const TOOL_STATUS_KEY: Readonly<Record<ToolCallStatus, LabelKey>> = {
  running: 'live.tool.running',
  ok: 'live.tool.ok',
  failed: 'live.tool.failed',
};

const formatTokens = (locale: Locale, value: number): string => new Intl.NumberFormat(LOCALE_TAG[locale]).format(value);

const formatCost = (locale: Locale, value: number): string =>
  new Intl.NumberFormat(LOCALE_TAG[locale], { style: 'currency', currency: 'USD' }).format(value);

/** The meter's own name when the provider gave one; the unit stands in — meters without any name
 *  still read as an instrument line, never as a blank. */
const meterName = (locale: Locale, meter: QuotaSignalMeter): string =>
  meter.label ?? meter.poolLabel ?? meterUnitLabel(locale, meter.unit) ?? '';

function UsageLine({ item, locale }: { readonly item: Extract<LivePaneItem, { readonly kind: 'usage' }>; readonly locale: Locale }) {
  return (
    <span>
      {t(locale, 'live.usage.input')} {formatTokens(locale, item.inputTokens)} · {t(locale, 'live.usage.output')}{' '}
      {formatTokens(locale, item.outputTokens)} · {t(locale, 'live.usage.cached')} {formatTokens(locale, item.cachedInputTokens)}
      {item.costUsd !== null ? ` · ${t(locale, 'live.usage.cost')} ${formatCost(locale, item.costUsd)}` : ''}
    </span>
  );
}

function MeterLine({ item, locale }: { readonly item: Extract<LivePaneItem, { readonly kind: 'quotaSignal' }>; readonly locale: Locale }) {
  const meter = item.meter;
  const usage =
    meter.used !== undefined
      ? ` · ${t(locale, 'live.meter.used')} ${formatMeterValue(locale, meter.unit, meter.used)}` +
        (meter.limit !== undefined ? ` / ${t(locale, 'live.meter.limit')} ${formatMeterValue(locale, meter.unit, meter.limit)}` : '')
      : '';
  return (
    <span>
      {meterName(locale, meter)}
      {usage}
    </span>
  );
}

function LiveItemRow({ item, locale }: { readonly item: LivePaneItem; readonly locale: Locale }) {
  switch (item.kind) {
    case 'thought':
      return (
        <div className="grid gap-0.5">
          <span className="font-mono text-[10.5px] uppercase tracking-[0.06em] text-inkdim">{t(locale, 'live.kind.thought')}</span>
          <p className="whitespace-pre-wrap text-[13px] text-inkdim">{item.text}</p>
        </div>
      );
    case 'message':
      return (
        <div className="grid gap-0.5">
          <span className="font-mono text-[10.5px] uppercase tracking-[0.06em] text-inkdim">{t(locale, 'live.kind.message')}</span>
          <p className="whitespace-pre-wrap text-[13.5px] text-ink">{item.text}</p>
        </div>
      );
    case 'toolCall':
      return (
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div className="flex min-w-0 items-baseline gap-2">
            <span className="font-mono text-[12.5px] text-ink">{item.name}</span>
            {item.target !== null ? <code className="truncate font-mono text-[11px] text-inkdim">{item.target}</code> : null}
          </div>
          <StateBadge tone={TOOL_STATUS_TONE[item.status]}>{t(locale, TOOL_STATUS_KEY[item.status])}</StateBadge>
        </div>
      );
    case 'usage':
    case 'quotaSignal':
      return (
        <div className="grid gap-0.5">
          <span className="font-mono text-[10.5px] uppercase tracking-[0.06em] text-inkdim">
            {t(locale, item.kind === 'usage' ? 'live.kind.usage' : 'live.kind.quotaSignal')}
          </span>
          {item.kind === 'usage' ? <UsageLine item={item} locale={locale} /> : <MeterLine item={item} locale={locale} />}
        </div>
      );
  }
}

export function LivePaneScreen({ store, locale }: LivePaneScreenProps) {
  const state: LivePaneState = useSyncExternalStore(store.subscribe, store.state);
  // The pane store keeps no outcome state (U-5's fold is display items only), so the screen
  // toasts the latest answer itself through the same U-8 mapping every intent uses (U-50); a
  // refusal carries its code behind the copy button (U-50a).
  const answer = (decision: 'allow' | 'deny'): void => {
    void store.answer(decision).then((result) => {
      toastOutcome(locale, { result, labelKey: commandResultKey('permission.answer', result) });
    });
  };

  return (
    <aside className="grid content-start gap-3">
      <header className="flex items-center gap-2.5">
        <span aria-hidden="true" className={`h-2 w-2 flex-none rounded-full ${state.ended ? 'bg-hairline' : 'bg-proceed motion-safe:animate-pulse'}`} />
        <h2 className="text-[15px] font-semibold tracking-tight text-ink">{t(locale, 'live.title')}</h2>
      </header>

      {state.ask !== null ? (
        <div className="grid gap-2 rounded-card border border-signal/45 bg-surface p-3">
          <span className="font-mono text-[10.5px] uppercase tracking-[0.06em] text-signal">{t(locale, 'live.ask.title')}</span>
          <div>
            <span className="font-mono text-[13px] text-ink">{state.ask.tool}</span>
            {state.ask.target !== null ? <code className="block truncate font-mono text-[11px] text-inkdim">{state.ask.target}</code> : null}
          </div>
          <div className="flex items-center gap-2">
            <ActionButton variant="neutral" onClick={() => answer('deny')}>
              {t(locale, 'action.deny')}
            </ActionButton>
            <ActionButton variant="primary" onClick={() => answer('allow')}>
              {t(locale, 'action.allow')}
            </ActionButton>
          </div>
        </div>
      ) : null}

      {state.items.length === 0 ? (
        <p className="flex items-center gap-2.5 font-mono text-[11px] text-inkdim">
          <span aria-hidden="true" className="h-2 w-2 flex-none rounded-full bg-info motion-safe:animate-pulse" />
          {t(locale, 'live.empty')}
        </p>
      ) : (
        <ol className="grid gap-1.5">
          {state.items.map((item, index) => (
            <li key={index} className="rounded-card border border-hairline bg-surface px-3 py-2">
              <LiveItemRow item={item} locale={locale} />
            </li>
          ))}
        </ol>
      )}

      {state.ended ? (
        <p className="rounded-card border border-hairline bg-surface px-3 py-2 text-[13px] text-inkdim">{t(locale, 'live.ended')}</p>
      ) : null}
    </aside>
  );
}
