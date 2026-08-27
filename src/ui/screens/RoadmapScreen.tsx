// RoadmapScreen (WO-0049, mockup kare 01/02/03) — the sibling surface: AppShell's `Pano | Yol
// Haritası` switch lands here. The board's column (840px, one vertical read). The three faces of
// RoadmapView: absent → the invitation + the file line (ZERO actions — the ✦ draft drive is
// WO-0050's; ADR-0012's ≤1 is a cap, not a floor); invalid → the named reasons (never silent
// empty — the WO-0048 gate); ready → the head meta (ALL observed spend, the known-qualifier when
// a session carried no cost), the strip, the collapsed past (≥2 done fazlar), the cards, and the
// Ekle-only footer (`+ Faz ekle` — the right cluster stays empty until WO-0050).
import { useCallback, useRef, useState } from 'react';
import type { WorkOrderId, Workspace } from '../../core/types';
import type { RoadmapView } from '../../core/roadmap';
import type { WorkOrderSource } from '../../core/source';
import { useLabels } from '../data/locale';
import { Button } from '../kit';
import { InviteHero } from '../components/InviteHero';
import { FazStrip } from '../components/roadmap/FazStrip';
import { FazCard } from '../components/roadmap/FazCard';
import { DoneFold } from '../components/roadmap/DoneFold';
import { FazAddDialog } from '../components/roadmap/FazAddDialog';
import { TaskAddDialog } from '../components/roadmap/TaskAddDialog';
import type { WoSpawnPrefill } from '../components/roadmap/TaskRow';

export function RoadmapScreen({
  view,
  workspace,
  docsRoot,
  source,
  onSpawn,
  onOpenWo,
  onRefresh,
}: {
  view: RoadmapView | undefined; // undefined = the read is in flight
  workspace: Workspace;
  /** The effective structure root — names the file on the invitation surface. */
  docsRoot: string;
  source: WorkOrderSource;
  onSpawn: (prefill: WoSpawnPrefill) => void;
  onOpenWo: (id: WorkOrderId) => void;
  onRefresh: () => void;
}) {
  const { ROADMAP_DIAGNOSTIC_LABELS, UI } = useLabels();
  // The add-dialog pair is local: the screen unmounts on surface/detail switches, so a dialog can
  // never outlive its faz (a mid-save surface switch unmounts the dialog; saveRoadmap's guard still
  // refuses before any byte if the race lands).
  const [fazAddOpen, setFazAddOpen] = useState(false);
  const [taskAddFor, setTaskAddFor] = useState<string | undefined>(undefined);
  // The strip's jump targets — the card refs, one per faz; scrollIntoView honors reduced-motion.
  const cardEls = useRef(new Map<string, HTMLDivElement>());
  const setCardEl = useCallback((id: string, el: HTMLDivElement | null) => {
    if (el === null) cardEls.current.delete(id);
    else cardEls.current.set(id, el);
  }, []);
  const jumpTo = useCallback((fazId: string) => {
    cardEls.current.get(fazId)?.scrollIntoView({
      block: 'start',
      behavior: window.matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth',
    });
  }, []);

  let body;
  if (view === undefined) {
    body = <p className="loadline px-1 py-8">{UI.roadmapReading}</p>;
  } else if (view.kind === 'absent') {
    body = <InviteHero line={UI.roadmapInviteLine} info={UI.roadmapInviteFile(docsRoot)} />;
  } else if (view.kind === 'invalid') {
    body = (
      <div className="flex min-h-[40vh] flex-col items-center justify-center gap-3 px-6">
        <p className="text-[15px] font-semibold text-ink">{UI.roadmapInvalidLine}</p>
        <ul className="flex flex-col items-start gap-1">
          {view.reasons.map((d, i) => (
            <li key={i} className="font-mono text-[11.5px] text-inkdim">— {ROADMAP_DIAGNOSTIC_LABELS[d.code](d.detail)}</li>
          ))}
        </ul>
      </div>
    );
  } else {
    const done = view.fazlar.filter((f) => f.status === 'tamam');
    const live = view.fazlar.filter((f) => f.status !== 'tamam');
    const card = (f: (typeof view.fazlar)[number]) => (
      <FazCard
        key={f.id}
        faz={f}
        allFazlar={view.fazlar}
        siradakiTaskId={view.siradaki !== undefined && view.siradaki.fazId === f.id ? view.siradaki.taskId : undefined}
        cardRef={(el) => setCardEl(f.id, el)}
        onSpawn={onSpawn}
        onOpenWo={onOpenWo}
        onAddTask={(fazId) => setTaskAddFor(fazId)}
      />
    );
    body = (
      <div className="flex flex-col gap-3">
        <div className="flex items-baseline justify-between gap-3">
          <h1 className="readout text-ink">{view.head.title}</h1>
          <span className="font-mono text-[11px] text-inkdim">
            {view.head.costUnknown
              ? UI.roadmapHeadMetaKnown(view.head.doneFazCount, view.head.totalFazCount, view.head.openWoCount, view.head.totalCostUsd)
              : UI.roadmapHeadMeta(view.head.doneFazCount, view.head.totalFazCount, view.head.openWoCount, view.head.totalCostUsd)}
          </span>
        </div>
        <FazStrip fazlar={view.fazlar} onJump={jumpTo} />
        {done.length >= 2 ? (
          <DoneFold done={done}>{done.map(card)}</DoneFold>
        ) : null}
        {(done.length < 2 ? done : []).map(card)}
        {live.map(card)}
        <div className="mt-1 flex justify-start">
          <Button variant="ghost" size="sm" data-faz-add onClick={() => setFazAddOpen(true)}>
            {UI.roadmapFazAdd}
          </Button>
        </div>
      </div>
    );
  }

  return (
    <main data-roadmap-screen className="mx-auto w-full max-w-[840px] px-5 py-5">
      {body}
      {fazAddOpen && view !== undefined && view.kind === 'ready' ? (
        <FazAddDialog
          workspace={workspace}
          source={source}
          fazlar={view.fazlar}
          onClose={() => setFazAddOpen(false)}
          onSaved={onRefresh}
        />
      ) : null}
      {taskAddFor !== undefined && view !== undefined && view.kind === 'ready' ? (
        (() => {
          const faz = view.fazlar.find((f) => f.id === taskAddFor);
          return faz !== undefined ? (
            <TaskAddDialog
              workspace={workspace}
              source={source}
              faz={faz}
              onClose={() => setTaskAddFor(undefined)}
              onSaved={onRefresh}
            />
          ) : null;
        })()
      ) : null}
    </main>
  );
}
