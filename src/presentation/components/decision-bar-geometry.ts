// components/decision-bar-geometry.ts — the pinned decision bar's place among the shell's fixed
// pieces, in one spot. The bar is stuck inside the shell's padded main column; the floating chat
// button is fixed at the window's bottom right. The bar must sit BELOW the button in z-order
// (the button stays whole on top) and leave the button's footprint empty on its right, so the
// bar's own actions never share pixels with it. Every value that mirrors the shell or the chat
// button is named here; the tests read the shell and the dock and fail when they drift.

/** The shell's main-column padding (screens/shell.tsx). */
export const SHELL_MAIN_PADDING_CLASS = 'px-[1.375rem] py-[1.125rem]';

/** The chat button's own z-order and footprint (components/chat-dock.tsx): `z-[21]`, fixed
 *  `bottom-6 right-6`, `h-14 w-14` — its right edge reaches 5 rem in from the window edge. */
export const CHAT_BUTTON_Z_CLASS = 'z-[21]';

/** One step under the chat button. */
export const DECISION_BAR_Z_CLASS = 'z-20';

/** Spans the main column edge to edge (the negative margins undo the shell's side gutter, the
 *  left padding gives it back), reaches past the shell's bottom padding so nothing shows under
 *  it, and keeps 0.75 rem clear beyond the chat button's 5 rem footprint on the right. */
export const DECISION_BAR_FRAME_CLASS =
  'sticky bottom-[-1.125rem] -mx-[1.375rem] -mb-[1.125rem] pb-[1.625rem] pl-[1.375rem] pr-[5.75rem] pt-2';
