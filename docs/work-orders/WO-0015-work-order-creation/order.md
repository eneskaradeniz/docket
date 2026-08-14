---
id: WO-0015
title: Work-order creation + context (author order.md into the decision store)
workspace: docket
status: draft # draft | planning | plan-review | implementing | review | audit | merging | closing | closed
mode: direct # plan | direct
review: light # light | full
review_mode: gates # gates | every-step (introduced by this WO; consumed by WO-0016)
tracks:
  - repo: app
    depends_on: []
---

# WO-0015 — Work-order creation + context

## İçindekiler

- [Objective](#objective)
- [Context](#context)
- [Decisions](#decisions)
- [Scope](#scope)
- [Acceptance criteria](#acceptance-criteria)
- [Evidence required](#evidence-required)
- [Notes](#notes)

## Objective

Let the operator create a work order. A "Yeni iş emri" modal (title, description/objective, track
checkboxes, local context files, a denetim/review-mode radio) authors `order.md` into the decision
store's working tree (Docket does **not** commit — the operator commits, ADR-0009 "Add"), inserts a thin
observed `work_order` row + tracks, and the board shows the new card at "Yazıldı" with inline "Plan iste".
The six fixture work orders stop being seeded — the board starts empty and fills as the operator creates.
WO-0016 later consumes `review_mode` to drive the architect's per-step review loop.

## Context

- `docs/PRODUCT.md` §2 (work order) + §Review mode + §Decisions 1/4/6 — the creation flow + decision store.
- `docs/work-orders/TEMPLATE.md` — the `order.md` shape this WO generates.
- `design-mock/index.html` `#newModal` (lines 90-127) — the approved creation modal.
- `docs/adr/ADR-0009-…` M2 addendum — the precedent for authoring git-owned docs from the UI in M2.
- `docs/adr/ADR-0010-…` — no document text in the store; `stage` derived, not stored.
- `src/core/source.ts` `WorkOrderSource`, `src/core/derive.ts` `deriveStage`, `src/adapters/store/` —
  the port + store patterns extended here.

## Decisions

- **ADR-0009 second M2 addendum (the load-bearing call).** Strict ADR-0009/0010 say a work order's
  document is git-owned and Docket observes it; until M3's git scanner lands the operator cannot create
  one through Docket otherwise. This WO takes the **pragmatic M2 path**: creation authors `order.md`
  into the decision-store working tree **and** inserts a thin observed `work_order` row + tracks; Docket
  does not commit. An addendum records it: at M3 the git scanner re-observes `work_order` from the
  committed `order.md`; rows whose file was never committed are orphaned (TD-021 extended). No document
  text is cached in the DB (ADR-0010 rule 1 holds).
- **`deriveStage` gains `written`.** A fresh WO (no sessions, plan not approved) now derives to `written`,
  not `architect_approval`. The `Pick` widens to include `sessions`. Safe: every fixture WO has ≥1
  session, so existing derivations are unchanged.
- **Review mode (`review_mode: gates | every-step`) lives in order.md front-matter only** — not a core
  field or DB column. WO-0016's architect runtime reads `order.md` (it does so anyway) and consumes it.
  Distinct from `mode: plan|direct` and the `review: light|full` cadence key.
- **Context attachments are local-file paths** written into order.md's Context section (the operator
  reviews/edits before commit). Image handling and git-backed storage are M3 (PRODUCT.md open question).
- **Decision-store path resolved server-side** (workspace → `connection.local_path` where
  `repoBase === decisionStore`; fallback `process.cwd()` for the fixture Docket workspace). Never leaks
  to the renderer (ADR-0001). The fs write lives in a new `src/adapters/decision-store/` adapter, so
  `electron/main.ts` stays a 1:1 IPC delegate.
- **WO number** = max+1 over the on-disk `docs/work-orders/WO-NNNN-*` dirs (continues the real sequence).
- **Fixtures un-seeded, not deleted.** The six fixture WO constants stay as test data
  (`seedFixtureWorkOrders` test helper); production `createStore` seeds workspaces only — the board
  starts empty.

## Scope

In scope: `deriveStage`/`CardReason` core changes (test-first) + `createWorkOrder` port; the
`decision-store` adapter (`nextWorkOrderNumber`/`buildOrderMd`/`writeOrderMd`); store `createWorkOrder`
+ path resolution + un-seed WO fixtures + `observedEmpty`→workspace; `create-work-order` + `pick-files`
IPC + preload; `WoCreateModal` + App wiring (`refreshWorkOrders`, navigate to detail) + board button +
empty state + labels; ADR-0009 addendum; ROADMAP; tech-debt.

Out of scope: the plan-driven architect runtime and review-mode behaviour (WO-0016); reports/verdict
homes (TD-009, M3); image handling and git-backed context (M3); real forge/git observation + `unknown`
CI (M3).

## Acceptance criteria

1. The operator creates a work order via the modal; a card appears on the board at "Yazıldı" with reason
   "İş emri yazıldı — bir plan isteyerek başla" and inline action "Plan iste"; the UI navigates to its
   detail (rail at `written`, no sessions).
2. `order.md` is written into `<decisionStore>/docs/work-orders/WO-NNNN-<slug>/order.md` with the
   TEMPLATE front matter (+ `review_mode`), Objective = description, Context = attached file paths;
   `git status` shows it untracked (Docket did not commit).
3. A created work order persists across a restart; the WO number continues the on-disk sequence.
4. The board starts empty (no fixture WOs seeded); the `up` bucket shows the "İş emri yok" empty state.
5. `npm run typecheck` (both), `npm test`, `npm run build`, `npm run check:boundaries` green.

## Evidence required

- plan_approval: n/a (`mode: direct`, `review: light` — solo; gates operator-covered)
- pr_open / ci_green / verification: `deriveStage`/`CardReason` core tests; `decision-store` adapter
  tests; store `createWorkOrder` tests (writes order.md, derives `written`, persists, allocates
  numbers); run-verify the create flow (operator-pending); boundaries clean.

## Notes

- The decision store is excluded from the track list only for multi-repo workspaces (a dedicated
  decision-store repo); a single-repo workspace keeps its repo as a track (it is both code and the
  `docs/` decision store) — PRODUCT.md §Decisions 6.
- Fresh-track CI is seeded `run/running/[]` (a false "running" claim) because the `Ci` type has no
  `unknown` state yet (TD-008/M3). Inert at stage `written`.
- `process.cwd()` fallback for the decision-store path is M2-acceptable (operator runs from source);
  breaks in a packaged app launched from Finder — M3 reads `workspace.yaml` + owned `connection`.
- Branded construction (`woid`/`tid`) only in `src/adapters/`; `node:fs`/`node:path` only in the
  adapters; no `disabled`/`.replace(`/vendor in `src/ui/`.
