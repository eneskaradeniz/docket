---
id: WO-0053
title: "Limit screen — the provider's usage limit becomes a first-class stop (adapter classification · neutral reset stamp · live windows readout · one-button Sürdür)"
workspace: docket
status: draft
mode: plan
review: light
review_mode: gates
tracks:
  - repo: app
    depends_on: []
---

# WO-0053 — Limit screen — the provider's usage limit becomes a first-class stop (adapter classification · neutral reset stamp · live windows readout · one-button Sürdür)

## Objective

Today a usage-limit stop is indistinguishable from a crash: the adapter DROPS the provider's
rate-limit stream message (`translate`'s `default: break;`), never calls the session's usage
control, and reads neither the result's API status nor its terminal reason — so a 429-class death
folds as a generic error, records as an ordinary 'idle' row, and surfaces as the raw-English fail
card. This WO moves the CLASSIFICATION into the adapter (the vendor vocabulary never leaves it,
ADR-0006), producing a vendor-neutral `limitResetAt` ISO stamp; a limit-hit drive ends in a
decision-stack card that states when the limit opens and carries ONE «Sürdür» that resumes the
drive from the persisted session row once the moment has passed; the stamp checkpoints onto the
row so the moment survives an app restart (a five-hour window can outlive the process). The
budget gate (WO-0047) stays separate; resume mechanics are untouched; the usage screen is queue 4.

## Context

- **Acceptance basis: mockup frames 01–04** (`docs/ui-mockups/limit-ekrani.html`, rev 1,
  approved 2026-08-29, commit `cf28681` — the WO-0051 flow; the tour preceded implementation).
  Frame 01: the limit card in its two states (the stop — reset line, NO button; the open moment —
  «Sürdür» + ⏎). Frame 02: the live warning line on the pane header. Frame 03: the restart
  re-derivation (the card re-seeded from the row's checkpoint). Frame 04: old→new (today's
  raw-English 429 fail card — the stamp-less degradation tier). The tour's S5 table row —
  "rate-limit windows / 429
  counters | `usage_EXPERIMENTAL` session controls | never called | **limit screen (queue item
  3)**" — is this WO's grounding; quote it in `plan.md` (WO-0052's note, inherited).
- **Code anchors (verified against the tree):** the push message `rate_limit_event` carries
  `rate_limit_info: { status: 'allowed'|'allowed_warning'|'rejected'; resetsAt?; rateLimitType?;
  utilization? }` (sdk.d.ts:4259-4289) and dies in `default: break;`
  (`src/adapters/runner/index.ts:433-434`); the pull control
  `usage_EXPERIMENTAL_MAY_CHANGE_DO_NOT_RELY_ON_THIS_API_YET()` (sdk.d.ts:2444) returns
  `rate_limits_available` + per-window `{utilization: number|null; resets_at: string|null}`
  (sdk.d.ts:3208-3295) and is called NOWHERE in `src/`; result messages carry
  `api_error_status?` and `terminal_reason?` (values include `blocking_limit`,
  `rapid_refill_breaker`, `api_error` — sdk.d.ts:4293-4310, :6947), both unread — the adapter's
  result-error arm pushes only `msg.errors?.[0] ?? msg.subtype` with NO code (index.ts:419-421).
  `classifyProviderError` (index.ts:684-691) is a closed 4-value union with no limit arm,
  applied only in the drive-loop catch (index.ts:543-551).
- **The stop's shape today:** a mid-run throw folds `{kind:'error'}` → LiveSessionStatus 'error'
  + lastError/lastErrorCode/lastRefusal (`src/core/runner.ts:654-663`) → the pipeline's finally
  records the row 'idle' (`src/core/pipeline.ts:471-474`; the schema CHECK has no error status —
  `src/adapters/store/schema.ts:74`), cost keep-prior, the step stays 'active' — the row is
  resumable TODAY. `deriveTurnState` maps 'error' → the retry turn → the fail card with its
  one-button `retry` (WorkOrderDetail.tsx:844-883, :499-515).
- **Precedents:** the structured-interruption pattern — WO-0047's `refusal` payload on the error
  arm, folded to `lastRefusal`, branched on by the detail view, cleared by `started`
  (runner.ts:76-82, :541); the live-readout pattern — WO-0046's `emitContext` fire-and-forget
  feed, throttled ~30s, one rejection sets `contextFeedLive = false`, absent never zero
  (index.ts:458-485); the WO-0052 checkpoints — `ctx_used_tokens`/`ctx_max_tokens` ride every
  `record()` (pipeline.ts:289-293), PRAGMA-guarded, `SESSION_REBUILD_COPY` extended
  (`src/adapters/store/index.ts:415-443, :573-575`); the fail card's one-button retry IS the
  error card's home (ADR-0013's own comment, WorkOrderDetail.tsx:860-861).
