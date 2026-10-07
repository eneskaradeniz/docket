// components/drag-order-list.tsx — the DragOrderList (U-41, U-47): rows with a grip, the position
// number, the provider mark, a label and a sub-line. The grip is the only handle: it captures
// the pointer, the held row lifts (shadow, amber outline, a hair of scale) and centres under the
// pointer, the other rows slide open (160 ms ease-out) and the row settles on release (140 ms);
// near the scroller's edge the list scrolls itself, and the row keeps its place while it does.
// Alt+↑/↓ moves the focused row with the same slide; every move is announced "n. sıraya
// taşındı" through a live region. The geometry is the pure functions of stores/drag-order.ts;
// what renders during a drag is the session store of stores/drag-session.ts, read through one
// cached snapshot per change. The list reports a finished move once (`onReorder`) — on drop, or
// at once for a key — so a host that saves on every report saves once per move, not once per
// slot crossed.
import { useEffect, useRef, useState, useSyncExternalStore, type ReactNode } from 'react';

import { t, type Locale } from '../labels/t';
import {
  autoScrollStep,
  DRAG_ROW_HEIGHT,
  keyboardMove,
  listHeight,
  moveAnnouncement,
  moveItem,
  slotTop,
} from '../stores/drag-order';
import { createDragSession, type DragSessionStore } from '../stores/drag-session';
import { ProviderMark, type ProviderMarkProps } from './provider-mark';

export interface DragOrderItem {
  readonly id: string;
  readonly markKey: string | null;
  /** The row's main line, resolved ("Provider · account"). */
  readonly label: string;
  /** The line under it, resolved. */
  readonly sub: string;
  /** A trailing element (a status lamp), or nothing. */
  readonly trailing?: ReactNode;
}

export interface DragOrderListProps {
  readonly locale: Locale;
  readonly items: readonly DragOrderItem[];
  readonly markFor: (provider: string) => ProviderMarkProps['mark'];
  /** The item at `id` now holds slot `index` (0-based). */
  readonly onReorder: (id: string, index: number) => void;
  /** The list's accessible name. */
  readonly label: string;
  /** A drag session to render through; a list that passes none runs its own. */
  readonly session?: DragSessionStore;
}

const Grip = () => (
  <svg viewBox="0 0 12 16" aria-hidden="true" className="h-4 w-3" fill="currentColor">
    <circle cx="3.5" cy="3" r="1.3" />
    <circle cx="8.5" cy="3" r="1.3" />
    <circle cx="3.5" cy="8" r="1.3" />
    <circle cx="8.5" cy="8" r="1.3" />
    <circle cx="3.5" cy="13" r="1.3" />
    <circle cx="8.5" cy="13" r="1.3" />
  </svg>
);

