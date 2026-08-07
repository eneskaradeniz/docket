import type { BoardBucket, WorkOrderCardView } from '../../../core/types';
import { cardActionText, cardReasonText, formatCost, ROLE_LABELS, STAGE_LABELS, woIdLabel } from '../../data/labels';

// Evidence-ticket card (WO-0013). The strip colour comes from the bucket; the brass strip pulses
// when the work order needs the operator. Keyboard-accessible (outer <button>).
const STRIP: Record<BoardBucket, string> = { up: 'brass', working: 'denim', closed: 'sage' };
const PULSE: Record<BoardBucket, string> = { up: ' pulse', working: '', closed: '' };

export function WorkOrderCard({ card, onSelect }: { card: WorkOrderCardView; onSelect: () => void }) {
  return (
    <button
      type="button"
      onClick={onSelect}
      data-wo-id={card.id}
      className="flex w-full items-stretch rounded-sm border border-rule bg-surface text-left transition-colors hover:bg-surface2"
    >
      <div className={`bar bar-${STRIP[card.bucket]}${PULSE[card.bucket]}`} />
      <div className="perf" />
      <div className="min-w-0 flex-1 px-3.5 py-3">
        <div className="flex items-center gap-2">
          <span className="font-mono text-[11px] text-inkdim">{woIdLabel(card.id)}</span>
          <span className="font-mono text-[11px] uppercase tracking-wide text-inkdim">
            {STAGE_LABELS[card.stage]}
          </span>
          <h3 className="truncate text-[14px] font-semibold text-ink">{card.title}</h3>
          <span className="ml-auto flex items-center gap-2">
            {card.role ? (
              <span className="font-mono text-[11px] lowercase text-inkdim">{ROLE_LABELS[card.role]}</span>
            ) : null}
            <span className="font-mono text-[12px] text-inkdim">
              {card.sessionCount > 0 ? formatCost(card.cost) : null}
            </span>
          </span>
        </div>
        <div className="mt-1 flex items-end justify-between gap-3">
          <p className="truncate text-[13px] text-inkdim">{cardReasonText(card.reason)}</p>
          {card.action ? <span className="alink whitespace-nowrap text-[12px]">▸ {cardActionText(card.action)}</span> : null}
        </div>
      </div>
    </button>
  );
}
