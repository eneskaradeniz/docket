import { describe, expect, it } from 'vitest';

import { DRAG_PITCH, dragTop, keyboardMove, listHeight, moveAnnouncement, moveItem, slotAt, slotTop } from './drag-order';

describe('drag order (U-41)', () => {
  it('U-41: a row dropped over another slot takes that slot and the others shift', () => {
    expect(moveItem(['a', 'b', 'c', 'd'], 0, 2)).toEqual(['b', 'c', 'a', 'd']);
    expect(moveItem(['a', 'b', 'c', 'd'], 3, 1)).toEqual(['a', 'd', 'b', 'c']);
  });

  it('U-41: a move that changes nothing, or starts outside the list, is null and never mutates', () => {
    const list = ['a', 'b'];
    expect(moveItem(list, 1, 1)).toBeNull();
    expect(moveItem(list, 5, 0)).toBeNull();
    expect(moveItem(list, 0, 9)).toEqual(['b', 'a']);
    expect(list).toEqual(['a', 'b']);
  });

  it('U-41: the pointer maps a top edge to the nearest slot, kept inside the list', () => {
    expect(slotAt(slotTop(2) + 10, 4)).toBe(2);
    expect(slotAt(slotTop(2) + DRAG_PITCH / 2 + 1, 4)).toBe(3);
    expect(slotAt(-40, 4)).toBe(0);
    expect(slotAt(9999, 4)).toBe(3);
    expect(dragTop(slotTop(1), -500, 4)).toBe(-12);
    expect(dragTop(slotTop(1), 500, 4)).toBe(slotTop(3) + 12);
    expect(listHeight(3)).toBe(3 * DRAG_PITCH - 8);
    expect(listHeight(0)).toBe(0);
  });

  it('U-41: Alt+↑/↓ moves the focused row by one and any other key is not a move', () => {
    expect(keyboardMove({ key: 'ArrowUp', altKey: true })).toBe(-1);
    expect(keyboardMove({ key: 'ArrowDown', altKey: true })).toBe(1);
    expect(keyboardMove({ key: 'ArrowDown', altKey: false })).toBeNull();
    expect(keyboardMove({ key: 'Enter', altKey: true })).toBeNull();
  });

  it('U-41: each move is announced with the 1-based position', () => {
    expect(moveAnnouncement('{n}. sıraya taşındı', 0)).toBe('1. sıraya taşındı');
    expect(moveAnnouncement('Moved to position {n}', 2)).toBe('Moved to position 3');
  });
});
