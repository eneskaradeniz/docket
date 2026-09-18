---
id: WO-0061
title: "NULL-fix — the usage screen's known-spend basis (interrupted legs stay NULL · hasUnknown reaches the month head)"
workspace: docket
status: closed
mode: plan
review: light
review_mode: gates
tracks:
  - repo: app
    depends_on: []
---

# WO-0061 — NULL-fix — the usage screen's known-spend basis (interrupted legs stay NULL · hasUnknown reaches the month head)

## Objective

The operator-approved follow-up queued at WO-0054's close (TD-058's addendum): the 04:16-style
interrupted drive — abort precedes the result message, the fold holds no cost — painted a
«$0,00» wall on the usage screen. The exploration (2026-09-19) found the fix PARTLY landed:
interrupted closes already record NULL cost (the `interrupted` event carries no cost — the
pipeline passes undefined, the store writes NULL, the merge preserves it), and the BUDGET head
already speaks «bilinen harcama» through `hasUnknown`. The remaining gap is the USAGE screen:
its month head sums the per-turn ledger with NO basis qualifier — a month whose spend is partly
UNKNOWN renders a bare «bu ay $X», and the `usageKnownBasisNote` key never renders anywhere.
This WO carries `hasUnknown` into the usage derivation and renders the known-spend basis on the
month head.

## Context

- **Verified today (2026-09-19):** `session.cost_usd` is nullable (schema); `recordSessionRow`
  writes `acc?.usd ?? null`; the merge helper preserves NULL; the pipeline's interrupted arm
  passes `ev.cost` = undefined (`interrupted` carries no cost — runner); the budget head's
  `monthSpendRow` already computes `unknownCount` → `hasUnknown`, and
  `workspaceBudgetView.hasUnknown` drives «bilinen harcama» (budget.ts:53-55).
- **The gap:** `deriveUsageView` (src/core/usage.ts) has no `hasUnknown`; `UsageScreen` renders
  `usageMonthObserved(usd)` unconditionally; `usageKnownBasisNote` (both bundles) is dead.
- The session facts the derivation already receives carry `costUsd` ONLY when non-NULL — the
  absence is knowable per session, and `startedAt` gates it to the month window.

## Scope

In scope:

- Core (test-first): `deriveUsageView` gains `hasUnknown: boolean` — TRUE when ≥1 session fact
  with `startedAt` inside the window carries no `costUsd`. `usage.test.ts` pins it (a NULL-cost
  in-window session flips it; a paid session doesn't; an out-of-window NULL doesn't).
- Store test: pin the interrupted leg's NULL write (`recordSession(stopped, no cost)` →
  `cost_usd IS NULL`) — the write path is correct today but UNPINNED.
- Pipeline test: pin the interrupted close's cost argument (undefined rides to the store).
- UI: `UsageScreen`'s month head renders the known-basis pair when `hasUnknown` —
  NEW key `usageMonthObservedKnown(usd)` («bu ay bilinen harcama $X») beside the existing
  `usageMonthObserved`, and the existing `usageKnownBasisNote` line renders under the head
  (its first live render). Labels in both bundles; the note key finally speaks.
- Docs: TD-058's addendum closed out (the queued fix recorded as landed, with the residual
  scope this order covers); ROADMAP untouched (the WO-0054 line's follow-up note is the record).

Out of scope:

- Backfilling unknown costs from any estimate (absent = absent — the WO-0052 floor rule).
- Touching the budget gate's math (unknown cost never counts toward the cap — the standing rule).
- The budget readout (already speaks the basis — WO-0047's own surface).

## Acceptance criteria

1. A month-window session with NULL cost flips `deriveUsageView().hasUnknown` (unit-pinned;
   paid and out-of-window sessions don't).
2. The usage month head renders «bu ay bilinen harcama $X» + the basis note when `hasUnknown`,
   and the plain «bu ay $X» otherwise; both locales, key parity.
3. The interrupted close's NULL cost write is pinned (store + pipeline tests).
4. Full ladder green: typecheck (both), `npm test`, `check:boundaries`, build, E2E.

## Evidence required

- plan_approval: this order IS the approved session plan (the operator's "kuyruktaki işi
  düzeltelim"; the scope is the queued item's verified remainder).
- operator_checkpoint: PENDING — the manual scenario rides the Notes; the verdict gates the
  merge.
- ci_green: green, 2026-09-19 — typecheck (both), 933 unit tests (+2 usage hasUnknown pins, +1
  store NULL write pin, +1 pipeline cost pin), `check:boundaries` clean, build clean,
  **E2E 102/102 green (exit 0)** — the run that also surfaced and landed TD-048's remedy.
- pr_open / closure: RESOLVED — PR #66 (`https://github.com/eneskaradeniz/docket/pull/66`),
  head `b26a663`, merged `e9f10a6`; status closed at this commit.

## Stop-and-ask gates

- Any estimated/backfilled cost figure anywhere (absent means absent).
- A change to the budget gate's cap arithmetic (unknown never counts — the standing rule).
- A `.replace(` in `src/ui/` (ADR-0007) or a vendor literal outside `src/adapters/` (ADR-0006).

## Notes

- **Manual checkpoint (minute-scale, `npm run dev`):** 1) Kullanım yüzeyini aç — ay başlığı
  normal («bu ay $X»). 2) Bir sürüşü ortasında Durdur (maliyetsiz kesilen bacak) → yüzey yenilen
  (*: the head refreshes at onEnd) → başlık «bu ay bilinen harcama $X» + altında not. 3) Bütçeli
  çalışma alanında kafa hâlâ «bilinen harcama» der (WO-0047 aynen).
- The wall's own history: WO-0054's screenshots + TD-058's addendum; the budget side shipped
  with WO-0047's Known readouts.
