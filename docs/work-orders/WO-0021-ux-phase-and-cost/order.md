---
id: WO-0021
title: UX debt — pipeline-phase indicator + architect-plan cost capture
workspace: docket
status: draft
mode: direct
review: light
review_mode: gates
tracks:
  - repo: app
    depends_on: []
---

# WO-0021 — UX debt: phase indicator + cost

## İçindekiler

- [Objective](#objective)
- [Gap 1 — phase indicator (no new domain model)](#gap-1--phase-indicator-no-new-domain-model)
- [Gap 2 — architect-plan cost (probe → safe H2 fix)](#gap-2--architect-plan-cost-probe--safe-h2-fix)
- [Acceptance criteria](#acceptance-criteria)
- [Evidence required](#evidence-required)
- [Notes](#notes)

## Objective

Close two UX gaps the WO-0018 dogfooding trial left open, now that the plan-driven pipeline is complete
end-to-end (WO-0017→0020):
1. **Which phase am I in?** — status was buried in a dim meta line + a hidden 9-stage rail; the plan-driven
   reality (plan → steps → verdict) wasn't visible at a glance.
2. **Cost $0** — the WO cost (derived from session costs) missed the architect plan session's cost.

## Gap 1 — phase indicator (no new domain model)

`derivePhase` (pure, `src/core/derive.ts`) consumes facts already on the view + `docs.plan` → a `WoPhase`
(`just_written` / `planning` / `plan_ready` / `implementing{done,total}` / `reviewing{stepIdx}` / `closing` /
`done`). `phaseLabelText` (`labels.ts`) maps it to Turkish copy; a one-line denim banner sits between the title
and the ActionCard in `WorkOrderDetail.tsx`. `StageRail` stays the secondary view behind "Akışı göster". A
revise verdict is NOT its own phase (the VerdictCard carries it). TDD: 9 cases in `derive-phase.test.ts`.

## Gap 2 — architect-plan cost (probe → safe H2 fix)

The cost IS persisted on `turn_complete` (`main` `record('idle', ev.cost)`); the adapter emits
`turn_complete` on the SDK `result` message. So capture depends on whether the SDK emits `result` after an
ExitPlanMode plan turn.

**Probe (throwaway, `docs/probes/cc-surface/`):** a plan-mode probe FAILED to trigger ExitPlanMode — the model
reported "ExitPlanMode isn't in my toolset" and never called it (the same TD-016 gap as WO-0001 Q2), then a
`result` did arrive. So the probe could not reproduce the real architect flow.

**Decision: H2 assumption + safe fix.** WO-0018 observed $0 (architect session cost NULL → H2: no
`turn_complete` after ExitPlanMode). The fix is safe in BOTH cases: `shouldSynthesiseTurnComplete(planReady,
turnComplete)` in `src/core/runner.ts` (pure, test-first — returns true only when plan_ready fired AND no
turn_complete); the adapter's `runDrive` `finally` synthesises a `turn_complete` (honest zero cost,
`stopReason: 'plan_exit_without_result'`, no `result` so main's assistantText fallback covers WO-0020 verdict
parsing) when the predicate says so. H1 (result does arrive) → predicate false → no-op, no double-emit.
TDD: 4 cases in `runner.test.ts`.

## Acceptance criteria

1. The detail shows a one-line phase banner (e.g. "Mimar planı düşünüyor…" / "Plan hazır — onayla" /
   "Uygulama · 2/5 adım" / "Mimar denetimi · adım 2" / "Tamamlandı") across the plan→steps→verdict flow.
2. After an architect plan drive, the WO's architect session row has a cost (real when the SDK returned one,
   zero-and-labelled otherwise) — never NULL.
3. `npm run typecheck` (both), `npm test`, `npm run build`, `npm run check:boundaries` green.

## Evidence required

- plan_approval: n/a (`mode: direct`, `review: light`)
- pr_open / ci_green / verification: core tests (derivePhase, shouldSynthesiseTurnComplete) + typecheck +
  build + boundaries; manual dogfood pending (phase banner reads correctly; WO cost non-NULL after an
  architect plan).

## Notes

- Gap 2's residual: if the SDK truly returns a `result` with cost after ExitPlanMode (H1), this fix is a no-op
  and the cost was always captured — the WO-0018 $0 note may have been against an older main.ts. Confirming
  needs a real architect plan drive (the probe can't, TD-016). The fix is correct either way.
