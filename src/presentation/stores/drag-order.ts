// stores/drag-order.ts — the rules of the drag-and-drop order list (U-41, U-47) as pure
// functions: where a held row sits, which slot it is over, how Alt+↑/↓ moves it, what the live
// region says, and how near the scroller's edge the list scrolls itself. The component owns the
// pointer; every number it needs comes from here, so the wizard's Asistan sırası and
// Settings → Roller move rows identically.

/** One row's height and the gap between rows, in px. */
export const DRAG_ROW_HEIGHT = 56;
export const DRAG_ROW_GAP = 8;
export const DRAG_PITCH = DRAG_ROW_HEIGHT + DRAG_ROW_GAP;
/** How far past the first and last slot a held row may travel. */
export const DRAG_OVERSHOOT = 10;
/** A pointer must travel this far before a press becomes a drag; under it the press is a click. */
export const DRAG_THRESHOLD = 4;
/** The slide that opens the gap for the held row (FLIP), ease-out. */
export const DRAG_SLIDE_MS = 160;
/** The held row's return to its slot on release. */
export const DRAG_SETTLE_MS = 140;
/** The settle stance outlives its own animation, so a row never picks up a new drag mid-flight. */
export const DRAG_SETTLE_CLEAR_MS = 220;
/** The held row lifts a hair larger than life, so it reads as picked up. */
export const DRAG_LIFT_SCALE = 1.01;
/** The scroller's edge zone, in px, where the list starts scrolling itself. */
export const AUTO_SCROLL_EDGE = 44;
/** How far the list scrolls itself per frame while the pointer stays in the zone. */
export const AUTO_SCROLL_STEP = 11;

/** The top edge of the slot at `index`. */
export const slotTop = (index: number): number => index * DRAG_PITCH;

/** The height of the whole list for `count` rows. */
export const listHeight = (count: number): number => (count === 0 ? 0 : count * DRAG_PITCH - DRAG_ROW_GAP);

/** Where a held row's top edge sits: centred under the pointer, never outside the list. */
export const dragTop = (pointerY: number, listTop: number, count: number): number =>
  Math.max(-DRAG_OVERSHOOT, Math.min(pointerY - listTop - DRAG_ROW_HEIGHT / 2, slotTop(Math.max(0, count - 1)) + DRAG_OVERSHOOT));

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

/** The scroll step the list gives itself while the pointer sits in the scroller's edge zone: up at
 *  the top, down at the bottom, none in between. */
export const autoScrollStep = (pointerY: number, scrollerTop: number, scrollerBottom: number): number => {
  if (pointerY < scrollerTop + AUTO_SCROLL_EDGE) return -AUTO_SCROLL_STEP;
  if (pointerY > scrollerBottom - AUTO_SCROLL_EDGE) return AUTO_SCROLL_STEP;
  return 0;
};
