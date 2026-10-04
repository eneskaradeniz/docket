// components/sidebar-geometry.ts — the sidebar's one width (U-51): 264 px at every window size,
// the fixed first column of the shell's grid. It lives in its own module so the shell renders a
// named thing and the layout audit's L-1 successor reads the same single source.
export const SIDEBAR_GRID = 'grid-cols-[264px_minmax(0,1fr)]';
