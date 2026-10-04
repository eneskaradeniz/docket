// components/meter-list.tsx — the MeterList (U-44): one row per meter — the provider's window name
// with a scope tag, the bar (remaining from the left, amber under 40 %, the U-31 reserve zone),
// "%r kalan", and when it resets — then one note when the account has a model-scoped pool. With no
// rows it shows the one line the store chose. The wizard's Bütçe step, the account editor's
// Kullanım tab and Settings all draw it; the rows are pure data from stores/meter-list.ts.
import type { ReactNode } from 'react';

import { t, type Locale } from '../labels/t';
import { meterResetText, type MeterListEmpty, type MeterListView, type MeterRow } from '../stores/meter-list';
import { formatMeterValue } from './meter-value';

export interface MeterListProps {
  readonly locale: Locale;
  readonly view: MeterListView;
  /** The line shown instead of rows; null while rows exist. */
  readonly empty: MeterListEmpty | null;
  /** The clock the reset spans are read against. */
  readonly now: number;
}

const InfoIcon = () => (
  <svg viewBox="0 0 16 16" aria-hidden="true" className="mt-0.5 h-3.5 w-3.5 flex-none" fill="none" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round">
    <circle cx="8" cy="8" r="5.5" />
    <path d="M8 7.2v3.2M8 5.2h.01" />
  </svg>
);

/** A quiet line with the info mark: no meter, or the model-scope note. */
export function MeterNote({ children }: { readonly children: ReactNode }) {
  return (
    <p className="flex items-start gap-1.5 text-[12px] text-inkdim" data-meter-note="">
      <InfoIcon />
      <span>{children}</span>
    </p>
  );
}

function Name({ row, locale }: { readonly row: MeterRow; readonly locale: Locale }) {
  const text = 'key' in row.name ? t(locale, row.name.key) : row.name.text;
  return (
    <span className="flex min-w-0 items-center gap-1.5 font-semibold text-ink">
      <span className="truncate">{text}</span>
      {row.scope === null ? null : row.scope.kind === 'all' ? (
        <span className="whitespace-nowrap rounded-control border border-hairline px-1.5 text-[11px] font-bold text-inkdim">{t(locale, 'meterList.scope.all')}</span>
      ) : (
        <span className="whitespace-nowrap rounded-control border border-hairline px-1.5 text-[11px] font-bold text-info">
          {t(locale, 'meterList.scope.model').replace('{model}', row.scope.model)}
        </span>
      )}
    </span>
  );
}

function Row({ row, locale, now }: { readonly row: MeterRow; readonly locale: Locale; readonly now: number }) {
  const left = row.remaining === null ? null : formatMeterValue(locale, 'fraction', row.remaining);
  const reset = meterResetText(locale, row.resetsAt, now);
  const width = row.remaining === null ? 0 : Math.round(row.remaining * 1000) / 10;
  return (
    <div
      data-meter-row={row.id}
      className="grid grid-cols-[minmax(150px,190px)_minmax(0,1fr)_74px_minmax(110px,150px)] items-center gap-3 text-[12.5px]"
    >
      <Name row={row} locale={locale} />
      <div
        role="img"
        aria-label={left === null ? t(locale, 'meterList.unread') : `${left} ${t(locale, 'meterList.left')}`}
        className="relative h-1.5 overflow-hidden rounded-full bg-hairline"
      >
        <div className={`absolute inset-y-0 left-0 rounded-full ${row.low ? 'bg-signal' : 'bg-proceed'}`} style={{ width: `${width}%` }} />
        {row.zone !== null ? (
          <div
            data-reserve-zone=""
            className="absolute inset-y-0 left-0 border-r-2 border-signal"
            style={{
              width: `${Math.round(row.zone * 1000) / 10}%`,
              backgroundImage: 'repeating-linear-gradient(135deg, var(--signal) 0 1px, transparent 1px 4px)',
            }}
          />
        ) : null}
      </div>
      <span className="text-right tabular-nums text-inkdim">
        {left === null ? null : (
          <>
            <b className="font-bold text-ink">{left}</b> {t(locale, 'meterList.left')}
          </>
        )}
      </span>
      <span className="whitespace-nowrap text-right text-inkdim">
        {row.fraction !== null ? `${row.fraction}${reset === null ? '' : ' · '}` : ''}
        {reset ?? ''}
      </span>
    </div>
  );
}

export function MeterList({ locale, view, empty, now }: MeterListProps) {
  if (view.rows.length === 0) {
    return empty === null ? null : <MeterNote>{t(locale, empty)}</MeterNote>;
  }
  return (
    <div className="grid gap-2.5" data-meter-list="">
      <div className="grid gap-2.5">
        {view.rows.map((row) => (
          <Row key={row.id} row={row} locale={locale} now={now} />
        ))}
      </div>
      {view.modelNote !== null ? <MeterNote>{t(locale, 'meterList.modelNote').split('{model}').join(view.modelNote)}</MeterNote> : null}
      {[...new Set(view.rows.flatMap((row) => (row.zone === null ? [] : [Math.round(row.zone * 100)])))].map((share) => (
        <p key={share} className="text-[12px] text-inkdim">
          {t(locale, 'editor.meter.reserveNote').replace('{share}', String(share))}
        </p>
      ))}
      {view.rows.some((row) => row.reached) ? <p className="text-[12px] text-signal-soft">{t(locale, 'editor.meter.reached')}</p> : null}
    </div>
  );
}
