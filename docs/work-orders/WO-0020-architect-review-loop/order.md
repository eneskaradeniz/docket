---
id: WO-0020
title: Architect review loop — verdict + review_mode (gates + every-step)
workspace: docket
status: draft
mode: direct
review: light
review_mode: gates
tracks:
  - repo: app
    depends_on: []
---

# WO-0020 — Architect review loop

## İçindekiler

- [Objective](#objective)
- [Context](#context)
- [Decisions](#decisions)
- [Scope](#scope)
- [Acceptance criteria](#acceptance-criteria)
- [Evidence required](#evidence-required)
- [Notes](#notes)

## Objective

Insert the architect review between steps (the last piece deferred from WO-0017). After each step's report, an
architect session reviews it and emits a **verdict: proceed or revise**; `review_mode` decides operator
involvement — `gates` (autonomous between steps, pulls the operator only on revise/uncertain) or `every-step`
(every verdict surfaces; the operator approves before the next step). Closes the report/verdict loop PRODUCT
describes and settles the verdict half of TD-009.

## Context

- WO-0017 (step execution) + WO-0018 (dogfooding polish) + WO-0019 (fence read fix / TD-026).
- `docs/PRODUCT.md` §"The review loop + review mode".
- TD-009: the report home (WO-0017) is settled; the verdict home is the open half — settled here.

## Decisions

- **Verdict home** mirrors the report home (ADR-0010): verdict TEXT in `verdicts/step-NN.md` (read at view
  time); verdict OUTCOME (`proceed`/`revise`) + pointer as columns on `work_order_step` (additive ALTER).
  `recordStepVerdictRow` UPDATEs (preserves status/report_path; idempotent); `resetStepRow` DELETEs (revise
  re-run → pending).
- **Verdict capture** reuses `turn_complete.result` + a pure parser `parseVerdict` (`core/verdict.ts`) — scans
  for the LAST `VERDICT:` line (+ `REASON:` on revise). No new RunnerEvent. **Unknown → revise** (safe side;
  absent verdict never auto-proceeds — ADR-0001 applied to the verdict).
- **Architect review session**: `architectReviewPrompt` (reads the report, ends with one `VERDICT:` line);
  `DriveInput.reviewStepIndex` distinguishes a review drive (`role:'architect' + reviewStepIndex`); main fills
  the prompt + captures the verdict on `turn_complete`. The architect is read-only on code (scope
  `decision_store`); Docket writes the verdict file (the agent never does — mirrors report authoring).
- **Loop control** is renderer-driven (extends WO-0018's auto-advance): `WorkOrderDetail` gains `reviewIdx` +
  `verdictFor` + two effects — review-trigger (step done + no verdict → review) and verdict-branch
  (`reviewMode` + verdict → auto-advance or verdict card). `deriveStage` unchanged (WO-level `architect_audit`
  stays M3/TD-025); `StepStatus` unchanged (verdict is orthogonal on `StepView`).
- **`review_mode` branching**: gates + proceed → auto-next; gates + revise → `VerdictCard` (re-run / accept);
  every-step (any outcome) → `VerdictCard` (devam / revize). Both modes ship here (operator's choice).

## Scope

In scope: verdict home; `parseVerdict`; `architectReviewPrompt`; `DriveInput.reviewStepIndex`; main review
branch + verdict capture + 2 IPC; `StepView.verdict/verdictPath` + derive pass-through; `WorkOrderDetailView.reviewMode`;
renderer loop (`ReviewPane`, `VerdictCard`, `WorkOrderDetail` effects); labels. Out of scope: `deriveStage`
refinement (M3/TD-025); per-WO architect audit gate (M3).

## Acceptance criteria

1. A step's report triggers an architect review; the review ends with a captured verdict (proceed/revise).
2. gates + proceed → next step auto-runs; gates + revise → verdict card (re-run resets the step, accept continues).
3. every-step → verdict card after every step; the next step waits for the operator.
4. Unknown verdict → revise (surfaced), never silent auto-proceed.
5. `npm run typecheck` (both), `npm test`, `npm run build`, `npm run check:boundaries` green.

## Evidence required

- plan_approval: n/a (`mode: direct`, `review: light`)
- pr_open / ci_green / verification: core tests (parseVerdict, deriveSteps verdict pass-through,
  architectReviewPrompt) + typecheck + build + boundaries; manual dogfood pending (a step's report → review →
  verdict → branch in both modes; verifier reads still allow — WO-0019 regression guard).

## Notes

- TD-009 fully closed (report home WO-0017 + verdict home here).
- `every-step` adds operator pauses on every step; `gates` stays the calm default.
