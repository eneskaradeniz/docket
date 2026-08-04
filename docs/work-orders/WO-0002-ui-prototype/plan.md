---
id: WO-0002
title: Clickable UI prototype (board + work order detail) — plan
workspace: docket
status: reconstructed
mode: plan
approved_in_session: 2026-08-03
transcribed: 2026-08-04
tracks:
  - repo: app
    depends_on: []
---

# WO-0002 — Plan (reconstructed)

> **This plan was reconstructed and committed after the fact.** It was approved by the architect in a
> Claude Code session on **2026-08-03** at the gate-1 stop-and-ask ("before writing the fixture types") and
> transcribed into the decision store on **2026-08-04**. It was **not** committed at approval time — a
> manual-relay failure recorded as **TD-0005**. What follows is a faithful transcription of the approved
> plan, written from the implemented type model (`src/core/types.ts`) and the work order
> (`docs/work-orders/WO-0002-ui-prototype/order.md`); it is not backdated, and it must not be read as a
> contemporaneous artifact. The authoritative record of the approval was the in-session verdict, which
> session ephemerality has since consumed — the exact gap TD-0005 names. Per **ADR-0003** the plan commit is
> the application's responsibility; this failure mode cannot recur once Docket exists, which is the
> structural fix for the debt.

## Scope of the gate-1 approval

Gate 1 (order.md, stop-and-ask #1) covered the **fixture and view-model types** — the raw state the adapter
provides and the derived views the core produces — because those types become the application's view model in
M3. Component-level layout, copy, and the verification-screenshot harness were settled in the implementation
session, not at gate 1, and are **not** reconstructed here.

## Approved type model

Canonical form is `src/core/types.ts`; the decisions approved at gate 1 are:

- **Branded identifiers** (`WorkspaceId`, `RepoId`, `WorkOrderId`, `TrackId`). Components pass and compare
  them but cannot construct literals — only the adapter can. A bare project-id string will not typecheck.
  This makes the ADR-0003 rule 1 ("project context is never a global") structural.
- **`Workspace`** carries project context as an object, never a singleton (ADR-0003 rule 2).
- **Pipeline vs. track stages are disjoint.** `StageId` (the WO-level rail) and `TrackStage` (per-repo
  lanes) share no value; `pr` / `ci` / `merge` live only on tracks.
- **CI is a discriminated union `Ci = run | exempt`.** Exempt is a required branch with a reason — never a
  silent skip (fixture state 6).
- **Sessions live once**, on the work order (`WorkOrder.sessions`); an implementer session carries a `scope`
  to disambiguate its track. The session shape is **provisional** until WO-0001 reports.
- **`PrimaryAction = available | absent`.** There is no disabled control anywhere in the model; an action
  whose evidence is missing is `absent` with a structural `AbsentReason`, never a button the UI must grey
  out (AC3).
- **`TrackMergeAction`** is absent-when-blocked, naming the blocker (`depends_on_open` / `ci_not_green` /
  `pr_not_open` / `already_merged`).
- **Evidence, gate inputs, and the derived views** (`StageRailStep` with `needs`, `EvidenceItem`,
  `WorkOrderCardView`, `TrackLaneView`, `WorkOrderDetailView`) are produced by pure functions in
  `src/core/derive.ts`. Core returns structured data only; every fixed human string lives in
  `src/ui/data/labels.ts`.

## Corrections imposed at sign-off

- **A — Three-valued evidence (AC12).** `EvidenceStatus = satisfied | unsatisfied | exempt`, never boolean.
  An exempt requirement carries its reason and **does not block** the gate it belongs to (a CI-exempt track
  can merge). This is the same boolean-modelling bug that `Ci` fixes, applied one layer up.
- **B — Default `CardReason` (AC13).** Every card carries a reason for its column, including the default
  case where nothing is running and no gate is open (`awaiting_next_session`). Without B the running column
  had no reason at all.

> Note: `in_progress` was later added to `CardReason` to give the running column (an actively-working
> session that is neither stopped, CI-failing, nor awaiting a gate) its own reason. It is not part of the
> gate-1 block; it was accepted by the architect as the gap the six signed-off variants left. See the PR
> body and TD-006 for the parallel question of the unused `update_docs` intent.

## Architecture constraint (ADR-0006, carried from order.md)

Three layers with a one-way dependency rule:

```
src/core/      domain: types, gate model, derivations. Pure — no React, no I/O, no Node.
src/adapters/  the outside world: fixtures now. Implements ports declared in core.
src/ui/        presentation: React components and screens. Imports core, never adapters.
```

`src/dev-main.tsx` is the only composition root that may import an adapter. Nothing under `src/core/` or
`src/ui/` may import Electron, Node, or `fs`. M2 replaces the dev harness with the Electron shell and must
not move any file under `src/core/` or `src/ui/`.

## Fixtures (the six states, AC2)

The fixture adapter must cover: (1) stopped-and-asking; (2) failed CI, failing check named; (3) missing
evidence, primary action absent with a reason; (4) closure gate open, all tracks merged, docs not updated;
(5) multi-track with a dependent track whose merge does not exist until its dependency merges; (6) CI-exempt
shown as an explicit exemption. The same data drives the UI and the core tests (AC9 relaxed).

## Test-first

Every derivation — `whoseTurn`, `deriveRail`, `deriveEvidence`, `derivePrimaryAction`, `deriveCardReason`,
`deriveTrackMerge` — gets a failing test before its implementation, covering all six fixture states plus the
named edge cases: an unsatisfied gate yields an absent action (never a disabled control); a track whose
`dependsOn` is open has no merge; a CI-exempt track is never treated as passing; a work order matching no
`whoseTurn` rule falls to `your_turn`.

## Out of scope (unchanged from order.md)

Electron, real sessions, xterm.js, git or `gh` calls, SQLite, settings screens, `workspace.yaml` editing,
authentication, and dark/light theming beyond what Tailwind gives for free.
