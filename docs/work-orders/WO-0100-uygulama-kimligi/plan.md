# WO-0100 — plan (the app's own face)

Plan round, 2026-09-23. Static reading only: nothing was built, installed, launched or run. Line
numbers are against branch `wo-0100-uygulama-kimligi` at plan time. **UNVERIFIED** marks a claim
that was not checked in this round. Revision 2 (same day) folds the critique round; §13 logs each
issue.

## 1. Summary

- Name: `app.setName('Docket')` with the userData path pinned first, so no directory moves. `build.productName` for packaging. No top-level `productName`. On Windows, `app.setAppUserModelId` ties the taskbar, shortcuts and toasts to one id.
- Logo: three directions below. **Recommended: B, "D-lamp"** (a D outline with the amber running lamp). SVG sources under `build/` feed `scripts/icons.mjs`, which emits every asset: rasters of 32 px and below come from a dedicated small-size geometry, 48 px and up from the padded tile. The outputs are committed.
- Menu: a native template with fixed Turkish labels, kept in an electron-side word table (not the ADR-0007 bundle). The first menu is titled `Docket` on every OS. Locale-following is a named follow-up.
- Window frame: `titleBarStyle: 'hiddenInset'` + `trafficLightPosition` become macOS-only, so Windows and Linux get a normal frame and a visible menu bar. This is a visible behavior change the operator approves (§12).
- Tray: the pure `src/core/tray-menu.ts` (test-first) derives the menu structure from main's `activeDrives` owner snapshot, with a 250 ms trailing throttle. One `docket:chrome:navigate` push, buffered in the preload, reaches a small renderer listener. **This deviates from order.md's "no core/ui change"**, and it voids the order's "merge-order friendly" note (§5).
- Honesty: the bold app-menu title and Dock hover name in a macOS **dev** run stay "Electron" unless Electron.app is patched. Acceptance 1 needs reworded dev wording (§6). Windows and Linux need a named verification route (§11b, §12). The tray and the dock icon are OFF under `DOCKET_E2E`. No single-instance lock is added (§13).
- Packaging: the provider SDK is unpacked from asar so a packaged build can drive; the Linux deb target gets a maintainer.

## 2. Logo

Every direction is drawn on a `viewBox="0 0 1024 1024"` canvas. The app-icon tile follows the macOS grid, `<rect x="100" y="100" width="824" height="824" rx="185" fill="#0a0a0a" stroke="#262626" stroke-width="4"/>`, and Windows and Linux use the same tile at 48 px and above. The palette comes from `src/index.css:18-35` (the dark @theme, the brand face): surface `#0a0a0a`, raised `#171717`, hairline `#262626`, ink `#f2f2f2`, inkdim `#8f8f8f`, signal `#f5b544`.

**A — "Ledger"** (a docket read as a list)
- Three ink bars `#f2f2f2`, height 72, `rx="36"`, at x=272. Widths and y positions: 480 at y=348, 400 at y=476, 320 at y=604.
- One signal dot `#f5b544`, `cx="704" cy="640" r="60"`, on the short row: a running item.
- 16 px tray: the bars are about 1.1 px tall with 0.9 px gaps, so at 1x they blur into a grey block. At @2x they read.
- Template (monochrome): the bars plus the dot in black. The dot is indistinguishable from a fourth bar end.
- Verdict: weakest at tray size.

**B — "D-lamp"** (recommended)
- D outline: `<path d="M352 312 H512 A200 200 0 0 1 512 712 H352 Z" fill="none" stroke="#f2f2f2" stroke-width="72" stroke-linejoin="round"/>`.
- Lamp: `<circle cx="532" cy="512" r="72" fill="#f5b544"/>`. This is the console's running lamp and turn-lamp motif, sitting in the D's counter.
- Small sizes get their own pixel-aligned geometry instead of a downscale of the 1024 drawing (a 16 px downscale of the padded tile puts a ~1.1 px D stroke inside a ~13 px tile: the same failure that sinks A):
  - `build/tray.svg`, the @2x template source, `viewBox="0 0 32 32"`, black and alpha only. Centerlines sit on half-units so a 3-unit stroke's edges land on whole pixels:
    `<path d="M8.5 5.5 H16 A10.5 10.5 0 0 1 16 26.5 H8.5 Z" fill="none" stroke="#000" stroke-width="3" stroke-linejoin="round"/>` + `<circle cx="17" cy="16" r="4" fill="#000"/>`.
  - `build/tray16.svg`, the @1x template source, `viewBox="0 0 16 16"`, drawn for whole-pixel edges rather than downsampled: `<path d="M4 3 H8 A5 5 0 0 1 8 13 H4 Z" fill="none" stroke="#000" stroke-width="2" stroke-linejoin="miter"/>` + `<rect x="8" y="7" width="2" height="2" fill="#000"/>` (the lamp becomes a 2×2 block; a 2 px circle would anti-alias to grey). Stroke edges fall on x=3/5 and y=2/4, 12/14.
  - `build/tile-small.svg`, the colored small tile, `viewBox="0 0 32 32"`: a full-bleed `<rect width="32" height="32" rx="7" fill="#0a0a0a"/>`, the D with the same half-unit path as `tray.svg` in ink `#f2f2f2` at stroke 3, and the lamp in `#f5b544`. No padding and no hairline, since a 4-unit hairline cannot survive at 16 px.
  - Whether the 16 px results read as a letter is UNVERIFIED until rendered; the implementation round attaches the 16/32 px PNGs to the manual check.
- Template (monochrome): `tray.svg` / `tray16.svg`. The OS recolors them for light and dark menubars.
- Colored tray (Windows and Linux, where a white glyph would vanish on a light taskbar): `tile-small.svg`.

