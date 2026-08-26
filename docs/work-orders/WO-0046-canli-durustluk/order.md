---
id: WO-0046
title: Live honesty — context fill readout, silence line, resume-leg cost check
workspace: docket
status: closed
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

## Notes — work log (2026-08-26)

- **Probe (findings §C, `raw/c1.log` + `raw/c2.log`):** c1 — `getContextUsage()` answers in
  streaming-input mode at every assistant/user/result message: 9 calls, 0 failures, 2.0–2.8 s
  each, ~38 KB wire; the probe awaited inline and serialized ~2.3 s per read into the stream, so
  the app's feed is fire-and-forget, never an inline await. c2 — resume-leg cost RESETS (leg 1
  $0.094824 → the resumed leg's first result $0.056219, same session id, cache carried); s2b
  reconciled as cumulative-within-process (0.1766→0.2059, the diff is the note command's own
  spend). The mid-park control call never triggered (the ambient CLI auto-allowed the echo tools
  — no PARK_START); harmless by construction: no feed trigger fires while an ask parks, and the
  staleness line is gated to the fold's 'running'.
- **Operator rulings (2026-08-26, plan aşaması):** gauge vocabulary = TEXT (`bağlam %62 ·
  124k/200k`, the costline's mono/sönük voice — a bar was considered and declined); staleness
  threshold = **3 dk** (single constant `STALE_AFTER_MIN`, core).
- **Liveness amendment (probe-driven):** the staleness anchor is LIVENESS, not entries — fold
  state `lastLifeAt` is set by stamped entries AND by each context reading. c1 showed long
  thinking streams `thinking_tokens` bursts for minutes with NO transcript entries; an
  entries-only anchor would have lied in exactly the window the line exists for. The adapter
  fires a throttled (≥30 s) context read on thinking bursts — one event kind carries both the
  gauge refresh and the liveness proof.
- **Resume-cost outcome: verified NOT a bug.** The plan's cumulative branch (priorCost seeding +
  a store read port) died at c2 — no seeding, no port, no migration. The accumulation block was
  extracted to `applyResultCost` (pure, adapter-side — the vendor semantics stay out of core)
  with the measured comment; pinned by `src/adapters/runner/index.test.ts` (TD-052 records the
  verification).
- **Live token parity rides `context_usage.cost`:** a live drive folds exactly ONE terminal
  turn_complete (WO-0045/D3), so mid-drive spend reaches the live costline only as the ride-along
  cost of the context event. The costline now speaks `formatCost` (`$0,41 · 68k→2.1k`) on every
  surface, live and done alike.
- **Staleness rulings:** the line SUPERSEDES an active tool verb (a verb is a motion claim the
  silence can no longer verify) with the dots OFF; gated on the fold's 'running' — an ask held
  shows the asking verb, never an accusation at the operator; planClosing keeps precedence; the
  empty-run window anchors on `started` (F7's one-line discipline intact).
- **E2E:** seed entry 11 ('Doluluk turu') + two specs — the readout absent-before/visible/gone +
  the token form, and the staleness appear/clear/frozen-words cycle (an old `at` stamp moves the
  anchor back, so the 3-minute threshold is testable without waiting). 582 unit + all UI specs
  green; typecheck (both), `check:boundaries`, `build` green.

## Notes — operator checkpoint (2026-08-26, WO-0048 dogfood, deleted after)

- **Verified live:** the readout (`bağlam %5 · 54k/1000k` during the Bash leg — appearing,
  updating, motionless) and the cost accounting: card $1,44 = plan $0,70 + step $0,11 + review
  $0,63; the step row's $0,74 is step+review legs (the expected derivation). No double-count.
- **Deferred (WO-0045 precedent):** the staleness line and the post-result live cost form fell in
  a ~40 s window before the sleep-200 result and were not observed live; both are pinned
  deterministically by the E2E specs. First real long silence confirms.
- **Polish from the round:** `formatTokens` gained an M tier — a 1 000 000 max-context rendered
  "1000k"; now `54k/1M` (tr + en, `formatCost` shares the helper).
- **TD-053 (found live, fixed here by operator ruling):** approving a plan on a detail opened
  BEFORE the plan existed did not start the first step — `runIdx`'s mount-only initializer had
  frozen at `undefined` (no steps yet), so the approval reload mounted no instrument until a
  re-entry remounted the detail. Fix: a sync effect fills `runIdx` when unset and a step exists
  (flowMode deliberately not a dependency — WO-0045 pin-2; in manual the manuel card's click is
  the consent). Red-green pinned by the TD-053 E2E spec (seed 'TD-053 turu').

## Notes — review round (review:light, 2026-08-26)

Reviewer verdict "needs fixes" → 3 findings, all fixed before merge:
- **f1 (should-fix, fixed):** a held ask answered after ≥3 min would flash the staleness line the
  instant the fold resumed — `ask_resolved` carried no stamp, so the anchor still sat at the
  pre-ask entry. The event now carries `at` (adapter's decide + the E2E fake) and the fold
  refreshes `lastLifeAt`: the wait was the operator's, never the drive's. Fold test added.
- **f2 (should-fix, fixed):** the raw s2b log disproved the "cumulative" claim for the TOKEN axis
  (result#2 usage 44/158 after result#1's 27802/50 — per-result figures, a cache-hit call's own
  numbers). `applyResultCost` now splits the axes: usd keeps the cumulative/reset guard; tokens
  sum plainly. The first cut's shared max-guard under-counted cache-busting turns. findings §C,
  TD-052 and the code comment state the axis-split truth.
- **f3 (should-fix, fixed):** the pin test substituted hypothetical token figures and asserted
  only usd — it pinned the wrong rule. Re-pinned against the raw numbers (27802/50 then 44/158;
  token deltas asserted).
- Notes accepted as-is: the unthrottled tool-event read (the order's stated cadence; the 30s
  throttle guards thinking bursts), the one-rejection-kills-the-feed policy (0/9 failures
  measured), the deliberate boot-window absence of `context`/`lastLifeAt` after a renderer
  restart, and the standing AI-attribution convention.

## Closure

Merged **#52** (`28c1b9c`, 2026-08-26) — feature `2b2d1d3` + review round `d9583b2`; CI green on
both (check + GitGuardian). Evidence state:

- **probe:** findings §C with raw numbers (`raw/c1.log`, `raw/c2.log`) — cadence (9/0 fails,
  2.0–2.8 s, fire-and-forget mandate) and the resume-cost semantics with the review round's axis
  split (usd cumulative-within-process / reset-at-resume; usage tokens per-result).
- **operator_checkpoint:** WO-0048 dogfood (deleted after) — the readout verified live
  (`bağlam %5 · 54k/1000k`), the cost accounting verified on real legs ($1,44 = 0,70+0,11+0,63;
  no double-count). DEFERRED by operator move-on (WO-0045 precedent): the staleness line and the
  post-result live cost form were not observed live (a ~40 s window) — both pinned
  deterministically by the E2E specs; the first real long silence confirms.
- **ci:** typecheck (both) / `npm test` (582) / `check:boundaries` / `build` / `test:ui` (all
  specs incl. the three WO-0046 + the TD-053 pin) green locally and on the PR.
- **review:light:** 3 should-fix findings fixed pre-merge (the ask-answer anchor stamp, the cost
  axis split, the raw-number re-pin); 4 notes accepted as-is.
- **tech-debt:** TD-052 (recorded verification, axis-split) + TD-053 (found live in the
  checkpoint, root-caused and FIXED here — `runIdx` sync effect + red-green E2E pin) closed;
  TD-016 cited for the SDK re-probe obligation.
