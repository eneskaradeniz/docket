---
id: WO-0052
title: "Usage instrumentation floor — persist what the provider already reports (cache split · model usage · turns · durations · context fill)"
workspace: docket
status: closed
mode: plan
review: light
review_mode: gates
tracks:
  - repo: app
    depends_on: []
---

# WO-0052 — Usage instrumentation floor — persist what the provider already reports (cache split · model usage · turns · durations · context fill)

## Objective

The token tour (2026-08-28) measured that Docket records only the last word of every drive's
economics: one final in/out/usd aggregate per session, nothing else — while the SDK already
returns cache read/creation tokens, a per-model usage map, turn counts and durations on every
result message, and a live context fill that never persists anywhere. This WO builds the
RECORDING FLOOR: the runner port's cost vocabulary widens with honest-absent optional fields,
every observed `turn_complete` appends a per-turn usage row, the latest `context_usage` reading
checkpoints onto the session row, and the budget gate's math is untouched. No UI — the usage
screen (queue 4) and the limit screen (queue 3) read this floor.

## Context

- **Acceptance basis: the token tour** — `docs/research/2026-08-28-token-usage-tour.md` (the S5
  gap table maps every field below to its consumer); the measurement harness
  `docs/probes/token-tour/measure.ts` reproduces every number. Tour findings this WO pays:
  in/out counts only fresh input (cache is the real mass of a long drive and is dropped);
  context fill is live-only; per-turn economics are collapsed into one total; interrupted
  drives record honest zeros for spend that happened.
