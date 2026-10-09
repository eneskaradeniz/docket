// components/sidebar-geometry.ts — the sidebar's own measures (U-51, U-51b; U-53 moves the width
// and the body's cap to rem): its one width, 16.5 rem at the live scale (264 px at 100 %) as the
// fixed first column of the shell's grid, and the Hesaplar body's fixed height — two 3.5 rem
// cards, their 0.5 rem gap, and the ~1.25 rem peek of a third that says the list scrolls. They
// live in their own module so the shell renders named things and the tests read the same single
// source.
export const SIDEBAR_GRID = 'grid-cols-[16.5rem_minmax(0,1fr)]';

export const ACCOUNTS_BODY_MAX_HEIGHT = 'max-h-[9.25rem]';
