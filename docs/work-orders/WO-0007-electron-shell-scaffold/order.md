---
id: WO-0007
title: Electron shell scaffold — renderer is the M1 prototype
workspace: docket
status: closed # draft | planning | plan-review | implementing | review | audit | merging | closing | closed
mode: plan # plan | direct
tracks:
  - repo: app
    depends_on: []
---

# WO-0007 — Electron shell scaffold — renderer is the M1 prototype

## Objective

Wrap the M1 React prototype in an Electron shell and move the composition root out of `src/dev-main.tsx`
into the Electron main process. The renderer becomes the existing `src/ui/` prototype unchanged; it reaches
the outside world only through the `WorkOrderSource` port already declared in `src/core/source.ts`, now
delivered across the process boundary by a preload script. The fixture-driven board must run inside an
Electron window, visually and behaviourally identical to today's Vite-only board. This is the shell the rest
of M2 bolts onto — no session runner, no SQLite, no real agents.

## Context

Paths into the decision store; the text lives in git, not here.

- `docs/adr/ADR-0004-technology-stack.md` — stack is Electron + TS + React + Tailwind; "the UI prototype …
  becomes the renderer of the Electron shell. Draw once, do not write twice."
- `docs/adr/ADR-0006-layering-and-provider-independence.md` — "Nothing imports an adapter except the
  composition root (`src/dev-main.tsx` now, the Electron main process later)"; "ui reaches the outside world
  only through a port defined in core."
- `docs/adr/ADR-0003-workspace-configuration-in-git.md` — identities constructed only in adapters.
- `docs/adr/ADR-0011-repository-conventions-and-mechanical-enforcement.md` — boundary checks are the second
  line of defence and must evolve with the layout.
- `src/dev-main.tsx` — current composition root; its own comment says "M2 replaces this harness with the
  Electron main process; nothing under src/core or src/ui moves."
- `src/core/source.ts` — the `WorkOrderSource` port the renderer consumes; `src/ui/app/App.tsx` consumes it.
- `scripts/check-boundaries.mjs` — `COMPOSITION_ROOT` and the Node-import rule (check 3/4) must be re-pointed
  at the main process.
- `docs/probes/cc-surface/findings.md` — M0 outcome (SDK-primary). Informs **WO-0008** (the runner), not this
  scaffold; cited only to mark the boundary between this WO and the next.

## Scope

In scope:

- Electron main process + preload script. Security defaults are non-negotiable: `contextIsolation: true`,
  `nodeIntegration: false`, `sandbox: true`.
- Renderer entry = the M1 prototype (`App` + screens). Vite serves it in dev; a static bundle is produced
  for the build.
- Composition root moves to main: the fixture `WorkOrderSource` adapter is wired in the main process; the
  renderer receives board data only through the `WorkOrderSource` port, realised across the boundary by the
  preload.
- `npm run dev` launches Electron against the Vite dev server; the board renders, fixture-driven.
- `npm run build` produces a runnable main + renderer build (not a distributable package).
- Boundary checks updated: main process + preload recognised as the Node-legal composition root; `core`/`ui`
  remain pure; `npm run check:boundaries` clean.

Out of scope:

- Agent SDK session runner, `canUseTool`, real sessions, xterm transcript (WO-0008 / M2 item 2).
- SQLite, session persistence, resume, token/cost accounting (later M2 items).
- Packaging, code signing, distribution (.dmg / .AppImage / .exe) — "Later" on the roadmap.
- Workspace connection management (WO-0004); `Forge`, health checks, reconciliation (M3).
- Visual hierarchy changes (WO-0003).

## Acceptance criteria

Numbered, each checkable by someone who did not do the work.

1. `npm run dev` opens an Electron window rendering the M1 board — both fixture workspaces, all six card
   states — visually identical to today's Vite-only board (screenshot evidence at the head sha).
2. The fixture `WorkOrderSource` adapter is imported only by the Electron main process. No module under
   `src/ui/` or `src/core/` imports it. Boundary check 4 (adapter imports) is clean.
3. No module under `src/core/` or `src/ui/` imports an Electron or Node specifier (`electron`, `node:*`,
   `fs`, `path`, `child_process`). The renderer receives board data only through the `WorkOrderSource` port.
   Boundary check 3 (Node imports in core/ui) is clean.
4. `scripts/check-boundaries.mjs` treats the Electron main process and preload as the Node-legal composition
   root and continues to forbid those imports in `src/core/` and `src/ui/`. `npm run check:boundaries`
   reports clean.
5. The main/preload source shows `contextIsolation: true`, `nodeIntegration: false`, `sandbox: true`, and the
   preload exposes **only** the board-data port to the renderer (no `require`, no `fs`, no Node surface).
