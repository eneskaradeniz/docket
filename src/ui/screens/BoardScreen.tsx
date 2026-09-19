import type { WorkOrderCardView, WorkOrderId } from '../../core/types';
import type { ForgeView } from '../../core/forge';
import type { SystemHealth } from '../../core/health';
import type { WorkspaceBudgetView } from '../../core/budget';
import { useLabels } from '../data/locale';
import { Board } from '../components/board/Board';
import { ForgeSection } from '../components/board/ForgeSection';
import { HealthStrip } from '../components/board/HealthStrip';
import { InviteHero } from '../components/InviteHero';

// The board screen (WO-0031): the new-WO action moved into the AppShell bar (one primary action, one
// place); this screen is the queues themselves. Content column is capped (880px) with a centered gutter —
// a queue reads vertically; full-bleed width would only stretch the eye. Zero work orders is not a board
// with two empty buckets — it is the invitation (WO-0031d / ADR-0012 r2).
// WO-0064: the forge observation rides ABOVE the queues as its own section — the reconciliation's
// visible proof, absent until something has been scanned (no connection, no scan → no section).
// WO-0066: the health strip rides above THAT — the three dependencies in one dim row.
export function BoardScreen({
  cards,
  budget,
  health,
  forge,
  onRefreshForge,
  onSelect,
  onNewWorkOrder,
}: {
  cards: WorkOrderCardView[];
  budget?: WorkspaceBudgetView; // WO-0047: the workspace's month spend — the warn line on every card
  health?: SystemHealth; // WO-0066: the three dependencies' state; undefined = no look landed
  forge?: ForgeView; // WO-0064: the observed forge cache view; undefined = not scanned yet
  onRefreshForge?: () => void; // the section's Yenile chip + the shared reconcile trigger
  onSelect: (id: WorkOrderId) => void;
  onNewWorkOrder: () => void;
}) {
  const { UI } = useLabels();
  return (
    <main className="mx-auto w-full max-w-[840px] px-5 py-5">
      {health !== undefined && <HealthStrip health={health} />}
      {forge !== undefined && forge.repos.length > 0 && onRefreshForge !== undefined && (
        <ForgeSection view={forge} onRefresh={onRefreshForge} />
      )}
      {cards.length ? (
        <Board cards={cards} budget={budget} onSelect={onSelect} onNewWorkOrder={onNewWorkOrder} />
      ) : (
        <InviteHero line={UI.inviteFirstWo} cta={UI.newWorkOrder} onCta={onNewWorkOrder} />
      )}
    </main>
  );
}
