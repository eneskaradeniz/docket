---
id: WO-0009
title: SQLite state store — read foundation (async port, observed|owned schema, TD-017 paid)
workspace: docket
status: closed # draft | planning | plan-review | implementing | review | audit | merging | closing | closed
mode: direct # plan | direct
tracks:
  - repo: app
    depends_on: []
---

# WO-0009 — SQLite state store (read foundation)

## İçindekiler

- [Objective](#objective)
- [Context](#context)
- [Scope](#scope)
- [Acceptance criteria](#acceptance-criteria)
- [Evidence required](#evidence-required)
- [Notes](#notes)
- [Verifier return (blocking — both fixed)](#verifier-return-blocking--both-fixed)
- [Closure record](#closure-record)

## Objective

Replace the in-memory fixtures + throwaway sync IPC bridge with a persisted **SQLite** store
and an **async** data port — the foundation the rest of M2 (session/cost persistence, resume)
and M3 (git/forge observation, reconciliation) build on. Pays **TD-017** in full (the sync
`sendSync` bridge and the preload wrapper are deleted, not left alongside). Per ADR-0010, the
store is a **reconstructible cache + Docket-owned facts**, never the source of truth; the
schema visibly separates **observed** (git/forge cache, `observed_at`, discardable) from
**owned** (session ids/role/scope, connections, preferences, evidence pointers). `mode:
direct`, `review: light` — no plan round.

## Context

- `docs/adr/ADR-0010-docket-observes-it-does-not-own.md` — "schema encodes ownership": observed
  vs owned tables; document text never stored; no `stage` column on an observed table (stage is
  derived). The reseed property (drop observed + re-scan loses only time).
- `docs/adr/ADR-0003-workspace-configuration-in-git.md` — Docket's SQLite maps remote→local
  path, holds machine-specific concerns; workspace definition is in git.
- `docs/adr/ADR-0006-layering-and-provider-independence.md` — port in core; only the composition
  root imports an adapter.
- `src/core/source.ts` — the `WorkOrderSource` port (sync today; goes async). `src/core/derive.ts`
  — pure derivations (untouched, except a new test-first `deriveStage`).
- `electron/main.ts`, `electron/preload.ts` — the sync bridge to delete (TD-017).
- `src/adapters/fixtures/` — seed data (workspaces, 6 work orders, tracks, sessions, sources);
  `ids.ts` (`wid/rid/woid/tid`) promoted to `src/adapters/ids.ts`.
- `docs/tech-debt.md` — TD-017 (sync bridge, paid here), TD-008 (stage stored→derived, partly
  addressed here), TD-019 (in-memory sessions, stays open).

## Scope

In scope:

- A SQLite store (`src/adapters/store/`) over `node:sqlite` (`DatabaseSync`, built-in — verified
  in Electron's Node 24.18.1; no native dependency). Schema with the observed|owned split;
  seeded from fixture constants on first run (empty DB).
- `WorkOrderSource` port goes **async** (methods return `Promise`). `getWorkOrderDocs` stays
  fixture-backed (document text is not stored — ADR-0010).
- `stage` is **derived**, not stored: a pure, test-first `deriveStage` in core; `WorkOrder.stage`
  is set at hydration. (Closes the stored-stage half of TD-008; full git/forge-derived stage is M3.)
- **TD-017 paid**: the snapshot IIFE, `ipcMain.on('docket:get-source-snapshot')`, the preload
  `sendSync` and the sync `source` wrapper are **deleted**; replaced by async `ipcMain.handle`
  channels + `ipcRenderer.invoke`.
- `App` gains loading/error states (the only UI consumer; screens/components/derive otherwise
  untouched).
- The reseed property test (AC below).
- ADR-0010 already carries the "schema encodes ownership" section.

Out of scope (fast-follow, schema-ready): live session/cost **writes** + resume (couples to the
runner — separate WO); per-WO cost aggregation; workspace connection (remote→local path)
management; M3 git/forge observation/reconciliation; `unknown` evidence state; fine plan-stages.

## Acceptance criteria

1. The board loads from SQLite: `npm run dev` shows a loading state, then the six fixture cards
   in the same states as today; the detail view loads; `order.md`/`plan.md` still render
   (fixture-served, not from the store).
2. The schema visibly separates **observed** tables (carrying `observed_at`) from **owned**
   tables. No document text is stored. No observed table has a `stage` column.
3. **Reseed property (ADR-0010 as code):** dropping every observed table and re-seeding loses no
   decision — owned rows (a recorded session id) survive. Covered by an automated test.
4. `stage` is derived: a pure `deriveStage` in core is covered by tests and reproduces the six
   fixture stages; no `stage` column exists.
5. TD-017 is paid: no `sendSync`, no `docket:get-source-snapshot`, no sync `source` wrapper remain.
6. The store is imported only by `electron/main.ts` (boundary check 4 clean); no Node/vendor
   surface leaks to the renderer; `npm run check:boundaries` clean.
7. `npm run typecheck` (both projects), `npm test`, `npm run build`, `npm run check:boundaries`
   are green on the PR.

## Evidence required

- pr_open: PR URL, head sha
- ci_green: all required checks `success` (observed, not enforced — TD-013)
- verification: operator-covered (solo); the reseed test green; the app loads from SQLite and
  re-seeds after the DB is deleted
- closure: all tracks merged, `ROADMAP.md` + `docs/tech-debt.md` updated (commit sha)

## Notes

- `node:sqlite` is built into Node 22.5+; Electron 43 bundles Node 24.18.1 (verified via
  `ELECTRON_RUN_AS_NODE`). No native module, no electron-rebuild.
- M2 caches seeded observed facts (title/mode/gate inputs/cost) standing in for git; M3 replaces
  the seed with live git/forge observation and the work-order record thins toward "identity,
  tracks, doc pointers, observed_at" (ADR-0010).
- Solo mode; gates operator-covered (ADR-0001).

## Verifier return (blocking — both fixed)

A. **`track.stage` was stored.** ADR-0010 rule 2 was written for `WorkOrder.stage` but its rationale is general:
   a stored position cannot survive a change made outside Docket, and a track's stage IS the forge-owned
   pr/ci/merge facts — derived data sitting on the same row as `pr_url`/`ci_kind`/`merged_at`. Resolution
   (per the architect): derive it. `deriveTrackStage` in core (test-first) reproduces all seven fixture tracks
   from `pr`/`merge`/scoped-session; the `track` table has no `stage` column. (Renaming the column or
   documenting an exception were rejected — they dress up the problem / weaken the rule at the first hard case.)
B. **The seeding check did not respect the observed | owned split.** `createStore` decided "seeded?" from
   `work_order` alone and re-seeded both halves, so the schema's own designed state (observed empty, owned
   populated) either crashed (`UNIQUE constraint failed: workspace.id`) or duplicated owned rows. Fix: the check
   seeds each half from its own emptiness (`work_order` for observed, `session` for owned); `seedObserved` and
   `seedOwned` clear their half first (idempotent). Tests C1 (partial observed, no crash) and C2 (observed empty,
   owned populated, no duplicate owned) added.

Out of scope this return (verifier-flagged for follow-up, recorded at closure): expose `reseedObserved` over IPC,
transactions around reseed, foreign keys, `observed_at` on the junction tables (TD-021/TD-022).

## Closure record

Merged `2763be2` (PR #6, after the verifier return that derived `track.stage` and fixed the seeding split).
`ci_green`: the `check` job passed; GitGuardian passed. ROADMAP: the M2 "SQLite state store" bullet is checked
and annotated. tech-debt: TD-017 (sync bridge) and TD-008 (stage stored) **closed**; TD-021 (reseed happy-path
only) and TD-022 (junction tables lack `observed_at`) opened.

Verification (operator-covered, solo — per ADR-0001 the reason is recorded here and in the verifier-return
section above): the store is proven by `src/adapters/store/store.test.ts` (seed/hydrate with derived stage;
reseed loses no decision; seeding respects the observed | owned split — C1 partial-observed no crash, C2 no
duplicate owned). `deriveStage` and `deriveTrackStage` are test-first (all six fixtures reproduced). `npm run
typecheck` (both projects), `npm test` (110/110), `npm run build`, `npm run check:boundaries` green locally
and on CI; the built app boots and seeds. The GUI load-from-SQLite check (delete DB → re-seed) is
operator-pending — CI cannot drive the window.

Carried forward: live session/cost writes + resume (TD-019); reseed is happy-path only and not IPC-exposed
(TD-021); junction tables inherit `observed_at` (TD-022); xterm transcript (TD-020).

