import type { WorkOrderCardView, WorkOrderId } from '../../core/types';
import type { ForgeView } from '../../core/forge';
import type { WorkspaceBudgetView } from '../../core/budget';
import { useLabels } from '../data/locale';
import { Board } from '../components/board/Board';
import { InviteHero } from '../components/InviteHero';

// The board screen (WO-0031): the new-WO action moved into the AppShell bar (one primary action, one
// place); this screen is the queues themselves. Content column is capped (880px) with a centered gutter —
// a queue reads vertically; full-bleed width would only stretch the eye. Zero work orders is not a board
// with two empty buckets — it is the invitation (WO-0031d / ADR-0012 r2).
// WO-0086: the forge section left the board — connections and open PRs are FACTS, they live on the
// overview now; the board carries at most ONE dim summary line (the detail screen's Kaynaklar keeps
// the evidence links, so nothing is lost). WO-0083: the health strip left earlier, same principle.
export function BoardScreen({
  cards,
  budget,
  forge,
  onSelect,
  onNewWorkOrder,
}: {
  cards: WorkOrderCardView[];
  budget?: WorkspaceBudgetView; // WO-0047: the workspace's month spend — the warn line on every card
  forge?: ForgeView; // WO-0086: read-only here — the summary line's data; the section lives on the overview
  onSelect: (id: WorkOrderId) => void;
  onNewWorkOrder: () => void; // the empty face's invitation CTA (the appbar owns the always-on one)
}) {
  const { UI } = useLabels();
  const prTotal = forge?.repos.reduce((n, r) => n + r.prs.length, 0) ?? 0;
  return (
    <main className="mx-auto w-full max-w-[840px] px-5 py-5">
      {forge !== undefined && forge.repos.length > 0 && (
        <p className="mb-5 font-mono text-[10.5px] text-inkdim">{UI.forgeBoardLine(forge.repos.length, prTotal)}</p>
      )}
      {cards.length ? (
        <Board cards={cards} budget={budget} onSelect={onSelect} />
      ) : (
        <InviteHero line={UI.inviteFirstWo} cta={UI.newWorkOrder} onCta={onNewWorkOrder} />
      )}
    </main>
  );
}
