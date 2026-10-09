// components/cockpit-closed.tsx — Son kapananlar (U-21): the latest closes in one bordered list,
// dividers between rows; code, title, where it lived, how it ended and how long ago it closed.
import type { CockpitView } from '../../api/queries';
import { t, type Locale } from '../labels/t';
import { formatWorkOrderCode } from '../stores/work-order-code';
import { formatAge } from './cockpit-format';

export interface CockpitClosedListProps {
  readonly entries: CockpitView['recentlyClosed'];
  readonly locale: Locale;
  readonly sinceMs: (at: number) => number;
  readonly onOpen: (workOrderId: string) => void;
}

export function CockpitClosedList({ entries, locale, sinceMs, onOpen }: CockpitClosedListProps) {
  return (
    <ul className="grid divide-y divide-hairline overflow-hidden rounded-card border border-hairline bg-surface">
      {entries.map((entry) => (
        <li key={entry.workOrderId}>
          <button
            type="button"
            onClick={() => onOpen(entry.workOrderId)}
            className="grid min-h-9 w-full grid-cols-[auto_minmax(0,1fr)_auto_auto_auto] items-center gap-3 px-3.5 text-left text-[0.8125rem] transition-colors hover:bg-raised"
          >
          <span aria-hidden="true" className="text-[0.75rem] text-proceed">✓</span>
          <span className="flex min-w-0 items-center gap-2.5">
            <span className="flex-none font-mono text-[0.71875rem] text-inkdim">{formatWorkOrderCode(entry.number, locale)}</span>
            <span className="min-w-0 overflow-hidden text-ellipsis whitespace-nowrap text-ink" title={entry.title}>
              {entry.title}
            </span>
          </span>
          <span
            className="max-w-[15rem] overflow-hidden text-ellipsis whitespace-nowrap font-mono text-[0.71875rem] text-inkdim"
            title={`${entry.project} / ${entry.repo}`}
          >
            {entry.project} / {entry.repo}
          </span>
          {entry.outcome !== undefined ? (
            <span className={`whitespace-nowrap text-[0.71875rem] ${entry.outcome === 'merged' ? 'text-proceed' : 'text-inkdim'}`}>
              {t(locale, entry.outcome === 'merged' ? 'cockpit.closed.merged' : 'cockpit.closed.cancelled')}
            </span>
          ) : null}
          <span className="whitespace-nowrap font-mono text-[0.71875rem] text-inkdim">{formatAge(locale, sinceMs(entry.closedAt))}</span>
          </button>
        </li>
      ))}
    </ul>
  );
}
