---
id: WO-0100
title: "The app's own face — Docket, not Electron: name, logo, native menu, and a tray that shows the running work"
workspace: docket
status: closed
mode: plan # the operator ruled 2026-09-22: this one is PLANNED in the Claude Max terminal before it is built
review: full # light | full
review_mode: gates
tracks:
  - repo: app
    depends_on: []
---

# WO-0100 — the app's own face

## Objective

Today the app wears Electron's clothes (measured 2026-09-22): no `productName`, no
`app.setName`, no `Menu.setApplicationMenu`, no `Tray`, no icon assets, no packager — so dev-run
shows the Electron name, the Electron logo, and a default menu on every OS. This WO gives the
app its own face: **the name Docket everywhere, our logo, a proper native menu, and a
system-tray presence whose click shows the RUNNING work orders** — on macOS, Windows and Linux.
The operator's ruling: this round is PLANNED first (the plan is reviewed and approved by the
operator in the terminal before any implementation).

## Context (measured 2026-09-22)

- `package.json`: `name: "docket"`, `main: dist-electron/main.js"`, `dev` = vite + `electron .`
  — no `productName`, no `build` block, no electron-builder; no `build/`·`resources/`·icon dirs.
- `electron/` has no menu/tray/name code (grep clean) — every identity surface is the Electron
  default.
- The running-work fact already exists main-side: the keyed active-drive map (WO-0088's
  `activeDrive` + the owner tags) and the renderer's running-count chip — the tray reads the
  same truth, never a second source.

## Frozen decisions (2026-09-22, operator)

