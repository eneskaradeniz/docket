// components/chat-style.tsx — the chat's shared class strings, so the dock, the feed, the composer
// and the history draw the same buttons, chips and menu rows. All lengths are rem (the only px-like
// value is the 1 px hairline border), spacing steps sit on the 4·8·12·16·20·24·32 scale, radii are
// the three tokens plus rounded-full, and every sized text line carries an explicit leading because
// Tailwind's preflight puts line-height 1.5 on the root. A disabled control uses pointer-events-none.

/** A keyboard ring in rem: the global sheet sets none, so each control names its own. */
export const FOCUS =
  'focus-visible:outline-solid focus-visible:outline-[0.125rem] focus-visible:outline-offset-[0.125rem] focus-visible:outline-signal-soft';

/** A 28 rem-square icon button (history rows use the smaller one). */
export const ICON_BUTTON = `grid h-7 w-7 flex-none place-items-center rounded-control border-0 bg-transparent text-inkdim hover:bg-raised hover:text-ink aria-pressed:bg-raised aria-pressed:text-ink ${FOCUS}`;
export const ICON_BUTTON_SMALL = `grid h-6 w-6 flex-none place-items-center rounded-control border-0 bg-transparent text-inkdim hover:bg-band hover:text-ink ${FOCUS}`;

/** The 28 high text buttons of the cards and notes. */
export const BUTTON = `inline-flex h-7 flex-none items-center justify-center whitespace-nowrap rounded-control border border-bord bg-transparent px-3 text-[0.78125rem] font-semibold leading-4 text-ink hover:bg-raised disabled:pointer-events-none disabled:opacity-50 ${FOCUS}`;
export const BUTTON_PRIMARY = `inline-flex h-7 flex-none items-center justify-center whitespace-nowrap rounded-control border border-signal bg-signal px-3 text-[0.78125rem] font-semibold leading-4 text-signal-ink disabled:pointer-events-none disabled:opacity-50 ${FOCUS}`;
export const BUTTON_GHOST = `inline-flex h-7 flex-none items-center justify-center whitespace-nowrap rounded-control border border-transparent bg-transparent px-3 text-[0.78125rem] font-semibold leading-4 text-inkdim hover:text-ink ${FOCUS}`;

/** The 22 high pills of sources and references. */
export const SOURCE_CHIP =
  'inline-flex h-[1.375rem] max-w-full items-center gap-1 rounded-full bg-raised px-2 font-mono text-[0.6875rem] font-medium leading-none text-inkdim';
export const REF_CHIP =
  'inline-flex h-[1.375rem] max-w-full items-center gap-1 rounded-full border border-hairline bg-transparent px-2 font-mono text-[0.6875rem] font-medium leading-none text-ink';

/** The thumbnail of an image chip: a gradient with the file name, never the image itself. */
export const THUMB =
  'grid place-content-end items-end justify-items-start rounded-card border border-hairline bg-linear-to-br from-info to-write px-2 py-1 font-mono text-[0.6875rem] font-medium leading-none text-white';

/** A row of a menu: icon, title with a dim description, trailing mark. */
export const MENU_OPTION = `grid w-full grid-cols-[1.25rem_1fr_auto] items-center gap-2 rounded-control border-0 bg-transparent px-3 py-2 text-left hover:bg-raised aria-selected:bg-raised ${FOCUS}`;
export const MENU_TITLE = 'block truncate text-[0.875rem] font-semibold leading-5 text-ink';
export const MENU_DESC = 'block text-[0.75rem] font-normal leading-4 text-inkdim';

/** The raised surface menus and dialogs share. */
export const FLOATING =
  'rounded-card border border-bord bg-surface p-1 shadow-[0_1rem_3rem_rgba(0,0,0,0.35)]';

/** Replaces {name}-style placeholders in a bundle string. */
export const fill = (text: string, values: Readonly<Record<string, string | number>>): string =>
  Object.entries(values).reduce((out, [name, value]) => out.replaceAll(`{${name}}`, String(value)), text);
