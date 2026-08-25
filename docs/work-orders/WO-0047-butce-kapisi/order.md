---
id: WO-0047
title: Budget gate — workspace spend threshold with a human-language reason
workspace: docket
status: draft
mode: plan
review: light
review_mode: gates
tracks:
  - repo: app
    depends_on: []
---

# WO-0047 — Budget gate — workspace spend threshold with a human-language reason

## Objective

A workspace-level monthly spend threshold (a warn level + a hard stop), enforced at the
**pre-drive boundary** in the `planApprovedFor` tradition: the pipeline refuses to start a drive
when the hard cap is met, with a human-language reason line — never a boolean, never a disabled
control. The operator resolves it with exactly two choices (keep the cap / raise the cap and
continue), and the warn level surfaces as a line on the board card and the detail band. Solo scale:
ONE threshold set per workspace, calendar-month window, no per-agent or per-project scoping.

## Context

- **External validation (Paperclip, `server/src/services/budgets.ts:505-517, 649-830`):** budget
  shape = window (`calendar_month_utc` | lifetime) + `warnPercent` + `hardStopEnabled`; hard breach
  pauses the scope with `pauseReason: "budget"` and opens a `budget_override_required` approval whose
  payload directs: "Raise the budget and resume the scope, or keep the scope paused." The
  pre-invocation gate (`getInvocationBlock`) returns a **sentence**, not a flag. The operator
  incident UI carries exactly two buttons (`keep_paused | raise_budget_and_resume`,
  `ui/src/pages/Costs.tsx:227`). Analysis: `~/source/inspiration/ANALYSIS-paperclip.md`.
- Cost basis already exists: a work order's cost is DERIVED from its session rows at hydrate
  (`deriveWorkOrderCost`, `src/core/derive.ts:129-142`) — the month figure is a store-level sum of
  session cost in the window per workspace.
- Enforcement point: `src/core/pipeline.ts` beside `SessionStore.planApprovedFor` — a `budgetBlock`
  check before the runner spawns; refusal is an error event the panes render (the
  `ProviderErrorCode` precedent for Turkish, localized labels).
- Settings: the threshold lives in `app_setting` (the AppSettings port — the provider-key
  precedent); a Settings section with the number + current month readout.
- UI: the warn line on the board card + detail band (informative line, ADR-0012); the hard-stop
  refusal renders as the drive's reason line + the two-choice card (the ask-card idiom, ADR-0001's
  absent-not-disabled: the action is present with its reason, never dimmed/dead).
- CLI parity: `drive` refuses with the same sentence; `--force-budget` is NOT added (raising the cap
  is a settings action, not a flag).
- ADR: a dated addendum (the budget gate is pipeline-enforced like the plan gate — never host-side
  work-around; CLAUDE.md's plan-gate clause gains a sibling).

## Scope

In scope:

- Store: month-window cost sum per workspace; threshold in `app_setting`.
- Pipeline: pre-drive `budgetBlock` with a reason sentence; error event kind + labels (tr/en).
- UI: Settings threshold field + month readout; warn line (board card + band); refusal card with
  the two choices; raising the cap persists the new setting.
- Core tests (window math, warn/hit derivation), E2E whereFakeable, CLI refusal parity.

Out of scope:

- Per-agent / per-project / lifetime-window scoping (Paperclip's full taxonomy — solo scale takes
  one number).
- Mid-drive enforcement (a running drive is never killed by the gate; the next drive is refused).
- Spend forecasting, charts, per-session budget attribution.

## Acceptance criteria

1. A workspace with spend ≥ warn level and < cap: board card + detail band show the warn line
   (with the month figure); drives start normally.
2. A workspace at/over the cap: starting any drive is refused by the pipeline with the localized
   reason sentence (same sentence in GUI and CLI); no runner process spawns.
3. The refusal surface offers exactly two resolutions — keep the cap (dismiss; the reason stays as
   the standing line) and raise the cap (persist the new threshold; the refused drive re-runs) —
   no third path, no flag bypass.
4. Month window math is unit-tested (calendar-month boundary, sessions with NULL cost excluded,
   USD basis consistent with `costKnown` honesty — unknown cost never counts toward the cap).
5. A drive running when the cap is crossed is NOT interrupted; the refusal applies to the next
   drive, and the surfaces say so.
6. All copy through labels (tr/en); `npm run typecheck` (both), `npm test`, `npm run build`,
   `npm run check:boundaries`, E2E green.

## Evidence required

- plan_approval: architect verdict, `plan.md` committed (`mode: plan` — this order touches the
  pipeline's gate spine and earns a plan round)
- operator_checkpoint: the warn line, the refusal card, and the raise flow verified in the app with
  seeded spend
- ci: typecheck (both) / `npm test` / `check:boundaries` / `build` / `test:ui` green
- closure: ROADMAP ticked; the budget-gate ADR addendum + CLAUDE.md sibling clause; tech-debt
  updated if any

## Stop-and-ask gates

- Whether "raise the cap" persists the new number permanently vs as a one-month override — operator
  ruling before implementation freezes it.
- Any pressure to enforce mid-drive (kill a running session on breach) — that contradicts this
  order's stance; stop and ask.

## Notes

- The two-choice shape is deliberately Paperclip's — it is the validated anti-pattern-avoidance:
  neither a modal nag nor a settings scavenger hunt.
- Unknown-cost sessions (interrupted legs record no cost, the honest no-claim rule) must not
  silently under-count toward the cap: the warn line states the figure's basis ("bilinen harcama")
  if any session in the window has unknown cost.
