# WO-0054 plan — the usage screen

Provenance: the acceptance basis is the approved mockup (`docs/ui-mockups/usage-ekrani.html`,
rev 1 — six kararlar locked with the operator at the mockup tour, 2026-08-29); the design source
is the operator-approved session plan (`.claude/plans/usage-ekran-token-turunun-fizzy-pebble.md`,
S1–S6). Every code anchor below was re-verified against `wo-0054-kullanim-ekrani` (2026-08-29,
head `9a92237`). The order's five flagged decisions are carried as RULINGS PROPOSED below with
the architect's resolutions recorded (first round, 2026-08-29: REVISE — 4 findings + 1 nit, ALL
FOLDED in this revision; see the verdict block under RULINGS). Nothing re-opens the
operator-locked product decisions (third surface, single 840px scroll, fixed section order,
provider-signal-only quota, lamp-less cards, static figures). `mode: plan`: the operator
approves this file, then the S's code.

## Design rulings

- **D1 — core vocabulary: the read model, `src/core/usage.ts` (PURE, test-first).** The
  `deriveRoadmapView` shape exactly: the adapter feeds FACTS, core derives the view, nothing in
  core parses SQL or time (`window` arrives precomputed — `monthWindow(new Date())` is called
  ONCE in the store, `src/adapters/store/index.ts:944` idiom; core stays clock-free). Types
  (model ids and role names cross as DATA — ADR-0006's WO-0052 addendum; `ModelUsageLine` is
  `src/core/types.ts`'s WO-0052 export, reused, not re-declared):

  ```ts
  /** One month-windowed session_usage row — num_turns/duration_ms/duration_api_ms are
   *  deliberately ABSENT: the leg-cumulative legs are not even selected (AC6's never-sum
   *  guarantee made structural, not conventional). */
  export interface UsageFactRow {
    workOrderId: WorkOrderId | null;      // NULL = a ✦ draft session's row (the owner pair)
    providerSessionId: string;            // the core-side join key to the session fact
    at: string;                           // the result's ISO receive stamp — the window key
    tokensIn: number;                     // fresh input (the summable half)
    tokensOut: number;
    usdDelta: number;                     // the per-turn delta — the ONLY money this read sums
    cacheRead?: number;                   // NULL-hydrated absent, never 0
    cacheCreation?: number;
    model?: string;                       // the single-model shortcut (NULL for 0-or-multi)
    modelUsage?: ModelUsageLine[];        // the verbatim per-model split — wins over `model`
  }

  /** One session row, UNWINDOWED — the join side + the honesty probes. No transcript, no
   *  pendingNotes: this read lifts nothing it does not render. */
  export interface UsageSessionFact {
    providerSessionId: string;
    workOrderId: WorkOrderId | null;      // null = the ✦ draft session row
    role?: SessionRole;                   // absent = the row's own column is NULL (legacy vintage)
    costUsd?: number;                     // the session's own observed total — the unledgeredCount probe
    startedAt?: string;                   // the in-month probe's key (ISO lexicographic, the
                                          // monthSpendRow precedent, store/index.ts:951)
    ctx?: { usedTokens: number; maxTokens: number }; // the LATEST checkpoint (schema.ts:88-89) —
                                          // one reading, never a curve (WO-0052 D7 stands)
  }

  export interface UsageOrderFact { id: WorkOrderId; title: string }

  export interface DeriveUsageInput {
    window: { startIso: string; endIso: string };   // the UTC calendar month
    rows: UsageFactRow[];
    sessions: UsageSessionFact[];
    orders: UsageOrderFact[];
  }

  export interface UsageRoleBucket  { role: SessionRole; usd: number; tokensIn: number; tokensOut: number; sessionCount: number; pct: number }
  export interface UsageModelBucket { model?: string; usd: number; tokensIn: number; tokensOut: number } // model ABSENT = the modelUnknown bucket (rendered last)
  export interface UsageCacheSplit  { freshIn: number; cacheRead: number; cacheCreation: number; hasCacheFigures: boolean }
  export interface UsageOrderRow    { id: WorkOrderId; title: string; usd: number; sessionCount: number }
  export interface UsageDraftRow    { usd: number; tokensIn: number; tokensOut: number; sessionCount: number }
  export interface UsageSessionRow {
    providerSessionId: string;
    workOrderId: WorkOrderId | null;      // null renders the ✦ draft marker, never a raw null
    role?: SessionRole;                   // absent → the roleUnknownCount voice
    usd: number; tokensIn: number; tokensOut: number;   // Σ over the session's windowed rows
    turnCount: number;                    // the OBSERVED-RESULT COUNT (rows) — never num_turns
    lastAt: string;                       // the latest row `at` — the list's sort key
    ctxPct?: number;                      // round(used/max·100), present only when both exist
    ctx?: { usedTokens: number; maxTokens: number };  // the readout's denominator half
  }

  export interface WorkspaceUsageView {
    empty: boolean;                       // ZERO windowed rows (draft rows are rows)
    totals: { usd: number; tokensIn: number; tokensOut: number };
    byRole: UsageRoleBucket[];            // usd desc; a role with zero rows is ABSENT
    byModel: UsageModelBucket[];          // usd desc; model ids verbatim
    hasModelSplit: boolean;               // ≥1 row carried modelUsage lines — the models note's
                                          // precondition half (D2.2; false on an all-shortcut month)
    cache: UsageCacheSplit;               // hasCacheFigures gates the card (AC4)
    workOrders: UsageOrderRow[];          // usd desc; zero-spend WOs absent
    draft?: UsageDraftRow;                // present ONLY when draft rows exist (the 1832 un-pin)
    sessions: UsageSessionRow[];          // lastAt desc
    unledgeredCount: number;              // in-month costed sessions with an empty per-turn
                                          // ledger; 0 = false (labels keep their `n` — amendment 1)
    roleUnknownCount: number;             // rows whose session join fails (the owner is gone);
                                          // 0 = false
  }
  ```

  _Why:_ every figure the mockup renders (frame 01) maps to one field — role rows carry
  «3 oturum · 253k→61k» + «$13,17 · %75» (sessionCount/tokens/pct), model rows carry
  «402k→85k», the WO rows carry «9 oturum», the ✦ line carries «1 oturum», the session rows
  carry «48 sonuç» + «bağlam %62 · 124k/200k» — and nothing the mockup does not render is
  selected. The absent-fields-are-absent rule is structural: optional fields, no zeros.

- **D2 — the derivation rules (each a named test in S1).**
  1. **One window, two bases (the divergence is KEPT, narrated, never reconciled — architect
     F1, AMEND folded).** Rows window on `at` — `window.startIso <= at < window.endIso` (ISO
     strings compare lexicographically, the `monthSpendRow` shape). The HEAD reads the budget
     view (its own `started_at`-windowed `cost_usd` basis, WO-0047's); the BREAKDOWN reads
     `usd_delta` over `at`. A session that started last month and spent this month moves the
     two bases differently — and the divergence is NOT silent: the HEAD card carries ONE
     conditional dim line (`data-usage-divergence`, D6) rendered only when
     `|budget.monthUsd − usage.totals.usd| > 0.005` (the cent-half tolerance — the same
     epsilon discipline `warnThresholdUsd`'s `1e-9` guard serves in `src/core/budget.ts:38`;
     a pure exported predicate in usage.ts, unit-tested both directions, NOT a UI-side
     hand-rolled comparison). Karar-2 voice, bundle label, NO figures in the line, NO third
     figure anywhere, NO reconciliation; absent when the bases agree. Pinned three ways: an
     S1 predicate test both directions; the kullanim seed gains a last-month-started session
     WITH in-month rows (the divergent visit); E2E spec 1 asserts the line renders and
     spec 3 (a non-divergent budgeted visit, the `uyum` world) asserts `[data-usage-divergence]`
     count 0.
  2. **Row-partition for byModel (no double-landing) — and its divergence is NARRATED
     (architect F2, AMEND folded).** A row contributes to byModel through its FINEST available
     split exactly once: `modelUsage` lines when present (the lines' own tokens/usd — the
     row's own scalars then land ONLY in totals/byRole/cache/draft, never in byModel again),
     else `model`, else the modelUnknown bucket (the row's scalars). byModel is a partition of
     rows, so its Σ tracks totals up to the provider's own line-vs-total rounding — never
     Docket arithmetic on top (no residual invention, TD-030 lineage). That residual is a real
     state (the provider reports the split and the row total on separate channels), so the
     MODELS block carries ONE conditional note (`data-usage-models-note`, D6) rendered only
     when `hasModelSplit && |Σ byModel.usd − totals.usd| > 0.005` (the same cent-half
     tolerance, the same pure exported predicate `modelSplitDiverges(view)` — both inputs are
     view fields, core-tested both directions, the precondition constructed by the S1
     partition test). Unote voice: the provider's OWN split, not Docket's arithmetic; absent
     when they agree.
  3. **Roles join in core.** A row's role comes from its session fact via
     `providerSessionId`; a row with NO session fact contributes to totals/byModel/draft but
     never to byRole, and increments `roleUnknownCount` (the mockup's «kaydı var, satırı silinmiş»).
     Unreachable today (the cascade deletes sessions first, store/index.ts:1247 before :1251)
     but reachable from pre-WO-0054 vintage — the flag is the honest legacy voice, not dead
     code. The same flag covers the order-orphan: a deleted owner takes the session row with
     it, so "order missing" implies "session missing" in every real vintage — ONE flag, one
     cause class, no second surface invented.
  4. **byRole sorts usd desc, computes `pct = round(usd/totals.usd·100)`** (guard 0 total —
     unreachable when a bucket exists, guarded anyway). Zero-row roles absent — a session fact
     with no windowed rows paints no bucket.
  5. **workOrders/draft group by the ROW's own `work_order_id`** — no join to order.md, no
     WO-title lookup in core (the facts carry `title`). Zero-spend WOs absent (a WO whose rows
     all cost $0.00 asserts nothing). The draft bucket is the NULL-id rows; it exists ONLY when
     such rows exist; it is rendered inside the spend list and NON-ADDITIVE — byRole still
     carries the draft's own role bucket (the ✦ double-appearance, Ruling 3), and the view
     deliberately exposes both with no combined figure anywhere.
  6. **cache**: `freshIn` = Σ tokens_in over all rows; `cacheRead`/`cacheCreation` = Σ over the
     rows that report them; `hasCacheFigures` = at least one non-null cache figure anywhere.
     Cache-less months render no cache card (AC4) — never a 0/0/0 row.
  7. **sessions**: grouped by `providerSessionId` from the WINDOWED rows only (a session with
     zero in-window rows renders nothing — nothing observed to show); `turnCount` = the
     session's row COUNT (each row is one observed result — WO-0052's own contract);
     `ctxPct`/`ctx` ride the session fact's checkpoint, absent when either half is NULL.
  8. **unledgeredCount**: +1 per session fact with `startedAt` in-window + `costUsd` present +
     ZERO windowed rows (the pre-WO-0052 vintage: spend observed at the session level, per-turn
     ledger empty). Each of the three conditions negated in its own test.
  9. **Money is cent-exact `round2`** — the roadmap pattern (`src/core/roadmap.ts:196-198`) is
     module-private, so usage.ts duplicates the 3-liner WITH the comment naming its origin; no
     shared helper is extracted (fırsatçı refactor yok).
  10. **`empty`** = zero windowed rows. The empty face renders the invitation + (when
      `unledgeredCount > 0`) the unledgered qualifier — no figure anywhere (AC6; the E2E asserts
      the absence of a formatted amount, not just of a specific string). The composition is REAL
      and pinned (architect F4): `rows: []` + one costed in-month session fact → `empty` AND
      `unledgeredCount > 0` (a month of only pre-WO-0052 sessions) — an S1 test of its
      own; the qualifier's home on the empty face is directly UNDER THE INVITATION (the spend
      list does not render there, D6).

- **D3 — port + store: one read method, three flat readers, the cascade completed.**
  `WorkOrderSource` (`src/core/source.ts:87`) gains
  `workspaceUsage(id: WorkspaceId): Promise<WorkspaceUsageView>` beside `workspaceMonthSpend`
  (:117), with the same doc-comment discipline (what the basis is, what is absent). The store
  (`src/adapters/store/index.ts`):
  - `hydrateUsageRow(db-row)` — the row hydrator EXTRACTED from `usageRowsForWo`
    (:507-546, behavior byte-identical: the `...(r.x == null ? {} : {x})` spread idiom, the
    fail-open `model_usage` parse :536-544). The WO-scoped CLI read keeps working through it.
  - `usageFactRowsForWs(db, wsId, window)` — the sibling: `SELECT * FROM session_usage WHERE
    workspace_id = ? AND at >= ? AND at < ? ORDER BY id`, hydrated MINUS
    `numTurns/durationMs/durationApiMs` (the fields are not selected into the fact — AC6's
    structural guarantee lives HERE, not in a convention). The row's scalars hydrate as-is;
    `work_order_id` NULL stays NULL (the draft arm).
  - `usageSessionFacts(db, wsId)` — one flat query over `session` for the workspace (both
    arms: `work_order_id` IS NULL included — the draft session's role/ctx/cost), lifting only
    `provider_session_id, work_order_id, role, cost_usd, started_at, ctx_used_tokens,
    ctx_max_tokens`. `woid(...)` only on non-NULL (ADR-0003, the branded-id rule).
  - `usageOrderFacts(db, wsId)` — `SELECT id, title FROM work_order WHERE workspace_id = ?`.
  - `workspaceUsage(id)` — `monthWindow(new Date())` once; the three readers; `deriveUsageView`;
    wired into the returned object beside `workspaceMonthSpend` (:1534). SQL selects FLAT ROWS
    ONLY; every aggregation is core TS (TD-058 stays closed — the `model_usage` JSON never
    enters SQL).
  - **Cascade completion (the WO's ONE data change):** `deleteWorkOrderRows` (:1244-1253) gains
    `DELETE FROM session_usage WHERE work_order_id = ?` beside the session delete (:1247);
    `deleteWorkspaceRow` (:760-779) gains `DELETE FROM session_usage WHERE workspace_id = ?`
    beside the draft-session delete (:772) — one statement covers the WO rows (already gone via
    the per-WO cascade) AND the `work_order_id IS NULL` draft rows. Comment at both sites: the
    ledger is append-only against the UPSERT, not against the OWNER (WO-0052's own schema note,
    schema.ts:96-104 promised "never deleted by the session upsert"; a deleted owner's spend
    must not outlive the head's basis — the mockup's frame 03 note: «dördüncü tür önlendi»).
    NOT a schema change: no column, no table, no migration, `has-pending-model-changes`
    untouched.
  - `store.test.ts:1832` un-pins IN THE SAME COMMIT: the test's frame ("write-only until queue
    4") is replaced by its kept first half (the row persists under the draft owner) + the new
    second half (`store.workspaceUsage(ws.id)` carries the row under `draft`). The `usageRowsFor`
    invisibility assertion stays — the DRAFT read is workspace-scoped, not WO-scoped; both
    directions pinned (AC7).

- **D4 — IPC: the three-line seam, compiler-enforced, ONE STAGE WITH THE PORT (architect F3).**
  `electron/preload.ts` gains
  `workspaceUsage: (id) => ipcRenderer.invoke('docket:source:workspace-usage', id)` (the
  `workspaceMonthSpend` twin, preload.ts:29); `electron/main.ts` gains
  `ipcMain.handle('docket:source:workspace-usage', (_e, id) => store.workspaceUsage(id))`
  (beside :138). The seam lands in the SAME COMMIT/STAGE as the port widening (S2): the
  preload bridge declares `const source: WorkOrderSource` as a typed object literal
  (`electron/preload.ts:14`), so a widened port breaks the ELECTRON tsconfig the moment it
  exists — "the port breaks nothing yet" is false, and a port-without-seam stage gate cannot
  be green as stated. No `preload.d.ts` edit — `window.docket.source` is typed as
  `WorkOrderSource` (`src/renderer/preload.d.ts:28`), so the renderer's compile is enforced by
  the same widening: the proof is `npm run typecheck` (both tsconfigs) on the folded stage.

- **D5 — the third surface + the wiring.** `Surface = 'board' | 'roadmap' | 'usage'`
  (`src/ui/chrome/AppShell.tsx:19`) + the third `Segmented` option (`UI.surfaceUsage`,
  AppShell.tsx:97-98). `App.tsx`:
  - `const [usage, setUsage] = useState<WorkspaceUsageView | undefined>(undefined)` and
    `refreshUsage()` as the `refreshRoadmap` mirror (:309-322 — same guard, same catch-shape,
    `undefined` = loading);
  - the read-once-per-entry effect beside :328-330 (`surface === 'usage'` → refresh);
  - `refreshUsage()` added to the SAME four drive hooks `refreshBudget` rides — `onEnd`
    (:495), `onStarted` (:508), `onAskResolved` (:517), `onError` (:568) — and to the deps
    array (:575). The four hooks are the whole cadence: a mid-drive `turn_usage` row lands at
    the NEXT hook, never a per-turn listener (the cost figures never animate, ADR-0012;
    `refreshBudget`'s exact granularity — AC1's "in-flight spend moves the screen" is realized
    at the hook moments, pinned by E2E spec 4);
  - the `let main` chain gains the `usage` branch after the roadmap branch (:437-454), keyed
    `key={workspaceId ?? 'none'}` (the board's fresh-surface rule, :456-458) before the board's
    final `else`.
  The roadmap branch's ordering is untouched; the branch condition chain stays if/else-if.

- **D6 — the screen (`src/ui/screens/UsageScreen.tsx` + `src/ui/components/usage/`** — a new
  section directory, the `board/`/`roadmap/` precedent; four components, one grammar):
  `<main className="... max-w-[840px] ..." data-usage-screen>` — one scroll, fixed order: month
  head → live quota → breakdown → spend list (mockup karar 1). `view === undefined` → the
  named loadline (`UI.loadUsage`, the TD-037 rule); `view.empty` → the invitation face and the
  sections BELOW it do not render (no zero bars, no empty cards, AC6) — and the unledgered
  qualifier, when `unledgeredCount > 0` rides the empty face, renders DIRECTLY UNDER THE INVITATION
  (architect F4: the spend list does not render there, so the line's home on this face is the
  invitation's own card; `usageUnledgeredLine` copy written ARM-TRUE — it never references a
  «bilinen harcama» hane the no-cap arm lacks).
  - **`UsageHeadCard`** — the EXISTING budget view rendered, never re-derived (AC2): the
    `.hairline-progress` fill (width `min(100, round(monthUsd/cap·100))%`, the FazCard markup,
    FazCard.tsx:76 — the ONE transition on the screen, `.36s`, and it fires on the month's
    fill, never on a cost figure) + `budgetMonthReadout`/`budgetMonthReadoutKnown`
    (tr.ts:739-740) + `budgetLine` when `status !== 'ok'` (tr.ts:272) + the known-basis note
    when `hasUnknown` (a DIFFERENT condition — the budget view's own NULL-cost honesty, not
    the basis divergence; COUNT-FREE — `WorkspaceBudgetView` carries `hasUnknown` only and
    widening WO-0047's shared read for a cosmetic number is not this WO's business, architect
    amendment 2; the `budgetMonthReadoutKnown` voice already names «bilinen harcama»)
    + the **basis-divergence line** (`data-usage-divergence`, a dim
    unote) rendered ONLY when the two bases disagree —
    `|budget.monthUsd − usage.totals.usd| > 0.005`, D2.1's pure predicate (architect F1:
    karar 2's niteleyici satır, kept as a NARRATION — bundle copy, no figures, no third
    number, never a reconciliation; ABSENT on the no-cap arm — the predicate needs
    `budget.monthUsd`, and with no threshold there is no head figure to differ from,
    architect amendment 3). The head's data is the `budget` prop App
    already loads and refreshes
    (App.tsx:288-302) — no second budget read, no second math. **The no-threshold arm:** with
    no configured cap the budget view is `undefined` (App's own rule, :285) and the head
    renders the ledger's observed month figure (`UI.usageMonthObserved(totals.usd)`) with NO
    bar and NO cap copy — a missing denominator is absent, never invented (the tour's
    operational note: this machine has no `budget:*` key today, so this arm is the COMMON one,
    not an edge).
  - **`UsageLimitPanel`** (`data-usage-limit`) — reads the running drive's fold through the
    drive store, BOTH arms (the draft key never enters `activeSnapshot`,
    `src/ui/components/session/drive-store.ts:101-105`): the WO arm via `activeSnapshot()`
    (running AND its `woId` ∈ the workspace's WO ids — a prop, App's memo has them) and the
    draft arm via the `${workspaceId}:draft` key (RoadmapScreen.tsx:87 idiom) with
    `driveStore.get(key)?.running`. The store's one-active-drive rule makes the arms mutually
    exclusive in practice; the panel renders whichever is live. Per window:
    `UI.limitWindowLabel(kind)` (tr.ts:760 — a raw kind never reaches JSX) + the utilization as
    TEXT (`UI.usageLimitUtilization(pct)`, `%86` — no bar: the denominator is the provider's,
    mockup karar 4) + `UI.usageLimitResetLine(resetAt)` through `UI.limitClock` (tr.ts:745 —
    the day-aware bundle clock family; Ruling 5). Pct voice: `text-signal` when the fold's
    `status` is `warning`/`blocked`, `text-inkdim` otherwise (the mockup's `.pct`/`.pct.steady`
    pair). NO breathing dot (see Ruling 7). Panel head meta names the drive
    (`usageLimitMeta(role, woLabel)` / `usageLimitDraftMeta(role)`).
    `limitWindows` undefined, no running drive, or a drive of ANOTHER workspace → the section
    is ABSENT (`data-usage-limit` count 0) — never from rows, never from a `limit_reset_at`
    stamp, never a locally invented threshold (AC3; the WO-0053 rule inherited; the stamp
    belongs to LimitCard, which stays untouched).
  - **`UsageBreakdownCard`** — ONE card, three blocks (roller / modeller / cache), the
    app-card idiom (`rounded-md border border-hairline bg-surface px-3 py-2.5`, `.readout`
    mono meta) with NO `.lamp` (mockup karar 6 — the lamp is a WO state signal). Roles through
    `ROLE_LABELS` (tr.ts:39) + `formatUsd`/`formatTokens`; models verbatim mono (row DATA —
    the WO-0052 ADR-0006 ruling, the sanctioned display exception); the modelUnknown bucket
    last through `usageModelUnknown(usd)`; the **models-split note** (`data-usage-models-note`,
    a dim unote under the model rows) rendered only when `modelSplitDiverges(view)` —
    `hasModelSplit && |Σ byModel.usd − totals.usd| > 0.005` (architect F2: the provider's OWN
    split, narrated in the unote voice as exactly that — never Docket arithmetic, never a
    correction figure; absent when the figures agree); the cache block ONLY when
    `hasCacheFigures` (`usageCacheLine(fresh, read, creation)`); the total row
    (`usageTotalLabel`). Cache-less rows never zero-fill (D2.6).
  - **`UsageSpendList`** — the WO rows (`woIdLabel` + title + `usageWoValue(usd, n)`; usd desc;
    zero-spend absent), the ✦ draft row INSIDE the list (`usageDraftRowLabel`, the signal-tint
    title the mockup gives it) with the non-additive note line, then the OTURUMLAR section:
    role word in its role hue (the SessionCards head idiom) + the where cell
    (`woIdLabel(wo)` or `usageDraftWhere`) + `formatUsd` + in→out (`formatCost`'s token half) +
    `usageSessionTurns(n)` + the last `at` (the bundle clock family) + `contextReadout(pct,
    used, max)` (tr.ts:715) ONLY when the checkpoint exists. The two honesty lines ride the
    list's foot: `usageUnledgeredLine(n)` (ARM-TRUE copy — F4: the mockup's «bilinen harcama
    hanesinde taşınır» clause is arm-dependent and is NOT carried; the line states only what is
    always true: the per-turn ledger is empty, the costs do not enter the breakdown),
    `usageRoleUnknown(n)`.
  - **Labels** — both bundles, the compiler enforces parity. New `usage*` family
    (~26 keys, copy per the mockup, signatures fixed at S3): `surfaceUsage` («Kullanım»/
    «Usage»), `loadUsage`, `usageEmptyLine`, `usageEmptyNote`, `usageMonthTitle`,
    `usageMonthMeta(date)`, `usageMonthObserved(usd)`, `usageKnownBasisNote` (count-free —
    amendment 2),
    `usageBasisDivergence` (F1 — static, no figures), `usageModelSplitNote` (F2 — unote voice),
    `usageLimitTitle`, `usageLimitMeta(role, wo)`, `usageLimitDraftMeta(role)`,
    `usageLimitUtilization(pct)`, `usageLimitResetLine(resetAt)`, `usageRolesTitle`,
    `usageRoleSub(n, tin, tout)`, `usageRoleValue(usd, pct)`, `usageModelsTitle`,
    `usageModelUnknown(usd)`, `usageModelSub(tin, tout)`, `usageCacheTitle`,
    `usageCacheLine(f, r, c)`, `usageTotalLabel`, `usageByWoTitle`, `usageWoValue(usd, n)`,
    `usageDraftRowLabel`, `usageDraftWhere`, `usageSessionsTitle`, `usageSessionTurns(n)`,
    `usageUnledgeredLine(n)` (arm-true copy, F4), `usageRoleUnknown(n)`. Reused, NOT duplicated:
    `budgetMonthReadout[Known]`, `budgetLine`, `limitWindowLabel`, `limitClock`,
    `contextReadout`, `formatUsd`/`formatTokens`/`formatCost`, `woIdLabel`, `ROLE_LABELS`,
    `formatDateTime`. CI traps watched: no `.replace(` in `src/ui/` (the ADR-0007 proxy), no
    `disabled`/`aria-disabled`/`data-disabled` (nothing here gates — the screen informs, it
    never blocks), no raw identifier interpolation (ids only through `woIdLabel`/
    `limitWindowLabel`; model ids are the sanctioned DATA exception).

- **D7 — E2E: three seeded worlds, four specs, no clock seam.** `e2e/seed.ts` gains the worlds
  and PRINTS them (`USAGE=` beside `ROADMAP=`, seed.ts:474/559; the driver parses at
  ui.mjs:2015-2018):
  - **`kullanim`** — a workspace with `setBudget(ws.id, { capUsd: 20, warnPercent: 80 })`
    (the seed.ts:293 idiom) and, through `store.recordTurnUsage` (its FIRST use in the seed —
    verified: zero calls today) + `recordSession` rows: a cache-bearing row
    (`usage: { cacheRead, cacheCreation }`), a multi-model `modelUsage` row (2 lines →
    `model` NULL) whose LINES DELIBERATELY DO NOT SUM to the row's `usd_delta` (the F2
    precondition — the models-split note's live visit), a single-model row, a **draft-owned**
    row (`owner: { kind: 'draft', workspaceId }` — the 1832 shape), an **out-of-month** row
    (`at` last month — the exclusion pin), a costed-but-ledgerless session (`recordSession`
    with `cost` + `startedAt` in-month, ZERO `recordTurnUsage` calls — the `unledgeredCount`
    pin), one session with a ctx checkpoint (`recordSession` with `ctx:`), and a
    **last-month-STARTED session that carries in-month rows** (`startedAt` last month, its
    `recordTurnUsage` rows `at` this month, `cost_usd` ≠ its in-window `Σ usd_delta` — the F1
    divergence visit). Plus one zero-spend WO (absent from the list).
  - **`bos`** — a workspace with zero usage rows and NO budget key (the empty face must have
    nothing to lean on — no cap readout, no bar).
  - **`uyum`** (architect F1's negative control) — a budgeted workspace whose two bases AGREE:
    one session entirely in-month, `cost_usd` == its single row's `usd_delta`, no
    model-split divergence, no `unledgeredCount` — the head readout renders and
    `[data-usage-divergence]` must be ABSENT.
  - Specs (`e2e/ui.mjs`, the WO-0053 spec block's tail ~2600):
    1. **the full face** — switch to `kullanim`, open Kullanım: the head readout + fill width
       > 0; the **divergence line present** (`[data-usage-divergence]` count 1 — F1, the
       last-month-started session's doing) and the **models-split note present**
       (`[data-usage-models-note]` count 1 — F2, the non-summing lines); the role/model/cache
       rows with their figures; the WO rows usd-desc + the ✦ draft row inside the list; a
       session row carrying «bağlam %…» (the ctx readout) and «… sonuç»; the unledgered line
       present; NO out-of-month figure (the exclusion asserted through the total); screenshot
       `docs/ui-shots/usage-full@980.png`.
    2. **the empty face** — `bos`: the invitation line, `[data-usage-limit]` absent, and NO
       formatted amount anywhere on the screen (assert no `$0,00`/`$0.00` shape — the TD-030
       pin, not a single-string grep).
    3. **the live quota** — open `uyum` first (F1's non-divergent visit):
       `[data-usage-divergence]` count 0 while the head readout renders; then start a scripted
       drive: no signal → `[data-usage-limit]` count 0;
       `window.docket.e2e.emit({kind:'limit_windows', …})` (ui.mjs:2550 idiom) → the panel
       with `5 saatlik pencere`, `%62`, the reset line; the drive ends clean → the panel GONE
       (live-only); and on the roadmap workspace the ✦ draft drive's own `limit_windows` → the
       panel (the draft arm). A drive started on ANOTHER workspace never paints this screen
       (the karar-4 note, «bu ekran onu göstermez»).
    4. **the drive-end refresh** — with the usage screen OPEN, emit a mid-drive
       `turn_usage` (the e2e-runner pushes non-terminal events verbatim,
       electron/e2e-runner.ts:116) → the figure HOLDS (the four-hook cadence, honestly
       pinned); `turn_complete` with a cost → `onEnd` fires → the figure MOVES (AC1).

- **D8 — docs (S5).** ROADMAP.md M7 (the :432-485 block) gains the third `- [ ]` line at impl
  (ticked at closure, the WO-0052/0053 format); PRODUCT.md's first usage-visibility line and
  TD-058's closing note («the JSON + TS rollup is sufficient — no normalized
  `session_usage_model` table needed») land AT CLOSURE, not at impl. No ADR addendum is
  expected: ADR-0006's data-vs-code split covers model ids and window kinds (stated in the
  closure commit per the WO-0053 precedent); the cascade completion is a store-path completion
  under ADR-0010's OWNED-half classification, not a new decision (Ruling 2); and **ADR-0013's
  classification (architect F5, recorded here so closure does not re-litigate):**
  `UsageLimitPanel` is the PANE-WARN-LINE family — a live meter of the running drive's fold,
  no transcript, no decision card, no DriveControls contract, no pane-chrome — so NO ADR-0013
  addendum is expected; this WO builds no new drive-surface grammar, it re-speaks the WO-0053
  warn line's. TD-016 gains nothing — this WO calls no SDK surface.

## The tour's S5 field→consumer map (quoted verbatim — the order's grounding)

> | metric | SDK surface | Docket today | who needs it |
> |--------|-------------|--------------|--------------|
> | `cache_read_input_tokens` / `cache_creation_input_tokens` | result.usage, getContextUsage().apiUsage | dropped | usage screen, resume pricing, any "true input" claim |
> | context fill history (`usedTokens/maxTokens/%`) | live getContextUsage | live-only, never persisted | usage screen, fill-over-time |
> | per-category context split (system/tools/MCP/agents/skills/messages) | getContextUsage().categories | dropped (probe proves it's there) | usage screen "where is my context" breakdown |
> | `modelUsage` (per-model cost/tokens) + `model` | result | dropped | usage screen (model split), pricing honesty |
> | `num_turns`, `duration_ms` / `duration_api_ms` | result | dropped (Docket re-derives wall time) | usage screen, turn economics |
> | rate-limit windows / 429 counters | `usage_EXPERIMENTAL` session controls | never called | **limit screen (queue item 3)** |
> | interrupted-drive spend | abort precedes result | honest zeros (measured: the $0.00 leg) | cost honesty, usage screen |
> | per-turn / per-leg cost rows | result per turn | collapsed to one session total | usage screen curves, steer economics |

Scope note: THIS WO covers rows 1 (the cache card), 2 (the LATEST reading only — the session
row's ctx cell; no tail, no curve, WO-0052 D7 stands), 4 (the model split, TS-side rollup —
TD-058 stays closed), 5 (the OBSERVED-RESULT COUNT only; `num_turns`/durations are not even
selected), 7 (the `unledgeredCount` qualifier — the honesty limit itself stays), 8 (the per-turn
rows aggregated per session/WO/role/model; the per-turn TAIL stays the CLI's). Row 3 stays OUT
(a different SDK surface, WO-0052 D7's other half).

## RULINGS PROPOSED — the order's five flagged decisions (ruled by the architect, 2026-08-29)

**The architect's verdict (first round, 2026-08-29): REVISE — 4 findings + 1 nit, ALL FOLDED
into this revision.** Verdicts: R1 AMEND (F1), R2/R3/R5/R6 ACCEPT, R4 AMEND (F2 — the verdict
list's "R4 AMEND" lands on the byModel divergence: D2.2 + risk R4), R7 ACCEPT-the-drop
(explicitly). Findings: F1 [major] the basis divergence under-qualified → the head's
conditional divergence line (D2.1/D6, seed + spec pins); F2 [major] the byModel partition's
silent divergence → the models-block conditional note (D2.2/D6, S1 precondition, seed + spec
pins); F3 [minor] S2's gate was false for the electron half → the port widening folded into
the IPC seam stage (D4, Steps S2); F4 [minor] the empty face's unledgered line home + arm-true
copy → under-the-invitation, copy fixed (D2.10/D6, S1 composition test); F5 [nit] the
ADR-0013 classification recorded for closure (D8). Accepted residual risks are recorded
verbatim under R7 of Risks.

**The architect's verdict (second round, 2026-08-29): PROCEED — all five folds CONFIRMED**
(F1-F5 verified against the anchors; the S1-S5 renumbering left no orphans; AC1-8 all mapped
to a stage and a test that measures the right thing), conditional on three one-edit
amendments issued as rulings and folded into this revision: (1) [minor] label arity vs view
shape — the view carries `unledgeredCount`/`roleUnknownCount` numbers (0 = false; the labels
keep their `n`; S1 asserts the counts); (2) [minor] `usageKnownBasisNote` is COUNT-FREE
(`WorkspaceBudgetView` carries `hasUnknown` only — widening WO-0047's shared read for a
cosmetic number is not this WO's business); (3) [nit] the divergence line is ABSENT on the
no-cap arm (the predicate needs `budget.monthUsd`; the self-contradictory clause rewritten).
No further architect review required.

1. **The basis divergence (head vs breakdown) — VERDICT: ACCEPT + QUALIFY, not reconcile;
   AMENDED (F1) — the qualification is now a CONDITIONAL LINE, not just meta.** The head
   reads `session.cost_usd` over `started_at` (WO-0047's `monthSpendRow`, store/index.ts:943-955,
   byte-untouched); the breakdown reads `usd_delta` over `at` (D2.1). Reconciling would mean
   either re-windowing the usage rows by a session key SQL does not carry without a JOIN, or
   re-deriving the budget's math here — the first is the TD-058-shaped complexity the order
   rules out, the second crosses WO-0047's line. Karar 2's niteleyici satır is therefore ONE
   conditional dim line on the HEAD card, rendered only when
   `|budget.monthUsd − totals.usd| > 0.005` (D2.1's pure predicate) — basis-naming meta lines
   alone do NOT satisfy it, and the known-basis note (which fires on `hasUnknown`, a different
   condition) is not the qualifier. Pinned: the S1 predicate test, the kullanim divergent
   session (spec 1 asserts the line), the `uyum` non-divergent visit (spec 3 asserts count 0).
   NO change to any budget read (the stop-and-ask gate).
2. **The cascade completion — VERDICT: ACCEPT (ratified as this WO's one data change).** It touches WO-0020/0032's
   delete paths (store/index.ts:1244-1253, :760-779) — outside a pure read screen, but the
   totals' honesty depends on it: without it a deleted owner's `usd_delta` keeps counting in
   `byRole`/`byModel`/`draft` while its head contribution vanished (the mockup's frame 03
   names this exactly). It is additive (two DELETE statements, no schema change, no
   migration), it completes WO-0052's own append-only promise ("never deleted by the session
   upsert" — the upsert, not the owner), and both directions are test-pinned (S2).
3. **The ✦ draft double-appearance — VERDICT: ACCEPT (intended, two views of one row set).** The draft rows'
   spend appears in the MIMAR role bucket (via the session join) AND in the list's ✦ line.
   The mockup says it in copy («aynı satırların iki görünümü, toplanmaz»); the view exposes
   both with NO combined figure; S1 pins the numbers side by side so no later refactor
   "fixes" them into one.
4. **The live quota's single-active-drive scope — VERDICT: ACCEPT (confirmed by the store's
   own rule).** One drive runs at a time (`drive-store.ts:128`); the panel reads the CURRENT
   workspace's arm only (WO arm's woId ∈ this workspace's WOs, or the `${wsId}:draft` arm).
   Another workspace's drive paints nothing here (the mockup's «bu ekran onu göstermez»). No
   persistence, no history: the panel is live fold state only (WO-0053's line).
5. **The reset-clock formatter — VERDICT: ACCEPT (reuse `UI.limitClock`)** (tr.ts:745-759, the
   day-aware family LimitCard already renders, LimitCard.tsx:23). No new formatter, no
   absolute-stamp fallback: `usageLimitResetLine(resetAt)` wraps `limitClock` in both bundles.
   The seven-day window gets the day-aware form the family already carries.
6. **CLARIFICATION: the no-cap head arm — VERDICT: ACCEPT.** With no configured budget the
   App's budget view is `undefined` (App.tsx:285-296) — the operator-locked "the head renders
   the EXISTING budget view" then renders NOTHING, and the tour records this machine has no
   `budget:*` key. Ruling: `usageMonthObserved(totals.usd)` — the ledger's real month sum,
   no bar, no cap copy, never a fabricated denominator. It is the one head figure this WO
   derives, and it is a real sum over real rows (not a `$0,00` — the empty face still rules).
7. **CLARIFICATION: the mockup's breathing live-dot — VERDICT: ACCEPT-THE-DROP (explicit).**
   The mockup's quota rows carry a 5px `breathe` dot; it is NOT carried — the kit's only
   always-on animation is the WO-state lamp breathe, karar 6 keeps lamps off this screen, and
   ADR-0012's juice rule is transitions-only. The drop is a RECORDED RULING, not an omission:
   liveness is stated by the CANLI readout + the drive meta line, and closure may cite this
   paragraph rather than re-arguing the dot.

## Steps

Order: core → port/store+IPC → UI → E2E → docs — the port widening and the preload/main seam
are ONE stage (architect F3: `electron/preload.ts:14` types the bridge as `WorkOrderSource`,
so a port-without-seam stage cannot typecheck green). `src/core/` is test-first (ADR-0006);
RED before GREEN at every step.

- **S1 (core, TDD):** `src/core/usage.ts` (D1's types + `deriveUsageView` + the two pure
  predicates `basisDiverges(budgetUsd, totalsUsd)` and `modelSplitDiverges(view)`, both on the
  0.005 cent-half tolerance) + `src/core/__tests__/usage.test.ts`. Tests, one per D2 rule:
  empty input → `empty` + no buckets + no flags; cent-exact sums through `round2`; the window
  excludes out-of-month rows AND keeps an in-month row of a last-month-started session
  (D2.1's divergence pin); **the composition test (F4)**: `rows: []` + one costed in-month
  session fact → `empty` AND `unledgeredCount > 0`; **the two predicates (F1/F2)**: each
  both directions, and the F2 precondition CONSTRUCTED (multi-model row whose lines do not sum
  to its `usd_delta` → `hasModelSplit` true, `modelSplitDiverges` true; agreeing lines →
  false); byRole usd-desc + pct + zero-row roles absent; the byModel row-partition
  (modelUsage lines win, single-model via `model`, 0-model → unknown, a multi-model row's own
  scalars never double-land); cache sums + `hasCacheFigures` both directions; workOrders
  usd-desc + zero-spend absent + the title from the order fact; the draft bucket + the
  double-appearance numbers side by side; sessions lastAt-desc + `turnCount` = row count +
  `ctxPct` present/absent; `unledgeredCount` three directions; the role-orphan row → totals
  yes, byRole no, `roleUnknownCount > 0`; the order-orphan (session also gone) → the same counter,
  `workOrders` empty. Gate: `npm test` + `npm run check:boundaries` (core stays pure — no
  React, no Node).
- **S2 (port + store + cascade + un-pin + IPC seam — one locking stage, F3):** the port member
  (D3) TOGETHER with the preload member + the `ipcMain.handle` (D4); `hydrateUsageRow`
  extracted from `usageRowsForWo` (:507-546, byte-identical behavior — the CLI `show` tail is
  the regression witness); `usageFactRowsForWs` / `usageSessionFacts` / `usageOrderFacts`;
  `workspaceUsage`; the two DELETEs (D3's cascade). Tests (`store.test.ts`): workspace scoping
  (another workspace's rows never appear); the `at` window (out-of-month excluded; in-month
  rows of an old session included — the divergence pinned at the store level too); draft rows
  visible under `draft` (the 1832 rewrite, both directions); the role join + `ctxPct`; the
  orphan row → `roleUnknownCount > 0`; a corrupt `model_usage` blob → absent fail-open; `unledgeredCount`
  both directions; zero rows → `empty`; `deleteWorkOrder` removes the WO's usage rows;
  `deleteWorkspace` removes the workspace's (draft rows included); `usageRowsFor` unchanged
  (the CLI pin). Gate: `npm test` + `npm run typecheck` BOTH tsconfigs — the stage is only
  green because the seam landed WITH the port (`electron/preload.ts:14` types the bridge as
  `WorkOrderSource`; `preload.d.ts:28` types the renderer side; the widening compiles nowhere
  without its channel). The IPC has no behavior test of its own; the E2E rides it.
- **S3 (UI + labels):** the Surface widening + the Segmented option (D5); `refreshUsage` + the
  four hooks + the `let main` branch; `UsageScreen` + the four components + the label family
  in BOTH bundles (D6) — including `data-usage-divergence` and `data-usage-models-note` (F1/F2)
  and the empty face's under-invitation line (F4). Verified by RUNNING it (ADR-0006's React
  rule): `npm run build` + `npm run dev` smoke against the seeded E2E DB, then S4's specs take
  over as the regression net. Gate: `npm run typecheck` + `npm test` + `npm run build`.
- **S4 (E2E):** the three seed worlds + the `USAGE=` line + the four specs (D7). Gate:
  `npm run test:ui` — the new specs green AND the WO-0053 block (:2493+) green unchanged (the
  Surface widening is the regression risk it watches); the zero-console-errors spec stays last
  and green.
- **S5 (docs, at impl):** the ROADMAP M7 third `- [ ]` line (D8). Gate: the full ladder —
  `npm run typecheck && npm test && npm run build && npm run check:boundaries &&
  npm run test:ui`. (PRODUCT.md + TD-058 + the M7 tick land at closure, per D8.)

## Verification mapping (AC1-8 → stage/tests)

| AC | Where it is proven |
|----|--------------------|
| 1 Surface + hook refresh | S3 (Surface/Segmented/branch) · S4 spec 4 (the figure holds mid-drive, moves at `onEnd`) |
| 2 Month head = the existing view | S3 `UsageHeadCard` (no budget math in the diff — the head renders the `budget` prop) · S1 the divergence predicate both directions (F1) · S4 spec 1 (readout + fill + the divergence line) · spec 3 (count 0 on `uyum`) · the budget pins untouched (`budget.test.ts`, `store.test.ts` WO-0047 block) |
| 3 Live quota = the running drive's feed only | S3 `UsageLimitPanel` (both arms, no row/stamp source) · S4 spec 3 (absent → present → gone; the other-workspace arm) |
| 4 Breakdown cards | S1 (byRole/byModel/cache rules + the partition pin + the split predicate, F2) · S2 (windowing) · S4 spec 1 (figures + the models-split note) |
| 5 Spend list | S1 (workOrders/draft/sessions shapes) · S2 (draft visible) · S4 spec 1 (✦ inside the list, ctx readout, turn counts) |
| 6 Honesty | S1 (`empty`/`unledgeredCount`/`roleUnknownCount` + the empty∧unledgered composition, F4; `num_turns` absent from `UsageFactRow` — a compile-time fact) · S4 spec 2 (no formatted amount on the empty face) |
| 7 Drafts + cascades | S2 (the 1832 rewrite both directions; the two DELETE tests) |
| 8 Purity/neutrality/ladder | S1 `check:boundaries` · the full ladder at S5 · label parity by compiler · no vendor name outside `src/adapters/` (model ids are row DATA) |

## Deviations

None in implementation (the plan is pre-code). The architect round's 4 findings + 1 nit
(2026-08-29) are folded INTO this revision — they amend the design, they are not deviations
from the order; the verdicts are recorded under RULINGS. (Any deviation found during
implementation lands here, numbered, with its reason; a deviation that touches a stop-and-ask
gate STOPS instead.)

## Risks

- **R1 — the Segmented widening ripples.** `Surface` is a 2-value union today
  (AppShell.tsx:19); every exhaustive branch on it (the `let main` chain, any
  `surface === 'board'` helper) must gain the third value explicitly, and the e2e's
  board/roadmap navigation helpers (`openRoadmap`, ui.mjs:2018; `backToBoard`) must keep
  passing untouched. The WO-0053 block is the canary: if it moves, the widening leaked.
- **R2 — the 1832 un-pin is a PROMISE change.** WO-0052's plan called draft rows write-only
  "until queue 4"; this is queue 4. The rewrite keeps the test's first half (the row persists)
  verbatim and changes only its frame — if the rewrite starts failing for a reason other than
  the new read, that is a STOP (the surviving half is WO-0052's pin, not this WO's to fix).
- **R3 — the `budget` prop's freshness.** The head renders App's `budget` state, whose refresh
  cadence is the same four hooks `refreshUsage` joins — so head and breakdown move together
  by construction. If the architect prefers the head to read the usage read's own window
  instead, that re-derives budget math (the gate) — rejected; the two-read design is the
  point.
- **R4 — `model_usage` line totals may not sum to the row's `usd_delta` — RESOLVED by the
  architect (F2, AMEND folded).** Provider-reported on separate channels; D2.2 keeps them in
  separate buckets (byModel from the lines, totals from the row scalars) and invents no
  residual — and the divergence is no longer silent: the models block carries the conditional
  `data-usage-models-note` (`modelSplitDiverges`, the provider's-own-split voice) exactly for
  this state, and the seeded kullanim world makes it a live visit, not a hypothetical.
- **R5 — row volume on the read.** One row per observed result (WO-0052 R4: tens, not
  thousands, per drive); the workspace month read is one unindexed scan + in-memory grouping
  at solo scale. No pagination, no SQL aggregation (TD-058's shape is the ruling).
- **R6 — seed drift.** The seed gains its first `recordTurnUsage` calls; existing worlds are
  untouched (the WO-0052 R6 rule: only NEW specs assert the new surfaces).
- **R7 — accepted residual risks (the architect's verdict, 2026-08-29, recorded verbatim):**
  (a) four-hook cadence — mid-drive rows invisible until a hook fires (spec 4 pins the hold
  honestly); (b) `hasUnledgered` counts $0.00-cost in-month sessions too (a count, not a money
  claim); (c) month read = unindexed scan at solo scale; (d) failed read renders the standing
  loadline (`refreshRoadmap` catch-shape); (e) head/breakdown two async reads — transient
  inter-refresh staleness, self-correcting.
