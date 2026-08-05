---
id: WO-0011
title: Per-work-order cost aggregation (make `cost` derived)
workspace: docket
status: closed # draft | planning | plan-review | implementing | review | audit | merging | closing | closed
mode: direct # plan | direct
review: light # light | full
tracks:
  - repo: app
    depends_on: []
---

# WO-0011 — Per-work-order cost aggregation

## Objective

Make a work order's `cost` a **derived** value: the sum of its sessions' observed per-session costs.
WO-0010 captures per-session cost from the provider stream and persists it, but `WorkOrder.cost` is
still **stored** — read from `work_order.cost_*` columns seeded straight from fixtures — while the
per-session cost on the `session` rows is written and **never read back** (`SessionRef` has no `cost`;
`hydrateSessions` ignores the columns; `seedOwned` does not persist fixture session cost).

This WO applies ADR-0010 rule 2 to `cost` exactly as WO-0009 applied it to `stage`: a stored aggregate
is a claim wearing a schema. The aggregate is re-derived at hydrate from its inputs (`deriveStage` is
the precedent). The write path is already done (WO-0010's `recordSessionRow`); this WO completes the
read path, the derivation, and the UI. Closes ROADMAP M2 line 62.

## Context

- `docs/adr/ADR-0010-docket-observes-it-does-not-own.md` — rule 2: derived data is not stored beside
  its inputs. `stage` was the first application (TD-008, closed by WO-0009); `cost` is the second.
- `docs/work-orders/WO-0009-sqlite-state-store/` — the `deriveStage` / TD-008 closure is the template.
- `src/core/derive.ts:102` `deriveStage` — the derivation pattern to mirror.
- `src/core/types.ts:147` `CostSummary` (`{ tokensIn, tokensOut, usd }`); `SessionRef` (73-83);
  `WorkOrder.cost` (163); `WorkOrderCardView` (199-209).
- `src/adapters/store/index.ts` — `hydrateSessions` (114-131), `hydrateWorkOrder:152`, `seedObserved`
  (190-200), `seedOwned` (222-234), `recordSessionRow` (240-258, the already-done write path).
- `src/adapters/store/schema.ts:30-32` — the inert `work_order.cost_*` columns.
- `src/ui/components/detail/{CostView,Header}.tsx`, `src/ui/components/board/WorkOrderCard.tsx`,
  `src/ui/data/labels.ts` — where cost surfaces today.

## Scope

In scope:

- `SessionRef.cost?: CostSummary` — the observed per-session cost, surfaced from the `session` row.
- A pure `deriveWorkOrderCost(sessions)` in `src/core/derive.ts` (test-first); the store sets
  `WorkOrder.cost = deriveWorkOrderCost(sessions)` at hydrate, mirroring `stage`.
- The store read path: `hydrateSessions` surfaces session cost; `seedOwned` persists fixture session
  cost; the `work_order.cost_*` columns become inert (written 0, unread).
- Fixtures move their WO-level `cost` onto the session(s) that produced it (keeping `wo.cost` literal;
  a contract test guards equality — the `stage` precedent).
- UI: per-WO aggregate on the board card and detail header; a "No sessions yet" reason line when a WO
  has no sessions (absent, not a misleading `$0.00`).

Out of scope:

- Per-**role** cost breakdown (implementer / architect / verifier) — a clean follow-up needing its own
  UI region; `CostSummary` already carries the fields, so no data-model change is owed.
- Dropping the `work_order.cost_*` columns destructively — see Decisions (TD-023).
- The live transcript / xterm (TD-020); track-scoped session selection.

## Decisions

- **Keep `work_order.cost_*` inert, do not drop.** SQLite cannot drop `NOT NULL` columns without a
  table rebuild; a destructive migration in M2 (fixture-seeded, no live data) is more risk than value.
  The columns are written `0`, unread at hydrate, and the ADR-0010 violation is closed by no longer
  truthfully seeding or reading them. Recorded as **TD-023** (low) — same pattern as TD-022 (accepted
  rather than a destructive rebuild in M2).
- **`WorkOrder.cost` stays on the type.** Derived fields are kept on `WorkOrder` and set at hydrate,
  exactly as `stage` is (`deriveStage`); views pass `wo.cost` through. In-memory fixture consumers read
  the literal `wo.cost`; a contract test asserts `deriveWorkOrderCost(sessions) === wo.cost` for every
  fixture (the `deriveStage` contract test is the template).

## Acceptance criteria

1. `deriveWorkOrderCost` sums `tokensIn` / `tokensOut` / `usd` across a work order's sessions;
   undefined session costs count as zero (never `NaN`). Covered test-first in `src/core`.
2. For every fixture, `deriveWorkOrderCost(wo.sessions)` equals `wo.cost` (contract test).
3. `SessionRef` carries an optional `cost`; `recordSession({ ..., cost })` then `getWorkOrder` hydrates
   a `SessionRef` with that `cost`, and the WO's `cost` equals `deriveWorkOrderCost(sessions)` (not the
   inert `work_order` columns).
4. `seedOwned` persists fixture session cost, so a freshly-seeded store hydrates each WO's cost from its
   session rows.
5. The board card and detail header show the per-WO aggregate; a WO with no sessions shows a "No
   sessions yet" reason line (absent, never disabled).
6. `npm run typecheck` (both), `npm test`, `npm run build`, `npm run check:boundaries` are green.

## Evidence required

- plan_approval: n/a (`mode: direct`, `review: light` — solo; gates operator-covered, ADR-0001)
- pr_open: PR URL, head sha
- ci_green: all required checks `success` (observed, not enforced — TD-013)
- verification: the derivation tests + contract test; the extended store test (session-cost hydration +
  derived-aggregate); a headless drive → `turn_complete` → reopen → `getWorkOrder().cost` equals the
  recorded cost (optional); GUI card/header rendering is operator-pending
- closure: all tracks merged, `ROADMAP.md` line 62 → `[x]`, `docs/tech-debt.md` TD-023 opened

## Notes

- Solo mode; gates operator-covered. `mode: direct` — applies an existing ADR (ADR-0010 rule 2) via an
  existing pattern (`deriveStage`); no new architectural question is opened.
- Does not touch `src/core/derive.ts:192` (the `'as RepoId'` cast — TD-014, WO-0006's `review: full`).

## Closure

Merged PR #8 (merge `f37d20a`). `WorkOrder.cost` is derived from session rows at hydrate
(`deriveWorkOrderCost`, ADR-0010 rule 2 — same as `stage`/TD-008), not read from the now-inert
`work_order.cost_*` columns (**TD-023** opened). The cost read path WO-0010 left half-done is complete:
`SessionRef.cost` surfaced from the `session` row; `seedOwned` persists fixture session cost; the card
and detail header show the aggregate, with a "No sessions yet" reason line when a WO has no sessions.
Verification: operator-covered (solo) — derivation tests + a fixture contract test
(`deriveWorkOrderCost(wo.sessions) === wo.cost`); store test proving the aggregate derives from session
rows (inert columns `0`, aggregate non-zero); 121 tests, typecheck (both), build, 7/7 boundaries green.
GUI card/header rendering is operator-pending.
