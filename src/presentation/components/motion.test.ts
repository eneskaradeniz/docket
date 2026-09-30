// components/motion.test.ts — the motion constants' own invariants: the palette must leave
// quicker than it arrives, and the row stagger must cap at six rows so a long list does not
// cascade in one row at a time.
import { describe, expect, it } from 'vitest';

import { MOTION } from './motion';

describe('MOTION', () => {
  it('closes quicker than it opens', () => {
    expect(MOTION.close.panelMs).toBeLessThan(MOTION.open.panelMs);
    expect(MOTION.close.panelMs + MOTION.close.backdropDelayMs).toBeLessThan(
      MOTION.open.panelMs + MOTION.open.panelDelayMs,
    );
  });

  it('staggers the first six rows and no more', () => {
    expect(MOTION.results.staggerRows).toBe(6);
    expect(MOTION.results.staggerMs).toBeGreaterThan(0);
  });

  it('settles the results behind a 120ms debounce and drops rows in 160ms', () => {
    expect(MOTION.results.debounceMs).toBe(120);
    expect(MOTION.results.rowExitMs).toBe(160);
    // A row finishes folding before the container's own height leg drags on.
    expect(MOTION.results.rowExitMs).toBeLessThan(MOTION.results.heightMs);
    // Ghost rows leave the DOM only once their exit has surely ended.
    expect(MOTION.results.rowExitRemoveMs).toBeGreaterThan(MOTION.results.rowExitMs);
  });

  it('entering rows rise six pixels; the keyboard highlight moves at its own shorter pace', () => {
    expect(MOTION.results.risePx).toBe(6);
    expect(MOTION.results.highlightMs).toBe(120);
    expect(MOTION.results.highlightMs).toBeLessThan(MOTION.results.fadeMs);
  });

  it('the board answers hover quicker than a column folds', () => {
    expect(MOTION.board.hoverMs).toBeLessThan(MOTION.board.columnMs);
    expect(MOTION.board.pulseMs).toBeGreaterThan(MOTION.board.columnMs);
  });
});
