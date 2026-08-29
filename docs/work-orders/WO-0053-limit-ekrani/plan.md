# WO-0053 plan — the limit screen

Provenance: the acceptance basis is the approved mockup (`docs/ui-mockups/limit-ekrani.html`,
rev 1, `cf28681`, rulings locked with the operator 2026-08-29); every code anchor below was
re-verified against `main` on 2026-08-29 (`fc34905` order, `e43c7eb` pin). The order's two open
design slots are decided here: the port's clearing semantic (D4) and the window-label mapping
(D6). `mode: plan`: the architect reviews this file, the operator approves, then the S's code.
The architect's first round (2026-08-29) returned REVISE with 8 findings, all folded: the
terminal-record routing — the real limit death records at `turn_complete`, not the `finally`
(D5's table); the crossing predicate + the ticker widening (D6/R3); the result-arm trigger
corrected OFF `api_error_status` onto subtype + `terminal_reason`/`errors[0]` (D2); the
push→pull exact-key merge rule with the cached fallback (D2); the fold's status made optional
for pull events (D1); the stopped-row seed boundary (D1); the substring set — `rate_limit`
underscored, `overloaded` dropped (D2); the draft seat's resume path + both instrument gates
(D6).

## Design rulings

- **D1 — core vocabulary: `LimitWindow`/`LimitStop`, a live feed event, an error payload, a
  code.** `RunnerEvent` (`src/core/runner.ts:19-76`) gains the feed arm
  `{ kind: 'limit_windows'; windows: LimitWindow[]; status?: 'ok' | 'warning' | 'blocked'; at?: string }`
  — the `context_usage` shape (fold-state only, no transcript line) — and the error arm (:76)
  gains `limit?: LimitStop` beside `refusal?` (the payload-not-a-code precedent WO-0047 set).
  In `src/core/types.ts` (with `CostSummary`, where `session-store.ts` reaches without
  importing runner.ts): `interface LimitWindow { window: string; utilization: number | null;
  resetAt: string | null }` and `interface LimitStop { resetAt: string; window?: string }`.
  Window kind strings (`five_hour`, model-scoped labels) pass VERBATIM as data (ADR-0006's
  WO-0052 addendum — the model-id ruling); the status triple is the ADAPTER's neutralization
  of the provider's own words (`allowed|allowed_warning|rejected` → `ok|warning|blocked`) — a
  status the UI branches on is CODE vocabulary and never crosses as the provider's spelling.
  `ProviderErrorCode` (:88-92) gains `'rate_limited'` (TD-054's discriminator direction).
  `LiveSessionState` gains `limitWindows?: { windows: LimitWindow[]; status?: 'ok' | 'warning' | 'blocked' }`
  (latest-wins, the `context?` precedent :467 — absent never zero; `status` OPTIONAL — the pull
  channel reports windows with NO status triple, so a pull event folds the windows and leaves
  status untouched (carry-forward); only the push channel asserts status, and the warn line
  renders on `status === 'warning'` alone, never an invented 'ok') and `lastLimit?: LimitStop`
  beside `lastError`/`lastRefusal` (:490-493), CLEARED by `started` (:537-543).
  `seedLiveState` re-seeds `'error'` + `lastLimit` from a row carrying `limitResetAt` (the
  `'stopped'` re-seed rule, runner.ts:511-527) — with ONE boundary: a row whose status is
  `'stopped'` never re-seeds `lastLimit` (the operator's Durdur is the last real event; the
  stamp stays in the column for the ledger, the pane stays the stopped pane).
  `SessionRef` (:112-130) gains `limitResetAt?: string`.
  _Why:_ the feed informs a RUNNING drive, the payload discriminates a DEAD one — two needs,
  two precedents (`context_usage` and `refusal`), one source: the adapter.

- **D2 — the adapter reads the two channels and classifies the two error paths.** Push:
  `translate` gains a `rate_limit_event` case (today `default: break;`,
  `src/adapters/runner/index.ts:433-434`) mapping `rate_limit_info` → the feed event —
  status neutralized, epoch `resetsAt` (a number — sdk.d.ts:4275) → ISO **HERE** (the order's
  reason to exist), `rateLimitType`/`utilization` carried verbatim; the overage/credits fields
  of `SDKRateLimitInfo` (sdk.d.ts:4280-4289) stay UNREAD (the order's stop-and-ask gate).
  Pull: `currentQuery.usage_EXPERIMENTAL_MAY_CHANGE_DO_NOT_RELY_ON_THIS_API_YET()` is read
  fire-and-forget at the `emitContext` cadence (:459-485 — ~30s throttle + turn boundaries),
  one rejection disabling the pull feed for the drive (the `contextFeedLive` rule);
  `rate_limits_available === false` reads as ABSENT (API-key/3P sessions have no windows —
  never zeros). `AnyMsg` (:101-128) widens structurally: the push message's fields, and the
  result-error arm's `errors[]` / `terminal_reason?` (sdk.d.ts:4291-4310, :6947 — values
  include `blocking_limit`, `rapid_refill_breaker`; the error arm carries NO
  `api_error_status` — that field lives on the SUCCESS arm, sdk.d.ts:4328, where reading it
  would misclassify a COMPLETED turn that merely retried an API error; it is never the
  trigger). Error paths: the result-error arm (:419-421) classifies on subtype
  `error_during_execution` AND (`terminal_reason` ∈ {`blocking_limit`, `rapid_refill_breaker`}
  OR `errors[0]` matching the limit substrings); `classifyProviderError` (:684-691) gains the
  limit arm with substrings `429`, `rate_limit` (UNDERSCORED — the SDK's own spelling is
  `rate_limit_error`, which `.includes('rate limit')` with a space misses) and `usage limit`;
  `overloaded` is deliberately ABSENT (529/overloaded is provider CAPACITY, not the user's
  window — the degradation title would lie). A classified limit stop attaches
  `code: 'rate_limited'` plus — when a stamp is known — `limit: { resetAt, window? }`:
  the last push rejection's `resetsAt` first; else the pull windows CACHED from the feed (no
  I/O on the error path), matched by EXACT type-string === pull key (the push's
  `seven_day_overage_included`/`overage` values have NO pull equivalent — unmatched or
  typeless stays stamp-less, the degradation tier, mockup frame 04). The e2e-mock and the
  unit mock (`index.test.ts:30-56`) gain a control stub beside `getContextUsage`. (AC3's
  parenthetical names `api_error_status` as a result-error source; it is satisfied by the
  `terminal_reason`/`errors[0]` trigger — the field lives on the SUCCESS arm, so the
  order's INTENT, "a limit-shaped result error classifies", is met without reading it; no
  order-text change.)
  _Why:_ classification at the boundary is the whole WO — after the adapter everything is
  neutral (stamp ISO, status triple, kind strings as data).

- **D3 — store: `session.limit_reset_at`, nullable, CLEARED by a clean leg.** The column is
  additive (`schema.ts:62-90` beside the ctx pair), PRAGMA-guarded ALTER (the `pending_notes`
  precedent), `SESSION_REBUILD_COPY` extended (`store/index.ts:415-443`); pre-WO-0053 rows
  stay NULL (honest absent). The write semantic DIFFERS from the ctx checkpoint on purpose:
  a stale stamp is a LIE (the card would show a button the provider will reject), while a
  stale ctx reading is the last observation — so the stamp is written at the terminal error
  close and CLEARED by a later clean leg; the ctx pair keeps its keep-prior rule untouched.
  _Why:_ the five-hour window can outlive the process — the card is worthless after a restart
  without persistence, and worthless after a clean leg WITH it.

- **D4 — port: the stamp rides `RecordSessionInput` with a THREE-state semantic.**
  `RecordSessionInput` (`src/core/session-store.ts:17-32`) gains
  `limitResetAt?: string | null`: undefined KEEPS the prior row's value (the `pendingNotes`
  keep-prior rule :27-29), `null` CLEARS (the clean leg), a string SETS (the error close).
  The set/drop idiom is `OrderMdEdit.taskRef`'s (order-md.ts:112-113 — string sets, null
  drops, silence is untouched); the ctx pair needed only two states because it never clears.
  No new store method — the stamp is a record-time fact with no append shape (unlike
  WO-0052's `recordTurnUsage`). Both fake stores (`pipeline.test.ts`, `cli.test.ts`) widen
  in the SAME commit (the discipline; the lock is runtime — the fakes sit behind
  `as unknown as SessionStore` casts).
  _Why:_ one field, three intents, no ambiguity: the pipeline always knows which of the three
  it means (`undefined` on ordinary records, the string on the error close, `null` on a clean
  leg that follows a stamped one).

- **D5 — pipeline: feeds forward, the terminal records stamp/clear, no new gate.** The
  `limit_windows` case forwards like `context_usage` (yield, no row write — the drive is
  alive; the feed is fold-state). The stamp's routing (architect REVISE finding 1, verified):
  a REAL limit death arrives as a RESULT message — the adapter pushes the `error` THEN the
  `turn_complete`, the pipeline's `turn_complete` case sets `terminated` and records
  (`pipeline.ts:399`), so the `finally`'s record (:464-478) is SKIPPED; the record that must
  carry the stamp is the `turn_complete` one. And the pipeline CANNOT derive "was stamped"
  from the fold (the fold starts from `initialSessionState`, :235, and `started` clears
  `lastLimit` — a resumed-then-clean drive's fold never holds the row stamp) — so the routing
  is a fixed table, not a derivation:

  | close | `limitResetAt` passed | meaning |
  |---|---|---|
  | `turn_complete` terminal (incl. the synthetic plan-exit) | `live.lastLimit?.resetAt ?? null` | the limit death stamps; a clean leg CLEARS a stale stamp |
  | catch/`finally` error close (a throw) | `live.lastLimit?.resetAt` | a limit throw stamps; a NON-limit throw KEEPS a prior stamp (not a clean leg) |
  | `interrupted` | `undefined` | keep — an abort is not a clean leg |
  | ordinary `record()`s | `undefined` | keep |

  A `null` clear on an unstamped row leaves NULL (the store reads the prior at
  `store/index.ts:373` before writing — no churn); `plan_ready` never appears here (it is
  not terminal, it records nothing, :335-356). The budget gate (:168-184) and the plan/flow
  gates are untouched. The both-fields case (refusal + limit — a post-limit resume attempt
  that hits the cap) needs NO pipeline ordering: both live in the fold; the UI branches (D6).
  _Why:_ zero new recording moments; the stamp is exactly as durable as the moment it names,
  and the primary real path (the result-message death) is the one that carries it.

- **D6 — UI: `LimitCard` (two seats), the absent-until-reset button, the warn line, the
  degradation title.** `LimitCard` (`src/ui/components/detail/`, the `BudgetRefusalCard`
  sibling: lamp-signal-breathe edge, readout title, body, right-aligned action row) renders
  in the decision stack at BOTH seats (WorkOrderDetail beside the refusal card :904-914;
  RoadmapScreen's draft seat :161-188) when `state.lastLimit` is set, the drive is not
  running, and the seeded state is not the operator's own stop (D1's seed boundary: a
  `'stopped'` row never re-seeds `lastLimit` — a stamped row that was later Durdur'd keeps
  its column but raises the STOPPED pane, not a LimitCard; the operator's stop is the last
  real event, architect finding 6). The action row is ONE thing, mockup karar 1: while the
  stamp is in the future a reason line `UI.limitWaitReason(time)` («sürdür 14:32'de açılır»);
  after, exactly ONE primary `Sürdür` (+ ⏎ via the primary wiring's retry branch, :629-634,
  gated by the SAME condition as the button — the badge never outlives the button) riding
  the fail-card `retry` channel (:499-515 — finds the row's `providerSessionId`, re-drives
  with `resume:`; `drive-store.restart` is REJECTED for this: it re-issues the original
  input, a fresh session — wrong for a stopped live leg). The DRAFT seat's Sürdür rides the
  `reply()` idiom (RoadmapScreen.tsx:135-150 — `driveStore.start` with the draft input +
  `resume: draftState.sessionId`, `prompt: ''`; `restart` STAYS AS-IS — nobody "improves"
  it with a resume argument; the button calls `start` directly, the reply twin of the WO
  seat's retry). THE CROSSING (architect finding 2): the WO ticker is gated
  `if (!running) return` (:347-352) and the card renders exactly while dead with the
  instrument suppressed — nothing would re-render at the crossing. The ticker's condition
  widens to `running || limitCardPending`; the crossing itself is a PURE predicate
  (`limitCrossing(stamp, now) → 'wait' | 'ready'`, core, unit-tested both directions) so the
  card and the e2e (static past/future seeds) share one truth. The fail card's render
  condition gains `&& !state.lastLimit`; the instrument gate suppresses the pane while the
  card holds at BOTH sites (WorkOrderDetail.tsx:1200-1201 AND RoadmapScreen.tsx:188's
  `paneExists` — karar 5, the Oturum/TASLAK card's döküm is the transcript's home). The warn
  line: a `PaneWarnline` row under the pane header row
  (pane-chrome, the `PaneCostline` voice :96-121 — mono 10.5, the utilization figure in
  signal, NO fill bar) rendered only when `limitWindows.status === 'warning'` (the
  provider's OWN signal, karar 3) with `UI.limitWarnLine(window, pct, time)`; `blocked`
  never renders here (the drive dies and the card takes over). Labels (BOTH bundles, key
  parity): a `limit*` family — `limitCardTitle` («KULLANIM LİMİTİ DOLDU»), `limitCardBody(window,
  time)`, `limitResumeNote` (the S4 honesty line «Sürdür kaldığı yerden devam eder; bağlam
  yeniden okunur.»), `limitWaitReason(time)`, `limitWarnLine(...)`, `limitWindowLabel(kind)`
  (`five_hour` → «5 saatlik pencere», `seven_day` → «7 günlük pencere», unknown → «pencere» —
  raw kind strings never reach JSX, ADR-0007; the `woIdLabel` seam); `PROVIDER_ERROR_LABELS`
  gains the `rate_limited` sentence (the degradation tier's localized title — copy per mockup
  frame 04: «Sağlayıcı kullanım limiti doldu — sıfırlanma saati bilinmiyor.»). `Sürdür`
  reuses `UI.driveResume`'s word (karar: no second word for one action). Times through the
  bundle clock formatters (the `auditClock` family — day-aware for a seven-day window).
  _Why:_ every surface speaks an existing grammar — the card the refusal card's, the line the
  costline's; the one new interaction (absent-until-reset) is the ADR-0001 idiom itself.

- **D7 — CLI: the drive error line mirrors the refusal line.** `formatEvent`'s error arm
  (`src/cli/drive.ts:90-96` — the WO-0047 refusal mirror) names the stamp and the resume
  path when `limit` rides: `[limit] rate limited — window resets 14:32; sürdür via resume`
  shape, pure formatter, test-pinned. No `show` change (the app + E2E restart spec are this
  WO's instruments; `show`'s floor is WO-0052's).
  _Why:_ the CLI driver deserves the same classified sentence the GUI card carries.

- **D8 — E2E: five spec families, no clock seam.** The scripted e2e-runner
  (`electron/e2e-runner.ts`, driven through `window.docket.e2e.emit`, `e2e/ui.mjs`) gains
  the `limit_windows` feed and an error-with-`limit` script. Specs: (1) the card renders on
  a limit error, fail card stands down, instrument suppressed; (2) future stamp → button
  ABSENT + the reason line; past stamp (seeded) → button present; (3) the restart
  re-derivation — seeded `limit_reset_at` row → reload → the card back, button per the
  stamp; (4) the warn line on a scripted feed event, absent without one; (5) the budget
  card's independence (a refusal still renders its card; a limit does not borrow its copy).
  Stamps are seeded past/future — the suite never waits on wall-clock time.
  _Why:_ the crossing (absent → present) is the WO's one interaction and must be pinned both
  directions without a clock seam.

## The S5 field→consumer map (the tour, quoted verbatim — WO-0052's note, inherited)

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

Scope note: this WO covers row 6 — the push stream message, the pull control, and the
result's `api_error_status`/`terminal_reason` (the row's "429 counters" read through every
channel the SDK offers). Rows 1-5 and 8 belong to the usage screen (queue 4, on WO-0052's
floor); row 7's honesty limit stands as recorded (WO-0026/TD-030 lineage).

## Steps

Order: core → port → store/schema → adapter → pipeline → UI → CLI+E2E → docs-close.
`src/core/` is test-first (ADR-0006); RED before GREEN at every step.

- **S1 (core):** `LimitWindow`/`LimitStop` in `src/core/types.ts`; the `limit_windows` arm +
  `limit?` on the error arm in `RunnerEvent`; `ProviderErrorCode` gains `'rate_limited'`;
  `LiveSessionState.limitWindows?` + `lastLimit?` + the fold cases (`limit_windows` folds
  latest-wins and refreshes `lastLifeAt` — the `context_usage` precedent, NEVER `cost`);
  the error fold stores `lastLimit` beside `lastError`; `started` clears BOTH `lastRefusal`
  and `lastLimit`; `seedLiveState` re-seeds `'error'` + `lastLimit` from a row carrying
  `limitResetAt` (the `'stopped'` re-seed rule, runner.ts:511-527) EXCEPT on a `'stopped'`
  row (D1's boundary). Tests (fold): a windows-bearing feed → `limitWindows` verbatim,
  `cost` byte-identical; a warning-status feed; a pull-shaped feed (windows, NO status) →
  windows folded, status carry-forward/absent; an error-with-`limit` → `lastLimit` set,
  `lastErrorCode: 'rate_limited'`; error-without-`limit` → `lastLimit` untouched;
  `started` clears; the seed path (a stamped row → error + lastLimit; an unstamped row →
  today's behavior; a `'stopped'` + stamped row → the stopped seed, NO lastLimit).
  Gate: typecheck + `npm test`.
- **S2 (port + fakes, one locking commit):** `RecordSessionInput.limitResetAt?: string | null`;
  both fake stores accept and apply the three-state semantic. No behavior test of its own —
  the fakes are exercised by S5/S6. Gate: typecheck (both tsconfigs).
- **S3 (store + schema):** the column + PRAGMA ALTER + `SESSION_REBUILD_COPY`;
  `recordSessionRow` applies set/clear/keep; `SessionRow` widens; `hydrateSessionRow` maps
  NULL → absent into `SessionRef.limitResetAt`. Tests: round-trip set/clear/keep (three
  directions); migration vintage fixture (a pre-WO-0053 DB → column exists as NULL, rebuild
  copy runs); the WO-0047 block (`store.test.ts:1098-1206`) and the accumulation pin
  (:630-642) pass UNTOUCHED. Gate: typecheck + `npm test`.
- **S4 (adapter):** `AnyMsg` widened; the `rate_limit_event` translate case (neutralization +
  epoch→ISO); the pull read at the `emitContext` cadence with the one-rejection kill; the
  result-error arm classifies on subtype + `terminal_reason`/`errors[0]` (D2 —
  `api_error_status` is NEVER the trigger); `classifyProviderError` gains the limit arm
  (`429` / `rate_limit` / `usage limit`); the stamp assembly (push rejection's `resetsAt` →
  cached-window exact-key match → stamp-less). Tests: extend `index.test.ts` through the
  EXISTING vi.mock harness (:30-56 — the mock's query return gains the control stub beside
  `getContextUsage`): a scripted push message → one `limit_windows` event with ISO stamp +
  neutral status; a pull response (windows, no status) → feed event, windows verbatim; a
  result `error_during_execution` with `terminal_reason: 'blocking_limit'` → error carrying
  the code + the cached stamp; a thrown `API Error (429): rate_limit_error` → code; a
  SUCCESS result carrying `api_error_status: 429` → NO classification (the completed-turn
  guard); stamp-less classification → code-only; pull rejected once → no further calls for
  the drive; `rate_limits_available: false` → no feed event. Gate: typecheck + `npm test` +
  `check:boundaries` (the adapter stays the only vendor-naming file).
- **S5 (pipeline):** the `limit_windows` forwarding case; D5's routing table on the two
  terminal paths + ordinary records. Tests (`pipeline.test.ts`): a limit result-death
  script (error then `turn_complete`) → the `turn_complete` record carries the stamp (the
  `finally` record skipped, `terminated`); a clean `turn_complete` script → `null` passed
  (clear; an unstamped fake row stays NULL — the store's prior read); a throw script with
  a limit → the `finally` record carries the stamp; a throw script WITHOUT a limit on a
  stamped fake row → `undefined` (keep); `interrupted` → keep; feed events → yielded, ZERO
  store calls; the budget gate script still refuses identically (the block untouched); the
  draft arm stamps under the draft owner. Gate: `npm test`.
- **S6 (UI + labels):** `LimitCard` + the two seats; the fail-card condition; the instrument
  gates (both sites); the ticker widening + `limitCrossing`; `PaneWarnline` + the fold
  read; the `limit*` label family + `limitWindowLabel` + `PROVIDER_ERROR_LABELS.rate_limited`
  in BOTH bundles; the ⏎ wiring (button-gated); clock-formatted times. Tests: the predicate
  both directions (unit); component-level where the repo tests components (labels
  key-parity auto); the crossing pinned with a `now` prop (past/future) — no wall-clock
  wait. Gate: typecheck + `npm test` + `npm run build`.
- **S7 (CLI + E2E):** the `formatEvent` arm + its pin (D7); the e2e-runner script arms; the
  five spec families (D8). Gate: typecheck + `npm test` + `npm run test:ui`.
- **S8 (docs-close, after the operator checkpoint + review + merge):** the ADR-0013 addendum
  (the order's drafted sentence, dated), the ROADMAP M7 tick, the TD note (TD-016 gains the
  two channels on its pinned-surface list — the re-measure trigger), closure sha. Gate: the
  full ladder + the merge.

## ADR / CLAUDE.md / TD sketches

- **ADR-0013 addendum (WO-0053):** the order's Notes sentence, dated at merge — a
  decision-stack card that TERMINATES a drive may carry its own one-button resume (the fail
  card's retry precedent, extended to the limit stop); the card owns the moment, states the
  reset time as the absent button's standing reason (ADR-0001), its «Sürdür» rides the same
  row-resume channel; DriveControls stays the LIVE drive's process home.
- **ADR-0006: NO addendum** — the WO-0006/WO-0052 data-vs-code split already covers window
  kind strings; stated in the closure commit, not a new document.
- **CLAUDE.md: no change** — the Records paragraph's metrics sentence (WO-0052) already
  covers the ISO stamp and utilization (metrics, never env values).
- **TD:** TD-016's entry gains the two channel names (push message + the experimental
  control) on its pinned-surface list — the next SDK bump's re-measure has an explicit
  trigger. No new TD.

## Verification ladder + checkpoint

1. `npm run typecheck` (both tsconfigs) 2. `npm test` 3. `npm run check:boundaries`
4. `npm run build` 5. `npm run test:ui` — per step as its gate lists; the full set on the
PR (AC8). Watched, never touched: the budget block (`store.test.ts:1098-1206`), the
pipeline budget gate (`pipeline.ts:168-184`), the CLI refusal line (`src/cli/drive.ts:90-96`).

Operator checkpoint round 2 (the order's evidence gate): the realized app against the
approved frames — a `--fake` drive with a limit script (future stamp: the reason line;
past stamp: the button; press: the resumed leg), the warn line live, and the restart
re-derivation (reload with a seeded row). Screenshots verified against the mockup; a
deferral is the operator's and lands in order.md if used.

## Risks

- **R1 — the push channel's `utilization` scale.** The PULL channel documents 0-100
  (sdk.d.ts:3231-3234); the push `SDKRateLimitInfo.utilization` (sdk.d.ts:4278) carries no
  doc comment. The adapter passes it verbatim and the label renders `%${Math.round(u)}` —
  IF a real drive shows a fraction, the fix is adapter-local (normalize ×100 at the
  boundary) with a pin update; the E2E/unit scripts pin integers, so a live mis-scale
  surfaces at the operator checkpoint, not in CI.
- **R2 — the experimental control's shape may drift under us** (TD-016; the name itself
  says so). `AnyMsg` and the adapter's read stay structural-optional; a bump breaks the
  adapter first (compile) — the re-measure is TD-016's discipline, now with both channels
  on its list.
- **R3 — the clock crossing.** The absent→present moment is the WO's one interaction, and
  it lives exactly where no re-render existed: the ticker is `running`-gated
  (WorkOrderDetail.tsx:347-352) while the card renders dead (architect finding 2). The fix
  is D6's: the ticker widens (`running || limitCardPending`) and the crossing is a PURE
  predicate (`limitCrossing`, unit-tested both directions) the card and the e2e share — the
  e2e seeds past/future stamps, never waiting on wall-clock. The card never polls the
  provider (the stamp is the promise; a stale-but-uncrossed stamp stays honest — the button
  is absent until the LOCAL clock says otherwise).
- **R4 — the resume re-hits the limit.** A Sürdür pressed after the stamp but before the
  provider's own window refresh dies AGAIN with `rate_limited` — the honest outcome: the
  new error re-stamps (a new `lastLimit`), the card returns with the new clock. The note
  carry (`pendingNotesFor`) rides the existing resume path untouched.
- **R5 — fold-both-set (refusal + limit).** A post-limit Sürdür that meets the budget cap:
  the refusal card outranks (the fresher intent — the existing `!lastRefusal` guard's
  branch extended); the limit state stays in the fold and its card returns after the
  refusal resolves. Pinned in S6.
- **R6 — old e2e scripts.** Existing scripts carry no limit fields → absent everywhere →
  byte-identical output; only NEW specs assert the new surfaces.
