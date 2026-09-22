// electron/chrome-words.ts — the NATIVE chrome vocabulary (WO-0100, ADR-0007's 2026-09-23 addendum).
//
// The native menu and the tray are host chrome the OS draws from the main process; no component
// renders them, so they sit outside the per-locale bundles (`src/ui/data/labels/`, read through
// `useLabels()` — the COMPONENT display surface). Importing `src/ui/**` from here would make the host
// depend on the UI layer (ADR-0006), so the ~25 words live in this one frozen table instead.
//
// The table is Turkish-fixed (the operator ruling of 2026-09-23). Following the UI locale is a named
// follow-up (TD-062): an `en` table beside this one, rebuilt from the set-locale handler.
// Every function that takes a number or an id returns a string; nothing here reaches `src/`.

export const CHROME_WORDS = Object.freeze({
  /** The app's own chrome name — the CLAUDE.md carve-out ("Docket as the application's own chrome name"). */
  appName: 'Docket',

  // --- the native menu (plan §3) ---
  menuAbout: 'Docket Hakkında',
  menuSettings: 'Ayarlar…',
  menuServices: 'Servisler',
  menuHide: "Docket'ı Gizle",
  menuHideOthers: 'Diğerlerini Gizle',
  menuUnhide: 'Tümünü Göster',
  menuQuit: 'Çıkış',

  menuEdit: 'Düzen',
  menuUndo: 'Geri Al',
  menuRedo: 'Yinele',
  menuCut: 'Kes',
  menuCopy: 'Kopyala',
  menuPaste: 'Yapıştır',
  menuPasteAndMatchStyle: 'Yapıştır ve Stili Eşleştir',
  menuDelete: 'Sil',
  menuSelectAll: 'Tümünü Seç',

  menuView: 'Görünüm',
  menuReload: 'Yeniden Yükle',
  menuForceReload: 'Zorla Yeniden Yükle',
  menuToggleDevTools: 'Geliştirici Araçları',
  menuResetZoom: 'Gerçek Boyut',
  menuZoomIn: 'Yakınlaştır',
  menuZoomOut: 'Uzaklaştır',
  menuToggleFullscreen: 'Tam Ekran',

  menuWindow: 'Pencere',
  menuMinimize: 'Küçült',
  menuZoom: 'Büyüt',
  menuFront: 'Tümünü Öne Getir',
  menuClose: 'Kapat',

  // --- the tray (plan §4) ---
  /** The header above the rows — rendered only when at least one drive runs. */
  trayRunning: (n: number): string => `${n} iş çalışıyor`,
  /** The ONLY line when nothing runs (ADR-0012's empty-surface rule: one short line, no header). */
  trayQuiet: 'çalışan iş yok',
  /** A work-order row: the WO number VERBATIM (the host-side carve-out), then the title when known. */
  trayWoRow: (id: string, title: string): string => (title === '' ? id : `${id} · ${title}`),
  /** A ✦ roadmap draft row. */
  trayDraftRow: '✦ Yol haritası taslağı',
  /** The overflow row beyond the row cap. */
  trayOverflow: (n: number): string => `+${n} daha`,
  trayBoard: "Pano'ya dön",
  trayQuit: 'Çıkış',

  // --- the honest-degrade log lines (plan §4; operator-facing terminal output, not UI copy) ---
  logTrayUnavailable: (message: string): string => `[chrome] tray unavailable: ${message}`,
  logDockUnavailable: (message: string): string => `[chrome] dock icon unavailable: ${message}`,
  logGnomeHint: '[chrome] tray may be invisible: GNOME without a StatusNotifier host (AppIndicator extension)',
});

export type ChromeWords = typeof CHROME_WORDS;
