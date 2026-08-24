---
id: WO-0040
title: Tema seçici — Sistem/Açık/Karanlık, ThemeProvider, the settings selector
workspace: docket
status: draft
mode: plan
tracks:
  - repo: app
    depends_on: []
---

# WO-0040 — Tema seçici (Sistem/Açık/Karanlık, ThemeProvider, selector)

## İçindekiler

- [Objective](#objective)
- [Context](#context)
- [Scope](#scope)
- [Acceptance criteria](#acceptance-criteria)
- [Evidence required](#evidence-required)
- [Stop-and-ask gates](#stop-and-ask-gates)
- [Notes](#notes)

## Objective

The console gains a three-mode theme: **Sistem** (follows the OS, the default when nothing is
picked), **Açık** (light), **Karanlık** (dark) — one `Tema` Segmented in Settings under the DİL
section, the WO-0035 pattern verbatim. Dark becomes layered black (page `#000000`, cards a step
up — replacing the navy palette); light is pure white with warm-gray ink; accents gain light
variants holding ~4.5:1 text contrast on white. The mechanism stays ADR-0007's semantic tokens:
`@theme` holds the dark defaults, one `:root[data-theme='light']` override block is the whole
light theme, `src/ui` keeps zero color literals. Theme is renderer-local localStorage by the
standing ruling (`src/core/app-settings.ts` header: presentation only) — no port, no DB row, no
`src/core` change. ADR-0007's theming half is revived by a dated addendum, reversing its
2026-08-21 dead-note.

## Context

- docs/adr/ADR-0007-localisation-and-theming.md — the original decision (light/dark/system,
  semantic tokens) and the 2026-08-21 addendum that killed its theming half (dark-only,
  ADR-0012). This order appends the 2026-08-24 reversal; the dead-note stands as history.
- src/core/app-settings.ts:4 — the standing ruling this order implements: "theme stays
  renderer-local localStorage because it is presentation only" (machine-local like window state;
  the locale keeps its `app_setting` row).
- src/index.css — the whole color system: `@theme` tokens (:15-31), `:root { color-scheme:
  dark }` (:34-36), and the six stray literals to tokenize (scrollbar hover `#3a4a63` :61,
  `.steprow.owner` `#33445f` :440, four glow `rgba()` stops :328-342). The hljs block (:576-619)
  is already token-driven. 354 token-utility uses across 43 files; zero color literals in src/ui.
- src/ui/data/locale.tsx — the provider precedent: synchronous localStorage rehydration in the
  `useState` initializer, tolerant of storage failure, optimistic adopt, provider above the only
  ErrorBoundary. `resolveSystemLocale` has no unit test (UI code is run-verified, CLAUDE.md).
- src/ui/chrome/AppSettingsModal.tsx:78-90 — the DİL section this order clones for TEMA;
  src/ui/kit/Segmented.tsx — the selector widget.
- src/renderer/index.tsx — the mount chain (ThemeProvider inserts inside LocaleProvider, above
  the ErrorBoundary).
- electron/main.ts:86-103 — `createWindow` has no `backgroundColor` today; the pre-render window
  fill must follow the OS (`nativeTheme.shouldUseDarkColors`).
- e2e/ui.mjs:1198-1203 — the pinned `rgb(76, 195, 138)` assertion (dark proceed, unchanged) and
  the four launch sites that need a `colorScheme` determinism pin (:42, :1433, :1565, :1587).
- ROADMAP.md:318-320 — the "Theme … DEAD" bullet this order flips at closure.

## Scope

In scope:

- index.css: dark palette swap to layered black (`#000000/#0a0a0a/#171717/#262626/#f2f2f2/#8f8f8f`,
  accents unchanged); the `:root[data-theme='light']` override block in `@layer base`
  (`#ffffff/#ffffff/#f2f2f0/#e3e3e0/#191917/#6e6e69` + light accents `#9a6700/#1a7f37/#0969da/
  #cf222e` + `color-scheme: light`); the six stray literals become `var()`/`color-mix` forms;
  header comment rewrite.
- `src/ui/data/theme.tsx`: ThemeProvider/useTheme/resolveTheme — the locale.tsx mirror, prop-less
  (no port), localStorage key `docket.theme`, `data-theme` on `documentElement`, live
  `matchMedia('(prefers-color-scheme: dark)')` subscription under Sistem, catch-guarded storage.
- Labels: `UI.theme/themeSystem/themeLight/themeDark` in both bundles (Tema/Theme,
  Sistem/System, Açık/Light, Karanlık/Dark).
- AppSettingsModal: the Tema section (DİL's byte-for-byte pattern) + header-comment truth fix;
  AppShell.tsx:4 comment fix.
- renderer/index.tsx: ThemeProvider mount.
- electron/main.ts: `backgroundColor: nativeTheme.shouldUseDarkColors ? '#000000' : '#ffffff'`
  at window creation.
- E2E: `emulateMedia({ colorScheme: 'dark' })` after each of the four `firstWindow()` sites; one
  new spec (Açık pins light incl. computed bg + mirror + screenshot, Karanlık pins dark, Sistem
  follows a live OS flip).
- Ray transcript tool families (round 2, operator 2026-08-24: "komut çalıştır, sohbet, dosya yaz
  gibi yerlerin renkleri belli olmuyor"): three kind tokens — `--color-exec` (Bash; cyan
  `#4ac3ce` / teal `#0f766e`), `--color-write` (Write/Edit/MultiEdit/NotebookEdit*; violet
  `#a371f7` / `#8250df`), `--color-remote` (WebFetch/WebSearch/Task; pink `#d879b8` /
  `#bf3989`) — in both token blocks; `TOOL_FAMILY` in ChatTranscript colors the 7rem LABEL
  column only (reads/search/unknown ride inkdim — the noise floor); the ▸ glyph goes inkdim.
  Kind, state and role stay three disjoint hue sets; all text usages ≥4.5:1 on the composited
  block surfaces (ui-ux-designer spec, ratios computed).
- Docs: ADR-0007 addendum (2026-08-24 revival + palette + localStorage narrowing + light
  accents); ROADMAP tick + tech-debt entries at closure.

Out of scope:

- Port/DB/IPC changes (`src/core` untouched; no new channel, so TD-036 does not arise).
- CLI (never renders color).
- Light-tuned glow strengths (the dark percentages ride `color-mix`; a light pass is tech-debt).
- index.html Google-Fonts cleanup (noted as debt; unrelated).
- Per-surface light polish beyond the token flip; theme-switch animation (the console snaps).

## Acceptance criteria

1. Three modes selectable in Settings, instant, no restart; Sistem is the default with nothing
   stored; the Segmented shows the stored mode. E2E.
2. Sistem follows a LIVE OS flip without any click (E2E via `emulateMedia` mid-session); an
   explicit pick needs no subscription and wins until changed.
3. Dark is layered black and light is pure white, both by tokens only: `:root[data-theme='light']`
   carries all ten overrides; the six former `index.css` literals are `var()`/`color-mix` forms;
   zero color literals in src/ui (`check:boundaries` unchanged in spirit, grep clean).
4. Light accents pass ~4.5:1 as text on white (spot-checked: 4.87–5.35:1); dark accents unchanged
   (the pinned `rgb(76, 195, 138)` e2e assert still passes under the dark pin).
5. Persistence is `docket.theme` localStorage only: an explicit pick survives restart; detection
   never writes; a garbage value reads as unset. No `app_setting` row, no IPC channel.
6. First paint is themed: the `useState` initializer applies `data-theme` synchronously (the
   locale precedent); the Electron window's native fill follows the OS so a light-OS boot shows
   no black flash before the renderer paints.
7. E2E: the new spec green; all existing specs green under the dark determinism pin (additions
   only to ui.mjs where the pin sites demand).
8. Docs: ADR-0007 dated addendum; the two stale comments (AppSettingsModal, AppShell) + the
   index.css header tell the truth; ROADMAP + tech-debt at closure.
9. CI green: typecheck (both tsconfigs), test, build, check:boundaries, test:ui.

## Evidence required

- plan_approval: architect verdict, `plan.md` committed
- pr_open: PR URL, head sha
- ci_green: all required checks `success`
- verification: verifier report, all `path:line` pointers resolve at head sha
- closure: all tracks merged, `ROADMAP.md` + `docs/tech-debt.md` updated (commit sha)

## Stop-and-ask gates

- The light accent hexes (`#9a6700/#1a7f37/#0969da/#cf222e`) and the light screenshots
  (board + detail + Settings in Açık) — the operator reviews the light face before the E2E
  round freezes (the mockup approved layering, not pixel values).
- The white-face residue call: backdrop-blur header over white-on-white and the glow washes on
  white — if the operator's screenshot pass reads either wrong, the fix (a light `--color-surface`
  head value / tuned wash strengths) is a palette decision to surface, never a silent change.
- If `emulateMedia` proves flaky on this Playwright/Electron pair AND the localStorage-seed
  fallback also fails — stop and ask; do not weaken the pinned-color assert.

## Notes

- The dark palette CHANGES the shipped dark look (navy → black) — the operator's explicit ask
  ("dark siyah olsun"); every existing surface re-renders on the new tokens with no component
  edits (354 token uses ride the swap).
- The `rgb(76, 195, 138)` pin at ui.mjs:1203 is load-bearing exactly like seed.ts's
  `locale='tr'` (TD-041's twin): it holds only because dark proceed is unchanged AND the harness
  pins dark. The pin lines are documented here so nobody "simplifies" them away.
- Accepted residue (tech-debt at closure): the native window fill follows the OS, not the in-app
  explicit pick (an Açık session on a dark OS boots with one dark native frame); glow strengths
  keep their dark-tuned numbers on white; a light-OS Sistem boot may paint the CSS-default dark
  for the renderer-module gap (the locale ~100ms class — recorded, not engineered around).
- index.html keeps no theme markup (the `lang` precedent: no visible surface before React
  mounts; the provider applies `data-theme` synchronously in the initializer).
- **No E2E userData isolation** (found live 2026-08-24): `electron.launch` shares the operator's
  REAL userData, so localStorage (theme mirror AND the locale mirror) persists across suite runs
  and into the operator's app. The harness boot pin therefore stamps `docket.theme='dark'` +
  reboots once (a crashed prior run's leftover 'light' beats `emulateMedia` — an explicit pick
  needs no listener), and the tail removes the key (the operator stays on Sistem). A tech-debt
  entry at closure: give the suite an isolated userData.
