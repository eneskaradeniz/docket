---
id: WO-0054
title: "Usage screen — the recorded month becomes one console surface (month head · live quota windows · role/model/cache breakdown · per-WO ledger with ✦ drafts)"
workspace: docket
status: open
mode: plan
review: light
review_mode: gates
tracks:
  - repo: app
    depends_on: []
---

# WO-0054 — Usage screen — the recorded month becomes one console surface (month head · live quota windows · role/model/cache breakdown · per-WO ledger with ✦ drafts)

## Objective

WO-0052 built the recording floor — per-turn `session_usage` rows, the ctx/final checkpoints —
and named its only reader the CLI. WO-0053 surfaced the provider's live windows as a stop. The
operator's month picture is still a single budget line plus a terminal command. This WO builds
M7's third surface, the USAGE screen (`Surface: 'usage'`, the board/roadmap sibling): the month
budget head (the EXISTING `WorkspaceBudgetView`, rendered — never re-derived), the LIVE quota
windows of the running drive (provider-signal-only, WO-0053's rule inherited), and the spend
breakdown the token tour asked for — by role, by model, cache split, per work order — with the
✦ draft sessions' spend VISIBLE for the first time (their rows are write-only today). One data
change beyond reads: the delete cascades complete, so the ledger cannot outlive the head's basis.

## Context

- **Acceptance basis: mockup frames 01–04** (`docs/ui-mockups/usage-ekrani.html` — the
  WO-0051/0053 flow; the tour precedes implementation, and the realized-app round re-presents it).
- **Reference (operator's pointer, 2026-08-29):** the z.ai personal-usage page — quota progress +
  reset clock + consumption breakdown — translated onto Docket's own basis: the subscription
  quota → the workspace month cap; the provider windows → the live `limitWindows` feed; the
  consumption stats → the `session_usage` ledger.
- **Code anchors (verified against the tree):** `session_usage` is append-only per-turn truth
  (`src/adapters/store/schema.ts:105-121`) and has NO aggregation anywhere — the only SUMs in the
  store sit over `session` (`monthSpendRow` 943-955, the roadmap subquery 1378-1385);
  `usageRowsFor` (507-546) is WO-scoped and CLI-only; draft rows (`work_order_id NULL`) are
  write-only, pinned at `store.test.ts:1832`; `deleteWorkOrderRows` (1244-1247) deletes `session`
  but never `session_usage` — and neither does `deleteWorkspace`; the draft drive never enters
  `activeSnapshot` (`drive-store.ts:102`), so a live-quota read must check the WO key AND
  `${wsId}:draft`; the surface mechanism is `Surface = 'board' | 'roadmap'`
  (`AppShell.tsx:19`) + the `let main` chain (`App.tsx:373-467`); the month window is
  `monthWindow` UTC (`src/core/budget.ts:25-32`); the IPC seam is
  `docket:source:workspace-month-spend` (`electron/main.ts:138`).
- **The token tour's S5 contract** (`docs/research/2026-08-28-token-usage-tour.md`, the
  "who needs it" column naming this screen): cache split → YES, aggregated here; model split →
  YES, TS-side rollup over `model_usage` JSON (TD-058 stays closed); per-turn rows → YES,
  aggregated per session (the per-turn tail stays the CLI's); fill history → the LATEST reading
  per session row (WO-0052 D7's floor ruling kept — no tail, no curve); turn economics → the
  observed-result COUNT (`num_turns` is leg-cumulative and never summed); interrupted honesty →
  `hasUnledgered`/`hasUnknown` qualifiers; per-category context split → NO (a different SDK
  surface; stays out with D7's other half).
- **WO-0052 deferrals this WO answers** (plan.md D6/D7): the UI read port; the draft-scoped
  read. Kept deferred: the `session_ctx_reading` tail, sampling cadence, the categories surface.
- **WO-0053 boundary:** this screen READS live `limitWindows`; it never touches the 429
  classification, the stamp, the LimitCard, the pane warn line, or the budget gate's math/copy.
- **Precedents:** `deriveRoadmapView` (adapter feeds facts, core derives — the shape
  `src/core/usage.ts` copies); `budget.ts` (pure view + `hasUnknown` honesty); the RoadmapScreen
  end-to-end (port → preload → `ipcMain.handle` → screen, `refreshRoadmap`); `FazCard`'s
  `.hairline-progress`; the pane warn line's mono-dim voice; the model-id ruling (ids are row
  DATA, WO-0052's ADR-0006 addendum).

## Scope

In scope:

- Core (test-first, ADR-0006): `src/core/usage.ts` — the pure read model. The adapter feeds
  fact rows (month-windowed `session_usage` rows WITHOUT `num_turns`/`duration_*` — the
  never-sum guarantee made structural; unwindowed session facts for role/ctx/unledgered; order
  facts) and `deriveUsageView` derives: `totals`, `byRole` (usd desc, zero-row roles absent),
  `byModel` (model ids verbatim; `modelUsage` else `model` else a `modelUnknown` bucket),
  `cache {freshIn, cacheRead, cacheCreation, hasCacheFigures}`, `workOrders` (usd desc,
  zero-spend absent), `draft?` (present only when draft rows exist), `sessions` (lastAt desc,
  `ctxPct` from the latest checkpoint, `turnCount` = observed-result count), `hasUnledgered`,
  `roleUnknown`, `empty`. Money sums cent-exact (the roadmap `round2` pattern).
- Port + store: `WorkOrderSource.workspaceUsage(id)` beside `workspaceMonthSpend`
  (`src/core/source.ts:117`); the adapter's workspace-scoped month read over `session_usage`
  (`at`-windowed) + session facts + order facts feeding the pure derivation;
  `SQL selects flat rows only, aggregation stays in core TS` (TD-058 rationale). **Cascade
  completion:** `deleteWorkOrderRows` and `deleteWorkspace` delete their `session_usage` rows —
  the ledger is append-only against the upsert, not against the OWNER. The `store.test.ts:1832`
  "write-only until queue 4" pin un-pins: the draft read lands here.
- IPC: `docket:source:workspace-usage` (preload + `main.ts`, the three-line seam).
- UI: the third surface — `Surface: 'usage'` + the third `Segmented` option (`Kullanım`);
  `UsageScreen` (the 840px single-scroll column, `data-usage-screen`) with the month head card
  (the existing budget view: `.hairline-progress` fill + `budgetMonthReadout[Known]` + the
  status line — figures static, ADR-0012), the live quota panel (`data-usage-limit`; the
  running drive's `limitWindows`, WO arm and draft arm; absent without signal), the breakdown
  cards (roles / models / cache — app-card idiom, NO lamp: the lamp is a WO state signal), and
  the spend list (WO rows + the ✦ draft line INSIDE the list — non-additive — + session rows
  with the ctx reading through `contextReadout`). `refreshUsage` mirrors `refreshRoadmap` and
  rides the same four drive hooks as `refreshBudget`. Label families in BOTH bundles.
- E2E: seeded worlds (`kullanim` — cache-bearing, multi-model, single-model, draft-owner,
  out-of-month, unledgered, ctx-checkpointed rows; `bos` — zero rows, no budget) + specs: the
  full face, the empty face (no `$0,00`), the live quota (scripted `limit_windows` both arms),
  the drive-end refresh.
- Docs: ROADMAP M7 gains its third checkbox line; closure adds PRODUCT.md's first
  usage-visibility line and TD-058's "JSON + TS rollup sufficient" closing note.

Out of scope:

- The budget gate, its math, thresholds or copy (WO-0047's line — the head RENDERS the view).
- The limit surfaces (WO-0053's line): classification, the stamp, LimitCard, the warn line —
  and NO window-history persistence (the panel reads live state only).
- The ctx tail table / fill curve / per-category context split (WO-0052 D7's deferrals stand).
- The overage/credits sub-surface; any new SDK surface (this WO reads only what WO-0052/0053
  already record).
- TD-058 normalization (`session_usage_model`) — the JSON + TS rollup is the ruling unless the
  architect overturns it.
- Month picker, history backfill (pre-WO-0052 rows stay honestly absent), cross-workspace
  rollups.
- The tour's unopened candidates: the ✦ read-mass budget, the checkpoint diet, the plan.md
  embed diet.
- Any gate that ACTS — the screen informs; it never blocks a drive.

## Acceptance criteria

1. **Surface:** the third `Segmented` option switches to the usage screen (workspace-keyed);
   figures refresh on the drive hooks (`onEnd`/`onStarted`/`onAskResolved`/`onError`) — an
   in-flight drive's spend moves the screen while it is open.
2. **Month head:** the existing budget view rendered as-is — fill bar + readout + status line;
   `hasUnknown` carries the «bilinen harcama» basis; no budget math re-derived in this WO.
3. **Live quota:** the panel renders ONLY from the running drive's live `limitWindows` (the WO
   arm and the `${wsId}:draft` arm of the CURRENT workspace); no signal, no drive, or an
   unavailable windows surface → the section is ABSENT — never from rows, never from stamps,
   never a locally invented threshold.
4. **Breakdown:** by-role / by-model / cache cards from `usd_delta` sums windowed on `at`
   (`monthWindow`); model ids verbatim as row DATA; a `modelUnknown` bucket when 0-model
   results exist; the cache card only when cache figures exist.
5. **Spend list:** per-WO rows (usd desc; zero-spend WOs absent), the ✦ draft line inside the
   list (non-additive with the role buckets), session rows carrying role, usd, in→out, the
   observed-turn count, the last `at`, and the ctx reading when the checkpoint exists.
6. **Honesty:** an empty ledger renders the invitation face — NO figures anywhere (no `$0,00`);
   `hasUnledgered` flags in-month costed sessions whose per-turn ledger is empty (the pre-WO-0052
   vintage); `roleUnknown` flags orphaned rows; `num_turns`/`duration_*` are not even selected
   for this read.
7. **Drafts + cascades:** `workspaceUsage` includes `work_order_id NULL` rows under the draft
   section (the 1832 pin un-pinned, both directions); `deleteWorkOrder`/`deleteWorkspace` remove
   their `session_usage` rows (test-pinned both).
8. **Purity, neutrality, ladder:** core stays pure (`check:boundaries`); no vendor name or SDK
   symbol in core/ui code or copy (model ids and window kinds are data); typecheck (both),
   `npm test`, build, E2E green; label key parity in both bundles enforced by the compiler.

## Evidence required

- operator_checkpoint: mockup tour round 1 (frames 01–04, rulings locked); realized-app round 2
  (screenshots `docs/ui-shots/usage-*.png`, the live quota observed against a real drive).
- plan_approval: `plan.md` with the architect verdict — the five flagged decisions (below) are
  ruled there.
- pr_open: the PR (with the Model Used line), CI green on all five gates.
- verification: the closing verifier's AC pass at the merge head.
- closure: ROADMAP M7's third tick, PRODUCT.md line, TD-058 note.

## Stop-and-ask gates

- Any budget-gate semantics, math or copy change (WO-0047's line).
- Any limit-surface change, or persisting window history (WO-0053's line).
- A summed `$0,00` over zero rows, or any fabricated figure (absent means absent — the TD-030
  lineage).
- A `disabled`/`aria-disabled` attribute in `src/ui/`; a raw identifier as display text;
  `.replace(` in `src/ui/`; a vendor name in `src/` outside the adapter.
- Summing `num_turns`/`duration_ms`/`duration_api_ms` anywhere.
- Reading any SDK surface beyond what WO-0052/0053 already record.
- Rendering the live quota from anything but the running drive's feed.

## Notes

- **Decisions carried to the plan round (the architect rules on these):** (1) the head-vs-
  breakdown basis divergence (`session.cost_usd` over `started_at` vs `usd_delta` over `at`) —
  accepted and qualified, not reconciled; (2) the cascade completion touches the delete paths
  (WO-0020/WO-0032 territory) — needs explicit ratification as this WO's one data change;
  (3) the ✦ draft double-appearance (architect bucket AND draft line) — intended, two views of
  the same rows; (4) the live quota's single-active-drive scope (another workspace's drive does
  not paint this screen); (5) the reset-clock formatter (the bundle clock family, LimitCard's
  idiom).
- Sequencing (operator, 2026-08-28): floor (WO-0052, closed) → limit screen (WO-0053, closed) →
  THIS. The tour's S5 table row "usage screen" is this WO's grounding; quote it in `plan.md`.
- The mockup is the information contract, not pixel design — the app renders in the app-card
  idiom (the WO-0051 lesson: mockup approval never replaces seeing the realized UI).
