import type { BoardBucket, WorkOrderCardView } from '../../../core/types';
import { Badge } from '../../kit';
import { cardActionText, cardReasonText, formatCost, STAGE_LABELS, woIdLabel } from '../../data/labels';

// The dispatch card (WO-0031 "Kontrol Konsolu"): a 3px signal lamp on the left edge — amber breathing
// when the operator is needed, info pulse while a session runs, steady green when closed — over a calm
// surface. Row 1: id (mono, via woIdLabel — ADR-0007) + stage; row 2: title; row 3: reason + cost.
// Keyboard-accessible (outer <button>); the whole card is one target.
const LAMP: Record<BoardBucket, string> = {
  up: 'lamp-signal-breathe',
  working: 'lamp-run',
  closed: 'lamp-done',
};
const STAGE_TONE: Record<BoardBucket, 'signal' | 'info' | 'proceed'> = { up: 'signal', working: 'info', closed: 'proceed' };

export function WorkOrderCard({ card, onSelect }: { card: WorkOrderCardView; onSelect: () => void }) {
  return (
    <button
      type="button"
      onClick={onSelect}
      data-wo-id={card.id}
      className="flex w-full items-stretch overflow-hidden rounded-md border border-hairline bg-surface text-left shadow-sm transition-all hover:-translate-y-px hover:border-inkdim/50 hover:bg-raised/60"
    >
      <div className={`lamp ${LAMP[card.bucket]}`} />
      <div className="min-w-0 flex-1 px-3 py-2.5">
        <div className="flex items-center gap-2">
          <span className="font-mono text-[11px] text-inkdim">{woIdLabel(card.id)}</span>
          <Badge tone={STAGE_TONE[card.bucket]}>{STAGE_LABELS[card.stage]}</Badge>
          <span className="ml-auto font-mono text-[11px] text-inkdim">
            {card.sessionCount > 0 ? formatCost(card.cost) : null}
          </span>
        </div>
        <h3 className="mt-0.5 truncate text-[13.5px] font-semibold tracking-tight text-ink">{card.title}</h3>
        <div className="mt-0.5 flex items-end justify-between gap-3">
          <p className="truncate text-[12px] text-inkdim">{cardReasonText(card.reason)}</p>
          {card.action ? (
            <span className="shrink-0 font-mono text-[11px] uppercase tracking-wider text-info">
              ▸ {cardActionText(card.action)}
            </span>
          ) : null}
        </div>
      </div>
    </button>
  );
}
