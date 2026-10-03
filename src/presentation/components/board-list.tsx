// components/board-list.tsx — the list view (U-18): one flow, not one stage at a time. Rows are
// grouped by stage in flow order, the done work last; a group header (name, total, and the
// running and waiting counts only when there are any) folds its rows and stays under the column
// header while its rows scroll by. The column header and the rows share one grid, so the columns
// line up. Rows alternate a faint tint so a long list stays readable; a row is a button that
// opens the work order in place, and ↑/↓ move between rows. The table is its own scroller under
// the fixed page header, so the sticky headers rest on the table's top edge — never on the page's
// padded scroll area, where they would stop short of the edge and let rows show above them.
import { useRef, useState, type KeyboardEvent } from 'react';
import { t, type Locale } from '../labels/t';
import type { ListGroup } from '../stores/board';
import { formatWorkOrderCode } from '../stores/work-order-code';
import { statusLabel, TONE_LAMP, TONE_TEXT } from './board-status';
import { UnfoldIcon } from './board-icons';

const GRID = 'grid grid-cols-[20px_72px_minmax(0,1fr)_184px] items-center gap-4 px-4';

const COUNT_CLASS = 'inline-flex items-center gap-1.5 font-mono text-[12px] font-medium leading-none text-ink';

export function BoardList({
  groups,
  locale,
  onOpenWorkOrder,
  onToggleGroup,
}: {
  readonly groups: readonly ListGroup[];
  readonly locale: Locale;
  readonly onOpenWorkOrder: (workOrderId: string) => void;
  readonly onToggleGroup: (key: string) => void;
}) {
  const table = useRef<HTMLDivElement>(null);
  const [active, setActive] = useState<string | null>(null);
  const empty = groups.every((group) => group.rows.length === 0);
  const firstRow = groups.find((group) => group.open)?.rows[0]?.id ?? null;

  const move = (event: KeyboardEvent<HTMLDivElement>): void => {
    if (event.key !== 'ArrowDown' && event.key !== 'ArrowUp') return;
    const rows = [...(table.current?.querySelectorAll<HTMLElement>('[data-list-row]') ?? [])];
    const at = rows.indexOf(event.target as HTMLElement);
    if (at < 0) return;
    event.preventDefault();
    rows[at + (event.key === 'ArrowDown' ? 1 : -1)]?.focus();
  };

  if (empty) {
    return <p className="py-5 text-center text-[12.5px] text-inkdim">{t(locale, 'board.list.empty')}</p>;
  }

  return (
    <div ref={table} onKeyDown={move} className="flex min-h-[360px] min-w-0 flex-1 overflow-hidden rounded-card border border-bord bg-band">
      <div data-board-list className="min-h-0 min-w-0 flex-1 overflow-y-auto">
        <div aria-hidden="true" className={`${GRID} sticky top-0 z-20 h-9 border-b border-hairline bg-band text-[12px] font-semibold text-inkdim`}>
          <span />
          <span>{t(locale, 'board.list.col.code')}</span>
          <span>{t(locale, 'board.list.col.title')}</span>
          <span>{t(locale, 'board.list.col.status')}</span>
        </div>
        {groups.map((group) => {
          const name = group.kind === 'done' ? t(locale, 'board.column.done') : group.name;
          const empty = group.rows.length === 0;
          return (
            <section key={group.key} aria-label={name}>
              <button
                type="button"
                onClick={() => onToggleGroup(group.key)}
                disabled={empty}
                aria-expanded={group.open}
                title={`${name}: ${group.rows.length} ${t(locale, 'board.done.jobs')}, ${group.running} ${t(locale, 'board.list.running')}, ${group.waiting} ${t(locale, 'board.list.waiting')}`}
                className="sticky top-9 z-10 flex h-10 w-full items-center gap-2 border-y border-bord bg-[color-mix(in_srgb,var(--ink)_14%,var(--bg))] px-4 text-left text-[14px] font-bold text-ink outline-none transition-colors duration-[var(--motion-board-hover)] hover:enabled:bg-[color-mix(in_srgb,var(--ink)_20%,var(--bg))] focus-visible:shadow-[inset_0_0_0_1px_var(--signal-soft)] disabled:font-semibold disabled:text-inkdim motion-reduce:transition-none"
              >
                <span aria-hidden="true" className={`grid h-3.5 w-3 place-items-center text-inkdim transition-transform duration-[var(--motion-board-column)] motion-reduce:transition-none ${group.open ? '' : '-rotate-90'}`}>
                  <UnfoldIcon />
                </span>
                <span className="min-w-0 truncate" title={name}>{name}</span>
                <span className="inline-flex h-5 flex-none items-center rounded-full bg-bg px-2 font-mono text-[12px] font-medium leading-none text-inkdim">{group.rows.length}</span>
                {group.running > 0 ? (
                  <span className={COUNT_CLASS}>
                    <span aria-hidden="true" className="h-2 w-2 rounded-full bg-proceed" />
                    {group.running}
                  </span>
                ) : null}
                {group.waiting > 0 ? (
                  <span className={COUNT_CLASS}>
                    <span aria-hidden="true" className="h-2 w-2 rounded-full bg-signal" />
                    {group.waiting}
                  </span>
                ) : null}
              </button>
              {group.open ? (
                <ul>
                  {group.rows.map((row) => (
                    <li key={row.id} className="even:bg-ink/5">
                      <button
                        type="button"
                        data-list-row
                        tabIndex={(active ?? firstRow) === row.id ? 0 : -1}
                        onFocus={() => setActive(row.id)}
                        onClick={() => onOpenWorkOrder(row.id)}
                        className={`${GRID} min-h-12 w-full py-2 text-left outline-none transition-colors duration-[var(--motion-board-hover)] hover:bg-ink/[0.07] hover:shadow-[inset_0_0_0_1px_var(--dim)] focus-visible:bg-ink/10 focus-visible:shadow-[inset_0_0_0_1px_var(--signal-soft)] motion-reduce:transition-none`}
                      >
                        <span aria-hidden="true" className={`h-2 w-2 rounded-full ${TONE_LAMP[row.tone]}`} />
                        <span className="font-mono text-[12px] font-medium text-inkdim">{formatWorkOrderCode(row.number, locale)}</span>
                        <span className="line-clamp-2 min-w-0 text-[14px] font-semibold leading-5 text-ink [overflow-wrap:anywhere]" title={row.title}>
                          {row.title}
                        </span>
                        <span className={`text-[12.5px] font-medium ${TONE_TEXT[row.tone]}`}>{statusLabel(locale, row.status)}</span>
                      </button>
                    </li>
                  ))}
                </ul>
              ) : null}
            </section>
          );
        })}
      </div>
    </div>
  );
}
