import type { WorkOrderCardView } from '../../../core/types';
import { Button } from '../../kit';
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
  // WO-0031e tur-3: the awaiting-close partition. A stopped_asking card never counts as closable
  // here — a permission ask outranks closure, the platform must not say "kapatılmayı bekliyor"
  // over an unanswered ask (deriveCardAction makes the same call for the ▸ line).
  const closableUp = up.filter((c) => c.closable && c.reason.kind !== 'stopped_asking');
  const otherUp = up.filter((c) => !c.closable || c.reason.kind === 'stopped_asking');
  const stagger = (i: number): { animationDelay: string } | undefined =>
    i < 12 ? { animationDelay: `${i * 30}ms` } : undefined;

  // D1 (tur-2): a board with ONLY closed work orders is the "Bütün işler tamam" platform — a steady
  // green dot (no breathe — nothing waits on the operator), the quiet cards OPEN in one column (no
  // drawer to dig through), no body CTA (the appbar already carries it), calm on mount.
  if (up.length === 0 && working.length === 0 && closed.length > 0) {
    return (
      <div data-board-all-done="">
        <div className="flex items-center gap-2">
          <span className="h-1.5 w-1.5 rounded-full bg-proceed" aria-hidden="true" />
          <p className="readout text-proceed">{UI.boardAllDone}</p>
        </div>
        <div className="mt-4 flex flex-col gap-2">
          {closed.map((c) => (
            <WorkOrderCard key={c.id} card={c} onSelect={() => onSelect(c.id)} quiet />
          ))}
        </div>
      </div>
    );
  }

  // WO-0031e tur-3: the awaiting-close platform — no live work left (no working, nothing in `up`
  // that is not closable). One short line + exactly ONE CTA (ADR-0012 r2): the line names the
  // count, the CTA opens the first closable detail where the Kapat card lives. Closable cards
  // stay actionable (never quiet — they are the work); closed cards rest quietly below. The dot
  // breathes nothing — but it is signal-colored: this platform DOES wait on the operator.
  if (working.length === 0 && otherUp.length === 0 && closableUp.length > 0) {
    return (
      <div data-board-awaiting-close="">
        <div className="flex items-center gap-2">
          <span className="h-1.5 w-1.5 rounded-full bg-signal" aria-hidden="true" />
          <p className="readout text-signal">{UI.boardAwaitingClose(closableUp.length)}</p>
          <Button variant="secondary" size="sm" className="ml-2" onClick={() => onSelect(closableUp[0].id)}>
            {UI.boardCloseCta}
          </Button>
        </div>
        <div className="mt-4 flex flex-col gap-2">
          {closableUp.map((c) => (
            <WorkOrderCard key={c.id} card={c} onSelect={() => onSelect(c.id)} />
          ))}
        </div>
        {closed.length > 0 ? (
          <div className="mt-4 flex flex-col gap-2">
            {closed.map((c) => (
              <WorkOrderCard key={c.id} card={c} onSelect={() => onSelect(c.id)} quiet />
            ))}
          </div>
        ) : null}
      </div>
    );
  }

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
