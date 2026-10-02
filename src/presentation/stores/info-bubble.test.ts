// stores/info-bubble.test.ts — the info bubble's open/close rules as a pure reducer (U-27).
// Time is injected, so every delay boundary is a plain number.
import { describe, expect, it } from 'vitest';

import { INFO_BUBBLE_TIMING, INITIAL_INFO_BUBBLE, reduceInfoBubble, type InfoBubbleEvent, type InfoBubbleState } from './info-bubble';

const run = (events: readonly InfoBubbleEvent[], from: InfoBubbleState = INITIAL_INFO_BUBBLE): InfoBubbleState =>
  events.reduce(reduceInfoBubble, from);

describe('info bubble reducer', () => {
  it('U-27: hover opens only after 400 ms', () => {
    const s = run([{ type: 'hover-enter', id: 'a', now: 1000 }]);
    expect(run([{ type: 'tick', now: 1399 }], s).openId).toBeNull();
    expect(INFO_BUBBLE_TIMING.openMs).toBe(400);
    const open = run([{ type: 'tick', now: 1400 }], s);
    expect(open.openId).toBe('a');
    expect(open.pinned).toBe(false);
  });

  it('U-27: leaving before 400 ms cancels the pending open', () => {
    const s = run([
      { type: 'hover-enter', id: 'a', now: 0 },
      { type: 'hover-leave', id: 'a', now: 200 },
      { type: 'tick', now: 1000 },
    ]);
    expect(s.openId).toBeNull();
  });

  it('U-27: pointer leave closes after 150 ms', () => {
    const open = run([{ type: 'hover-enter', id: 'a', now: 0 }, { type: 'tick', now: 400 }]);
    const left = run([{ type: 'hover-leave', id: 'a', now: 500 }], open);
    expect(run([{ type: 'tick', now: 649 }], left).openId).toBe('a');
    expect(INFO_BUBBLE_TIMING.closeMs).toBe(150);
    expect(run([{ type: 'tick', now: 650 }], left).openId).toBeNull();
  });

  it('U-27: moving the pointer onto the bubble keeps it open', () => {
    const open = run([{ type: 'hover-enter', id: 'a', now: 0 }, { type: 'tick', now: 400 }]);
    const s = run(
      [
        { type: 'hover-leave', id: 'a', now: 500 },
        { type: 'bubble-enter', id: 'a', now: 520 },
        { type: 'tick', now: 2000 },
      ],
      open,
    );
    expect(s.openId).toBe('a');
    const after = run([{ type: 'bubble-leave', id: 'a', now: 2100 }, { type: 'tick', now: 2250 }], s);
    expect(after.openId).toBeNull();
  });

  it('U-27: keyboard focus-visible opens at once', () => {
    const s = run([{ type: 'focus-visible', id: 'a', now: 0 }]);
    expect(s.openId).toBe('a');
  });

  it('U-27: click pins the bubble open and a second click closes it', () => {
    const pinned = run([{ type: 'hover-enter', id: 'a', now: 0 }, { type: 'toggle', id: 'a', now: 10 }]);
    expect(pinned).toMatchObject({ openId: 'a', pinned: true });
    const left = run([{ type: 'hover-leave', id: 'a', now: 20 }, { type: 'tick', now: 5000 }], pinned);
    expect(left.openId).toBe('a');
    expect(run([{ type: 'toggle', id: 'a', now: 6000 }], left).openId).toBeNull();
  });

  it('U-27: Enter or Space (the button click) pins a focus-opened bubble', () => {
    const s = run([{ type: 'focus-visible', id: 'a', now: 0 }, { type: 'toggle', id: 'a', now: 5 }]);
    expect(s).toMatchObject({ openId: 'a', pinned: true });
  });

  it('U-27: Esc closes the bubble, pinned or not', () => {
    const s = run([{ type: 'toggle', id: 'a', now: 0 }, { type: 'escape' }]);
    expect(s).toEqual(INITIAL_INFO_BUBBLE);
  });

  it('U-27: an outside click closes it', () => {
    expect(run([{ type: 'toggle', id: 'a', now: 0 }, { type: 'outside-click' }]).openId).toBeNull();
  });

  it('U-27: a scroll closes it', () => {
    expect(run([{ type: 'toggle', id: 'a', now: 0 }, { type: 'scroll' }]).openId).toBeNull();
  });

  it('U-27: focus leaving trigger and bubble closes it', () => {
    expect(run([{ type: 'focus-visible', id: 'a', now: 0 }, { type: 'focus-out', id: 'a' }]).openId).toBeNull();
  });

  it('U-27: one bubble is open at a time', () => {
    const s = run([{ type: 'toggle', id: 'a', now: 0 }, { type: 'toggle', id: 'b', now: 10 }]);
    expect(s).toMatchObject({ openId: 'b', pinned: true });
    const hovered = run([
      { type: 'focus-visible', id: 'a', now: 0 },
      { type: 'hover-enter', id: 'b', now: 5 },
      { type: 'tick', now: 405 },
    ]);
    expect(hovered.openId).toBe('b');
  });

  it('U-27: focus-out of another bubble does not close the open one', () => {
    const s = run([{ type: 'toggle', id: 'b', now: 0 }, { type: 'focus-out', id: 'a' }]);
    expect(s.openId).toBe('b');
  });
});
