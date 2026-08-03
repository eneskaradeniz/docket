import type { BoardColumn as Column, WorkOrderCardView } from '../../../core/types';
import { COLUMN_HELP, COLUMN_LABELS, UI } from '../../data/labels';
import { WorkOrderCard } from './WorkOrderCard';

export function BoardColumn({
  column,
  cards,
  onSelect,
}: {
  column: Column;
  cards: WorkOrderCardView[];
  onSelect: (id: WorkOrderCardView['id']) => void;
}) {
  return (
    <section className="flex flex-col gap-2">
      <header>
        <div className="flex items-baseline justify-between">
          <h2 className="text-sm font-semibold text-slate-800">{COLUMN_LABELS[column]}</h2>
          <span className="text-xs text-slate-400">{cards.length}</span>
        </div>
        <p className="-mt-0.5 text-[11px] text-slate-400">{COLUMN_HELP[column]}</p>
      </header>
      <div className="flex flex-col gap-2">
        {cards.length === 0 ? (
          <p className="py-6 text-center text-xs italic text-slate-300">{UI.noWorkOrders}</p>
        ) : (
          cards.map((c) => <WorkOrderCard key={c.id} card={c} onSelect={() => onSelect(c.id)} />)
        )}
      </div>
    </section>
  );
}