- **The name is Docket** — the CLAUDE.md carve-out ("Docket as the application's own chrome
  name is allowed") is exactly this; the word appears in the menu bar, the tray, the dock/taskbar,
  packaged metadata. No other display vocabulary rides the native chrome beyond menu items.
- **The tray shows the RUNNING work orders** (the wave's at-a-glance need): id + title per
  running drive, click → focus the window AND open that work order's detail; a quiet line when
  none run ("çalışan iş yok" — informative, not empty); the count matches the appbar chip
  (one truth, two views).
- **Identity now, distribution later.** This WO lands: name, icons (app + tray + window, all
  three OS asset forms), the native menu, the tray, and the packager CONFIG (electron-builder
  mac/win/linux block, ready to build). Signing, notarization, auto-update, installer polish
  stay on ROADMAP's Later line — untouched.
- **E2E safety:** the tray and any platform-touchy path are guarded OFF under `DOCKET_E2E` /
  headless environments — the suite (103 baseline) never regresses for a tray that cannot exist
  in CI.

## Open design questions — THE PLAN ROUND SETTLES THESE (operator approves before build)

- **The logo.** Operator-provided art vs designed in-round (a simple geometric mark in the app's
  warm-dark palette, delivered as source + exported sizes). The PLAN proposes 2-3 textual
  directions with exact geometry/colors, the operator picks ONE; assets land under `build/`
  (icns · ico · pngs · a macOS template image for the menubar, which adapts to light/dark).
- **Menu shape.** The app menu (Docket · Ayarlar… · Çıkış) + role-based Edit/View/Window groups
  (roles give native behaviors free: clipboard, zoom, fullscreen); menu LANGUAGE — Turkish
  labels vs system-locale-following (native chrome is not the locale-bundle surface; the plan
  argues one).
- **Tray behavior.** Refresh cadence on drive events (throttled); what closing the window means
  (quit vs keep-running-with-tray — a behavior CHANGE, the plan proposes, default stays
  today's); the tray's secondary items (Pano'ya dön, Çıkış).
- **Window icon on Linux/Windows dev runs** (BrowserWindow icon) vs packaged-only honesty —
  the plan states what each OS shows in dev vs packaged, so nothing is claimed that is not true.
- **Where the tray lives in the code** — composition-root wiring reusing the keyed drive map;
  no core/ui change (the tray is host chrome reading main-side facts; the plan names the seam).

## Scope

**In**: app.setName/productName; the icon asset set; the native menu; the tray (cross-platform)
reading the running drives; the electron-builder config block (three OSes); dev-honest icon
paths (dock icon on macOS dev, window icon on win/linux); E2E guards; tests where the house
discipline reaches (pure logic — e.g. the tray-menu derivation from the drive snapshot —
test-first in core; the Electron surfaces verified by running them, per CLAUDE.md).
**Out**: signing/notarization/auto-update/installer polish (Later); in-app UI changes (none —
the appbar chip stays); a second window or preferences-native panel (Ayarlar opens the existing
settings modal); Linux distribution formats beyond the builder config.

## Acceptance

1. macOS dev-run AND a packaged .app show "Docket" in the menu bar (not Electron), the custom
   menu (Docket · Ayarlar · Çıkış + role groups), and the dock carries our icon.
2. The tray exists on all three OSes (or degrades honestly with a logged reason where a
   desktop lacks a tray): our icon, click → the running work orders (id + title), a click on
   one focuses the window and opens its detail; none running → the quiet line; the count never
   disagrees with the appbar chip.
3. Windows and Linux: the window and packaged app carry name + icon (the plan's dev-vs-packaged
   honesty table is what review checks against).
4. The logo asset set is complete (icns · ico · pngs · template) and sourced (the picked
   direction recorded in the plan).
5. E2E 103 baseline unaffected (guards pinned); unit/boundaries/typecheck/build green — any
   new pure logic (tray-menu derivation) is test-first.
6. The PLAN round happened first: plan.md exists, was reviewed by the operator, and the
   implementation matches the approved plan (deviations named in the PR body).

## Notes

- ADR-0007 note: native-menu labels are chrome vocabulary, not component display copy — the
  plan's language ruling gets recorded; if the ruling lands "locale-following", the follow-up
  is named in the plan, not smuggled in here.
- This WO is terminal-wave work (Claude Max, per the operator's assignment); the kickoff
  instructs the plan-first flow.
- Queue neighbors unaffected: 0098/0099 ride the create seam; this one touches electron/ +
  package.json + assets only — merge-order friendly.

## Closure (2026-09-23)

- The plan round came first: plan.md (a483326) decided every open question. Two adversarial
  critique passes were folded in (§13), and the operator's ruling is in §14. The
  implementation follows it, with the deviations named in §15 (⌘W kept through Pencere →
  Kapat, a 16 px whole-pixel icon source, `&` escaped in tray titles, Ayarlar… delivered even
  when the board load failed).
- The logo changed after the operator saw B (D-lamp) in the running app. Five fresh
  directions were compared side by side, and the operator picked **C "Kuyruk"** (§16). Every
  asset was regenerated from the new SVG sources.
- Acceptance 1 holds as reworded in §6. The macOS dev bold title and Dock hover name read
  "Electron" (the dev bundle's plist; no patch). The packaged .app carries Docket. The operator
  saw the dev limit live and declined a pack run this round.
- Acceptance 2-3 are reduced by Route R. Windows/Linux config and code paths exist and
  typecheck; every win/linux cell is UNVERIFIED and carried by TD-064 (plus the appbar's macOS
  inset / drag region on framed windows). Follow-ups: TD-062 (locale-following chrome) and
  TD-063 (keep-running-in-tray, the destroyed-sender fix, a packaged-only single-instance lock).
- The order's "no core/ui change" gave way to one pure core module (`src/core/tray-menu.ts`,
  test-first) and one ui navigate listener, with no new visual surface. The plan stated this
  up front (§5).
- Merge order: the operator ruled this lands ahead of WO-0098/0099 (overriding §14.7); both
  rebase onto it (shared: `electron/main.ts`, `electron/preload.ts`, `src/ui/app/App.tsx`,
  `e2e/ui.mjs`).
- Ladder at merge (rebased on 1132750): typecheck ×2 · unit 1222/1222 · boundaries · build ·
  E2E 105/105 (one run, load ~25, no other suite) · CI green.
- PR #101 (https://github.com/eneskaradeniz/docket/pull/101), head `6f12fff`, merged
  `e4a52a7`; closed at the commit carrying this line.
- Manual tour: the operator ran `npm run dev` for the name and logo checks. The rest of §11
  was delegated.
