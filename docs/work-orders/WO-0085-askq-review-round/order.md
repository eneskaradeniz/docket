---
id: WO-0085
title: "The structured ask's review round — six findings from PR #84's review of the WO-0077 surface"
workspace: docket
status: open
mode: direct
review: light
review_mode: gates
tracks:
  - repo: app
    depends_on: ["WO-0077"]
---

# WO-0085 — the structured ask's review round

## Objective

PR #84's high-effort code review (2026-09-21) swept past the atelier round's own diff and surfaced
six PRE-EXISTING defects on the WO-0077 structured-question surface (AskUserQuestion's fence
carve-out). None were introduced by #84; all live on main today. The operator opened this round to
close them. One surface, one round — the findings share the ask pipeline and its two cards.

## The findings (each: where · what breaks · fix direction)

1. **The roadmap surface's ask is invisible** — `RoadmapScreen.tsx:118`: the draft/roadmap drive's
   StopAndAskCard gets no `onAnswer`, so a structured question renders as the OPAQUE BINARY card
   (`toolLabel('AskUserQuestion')` → 'Araç çağrısı', `summarizeToolInput` → ''); «İzin ver» sends
   the bare allow — the a5 dismissed arm — and the draft proceeds on the model's guess while the
   operator believes they approved an answer. Fix: thread `onAnswer` through (or render the
   question face); the surface must show the question it asks.

2. **`risky_excluded` auto-answers the question** — `pipeline.ts:342` → `riskyExcludedPolicy` →
   `isRiskyPermission('AskUserQuestion', …)` returns false (`risky.ts` never names the ask tool),
   so the ask RESOLVES with a bare allow before it is yielded: the question never surfaces under
   the default-adjacent rule, the exact regression the carve-out claims to fix. Fix decision at
   implementation: the ask tool is the OPERATOR'S VOICE, not a mutation — it yields under every
   rule (a question is nothing to exclude).

3. **Multi-question payloads half-answer** — `askq.ts:108`: the contract allows 1-4 questions;
   only `raw[0]` renders and the fold REPLACES the answers map (`{ ...input, answers: {one key} }`),
   so Q2..N resolve as 'did not answer'. Fix: the fold MERGES keys; the render either shows all
   questions or walks them — the WO-0077 order pinned first-question rendering, not the lossy fold.

4. **`settle()` forwards `updatedInput` un-checked** — `runner/index.ts:804`: any held requestId's
   callback receives the mutated input without confirming the held ask's tool is ASK_TOOL; a
   mutated allow crossing to a WRITE ask executes arguments the fence never classified.
   Fix: keep `askDetails` (tool included) alive until settle and gate the forward on it.

5. **Allow-all dismisses questions** — `WorkOrderDetail.tsx:838`: «Tümüne izin ver» sends the bare
   allow for a held structured ask too — the model is told the operator did not answer, bypassing
   the explicit «Boş geç» consent. Fix: the allow-all sweep EXCLUDES ASK_TOOL asks (they keep
   waiting for their own answer/skip).

6. **The structured card's narrower seats + unlocalized copy** — `StopAndAskCard.tsx:54`: the
   structured branch accepts `onAlwaysAuto`/`alwaysAutoBusy` then ignores them (the binary card's
   «Bu iş emri için hep otomatik» seat is silently gone for the ask type agents emit most); and
   `AskQuestionCard.tsx:162` hardcodes the English decline sentence in the component — ADR-0007
   (all fixed copy in the tr/en bundles). Fix: honor the lift seat (or scope it in the labels) and
   move the decline words to the bundles.

## Non-goals

- No fence/contract changes — WO-0077's carve-out stands; this round repairs its delivery paths.
- The atelier round's own findings (#84) are merged; nothing here re-opens them.

## Verification

- Unit pins: the policy yields the ask tool under risky_excluded; the fold merges multi-key
  answers; settle refuses a tool-mismatched updatedInput; allow-all leaves ASK_TOOL asks pending.
- E2E: the roadmap surface's ask shows the question text; the structured card offers the lift seat;
  the decline sentence renders in the active locale.
- Full mechanical pass + `npm run test:ui`.
