// electron/chrome.ts — the app's own native chrome (WO-0100): the application menu and the tray.
//
// Host chrome the OS draws from the main process — no component renders it, so its words come from
// `./chrome-words` (Turkish-fixed; ADR-0007's 2026-09-23 addendum), never the ui locale bundles. The
// tray's STRUCTURE (count, ordered and capped rows, overflow, quiet) is derived by the pure
// `src/core/tray-menu.ts`; this file only maps that structure onto native menu items and owns the
// tray's lifecycle. It imports `electron`, `./chrome-words` and core `tray-menu` — no adapter, no
// identity constructor or cast (the ids it forwards are the branded ones the owner entries hold).
import { Menu, Tray, nativeImage, type MenuItemConstructorOptions } from 'electron';
import type { ChromeWords } from './chrome-words';
import {
  linuxTrayHint,
  menuLabelLiteral,
  trayMenuModel,
  type ChromeNavigate,
  type RunningOwner,
  type TrayMenuModel,
} from '../src/core/tray-menu';

/** The application id — equal to package.json `build.appId` (the e2e guard spec asserts parity).
 *  It is also the Windows AppUserModelID of a packaged build. */
export const APP_ID = 'dev.docket.app';

/** The tray rebuild's trailing throttle window (plan §4). */
export const TRAY_REFRESH_MS = 250;

// --- The application menu (plan §3) ---

/** The native application menu. The first menu is titled `Docket` on every OS; every item carries
 *  an explicit label (a role keeps its native behavior, the label only overrides the English default). */
export function buildAppMenu(words: ChromeWords, platform: string, handlers: { openSettings: () => void }): Menu {
  const sep: MenuItemConstructorOptions = { type: 'separator' };
  const settings: MenuItemConstructorOptions = {
    label: words.menuSettings,
    accelerator: 'CmdOrCtrl+,',
    click: () => handlers.openSettings(),
  };
  const isMac = platform === 'darwin';

  const appMenu: MenuItemConstructorOptions = isMac
    ? {
        label: words.appName, // ignored by macOS (it shows the bundle name), set for honesty
        submenu: [
          { role: 'about', label: words.menuAbout },
          sep,
          settings,
          sep,
          { role: 'services', label: words.menuServices },
          sep,
          { role: 'hide', label: words.menuHide },
          { role: 'hideOthers', label: words.menuHideOthers },
          { role: 'unhide', label: words.menuUnhide },
          sep,
          { role: 'quit', label: words.menuQuit },
        ],
      }
    : {
        label: words.appName,
        submenu: [
          settings,
          sep,
          { role: 'about', label: words.menuAbout },
          sep,
          { role: 'quit', label: words.menuQuit },
        ],
      };

  const editMenu: MenuItemConstructorOptions = {
    label: words.menuEdit,
    submenu: [
      { role: 'undo', label: words.menuUndo },
      { role: 'redo', label: words.menuRedo },
      sep,
      { role: 'cut', label: words.menuCut },
      { role: 'copy', label: words.menuCopy },
      { role: 'paste', label: words.menuPaste },
      ...(isMac ? [{ role: 'pasteAndMatchStyle', label: words.menuPasteAndMatchStyle } as MenuItemConstructorOptions] : []),
      { role: 'delete', label: words.menuDelete },
      { role: 'selectAll', label: words.menuSelectAll },
    ],
  };

  const viewMenu: MenuItemConstructorOptions = {
    label: words.menuView,
    submenu: [
      { role: 'reload', label: words.menuReload },
      { role: 'forceReload', label: words.menuForceReload },
      { role: 'toggleDevTools', label: words.menuToggleDevTools },
      sep,
      { role: 'resetZoom', label: words.menuResetZoom },
      { role: 'zoomIn', label: words.menuZoomIn },
      { role: 'zoomOut', label: words.menuZoomOut },
      sep,
      { role: 'togglefullscreen', label: words.menuToggleFullscreen },
    ],
  };

  const windowMenu: MenuItemConstructorOptions = isMac
    ? {
        label: words.menuWindow,
        role: 'windowMenu',
        submenu: [
          { role: 'minimize', label: words.menuMinimize },
          { role: 'zoom', label: words.menuZoom },
          // ⌘W — the default menu's fileMenu carried it; this template has no Dosya menu, so the
          // Pencere menu keeps today's shortcut alive (a deviation from plan §3, recorded in the WO).
          { role: 'close', label: words.menuClose },
          sep,
          { role: 'front', label: words.menuFront },
        ],
      }
    : {
        label: words.menuWindow,
        submenu: [
          { role: 'minimize', label: words.menuMinimize },
          { role: 'close', label: words.menuClose },
        ],
      };

  return Menu.buildFromTemplate([appMenu, editMenu, viewMenu, windowMenu]);
}

