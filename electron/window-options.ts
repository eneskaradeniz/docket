// Window options that depend on the platform, split out of the composition root so they are a
// pure function of the platform string: a test can cover every branch without importing the
// electron runtime (importing main.ts would boot the app).
import type { BrowserWindowConstructorOptions } from 'electron';

/** The window's smallest usable size. The sidebar is a fixed 240px, so this floor keeps the body
 *  column at 784px or wider instead of letting the two columns collapse into each other. Lives
 *  here rather than in main.ts so a unit test can assert the values without booting the app. */
export const WINDOW_MIN_WIDTH = 1024;
export const WINDOW_MIN_HEIGHT = 640;

/** The size the window opens at: 16:10, a step down from the previous 1280x800 so the fresh
 *  window fits smaller laptop screens. The cockpit's last section then needs a short scroll —
 *  accepted; the minimums above are untouched. Lives here for the same reason the minimums do. */
export const WINDOW_DEFAULT_WIDTH = 1152;
export const WINDOW_DEFAULT_HEIGHT = 720;

/** The platform-varying slice of the BrowserWindow constructor options. */
export type TitleBarOptions = Pick<
  BrowserWindowConstructorOptions,
  'titleBarStyle' | 'trafficLightPosition'
>;

/** The traffic lights are inset into the shell's own 40px drag bar on darwin: the native title
 *  strip is hidden, the buttons sit inside the lane the bar reserves at its left, and y 14
 *  centres a 12px button on the bar's midline. Anywhere else a non-default titleBarStyle would
 *  hide the native menu bar together with the title bar, so the default frame stays — the other
 *  platforms add nothing. */
export const titleBarOptionsFor = (platform: NodeJS.Platform): TitleBarOptions =>
  platform === 'darwin'
    ? { titleBarStyle: 'hiddenInset', trafficLightPosition: { x: 14, y: 14 } }
    : {};
