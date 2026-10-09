// components/sidebar-header-button.ts — the one small square button both sidebar headers speak:
// 24×24 around a 12px icon, a 1px hairline frame at rest that raises to the ink colour on hover,
// the U-23 control radius. The Projeler header (sort, new project) and the Hesaplar header
// (refresh, collapse) carry the same head grammar so the sidebar's two sections read as one.
/** The sidebar headers' small bordered button. */
export const SIDEBAR_HEADER_BUTTON =
  'grid h-6 w-6 flex-none place-items-center rounded-control border border-hairline text-inkdim hover:border-bord hover:text-ink';
