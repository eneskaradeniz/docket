// components/cockpit-closed.tsx — Son kapananlar (U-21): the latest closes in one bordered list,
// dividers between rows; code, title, where it lived, how it ended and how long ago it closed.
// The whole heading is the disclosure: a chevron, the title and a count; while folded, the
// newest close rides the heading's right edge so the section never reads as empty.
import { useState } from 'react';
import type { CockpitView } from '../../api/queries';
import { t, type Locale } from '../labels/t';
import { formatWorkOrderCode } from '../stores/work-order-code';
import { formatAge } from './cockpit-format';
import { MOTION } from './motion';

export interface CockpitClosedListProps {
  readonly entries: CockpitView['recentlyClosed'];
  readonly locale: Locale;
  readonly sinceMs: (at: number) => number;
}

export function CockpitClosedList({ entries, locale, sinceMs }: CockpitClosedListProps) {
  return (
    <ul className="grid divide-y divide-hairline rounded-card border border-hairline bg-surface">
      {entries.map((entry) => (
        <li key={entry.workOrderId} className="grid min-h-9 grid-cols-[auto_minmax(0,1fr)_auto_auto_auto] items-center gap-3 px-3.5 text-[13px]">
          <span aria-hidden="true" className="text-[12px] text-proceed">✓</span>
          <span className="flex min-w-0 items-center gap-2.5">
            <span className="flex-none font-mono text-[11.5px] text-inkdim">{formatWorkOrderCode(entry.number, locale)}</span>
            <span className="min-w-0 overflow-hidden text-ellipsis whitespace-nowrap text-ink" title={entry.title}>
              {entry.title}
            </span>
          </span>
          <span
            className="max-w-[240px] overflow-hidden text-ellipsis whitespace-nowrap font-mono text-[11.5px] text-inkdim"
            title={`${entry.project} / ${entry.repo}`}
          >
            {entry.project} / {entry.repo}
          </span>
          {entry.outcome !== undefined ? (
            <span className={`whitespace-nowrap text-[11.5px] ${entry.outcome === 'merged' ? 'text-proceed' : 'text-inkdim'}`}>
              {t(locale, entry.outcome === 'merged' ? 'cockpit.closed.merged' : 'cockpit.closed.cancelled')}
            </span>
          ) : null}
          <span className="whitespace-nowrap font-mono text-[11.5px] text-inkdim">{formatAge(locale, sinceMs(entry.closedAt))}</span>
        </li>
      ))}
    </ul>
  );
}

export function CockpitClosedSection({ entries, locale, sinceMs }: CockpitClosedListProps) {
  const [open, setOpen] = useState(true);
  const latest = entries[0];
  return (
    <section className="grid">
      <div className="flex min-w-0 items-center gap-2">
        <h2 className="text-[13px] font-semibold text-ink">
          <button
            type="button"
            aria-expanded={open}
            onClick={() => setOpen(!open)}
            className="-ml-1.5 flex items-center gap-1.5 rounded-control px-1.5 py-0.5 transition-colors hover:bg-raised"
          >
            <svg
              aria-hidden="true"
              viewBox="0 0 12 12"
              className={`h-3 w-3 flex-none text-inkdim motion-safe:transition-transform ${open ? 'rotate-90' : ''}`}
              style={{ transitionDuration: `${MOTION.results.fadeMs}ms` }}
            >
              <path d="M4 2.5 8 6 4 9.5" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" />
            </svg>
            {t(locale, 'cockpit.section.closed')}
          </button>
        </h2>
        <span className="min-w-5 rounded-full bg-raised px-1.5 text-center font-mono text-[11px] leading-[18px] text-inkdim">
          {entries.length}
        </span>
        {!open && latest !== undefined ? (
          <span
            className="ml-auto min-w-0 overflow-hidden text-ellipsis whitespace-nowrap text-[12px] text-inkdim"
            title={latest.title}
          >
            <span className="font-mono">{formatWorkOrderCode(latest.number, locale)}</span> {latest.title}
          </span>
        ) : null}
      </div>
      <div
        className={`grid motion-safe:transition-[grid-template-rows] ${open ? 'mt-2 grid-rows-[1fr]' : 'grid-rows-[0fr]'}`}
        style={{ transitionDuration: `${MOTION.results.heightMs}ms` }}
        aria-hidden={!open}
      >
        <div className="min-h-0 overflow-hidden">
          <CockpitClosedList entries={entries} locale={locale} sinceMs={sinceMs} />
        </div>
      </div>
    </section>
  );
}
