---
id: WO-0101
title: "The E2E suite stops fighting the machine and the operator — one suite per host, no window on screen"
workspace: docket
status: open
mode: direct # plan | direct
review: light # light | full
review_mode: gates
tracks:
  - repo: app
    depends_on: []
---

# WO-0101 — one suite per host, no window on screen

## Objective

Parallel worktrees each run their own `e2e/ui.mjs`. Measured 2026-09-23: load average 92-112,
25 Electron processes, four suites racing (main checkout, wo-0098, two agent worktrees). The
heaviest spec (the WO-0049 roadmap strip) hung on every run, and a sibling agent misread that
as a local flake. Every suite also opens a real, focused Electron window that steals the
operator's keyboard focus and bounces in the Dock. This WO fixes both at the harness level.

## Step 1 — the host-wide lock (lands now)

- `e2e/lock.mjs`: an atomic `mkdir` lock at `~/.docket/e2e.lock` (override:
  `DOCKET_E2E_LOCK_DIR`) holding `owner.json` {pid, cwd, token, startedAt}.
- A held lock is WAITED on; there is no bypass flag. The waiter logs who runs every 30 s.
- A dead owner (crash, `kill -9`), an owner older than 90 min (pid reuse guard;
  `DOCKET_E2E_LOCK_STALE_MIN`) or an owner-less dir older than 10 s is taken over. The takeover
  renames the dir aside and checks the token, so it never steals a fresh lock.
- Released on exit (normal and uncaught), SIGINT, SIGTERM and SIGHUP.
- `e2e/ui.mjs` takes the lock before seeding or launching.
- Proof: `npm run test:e2e-lock` (node:test, real processes). Four cases: waits-then-runs,
  two-at-once-never-overlap, kill -9 takeover, and SIGINT release.
- Interim rule: branches that do not have this code yet (every live worktree until it rebases)
  keep the brief rule "check `ps` for another `e2e/ui.mjs` before running; wait; never a broad
  `pkill`".

## Step 2 — no window on screen (after WO-0098/0099/0100 merge; they all touch `electron/main.ts`)

- Under `DOCKET_E2E`: `show: false` + `paintWhenInitiallyHidden: true` +
  `webPreferences.backgroundThrottling: false`; `app.dock.hide()` on macOS; no `focus()`.
  Playwright drives input over CDP, so it needs no OS focus.
- Proof: one visible run and one hidden run, then a pixel diff of every `docs/ui-shots` capture.
  If any capture differs or comes out blank, fall back to `showInactive()` (visible, but it
  never takes focus) with the Dock still hidden.
- `DOCKET_E2E_SHOW=1` restores today's visible window for debugging.
- Per-run userData isolation: each launch gets a temp userData dir. Today the suite writes the
  operator's REAL `localStorage` (ui.mjs's own comment), so concurrent suites and the
  operator's app share one theme key. With isolation, the harness-tail cleanup of that key
  can go.

## Acceptance

1. Two suites started together: one logs `sırada` and runs only after the other exits.
2. A `kill -9`'d suite's lock is taken over by the next run; Ctrl-C leaves no lock behind.
3. (Step 2) The full suite finishes with no window on screen and no focus theft; the
   screenshots match a visible run.
4. The E2E baseline does not drop; typecheck, unit, boundaries and build are green.

## Out

A CI-side change (CI runs one suite per job already); a general host-lock product feature
(the WO-0089 gate-lock pattern stays the candidate for that).
