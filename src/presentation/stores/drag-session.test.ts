// drag-session.test.ts — U-47: what one live drag renders, held in the session store. The store
// owns the held row, the provisional order the others slide around, the settle a release lands
// into and the live region's line; the tests drive it exactly as the component's pointer
// handlers do, with a frozen clock for the settle clear and the announcement reset. The cached
// snapshot is the load-bearing part: useSyncExternalStore compares reads by reference, so a
// store that minted a fresh object per read would loop re-renders (React error #185).
import { describe, expect, it } from 'vitest';

import { DRAG_ROW_HEIGHT } from './drag-order';
import { createDragSession, type DragClock } from './drag-session';

/** A clock that holds every timer until the test lets the moments pass. */
const manualClock = (): { readonly clock: DragClock; readonly flush: () => void } => {
  const timers: Array<() => void> = [];
  return {
    clock: {
      set: (fn) => {
        timers.push(fn);
        return timers.length;
      },
      clear: (handle) => {
        const at = Number(handle) - 1;
        if (at >= 0 && at < timers.length) timers.splice(at, 1);
      },
    },
    flush: () => {
      const due = [...timers];
      timers.length = 0;
      for (const fn of due) fn();
    },
  };
};

describe('drag session (U-47)', () => {
  it('U-47: a press that never crosses the threshold is a click, not a drag', () => {
    const session = createDragSession();
    session.begin('b', ['a', 'b', 'c'], 100);
    const pressed = session.state();
    session.track('b', 103, 0);
    expect(session.state()).toBe(pressed);
    expect(session.state().lifted).toBe(false);
    const result = session.end('b');
    expect(result).not.toBeNull();
    expect(result?.moved).toBe(false);
    expect(session.state().settlingId).toBeNull();
    expect(session.state().heldId).toBeNull();
  });

  it('U-47: past the threshold the row lifts, centres under the pointer and opens the gap', () => {
    const session = createDragSession();
    session.begin('b', ['a', 'b', 'c'], 92);
    session.track('b', 100, 0);
    expect(session.state().lifted).toBe(true);
    expect(session.state().order).toEqual(['a', 'b', 'c']);
    session.track('b', 156, 0);
    expect(session.state().top).toBe(156 - DRAG_ROW_HEIGHT / 2);
    expect(session.state().order).toEqual(['a', 'c', 'b']);
  });

  it('U-47: release reports the finished move once and settles the row home', () => {
    const { clock, flush } = manualClock();
    const session = createDragSession(clock);
    session.begin('b', ['a', 'b', 'c'], 92);
    session.track('b', 156, 0);
    expect(session.end('b')).toEqual({ order: ['a', 'c', 'b'], to: 2, moved: true });
    expect(session.state().heldId).toBeNull();
    expect(session.state().settlingId).toBe('b');
    expect(session.end('b')).toBeNull();
    flush();
    expect(session.state().settlingId).toBeNull();
  });

  it('U-47: a release that lands where it started reports no move but still settles', () => {
    const { clock, flush } = manualClock();
    const session = createDragSession(clock);
    session.begin('b', ['a', 'b', 'c'], 92);
    session.track('b', 100, 0);
    expect(session.end('b')).toEqual({ order: ['a', 'b', 'c'], to: 1, moved: false });
    expect(session.state().settlingId).toBe('b');
    flush();
    expect(session.state().settlingId).toBeNull();
  });

  it('U-47: picking a row up again cancels its pending settle', () => {
    const { clock, flush } = manualClock();
    const session = createDragSession(clock);
    session.begin('b', ['a', 'b', 'c'], 92);
    session.track('b', 156, 0);
    session.end('b');
    session.begin('b', ['a', 'b', 'c'], 92);
    expect(session.state().settlingId).toBeNull();
    flush();
    expect(session.state().settlingId).toBeNull();
  });

  it('U-47: the snapshot is one cached reference — reads never mint a fresh one', () => {
    const session = createDragSession();
    const resting = session.state();
    expect(session.state()).toBe(resting);
    session.begin('a', ['a', 'b'], 28);
    const held = session.state();
    session.track('a', 30, 0);
    expect(session.state()).toBe(held);
    let heard = 0;
    const unsubscribe = session.subscribe(() => {
      heard += 1;
    });
    session.track('a', 40, 0);
    expect(heard).toBe(1);
    expect(session.state()).not.toBe(held);
    unsubscribe();
  });

  it('U-47: a move is announced once, and the same words set again clear first so readers repeat them', () => {
    const { clock, flush } = manualClock();
    const session = createDragSession(clock);
    session.announce('3. sıraya taşındı');
    expect(session.state().announcement).toBe('');
    flush();
    expect(session.state().announcement).toBe('3. sıraya taşındı');
    session.announce('3. sıraya taşındı');
    expect(session.state().announcement).toBe('');
    flush();
    expect(session.state().announcement).toBe('3. sıraya taşındı');
  });
});
