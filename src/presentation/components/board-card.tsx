// components/board-card.tsx — one work order on the Kanban board (U-18): its code, its title in
// two lines at most, and its status as a lamp plus a word — colour never carries the status
// alone. The card opens the work order in place (K-8:A); it does not drag and shows no hover
// preview. Focus takes the shared active grammar (raised ground, signal edge), with the soft
// signal variant so the edge keeps its contrast on the light theme.
import type { Locale } from '../labels/t';
import type { KanbanCard } from '../stores/board';
import { formatWorkOrderCode } from '../stores/work-order-code';
import { statusLabel, TONE_LAMP, TONE_TEXT } from './board-status';

export function BoardCard({
  card,
  locale,
  onOpen,
}: {
  readonly card: KanbanCard;
  readonly locale: Locale;
  readonly onOpen: (workOrderId: string) => void;
}) {
  return (
    <button
      type="button"
      data-board-card
      onClick={() => onOpen(card.id)}
      className="flex min-h-[72px] w-full flex-col gap-2 rounded-card border border-bord bg-surface p-3 text-left outline-none transition-colors duration-[var(--motion-board-hover)] hover:border-inkdim focus-visible:border-signal-soft focus-visible:bg-raised motion-reduce:transition-none"
    >
      <span className="font-mono text-[11px] font-medium leading-4 text-inkdim">{formatWorkOrderCode(card.number, locale)}</span>
      <span className="line-clamp-2 text-[13.5px] font-semibold leading-5 text-ink [overflow-wrap:anywhere]" title={card.title}>
        {card.title}
      </span>
      <span className={`flex items-center gap-2 text-[12px] font-medium ${TONE_TEXT[card.tone]}`}>
        <span aria-hidden="true" className={`h-2 w-2 flex-none rounded-full ${TONE_LAMP[card.tone]}`} />
        {statusLabel(locale, card.status)}
      </span>
    </button>
  );
}