// --- The tray (plan §4) ---

export interface TrayHandlers {
  /** A row or `Pano'ya dön`: bring the window forward, then push the navigate request. */
  navigate: (p: ChromeNavigate) => void;
  quit: () => void;
}

/** Map the core structure onto native items. The header, the quiet line and the overflow are
 *  informational (a native `enabled: false` item — host chrome, not `src/ui`). */
export function buildTrayMenu(model: TrayMenuModel, words: ChromeWords, handlers: TrayHandlers): Menu {
  const items: MenuItemConstructorOptions[] = [];
  if (model.quiet) {
    items.push({ label: words.trayQuiet, enabled: false });
  } else {
    items.push({ label: words.trayRunning(model.count), enabled: false });
    for (const row of model.rows) {
      if (row.kind === 'wo') {
        const id = row.woId;
        items.push({ label: words.trayWoRow(id, menuLabelLiteral(row.title)), click: () => handlers.navigate({ kind: 'wo', id }) });
      } else {
        const workspaceId = row.workspaceId;
        items.push({ label: words.trayDraftRow, click: () => handlers.navigate({ kind: 'draft', workspaceId }) });
      }
    }
    if (model.overflow > 0) items.push({ label: words.trayOverflow(model.overflow), enabled: false });
  }
  items.push({ type: 'separator' });
  for (const s of model.secondary) {
    items.push(
      s === 'board'
        ? { label: words.trayBoard, click: () => handlers.navigate({ kind: 'board' }) }
        : { label: words.trayQuit, click: () => handlers.quit() },
    );
  }
  return Menu.buildFromTemplate(items);
}

export interface TrayController {
  /** Schedule a rebuild from the current owner snapshot (250 ms trailing throttle). */
  refresh: () => void;
  destroy: () => void;
}

/**
 * Create the tray, or return null when it cannot exist (the degrade is logged once). The caller has
 * already checked `trayAllowed`. `iconPath` is the platform's asset (the macOS template, the Windows
 * .ico, the Linux colored png); `owners` reads main's live-drive owner snapshot at rebuild time.
 */
export function createTrayController(opts: {
  iconPath: string;
  platform: string;
  desktop: string | undefined;
  words: ChromeWords;
  owners: () => readonly RunningOwner[];
  handlers: TrayHandlers;
  log: (line: string) => void;
}): TrayController | null {
  const { words, platform } = opts;
  // Electron gives no visibility signal for a tray on a desktop without a StatusNotifier host
  // (electron#53213) — hence "may": the hint is logged once, the tray is still attempted.
  if (linuxTrayHint({ platform, desktop: opts.desktop }) === 'gnome-no-sni-host') opts.log(words.logGnomeHint);

  let tray: Tray;
  try {
    const image = nativeImage.createFromPath(opts.iconPath);
    if (image.isEmpty()) throw new Error(`icon not found: ${opts.iconPath}`);
    if (platform === 'darwin') image.setTemplateImage(true);
    tray = new Tray(image);
  } catch (e) {
    opts.log(words.logTrayUnavailable((e as Error)?.message ?? String(e)));
    return null;
  }

  tray.setToolTip(words.appName); // always the name; the count rides the menu only
  const rebuild = (): void => {
    timer = undefined;
    if (tray.isDestroyed()) return;
    // Linux needs the menu re-set on every change; every OS gets the whole menu rebuilt.
    tray.setContextMenu(buildTrayMenu(trayMenuModel(opts.owners()), words, opts.handlers));
  };
  let timer: ReturnType<typeof setTimeout> | undefined;
  rebuild();
  // Windows lists on a left click too (the context menu covers the right click); macOS opens the
  // context menu on any click; Linux activation varies by desktop, so the menu is the whole surface.
  if (platform === 'win32') tray.on('click', () => tray.popUpContextMenu());

  return {
    refresh: () => {
      if (timer === undefined) timer = setTimeout(rebuild, TRAY_REFRESH_MS);
    },
    destroy: () => {
      if (timer !== undefined) clearTimeout(timer);
      timer = undefined;
      if (!tray.isDestroyed()) tray.destroy();
    },
  };
}
