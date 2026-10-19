// screens/live.tsx — the live pane (U-5's window, Phase A #972): the folded event items in
// arrival order inside a fixed 320 px, line-snapped stream that is a labelled log and NEVER a
// live region (A5 — a stream would flood the announcement), the “En alta in” control instead of
// auto-scroll, the earliest still-open permission ask with its answer actions, and the ended
// state. Tool kinds are neutral shapes (a glyph per kind, no colour of their own); the outcome
// words keep their tones. The screen renders the store's fold and forwards clicks; number
// formatting is the only thing computed here, and every user-visible string arrives through a
// label key (U-1).
// A run's text has no break opportunities to rely on (absolute paths, whole commands), so every
// box between such text and the pane must be allowed to shrink below its content (`min-w-0`) —
// the layout audit's L-14 measures the result on the real screen.
import { useEffect, useRef, useSyncExternalStore } from 'react';
import type { LabelKey } from '../labels/keys';
import { t, type Locale } from '../labels/t';
import { formatMeterValue, meterUnitLabel } from '../components/meter-value';
import { ActionButton } from '../components/action-button';
import type { LivePaneItem, LivePaneStore, LivePaneState, QuotaSignalMeter, ToolCallStatus } from '../stores/live-pane';
import { commandResultKey } from '../stores/results';
import { toastOutcome } from '../stores/toasts';
import { formatTokensCompact } from '../components/detail-format';

export interface LivePaneScreenProps {
  readonly store: LivePaneStore;
  readonly locale: Locale;
}

const TOOL_STATUS_KEY: Readonly<Record<ToolCallStatus, LabelKey>> = {
  running: 'live.tool.running',
  ok: 'live.tool.ok',
  failed: 'live.tool.failed',
};

const TOOL_STATUS_CLASS: Readonly<Record<ToolCallStatus, string>> = {
  running: 'text-inkdim',
  ok: 'text-proceed',
  failed: 'text-error',
};

/** The neutral kind glyph a tool wears (A5's “tool kinds neutral — shape, no colour”): a shape
 *  per verb, the colour of the page, never a hue of its own. */
const TOOL_KIND_GLYPH: Readonly<Record<string, string>> = {
  read: '▤',
  edit: '✎',
  bash: '❯',
  grep: '⌕',
};

const toolGlyph = (name: string): string => TOOL_KIND_GLYPH[name.toLowerCase()] ?? '◆';

const formatAskTool = (locale: Locale, tool: string): string =>
  tool === 'submit_verdict' || tool === 'mcp__docket-pages__submit_verdict'
    ? t(locale, 'detail.zone.tool.submitVerdict')
    : tool;

/** The meter's own name when the provider gave one; the unit stands in — meters without any name
 *  still read as an instrument line, never as a blank. */
const meterName = (locale: Locale, meter: QuotaSignalMeter): string =>
  meter.label ?? meter.poolLabel ?? meterUnitLabel(locale, meter.unit) ?? '';

function UsageLine({ item, locale }: { readonly item: Extract<LivePaneItem, { readonly kind: 'usage' }>; readonly locale: Locale }) {
  return (
    <span>
      {t(locale, 'live.usage.input')} {formatTokensCompact(locale, item.inputTokens)} · {t(locale, 'live.usage.output')}{' '}
      {formatTokensCompact(locale, item.outputTokens)} · {t(locale, 'live.usage.cached')} {formatTokensCompact(locale, item.cachedInputTokens)}
      {item.costUsd !== null ? ` · ${t(locale, 'live.usage.cost')} ${new Intl.NumberFormat(locale === 'tr' ? 'tr-TR' : 'en-US', { style: 'currency', currency: 'USD' }).format(item.costUsd)}` : ''}
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
          <span className="font-mono text-[0.65625rem] uppercase tracking-[0.06em] text-inkdim">{t(locale, 'live.kind.thought')}</span>
          <p className="whitespace-pre-wrap [overflow-wrap:anywhere] text-[0.8125rem] text-inkdim">{item.text}</p>
        </div>
      );
    case 'message':
      return (
        <div className="grid gap-0.5">
          <span className="font-mono text-[0.65625rem] uppercase tracking-[0.06em] text-inkdim">{t(locale, 'live.kind.message')}</span>
          <p className="whitespace-pre-wrap [overflow-wrap:anywhere] text-[0.84375rem] text-ink">{item.text}</p>
        </div>
      );
    case 'toolCall':
      return (
        <div className="flex min-w-0 flex-wrap items-baseline justify-between gap-2">
          <div className="flex min-w-0 items-baseline gap-2">
            <span aria-hidden="true" className="flex-none font-mono text-[0.78125rem] text-inkdim">{toolGlyph(item.name)}</span>
            <span className="font-mono text-[0.78125rem] text-ink">{item.name}</span>
            {item.target !== null ? (
              <code className="min-w-0 truncate font-mono text-[0.6875rem] text-inkdim" title={item.target}>
                {item.target}
              </code>
            ) : null}
          </div>
          <span className={`font-mono text-[0.6875rem] ${TOOL_STATUS_CLASS[item.status]}`}>{t(locale, TOOL_STATUS_KEY[item.status])}</span>
        </div>
      );
    case 'usage':
    case 'quotaSignal':
      return (
        <div className="grid gap-0.5">
          <span className="font-mono text-[0.65625rem] uppercase tracking-[0.06em] text-inkdim">
            {t(locale, item.kind === 'usage' ? 'live.kind.usage' : 'live.kind.quotaSignal')}
          </span>
          {item.kind === 'usage' ? <UsageLine item={item} locale={locale} /> : <MeterLine item={item} locale={locale} />}
        </div>
      );
  }
}

