// components/drag-order-list.tsx — the DragOrderList (U-41): rows with a grip, the position number,
// the provider mark, a label and a sub-line. A pointer drag moves a row and the others slide to
// their slots; Alt+↑/↓ moves the focused row; every move is announced "n. sıraya taşındı" through
// a live region. The geometry and the key rules are the pure functions of stores/drag-order.ts.
// The list reports a finished move once (`onReorder`) — on drop, or at once for a key — so a host
// that saves on every report saves once per move, not once per slot crossed.
import { useRef, useState, type ReactNode } from 'react';

import { t, type Locale } from '../labels/t';
import {
  DRAG_ROW_HEIGHT,
  DRAG_THRESHOLD,
  dragTop,
  keyboardMove,
  listHeight,
  moveAnnouncement,
  moveItem,
  slotAt,
  slotTop,
} from '../stores/drag-order';
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

interface Drag {
  readonly id: string;
  readonly startY: number;
  readonly startTop: number;
  readonly moved: boolean;
  readonly top: number;
}

export function DragOrderList({ locale, items, markFor, onReorder, label }: DragOrderListProps) {
  const ids = items.map((item) => item.id);
  // While a row is dragged the list shows its own provisional order; the host hears of it on drop.
  const [provisional, setProvisional] = useState<readonly string[] | null>(null);
  const [drag, setDrag] = useState<Drag | null>(null);
  const [announcement, setAnnouncement] = useState('');
  const dragRef = useRef<Drag | null>(null);
  const order = provisional ?? ids;
  const byId = new Map(items.map((item) => [item.id, item]));

  const announce = (index: number): void => {
    setAnnouncement('');
    window.setTimeout(() => setAnnouncement(moveAnnouncement(t(locale, 'dragOrder.moved'), index)), 30);
  };

  const setDragState = (next: Drag | null): void => {
    dragRef.current = next;
    setDrag(next);
  };

  const endDrag = (id: string): void => {
    const current = dragRef.current;
    if (current === null || current.id !== id) return;
    setDragState(null);
    if (provisional === null) return;
    const from = ids.indexOf(id);
    const to = provisional.indexOf(id);
    setProvisional(null);
    if (from !== to) {
      onReorder(id, to);
      announce(to);
    }
  };

  return (
    <div>
      <div role="list" aria-label={label} className="relative" style={{ height: listHeight(order.length) }} data-drag-order="">
        {order.map((id, index) => {
          const item = byId.get(id);
          if (item === undefined) return null;
          const dragging = drag !== null && drag.moved && drag.id === id;
          const top = dragging && drag !== null ? drag.top : slotTop(index);
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
                onReorder(id, next.indexOf(id));
                announce(next.indexOf(id));
              }}
              onPointerDown={(event) => {
                if (event.button !== 0) return;
                event.currentTarget.setPointerCapture(event.pointerId);
                setDragState({ id, startY: event.clientY, startTop: slotTop(order.indexOf(id)), moved: false, top: slotTop(order.indexOf(id)) });
              }}
              onPointerMove={(event) => {
                const current = dragRef.current;
                if (current === null || current.id !== id) return;
                const travel = event.clientY - current.startY;
                if (!current.moved && Math.abs(travel) < DRAG_THRESHOLD) return;
                const nextTop = dragTop(current.startTop, travel, order.length);
                setDragState({ ...current, moved: true, top: nextTop });
                const moved = moveItem(order, order.indexOf(id), slotAt(nextTop, order.length));
                if (moved !== null) setProvisional(moved);
              }}
              onPointerUp={() => endDrag(id)}
              onPointerCancel={() => endDrag(id)}
              style={{ top, height: DRAG_ROW_HEIGHT, touchAction: 'none' }}
              className={`absolute inset-x-0 flex select-none items-center gap-3 rounded-card border bg-surface pl-2 pr-3.5 outline-none focus-visible:border-signal ${
                dragging
                  ? 'z-[5] border-signal shadow-2xl transition-[box-shadow,border-color]'
                  : 'border-hairline transition-[top,box-shadow,border-color] duration-[180ms] hover:border-bord motion-reduce:transition-none'
              }`}
            >
              <span aria-hidden="true" className="grid h-[34px] w-[22px] flex-none place-items-center rounded-control text-inkdim hover:bg-raised hover:text-ink">
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
        {announcement}
      </div>
    </div>
  );

}