**C — "Tab stack"** (two cards, a filed docket)
- Back card: `<rect x="300" y="260" width="424" height="520" rx="48" fill="#171717" stroke="#262626" stroke-width="8"/>`.
- Front card: `<rect x="260" y="320" width="424" height="520" rx="48" fill="#0a0a0a" stroke="#f2f2f2" stroke-width="40"/>`.
- Signal tab: `<rect x="584" y="236" width="140" height="64" rx="24" fill="#f5b544"/>`.
- 16 px tray: the two outlines merge into one thick rectangle and the tab becomes a 2 px speck.
- Template: the outlines only. It reads as a generic "document" glyph.

**Recommended: B.** It has the strongest silhouette at 16 px, it is the only one carrying the name's initial, and its one accent is the app's own running-lamp hue. The tray icon stays static; a "running" variant is not in scope.

**Asset pipeline.** Sources: `build/logo.svg` (1024 tile), `build/tile-small.svg` (32-box colored), `build/tray.svg` (32-box template), `build/tray16.svg` (16-box template). `node scripts/icons.mjs` (a new `npm run icons` script) runs on demand, not on build. It uses three tools:
- `@resvg/resvg-js` (a pinned devDependency, 2.6.2) rasterizes the SVGs. It ships prebuilt binaries and needs no ImageMagick or rsvg, neither of which is on this machine.
- `png-to-ico` (pinned, 3.0.2) builds the .ico files.
- `iconutil` (`/usr/bin`, present) builds the .icns. That step is macOS-only; on another OS the script logs one skip line.

Source per size (the rule the script encodes): **≤ 32 px → `tile-small.svg`** (colored) or `tray16.svg`/`tray.svg` (template); **≥ 48 px → `logo.svg`**. The .icns follows the same rule: its 16 and 32 px frames come from `tile-small.svg`, and its 64 px and larger frames keep Apple's padded tile from `logo.svg`.

It emits these files, all committed:
- `build/icon.png` (1024), plus `build/icons/{16,32,48,64,128,256,512,1024}x{…}.png` (the Linux set; 16 and 32 from `tile-small.svg`)
- `build/icon.icns` (from a generated `icon.iconset/` holding 16…512@2x; 16 and 16@2x/32 frames from `tile-small.svg`; the iconset itself is not committed)
- `build/icon.ico` (16, 24, 32 from `tile-small.svg`; 48, 64, 128, 256 from `logo.svg`)
- `build/trayTemplate.png` (16, from `tray16.svg`) and `build/trayTemplate@2x.png` (32, from `tray.svg`), black and alpha only
- `build/tray.png` (32) and `build/tray.ico` (16, 24, 32), all from `tile-small.svg`, for Windows and Linux

## 3. Menu

**macOS** (`process.platform === 'darwin'`). The first submenu's label is ignored by the OS (see §6).

| Menu | Items |
|---|---|
| Docket | `Docket Hakkında` (role `about`) · separator · `Ayarlar…` ⌘, (click → navigate `{kind:'settings'}`) · separator · `Servisler` (role `services`) · separator · `Docket'ı Gizle` (role `hide`) · `Diğerlerini Gizle` (role `hideOthers`) · `Tümünü Göster` (role `unhide`) · separator · `Çıkış` ⌘Q (role `quit`) |
| Düzen | roles `undo`, `redo`, sep, `cut`, `copy`, `paste`, `pasteAndMatchStyle`, `delete`, `selectAll` |
| Görünüm | roles `reload`, `forceReload`, `toggleDevTools`, sep, `resetZoom`, `zoomIn`, `zoomOut`, sep, `togglefullscreen` |
| Pencere | roles `minimize`, `zoom`, sep, `front`, and `role: 'windowMenu'` on the submenu |

**Windows and Linux.** The first menu is titled `Docket` too, so the order's shape (Docket · Ayarlar… · Çıkış) holds on every OS without a platform deviation:

| Menu | Items |
|---|---|
| Docket | `Ayarlar…` Ctrl+, · separator · `Docket Hakkında` (role `about`; Electron shows its own about panel, fed by `app.setAboutPanelOptions`) · separator · `Çıkış` (role `quit`) |
| Düzen, Görünüm | Same roles as macOS, minus `pasteAndMatchStyle` |
| Pencere | `minimize`, `close` |

There is no `Dosya` or `Yardım` menu. Every item carries an explicit `label`: a role keeps its native behavior, and the label only overrides the English default. `app.setAboutPanelOptions({ applicationName: 'Docket', applicationVersion: app.getVersion() })` is called on every OS.

**Visibility on Windows and Linux depends on the frame.** `createWindow` sets `titleBarStyle: 'hiddenInset'` and `trafficLightPosition` on every OS today (main.ts:114-115). Electron documents both as macOS options; on Windows and Linux a non-default `titleBarStyle` without `titleBarOverlay` hides the native title bar, and with it the in-window menu bar (and, likely, the window controls). This plan applies both options **only on darwin**, which gives Windows and Linux a normal frame with the menu bar. The renderer has no `-webkit-app-region` drag region and no traffic-light spacing (grep of `src/ui`, `src/index.css`: none), so nothing in the UI depends on the frameless shape. Today's Windows/Linux frame and this change's effect are UNVERIFIED on a real machine (§11b). If the operator declines the change (§12), the Windows/Linux menu is accelerator-only and §6 says so.

**Language ruling: fixed Turkish.**
- ADR-0007's bundles (`src/ui/data/labels/`, read through `useLabels()`) are the **component** display surface. The native menu and the tray are host chrome drawn by the OS from the main process, and no component renders them.
- Importing `src/ui/**` from `electron/` would make main depend on the UI layer. `tsconfig.electron.json` does not include `src/ui` (typecheck impact UNVERIFIED), and ADR-0006 keeps ui downstream of core, never upstream of the host.
- The chrome vocabulary is about 25 words. UI copy defaults to Turkish (ADR-0007), and the operator runs in `tr`.

