import type { WorkOrderCardView } from '../../../core/types';
import { BUCKET_LABELS, UI } from '../../data/labels';
import { WorkOrderCard } from './WorkOrderCard';

// Two-bucket board + a collapsed "Kapalı" drawer (WO-0013). "Sıra sende" is sorted by action rank
// (permission first); the old 3-column layout (BoardColumn.tsx) is gone.
export function Board({
  cards,
  onSelect,
}: {
  cards: WorkOrderCardView[];
  onSelect: (id: WorkOrderCardView['id']) => void;
}) {
  const up = cards.filter((c) => c.bucket === 'up').sort((a, b) => a.actionRank - b.actionRank);
  const working = cards.filter((c) => c.bucket === 'working');
  const closed = cards.filter((c) => c.bucket === 'closed');

  return (
    <div>
      <h2 className="mb-2 text-[11px] font-semibold uppercase tracking-wider text-inkdim">{BUCKET_LABELS.up}</h2>
      <div className="mb-8 flex flex-col gap-2">
        {up.length ? (
          up.map((c) => <WorkOrderCard key={c.id} card={c} onSelect={() => onSelect(c.id)} />)
        ) : (
          <div className="flex items-center gap-2 py-2 pl-1 text-[12px] text-inkdim">
            <span className="font-mono">—</span>
            <span>{UI.noWorkOrders}</span>
          </div>
        )}
      </div>

      <h2 className="mb-2 text-[11px] font-semibold uppercase tracking-wider text-inkdim">
        {BUCKET_LABELS.working}
      </h2>
      <div className="mb-8 flex flex-col gap-2">
        {working.length ? (
          working.map((c) => <WorkOrderCard key={c.id} card={c} onSelect={() => onSelect(c.id)} />)
        ) : (
          <div className="flex items-center gap-2 py-2 pl-1 text-[12px] text-inkdim">
            <span className="font-mono">—</span>
            <span>{UI.inflightEmpty}</span>
          </div>
        )}
      </div>

      <details className="mt-10">
        <summary className="text-[11px] font-semibold uppercase tracking-wider text-inkdim">
          ▾ {UI.closedDrawer} ({closed.length})
        </summary>
        <div className="mt-2 flex flex-col gap-2 opacity-70">
          {closed.map((c) => (
            <WorkOrderCard key={c.id} card={c} onSelect={() => onSelect(c.id)} />
          ))}
        </div>
      </details>
    </div>
  );
}