- **Vendor neutrality (ADR-0006 + its WO-0052 addendum):** the ban is a CODE ban — window kind
  strings (`five_hour`, model-scoped labels) pass through as metric DATA exactly like model ids;
  the SDK method name appears only in Adapter-layer bullets and docs' factual references. The
  stamp is normalized at the boundary: the push channel's epoch `resetsAt` becomes an ISO string
  IN THE ADAPTER — that conversion is this WO's reason to exist.
- **Mockup rulings (locked with the operator 2026-08-29, rev 1 `cf28681`; REVISED at round 2,
  same day — the realized-app tour).** (1) The card speaks PROVIDER windows — no $ figures, no
  cap copy; the budget card owns those, and the two cards never compete (a budget refusal is
  pre-spawn, a limit stop is post-flight; the refusal still outranks in the stack — the fresher
  intent, the fail card's existing `!lastRefusal` guard extended one branch). (2) **Round-2
  revision («kartta sürdür butonu olmasın — 2 tane buton oluyor»):** the card is INFORMATIVE
  and renders only while the stamp is FUTURE — NO action row. The ONE «Sürdür» stays in its
  normal home (the lone plan button / the step spine's controls), rendered LOCKED while the
  limit holds (the kit's attribute-free lock — ADR-0001's guarded-action register; the card
  right above carries the reason, so no tooltip), ⏎ held off; the clock crossing unmounts the
  card and unlocks the button («kart gider, Sürdür düğmesi gelir»). The board card carries the
  standing line too — `limit_stopped` in `deriveCardReason`: «Kullanım limiti doldu —
  sıfırlanma <saat>», clock-free (a later clean leg clears the stamp and the reason reverts).
  (3) The warning line renders only on the provider's OWN warning/blocked signal — never a
  locally invented threshold (the WO-0046 honest-absent lineage). (4) A limit stop with no known
  stamp degrades to the fail card with a localized title — never a fabricated time. (5) While
  the card holds it owns the moment: no instrument renders (the refusal-card rule; the Oturum
  card's döküm remains the transcript's home).

## Scope

In scope:

- Core (test-first, ADR-0006): `RunnerEvent` gains the live feed event `{kind: 'limit_windows';
  windows: LimitWindow[]; status?: 'ok'|'warning'|'blocked'; at?}` (the `context_usage` shape —
  no transcript line, fold-state only) and the error arm gains `limit?: LimitStop` (the
  `refusal` precedent — a payload, not a code). `LimitWindow {window: string; utilization:
  number|null; resetAt: string|null}` — window kinds pass VERBATIM as data (the model-id
  ruling); the status triple is the adapter's neutralization of the provider's own words.
  `LimitStop {resetAt: string; window?: string}`. `ProviderErrorCode` gains `'rate_limited'`
  (TD-054's discriminator direction). The fold stores the feed latest-wins (`limitWindows`, the
  `context` precedent — absent never zero) and `lastLimit` beside `lastError`/`lastRefusal`,
  cleared by `started`; `seedLiveState` re-seeds 'error' + `lastLimit` from a row carrying the
  checkpoint (the 'stopped' re-seed, runner.ts:521). `SessionRef` gains `limitResetAt?`.
- Adapter: `translate` handles the push stream message (the `AnyMsg` structural view gains its
  fields) → the feed event (status mapped; epoch `resetsAt` → ISO HERE); the session's usage
  control is read fire-and-forget at the `emitContext` cadence (~30s + turn boundaries), one
  rejection disabling the pull feed for the drive (the `contextFeedLive` rule);
  `rate_limits_available === false` reads as absent (API-key/3P sessions have no windows —
  honest-absent, never zeros). The result-error arm reads `api_error_status`/`terminal_reason`;
  `classifyProviderError` gains the 429/rate-limit/overloaded arm; a classified limit stop
  attaches `code: 'rate_limited'` plus — when a stamp is known (the push rejection's
  `resetsAt`, else the relevant window's `resets_at`) — `limit: {resetAt, window?}`. NO other
  SDK surface: the overage/credits fields stay unread.
- Store + schema: `session.limit_reset_at TEXT` nullable (additive, PRAGMA-guarded,
  `SESSION_REBUILD_COPY` extended — the ctx-pair pattern). Written at the terminal error close;
  a later CLEAN leg clears it (a stale stamp is a lie; the ctx reading is an observation —
  different rules, stated here). Pre-WO-0053 rows stay NULL.
- Pipeline: `record()` carries the stamp from the fold's `lastLimit` at the error close; the
  feed events forward like `context_usage` (yield, no row write); NO new gate, no budget touch.
- UI: `LimitCard` — the `BudgetRefusalCard` sibling in the decision stack, two seats (the WO
  detail + the roadmap screen, the refusal card's inventory); the fail card's condition gains
  `&& !state.lastLimit`; ⏎ = the card's «Sürdür» once present (the primary wiring's retry
  branch extends, WorkOrderDetail.tsx:629-631); the pane header's warning line (pane-chrome's
  mono-dim voice, the `PaneCostline` sibling — ADR-0012: text, never a fill bar); label
  families in BOTH bundles; times through the bundle clock formatters (the `auditClock` family,
  day-aware for a seven-day window).
- CLI: `formatEvent`'s error arm names the stamp and the resume path when `limit` rides (the
  WO-0047 refusal line's mirror, src/cli/drive.ts:90-96) — pure, test-pinned. No `show` change.
- E2E: the scripted e2e-runner drives an error-with-payload; specs for the card + absent button
  with its reason line, the button's appearance once the seeded stamp is in the past (no clock
  seam — seed past/future rows), the restart re-derivation after reload, the warning line on a
  scripted feed event, and the budget card's independence.
- Docs: ADR-0013 dated addendum (draft sentence in Notes); the mockup HTML; ROADMAP M7 tick at
  closure; TD notes at closure (TD-016's re-measure belongs to the next SDK bump, not now).

Out of scope:

- The budget gate, its math, thresholds or copy (WO-0047's line — the cap is that card's word;
  the provider window is this one's).
- The usage screen (queue 4 — its own WO; nothing here persists window HISTORY, only the stamp).
- Window-history persistence or curves (WO-0052's fill-history ruling: floor-only; the screen
  inherits live state).
- Auto-resume at the reset moment, or any timer that ACTS (the `STALE_AFTER_MIN` stance — the
  line informs, the operator clicks).
- The overage/credits sub-surface (`overageStatus`, purchase fields — unread; a future WO).
- Resume-mechanics changes (Sürdür rides the existing row channel untouched — the token tour's
  S4 cost model stands: one new user message + server-side full-context replay).
- Provider metadata beyond metrics (`subscription_type`, account facts — the Records rule; the
  stamp and utilization are metrics, account facts are not).
- A local warning threshold (the provider's own signal or nothing).

## Acceptance criteria

1. **Frame 01 — the stop:** a drive that dies on the provider limit folds an error carrying
   `code: 'rate_limited'` and the neutral stamp, and the decision stack renders the LIMIT card
   (the fail card stands down, no instrument renders), naming the window and its reset time;
   while the reset moment has not arrived the «Sürdür» button is ABSENT with the reset time as
   the standing reason line (ADR-0001).
2. **Frame 01 — the resume:** once the reset moment has passed the card carries exactly ONE
   primary «Sürdür» (+ ⏎); pressing it re-drives the same leg from the persisted row's
   `providerSessionId` (the `retry` channel), and the resumed drive's `started` clears the
   fold's limit state so the card stands down.
3. **Classification:** a thrown 429-shaped message, a limit-shaped result error
   (`api_error_status`/`terminal_reason`) and a push rejection all classify to 'rate_limited';
   with no known stamp the surface degrades to the fail card with a localized rate-limit title
   — no fabricated time; both directions test-pinned.
4. **Frame 02 — the warning line:** while a drive runs, the pane header renders the warning
   line ONLY on the provider's own warning/blocked signal (mono-dim, the costline's voice) with
   the utilization figure when present; no signal, or an unavailable windows surface, renders
   NOTHING — and one rejected pull disables the pull feed for that drive.
5. **Frame 03 — persistence:** the stamp checkpoints onto the session row at the error close
   (nullable, honest-absent, additive PRAGMA-guarded migration); after an app restart the card
   re-derives from the row, button present iff the moment has passed; a later clean leg clears
   the stamp.
6. **Neutrality:** no vendor name or SDK symbol in any core/ui type, branch or copy — window
   kind strings and the stamp cross as data (the model-id ruling); `check:boundaries` green.
7. **CLI + labels:** the drive error line names the stamp and the resume path when the payload
   rides (pure formatter, test-pinned); every new string lives in both label bundles with key
   parity; times render through the bundle clock formatters.
8. The full ladder green on the PR: typecheck (both), `npm test`, `check:boundaries`, build,
   E2E suite.

## Evidence required

- operator_checkpoint: TWO rounds (the WO-0051 flow). Round 1 RESOLVED 2026-08-29 — the mockup
  tour (frames 01–04, rev 1 `cf28681`) approved; the rulings above are locked. Round 2 = the
  realized app re-presented against the approved frames.
- plan_approval: architect verdict, `plan.md` committed (mode: plan — the open design slots:
  the card/warn-line copy values and the pull-feed cadence details are decided there).
- pr_open: PR URL, head sha.
- ci: green on the PR (the full ladder).
- verification: verifier report, all `path:line` pointers resolve at head sha.
- closure: all tracks merged, `ROADMAP.md` + `docs/tech-debt.md` updated (commit sha).

## Stop-and-ask gates

- Any budget figure, cap copy, or gate-semantics change on the limit surfaces (WO-0047's line).
- A fabricated reset time or utilization anywhere (absent means absent — WO-0052's floor rule).
- A `disabled`/`aria-disabled` attribute in `src/ui/` (ADR-0001 — reason lines are the vocabulary).
- A vendor name or SDK symbol in core/ui code or copy (ADR-0006; kind strings as data are the
  sanctioned exception).
- Any new SDK surface beyond the two named channels, or persisting anything beyond the stamp
  metric (the Records rule: no account/subscription facts).
- Any change to resume mechanics or the DriveControls contract (the ADR-0013 addendum is a
  card-surface ruling, not a process-control move).
- A locally invented warning threshold (the provider's signal or nothing).

## Notes

- **ADR-0013 addendum (draft, dated at merge):** "Addendum (2026-08-__, WO-0053 — the terminal
  card carries its own resume): a decision-stack card that TERMINATES a drive may carry its own
  one-button resume — the fail card's retry precedent, extended to the limit stop: the card
  owns the moment (no instrument renders), states the reset time as the absent button's
  standing reason (ADR-0001), and its «Sürdür» rides the SAME row-resume channel the stopped
  pane's does. DriveControls remains the LIVE drive's process home."
- ADR-0006 needs NO change: the vendor vocabulary stays inside the adapter; the WO-0052
  addendum's data-vs-code split already covers window kind strings. State that in the closure
  commit, not a new addendum.
- The card copy proposals (title, reset sentence, reason line, warning line) live in the
  mockup; the bundle keys land in both `tr`/`en` with the clock formatters doing the time
  rendering. «Sürdür» reuses `UI.driveResume` — no second word for one action.
- Both channels are version-pinned shapes (TD-016): the adapter's structural reads break first
  on an SDK bump — re-measure then; the experimental control's name changing is EXPECTED by its
  own contract and is an adapter-local edit.
- Sequencing (operator, 2026-08-28): floor (WO-0052, closed) → THIS → the usage screen (queue
  4). The screen inherits the live windows state and the floor's rows; nothing here blocks on it.