Where the words live:
- `electron/chrome-words.ts` exports one frozen `CHROME_WORDS` object: menu labels, the tray quiet/header/secondary words, and the Linux hint log line.
- It imports nothing but types. It sits outside `src/ui`, so the c8 (non-ASCII) and c6 checks do not apply, and it names no vendor (c1 scans comments too).
- `src/core/tray-menu.ts` carries no words. It emits structure, and main maps structure to `CHROME_WORDS`.
- ADR-0007 gets a 2026-09-23 addendum recording two things: (1) native chrome vocabulary lives in `electron/chrome-words.ts`, Turkish-fixed; (2) native chrome (tray rows) renders the WO number **verbatim**, not through `woIdLabel` (which is identity today, tr.ts:291-293) — a second, host-side carve-out beside the component one. Locale-following chrome picks up `woIdLabel` parity in the named TD below.

**Follow-up (named, not built): TD entry "native chrome follows the UI locale".**
- It would add an `en` table beside `tr`, and route the WO number through the same formatter `woIdLabel` uses.
- Main would read `store.getLocale()` (main.ts:497), falling back to `app.getLocale()` with the `tr`-prefix rule.
- The menu and tray would be rebuilt in the `docket:settings:set-locale` handler (main.ts:498).

## 4. Tray

**Pure derivation: `src/core/tray-menu.ts`** (test-first, `src/core/__tests__/tray-menu.test.ts`). It imports core types only, no `electron`, and emits no display words.

```ts
export type RunningOwner =
  | { kind: 'wo'; woId: WorkOrderId; title: string | undefined } // title undefined while main's lookup is in flight
  | { kind: 'draft'; workspaceId: WorkspaceId };
export type TrayRow =
  | { kind: 'wo'; woId: WorkOrderId; title: string }   // title trimmed to TRAY_TITLE_MAX = 60 chars (… at 59)
  | { kind: 'draft'; workspaceId: WorkspaceId };
export interface TrayMenuModel {
  count: number;          // === owners.length — every owner counts, drafts included
  rows: TrayRow[];        // wo rows by woId ascending, then drafts; capped at TRAY_ROWS_MAX = 12
  overflow: number;       // owners beyond the cap (0 when none)
  quiet: boolean;         // count === 0 → main renders ONLY the quiet line «çalışan iş yok», no header
  secondary: ('board' | 'quit')[]; // always ['board', 'quit']
}
export type ChromeNavigate =
  | { kind: 'wo'; id: WorkOrderId }
  | { kind: 'draft'; workspaceId: WorkspaceId }
  | { kind: 'board' }
  | { kind: 'settings' };
export function trayMenuModel(owners: readonly RunningOwner[]): TrayMenuModel;
export function trayAllowed(env: { e2e: boolean; platform: string; display: boolean; wayland: boolean }): boolean;
export function linuxTrayHint(env: { platform: string; desktop: string | undefined }): 'gnome-no-sni-host' | undefined;
```

A `wo` row with an undefined title renders the id alone (title → `''`).

**Rendering in main** (`CHROME_WORDS`, fixed Turkish):
- **count > 0:** a disabled header item `N iş çalışıyor` (a native `enabled: false` MenuItem, not `src/ui`, so ADR-0001/c5 do not apply), then the rows.
  - Each row: `WO-0093 · <title>`. The id is shown verbatim (the host-side carve-out recorded in the ADR-0007 addendum, §3).
  - A draft row: `✦ Yol haritası taslağı`.
  - An overflow row: `+N daha`.
