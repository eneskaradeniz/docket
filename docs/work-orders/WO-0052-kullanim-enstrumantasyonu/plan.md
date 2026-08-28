# WO-0052 plan — the usage instrumentation floor

Provenance: the acceptance basis is the token tour (`docs/research/2026-08-28-token-usage-tour.md`);
every code anchor below was re-verified against the working tree on the `wo-0052-kullanim-enstrumantasyonu`
branch (2026-08-28). One operator decision shaped this plan before it was written: the WO runs
BEFORE the limit screen (queue 3) and the usage screen (queue 4) — both sit on this floor. The
ONE open design slot the order reserved for the plan round (the fill-history shape) is decided
at D7. `mode: plan`: the architect reviews this file, the operator approves, then the S's code.

## Design rulings

- **D1 — core vocabulary: `TurnUsage`, optional and honest-absent.** `CostSummary`
  (`src/core/types.ts:258-262`) keeps its meaning untouched. A new sibling in the same file
  (types.ts is `CostSummary`'s home; `session-store.ts` needs it without importing runner.ts):
  `interface ModelUsageLine { model: string; tokensIn: number; tokensOut: number; usd: number }`
  and `interface TurnUsage { cacheRead?: number; cacheCreation?: number; numTurns?: number;
  durationMs?: number; durationApiMs?: number; modelUsage?: ModelUsageLine[] }`. It rides
  `turn_complete` as `usage?: TurnUsage` (`src/core/runner.ts:37`) and folds into
  `LiveSessionState` as `lastUsage?: TurnUsage` (absent until first reported — the
  `context?` precedent, `runner.ts:467`). Absent means NOT-REPORTED, never a fabricated 0:
  every field is optional, the store columns nullable, hydration maps NULL → absent.
  _Why:_ the tour's core finding is that Docket drops what the provider already reports;
  widening with optional fields records reality without claiming more. `numTurns` /
  `durationMs` / `durationApiMs` are LEG-CUMULATIVE-SO-FAR figures on intermediate results —
  they persist verbatim and Docket never sums them (the session's wall time already lives in
  `started_at`/`ended_at`); only `usd_delta` and the per-result token counts accumulate.

- **D2 — the adapter escape: a new `turn_usage` event, emitted BEFORE the hold.** Today every
  result builds a `turn_complete` (`index.ts:372-376`) whose cost runs through
  `applyResultCost` in the drive loop (`index.ts:452-455`); a steered drive's INTERMEDIATE
  results are then HELD (`index.ts:464` `if (noteByUuid.size > 0) continue`) and only the
  terminal event is queued, carrying the ACCUMULATED `driveCost` (`index.ts:467`). Per-turn
  economics never leave the adapter. Fix: a new `RunnerEvent` arm
  `{ kind: 'turn_usage'; delta: CostSummary; usage?: TurnUsage; at?: string }` pushed in the
  same branch AFTER the baseline update and BEFORE the hold check — so held intermediates
  escape too, each with its own `delta` (the `applyResultCost` difference under the
  per-leg-reset baseline, `index.ts:176-182`) and its own `usage`. The terminal
  `turn_complete` ALSO carries `usage: usageOf(msg)` (its own result's figures) for the fold.
  Rejected alternative — enriching held `turn_complete`s and releasing them separately:
  the pipeline keys `turn_complete` for terminal behavior (record 'idle', step report,
  verdict, `terminated`; `pipeline.ts:366-395`) and WO-0045/D3 pins "one drive, one terminal
  event" — intermediate turn_completes would double-record terminals. `cost` on `turn_usage`
  is named `delta` precisely because `cost` on `turn_complete` means ACCUMULATED — two
  events, never one shape silently meaning two things. The synthetic plan-exit
  (`PLAN_EXIT_WITHOUT_RESULT`, `index.ts:507-508`) and the `interrupted` close
  (`index.ts:513`) emit NO `turn_usage` — an abort precedes the result message; there is
  nothing observed, so no row (the honest no-claim, WO-0026/TD-030). `AnyMsg`
  (`index.ts:101-115`) widens structurally (optional mirrors of `sdk.d.ts:4291-4344`:
  `usage` gains `cache_read_input_tokens` / `cache_creation_input_tokens`, plus
  `num_turns` / `duration_ms` / `duration_api_ms` / `modelUsage` as `Record<string, …>` with
  the `ModelUsage` fields of `sdk.d.ts:1265-1282`); a NEW adapter helper `usageOf(m: AnyMsg):
  TurnUsage | undefined` builds the detail (undefined when the message carries none of the
  fields). NO new SDK control call — `getContextUsage` stays the only one;
  `usage_EXPERIMENTAL` is queue 3's.
  _Why:_ option (a) — a distinct event kind per observed result — is the only shape that
  gets steered-drive per-turn rows out without touching the terminal contract; the
  emit-before-hold placement is the entire fix.

- **D3 — store schema: `session_usage` + three nullable session columns.** New table
  (working name per the order): `session_usage (id INTEGER PRIMARY KEY AUTOINCREMENT,
  workspace_id TEXT NOT NULL, work_order_id TEXT, provider_session_id TEXT NOT NULL,
  at TEXT NOT NULL, tokens_in INTEGER NOT NULL, tokens_out INTEGER NOT NULL,
  usd_delta REAL NOT NULL, cache_read INTEGER, cache_creation INTEGER, num_turns INTEGER,
  duration_ms INTEGER, duration_api_ms INTEGER, model TEXT, model_usage TEXT)`. One row =
  one OBSERVED `turn_complete` (held intermediates included). `work_order_id` NULL for a
  draft session (the `ownerPair` resolution, `store/index.ts:322-326` — draft rows stay
  invisible to every WO hydrate like the session table's rule). `model` is set IFF the
  result's modelUsage has exactly ONE entry (the common case); 0 or ≥2 entries → NULL and
  the verbatim split lives in `model_usage` (JSON `ModelUsageLine[]`). Deviation from the
  order's column sketch (`model?` only): AC1 promises verbatim persistence of modelUsage at
  the per-turn row, and a single string cannot hold a multi-model result — hence both
  columns. The `session` table gains nullable `ctx_used_tokens INTEGER`,
  `ctx_max_tokens INTEGER` (the LATEST context reading) and `final_model_usage TEXT` (the
  last observed `TurnUsage` as JSON, latest-wins). SCHEMA_SQL carries all of it
  (`schema.ts:62-86` + the new CREATE TABLE); `createStore` execs SCHEMA_SQL then
  `migrate()` on every open (`store/index.ts:1176-1177`), so the new table appears on every
  vintage for free while the three columns need PRAGMA-guarded ALTERs (the `pending_notes`
  precedent, `store/index.ts:433`). `SESSION_REBUILD_COPY` (`store/index.ts:415-420`)
  extends with the three new columns — the ALTERs run before any rebuild, so
  `session_legacy` always has them (NULL for pre-WO-0052 rows: honest absent). The AGGREGATE
  columns' accumulation semantics are untouched — the `prior + input` add-rule
  (`store/index.ts:363-371`) and its pin (`store.test.ts:630-642`) stand verbatim.
  `monthSpendRow` (`store/index.ts:786-798`) is BYTE-IDENTICAL. `session_usage` is append-only
  (the `appendEvent` precedent, `store/index.ts:315-317`) and joins the OWNED half (not in
  `OBSERVED_TABLES`): provider-observed but NOT re-derivable — a reseed must never drop it.
  _Why:_ additive, no CHECK, no rebuild trigger — the cheapest migration that satisfies
  every AC; the owned-half call is an ADR-0010 classification the plan must make explicitly.

- **D4 — port: ONE new method; the checkpoints ride `RecordSessionInput`.** `SessionStore`
  (`src/core/session-store.ts:36-104`) gains
  `recordTurnUsage(owner: SessionOwner, providerSessionId: string, row: { at: string;
  delta: CostSummary; usage?: TurnUsage }): void`. `RecordSessionInput` (:17-32) gains
  `ctx?: { usedTokens: number; maxTokens: number }` and `finalUsage?: TurnUsage`, both
  undefined-KNOWS-NOTHING: undefined KEEPS the prior row's values (the `pendingNotes`
  keep-prior rule, :27-29), defined OVERWRITES (latest-wins). Ruling against a usage field
  on `recordSession` for the per-turn rows: the append is an INSERT-only mutation at
  `turn_usage` moments where NO session record happens; routing it through `recordSession`
  would force a full DELETE+INSERT session upsert per turn (transcript-monotonic churn) to
  carry one row. The context checkpoint, by contrast, IS a record-time fact ("updated at
  each `record()`", AC3) — it rides the input. Both fake stores
  (`pipeline.test.ts:109-144`, `cli.test.ts:33-62`) widen in the SAME commit that widens
  the port. The discipline is same-commit co-widening, but the ENFORCEMENT is not the
  compiler: both fakes are built through `as unknown as SessionStore` casts
  (`pipeline.test.ts:142`, `cli.test.ts:60`), so a widened port breaks neither at compile
  time — the lock is RUNTIME: S5's tests drive a `turn_usage` script through the fake, and
  a fake missing `recordTurnUsage` fails there with a TypeError.
  _Why:_ two mutation shapes (append vs upsert) deserve two methods; same-commit
  co-widening keeps the port honest, with the runtime tests — not a cast — as the guard.

- **D5 — pipeline: every observed turn appends; the reading checkpoints; interrupts stay honest.**
  New `turn_usage` case in the drive loop (`src/core/pipeline.ts`, beside the `turn_complete`
  case :366-395): `deps.store.recordTurnUsage(owner, providerSessionId, { at: ev.at ?? now,
  delta: ev.delta, usage: ev.usage })`, guarded by `providerSessionId` (the `record()`
  guard, :269). A local `lastUsage` closure variable updates at the same case;
  `record()` (:268-286) passes `ctx: live.context && { usedTokens, maxTokens }` (the fold's
  sticky reading, `runner.ts:618-627`) and `finalUsage: lastUsage` on EVERY record —
  keep-prior when undefined, so a leg that never observed leaves the prior leg's figures.
  Resume legs append to the SAME session (same `ownerPair` key) with no double-count: the
  leg-reset already makes each leg's deltas its own spend (`index.test.ts:26-35` pins the
  totals; the store test (`store.test.ts:630-642`) pins the appended rows). Interrupted drives (`pipeline.ts:354-364`):
  `usd` stays honest-absent (`ev.cost` undefined on a real abort), `ctx` still checkpoints
  (the reading was observed), no usage rows exist, `final_usage` only if turns were observed
  before the stop — all four honest. The synthetic plan-exit's carryable rule
  (:374-376) is untouched and produces no usage row.
  _Why:_ exactly one row per observed result (AC2) with zero new recording moments invented.

- **D6 — CLI `show` becomes the verification instrument.** `showCommand`
  (`src/cli/index.ts:446-464`) prints NO sessions today (only steps, :458-462). It gains a
  per-session section: identity (`role · status`), the cost line (present only when the row
  has cost), the ctx line (`ctx used/max` — only when present), the final-usage line (only
  when present), and a per-turn tail — one compact line per `session_usage` row
  (`at · in/out · usd · cache r/c when present · model when present`) — only when rows
  exist. Absent fields print NOTHING, never 0 (AC5). The tail exceeds the letter of AC5
  ("per-session fields") deliberately: the order's evidence gate (`operator_checkpoint`) is
  "the new fields inspected via `show`", and the per-turn rows ARE the floor's substance.
  The per-turn read is a CONCRETE store method (`usageRowsFor(workOrderId)`) used by the
  CLI only — the UI read port stays queue 4's decision. Deliberate blind spot: a DRAFT
  session's per-turn rows carry `work_order_id` NULL, so `usageRowsFor(workOrderId)` never
  shows them — this WO leaves them write-only (the rows persist; a draft-scoped read is
  queue 4's to add). Test: a `--fake` scripted drive
  (the JSON script yields `turn_usage` events verbatim — `fake-runner.ts` needs ZERO change,
  it already yields any `RunnerEvent`) against a REAL temp-DB store, then `show` asserts the
  lines; an absence script asserts the lines' ABSENCE. This is `showCommand`'s first test.
  _Why:_ the operator must see the floor without the screens that come later.

- **D7 — fill-history shape: the FLOOR, no tail (the order's one open slot).** This WO
  persists the latest reading only (`ctx_used_tokens`/`ctx_max_tokens`, overwritten at each
  record). The bounded tail of readings is NOT proposed: the floor contract (AC3) needs only
  the latest, and the tail's real design question — sampling cadence and retention, since
  `emitContext` fires per tool event (`index.ts:480`) — belongs to the usage screen WO that
  will draw the curve. The door stays open: the migration is additive, so a
  `session_ctx_reading` tail table can land later without touching anything here, and
  per-turn usage rows already give the screen a coarse curve from day one.
  _Why:_ inventing retention policy now would bake in a guess the screen WO is better
  placed to make; the order names the tail "a plan-round proposal, not a default" and this
  plan declines it for cause. **No open question for the operator — the floor suffices; the
  tail remains available additively.**

## The S5 field→consumer map (the tour, quoted verbatim)

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

Scope note for the queues: this WO covers rows 1, 2 (latest-reading floor), 4, 5 and 8.
Row 3 (the per-category split) is OUT — it rides `getContextUsage().categories`, a different
surface than the result message, and belongs with the screen that renders it. Rows 6 and 7
are explicitly out (queue 3; and the interrupted-spend gap is irreducible without the SDK
inventing a mid-turn carrier).

## Steps

Order: core → port → store/schema → adapter → pipeline → CLI → docs-close. `src/core/` is
test-first (ADR-0006); RED before GREEN at every step.

- **S1 (core):** `TurnUsage` + `ModelUsageLine` in `src/core/types.ts`;
  `turn_complete.usage?` and the `turn_usage` arm in `RunnerEvent` (`src/core/runner.ts`);
  `LiveSessionState.lastUsage?` + the fold cases (`turn_complete` folds `usage`;
  `turn_usage` folds `lastUsage` + the `lastLifeAt` anchor, NEVER `cost` — the pane costline
  belongs to the accumulated terminal event and the `context_usage` ride-along, and a
  `turn_usage` cost touch would double-count both). Tests (fold): usage-bearing
  `turn_complete` → `lastUsage` set verbatim; usage-less → `lastUsage` untouched, never an
  empty object; `turn_usage` → `lastUsage` + anchor moved, `cost` byte-identical;
  `interrupted`/`error` → no usage surface appears. Gate: typecheck + `npm test`.
- **S2 (port + fakes, one locking commit):** `RecordSessionInput.ctx?` / `.finalUsage?`;
  `SessionStore.recordTurnUsage`; the two fake stores extend (both implement the new method;
  both accept the new input fields). The co-widening is a DISCIPLINE, not a compile lock:
  both fakes sit behind `as unknown as SessionStore` casts, so only S5's runtime tests
  (which call `recordTurnUsage` through them) would catch a fake left behind — a TypeError,
  not a typecheck failure. No behavior test of its own — the fakes are exercised by S5/S6.
  Gate: typecheck (both tsconfigs — the fakes live on both sides).
- **S3 (store + schema):** `session_usage` in SCHEMA_SQL + the three `session` columns;
  PRAGMA-guarded ALTERs; `SESSION_REBUILD_COPY` extended; `recordSessionRow` writes
  ctx/finalUsage (keep-prior-or-overwrite; the aggregate branch untouched);
  `recordTurnUsage` INSERT via `ownerPair`; `SessionRow` widens; `hydrateSessionRow` maps
  NULL → absent; `SessionRef` gains `ctx?` / `finalUsage?` (`src/core/types.ts:112-130`);
  concrete `usageRowsFor(workOrderId)`. Tests: round-trip present AND absent both ways
  (AC1's two directions); per-turn append (count + field values + NULL cache on a
  usage-less result); resume legs → rows accumulate, deltas don't double-count; ctx/
  finalUsage keep-prior on an undefined-field record; migration vintage fixture (a
  pre-WO-0052 DB → columns exist as NULL, `session_usage` empty, the rebuild copy runs);
  the accumulation pin (`store.test.ts:630-642`) and the WO-0047 block (:1098-1206) pass
  UNTOUCHED. Gate: typecheck + `npm test`.
- **S4 (adapter):** `AnyMsg` widened; `usageOf`; the `result` case attaches `usage` to the
  `turn_complete`; the drive loop emits `turn_usage` (delta + usage) after the baseline
  update, BEFORE the hold check; the synthetic plan-exit and the interrupt close emit none.
  Tests: extend `src/adapters/runner/index.test.ts:13-48` — the c2/s2b leg-reset pins gain
  the new fields (cache/modelUsage riding each leg's delta, tokens still per-result); the
  loop emission (one `turn_usage` per result INCLUDING a held intermediate; none on the
  synthetic/interrupt paths) through the repo's first SDK mock — `vi.mock` the SDK module
  with a scripted message generator (system/init + results; `getContextUsage` stubbed) —
  if that harness fights the subprocess assumptions, the fallback is pinning `usageOf` +
  the extended pure pins and naming the loop order an e2e-verified fact (R1; stop and say
  so in the report rather than loosening a pin). Gate: typecheck + `npm test` +
  `check:boundaries` (the widened adapter stays the only vendor-naming file).
- **S5 (pipeline):** the `turn_usage` case; `lastUsage` closure; `record()` passes
  ctx/finalUsage. Tests (`pipeline.test.ts`): a script with N `turn_usage` events → N
  `recordTurnUsage` calls in order with the scripted deltas; `context_usage` then a
  `tool_result` → the next `recordSession` carries ctx; NO `context_usage` → no ctx field
  on ANY record (absent, not zeroed); terminal `turn_complete` record carries finalUsage;
  `interrupted` → cost absent, ctx present (when observed), no usage-row calls;
  the draft arm records usage rows under the draft owner. Gate: `npm test`.
- **S6 (CLI):** the `show` sessions section + per-turn tail (D6); `usageRowsFor` wiring;
  `--fake` script usage. Tests (`cli.test.ts`): real temp-DB store → `--fake` drive with
  usage-bearing script → `show` prints the ctx line, the final-usage line, the per-turn
  tail; an absence script → none of the three appear (grep the output for `0` where absence
  is asserted); the budget greens (`src/cli/drive.ts:90-96` region) untouched. Gate:
  typecheck + `npm test` + `npm run build`.
- **S7 (docs-close, after the operator checkpoint + review + merge):** the ADR addenda,
  the CLAUDE.md line, the TD note, ROADMAP, closure sha (sketches below). Gate: the full
  ladder (below) + the merge.

## ADR / CLAUDE.md / TD sketches

- **ADR-0010 addendum (WO-0052):** the usage floor — `session_usage` is an OWNED-half table
  (provider-observed, not re-derivable; a reseed never drops it), append-only, keyed by the
  owner pair; the `session` row's usage columns are nullable latest-wins checkpoints; NULL
  is the honest pre-WO-0052 vintage and reads as absent everywhere.
- **ADR-0006 addendum (WO-0052):** the vendor-name ban is a CODE ban — persisted usage
  metrics carry model-id strings as DATA, verbatim from the provider adapter; no vendor
  name becomes a constant, a branch, or a copy line outside `src/adapters/`.
- **CLAUDE.md, Records & PRs paragraph:** one sentence — persisted usage records are
  METRICS (token counts, durations, model-id strings); the existing no-env-values/no-keys
  line already bounds them, the sentence names the metric case so the next usage WO does
  not re-argue it.
- **TD:** one entry — "per-turn model splits live in `session_usage.model_usage` JSON; if
  the usage screen needs model-level queries, a normalized child table is the follow-up".
  The interrupted-spend gap (tour S5 row 7) stays a known honesty limit, not new debt —
  already recorded by WO-0026/TD-030's lineage; the closure notes it, it does not reopen it.

## Verification ladder + checkpoint

1. `npm run typecheck` (both tsconfigs) 2. `npm test` 3. `npm run check:boundaries`
4. `npm run build` 5. `npm run test:ui` — per step as its gate lists; the full set on the
PR (AC6). Budget greens watched, never touched: `src/core/__tests__/budget.test.ts`, the
store WO-0047 block (`store.test.ts:1098-1206`), the pipeline budget gate
(`pipeline.ts:173-184`), the CLI's budget refusal line (`src/cli/drive.ts:90-96`; the
roadmap-draft command's gate rides the same pipeline path — `cli/index.ts:299-301`).

Operator checkpoint (the order's evidence gate): `npm run cli -- drive <woId> --fake <script>`
with a usage-bearing script, then `npm run cli -- show <woId>` — the ctx line, the
final-usage line and the per-turn tail inspected; an absence script shown beside it.
(R1's condition applies: if the S4 mock fell back, this checkpoint runs on a REAL drive
instead — `--fake` never exercises the adapter, so it cannot witness D2's mechanism.)
Approval gates the rest; a deferral is the operator's and lands in order.md if used.

## Risks

- **R1 — the SDK-loop mock is the repo's first.** No `vi.mock` exists anywhere today; the
  adapter loop has never run under test. The scripted-generator harness is small (init +
  results, no tool calls) but if the SDK module's import side-effects fight, the fallback
  in S4 applies and the report says so explicitly. A fallback round has a COST beyond the
  missing pins: D2's central mechanism — the emit-before-hold placement and `usageOf`'s
  read of the real SDK shapes — would then merge with NO automated test and NO real
  observation. Therefore: if the fallback engages, the operator checkpoint runs against a
  REAL drive, not `--fake` — the floor's mechanism must be observed live at least once
  before close (ADR-0006: adapters are verified by running them). If the mock round
  succeeds, the `--fake` checkpoint below is sufficient.
- **R2 — pin drift on the accumulation rule.** The `prior + input` branch gains sibling
  fields, not edits; the c2/s2b pins extend with fields, never loosen thresholds. Any
  failing budget or accumulation test is a STOP (the order's first gate), not a fix.
- **R3 — version drift.** The SDK is pinned (`@anthropic-ai/claude-agent-sdk` 0.3.221);
  `AnyMsg` stays structural-optional, so a future SDK change compiles and the pins fail
  first (the TD-016 re-probe discipline).
- **R4 — row volume.** One `session_usage` row per observed result: a steered long drive
  adds tens of rows, not thousands (results, not tool events); `emitContext` cadence is
  untouched and never writes.
- **R5 — multi-model results.** `model` NULLs on ≥2-model turns with the split in JSON —
  the screen must read the JSON, not assume the shortcut column; noted in the TD sketch.
- **R6 — old e2e scripts.** Existing `--fake` scripts and worlds carry no usage fields →
  absent everywhere → byte-identical output; only NEW specs assert the new lines.
