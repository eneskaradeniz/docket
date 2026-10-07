// drag-order-list.test.ts — U-47: the DragOrderList as it actually renders, through the same
// renderToStaticMarkup the layer's other markup tests use. The drag session is driven exactly as
// the component's pointer handlers drive it (begin, track, end, announce) and the markup is read
// back: the grip is the only handle, the held row lifts and follows the pointer, the others sit
// at their shifted slots, the settle carries its own pace, and under reduced motion nothing
// moves. The list itself keeps the U-41 semantics — list rows, numbers, the one live region.
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';

import { DRAG_PITCH, DRAG_ROW_HEIGHT } from '../stores/drag-order';
import { createDragSession, type DragClock, type DragSessionStore } from '../stores/drag-session';
import { DragOrderList, type DragOrderItem, type DragOrderListProps } from './drag-order-list';

const items: readonly DragOrderItem[] = [
  { id: 'a', markKey: null, label: 'Bir · hesap', sub: 'İlk sırada' },
  { id: 'b', markKey: null, label: 'İki · hesap', sub: 'Abonelik' },
  { id: 'c', markKey: null, label: 'Üç · hesap', sub: 'Kullandıkça öde' },
];

/** A clock that holds every timer until the test lets the moments pass. */
const manualClock = (): { readonly clock: DragClock; readonly flush: () => void } => {
  const timers: Array<() => void> = [];
  return {
    clock: {
      set: (fn) => {
        timers.push(fn);
        return timers.length;
      },
      clear: () => undefined,
    },
    flush: () => {
      const due = [...timers];
      timers.length = 0;
      for (const fn of due) fn();
    },
  };
};

const html = (session: DragSessionStore): string =>
  renderToStaticMarkup(
    createElement(DragOrderList, {
      locale: 'tr',
      items,
      markFor: () => null,
      label: 'Sıra',
      onReorder: () => undefined,
      session,
    } satisfies DragOrderListProps),
  );

/** The opening tag of one row's markup, by the row's id. */
const row = (markup: string, id: string): string => markup.match(new RegExp(`<div[^>]*data-drag-row="${id}"[^>]*>`))?.[0] ?? '';

describe('DragOrderList motion (U-47)', () => {
  it('U-47: the grip is the only pointer handle — touch-action none sits on it, never on the row', () => {
    const markup = html(createDragSession());
    const grip = markup.match(/<span[^>]*data-drag-grip[^>]*>/)?.[0] ?? '';
    expect(grip).toContain('touch-none');
    for (const tag of markup.match(/<div[^>]*data-drag-row[^>]*>/g) ?? []) {
      expect(tag).not.toContain('touch-action');
      expect(tag).not.toContain('touch-none');
    }
    // No HTML5 drag API is left behind: nothing is draggable.
    expect(markup).not.toContain('draggable');
  });

  it('U-47: rows rest at their slots and carry the 160 ms ease-out slide Alt+↑/↓ shares', () => {
    const markup = html(createDragSession());
    expect(row(markup, 'a')).toContain('top:0;');
    expect(row(markup, 'b')).toContain(`top:${DRAG_PITCH}px`);
    expect(row(markup, 'c')).toContain(`top:${2 * DRAG_PITCH}px`);
    expect(row(markup, 'b')).toContain('duration-[160ms]');
    expect(row(markup, 'b')).toContain('ease-out');
    // Text never selects during a drag, and under reduced motion the order changes at once.
    expect(row(markup, 'b')).toContain('select-none');
    expect(row(markup, 'b')).toContain('motion-reduce:transition-none');
  });

  it('U-47: the held row lifts — shadow, amber outline, a hair of scale — and centres under the pointer while the gap opens', () => {
    const session = createDragSession();
    session.begin('b', ['a', 'b', 'c'], DRAG_PITCH + DRAG_ROW_HEIGHT / 2);
    session.track('b', 2 * DRAG_PITCH + DRAG_ROW_HEIGHT / 2, 0);
    const markup = html(session);
    const held = row(markup, 'b');
    expect(held).toContain('z-[5]');
    expect(held).toContain('border-signal');
    expect(held).toContain('shadow-2xl');
    expect(held).toContain('scale-[1.01]');
    expect(held).toContain(`top:${2 * DRAG_PITCH}px`);
    // The others slid one slot up to open the gap.
    expect(row(markup, 'a')).toContain('top:0;');
    expect(row(markup, 'c')).toContain(`top:${DRAG_PITCH}px`);
  });

  it('U-47: on release the row settles at its own pace and the settle clears itself', () => {
    const { clock, flush } = manualClock();
    const session = createDragSession(clock);
    session.begin('b', ['a', 'b', 'c'], DRAG_PITCH + DRAG_ROW_HEIGHT / 2);
    session.track('b', 2 * DRAG_PITCH + DRAG_ROW_HEIGHT / 2, 0);
    expect(session.end('b')?.moved).toBe(true);
    const settling = row(html(session), 'b');
    expect(settling).toContain('duration-[140ms]');
    expect(settling).toContain('transition-[top,transform,box-shadow,border-color]');
    expect(settling).not.toContain('scale-[1.01]');
    expect(settling).not.toContain('shadow-2xl');
    flush();
    const rested = row(html(session), 'b');
    expect(rested).toContain('duration-[160ms]');
    expect(rested).not.toContain('duration-[140ms]');
  });

  it('U-47: a finished move is announced through the one polite live region', () => {
    const { clock, flush } = manualClock();
    const session = createDragSession(clock);
    session.announce('3. sıraya taşındı');
    flush();
    const markup = html(session);
    expect(markup).toContain('role="status"');
    expect(markup).toContain('aria-live="polite"');
    expect(markup).toContain('3. sıraya taşındı');
  });

  it('U-47: the list keeps its list semantics, numbers and the slots the drag works on', () => {
    const markup = html(createDragSession());
    expect(markup).toContain('role="list"');
    expect(markup).toContain('aria-label="Sıra"');
    expect(markup).toContain('aria-label="2. İki · hesap"');
    expect(markup).toContain(`height:${3 * DRAG_PITCH - 8}px`);
  });
});