- **count = 0:** only the quiet line `çalışan iş yok`. No header: one short line, per ADR-0012's empty-surface rule and the order's "a quiet line when none run".
- Then a separator, `Pano'ya dön`, `Çıkış`.
- Tooltip: `Docket`, always. The count rides the menu only (the order's frozen decision: no display vocabulary on native chrome beyond the name and menu items).

**Source and parity.**
- The tray reads main's `activeDrives` (main.ts:579) through a parallel `driveOwners: Map<string, RunningOwner>`. It is set and deleted at exactly the `activeDrives` mutation sites: set main.ts:637, finally-delete 648-651 (under the same `get(tag) === entry` guard as the iterator), abort-delete 692.
- It never reads `liveRunnerInstances`, which leaks on abort (see 648 against 692).
- The appbar chip reads the renderer's `activeKeys.size` (drive-store.ts:170). Both key on the same owner tags (`driveOwnerTag`, runner.ts:258-260), one entry per live drive, and both count ✦ drafts (drive-store.ts:44-46). So the tray counts drafts too.
- "One truth" means the same owner-tag set. Three windows are named, where the two views lag:
  - At start, the renderer adds its key before main's two awaited reads (main.ts:597, 614). The lag is milliseconds.
  - On abort, main deletes at 692 before the renderer's stream ends.
  - After a renderer reload, the chip resets while main's drives run on. The tray is the more truthful view there.
- No UI change is made to close these windows. Out of scope: "the appbar chip stays".

**Titles.**
- On set, main creates the owner entry object, stores it, and starts `store.getWorkOrder(driveInput.workOrderId)` (source.ts:113). The id is already branded, so no `woid()` is needed.
- When it resolves, main applies the title **only if `driveOwners.get(tag) === entry`** (the same object it started for), then calls `notifyDrivesChanged()`. Otherwise the result is discarded with no notify, so a finished or aborted drive is never revived and a successor's entry is never overwritten.
- The title is not re-read mid-drive; a rename shows on the next drive.

**Refresh.**
- `notifyDrivesChanged()` runs at the three mutation sites and on title arrival.
- It is throttled with a **250 ms trailing** window.
- Each rebuild constructs the whole `Menu` and calls `tray.setContextMenu(menu)` (Linux requires the re-set). The tooltip is set once at creation.
- There is no polling.

**Click semantics.**
- macOS: `setContextMenu`, so a left click opens the menu (and `click` does not fire).
- Windows: `setContextMenu` for right click, and `tray.on('click', () => tray.popUpContextMenu())` so a left click also lists.
- Linux: `setContextMenu` only. The menu is the whole surface, since `click` activation varies by desktop.
- Row click: `showAndFocus()`, then push `{kind:'wo', id}` (or `{kind:'draft', workspaceId}`) with the branded ids the owner entry already holds.
- `Pano'ya dön`: `showAndFocus()`, then push `{kind:'board'}`.
- `Çıkış`: `app.quit()`.

**Close-window behavior.** The default stays today's (main.ts:741-743): quit on Windows and Linux, stay alive windowless on macOS. Two changes are **proposed only, not built**:
- A "keep running in the tray" mode on Windows and Linux.
- A fix to the latent risk that closing the window mid-drive throws on `event.sender.send` to a destroyed webContents (main.ts:639-645, UNVERIFIED) and ends the drive, even on macOS.

Both would guard the sends with `!event.sender.isDestroyed()` and target the current window. They are named as a follow-up TD entry, together with a **packaged-only single-instance lock** (a second tray and a second pipeline over one DB; dropped from this WO, see §13).

**Degrade.**
- `new Tray()` sits in try/catch; on a throw, log `[chrome] tray unavailable: <message>` once and continue.
- On Linux, `linuxTrayHint` (from `XDG_CURRENT_DESKTOP` containing `GNOME`) logs once: `[chrome] tray may be invisible: GNOME without a StatusNotifier host (AppIndicator extension)`.
- Electron gives no visibility signal (electron#53213). That is why the hint says "may", which keeps it honest.
- The window and menu remain the full surface.

**Electron pin.** Change `"electron": "^43.3.0"` to `"43.3.0"`. 43.4.1 and later break SNI registration on GNOME (electron#53213), and the caret range can resolve to 43.7.4.

## 5. Seam

**Deviation, stated plainly.** order.md says "no core/ui change". This plan adds:
- one pure core module (`src/core/tray-menu.ts` and its test)
- one renderer listener (`preload.ts`, `preload.d.ts`, `index.tsx`, `App.tsx`, `AppShell.tsx`)

It adds **no new visual surface**. Both are unavoidable:
- CLAUDE.md/ADR-0006 make derivation logic test-first in core, and order.md's own Scope asks for exactly that.
- Opening a WO's detail and the settings modal is renderer state. `selectedId`/`workspaceId`/`surface` live in App.tsx:43-57, and `settingsOpen` is local to AppShell.tsx:78. The only existing main→renderer push, `docket:runner:event`, lives only for the duration of one drive invoke (preload.ts:100-106), so the host cannot reach that state.

**Merge order — the order's "merge-order friendly" note no longer holds.** The note claimed this WO touches `electron/` + `package.json` + assets only. With the deviation it also touches `src/ui/app/App.tsx`, `src/ui/chrome/AppShell.tsx`, `src/renderer/*`, plus `electron/main.ts`, `electron/preload.ts` and `e2e/ui.mjs`. Measured 2026-09-23 in the neighbor worktrees (uncommitted/branch diffs, subject to change): **WO-0098** (`docket-waves/wo-0098`) touches `electron/main.ts`, `electron/preload.ts`, `src/ui/app/App.tsx`, `e2e/ui.mjs`; **WO-0099** (`docket-waves/wo-0099`) touches `electron/main.ts`, `electron/preload.ts`, `src/ui/app/App.tsx`. (`electron/main.ts`/`preload.ts` overlap even under the order's original scope.) Whether 0098/0099 touch `AppShell.tsx` or `src/renderer/*`: not in their current diffs; final state UNVERIFIED. **Proposed merge order: WO-0100 lands after 0098 and 0099** and rebases onto them; its edits to the shared files are additive (a new import, new maps beside `activeDrives`, one `useEffect`, one preload group), which keeps the rebase mechanical. The e2e count (§8) is re-based on whatever baseline 0098/0099 leave.

**electron/**
- `main.ts:6`: add `Menu, Tray, nativeImage` to the import.
- `main.ts:31`, right after `here`:
  ```ts
  const userData = app.getPath('userData'); app.setName('Docket'); app.setPath('userData', userData);
  ```
  This pins the directory, so window-state.json (main.ts:53-55) and localStorage never move.
- `main.ts:101-133` `createWindow`:
  - `titleBarStyle: 'hiddenInset'` and `trafficLightPosition` (main.ts:114-115) move behind `process.platform === 'darwin'` (§3; operator approves, §12).
  - Add `icon: resolve(chromeAssetDir(), process.platform==='win32' ? 'icon.ico' : 'icon.png')` for non-darwin only.
  - Assign to a module-level `let mainWindow: BrowserWindow | null` and clear it on `closed`.
  - Add `showAndFocus(): Promise<BrowserWindow>`. It restores if minimized, shows and focuses; with no window it calls `createWindow()` and resolves on `did-finish-load`. A push sent right after may still arrive before React subscribes; the preload buffer below covers that.
- `main.ts:579-581`: add `driveOwners` and `notifyDrivesChanged` beside `activeDrives`. Hooks go at 637 (set, plus the guarded title fetch), inside 648-651, and at 692.
- `main.ts:729-739` `whenReady`:
  - On win32, first: `app.setAppUserModelId(app.isPackaged ? APP_ID : process.execPath)`. `APP_ID` is one constant in `electron/chrome.ts` equal to `build.appId`; parity is asserted by the e2e guard spec (§8).
  - Before `createWindow()` at 735: `Menu.setApplicationMenu(buildAppMenu(...))`.
  - After it, if `trayAllowed(...)`: create the tray and, on darwin, `app.dock?.setIcon(resolve(chromeAssetDir(),'icon.png'))` (dev tile).
- **No** `requestSingleInstanceLock` in this WO (§4 close-window TD, §13).
- New `electron/chrome.ts`: `APP_ID`, `buildAppMenu(words, send)` and `buildTrayMenu(model, words, handlers)`, plus the tray lifecycle. It imports only `electron`, `./chrome-words` and core `tray-menu`. There are no adapter imports (c4), no `woid(`/casts (c2a/c2c: only main.ts is exempt), and no vendor substrings, the word "cursor" included (c1). Tray positioning uses `popUpContextMenu()`, never `screen.getCursorScreenPoint()`.
- New `electron/chrome-words.ts`: see §3.

**IPC: one push channel, `docket:chrome:navigate`.**
- Payload type `ChromeNavigate` (§4), exported from `src/core/tray-menu.ts`, with **branded** `WorkOrderId`/`WorkspaceId` fields, matching how `src/renderer/preload.d.ts:53-67` already declares IPC surfaces (ADR-0003's first line of defense). The declaration is type-only and constructs nothing; main fills it from the owner entries, which already hold branded ids from `driveInput`, so no brand constructor or cast is needed on either side.
- Main sends it via `mainWindow.webContents.send` after `showAndFocus()`.

**Renderer: the minimal listener, buffered in the preload.**
- `electron/preload.ts` (~line 123, the `exposeInMainWorld` surface). The preload registers the channel **once at load**, before React exists, and keeps the last unconsumed payload:
  ```ts
  let pendingNav: ChromeNavigate | undefined; let navCb: ((p: ChromeNavigate) => void) | undefined;
  ipcRenderer.on('docket:chrome:navigate', (_e, p) => { if (navCb) navCb(p); else pendingNav = p; });
  const chrome = { onNavigate: (cb) => { navCb = cb; if (pendingNav) { const p = pendingNav; pendingNav = undefined; cb(p); } return () => { if (navCb === cb) navCb = undefined; }; } };
  ```
  This covers the closed-window path (macOS keeps the app alive windowless, main.ts:741-743): `createWindow()` → `did-finish-load` → send can land before `createRoot().render` (src/renderer/index.tsx:17) commits and the `useEffect` subscribes. Without the preload buffer, `ipcRenderer` drops a message sent before anyone listens.
- `src/renderer/preload.d.ts:32-80`: add optional `chrome?: { onNavigate(cb: (p: ChromeNavigate) => void): () => void }`.
- `src/renderer/index.tsx:23`: pass `chromeNav={window.docket.chrome}` (an optional prop, so tests and fakes need nothing).
- `src/ui/app/App.tsx`: one `useEffect` subscribes and holds the latest request in a ref until `load === 'ready'`.
  - `wo`: `workOrders.find(w => w.id === p.id)`. Then `setWorkspaceId(wo.workspace)` and `setSelectedId(wo.id)` (the WO-0074 rule, App.tsx:584-590). An id that is not loaded triggers `refreshWorkOrders()` once, then a retry; if it is still unknown, it is a silent no-op.
  - `draft`: `workspaces.find(...)` → `setWorkspaceId`, `setSelectedId(null)`, `setSurface('roadmap')`. This is the goDraft pattern.
  - `board`: `setSelectedId(null)`, `setSurface('board')`.
  - `settings`: `setSettingsRequest(n => n + 1)`.
- `src/ui/chrome/AppShell.tsx:78`: add a `settingsRequest?: number` prop. Its effect runs `setSettingsOpen(true)` when the number changes (non-zero). The gear behavior is unchanged.
- No new words and no `.replace(`/`disabled`/hex values in ui (c5-c8 clean).

## 6. Dev-vs-packaged honesty table

Assumes the §3 frame change (hiddenInset darwin-only) is approved. If it is declined, every Windows/Linux "menu bar" cell below reads "none (frameless; accelerators only)".

| OS · run | Menu-bar / app name | Dock / taskbar name | Dock / taskbar icon | Window icon | Tray |
|---|---|---|---|---|---|
| macOS dev | Bold title **"Electron"** (the OS reads CFBundleName of `node_modules/electron/dist/Electron.app`); our submenus and role labels are ours; the About panel says Docket | **"Electron"** on hover | **Ours**, via `app.dock.setIcon` (the running tile only; Finder and ⌘-Tab keep Electron's) | n/a (macOS ignores `icon`) | Ours (template) |
| macOS packaged | **Docket** | **Docket** | Ours (`icon.icns`) | n/a | Ours (template) |
| Windows dev | In-window menu bar, first menu `Docket` (UNVERIFIED) | "Electron" (exe resources; AUMID = `process.execPath`, so it groups with electron.exe; pinned and jump lists stay Electron's) | **Ours**, the window's taskbar button via `icon.ico` (UNVERIFIED on a real machine) | Ours | Ours (`tray.ico`) |
| Windows packaged | In-window menu bar (UNVERIFIED) | **Docket**; AUMID = `APP_ID` = `build.appId`, so the running button, the Start-menu shortcut and renderer `Notification()` toasts share one identity (UNVERIFIED) | Ours (exe) | Ours | Ours |
| Linux dev X11 | In-window menu bar (UNVERIFIED) | Varies by desktop (WM_CLASS) | Ours via `_NET_WM_ICON` (UNVERIFIED) | Ours | Ours if an SNI/XEmbed host exists |
| Linux dev Wayland/GNOME | In-window menu bar (UNVERIFIED) | Generic (no .desktop file) | Generic | Generic (UNVERIFIED) | **Absent** without the AppIndicator extension; the hint is logged |
| Linux packaged (AppImage/deb) | In-window menu bar (UNVERIFIED) | **Docket** (.desktop) | Ours (icons/ set) | Ours | Same caveat as dev |

Every Windows and Linux cell is UNVERIFIED until the §11b route runs.

**Acceptance 1, answered.** "macOS dev-run shows Docket in the menu bar" is **not achievable** without rewriting Electron.app's Info.plist inside `node_modules`:
- `app.setName` does not reach the OS name (electron.d.ts:1773-1778).
- The first submenu's label is ignored.

This plan does **not** patch it silently. The patch would be:
- invisible to review
- undone by `npm ci`
- shared by every worktree
- a likely break of the ad-hoc signature seal (UNVERIFIED)

Proposed acceptance 1 wording for the operator to approve:

> 1. A packaged .app shows "Docket" in the menu bar, Dock and ⌘-Tab with our icon. A macOS dev-run shows our menu (Docket Hakkında · Ayarlar… · Çıkış + role groups), our Dock tile icon and an About panel reading Docket; its bold menu-bar title and Dock hover name read "Electron" (the OS reads the dev bundle's plist). That is a known dev limit, proven Docket on the packaged build.

Proposed acceptance 2-3 wording depends on the §12 route choice; see §11b.

## 7. Packager config

Add to `package.json`. The name stays `docket`; there is no top-level `productName` (it would rename `app.getName()` and move dev userData).

```json
"description": "Docket — work-order console",
"author": { "name": "<operator-confirmed>", "email": "<operator-confirmed>" },
"scripts": { "icons": "node scripts/icons.mjs", "pack": "npm run build && electron-builder --dir", "dist": "npm run build && electron-builder" },
"build": {
  "appId": "dev.docket.app",
  "productName": "Docket",
  "directories": { "buildResources": "build", "output": "release" },
  "files": ["dist/**", "dist-electron/**", "package.json"],
  "asarUnpack": ["node_modules/@anthropic-ai/claude-agent-sdk/**", "node_modules/@anthropic-ai/claude-agent-sdk-*/**"],
  "extraResources": [{ "from": "build", "to": "build", "filter": ["icon.png", "icon.ico", "tray*.png", "tray.ico"] }],
  "mac": { "icon": "build/icon.icns", "category": "public.app-category.developer-tools", "target": ["dmg", "zip"] },
  "win": { "icon": "build/icon.ico", "target": ["nsis"] },
  "linux": { "icon": "build/icons", "category": "Development", "target": ["AppImage", "deb"], "maintainer": "<operator-confirmed>" }
}
```

- **Packaged icon paths.** Main resolves `build/` as `app.isPackaged ? join(process.resourcesPath, 'build') : resolve(here, '..', 'build')`. This is one `chromeAssetDir()` helper in main.ts.
- **Provider SDK and asar.** The runner adapter imports the provider SDK (`src/adapters/runner/index.ts:20`, pinned 0.3.221 in package.json:19), which spawns its executable from `node_modules` — the platform binary lives in an optional per-platform package (`…-darwin-arm64`, `…-win32-x64`, `…-linux-x64`, …, per the SDK's `optionalDependencies`). A spawned file inside `app.asar` cannot be executed, so without `asarUnpack` a packaged build would open as Docket and then fail every drive through the adapter's `executable_missing` path (index.ts:898). The two globs above unpack the SDK and its platform packages. Only the platform package installed on the building machine is present, so each OS's package is built on that OS (cross-building is out). Whether the SDK resolves its binary from `app.asar.unpacked` without further configuration is UNVERIFIED; the ladder's pack step (§9, step 8) proves it by starting one drive.
- **Linux deb maintainer.** electron-builder's deb (fpm) target requires a maintainer (from `author.email`, or `linux.maintainer`) and stops without one; package.json has no `author`/`description` today. The values are operator-confirmed (§12). (UNVERIFIED by running it; known builder behavior.)
- **Output directory.** `release/` avoids vite's `dist/`. Add `release/` to `.gitignore`.
- **appId.** `dev.docket.app` is a placeholder the operator confirms (§12); it is also `APP_ID` (the Windows AUMID).
- **New devDependencies**, pinned exactly: `electron-builder` 26.15.3, `@resvg/resvg-js` 2.6.2, `png-to-ico` 3.0.2. Electron is pinned to `43.3.0`.
- **Explicitly out:** code signing (`mac.identity: null` is not set either; the builder's default ad-hoc behavior stands), notarization, auto-update (`publish` is left unset), and installer polish. These stay on ROADMAP `## Later` (ROADMAP.md:737).
- **CI.** CI does not run `pack`/`dist`. `npm ci` gets heavier by electron-builder's install size, which is accepted.

## 8. E2E guards

**One predicate, pure and tested:** `trayAllowed({ e2e: !!process.env.DOCKET_E2E, platform: process.platform, display: !!process.env.DISPLAY, wayland: !!process.env.WAYLAND_DISPLAY })`. It is false when `e2e` is true, or when `platform === 'linux' && !display && !wayland` (headless).

When it is false, main skips:
- the Tray
- `app.dock.setIcon`
- the Linux hint

These still run under E2E:
- `Menu.setApplicationMenu`: harmless to Playwright, and the renderer binds no Meta/Ctrl shortcuts.
- `app.setName`: userData is pinned, so the E2E userData is unchanged.
- The darwin-only frame options: E2E runs on macOS locally and changes nothing there.

(There is no single-instance lock, so the suite's three app launches, e2e/ui.mjs:38, 1634, 1773, need no guard for it.)

**Pinned guard spec.** Under `if (process.env.DOCKET_E2E)` (main.ts:711-727), add `ipcMain.handle('docket:e2e:chrome', () => ({ tray: tray !== null, name: app.getName(), appId: APP_ID }))`, and expose it in preload's e2e group (preload.ts:182). A new spec in `e2e/ui.mjs` asserts `{ tray: false, name: 'Docket' }` and `appId === package.json build.appId` (the AUMID parity check). The E2E baseline becomes **103 + 1 = 104** (re-based after 0098/0099 land, §5).

## 9. Test plan

**Core, test-first** (`src/core/__tests__/tray-menu.test.ts`, `describe('trayMenuModel (WO-0100)')`):
1. No owners: `count 0`, `rows []`, `quiet true`, `overflow 0`, `secondary ['board','quit']`.
2. One wo owner: one row carrying its woId and title, `quiet false`, `count 1`.
3. A draft owner is counted and gets a draft row. Count parity: `count === owners.length` for mixed input.
4. Order: wo rows by woId ascending regardless of input order, drafts after them.
5. A title longer than 60 is trimmed to 59 plus `…`; a title of exactly 60 is untouched.
6. An undefined title gives `''` and the row still renders.
7. 13 owners give 12 rows and `overflow 1`, while `count` stays 13.
8. The input array is not mutated.
9. `trayAllowed`: e2e → false; linux with no DISPLAY and no WAYLAND → false; linux with either → true; darwin/win32 when not e2e → true.
10. `linuxTrayHint`: linux + `ubuntu:GNOME` → hint; linux + `KDE` → undefined; darwin → undefined; undefined desktop → undefined.

The Electron surfaces (menu, tray, dock, window icon, preload buffer, title guard) are verified by running them, per CLAUDE.md.

**Ladder** (in the implementation round, after `npm ci`):
1. `npm run typecheck` (both tsconfigs)
2. `npm test` (baseline 1173 + about 14 new; the baseline is UNVERIFIED because grep counts 1109 declarations + 8 `.each`)
3. `npm run check:boundaries` (c1 over `electron/chrome*.ts`, c2/c4 for the new electron files, c3/c1 for the new core module, c5-c8 for the App/AppShell edits)
4. `npm run build`
5. `npm run test:ui` (104)
6. `npm run icons` reproduces the committed assets byte-stably (UNVERIFIED: resvg output determinism)
7. `npm run pack` builds a macOS `--dir` .app locally
8. Launch the packed `.app` (the operator, per the manual-check gate) and start one step drive: it must run, not end in `executable_missing` — the asarUnpack proof. If it fails and the fix is out of scope, §7 records "a packaged build cannot drive yet" and acceptance 2's packaged half is reduced accordingly.

## 10. Files touched

- **core:** `src/core/tray-menu.ts` (new); `src/core/__tests__/tray-menu.test.ts` (new).
- **ui / renderer:** `src/ui/app/App.tsx` (the navigate effect and `settingsRequest` state); `src/ui/chrome/AppShell.tsx` (the `settingsRequest` prop); `src/renderer/preload.d.ts` (the `chrome?` group plus `e2e.chrome`); `src/renderer/index.tsx` (pass `chromeNav`).
- **electron:** `electron/main.ts` (import, name/userData pin, darwin-only frame options, window icon and `mainWindow`/`showAndFocus`, `driveOwners` + guarded title fetch + notify hooks, AUMID, menu/tray/dock wiring, `chromeAssetDir`, e2e channel); `electron/chrome.ts` (new, incl. `APP_ID`); `electron/chrome-words.ts` (new); `electron/preload.ts` (buffered `chrome.onNavigate`, `e2e.chrome`).
- **build + scripts:** `build/logo.svg`, `build/tile-small.svg`, `build/tray.svg`, `build/tray16.svg`, and the generated `build/icon.{png,icns,ico}`, `build/icons/*.png`, `build/trayTemplate.png`, `build/trayTemplate@2x.png`, `build/tray.png`, `build/tray.ico`; `scripts/icons.mjs` (new); `.gitignore` (`release/`, `build/icon.iconset/`).
- **package.json / lock:** `description`, `author`; the `build` block (incl. `asarUnpack`, `linux.maintainer`); the `icons`/`pack`/`dist` scripts; three devDependencies; the exact electron pin; `package-lock.json`.
- **e2e:** `e2e/ui.mjs` (+1 spec).
- **docs:** this plan; an ADR-0007 addendum (native chrome words Turkish-fixed + the verbatim WO number on native chrome); `docs/tech-debt.md` (+2 entries: locale-following chrome; close-window/destroyed-sender + packaged-only single-instance lock); `ROADMAP.md` (WO-0100 line; Later stays).
- **Shared with queue neighbors** (merge order, §5): `electron/main.ts`, `electron/preload.ts`, `src/ui/app/App.tsx`, `e2e/ui.mjs`.

## 11. Operator manual scenario (given after implementation; `npm run dev`, about 6 minutes)

1. Start `npm run dev`. The Dock tile shows the D-lamp icon. The menu bar shows Docket's submenus. Open the first menu: `Docket Hakkında` shows an About panel reading "Docket". The bold title reads "Electron", as agreed in §6.
2. Press ⌘, : the existing Ayarlar modal opens. Close it.
3. Look at the menubar tray icon (the D glyph, recolored for your menubar theme). Hover it: the tooltip reads `Docket`. Click it: `çalışan iş yok`, `Pano'ya dön`, `Çıkış` — no count header.
4. Start a step drive on any WO. Within about a second the tray reads `1 iş çalışıyor` and `WO-NNNN · <title>`, and the appbar chip reads 1.
5. Switch to a different workspace in the app, then click that tray row. The window comes forward, the workspace switches back, and the WO's detail opens.
6. Close the window with ⌘W while the drive runs (the app stays alive, windowless). Click the tray row again: a new window opens and lands directly on that WO's detail (the preload-buffer path). If the drive itself died on close, note it — that is the named destroyed-sender TD, not this step's failure.
7. Start a ✦ roadmap draft as well. The tray shows 2 with a `✦ Yol haritası taslağı` row, and the chip shows 2. Click the draft row: the roadmap screen opens.
8. Stop both drives (Durdur or Zorla kes). The tray returns to `çalışan iş yok`.
9. Tray `Pano'ya dön` from a detail lands on the board. Tray `Çıkış` quits the app.

### 11b. Windows and Linux verification route

The scenario above is macOS-only; acceptance 2-3 cover Windows and Linux too. No Windows or Linux machine, VM or CI job was identified in this round. Two routes; the operator picks one (§12):

- **Route V — operator-run VMs** (e.g. UTM on this Mac: Windows 11 ARM and Ubuntu 24.04 GNOME, plus optionally a KDE live session). On each, from a checkout of the branch, `npm ci && npm run dev`, then:
  1. The window has a normal frame and a menu bar whose first menu is `Docket` (Ayarlar… · Docket Hakkında · Çıkış). Ctrl+, opens Ayarlar.
  2. The taskbar/window icon is the D-lamp (Windows: taskbar button; Linux X11: window icon; Wayland/GNOME: generic is expected, §6).
  3. The tray icon appears (Windows: notification area, maybe in the overflow chevron; KDE: yes; GNOME: only with the AppIndicator extension — otherwise the terminal shows the hint line). Left click (Windows) / click (Linux) lists `çalışan iş yok`.
  4. Start one drive: the tray lists `1 iş çalışıyor` + the row; clicking it opens the detail.
  5. Optional packaged check: `npx electron-builder --win --dir` / `--linux --dir` on the same VM, launch, repeat 1-3 and read the name (taskbar hover / .desktop).
  Acceptance 2-3 then read as written, with each §6 cell ticked or corrected.
- **Route R — stated reduction.** Acceptance 2-3 are reworded: "Windows/Linux: the config is present (icons, menu template, tray code path, builder block) and typechecks; the window/taskbar/tray behavior is UNVERIFIED until a machine is available, tracked as a TD." The §6 Windows/Linux cells stay UNVERIFIED on closure.

## 12. Open points needing the operator

1. Logo: approve direction **B (D-lamp)**, or pick A or C?
2. Acceptance 1: approve the §6 dev wording (the bold title stays "Electron" in dev), or do you want an opt-in, logged `predev` plist patch instead?
3. Identity values: appId/AUMID `dev.docket.app` (or another reverse-DNS id), plus the `author` name + email / Linux `maintainer` the deb target requires.
4. Close-window "keep running in tray" (Windows/Linux), the destroyed-sender fix, and a packaged-only single-instance lock: file all three as the follow-up TD (the plan's default), or pull any into this WO?
5. Frame change: make `hiddenInset` + traffic-light position macOS-only, so Windows/Linux get a normal frame and a visible menu bar (the plan's default), or keep today's frameless shape and accept an accelerator-only menu there?
6. Windows/Linux verification: Route V (you run VMs with the §11b steps) or Route R (reduced acceptance 2-3, cells stay UNVERIFIED + TD)?
7. Merge order: WO-0100 lands after WO-0098 and WO-0099 (the plan's default), since all three touch `electron/main.ts`, `electron/preload.ts` and `src/ui/app/App.tsx`.

## 13. Critique log

Round 1 (2026-09-23), 17 issues:
1. rules · single-instance lock is unrequested and breaks parallel worktree dev runs → **taken**: dropped from §1/§5/§8; a packaged-only lock is named in the close-window TD (§4, §12.4).
2. rules · no route to verify Windows/Linux for acceptance 2-3 → **taken**: §11b (Route V / Route R), §12.6.
3. rules · two lines at zero (header + quiet) → **taken**: header only when count > 0 (§4, §11 step 3).
4. rules · count-bearing tooltip is extra vocabulary → **taken**: tooltip is `Docket` always (§4).
5. rules · `ChromeNavigate` uses plain strings → **taken**: branded `WorkOrderId`/`WorkspaceId`, type moved into §4's core declaration.
6. rules · WO number verbatim bypasses `woIdLabel` unrecorded → **taken**: ADR-0007 addendum records the host-side carve-out; the TD carries parity (§3).
7. rules · Windows/Linux `Dosya`/`Yardım` shape is an unnamed deviation → **taken** by removing the deviation: the first menu is `Docket` on every OS (§3).
8. rules · core/ui deviation voids "merge-order friendly" → **taken**: §5 lists the measured overlap with 0098/0099 and proposes landing after them (§10, §12.7).
9. honesty · navigate push lost on the closed-window path → **taken**: preload-side buffer registered at load (§5), closed-window step added (§11 step 6).
10. honesty · single-instance lock keyed on shared userData → **taken** (same as 1).
11. honesty · `hiddenInset` on every OS hides the Windows/Linux menu bar → **taken**: frame options darwin-only, operator approves (§3, §5, §6, §12.5).
12. honesty · no AppUserModelId on Windows → **taken**: `setAppUserModelId` in whenReady, `APP_ID` = `build.appId`, parity asserted in the e2e guard spec (§5, §6, §8).
13. honesty · asar blocks the provider SDK's spawned binary → **taken**: `asarUnpack` for the SDK and its platform packages, ladder step 8 proves it (§7, §9).
14. honesty · deb target needs a maintainer → **taken**: `description`, `author`, `linux.maintainer`, operator-confirmed (§7, §12.3).
15. honesty · small rasters downscaled from the padded tile → **taken**: `tile-small.svg` feeds every ≤ 32 px raster (§2).
16. honesty · tray strokes on half-pixels → **taken**: half-unit centerlines for @2x, a separate 16-box `tray16.svg` for @1x (§2).
17. honesty · title fetch can revive a finished drive → **taken**: apply only if `driveOwners.get(tag) === entry` (§4).

None rejected.

## 14. Operator ruling (2026-09-23)

The operator approved the plan in the terminal ("önerinle en iyi şekilde yap") and delegated the §12 points to the assistant's recommendations:

1. Logo: direction **B (D-lamp)**.
2. Acceptance 1: the §6 dev wording is approved; no plist patch, opt-in or otherwise.
3. Identity: appId/AUMID `dev.docket.app`; `author` / Linux `maintainer` = `Enes Karadeniz <eneskrdnz28@gmail.com>` (the repository's git identity).
4. Keep-running-in-tray, the destroyed-sender fix and the packaged-only single-instance lock are filed as the follow-up TD; none join this WO.
5. Frame: `hiddenInset` + `trafficLightPosition` become macOS-only.
6. Windows/Linux: **Route R** — acceptance 2-3 reduce to the builder config + the code paths; the win/linux cells stay UNVERIFIED and are carried by the TD until a machine is available.
7. Merge order: WO-0100 lands after WO-0098 and WO-0099.

Electron pin to exactly `43.3.0` is approved; it matches the version the lockfile already resolves, so it changes nothing installed today.
