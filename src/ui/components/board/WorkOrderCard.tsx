import type { BoardColumn, WorkOrderCardView } from '../../../core/types';
import { cardReasonText, STAGE_LABELS, UI } from '../../data/labels';
import { Badge, type BadgeTone } from '../primitives/Badge';

const COLUMN_TONE: Record<BoardColumn, BadgeTone> = {
  your_turn: 'warn',
  running: 'info',
  external: 'neutral',
};

export function WorkOrderCard({ card, onSelect }: { card: WorkOrderCardView; onSelect: () => void }) {
  const tokens = card.cost.tokensIn + card.cost.tokensOut;
  return (
    <button
      type="button"
      onClick={onSelect}
      data-wo-id={card.id}
      className="w-full rounded-lg border border-slate-200 bg-white p-3 text-left shadow-sm transition hover:border-slate-300 hover:shadow"
    >
      <div className="flex items-start justify-between gap-2">
        <h3 className="text-sm font-medium text-slate-900">{card.title}</h3>
        <Badge tone={COLUMN_TONE[card.column]}>{card.id}</Badge>
      </div>
      <p className="mt-1 text-xs text-slate-500">
        {STAGE_LABELS[card.stage]} · {card.trackCount} track(s)
      </p>
      <p className="mt-2 text-xs font-medium text-slate-700">{cardReasonText(card.reason)}</p>
      <p className="mt-2 text-[11px] text-slate-400">
        ${card.cost.usd.toFixed(2)} · {tokens.toLocaleString()} {UI.tokens}
      </p>
    </button>
  );
}
