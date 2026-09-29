// Window options that depend on the platform, split out of the composition root so they are a
// pure function of the platform string: a test can cover every branch without importing the
// electron runtime (importing main.ts would boot the app).
import type { BrowserWindowConstructorOptions } from 'electron';

/** The window's smallest usable size. The sidebar is a fixed 240px, so this floor keeps the body
 *  column at 784px or wider instead of letting the two columns collapse into each other. Lives
 *  here rather than in main.ts so a unit test can assert the values without booting the app. */
export const WINDOW_MIN_WIDTH = 1024;
export const WINDOW_MIN_HEIGHT = 640;

/** The platform-varying slice of the BrowserWindow constructor options. */
export type TitleBarOptions = Pick<
  BrowserWindowConstructorOptions,
  'titleBarStyle' | 'trafficLightPosition'
>;

/** The traffic lights are inset into the app bar's 92px gap on darwin: the native title strip is
 *  hidden and the buttons are placed at the bar's own padding. Anywhere else a non-default
 *  titleBarStyle would hide the native menu bar together with the title bar, so the default
 *  frame stays — the other platforms add nothing. */
export const titleBarOptionsFor = (platform: NodeJS.Platform): TitleBarOptions =>
  platform === 'darwin'
    ? { titleBarStyle: 'hiddenInset', trafficLightPosition: { x: 14, y: 16 } }
    : {};
