---
id: WO-0016
title: Plan-driven flow — the plan loop (architect proposes → approve → plan.md)
workspace: docket
status: draft # draft | planning | plan-review | implementing | review | audit | merging | closing | closed
mode: direct # plan | direct
review: light # light | full
review_mode: gates # gates | every-step
tracks:
  - repo: app
    depends_on: []
---

# WO-0016 — Plan-driven flow: the plan loop

## Objective

Wire the first half of the plan-driven pipeline: from a `written` work order, the operator clicks
"Plan iste" → an **architect session** runs (reads order.md, proposes a plan) → the operator approves →
Docket writes `plan.md` into the decision store and flips `planApproved` → the stage advances and the
approved plan renders. Step-running, per-step reports, and the architect-review-of-reports loop are
out of scope (WO-0017; they need the TD-009 verdict/report home). `review_mode` is read into the architect
prompt only here.

## Context

- `docs/PRODUCT.md` §"The plan-driven pipeline" + §"The review loop + review mode" + Concepts Plan/Step.
- `docs/work-orders/WO-0015-…` — created the `written` WO + "Plan iste" entry point + `review_mode` in order.md.
- `src/core/runner.ts` — `SessionRunner`, `DriveInput { role, approve, … }`, `plan_ready` RunnerEvent, fence.
- `src/adapters/runner/index.ts` — `role:'architect'` → provider `plan` mode; `ExitPlanMode` → `plan_ready`.
- `src/ui/components/session/SessionPane.tsx` — the only `runner.drive` consumer; already folds `plan_ready`.
- `docs/adr/ADR-0009-…` M2 addendum — the working-tree-authoring precedent (order.md).

## Decisions

- **Plan loop only (user-approved scope).** Step-running + per-step architect review need a decision-store
  home for reports/verdicts (TD-009, M3) to be derivable; the design mock does not even draw that UI. So
  WO-0016 stops at an approved + committed plan; steps are WO-0017.
- **`deriveStage` unchanged.** `plan_requested`/`plan_ready` are not representable from persisted facts at
  restart (`plan_ready` is live session state). "Plan iste" → a `session` row exists → `architect_approval`;
  approve → `implementation`. **TD-025 opened.**
- **The architect PROPOSES; Docket writes plan.md.** Plan mode blocks the agent's writes, so on approval
  the composition root writes `plan.md` (mirroring `writeOrderMd`) — the fence is never involved.
- **Mimar prompt assembled server-side** (main fills `DriveInput.prompt` for `role:'architect'` + empty
  prompt, from `parseOrderMd` + `architectPrompt` in core). The renderer never parses document text (ADR-0007).
- **`approvePlan` does NOT resume the architect.** The architect session ends at `plan_ready`; steps are
  separate sessions (WO-0017). Approve = write plan.md + flip the gate + reload the detail.
- **Commit policy (TD-005 tension).** Docket writes plan.md to the working tree; the operator commits
  (consistent with order.md / ADR-0009 M2 addendum). **M2 ruling:** `plan_approval` is satisfied by
  `gate_plan_approved=1` (observed flag), not a commit sha — the commit-as-evidence link is M3 (TD-009/005).

## Scope

In scope: `order-md.ts` (parseOrderMd/architectPrompt); `WorkOrderDetailView.stage`; decision-store
`findWorkOrderDir`/`writePlanMdById`/`readWoDocs`; store `approvePlan` + real `getWorkOrderDocs`;
`approve-plan` IPC + main architect-prompt fill; SessionPane plan surface (written → "Plan iste";
plan_ready → approve → approvePlan + reload); promoted PlanCard (markdown); labels.

Out of scope: step sessions + per-step architect review + verdict UI (WO-0017); structured step-list
parsing from LLM markdown (WO-0017); real forge/git observation (M3); `review_mode` loop branching (WO-0017).

## Acceptance criteria

1. A `written` WO's detail shows a single "Plan iste" control that starts an architect session (prompt
   assembled from order.md server-side); the architect's `ExitPlanMode` surfaces the plan + "Planı onayla".
2. Approve writes `plan.md` into `<decisionStore>/docs/work-orders/WO-NNNN-*/plan.md`, flips
   `gate_plan_approved=1`, and the detail reloads (stage "Uygulama", plan rendered above the expander).
3. `getWorkOrderDocs` reads order.md + plan.md from the working tree at view time (no fixture lookup).
4. Restart mid-plan-ready: the plan text is gone (live-only); the idle architect session resumes to
   re-propose (TD-025).
5. `npm run typecheck` (both), `npm test`, `npm run build`, `npm run check:boundaries` green.

## Evidence required

- plan_approval: n/a (`mode: direct`, `review: light` — solo; gates operator-covered)
- pr_open / ci_green / verification: order-md + decision-store + store tests (approvePlan writes plan.md +
  flips gate → stage implementation; getWorkOrderDocs reads disk; restart-persist); run-verify the flow
  (operator-pending); boundaries clean.

## Notes

- The architect session is recorded as a `session` row (enables resume-by-id); this means `deriveStage`
  leaves `written` immediately on "Plan iste" — accepted.
- Slug-free dir discovery (`findWorkOrderDir` by id prefix) avoids a schema change; the operator's
  commit is the reconcile trigger at M3.
