// components/skeleton.test.ts — the primitive's pure facts (U-26): the sweep's style sheet is
// the single home of the shimmer numbers, so the strings are asserted, not re-derived. (The
// component itself renders; the vitest suite runs node-only, so the DOM side is covered by the
// layout audit's --slow run.)
import { describe, expect, it } from 'vitest';

import { MOTION } from './motion';
import { SKELETON_STYLE_CSS, SHIMMER_PERIOD_MS } from './skeleton';

describe('skeleton primitive', () => {
  it('U-26: the crest sweeps left→right every 1.4s, ease-in-out, forever', () => {
    expect(SHIMMER_PERIOD_MS).toBe(1400);
    expect(SKELETON_STYLE_CSS).toContain(`animation: docket-skeleton-sweep ${SHIMMER_PERIOD_MS}ms ease-in-out infinite`);
  });

  it('U-26: the sweep is one seamless tile — the background slides exactly one tile per period', () => {
    expect(SKELETON_STYLE_CSS).toContain('background-size: 200% 100%');
    expect(SKELETON_STYLE_CSS).toContain('from { background-position: 0% 0; }');
    expect(SKELETON_STYLE_CSS).toContain('to { background-position: -200% 0; }');
  });

  it('U-26: the block fills with the raised tone and a slightly lighter crest', () => {
    expect(SKELETON_STYLE_CSS).toContain('var(--raised) 32%');
    expect(SKELETON_STYLE_CSS).toContain('color-mix(in srgb, var(--raised) 80%, #fff) 50%');
  });

  it('U-26: prefers-reduced-motion freezes the sweep — a static placeholder, no animation', () => {
    const reduced = SKELETON_STYLE_CSS.slice(SKELETON_STYLE_CSS.indexOf('@media (prefers-reduced-motion'));
    expect(reduced).toContain('animation: none');
  });

  it('U-26: the anti-flicker numbers the hook leans on are the motion book\'s own', () => {
    expect(MOTION.skeleton.delayMs).toBe(150);
    expect(MOTION.skeleton.minShowMs).toBe(300);
  });
});
