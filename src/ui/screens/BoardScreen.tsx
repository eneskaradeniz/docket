import type { WorkOrderCardView, WorkOrderId } from '../../core/types';
import { UI } from '../data/labels';
import { Board } from '../components/board/Board';

export function BoardScreen({
  cards,
  onSelect,
  onNewWorkOrder,
}: {
  cards: WorkOrderCardView[];
  onSelect: (id: WorkOrderId) => void;
  onNewWorkOrder: () => void;
}) {
  return (
    <main className="mx-auto max-w-3xl px-6 py-8">
      <div className="mb-5 flex items-center justify-between gap-3">
        <p className="text-[13px] text-inkdim">{UI.boardIntro}</p>
        <button type="button" onClick={onNewWorkOrder} className="alink shrink-0 text-[12px]">
          {UI.newWorkOrder}
        </button>
      </div>
      <Board cards={cards} onSelect={onSelect} />
    </main>
  );
}