export function LivePaneScreen({ store, locale }: LivePaneScreenProps) {
  const state: LivePaneState = useSyncExternalStore(store.subscribe, store.state, store.state);
  // The pane store keeps no outcome state (U-5's fold is display items only), so the screen
  // toasts the latest answer itself through the same U-8 mapping every intent uses (U-50); a
  // refusal carries its code behind the copy button (U-50a).
  const answer = (decision: 'allow' | 'deny'): void => {
    void store.answer(decision).then((result) => {
      toastOutcome(locale, { result, labelKey: commandResultKey('permission.answer', result) });
    });
  };

  // Line-snapped scrolling (decision 7): the stream sits on row boundaries and follows the end
  // only while the reader is already there — never a forced chase (A9: no auto-scroll animation
  // under reduced motion; the jump is instant). “En alta in” is the reader's own door back.
  const stream = useRef<HTMLDivElement | null>(null);
  const itemCount = state.items.length;
  useEffect(() => {
    const element = stream.current;
    if (element === null || state.ended) return;
    if (element.scrollHeight - element.scrollTop - element.clientHeight < 24) element.scrollTop = element.scrollHeight;
  }, [itemCount, state.ended]);

  return (
    <aside className="grid content-start gap-3" data-live-pane>
      <header className="flex items-center gap-2.5">
        <span
          aria-hidden="true"
          className={`h-2 w-2 flex-none rounded-full ${state.ended ? 'bg-hairline' : 'bg-proceed motion-safe:animate-pulse'}`}
        />
        <h2 className="text-[0.9375rem] font-semibold tracking-tight text-ink">{t(locale, 'live.title')}</h2>
      </header>

      {state.ask !== null ? (
        <div className="grid min-w-0 gap-2 rounded-card border border-signal/45 bg-surface p-3">
          <span className="font-mono text-[0.65625rem] uppercase tracking-[0.06em] text-signal">{t(locale, 'live.ask.title')}</span>
          <div className="min-w-0">
            <span className="font-mono text-[0.8125rem] text-ink">{formatAskTool(locale, state.ask.tool)}</span>
            {state.ask.target !== null ? (
              <code className="block truncate font-mono text-[0.6875rem] text-inkdim" title={state.ask.target}>
                {state.ask.target}
              </code>
            ) : null}
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

      <div
        ref={stream}
        role="log"
        aria-live="off"
        aria-label={t(locale, 'live.streamLabel')}
        data-live-stream
        className="grid h-80 min-w-0 auto-rows-min content-start gap-1.5 overflow-y-auto rounded-panel border border-hairline bg-band p-2 [scroll-snap-type:y_proximity] motion-reduce:[scroll-snap-type:none]"
      >
        {state.items.length === 0 ? (
          <p className="col-span-full flex items-center gap-2.5 px-2 font-mono text-[0.6875rem] text-inkdim">
            <span aria-hidden="true" className="h-2 w-2 flex-none rounded-full bg-info motion-safe:animate-pulse" />
            {t(locale, 'live.empty')}
          </p>
        ) : (
          state.items.map((item, index) => (
            <div key={index} className="grid min-w-0 gap-0.5 rounded-card border border-hairline bg-surface px-3 py-2 [scroll-snap-align:start]">
              <LiveItemRow item={item} locale={locale} />
            </div>
          ))
        )}
      </div>

      {state.ended ? (
        <p className="m-0 text-[0.8125rem] text-inkdim">{t(locale, 'live.ended')}</p>
      ) : (
        <ActionButton
          variant="neutral"
          onClick={() => {
            const element = stream.current;
            if (element !== null) element.scrollTop = element.scrollHeight;
          }}
        >
          {t(locale, 'live.bottom')}
        </ActionButton>
      )}
    </aside>
  );
}