6. `npm run build` succeeds, and the built Electron app launches and shows the board with no dev server
   running.
7. `tsc --noEmit`, `npm test`, `npm run build`, and `npm run check:boundaries` are all green on the PR.

## Evidence required

What must exist before this work order can pass each gate.

- plan_approval: architect verdict, `plan.md` committed
- pr_open: PR URL, head sha
- ci_green: all required checks `success`
- verification: verifier report, all `path:line` pointers resolve at the head sha; a screenshot of the board
  running inside an Electron window
- closure: all tracks merged, `ROADMAP.md` + `docs/tech-debt.md` updated (commit sha)

## Stop-and-ask gates

Points where the implementer must stop and report rather than decide alone.

- **Port synchronicity — the crux.** `WorkOrderSource` (`src/core/source.ts`) is synchronous and `App`
  (`src/ui/app/App.tsx:11-34`) calls it inline during render. IPC across the main↔renderer boundary is async.
  Two paths: (a) keep the port synchronous — ship the fixture dataset main→renderer at startup, have the
  preload re-expose the existing interface, leave `core` and `App` untouched; or (b) make the port async now
  (Promises), which forces loading states into `App`/screens and changes `core` before a second data source
  exists. Recommended: **(a)** for this scaffold — ADR-0006 wants `core` stable, and the async cost is
  justified only when SQLite lands (a later M2 WO). The `plan.md` must state the choice and rationale before
  the bridge is implemented.
- **Layout on disk.** `electron/{main,preload}.ts` at the repo root vs. `src/{main,preload}/`, and how
  `check-boundaries.mjs` enumerates the Node-legal set (an explicit path list vs. a marker comment). Report
  the layout before wiring.
- **`src/dev-main.tsx` disposition.** Keep it for component-only Vite development (the boundary checker still
  names it) or delete it once Electron is the sole entry. Report the call.

## Notes

- This WO does **not** depend on the SDK decision; the session runner is WO-0008. ADR-0004's open "CLI spawn
  or Agent SDK" item is now resolved by the M0 probe but not yet recorded as a decision — an ADR-0012 is an
  optional companion, and it fits WO-0008 better than this scaffold.
- TD-013 (branch protection) is still open, so this WO's `ci_green` is observed, not enforced, until TD-013
  closes.
- The seam already exists: `WorkOrderSource` in `src/core/source.ts`, consumed by `App`. The scaffold's whole
  job is to move the *wiring* of that port across the process boundary without disturbing `core` or `ui`.

## Closure record

Merged `c1feaad` (PR #4). `ci_green`: the `check` job succeeded on run 30957990813; GitGuardian succeeded.
ROADMAP: the M2 "Electron + TS scaffold" bullet is checked and annotated. tech-debt: TD-017 (sync IPC bridge,
throwaway) and TD-018 (`shot.mjs` broken) opened.

Verification (operator-covered, solo — no separate architect session; per ADR-0001 the reason is recorded
here): the board renders inside the Electron window in both `npm run dev` and `npm start`, fixture-driven
and visually identical to the M1 Vite board (screenshot waived by the operator). Adversarial review found no
blocking defects. Resolving pointers at head `b1f9d02` (PR head; content unchanged by the merge):

- **AC2** — fixture adapter imported only by the composition root: `electron/main.ts:9`
  (`createFixtureSource`). No adapter import under `src/`; boundary check 4 clean.
- **AC3** — no Electron/Node specifier in `core/`, `ui/`, `renderer/`: boundary check 3 clean
  (`scripts/check-boundaries.mjs` extended to `src/renderer/`). The renderer entry `src/renderer/index.tsx`
  imports only `react-dom`, `App`, and `index.css`.
- **AC4** — `scripts/check-boundaries.mjs` treats `electron/main.ts` as the Node-legal composition root and
  scans `electron/`; `npm run check:boundaries` clean (7/7).
- **AC5** — security posture: `contextIsolation: true`, `nodeIntegration: false`, `sandbox: true`
  (`electron/main.ts:30-32`); the preload exposes exactly one surface — `{ source }` — and uses only the
  `contextBridge`/`ipcRenderer` sandbox subset (`electron/preload.ts:7,26`). No Node surface leaks to the
  renderer.
- **AC6** — `npm run build` produces `dist/` (renderer) + `dist-electron/{main.js,preload.cjs}`; the built
  app launches and shows the board.
- **AC7** — `npm run typecheck` (both `tsconfig.json` and `tsconfig.electron.json`), `npm test` (75/75),
  `npm run build`, `npm run check:boundaries`: green locally and on CI.

Carried forward: the sync bridge is throwaway (TD-017); dev mode runs Electron with `--no-sandbox` (a
vite-plugin-electron dev convention — the built app does not), which does not affect `webPreferences.sandbox:
true` or AC5.
