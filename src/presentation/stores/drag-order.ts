// stores/drag-order.ts — the rules of the drag-and-drop order list (U-41) as pure functions: where
// a dragged row sits, which slot it is over, how Alt+↑/↓ moves it and what the live region says.
// The component owns the pointer; every number it needs comes from here, so the wizard's Asistan
// sırası and Settings → Roller move rows identically.

/** One row's height and the gap between rows, in px. */
export const DRAG_ROW_HEIGHT = 56;
export const DRAG_ROW_GAP = 8;
export const DRAG_PITCH = DRAG_ROW_HEIGHT + DRAG_ROW_GAP;
/** How far past the first and last slot a dragged row may travel. */
export const DRAG_OVERSHOOT = 12;
/** A pointer must travel this far before a press becomes a drag. */
export const DRAG_THRESHOLD = 4;

/** The top edge of the slot at `index`. */
export const slotTop = (index: number): number => index * DRAG_PITCH;

/** The height of the whole list for `count` rows. */
export const listHeight = (count: number): number => (count === 0 ? 0 : count * DRAG_PITCH - DRAG_ROW_GAP);

/** Where a dragged row's top edge sits: its start plus the pointer's travel, kept inside the list. */
export const dragTop = (startTop: number, travel: number, count: number): number =>
  Math.max(-DRAG_OVERSHOOT, Math.min(startTop + travel, slotTop(Math.max(0, count - 1)) + DRAG_OVERSHOOT));

/** The slot a top edge is over. */
export const slotAt = (top: number, count: number): number => Math.max(0, Math.min(count - 1, Math.round(top / DRAG_PITCH)));

/** The list with the item at `from` moved to `to` (clamped); null when nothing would change. */
export const moveItem = <T>(list: readonly T[], from: number, to: number): readonly T[] | null => {
  if (from < 0 || from >= list.length) return null;
  const target = Math.max(0, Math.min(list.length - 1, to));
  if (target === from) return null;
  const next = [...list];
  const [item] = next.splice(from, 1);
  if (item === undefined) return null;
  next.splice(target, 0, item);
  return next;
};

/** Alt+↑ is -1, Alt+↓ is +1; any other key press is not a move. */
export const keyboardMove = (press: { readonly key: string; readonly altKey: boolean }): -1 | 1 | null => {
  if (!press.altKey) return null;
  if (press.key === 'ArrowUp') return -1;
  if (press.key === 'ArrowDown') return 1;
  return null;
};

/** The live-region text after a move: the 1-based position the row now holds, through the bundle's
 *  template ("{n}. sıraya taşındı"). */
export const moveAnnouncement = (template: string, index: number): string => template.replace('{n}', String(index + 1));
