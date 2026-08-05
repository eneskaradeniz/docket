import type { WorkOrderCardView, WorkOrderId } from '../../core/types';
import { UI } from '../data/labels';
import { Board } from '../components/board/Board';

export function BoardScreen({
  cards,
  onSelect,
}: {
  cards: WorkOrderCardView[];
  onSelect: (id: WorkOrderId) => void;
}) {
  return (
    <main className="mx-auto max-w-3xl px-6 py-8">
      <p className="mb-5 text-[13px] text-inkdim">{UI.boardIntro}</p>
      <Board cards={cards} onSelect={onSelect} />
    </main>
  );
}
