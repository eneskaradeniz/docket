import type { WorkOrderCardView, WorkOrderId } from '../../core/types';
import { useLabels } from '../data/locale';
import { Board } from '../components/board/Board';
import { InviteHero } from '../components/InviteHero';

// The board screen (WO-0031): the new-WO action moved into the AppShell bar (one primary action, one
// place); this screen is the queues themselves. Content column is capped (880px) with a centered gutter —
// a queue reads vertically; full-bleed width would only stretch the eye. Zero work orders is not a board
// with two empty buckets — it is the invitation (WO-0031d / ADR-0012 r2).
export function BoardScreen({
  cards,
  onSelect,
  onNewWorkOrder,
}: {
  cards: WorkOrderCardView[];
  onSelect: (id: WorkOrderId) => void;
  onNewWorkOrder: () => void;
}) {
  const { UI } = useLabels();
  return (
    <main className="mx-auto w-full max-w-[840px] px-5 py-5">
      {cards.length ? (
        <Board cards={cards} onSelect={onSelect} onNewWorkOrder={onNewWorkOrder} />
      ) : (
        <InviteHero line={UI.inviteFirstWo} cta={UI.newWorkOrder} onCta={onNewWorkOrder} />
      )}
    </main>
  );
}
