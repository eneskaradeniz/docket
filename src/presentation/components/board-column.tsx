// components/board-column.tsx — one Kanban column (U-18): a stage of the flow, or the done work
// as the last column. Open, it is a lane — a 40px header (name, the amber count of cards that
// wait on a person, the total, the fold control) over cards that scroll inside the lane. Shut, it
// is a 48px rail with the name set on its side. A column that waits on a person cannot be shut:
// its fold control stays, disabled, with the reason as its title.
import { t, type Locale } from '../labels/t';
import type { KanbanColumn } from '../stores/board';
import { BoardCard } from './board-card';
import { FoldIcon, UnfoldIcon } from './board-icons';

const ICON_BUTTON_CLASS =
  'grid h-6 w-6 flex-none place-items-center rounded-control border border-transparent text-inkdim outline-none transition-colors duration-[var(--motion-board-hover)] hover:border-bord hover:text-ink focus-visible:border-signal-soft disabled:pointer-events-none disabled:opacity-35 motion-reduce:transition-none';

const PILL_CLASS = 'inline-flex h-5 flex-none items-center gap-1.5 rounded-full bg-raised px-2 font-mono text-[12px] font-medium leading-none';

export function BoardColumnLane({
  column,
  locale,
  onOpenWorkOrder,
  onToggle,
}: {
  readonly column: KanbanColumn;
  readonly locale: Locale;
  readonly onOpenWorkOrder: (workOrderId: string) => void;
  readonly onToggle: (key: string) => void;
}) {
  const name = column.kind === 'done' ? t(locale, 'board.column.done') : column.name;
  const locked = column.waiting > 0;

  if (column.shut) {
    return (
      <section
        aria-label={`${name}, ${t(locale, 'board.column.shut')}`}
        className="flex w-12 flex-none snap-start flex-col items-center gap-3 rounded-panel border border-bord bg-band pb-3 pt-2"
      >
        <button
          type="button"
          onClick={() => onToggle(column.key)}
          aria-label={`${name} · ${t(locale, 'board.column.expand')}`}
          title={t(locale, 'board.column.expand')}
          className={ICON_BUTTON_CLASS}
        >
          <UnfoldIcon />
        </button>
        <span className="min-h-0 flex-1 whitespace-nowrap text-[13px] font-semibold text-ink [writing-mode:vertical-rl]">{name}</span>
        <span className={`${PILL_CLASS} text-inkdim`}>{column.cards.length}</span>
      </section>
    );
  }

  return (
    <section
      aria-label={name}
      className="flex min-w-[264px] max-w-[320px] flex-[1_1_280px] snap-start flex-col overflow-hidden rounded-panel border border-bord bg-band"
    >
      <div className="flex h-10 flex-none items-center gap-2 border-b border-hairline pl-3 pr-2">
        <h2 className="mr-auto min-w-0 truncate text-[13px] font-semibold text-ink" title={name}>
          {name}
        </h2>
        {locked ? (
          <span className={`${PILL_CLASS} text-signal-soft`} title={`${column.waiting} ${t(locale, 'board.list.waiting')}`}>
            <span aria-hidden="true" className="h-1.5 w-1.5 rounded-full bg-signal" />
            {column.waiting}
          </span>
        ) : null}
        <span className={`${PILL_CLASS} text-inkdim`} title={`${column.cards.length} ${t(locale, 'board.done.jobs')}`}>
          {column.cards.length}
        </span>
        <button
          type="button"
          onClick={() => onToggle(column.key)}
          disabled={locked}
          aria-label={`${name} · ${t(locale, 'board.column.collapse')}`}
          title={locked ? t(locale, 'board.column.locked') : t(locale, 'board.column.collapse')}
          className={ICON_BUTTON_CLASS}
        >
          <FoldIcon />
        </button>
      </div>
      {column.cards.length > 0 ? (
        <ul className="flex min-h-0 flex-1 flex-col gap-2 overflow-y-auto p-2">
          {column.cards.map((card) => (
            <li key={card.id}>
              <BoardCard card={card} locale={locale} onOpen={onOpenWorkOrder} />
            </li>
          ))}
        </ul>
      ) : (
        <div className="p-2">
          <p className="grid min-h-24 place-items-center rounded-card border border-dashed border-hairline p-4 text-center text-[12.5px] text-inkdim">
            {t(locale, 'board.empty.stage')}
          </p>
        </div>
      )}
    </section>
  );
}
