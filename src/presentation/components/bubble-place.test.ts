// components/bubble-place.test.ts — the info bubble's placement as a pure function (U-27).
import { describe, expect, it } from 'vitest';

import { placeBubble, type Rect } from './bubble-place';

const bounds: Rect = { left: 0, top: 0, width: 800, height: 600 };
const size = { width: 240, height: 80 };

describe('placeBubble', () => {
  it('U-27: opens below the trigger with an 8px gap, centred on it', () => {
    const anchor: Rect = { left: 400, top: 100, width: 24, height: 24 };
    const p = placeBubble(anchor, size, bounds);
    expect(p.side).toBe('below');
    expect(p.top).toBe(100 + 24 + 8);
    expect(p.left).toBe(412 - 120);
    expect(p.arrowLeft).toBe(120);
  });

  it('U-27: flips above when below does not fit and above does', () => {
    const anchor: Rect = { left: 400, top: 500, width: 24, height: 24 };
    const p = placeBubble(anchor, size, bounds);
    expect(p.side).toBe('above');
    expect(p.top).toBe(500 - 8 - 80);
  });

  it('U-27: stays below when neither side fits', () => {
    const anchor: Rect = { left: 400, top: 60, width: 24, height: 24 };
    const p = placeBubble(anchor, size, { ...bounds, height: 120 });
    expect(p.side).toBe('below');
  });

  it('U-27: clamps 8px inside the bounds and moves the arrow to stay on the trigger', () => {
    const anchor: Rect = { left: 4, top: 100, width: 24, height: 24 };
    const p = placeBubble(anchor, size, bounds);
    expect(p.left).toBe(8);
    expect(p.arrowLeft).toBe(16 - 8);
    const right = placeBubble({ left: 780, top: 100, width: 24, height: 24 }, size, bounds);
    expect(right.left).toBe(800 - 8 - 240);
    expect(right.arrowLeft).toBe(792 - right.left);
  });
});
