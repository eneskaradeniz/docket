---
id: WO-0018
title: Dogfooding polish — fixes surfaced by the first live step-execution trial
workspace: docket
status: draft
mode: direct
review: light
review_mode: gates
tracks:
  - repo: app
    depends_on: []
---

# WO-0018 — Dogfooding polish

## Objective

The first live dogfooding trial of WO-0017 (step execution) ran end-to-end — plan → approve → implementer
(committed code) → verifier (verified at head sha) → reports — and surfaced a batch of UX/correctness gaps.
This WO collects those fixes so the plan→step loop is usable in practice. No domain-model change; all are
refinements to existing surfaces (the plan card, the step list, the session pane, prompts, persistence).

## Context

- `docs/work-orders/WO-0017-step-execution/order.md` — step execution (the trial's subject).
- The trial created throwaway WOs (WO-0018/0019/0020-dogfood-deneme) + `dogfood-trial.md`; those artifacts
  were cleaned out of this branch (the trial is validated, the artifacts are disposable).

## Decisions / fixes (from the trial)

1. **Plan/report markdown overflow** — `MarkdownBody` had no overflow guard; fenced ` ```steps `/JSON/long
   lines blew out the card. Fix: `min-w-0` on the body + the plan card's flex column; `pre` gets
   `overflow-x-auto`. (`MarkdownBody.tsx`, `PlanReadyCard.tsx`)
2. **Architect over-wrote the plan** — a trivial task produced a full Scope/Constraints/Verification document.
   Fix: `architectPrompt` now asks for a SHORT plan (~15 lines: one-paragraph summary + the `steps` block),
   forbidding the full-section document. (`order-md.ts`)
3. **TD-025 — plan lost on restart** — `plan_ready` was live-only; closing the app mid-proposal lost the plan
   and left a misleading "Commitlenen plan bekleniyor" card. Fix: on `plan_ready`, main writes `plan.md` as
   PENDING (`savePendingPlan`); the session pane shows a persisted plan like a live one, so the operator can
   still approve after a restart. (Narrows TD-025; M3 reconcile still closes it.) (`store`, `main`, `SessionPane`)
4. **No WO delete** — throwaway WOs couldn't be removed. Fix: `deleteWorkOrder` (cascade DB delete + remove the
   decision-store folder) + a "Sil" action with an "emin misin" confirm card. (`source`, `store`,
   `decision-store`, `main`, `preload`, `WorkOrderDetail`, `DetailScreen`, `App`)
5. **Plan shown twice** — during plan approval both `PlanReadyCard` and the `plan.md` doc rendered. Fix: the
   `plan.md` reference doc renders only PAST the plan stage. (`WorkOrderDetail`)
6. **Role tabs during the plan stage** — Uygulayıcı/Mimar/Doğrulayıcı tabs showed at `architect_approval`.
   Fix: tabs hidden across both plan stages (written + architect_approval). (`SessionPane`)
7. **Manual step run despite `gates` mode** — the operator had to click "Çalıştır" per step, contradicting
   `gates` (architect proceeds autonomously). Fix: auto-sequencing — on approval the first pending step runs,
   and on completion the next runs automatically; the "Çalıştır" button is removed. (every-step pausing stays
   WO-0019.) (`WorkOrderDetail`, `StepList`)
8. **Stale "Oturumu sürdür" when all steps done** — with steps 2/2 done the action card still said resume.
   Fix: an "Tüm adımlar tamam" banner replaces the action card once all steps are done. (`WorkOrderDetail`)
9. **Reports rendered as plain text** — verifier tables weren't rendered. Fix: add `remark-gfm` (tables) to
   `MarkdownBody`; `implementerPrompt`/`verifierPrompt` now direct reports to be written in markdown. (`MarkdownBody`,
   `order-md.ts`, `package.json`)

## Scope

In scope: the 9 fixes above. Out of scope (separate WOs): the **fence read bug** the verifier surfaced
(`classifyShell` denies read-only commands like `cat`/`git show` — TD-026 opened); the pipeline-stage
visibility UX; cost not persisted at `plan_ready` (mimar cost capture). Verdict/review-mode branching stays
WO-0019.

## Acceptance criteria

1. Plan/step reports render markdown (incl. tables) without overflowing the card.
2. Architect plans are short (summary + `steps` block).
3. Restarting mid-proposal keeps the plan visible + approvable.
4. A WO can be deleted from its detail (with a confirm) — DB rows + folder gone.
5. On approval, steps auto-run in sequence; all-done shows the banner.

## Evidence required

- plan_approval: n/a (`mode: direct`, `review: light`)
- pr_open / ci_green / verification: typecheck (both), `npm test`, `npm run build`, `npm run check:boundaries`
  green; the trial already proved the loop runs end-to-end.

## Notes

- TD-025 narrowed (plan now survives restart); TD-026 opened (fence over-blocks reads).
- The dogfood trial itself is not committed (disposable artifacts); its findings live here.
