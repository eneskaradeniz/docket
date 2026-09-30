// stores/skeleton-phase.test.ts — the anti-flicker rule as a pure function (U-26): a skeleton
// never flashes on a fast load, appears only past the delay, and once shown holds for its
// minimum show. Time is injected, so every boundary is a plain number.
import { describe, expect, it } from 'vitest';

import { MOTION } from '../components/motion';
import { skeletonPhase } from './skeleton-phase';

describe('skeletonPhase', () => {
  it('a fast load never shows the skeleton: before the delay, and gone once loading ends', () => {
    // Loading since 1000; the reply lands at 1100 — well inside the 150ms delay.
    expect(skeletonPhase(1000, 1050, null).visible).toBe(false);
    expect(skeletonPhase(1000, 1099, null).visible).toBe(false);
    expect(skeletonPhase(null, 1100, null).visible).toBe(false);
  });

  it('a slow load shows the skeleton exactly at the delay boundary, not a moment earlier', () => {
    expect(skeletonPhase(1000, 1000 + MOTION.skeleton.delayMs - 1, null).visible).toBe(false);
    const at = skeletonPhase(1000, 1000 + MOTION.skeleton.delayMs, null);
    expect(at.visible).toBe(true);
    // The stamp it hands back is the moment it first showed, not the caller's earlier null.
    expect(at.shownSince).toBe(1000 + MOTION.skeleton.delayMs);
  });

  it('content that arrives 200ms into the display keeps the skeleton until the minimum show ends', () => {
    const shownSince = 1150;
    // Still loading: visible with the stamp carried through untouched.
    const loading = skeletonPhase(1000, 1200, shownSince);
    expect(loading).toEqual({ visible: true, shownSince });
    // Loading ended at 1350 (200ms into the display); the tail holds the skeleton past it.
    expect(skeletonPhase(null, 1350, shownSince).visible).toBe(true);
    expect(skeletonPhase(null, shownSince + MOTION.skeleton.minShowMs - 1, shownSince).visible).toBe(true);
    // One tick past the minimum show the skeleton is gone and the stamp resets.
    expect(skeletonPhase(null, shownSince + MOTION.skeleton.minShowMs, shownSince)).toEqual({
      visible: false,
      shownSince: null,
    });
  });

  it('a second load that starts inside the old show\'s tail still honours the minimum show', () => {
    const shownSince = 1150;
    // The reload began at 1300; at 1320 the new load is inside its delay, but the old show's
    // minimum (until 1450) keeps the skeleton up rather than blinking it away.
    expect(skeletonPhase(1300, 1320, shownSince).visible).toBe(true);
    // Past the minimum, still inside the new delay: hidden again until the new delay elapses.
    expect(skeletonPhase(1300, 1440, shownSince).visible).toBe(false);
    expect(skeletonPhase(1300, 1300 + MOTION.skeleton.delayMs, shownSince).visible).toBe(true);
  });

  it('an idle screen (never loading, never shown) stays hidden', () => {
    expect(skeletonPhase(null, 5000, null)).toEqual({ visible: false, shownSince: null });
  });
});
