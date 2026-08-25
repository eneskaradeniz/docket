---
id: WO-0046
title: Live honesty — context fill readout, silence line, resume-leg cost check
workspace: docket
status: draft
mode: direct
review: light
review_mode: gates
tracks:
  - repo: app
    depends_on: []
---

# WO-0046 — Live honesty — context fill readout, silence line, resume-leg cost check

## Objective

The live instrument reports **concrete progress, not just motion**: a context-fill readout
(percentage + tokens, beside the costline) sourced from the SDK's `getContextUsage()`, token counts
on the live surface (parity with the card's `formatCost`), and an honest staleness line when a
running drive has produced no output for N minutes — replacing the indefinite "Düşünüyor···" wait.
Plus one correctness item: verify (and fix if wrong) that a resumed leg of the same provider session
does not double-count cost in the session row.

## Context

- **Measured SDK surface (probe 2026-08-26, installed `@anthropic-ai/claude-agent-sdk@0.3.221`
  `sdk.d.ts`):** `Query.getContextUsage(): Promise<SDKControlGetContextUsageResponse>` (`:2430`) —
  `{ categories[], totalTokens, maxTokens, percentage, model, … }` (`:3085-3110`); per-turn usage in
  `SDKResultMessage.usage` (`input_tokens`, `output_tokens`, cache fields). Re-probe on SDK bump
  (TD-016).
- **External validation:** Paperclip's live run readout — "Concrete progress — context fill %,
  tokens, and cost — rather than an indeterminate spinner" (`ui/src/components/task-chat/TaskChatUsageReadout.tsx`);
  its watchdog silence triage (`ok/suspicious/critical` + snooze) is the oversized ancestor of this
  order's single staleness line. munder-difflin's breaker ladder is the same lesson at hive scale.
  Analyses: `~/source/inspiration/ANALYSIS-*.md` (outside the repo).
- `src/ui/components/session/StepPane.tsx:89-94` + `pane-chrome.tsx` — the costline area gains the
  context readout; cadence: refresh at turn boundaries + tool events (never a busy poll loop); value
  transitions only, no mount animation, ≤400ms (ADR-0012; the cost-counter-never-animates rule
  applies to the gauge too).
- `src/ui/data/labels/tr.ts:271-273` (`formatCost`) — token form shared with the live surface.
- `src/adapters/runner/index.ts:89-94` — `costOf` reads only the result message today; the adapter
  grows a usage/context feed (`RunnerEvent` extension, fold in `src/core/runner.ts`).
- **Resume-leg cost check:** `src/adapters/store/index.ts:300-306` upserts the session row's cost as
  prior + input; the SDK's `result.total_cost_usd` is session-cumulative — a resumed leg (same
  provider session id, the WO-0039/0044 resume) may double-count. Verify against the SDK's
  documented semantics; implement the correct accumulation (replace/max-if-cumulative, add-if-delta)
  with a test that pins it.
- Staleness: derived in core from the fold (last entry timestamp while `running`), not a renderer
  timer guess; the line is honest information, never an auto-action (solo operator decides — no
  watchdog, no snooze machinery in this order).

## Scope

In scope:

- Context-fill readout + token counts on the live instrument (all panes that speak `pane-chrome`).
- Staleness line ("N dk'dır yeni çıktı yok" form) with a single threshold constant; clears on the
  next entry; reduced-motion safe.
- Resume-leg cost verification + fix + pinning test.
- Labels (tr/en); core tests; E2E where the FakeRunner can drive it.

Out of scope:

- Steering (WO-0045); budget gate (WO-0047).
- Watchdog actions, snooze, OS notifications for silence.
- Transcript virtualization (TD-042); per-category context breakdown UI (the SDK's `categories`/
  `gridRows` are noted, not surfaced).

## Acceptance criteria

1. While a drive runs, the live instrument shows a context readout (percentage + used/max tokens)
   that updates at turn boundaries / tool events and never animates on mount; a drive that cannot
   report it yet shows no readout (absent, not zero).
2. Token counts (in→out form) are visible on the live surface, matching the card's `formatCost`
   vocabulary.
3. A running drive with no new transcript entry for ≥ the staleness threshold shows the staleness
   line; the next entry clears it; the line never appears on a stopped/errored drive (those states
   keep their frozen words).
4. Resume-leg cost: a test pins the accumulation rule against the SDK's cost semantics (cumulative
   vs delta) and the session row reflects the true session total after a resumed leg — verified on
   a real resume, not only the FakeRunner.
5. All copy through labels (tr/en); no raw identifiers as display text.
6. `npm run typecheck` (both), `npm test`, `npm run build`, `npm run check:boundaries`, E2E green.

## Evidence required

- plan_approval: n/a (`mode: direct`, `review: light` — solo; gates operator-covered)
- probe: a real drive's `getContextUsage` cadence + the resume-leg cost semantics (both recorded in
  the closure notes with raw numbers)
- operator_checkpoint: the live readouts verified in the app on a real long drive (base-mobile
  WO-0001 dogfood preferred) — percentage honest at boundary, staleness line appears/clears
- ci: typecheck (both) / `npm test` / `check:boundaries` / `build` / `test:ui` green
- closure: ROADMAP ticked; tech-debt updated (a resume-cost finding that is NOT a bug closes as a
  recorded verification; a bug closes as fixed)

## Stop-and-ask gates

- `getContextUsage` cadence proves too chatty or unavailable in streaming-input mode (WO-0045's
  mode change interacts) — report the measured behavior before choosing a fallback.
- The resume-cost check finds a double-count whose correct fix changes stored rows (a migration) —
  stop for an operator ruling before migrating.

## Notes

- The gauge vocabulary (whether it renders "ctx 62%" or a bar) is a checkpoint ruling, not a spec
  constant — mockup first if the operator wants to see options (the `docs/ui-mockups/` precedent).
- ADR-0012's "informative lines stay" covers the staleness line: it is a reason-carrying line, not
  an explainer paragraph.
