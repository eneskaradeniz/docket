import type { WorkOrderCardView, WorkOrderId } from '../../core/types';
import { UI } from '../data/labels';
import { Board } from '../components/board/Board';

export function BoardScreen({
  cards,
  workspaceLabel,
  onSelect,
}: {
  cards: WorkOrderCardView[];
  workspaceLabel: string;
  onSelect: (id: WorkOrderId) => void;
}) {
  return (
    <main className="mx-auto max-w-6xl px-4 py-4">
      <p className="mb-3 text-xs text-slate-400">
        {workspaceLabel} · {cards.length} {UI.workOrders}
      </p>
      <Board cards={cards} onSelect={onSelect} />
    </main>
  );
}
