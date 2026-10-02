// components/board-kanban.tsx — the Kanban track (U-18, L-8): the columns side by side in one
// horizontal scroller that snaps to column starts and fades at whichever edge still has columns
// beyond it. The fades are the wrapper's own pseudo-elements, always present and shown by
// opacity, so the layout audit finds them while the columns overflow. Opening the done column —
// the last one — scrolls it into view.
import { useEffect, useRef, useState } from 'react';
import type { Locale } from '../labels/t';
import type { KanbanColumn } from '../stores/board';
import { BoardColumnLane } from './board-column';

const EDGE_SLACK_PX = 2;

const FADE_BASE =
  'before:pointer-events-none before:absolute before:bottom-2 before:left-0 before:top-0 before:z-10 before:w-12 before:bg-gradient-to-l before:from-transparent before:to-bg before:transition-opacity before:duration-[var(--motion-board-hover)] before:content-[""] ' +
  'after:pointer-events-none after:absolute after:bottom-2 after:right-0 after:top-0 after:z-10 after:w-12 after:bg-gradient-to-r after:from-transparent after:to-bg after:transition-opacity after:duration-[var(--motion-board-hover)] after:content-[""] ' +
  'motion-reduce:before:transition-none motion-reduce:after:transition-none';

export function BoardKanban({
  columns,
  locale,
  onOpenWorkOrder,
  onToggleColumn,
}: {
  readonly columns: readonly KanbanColumn[];
  readonly locale: Locale;
  readonly onOpenWorkOrder: (workOrderId: string) => void;
  readonly onToggleColumn: (key: string) => void;
}) {
  const scroller = useRef<HTMLDivElement>(null);
  const [edges, setEdges] = useState({ left: false, right: false });

  const measure = (): void => {
    const el = scroller.current;
    if (el === null) return;
    const next = {
      left: el.scrollLeft > EDGE_SLACK_PX,
      right: el.scrollLeft + el.clientWidth < el.scrollWidth - EDGE_SLACK_PX,
    };
    setEdges((prev) => (prev.left === next.left && prev.right === next.right ? prev : next));
  };

  useEffect(() => {
    const el = scroller.current;
    if (el === null) return;
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(el);
    return () => {
      observer.disconnect();
    };
  }, [columns]);

  // The done column opens off-screen at the end of the track: bring it in.
  const doneShut = columns.find((column) => column.kind === 'done')?.shut ?? true;
  const wasDoneShut = useRef(doneShut);
  useEffect(() => {
    const el = scroller.current;
    if (el !== null && wasDoneShut.current && !doneShut) {
      const calm = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
      el.scrollTo({ left: el.scrollWidth, behavior: calm ? 'auto' : 'smooth' });
    }
    wasDoneShut.current = doneShut;
  }, [doneShut]);

  return (
    <div
      data-board-kanban
      className={`relative flex min-h-[360px] min-w-0 flex-1 ${FADE_BASE} ${edges.left ? 'before:opacity-100' : 'before:opacity-0'} ${edges.right ? 'after:opacity-100' : 'after:opacity-0'}`}
    >
      <div
        ref={scroller}
        data-board-cols
        onScroll={measure}
        className="flex min-w-0 flex-1 snap-x snap-mandatory items-stretch gap-3 overflow-x-auto pb-2"
      >
        {columns.map((column) => (
          <BoardColumnLane key={column.key} column={column} locale={locale} onOpenWorkOrder={onOpenWorkOrder} onToggle={onToggleColumn} />
        ))}
      </div>
    </div>
  );
}
