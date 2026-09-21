import { useEffect, useRef, useState } from 'react';
import type { WorkOrderCardView } from '../../../core/types';
import type { WorkspaceBudgetView } from '../../../core/budget';
import { Button } from '../../kit';
import { useLabels } from '../../data/locale';
import { ClosedToggle } from './ClosedToggle';
import { WorkOrderCard } from './WorkOrderCard';

// The dispatch board (WO-0031 "Kontrol Konsolu" → WO-0031f): the two live queues sit side by side
// when there is room (≥1200px) and stack below it; the closed list sits behind the ONE toggle
// pattern on every surface (T1 — "▸ N kapalı iş", collapsed past five). A group with nothing in it
// is ABSENT (ADR-0012 r2): no empty frame, no dashed box, no count of zero.
//
// WO-0031f: ONE persistent root — the platform (all-done / awaiting-close / mixed) is a state of
// this tree, not an early return, so the all-done ARRIVAL can pulse once as a state transition
// (H-1: a state transition, never a mount — the ref only arms the pulse on a live flip, so loading
// straight into all-done stays calm). The all-done line carries the peron INVITATION (T2) — the
// r2 amendment's named case; the awaiting-close platform keeps exactly its one CTA.
type Platform = 'mixed' | 'awaiting' | 'alldone';
// The last platform THIS WORKSPACE's board was seen in — module state, so it survives the detail
// trip (the last close happens in the detail; the board you RETURN to is the arrival) and dies with
// the app (a reload arriving at all-done is calm, and so is a workspace's first-ever view).
const lastPlatformByWs = new Map<string, Platform>();
export function Board({
  cards,
  budget,
  onSelect,
}: {
  cards: WorkOrderCardView[];
  budget?: WorkspaceBudgetView; // WO-0047: workspace-scope — every card carries the same warn line
  onSelect: (id: WorkOrderCardView['id']) => void;
}) {
  const { BUCKET_LABELS, UI } = useLabels();
  const up = cards.filter((c) => c.bucket === 'up').sort((a, b) => a.actionRank - b.actionRank);
  const working = cards.filter((c) => c.bucket === 'working');
  const closed = cards.filter((c) => c.bucket === 'closed');
  // WO-0031e tur-3: the awaiting-close partition. A stopped_asking card never counts as closable
  // here — a permission ask outranks closure, the platform must not say "kapatılmayı bekliyor"
  // over an unanswered ask (deriveCardAction makes the same call for the ▸ line).
  const closableUp = up.filter((c) => c.closable && c.reason.kind !== 'stopped_asking');
  const otherUp = up.filter((c) => !c.closable || c.reason.kind === 'stopped_asking');

  // D1 (tur-2) / T1: only closed work orders → the "Bütün işler tamam" platform — a steady green
  // dot (no breathe — nothing waits on the operator), the closed cards behind the toggle, and the
  // inline invitation. Awaiting-close (tur-3): no live work left, one short line + ONE CTA.
  const platform: Platform =
    up.length === 0 && working.length === 0 && closed.length > 0
      ? 'alldone'
      : working.length === 0 && otherUp.length === 0 && closableUp.length > 0
        ? 'awaiting'
        : 'mixed';

  // H-1: the one green breath — the platform line re-keys ONCE when this workspace's board BECOMES
  // all-done (a live flip, or returning from the detail where the last close happened), ≤400ms, then
  // steady. First-ever sighting and same-state returns stay calm: the pulse is a transition, never
  // a mount.
  const wsKey = String(cards[0]?.workspace ?? 'empty');
  const [pulse, setPulse] = useState(0);
  useEffect(() => {
    const prev = lastPlatformByWs.get(wsKey);
    if (prev !== undefined && prev !== 'alldone' && platform === 'alldone') {
      setPulse((n) => n + 1);
    }
    lastPlatformByWs.set(wsKey, platform);
  }, [platform, wsKey]);

  // H-3: the entrance glide fires for the FIRST batch only — cards appended later (a live close
  // arriving, a create) mount motionless; re-renders never restart a completed animation.
  const firstBatch = useRef<Set<string> | null>(null);
  if (firstBatch.current === null) firstBatch.current = new Set(cards.map((c) => c.id));
  const glide = (i: number, id: string): { animationDelay: string } | undefined =>
    i < 12 && firstBatch.current?.has(id) ? { animationDelay: `${i * 30}ms` } : undefined;

  return (
    <div
      {...(platform === 'alldone' ? { 'data-board-all-done': '' } : platform === 'awaiting' ? { 'data-board-awaiting-close': '' } : {})}
    >
      {platform === 'alldone' ? (
        <>
          <div key={pulse} className={`flex items-center gap-2${pulse > 0 ? ' pulse-once' : ''}`}>
            <span className="h-1.5 w-1.5 rounded-full bg-proceed" aria-hidden="true" />
            <p className="readout text-proceed">{UI.boardAllDone}</p>
            {/* WO-0086 (operator): the platform line is the SENTENCE alone — creation's single owner
                is the appbar's global ＋ CTA; the line's own button was a second owner. */}
          </div>
          <ClosedToggle count={closed.length}>
            {closed.map((c) => (
              <WorkOrderCard key={c.id} card={c} budget={budget} onSelect={() => onSelect(c.id)} quiet />
            ))}
          </ClosedToggle>
        </>
      ) : platform === 'awaiting' ? (
        <>
          <div className="flex items-center gap-2">
            <span className="h-1.5 w-1.5 rounded-full bg-signal" aria-hidden="true" />
            <p className="readout text-signal">{UI.boardAwaitingClose(closableUp.length)}</p>
            <Button variant="secondary" size="sm" className="ml-2" onClick={() => onSelect(closableUp[0]!.id)}>
              {UI.boardCloseCta}
            </Button>
          </div>
          <div className="mt-4 flex flex-col gap-2">
            {closableUp.map((c) => (
              <WorkOrderCard key={c.id} card={c} budget={budget} onSelect={() => onSelect(c.id)} />
            ))}
          </div>
          {closed.length > 0 ? (
            <ClosedToggle count={closed.length}>
              {closed.map((c) => (
                <WorkOrderCard key={c.id} card={c} budget={budget} onSelect={() => onSelect(c.id)} quiet />
              ))}
            </ClosedToggle>
          ) : null}
        </>
      ) : (
        <>
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
                    <div key={c.id} className="glide" style={glide(i, c.id)}>
                      <WorkOrderCard card={c} budget={budget} onSelect={() => onSelect(c.id)} />
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
                    <div key={c.id} className="glide" style={glide(i, c.id)}>
                      <WorkOrderCard card={c} budget={budget} onSelect={() => onSelect(c.id)} />
                    </div>
                  ))}
                </div>
              </section>
            ) : null}
          </div>

          {closed.length > 0 ? (
            <ClosedToggle count={closed.length}>
              {closed.map((c) => (
                <WorkOrderCard key={c.id} card={c} budget={budget} onSelect={() => onSelect(c.id)} quiet />
              ))}
            </ClosedToggle>
          ) : null}
        </>
      )}
    </div>
  );
}