export function DragOrderList({ locale, items, markFor, onReorder, label, session }: DragOrderListProps) {
  const ids = items.map((item) => item.id);
  const [ownSession] = useState(createDragSession);
  const store = session ?? ownSession;
  const live = useSyncExternalStore(store.subscribe, store.state, store.state);
  // While a row is dragged the list shows its own provisional order; the host hears of it on drop.
  const order = live.order ?? ids;
  const byId = new Map(items.map((item) => [item.id, item]));

  const listRef = useRef<HTMLDivElement | null>(null);
  const heldRef = useRef<string | null>(null);
  const pointerYRef = useRef(0);
  const scrollRafRef = useRef(0);

  const stopAutoScroll = (): void => {
    if (scrollRafRef.current === 0) return;
    cancelAnimationFrame(scrollRafRef.current);
    scrollRafRef.current = 0;
  };

  // The list scrolls itself while the pointer sits near the scroller's edge — and keeps placing
  // the held row, because the list moves under a still pointer too.
  const autoScrollTick = (): void => {
    scrollRafRef.current = 0;
    const id = heldRef.current;
    if (id === null) return;
    const scroller = listRef.current?.closest('[data-window-body]');
    const bounds = scroller?.getBoundingClientRect();
    if (scroller === null || scroller === undefined || bounds === undefined) return;
    const step = autoScrollStep(pointerYRef.current, bounds.top, bounds.bottom);
    if (step === 0) return;
    scroller.scrollTop += step;
    const listTop = listRef.current?.getBoundingClientRect().top;
    if (listTop !== undefined) store.track(id, pointerYRef.current, listTop);
    scrollRafRef.current = requestAnimationFrame(autoScrollTick);
  };

  // A list that unmounts mid-drag must not leave a frame loop pointing at dead nodes.
  useEffect(() => () => stopAutoScroll(), []);

  const release = (id: string): void => {
    heldRef.current = null;
    stopAutoScroll();
    const result = store.end(id);
    if (result === null || !result.moved) return;
    onReorder(id, result.to);
    store.announce(moveAnnouncement(t(locale, 'dragOrder.moved'), result.to));
  };

  return (
    <div>
      <div
        ref={listRef}
        role="list"
        aria-label={label}
        className="relative"
        style={{ height: listHeight(order.length) }}
        data-drag-order=""
      >
        {order.map((id, index) => {
          const item = byId.get(id);
          if (item === undefined) return null;
          const held = live.heldId === id && live.lifted;
          const settling = live.settlingId === id;
          const top = held ? live.top : slotTop(index);
          return (
            <div
              key={id}
              role="listitem"
              tabIndex={0}
              aria-label={`${index + 1}. ${item.label}`}
              data-drag-row={id}
              onKeyDown={(event) => {
                const by = keyboardMove(event);
                if (by === null) return;
                event.preventDefault();
                const next = moveItem(ids, ids.indexOf(id), ids.indexOf(id) + by);
                if (next === null) return;
                const to = next.indexOf(id);
                onReorder(id, to);
                store.announce(moveAnnouncement(t(locale, 'dragOrder.moved'), to));
              }}
              style={{ top, height: DRAG_ROW_HEIGHT }}
              className={
                held
                  ? 'absolute inset-x-0 z-[5] flex select-none items-center gap-3 rounded-card border border-signal bg-surface pl-2 pr-3.5 shadow-2xl scale-[1.01] outline-none transition-[transform,box-shadow,border-color] ease-out duration-[140ms] motion-reduce:transition-none'
                  : settling
                    ? 'absolute inset-x-0 flex select-none items-center gap-3 rounded-card border border-hairline bg-surface pl-2 pr-3.5 outline-none transition-[top,transform,box-shadow,border-color] ease-out duration-[140ms] motion-reduce:transition-none'
                    : 'absolute inset-x-0 flex select-none items-center gap-3 rounded-card border border-hairline bg-surface pl-2 pr-3.5 outline-none transition-[top] ease-out duration-[160ms] hover:border-bord focus-visible:border-signal motion-reduce:transition-none'
              }
            >
              <span
                aria-hidden="true"
                data-drag-grip=""
                className="grid h-[34px] w-[22px] flex-none touch-none place-items-center rounded-control text-inkdim hover:bg-raised hover:text-ink"
                onPointerDown={(event) => {
                  if (event.button !== 0) return;
                  // The grip owns the pointer from the first press: capture keeps the moves coming
                  // even after the pointer leaves the grip, the row or the window.
                  event.currentTarget.setPointerCapture(event.pointerId);
                  (event.currentTarget.closest('[role="listitem"]') as HTMLElement | null)?.focus({ preventScroll: true });
                  heldRef.current = id;
                  pointerYRef.current = event.clientY;
                  store.begin(id, ids, event.clientY);
                }}
                onPointerMove={(event) => {
                  if (heldRef.current !== id) return;
                  event.preventDefault();
                  pointerYRef.current = event.clientY;
                  const listTop = listRef.current?.getBoundingClientRect().top;
                  if (listTop !== undefined) store.track(id, event.clientY, listTop);
                  if (scrollRafRef.current === 0) scrollRafRef.current = requestAnimationFrame(autoScrollTick);
                }}
                onPointerUp={() => release(id)}
                onPointerCancel={() => release(id)}
              >
                <Grip />
              </span>
              <span className={`w-[18px] flex-none text-right font-mono text-[13px] ${index === 0 ? 'text-signal-soft' : 'text-inkdim'}`}>{index + 1}</span>
              <span className="grid h-[26px] w-[26px] flex-none place-items-center rounded-control border border-hairline bg-raised text-ink">
                <ProviderMark provider={item.markKey ?? ''} mark={item.markKey === null ? null : markFor(item.markKey)} size={15} />
              </span>
              <span className="min-w-0 flex-1">
                <span className="block truncate text-[13.5px] font-bold text-ink">{item.label}</span>
                <span className="block truncate text-[12.5px] text-inkdim">{item.sub}</span>
              </span>
              {item.trailing}
            </div>
          );
        })}
      </div>
      <div role="status" aria-live="polite" className="absolute h-px w-px overflow-hidden [clip:rect(0,0,0,0)]">
        {live.announcement}
      </div>
    </div>
  );
}
