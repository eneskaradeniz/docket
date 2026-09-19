---
id: WO-0072
title: "Genel bakış — the workspace overview: whose turn, the tech-debt links, ready-to-start (M5's read-only projections)"
workspace: docket
status: closed
mode: plan
review: light
review_mode: gates
tracks:
  - repo: app
    depends_on: []
---

# WO-0072 — Genel bakış — the workspace overview

## Objective

M5's last line: a read-only PROJECTION of the workspace's facts (ADR-0008's derived-read
discipline — the third consumer of the gate model, after the board and the detail): **Sıra** —
open work orders grouped by whose turn the stage model says it is; **Borçlar** — the open
tech-debt lines linked to the work orders that opened them; **Hazır** — work orders and
roadmap tasks whose dependencies are closed and whose gates are satisfiable. No planning
surface, no mutation — one screen that answers "what needs me most".

## Context

- **The turn model exists:** `deriveStage` (WO-0069's unknown arms included) names the phase
  per work order; the stage→whose-turn map (plan_requested/architect-review → MİMAR,
  plan_ready/implementation-blocked → OPERATÖR, implementation/verification →
  UYGULAYICI/DOĞRULAYICI...) is a pure core mapping over the SAME facts the board already
  reads. Group = derive once per mount (the roadmap screen's read-once precedent, TD-055's
  shape).
- **The debt links are parseable:** docs/tech-debt.md's table carries `| TD-NNN | WO-NNNN |
  ... |` rows — the projection parses (the ADR-0016 fence-parser honesty: a named parse
  failure renders a diagnostic line, never a silent empty) and matches the WO column against
  OPEN work orders of the workspace. Read at view time from the workspace's tech-debt path
  (the structure root; the file lives in the decision store — ADR-0010 rule 1).
- **Ready-to-start composes two sources:** a work order is ready when it is open, its
  predecessor work orders in the same workspace are closed (v1: no cross-WO dependency
  column exists — readiness = the gates: plan satisfiable → ready; a WO whose steps all ran
  and await review → waiting, not ready — the `derivePrimaryAction` grammar already names
  these), and roadmap TASKS: a planli task whose faz blockers are clear (ADR-0016's
  `getRoadmap` already computes faz status — the projection reuses it, TD-055's join).
- **The surface:** a fourth AppShell surface (`overview`, the usage screen's pattern) with a
  nav chip «Genel bakış»; empty workspace → the absent grammar (one line). The screen renders
  THREE sections in ADR-0012's economy — every section absent when it has nothing.
- **What it is NOT:** no actions (a row navigates — the board card's select), no edit, no
  stage column anywhere (TD-008's stance), no cached projection (derived per mount).

## Scope

In scope:

- **Core (test-first):** `src/core/overview.ts` — `deriveOverview(input): WorkspaceOverview`
  over pure inputs (the work orders' stage facts, the roadmap view, the parsed debt lines):
  `turns: Array<{ turn: 'architect' | 'operator' | 'implementer' | 'verifier'; wos: … }>` (the
  stage→turn map pinned), `debts: Array<{ id; title; wo?: WorkOrderId }>` fed by the parser,
  `ready: { wos: …; tasks: … }`. Plus `parseTechDebt(md): { lines: DebtLine[]; diagnostics:
  string[] }` — the table parser (TD id, WO column, title; rows that do not parse land in
  diagnostics, never dropped silently). Everything pure, everything pinned.
- **Store/bridge:** `workspaceOverview(id): Promise<WorkspaceOverview>` — the store assembles
  (open WOs + their gate inputs via the existing hydrate shape, the roadmap view via
  `deriveRoadmapView`, the tech-debt file read at the structure root); exposed on
  WorkOrderSource + the IPC/preload seam (the workspaceUsage pattern).
- **UI:** the `OverviewScreen` (the UsageScreen's skeleton), the AppShell chip, the three
  sections (Sıra groups with role labels in the role hue per ADR-0013's card head idiom;
  Borçlar rows — dim TD id + title + the linked WO's woIdLabel, click → the WO; Hazır rows →
  the WO/task). Empty sections ABSENT. Labels tr/en parity.
- **Tests:** the derive pins (the turn map, ready composition, the debt match against open
  WOs), the parser pins (a well-formed row, a ragged row → diagnostics, an empty file, a WO
  column that matches nothing), the store assembly pin, the surface nav pin.

Out of scope:

- Any mutation (the projection reads; navigating to a WO uses the existing select); milestone
  projections (superseded by ADR-0016 — the ROADMAP line says so); cross-WO dependency
  columns (WO-0071's depends_on is intra-WO); CI/check-run projections (the Depo section's
  home is the board); pagination/virtualization (solo scale).

## Acceptance criteria

1. `deriveOverview` is pinned: the stage→turn grouping, ready composition, and the debt match
   against open work orders (a closed WO's debts do not appear).
2. `parseTechDebt` is pinned: well-formed rows, ragged rows → named diagnostics, empty file →
   empty-honest, no silent drops.
3. The screen rides the AppShell chip, renders the three sections with the absent grammar,
   navigates rows to the WOs; labels parity tr/en.
4. Full ladder green: typecheck (both), `npm test`, `npm run build`, `check:boundaries` (10).

## Evidence required

- plan_approval: mode `plan` — this order IS the approved session plan (the "tüm işleri
  bitir" delegation, 2026-09-19).
- operator_checkpoint: DEFERRED to the end-of-build test phase (BUILD-FIRST, 2026-09-19) —
  the overview joins the deferred tour.
- ci_green: RESOLVED — green, 2026-09-19: typecheck (both tsconfigs), **1124 unit tests**
  (+26), build, `check:boundaries` 10/10 clean. Subagent-implemented, independently verified;
  the agent's live headless check against a seeded DB caught the WO-0069 interaction (an
  attested close derives `closed` only with resolved verifier pointers) and fixed the seed.
- pr_open / closure: RESOLVED — PR #77 (`https://github.com/eneskaradeniz/docket/pull/77`),
  head `0e0af50`, merged `be0a566`; closed at this commit. THE LAST BUILD WORK ORDER — the
  build queue ends here; what remains is the operator's single test phase.

## Stop-and-ask gates

- A stored or cached projection (derived per mount, TD-055's shape), or a `stage` column
  anywhere (TD-008's stance).
- An ACTION on the overview surface (read-only; navigation is not an action).
- Debt lines matched against CLOSED work orders appearing as open borçlar.
- A parse failure rendering as an empty surface (named diagnostics or nothing).

## Notes

- Chain position: M4 machinery (WO-0071) → **M5 overview (this, the last BUILD work order)**
  → the operator's single test phase (the deferred tours, incl. DateApp onboarding).
- ADR-0008's derived-read discipline is the section's constitution: the screen is the facts
  the workspace already carries, projected.
