---
id: WO-0073
title: "GUI-only: the CLI removed + the detailed code cleanup (the composition root is ONE)"
workspace: docket
status: closed
mode: direct
review: light
review_mode: gates
tracks:
  - repo: app
    depends_on: []
---

# WO-0073 — GUI-only: the CLI removed + the detailed code cleanup

## Objective

Operator ruling (2026-09-20): Docket is fully GUI-based. `src/cli/` and `npm run cli` are removed
ENTIRELY. The provider side stays SessionRunner port + one provider adapter (ADR-0006/0014); the
forge side stays Forge port + one adapter — the multi-provider / future-Bitbucket architecture is
NOT changed, only verified.

Three fazlar: (1) the inventory — everything the removal touches, with caller evidence, shown to
the operator BEFORE any deletion; (2) the removal — referenclessness proven, ADR-0006 addendum,
boundary-check semantics unchanged; (3) the general cleanup (WO-0043 discipline: deletion + zero
behavior change).

## Context

- **The CLI is 8 files / 1653 lines** (`src/cli/`): the host (WO-0024's second composition root,
  11 commands), four CLI-local helpers (`create` / `drive` / `roadmap` / `fake-runner` — zero
  external importers, grep-proven), three test files.
- **Its only CLI-only store surface is `usageRowsFor`** — the interface line itself says
  "CONCRETE-ONLY — the CLI `show` tail's read". The WO-0054 facts read (`hydrateUsageRow`) is
  shared and stays; the row-persistence semantics keep their witness as column-level
  assertions in `store.test.ts`.
- **The E2E suite carries 2 CLI-native specs** (WO-0050/0051 `roadmap draft --fake` round-trips)
  out of 98 — they exercise the deleted surface itself; every GUI scenario they covered already
  has a GUI spec. Operator-approved: they go with the CLI; the 96 GUI specs are untouched.
- **Every other store/core method the CLI called has a live GUI caller** (grep-proven:
  `App.tsx`, the modals, `electron/main.ts` IPC). `savePendingPlan` is the pipeline's own
  production path, not a CLI path. `autoAllowPolicy` lives through `policyForRule('full_auto')`.

## Scope

In scope:

- `src/cli/` deleted; the `cli` script; the `src/cli` tsconfig entries (both); `COMPOSITION_ROOTS`
  narrows to `electron/main.ts` (checks' meaning unchanged — no exempt file remains).
- `usageRowsFor` + `usageRowsForWo` (the deleted read and its helper; `hydrateUsageRow` stays).
- `quickProviderCheck` + its two provider consts (`PROVIDER_KEY_ENV`, `PROVIDER_LOGIN_DIR`) —
  the ONE operator exception to the adapters boundary gate (callerless after the CLI; port,
  `createRunner`, `checkProvider`, `modelOptions`, `providerDisplayName` untouched).
- The 2 CLI-native E2E specs (operator-approved; `tsx` stays — `e2e/seed.ts` is its other user).
- CLAUDE.md's two live-rule spots; ADR-0006 addendum (history kept, not rewritten); TD-032
  closed; the ROADMAP entry; this order.

Out of scope:

- SessionRunner/Forge ports and adapters (integrity verification only); E2E GUI specs; GUI
  behavior; ADR history rewrites; the `tsx` devDependency (alive via `e2e/seed.ts`).

## Acceptance criteria

1. Full ladder green: typecheck (both tsconfigs), `npm test`, `npm run build`, `check:boundaries`.
2. `npm run cli` fails (no such script); `src/cli` gone; the referenclessness grep
   (`src/cli` / `npm run cli` / `cli/index`) clean across live code — docs history excluded.
3. E2E specs pass as-is (the 96 GUI specs; the 2 CLI-native specs removed by approval).
4. The whole change is one PR carrying a "Model Used" line.

## Evidence required

- plan_approval: mode `direct` — the operator's faz plan IS the plan; Faz 1's inventory was the
  approval gate and the operator approved it (2026-09-20), including the two named exceptions.
- operator_checkpoint: DEFERRED to the end-of-build test phase (BUILD-FIRST, 2026-09-19).
- ci_green: see the closing entry — ladder + E2E counts recorded there.
- pr_open / closure: recorded in ROADMAP.md at the closing commit.

## Stop-and-ask gates

- Any change to the SessionRunner/Forge ports or their adapters beyond the approved
  `quickProviderCheck` exception.
- A GUI spec deleted or a GUI behavior changed.
- ADR history rewritten instead of an addendum.
- A deletion without caller evidence, or kept in doubt (WO-0043: leave it, list it).

## Notes

- Chain position: the build queue ended at WO-0072 (M5); WO-0073 is the first post-queue chunk —
  GUI-only architecture + the Faz-3 cleanup sweep (separate approval, WO-0043 discipline).
- Faz 3's dead-code inventory is gathered (a read-only sweep); its deletions wait for the
  operator's list-level approval.
