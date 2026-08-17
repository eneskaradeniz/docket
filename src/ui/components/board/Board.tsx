import type { WorkOrderCardView } from '../../../core/types';
import { BUCKET_LABELS, UI } from '../../data/labels';
import { WorkOrderCard } from './WorkOrderCard';

// The dispatch board (WO-0031 "Kontrol Konsolu"): the two live queues sit side by side when there is
// room (≥1200px) and stack below it; the closed drawer stays collapsed at the bottom. Cards load with a
// 30ms stagger — the one orchestrated moment (reduced-motion kills it). A group with nothing in it is
// ABSENT (ADR-0012 r2): no empty frame, no dashed box, no count of zero.
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
  const stagger = (i: number): { animationDelay: string } | undefined =>
    i < 12 ? { animationDelay: `${i * 30}ms` } : undefined;

  return (
    <div>
      <div className="grid gap-x-3.5 gap-y-4 xl:grid-cols-2">
        {up.length ? (
          <section>
            <h2 className="readout mb-2 flex items-center gap-1.5">
              <span className="h-1.5 w-1.5 rounded-full bg-signal" aria-hidden="true" />
              {BUCKET_LABELS.up}
              <span className="font-mono text-inkdim/60">{up.length}</span>
            </h2>
            <div className="flex flex-col gap-2">
              {up.map((c, i) => (
                <div key={c.id} className="rise" style={stagger(i)}>
                  <WorkOrderCard card={c} onSelect={() => onSelect(c.id)} />
                </div>
              ))}
            </div>
          </section>
        ) : null}

        {working.length ? (
          <section>
            <h2 className="readout mb-2 flex items-center gap-1.5">
              <span className="h-1.5 w-1.5 rounded-full bg-info" aria-hidden="true" />
              {BUCKET_LABELS.working}
              <span className="font-mono text-inkdim/60">{working.length}</span>
            </h2>
            <div className="flex flex-col gap-2">
              {working.map((c, i) => (
                <div key={c.id} className="rise" style={stagger(i)}>
                  <WorkOrderCard card={c} onSelect={() => onSelect(c.id)} />
                </div>
              ))}
            </div>
          </section>
        ) : null}
      </div>

      {closed.length ? (
        <details className="mt-10">
          <summary className="readout">{UI.closedDrawer} · {closed.length}</summary>
          {/* WO-0031c / B4: the closed drawer used to fade the whole column (opacity-60 ≈2.9:1 on the
              reason line — AA fail). The quiet card keeps every line readable; the drawer whispers by
              structure, not by contrast theft. */}
          <div className="mt-2 flex flex-col gap-2">
            {closed.map((c) => (
              <WorkOrderCard key={c.id} card={c} onSelect={() => onSelect(c.id)} quiet />
            ))}
          </div>
        </details>
      ) : null}
    </div>
  );
}
