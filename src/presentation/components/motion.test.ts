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
});
