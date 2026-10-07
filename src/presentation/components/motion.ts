// components/motion.ts — the shell's motion numbers in one place: every duration, delay,
// distance and easing the search palette animates with (the settings panel joins here later),
// so retuning is a one-line change. The component pipes these into CSS custom properties on
// the overlay's root; the reduced-motion standings stay opacity-only and short.
import type { CSSProperties } from 'react';

export const MOTION = {
  open: {
    backdropMs: 320,
    panelMs: 380,
    // The panel follows the backdrop by a beat — the ease lands in two steps, not one.
    panelDelayMs: 90,
    risePx: 12,
    scaleFrom: 0.97,
    easing: 'cubic-bezier(0.22, 1, 0.36, 1)',
  },
  close: {
    // The panel leaves first; the scrim follows it out.
    panelMs: 220,
    backdropDelayMs: 60,
  },
  results: {
    heightMs: 280,
    // The opacity legs of the results area — the listbox's fold and each row's fade.
    fadeMs: 180,
    staggerMs: 25,
    // The first six rows stagger in; the rest appear with the sixth.
    staggerRows: 6,
    // The results settle this long after the last keystroke — the input itself never waits.
    debounceMs: 120,
    // A row that leaves folds and fades away on this leg; the container's height follows it.
    rowExitMs: 160,
    // Ghost rows leave the DOM only past their exit's end, so the fold always finishes first.
    rowExitRemoveMs: 220,
    // An entering row rises this far on its way in.
    risePx: 6,
    // The keyboard highlight's own pace — quicker than any row leg, so it never lags a move.
    highlightMs: 120,
  },
  // The Kanban board: hover/focus and the edge fades answer quickly, a column folding takes a
  // little longer, a running lamp breathes slowly.
  board: {
    hoverMs: 160,
    columnMs: 200,
    pulseMs: 1800,
  },
  // The info bubble's fade (U-27); under reduced motion it has none.
  bubble: {
    fadeMs: 120,
  },
  reducedMs: 80,
  // The loading skeletons' anti-flicker numbers (U-26): a load faster than the delay never
  // flashes one, and a shown skeleton holds for its minimum show even if the reply races in.
  skeleton: {
    delayMs: 150,
    minShowMs: 300,
  },
  // The Hesaplar scan's numbers (U-52): the skeleton shows at once and holds at least this long,
  // then the groups enter in order, this far apart, each fading in over the fade with its rise.
  scan: {
    minShowMs: 400,
    staggerMs: 40,
    fadeMs: 160,
    risePx: 8,
  },
} as const;

/** The same numbers as CSS custom properties, computed once and set on the overlay's root:
 *  the animation classes consume them, and the motion-reduce variants override the consumed
 *  properties wholesale — a slower tune must never slow the reduced standings. */
export const motionVars = (): CSSProperties =>
  ({
    '--motion-ease': MOTION.open.easing,
    '--motion-open-backdrop': `${MOTION.open.backdropMs}ms`,
    '--motion-open-panel': `${MOTION.open.panelMs}ms`,
    '--motion-open-panel-delay': `${MOTION.open.panelDelayMs}ms`,
    '--motion-open-rise': `${MOTION.open.risePx}px`,
    '--motion-open-scale': `${MOTION.open.scaleFrom}`,
    '--motion-close': `${MOTION.close.panelMs}ms`,
    '--motion-close-backdrop-delay': `${MOTION.close.backdropDelayMs}ms`,
    '--motion-results': `${MOTION.results.heightMs}ms`,
    '--motion-results-fade': `${MOTION.results.fadeMs}ms`,
    '--motion-row-exit': `${MOTION.results.rowExitMs}ms`,
    '--motion-row-rise': `${MOTION.results.risePx}px`,
    '--motion-highlight': `${MOTION.results.highlightMs}ms`,
    // Rows carry no stagger delay unless they are entering — the class consumes this default.
    '--row-delay': '0ms',
    '--motion-reduced': `${MOTION.reducedMs}ms`,
  }) as CSSProperties;

/** The board's motion numbers as CSS custom properties, set once on the board's root. */
export const boardMotionVars = (): CSSProperties =>
  ({
    '--motion-board-hover': `${MOTION.board.hoverMs}ms`,
    '--motion-board-column': `${MOTION.board.columnMs}ms`,
    '--motion-board-pulse': `${MOTION.board.pulseMs}ms`,
    '--motion-ease': MOTION.open.easing,
  }) as CSSProperties;
