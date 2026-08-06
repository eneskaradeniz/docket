---
id: WO-0017
title: Step execution — run an approved plan's steps as sessions + capture reports
workspace: docket
status: draft # draft | planning | plan-review | implementing | review | audit | merging | closing | closed
mode: direct # plan | direct
review: light # light | full
review_mode: gates # gates | every-step
tracks:
  - repo: app
    depends_on: []
---

# WO-0017 — Step execution

## Objective

Open the dogfooding gate between an approved plan and running its steps. Today Docket plans but does not
implement: a `written` WO → architect plan → approve → `plan.md` → stage `implementation`, then nothing. This
WO makes an approved plan's steps run as implementer/verifier sessions in sequence, captures each step's
output as a report in the decision store, and shows the step list + reports in the UI. The architect verdict
(proceed/revise) + `review_mode` loop branching are **WO-0018** — out of scope here.

## Context

- `docs/PRODUCT.md` §"The plan-driven pipeline" + Concepts Plan/Step/Session/Report.
- `docs/work-orders/WO-0016-plan-driven-flow/order.md` — the plan loop (architect → approve → plan.md). Step-
  running was explicitly deferred to WO-0017; `WorkOrderDetail.tsx:65` flagged "a structured step list comes
  with step-running".
- `src/core/runner.ts` — `SessionRunner`, `DriveInput { role, scope, mode, stepIndex, … }`, `turn_complete`
  (`result?`), the role write-scope fence. Running an implementer session already works end-to-end.
- `electron/main.ts:82` — the single `docket:runner:drive` handler (cwd fill, event forwarding, persistence).
- `docs/adr/ADR-0010-*` — observed|owned split; document text in git, read at view time; derived data not
  stored. The report home follows the `plan.md` precedent.

## Decisions

- **Structural step block in `plan.md`.** The architect's plan ends with a fenced ` ```steps ` JSON block
  (`[{role, aim, scope}]`). `architectPrompt` is the producer; `parsePlanSteps` (pure, in core, test-first)
  is the consumer. Any malformation → `[]` → "no runnable steps" (honest degradation; the operator re-plans).
  One operator-approved artifact.
- **Steps + reports now; review loop next (WO-0018).** This WO delivers step sessions + per-step reports +
  step-list/report UI. Verdict + `review_mode` branching are WO-0018.
- **TD-009 settled, ADR-0010-aligned.** Report **text** = files in the WO dir (`reports/step-NN-<role>.md`,
  read at view time); step **status** + report pointer = a new observed `work_order_step` table + `step_idx`
  on `session`. Docket writes the report server-side at `turn_complete` (mirrors `plan.md` authoring — the
  agent does not write its own report; the fence is never involved).
- **`work_order_step` is minimal + observed.** `role`/`aim`/`scope` are parsed fresh from `plan.md` at view
  time (ADR-0010 rules 1 & 2 — no document text / no derived data stored). The table holds only the run
  outcome; a row exists only for steps that have run. `pending` = absence; `blocked` = derived (an
  unresolvable track scope).
- **Reuse `docket:runner:drive`.** One channel, one code path, one concurrency gate. A step drive carries
  `stepIndex`; main fills the prompt + scope server-side (`stepPromptFor`, symmetric to `architectPromptFor`),
  sets the step `active` on `started`, and writes the report + marks `done` on `turn_complete`. cwd stays
  `process.cwd()` (single-repo self-host; per-track paths are M3).
- **Renderer-driven sequencing.** `StepList` shows one runnable step at a time (the first `pending` after the
  last `done`); the operator clicks `Çalıştır`; `StepPane` drives it. An `active` step (interrupted at
  restart) offers `Sürdür`. No auto-advance — the operator runs one step at a time (gates cadence; the loop
  is WO-0018).

## Scope

In scope: `core/plan-steps.ts` (`parsePlanSteps`/`classifyStepScope`); `Step*` types + `steps` on
`WorkOrderDetailView`; `deriveSteps`; `implementerPrompt`/`verifierPrompt` + the `architectPrompt` steps-fence
producer; `turn_complete.result?` + `DriveInput.stepIndex?`; `getWorkOrderSteps`/`getStepReport` on the port;
the `work_order_step` table + `session.step_idx` + `recordStep`/`recordStepReport`/`stepPromptFor`/migration;
decision-store `writeStepReport`/`readStepReport`; the drive-handler step extension + 2 IPC; `StepList`/
`StepReport`/`StepPane` + `WorkOrderDetail`/`App`/`DetailScreen` wiring + labels.

Out of scope (WO-0018): architect verdict (proceed/revise) UI + persistence; `review_mode` gates/every-step
loop branching; re-plan after approval; per-track cwd (M3); commit-sha evidence (M3, TD-005/TD-025);
`plan_requested`/`plan_ready`/`verification`/`architect_audit` derivable from facts (needs TD-009 + M3).

## Acceptance criteria

1. An approved plan whose `plan.md` ends with a valid ` ```steps ` block renders a `StepList` (status marks,
   `role · aim`, scope, `n/adım`) once the stage reaches `implementation`.
2. The first pending step shows a single `Çalıştır` control; clicking it runs an implementer/verifier session
   (prompt + scope assembled server-side), the transcript streams in `StepPane`, and on completion
   `reports/step-NN-<role>.md` is written and the step shows `done` + an openable report; the next pending
   step becomes runnable.
3. A plan whose approved `plan.md` has no ` ```steps ` block shows a "no runnable steps" hint (honest
   degradation), never a broken surface.
4. A track-scoped step whose `scope` matches no track shows `blocked` (⊘) and is not runnable.
5. Restart mid-step: the step is `active` and `StepPane` offers `Sürdür` (resume by provider session id); the
   step's session row carries `step_idx`.
6. `npm run typecheck` (both), `npm test`, `npm run build`, `npm run check:boundaries` green.

## Evidence required

- plan_approval: n/a (`mode: direct`, `review: light` — solo; gates operator-covered)
- pr_open / ci_green / verification: the core test suite (parsePlanSteps, deriveSteps, prompts, runner result)
  + boundary checks + typecheck + build; run-verify the step flow (operator-pending — needs SDK auth).

## Notes

- The report is `turn_complete.result ?? accumulated assistant_text ?? placeholder` — always written.
- `work_order_step` is observed (discardable; re-derivable from `plan.md` + report files + session state at
  M3). Same TD-021 orphaning risk as `order.md`/`plan.md` until the operator commits.
- `review_mode` is parsed but unused this WO (steps run sequentially regardless); branching is WO-0018.
