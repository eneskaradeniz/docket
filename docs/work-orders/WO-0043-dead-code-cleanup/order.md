---
id: WO-0043
title: Dead-code cleanup — the residue the restructures left behind
workspace: docket
status: review
mode: plan
review: light
review_mode: gates
tracks:
  - repo: docket
    depends_on: []
---

# WO-0043 — Dead-code cleanup — the residue the restructures left behind

## Objective

An exhaustive audit (2026-08-25, three parallel explorers + a plan agent that re-verified every
claim) found the code paths green — zero TODO/FIXME markers, no commented-out code, layering
enforced — but the deleted features (WO-0038 DOSYA single view, WO-0039 rail removal, WO-0041
cascade, WO-0015 un-seeding) left residue: two kit components nothing renders, one dead docs
fixture, a SADE-mode cluster in core, two dead enum variants, 10 dead label keys + the `askingRole`
family, dead CSS blocks, a broken screenshot tool, a stale `design-mock/`, and a Google Fonts link
that duplicates `@fontsource`. This order deletes every evidence-certain item. No behavior change
is intended except the font-load provenance (S10); every deletion must have zero references at head.

## Context

- `docs/tech-debt.md` — TD-006 (dead enum variants), TD-011/TD-018 (`scripts/shot.mjs`), TD-023
  (inert `cost_*` columns — addendum only, stays open), TD-037 (label-residue closure note),
  TD-047 (Google Fonts link)
- ADR-0007 (all display copy in the label bundles; parity pinned by
  `src/ui/data/labels/labels.test.ts`), ADR-0013 (single view — the source of most residue)
- `scripts/check-boundaries.mjs` — c2b bans the `dateapp` literal outside `src/adapters/`, which
  is why `fixtures/workspaces.ts` cannot move
- `plan.md` — the full audit corrections, ordered steps S1–S13, and the per-step gates

## Scope

In scope (S-steps in `plan.md`):

- S1 `src/adapters/fixtures/docs.ts` (+ barrel lines), S2 `src/ui/kit/Tabs.tsx` +
  `ScrollArea.tsx` + the two Radix deps, S3 `MarkdownDoc.tsx` (+ comment fix in `MarkdownBody`),
  S4 the `simplePhaseFromState` cluster in `src/core/runner.ts` + its describe block, S5 the two
  TD-006 enum variants + their label entries, S6 the 10 dead UI keys + the `askingRole` family,
  S7 `OWNED_TABLES`, S8 `seedFixtureWorkOrders` relocated into `store.test.ts` (production store
  stops importing `workOrders`), S9 `scripts/shot.mjs` + empty untracked dirs, S10 the Google
  Fonts link + preconnects, S11 dead CSS blocks, S12 `design-mock/` + the ROADMAP current-state
  sentence citing it, S13 `WO-0025-test/` (operator ruled deletion at the checkpoint — executed).

Out of scope:

- TD-023 column drop — a SQLite table-rebuild migration against operator databases belongs to a
  store-focused order with its own legacy-DB migration test (S8 moves the fixture seed's write
  into the test file; the addendum records what remains).
- `.rack` CSS — verified dead-looking but outside this audit's evidence bar; recorded in Notes as
  a follow-up candidate.
- `reseedObserved` / `fixtures/workspaces.ts` — kept deliberately (ADR-0010 ownership coverage,
  c2b's only legal home, M3 reconcile hook).
- Any rewrite of `derive.test.ts` (the fixtures stay exactly where its 79 cases read them).

## Acceptance criteria

1. Every deleted identifier — `MarkdownDoc`, `ScrollArea`, `Tabs` (kit), `workOrderDocs`,
   `OwnedDocs`, `seedFixtureWorkOrders` (as a production export), `simplePhaseFromState`,
   `classifyTool`, `SimplePhase`, `OWNED_TABLES`, `update_docs`, `pointers_unresolved`, the 10 UI
   keys, `askingRole`/`ASKING_ROLE` — has zero occurrences in `src/`, `electron/`, `e2e/`,
   `scripts/` at head sha, outside the deliberately relocated `seedFixtureWorkOrders` helper in
   `store.test.ts`.
2. `@radix-ui/react-scroll-area` and `@radix-ui/react-tabs` absent from `package.json` and
   `package-lock.json`.
3. `index.html` carries no `fonts.googleapis.com` reference.
4. The 79 derive cases and the store six-state coverage pass with diffs limited to the relocated
   seed helper and the deleted runner describe.
5. `npm run typecheck` (both), `npm test`, `npm run build`, `npm run check:boundaries` green;
   `npm run test:ui` 46 specs green with no shot shift beyond the S10 font case.
6. `design-mock/` gone; ROADMAP's header no longer cites it as the current UI direction.

## Evidence required

- plan_approval: the operator approved the session plan 2026-08-25 (the session plan file carried
  this order + `plan.md` verbatim)
- operator_checkpoint: app walkthrough offered with `git diff --stat` (board / DOSYA detail /
  settings en↔tr); operator ruled and approved 2026-08-25 — "sil ve onaylıyorum": WO-0025-test
  DELETED (S13 executed), the rest accepted as-is
- review: two adversarial review rounds over the diff (3 dimensions × verifier agents) — 9
  findings, all docs/comment level, zero code defects; all fixed (the 10-vs-12 key count, the
  TD-023 wording, the source.ts/store header staleness, plan pointers, the substrip comment rot)
- verification: typecheck (both) / `npm test` 530/530 / `check:boundaries` / `build` / `test:ui`
  46 specs + zero renderer console errors green at PR head; 4-shot pixel diff vs HEAD — no layout
  shift (deltas: timestamp clusters + the environment-dependent provider-status line)
- ci: typecheck (both) / `npm test` / `build` / `check:boundaries` green on the PR (recorded at
  closure)
- closure: ROADMAP.md + docs/tech-debt.md updated (TD-006/011/018/037/047 closed, TD-023
  addendum), merge PR + sha (recorded at closure)

## Stop-and-ask gates

- The WO-0025-test deletion ruling — RESOLVED 2026-08-25: the operator ruled "sil" (delete);
  executed.
- Any dynamic-label-access grep coming back non-zero (a computed `UI[key]` consumer would move a
  key from dead to alive) — never fired; all six pattern greps zero.
- Any e2e shot shifting beyond timestamp noise — never fired; pixel-diff clean (see Evidence).

## Notes

- Audit corrections baked into the deletion set: all seven `woPhase*` keys and `cardJustWritten`
  are ALIVE (`phaseLabelText` tr.ts:796-813, `cardReasonText` tr.ts:96-106 — same-file composers
  a naive grep misses). The dead-key set is 10 plain UI keys + the `askingRole` family (11 UI
  members), not the audit's 19.
- Fixtures stay in `src/adapters/fixtures/` on purpose: boundary check c2b has no test exemption,
  so `workspaces.ts` (which carries the `dateapp` pilot) has no other legal home; `work-orders.ts`
  is the contract data of `derive.test.ts` (38 `wo()` lookups + two reproduce-every-fixture loops).
- `.rack` CSS: appears dead (comment-only references); follow-up candidate, not this order.
- S8 narrows TD-023: the fixture seed's `cost_*` write now lives in `store.test.ts`; production's
  only remaining write is `createWorkOrderRow`'s NOT NULL zeros (store/index.ts:769-771) — the
  rebuild migration remains the debt.
