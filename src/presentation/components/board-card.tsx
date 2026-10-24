// components/board-card.tsx — one work order on the Kanban board (U-18): its code, its title in
// two lines at most, and its status as a lamp plus a word — colour never carries the status
// alone. The card opens the work order in place (K-8:A); it does not drag and shows no hover
// preview. Focus takes the shared active grammar (raised ground, signal edge), with the soft
// signal variant so the edge keeps its contrast on the light theme. A run that waits on a
// permission ask marks the card with a round badge beside the code (U-369).
import { t, type Locale } from '../labels/t';
import type { KanbanCard } from '../stores/board';
import { formatWorkOrderCode } from '../stores/work-order-code';
import { PERMISSION_WAIT_EMPHASIS_MS, permissionWaitMinutes, statusLabel, TONE_LAMP, TONE_TEXT } from './board-status';

/** U-369: the mark a run's open permission ask leaves on its card and row — a round amber pill
 *  with the wait in whole minutes, emphasised once the wait is half an hour old. It is a mark
 *  inside the card's own button, not a second control: clicking anywhere on the card opens the
 *  work order, whose decision zone carries the ask. */
export function BoardPermissionBadge({ askSince, locale }: { readonly askSince: number; readonly locale: Locale }) {
  const now = Date.now();
  const hot = now - askSince >= PERMISSION_WAIT_EMPHASIS_MS;
  return (
    <span
      data-board-permission-badge={hot ? 'hot' : ''}
      className={`inline-flex h-5 flex-none items-center gap-1.5 rounded-full border px-2 text-[11.5px] leading-none text-signal-soft transition-colors duration-[var(--motion-board-hover)] motion-reduce:transition-none ${
        hot ? 'border-signal bg-signal/20 font-bold' : 'border-signal/40 bg-signal/10 font-semibold'
      }`}
    >
      <span
        aria-hidden="true"
        className={`h-1.5 w-1.5 rounded-full bg-signal ${hot ? 'motion-safe:animate-pulse [animation-duration:var(--motion-board-pulse)]' : ''}`}
      />
      {t(locale, 'board.badge.waiting').replace('{n}', String(permissionWaitMinutes(askSince, now)))}
    </span>
  );
}

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
      <span className="flex items-center justify-between gap-2">
        <span className="font-mono text-[11px] font-medium leading-4 text-inkdim">{formatWorkOrderCode(card.number, locale)}</span>
        {card.askSince === undefined ? null : <BoardPermissionBadge askSince={card.askSince} locale={locale} />}
      </span>
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
