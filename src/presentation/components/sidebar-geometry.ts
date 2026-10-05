// components/sidebar-geometry.ts — the sidebar's own measures (U-51, U-51b): its one width,
// 264 px at every window size as the fixed first column of the shell's grid, and the Hesaplar
// body's fixed height — two 56 px cards, their 8 px gap, and the ~20 px peek of a third that
// says the list scrolls. They live in their own module so the shell renders named things and
// the tests read the same single source.
export const SIDEBAR_GRID = 'grid-cols-[264px_minmax(0,1fr)]';

export const ACCOUNTS_BODY_MAX_HEIGHT = 'max-h-[148px]';
