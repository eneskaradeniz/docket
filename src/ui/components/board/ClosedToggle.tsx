import { useState, type ReactNode } from 'react';
import { useLabels } from '../../data/locale';

// The closed-list toggle (WO-0031f T1) — ONE pattern on all three board surfaces (the mixed board's
// tail, the awaiting-close platform's tail, the all-done list): a real button with aria-expanded,
// "▸ N kapalı iş" with the arrow flipping, collapsed by default once the list passes five. The old
// `<details>` drawer (and its native summary semantics) dies with this — one component, one language.
export function ClosedToggle({ count, children }: { count: number; children: ReactNode }) {
  const { UI } = useLabels();
  const [open, setOpen] = useState(count <= 5); // >5 → starts collapsed (the operator's ruling)
  return (
    <div className="mt-5">
      <button
        type="button"
        data-closed-toggle={count}
        aria-expanded={open}
        onClick={() => setOpen((o) => !o)}
        className="closedtoggle"
      >
        <span className="arr" aria-hidden="true">{open ? '▾' : '▸'}</span>
        <span className="n">{count}</span> {UI.closedToggleWord}
      </button>
      {open ? <div className="mt-2 flex flex-col gap-2">{children}</div> : null}
    </div>
  );
}
