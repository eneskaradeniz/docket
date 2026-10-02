// components/meter-bar.tsx — one meter as a bar (U-31): remaining fills from the left, a hatched
// zone with a 2px edge marks the share kept for the user, a footnote names it, and an amber tag
// says when the reserve is reached. The geometry comes from the store's `meterBar`; this file
// only paints it. Colors are theme tokens.
import type { SettingsMeterView } from '../../api/queries';
import { t, type Locale } from '../labels/t';
import { meterBar } from '../stores/account-editor';
import { formatMeterValue } from './meter-value';

export interface MeterBarProps {
  readonly meter: SettingsMeterView;
  /** The meter's own name (its pool's when it has none). */
  readonly name: string;
  readonly locale: Locale;
  /** The reset time already formatted in the active locale, or null. */
  readonly resetsAt: string | null;
}

const percent = (fraction: number): string => `${Math.round(fraction * 1000) / 10}%`;

export function MeterBar({ meter, name, locale, resetsAt }: MeterBarProps) {
  const bar = meterBar(meter);
  return (
    <li className="grid gap-1.5" data-meter-bar={meter.id}>
      <div className="flex flex-wrap items-baseline gap-2">
        <span className="text-[13px] text-ink">{name}</span>
        <span className="font-mono text-[11.5px] text-inkdim">
          {meter.remaining !== null ? `${t(locale, 'settings.meter.remaining')} ${formatMeterValue(locale, meter.unit, meter.remaining)}` : ''}
          {resetsAt !== null ? ` · ${t(locale, 'settings.meter.resetsAt')} ${resetsAt}` : ''}
        </span>
        {bar.reached ? (
          <span className="ml-auto rounded-full border border-signal/45 px-[7px] py-px font-mono text-[10.5px] text-signal">
            {t(locale, 'editor.meter.reached')}
          </span>
        ) : null}
      </div>
      <div className="relative h-2 overflow-hidden rounded-full bg-raised" role="presentation">
        {bar.fill !== null ? (
          <div className={`absolute inset-y-0 left-0 ${bar.reached ? 'bg-signal' : 'bg-proceed'}`} style={{ width: percent(bar.fill) }} />
        ) : null}
        {bar.zone !== null ? (
          <div
            data-reserve-zone=""
            className="absolute inset-y-0 left-0 border-r-2 border-signal"
            style={{
              width: percent(bar.zone),
              backgroundImage: 'repeating-linear-gradient(135deg, var(--signal) 0 1px, transparent 1px 4px)',
            }}
          />
        ) : null}
      </div>
      {bar.zone !== null ? (
        <p className="text-[11.5px] text-inkdim">{t(locale, 'editor.meter.reserveNote').replace('{share}', String(Math.round(bar.zone * 100)))}</p>
      ) : null}
    </li>
  );
}
