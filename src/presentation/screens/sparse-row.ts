// screens/sparse-row.ts — the sparse-row decision (U-56): a row whose items all fit on one line
// keeps its cards at their natural minimum on the left and gives the leftover width to a 1fr side
// panel (the cockpit's attention and running rows take "Son kapananlar" and "Sırada" as theirs);
// narrower, the cards fill the row themselves through U-55's auto-fill minimum. CSS cannot count
// elements, so the decision is this one pure helper — never a per-screen hand-tuned grid — and
// the hook below feeds it the row's measured width and the live rem scale, the way the scale
// itself stays in CSS (U-53): only the width is observed, never written back as style.
import { useEffect, useState } from 'react';

/** A row card's minimum (U-55): 21.25 rem at the live root scale. */
export const ROW_CARD_MIN_REM = 21.25;
/** The gap between a row's cards, and between the cards and their panel: the prototype's 1 rem. */
export const ROW_GAP_REM = 1;

export interface SparseRowPlan {
  /** The card columns the row lays out: the items' own count when they fit on one line with
   *  room to spare, otherwise the width's own auto-fill count (informational — the fill grid
   *  derives its tracks itself). */
  readonly columns: number;
  /** Whether the leftover width goes to a 1fr side panel beside the cards. */
  readonly panel: boolean;
}

/** The sparse-row decision (U-56), pure: the item count, the row's width in px, the minimum
 *  card width in px and the gap in px. Items fit "with room to spare" when the leftover after
 *  their minimum line holds at least one more full card minimum — a few spare pixels are not a
 *  panel. */
export const sparseRowPlan = (count: number, containerPx: number, minCardPx: number, gapPx: number): SparseRowPlan => {
  if (count <= 0 || minCardPx <= 0) return { columns: 0, panel: false };
  const perLine = Math.floor((containerPx + gapPx) / (minCardPx + gapPx));
  if (perLine <= 0) return { columns: 0, panel: false };
  if (count > perLine) return { columns: perLine, panel: false };
  const leftover = containerPx - (count * minCardPx + (count - 1) * gapPx);
  if (leftover < minCardPx) return { columns: perLine, panel: false };
  return { columns: count, panel: true };
};

/** The row's class half: the fill grid when the decision is fill — U-55's auto-fill with the
 *  21.25 rem minimum, so a full row spans edge to edge at every width. */
export const sparseRowClass = (plan: SparseRowPlan): string =>
  plan.panel ? 'grid gap-4' : 'grid gap-4 grid-cols-[repeat(auto-fill,minmax(21.25rem,1fr))]';

/** The row's inline half: the plan's own columns at their natural minimum, then the 1fr panel
 *  track. Undefined when the row fills, so the class half owns that case. */
export const sparseRowStyle = (plan: SparseRowPlan): { readonly gridTemplateColumns: string } | undefined =>
  plan.panel ? { gridTemplateColumns: `repeat(${plan.columns}, ${ROW_CARD_MIN_REM}rem) minmax(0,1fr)` } : undefined;

export interface SparseRow {
  /** Goes on the row element itself — the width the decision reads is the row's own. A callback
   *  ref, so a row that mounts late (an empty section's first item arriving) gets its observer
   *  too, not only the rows that stood there on the first render. */
  readonly ref: (instance: HTMLDivElement | null) => void;
  /** The decision for the current count and width; fill until the first measure lands. */
  readonly plan: SparseRowPlan;
}

/** The row's measured width and the live rem scale, kept current through a ResizeObserver; the
 *  plan rides the pure helper. Without an observer (static render) the row stays in fill mode. */
export function useSparseRow(count: number): SparseRow {
  const [el, setEl] = useState<HTMLDivElement | null>(null);
  const [measured, setMeasured] = useState<{ readonly width: number; readonly rem: number } | null>(null);
  useEffect(() => {
    if (el === null || typeof ResizeObserver === 'undefined') return;
    const read = (): void => {
      const rem = parseFloat(getComputedStyle(document.documentElement).fontSize);
      setMeasured({ width: el.clientWidth, rem: Number.isFinite(rem) && rem > 0 ? rem : 16 });
    };
    read();
    const observer = new ResizeObserver(read);
    observer.observe(el);
    return () => observer.disconnect();
  }, [el]);
  const plan =
    measured === null
      ? { columns: 0, panel: false }
      : sparseRowPlan(count, measured.width, ROW_CARD_MIN_REM * measured.rem, ROW_GAP_REM * measured.rem);
  return { ref: setEl, plan };
}
