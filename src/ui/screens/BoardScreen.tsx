import type { WorkOrderCardView, WorkOrderId } from '../../core/types';
import { UI } from '../data/labels';
import { Board } from '../components/board/Board';

// The board screen (WO-0031): the new-WO action moved into the AppShell bar (one primary action, one
// place); this screen is the queues themselves. Content column is capped (880px) with a centered gutter —
// a queue reads vertically; full-bleed width would only stretch the eye.
export function BoardScreen({
  cards,
  onSelect,
}: {
  cards: WorkOrderCardView[];
  onSelect: (id: WorkOrderId) => void;
}) {
  return (
    <main className="mx-auto w-full max-w-[880px] px-6 py-6">
      <p className="readout mb-4">{UI.boardIntro}</p>
      <Board cards={cards} onSelect={onSelect} />
    </main>
  );
}
