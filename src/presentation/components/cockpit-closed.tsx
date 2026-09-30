// components/cockpit-closed.tsx — Son kapananlar (U-21): the latest closes in one bordered list,
// dividers between rows; code, title, where it lived and how long ago it closed.
import type { CockpitView } from '../../api/queries';
import type { Locale } from '../labels/t';
import { formatWorkOrderCode } from '../stores/work-order-code';
import { formatAge } from './cockpit-format';

export interface CockpitClosedListProps {
  readonly entries: CockpitView['recentlyClosed'];
  readonly locale: Locale;
  readonly sinceMs: (at: number) => number;
}

export function CockpitClosedList({ entries, locale, sinceMs }: CockpitClosedListProps) {
  return (
    <ul className="grid divide-y divide-hairline rounded-card border border-hairline bg-surface">
      {entries.map((entry) => (
        <li key={entry.workOrderId} className="grid min-h-9 grid-cols-[auto_minmax(0,1fr)_auto_auto] items-center gap-3 px-3.5 text-[13px]">
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
          <span className="whitespace-nowrap font-mono text-[11.5px] text-inkdim">{formatAge(locale, sinceMs(entry.closedAt))}</span>
        </li>
      ))}
    </ul>
  );
}