- **Code anchors (verified by the tour's exploration):** `costOf` reads exactly 3 fields
  (`src/adapters/runner/index.ts:151-157`); the adapter's structural `AnyMsg` drops
  `cache_read_input_tokens` / `cache_creation_input_tokens` / `modelUsage` / `num_turns` /
  `duration_ms` / `duration_api_ms` that the SDK result carries; `emitContext`
  (`index.ts:410-431`) feeds a live-only fold; `recordSessionRow`
  (`src/adapters/store/index.ts:328-403`) collapses per-turn into one total;
  `monthSpendRow` (`index.ts:786-798`) is the budget math this WO must not touch.
- **Cost semantics to respect (WO-0046/TD-052 discipline):** `applyResultCost`
  (`index.ts:164-182`) — `usd` is cumulative-within-process and RESETS at a resume leg; token
  counts are per-result. Per-turn deltas must be computed under the same baseline discipline
  (the c2 probe's leg-reset behavior is already pinned by
  `src/adapters/runner/index.test.ts:13-48` — extend, don't loosen).
- **Precedents:** honest-absent — a NULL cost reads as *unknown*, never zero (the budget
  surfaces' `unknownCount`); counts-are-never-fabricated (WO-0051: counts-less drives write no
  summary); additive PRAGMA-guarded migration (the `roadmap_draft.source_summary` pattern).
- **Records & PRs (CLAUDE.md, 2026-08-26):** what persists here is METRICS — token counts,
  durations, model id strings. Never environment values, credentials, or the provider key.
  Model ids pass through as DATA; ADR-0006 bans vendor names in code, not metric strings in
  rows.

## Scope

In scope:

- Core (test-first, ADR-0006): the cost vocabulary widens. `CostSummary{tokensIn,tokensOut,usd}`
  keeps its meaning; a richer optional detail (cacheRead / cacheCreation /
  modelUsage: `Array<{model, tokensIn, tokensOut, usd}>` / numTurns / durationMs /
  durationApiMs) rides `turn_complete` and folds into `LiveSessionState`. Absent means
  not-reported — never a fabricated 0. `context_usage`'s fold is unchanged (already live); the
  checkpoint surface is new.
- Port + store: a per-turn usage table (working name `session_usage`; one row per OBSERVED
  `turn_complete`, including the held intermediates of a steered drive: session ref, `at`,
  tokens in/out, cache read/creation, `usd_delta` under the applyResultCost baseline, model?,
  turns?) + the session row gains nullable `ctx_used_tokens` / `ctx_max_tokens` (the LATEST
  reading) and a nullable final model-usage JSON. Additive, PRAGMA-guarded migration;
  aggregate columns keep today's exact accumulation semantics (pinned).
- Pipeline: `record()` checkpoints the latest context reading; every observed `turn_complete`
  appends a usage row. Interrupted drives: `usd` stays honest-absent; the observed context
  reading still checkpoints.
- Adapter: `costOf`/`AnyMsg` extended to pass through the SDK fields the result message
  already carries. NO new SDK control calls — the rate-limit/`usage_EXPERIMENTAL` surface
  belongs to the limit-screen WO (queue 3).
- CLI: `show <woId>` prints the per-session usage with the new fields where present (the
  operator's verification instrument for this WO — the screens come later).
- Tests: fold/store/pipeline units with a fake runner emitting the new fields AND the
  absence cases; budget tests re-run green, math untouched.

Out of scope:

- Any UI surface (the usage screen is its own WO; this floor is its data).
- Rate-limit / 429 classification, reset stamps, and the `usage_EXPERIMENTAL` controls
  (queue 3's WO).
- Price tables or local USD arithmetic (the provider's `total_cost_usd` stands).
- Transcript slimming / the `blockSummary` string-content hole (tour candidate 4), the ✦
  read-mass budget (candidate 1), the plan.md embed diet (candidate 5) — separate WOs.
- Any change to budget-gate thresholds or behavior; auto-compact configuration.
- Backfilling history that was never recorded — pre-WO-0052 rows stay honestly absent.

## Acceptance criteria

1. A result carrying cache/modelUsage/numTurns/durations persists them verbatim — at the
   per-turn row and the session final; a result without them persists ABSENT. Both directions
   test-pinned; no fabricated zeros anywhere.
2. Every observed `turn_complete` appends exactly one per-turn usage row whose `usd_delta`
   follows the applyResultCost baseline discipline; resume legs append to the same session
   with no double-count (the leg-reset semantics pinned).
3. The latest `context_usage` reading during a drive reaches the session row (updated at each
   `record()`); a drive with no reading leaves the columns NULL.
4. Budget math byte-identical: the `monthSpendRow` query and `budgetStatus` behavior are
   unchanged and their existing tests pass untouched.
5. `npm run cli -- show <woId>` renders the new per-session fields, omitting absent ones
   (never zeroing them).
6. The full ladder green on the PR: typecheck (both), `npm test`, `check:boundaries` (no
   vendor name in core — model strings are data), build, E2E suite.

## Evidence required

- plan_approval: architect verdict, `plan.md` committed (mode: plan — the one open design
  slot, the fill-history shape, is decided there).
- pr_open: PR URL, head sha.
- ci_green: all required checks `success`.
- verification: verifier report, all `path:line` pointers resolve at head sha.
- closure: all tracks merged, `ROADMAP.md` + `docs/tech-debt.md` updated (commit sha).
- operator_checkpoint: the new fields inspected via `show` on a real or fake drive.

## Closure

Merged **#58** (`d0ea490`, 2026-08-29) — plan `bf7e7cb` (mode: plan; the architect verdict upheld
the design and ruled all four implementer deviations justified — `model` shortcut + verbatim
`model_usage` JSON, `finalUsage` on an observed interrupt, the `show` per-turn tail as the
checkpoint instrument, `session_usage` in the OWNED half — with M1-M3 text corrections: the
fake-store lock is RUNTIME not compile, the stale CLI/pipeline anchors fixed, the R1 fallback
bound to a real-drive checkpoint; fill-history ruled floor-only, no tail) + feature `386d833`
(13 files, +1038/−25: `TurnUsage`/`ModelUsageLine` vocabulary, the `turn_usage` event emitted
BEFORE the hold check — a steered drive's held intermediates escape too, WO-0045/D3 intact —,
`session_usage` + ctx/final checkpoints with the PRAGMA-guarded migration and
`SESSION_REBUILD_COPY` extension, `recordTurnUsage` port, `usageOf` pass-through, the `show`
instrument) + the reviewer round `9dab9b4` (8 gates clean; one minor fixed RED-first: the
`final_model_usage` hydration guard rejects a JSON array blob — fail-open reads absent).
Verifier report at head: **AC1-6 all PASS, every `path:line` anchor resolves** — `monthSpendRow`,
`applyResultCost` and `costOf` two-ref diffed IDENTICAL, the budget test files untouched; one
count corrected in the PR body (E2E 84→78 — non-spec checkmarks; the suite itself green).
Evidence state: operator checkpoint inspected the `show` output in both directions (rich +
absent) on `--fake` temp-DB drives, reproduced independently; the S4 scripted-SDK mock round
succeeded first try, so M3's real-drive condition never engaged; `ci_green` = `check` +
GitGuardian SUCCESS; 802 unit tests (+33, presence AND absence pinned), E2E 78 green locally
(`test:ui` is not in CI — the local run is the AC6 E2E leg; one environmental note: the suite
crashes under a sandboxed shell at the theme spec, green unsandboxed). Interrupted-drive spend
stays honest-absent by design — WO-0026/TD-030's lineage, noted, not reopened. ADR-0006 +
ADR-0010 addenda, the CLAUDE.md Records metrics sentence, ROADMAP M7 (this WO its first tick),
TD-058 open (the `model_usage` JSON → normalized child table, for the usage screen's
model-level queries).

## Stop-and-ask gates

- Any change to budget / month-spend semantics (WO-0047's line — the gate stays as shipped).
- Persisting anything beyond metrics (the Records rule: no environment values, no keys).
- A UI surface creeping into this WO.
- A vendor name in `src/` outside the adapter (model id strings in rows are data; constants
  in code are not).
- Widening per-turn history beyond the named floor (if the plan wants a different granularity,
  it stops and asks the operator first).

## Notes

- The ONE open design slot for the plan round: the fill-history shape — latest-reading-only
  on the row (the floor) vs. a bounded tail of readings (the usage screen's curve). The floor
  requirement is the latest reading; anything more is a plan-round proposal, not a default.
- The tour's S5 table is the field→consumer map; quote it in `plan.md` so the usage-screen WO
  inherits the grounding.
- Naming (`session_usage`, column names) is the implementer's to settle inside the floor's
  contract; the contract is the acceptance criteria above.
- Sequencing (operator, 2026-08-28): this WO runs BEFORE the limit screen (queue 3) and the
  usage screen (queue 4) — both screens sit on this floor.
