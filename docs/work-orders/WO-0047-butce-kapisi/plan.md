# WO-0047 plan — budget gate: a workspace month-spend threshold, pipeline-enforced

Design by a plan agent that re-verified every claim against the working tree (gate spine at
`src/core/pipeline.ts:156-172`; Paperclip model `budgets.ts:66-76` warn/stop thresholds and the
two-button incident `keep_paused | raise_budget_and_resume`; honest cost basis
`session.cost_usd REAL NULL` at `src/adapters/store/schema.ts:76`). Operator rulings settled
before design (2026-08-26): **raise = a PERMANENT settings write** (no one-month override
machinery); **warn = a PERCENT of the cap** (Paperclip `warnPercent`, default 80). The session
plan was approved 2026-08-26; this file is its committed form (`mode: plan`).

AC2 reading (settled in the plan): "the same sentence in GUI and CLI" = the same FACTS (observed,
cap) and the same refusal — the GUI composes the localized sentence from the structured payload,
the CLI prints core's English message plus the resolution hint (the CLI is an English-speaking
host).

## Design rulings

- **D1 Port.** `SessionStore.budgetBlockFor(workOrderId): { observedUsd: number; capUsd: number }
  | undefined` — sync, the `planApprovedFor` shape; a payload ONLY when a threshold is configured
  AND status is `hard_stop`. UI reads stay separate: `WorkOrderSource.workspaceMonthSpend(
  workspaceId): Promise<{ usd: number; hasUnknown: boolean }>` and `AppSettings.getBudget/
  setBudget(workspaceId, …)`. All three adapter impls share ONE private `monthSpendRow(db, ws)`.
  Why: `DriveInput` carries no workspace id, so the store-side join is the only honest keying;
  `WorkOrderCardView` (per-WO derived) stays unpolluted.
- **D2 Refusal discriminator.** The error event member gains `refusal?: { observedUsd; capUsd }`;
  core composes only the English message (the existing refusal voice, both figures in). The fold
  stores `lastRefusal` (`LiveSessionState`), `started` clears it. `deriveTurnState` is UNCHANGED
  (`'error' → 'retry'` stands — the card owns the moment): the fail card renders on
  `turn === 'retry' && !state.lastRefusal`, the `BudgetRefusalCard` when `lastRefusal` is present;
  the primary chain's retry branch gains `&& !state.lastRefusal` so the global ⏎ stands down while
  the card's input owns Enter. Why a payload, not a code: `ProviderErrorCode` is a closed
  vendor-failure enum and the card needs the two figures.
- **D3 Core pure module.** New `src/core/budget.ts`: `DEFAULT_WARN_PERCENT = 80`, `monthWindow(
  now)` (UTC calendar month — `Date.UTC(y, m, 1) → Date.UTC(y, m+1, 1)`; ISO strings compare
  lexicographically against `started_at` TEXT), `warnThresholdUsd(cap, pct) = ceil(cap·pct/100)`
  (Paperclip), `budgetStatus(observed, threshold): 'ok' | 'warn' | 'hard_stop'`. No display
  strings, no Node builtins.
- **D4 app_setting row.** ONE JSON key `budget:<wsId>` = `{"capUsd", "warnPercent"}` — the atomic
  pair; garbage/partial parse → undefined (the `settingLocale` pattern). `deleteWorkspaceRow`
  SWEEPS it — a recycled workspace id must not inherit a dead threshold.
- **D5 Warn line.** Board card: a LAST line under the reason/action row; detail band: a
  full-width line under the title/badges row, before the step hairline. Voice
  `font-mono text-[11px] text-inkdim`, `data-budget-line`; rendered only when a threshold is
  configured AND status is warn|hard_stop. Four composers (warn/stop × known-basis qualifier
  "bilinen harcama", rendered iff `hasUnknown`), each via in-bundle `formatUsd`. No fill bar, no
  motion (ADR-0012; the WO-0046 addendum explicitly declined bars).
- **D6 Refusal card.** New `src/ui/components/detail/BudgetRefusalCard.tsx` in the decision stack
  (above the instrument — the askCards/fail-card slot). StopAndAskCard grammar: lamp card +
  readout title + body (the sentence, with figures) + the AC5 line ("Koşan sürüş kesilmez; kapı
  bir sonraki sürüşe uygulanır") + a one-line numeric input + the right-aligned ghost/primary
  pair «Kapı kalsın» / «Limiti yükselt ve sür». Validation (WO-0036: error under the field,
  `role="alert"`, never a lock): number required (`,` and `.` both parsed), `> 0`, and
  `newCap > observed` (Paperclip's rule). Prefill `max(observed + 10, cap)`.
  `data-budget-refusal-card`. Round-trips: **raise** → persist via the settings port +
  `refreshBudget()` + `store.restart(driveKey)` — the SAME DriveInput re-issued verbatim
  (captured at `start`; one wiring point, not nine start sites); **keep** → local dismiss (a NEW
  `lastRefusal` identity re-shows it; re-entry after navigation re-shows it too — honest: drives
  still refuse) and the standing hard-stop line (D5) stays. ⏎ rides the raise primary only while
  the input is valid; Enter-in-input fires the same action (the objection-layer rule — the input
  is NOT an ask: an ask requires fold status `stopped_asking`, impossible beside `error`).
- **D7 Settings section.** A new `<section>` in `AppSettingsModal`: two kit `Field`s (cap `$`,
  warn `%`) + local draft + «Kaydet» (validates cap > 0, 1 ≤ warn ≤ 100; persists BOTH as the one
  atomic JSON row) + a «Kaldır» ghost visible only when a threshold exists (clears via
  `setBudget(wsId, undefined)` — the delete-on-undefined precedent) + the month readout as a mono
  dim line (known-basis variant). Immediate-on-change is REJECTED for numbers (mid-keystroke
  writes garbage — the `Segmented` pattern suits closed enums, not decimals). `workspaceId`
  threads from App; the section is ABSENT when null (ADR-0001).
- **D8 Refresh triggers.** App gains `budget` state + `refreshBudget()` (spend + threshold read
  together). Called: on workspace load/change; inside `driveStore.onStarted/onAskResolved/
  onEnd/onError` (beside each `refreshWorkOrders()` — exactly the moments a session row's cost can
  change); after a raise; after the modal's `onBudgetChanged`.
- **D9 Gate seat.** FIRST in the gate spine (before the plan gate), gating EVERY drive — plan,
  step, review, resume (a resume spawns a runner that bills; plan/flow gate step/review only).
  Fail-open when unconfigured. The refusal is exactly one error event + `return` — no runner
  spawn, no session row, `active` never set. Read at spawn time ONLY → AC5 holds structurally.
- **D10 Test-fake contract.** `budgetBlockFor` is called UNCONDITIONALLY → BOTH fakes learn it
  (`pipeline.test.ts` fakeStore gains `opts.budgetBlock`; `cli.test.ts` fake gains
  `() => undefined` — its `flowModeFor`-less luck ends here). No `typeof` short-circuit: a silent
  optional hides a missing impl behind a contract that only fails in production.
- **D11 CLI.** `formatEvent`'s error case appends the refusal guidance when `ev.refusal` is
  present ("— raise the monthly cap in settings to continue (no --force-budget)"). Exit 1 via the
  existing flow. No flag anywhere — raising is a settings action.

## Steps

- **S1** (core, test-first) New `src/core/budget.ts` (D3) + `src/core/__tests__/budget.test.ts`:
  month/year rollover, UTC edges; boundary math (cap 5/pct 80 → 4.00 warn, 5.00 hard_stop; ceil
  semantics; pct 100 collapses the warn band into hard_stop; cap ≤ 0 → ok).
- **S2** (core plumbing) `src/core/runner.ts`: `refusal?` on the error member; `lastRefusal` in
  `LiveSessionState`; the fold's error case stores it, `started` clears it. `runner.test.ts`:
  set/clear/absent.
- **S3** (ports + adapter) `session-store.ts` gains `budgetBlockFor` (with the D9/D10 contract in
  its doc); `app-settings.ts` gains `getBudget/setBudget`; `source.ts` gains
  `workspaceMonthSpend`. `src/adapters/store/index.ts`: private `monthSpendRow` —
  `SELECT COALESCE(SUM(cost_usd), 0) AS usd, SUM(CASE WHEN cost_usd IS NULL THEN 1 ELSE 0 END)
  AS unknownCount FROM session WHERE work_order_id IN (SELECT id FROM work_order WHERE
  workspace_id = ?) AND started_at >= ? AND started_at < ?` (the workspace subselect precedent;
  window from core `monthWindow(new Date())`); the three public impls; the
  `deleteWorkspaceRow` sweep. `store.test.ts`: JSON round-trip; garbage → undefined; window and
  workspace isolation; NULL-cost excluded from `usd` + counted in `hasUnknown`; `budgetBlockFor`
  undefined below cap / payload at cap; delete-workspace sweeps the key.
- **S4** (pipeline gate) `src/core/pipeline.ts`: the budget block before the plan gate (D9),
  yielding the error event WITH `refusal: block`, then `return`. `pipeline.test.ts`: fakeStore
  gains `opts.budgetBlock`; (a) blocked drive → EXACTLY one error event with the payload,
  `drivenInputs` empty, no `recordSession`; (b) a PLAN drive and a RESUME drive refused alike;
  (c) unconfigured → untouched; (d) the message carries both figures.
- **S5** (CLI) `src/cli/drive.ts` refusal suffix (D11); `cli.test.ts`: fake gains
  `budgetBlockFor`; the formatted line + `summary.error` asserted.
- **S6** (labels) Both bundles, dated comment block: settings keys, the four warn/stop line
  composers (+ known-basis variants), `budgetRefusalTitle`, `budgetRefusalBody(observed, cap)`,
  `budgetRefusalRunningNote`, raise/keep actions, month-readout composers, field errors.
  `PROVIDER_ERROR_LABELS` is NOT extended (closed `Record<ProviderErrorCode,…>`; the sentence
  needs figures → composer). `labels.test.ts` pins the tr figures (`$4,20` + "bilinen harcama").
- **S7** (IPC + boundary) `electron/main.ts`: `docket:settings:get-budget` / `:set-budget` +
  `docket:source:workspace-month-spend`; `electron/preload.ts` bridges. Gate adds
  `check:boundaries`.
- **S8** (App + surfaces) App: budget state, `refreshBudget`, the four drive-store hooks,
  `onRaiseBudget`; prop threads (BoardScreen/Board/WorkOrderCard; DetailScreen/DetailStrip).
  Pure display of the budget view — no derivation in components. Gate adds `npm run build`.
- **S9** (refusal card + re-run) `drive-store.ts`: capture the input at `start`; `restart(key)`.
  `BudgetRefusalCard.tsx` (D6). `WorkOrderDetail.tsx`: `budgetKept` + the re-arm effect on
  `state.lastRefusal`; the fail-card/primary-chain branches (D2); the card + `onRaise` = persist
  → `restart`. `onRaiseBudget` threaded App → DetailScreen → WorkOrderDetail.
- **S10** (settings section) `AppSettingsModal` (D7) + AppShell threading.
- **S11** (E2E) `e2e/seed.ts`: two new workspaces — `uyarı`: threshold `{capUsd: 5, warnPercent:
  80}`, one approved-plan WO with a $4.20 in-month session + one NULL-cost in-month session (warn
  + known-basis); `kapı`: same threshold, two approved-plan WOs each with a $5.10 in-month
  session (hard_stop; two WOs so keep and raise have separate subjects). Dates COMPUTED at seed
  time (`Date.UTC(y, m, d, 12)` with day ≤ 28 — never a 31st-in-a-30-day-month bug; the existing
  2026-08-16 seeds stay untouched — their workspaces carry no threshold). `e2e/ui.mjs`, four
  specs: (1) `uyarı` board: the `data-budget-line` on cards carries `$4,20` + "bilinen harcama";
  (2) `uyarı` detail band shows the line while the (allowed) drive runs; (3) `kapı` WO-A: the
  refusal card present, NO live pane (AC2's no-spawn), «Kapı kalsın» → card gone, standing stop
  line remains; (4) `kapı` WO-B: prefilled `15.10` → raise → the re-run spawns (push `started` +
  `turn_complete` via `window.docket.e2e.emit`) → the live pane appears and the settings month
  readout shows the new cap. Order matters: (3) before (4) — the raise lifts the whole
  workspace's cap. Gate: `npm run test:ui`.
- **S12** (docs) ADR-0013 dated addendum + the CLAUDE.md sibling clause + TD-054 (sketches
  below).

## ADR / CLAUDE.md / TD sketches

- **ADR-0013 addendum** (bold dated block appended; old text never rewritten): the workspace
  BUDGET gate is pipeline-enforced exactly like the plan gate (`SessionStore.budgetBlockFor`,
  read at spawn time only) — when the calendar-month spend meets the workspace cap, EVERY drive
  (plan, step, review, resume) is refused with an error event before the runner spawns; a running
  drive is never touched. The refusal renders as a TWO-CHOICE card in the decision stack
  (raise-and-re-run / keep-the-cap — Paperclip's shape; no third path, no flag); the warn level
  renders as an informative mono line on the board card + the header band (ADR-0012's voice:
  text, never a fill bar). Raising the cap is a PERMANENT settings write that re-runs the refused
  drive.
- **CLAUDE.md sibling clause** (beside the plan-gate sentence, under `## Single view — ADR-0013`):
  the workspace budget gate is enforced the same way (`SessionStore.budgetBlockFor`, WO-0047) —
  when the month spend meets the cap, every drive is refused before the runner spawns; raising
  the cap is a settings write that re-runs the refused drive — never a host-side work-around or a
  force flag.
- **TD-054** (low, open): uncoded pipeline refusals (plan/flow) render as the generic crash card;
  the budget gate's structured `refusal` payload is the precedent — a future reason enum could
  give plan/flow the same localized card treatment.

## Verification ladder + checkpoint

1. `npm run typecheck` (both tsconfigs) 2. `npm test` 3. `npm run check:boundaries`
4. `npm run build` 5. `npm run test:ui` (existing + the four new specs).

Operator checkpoint (seeded spend, zero real tokens): `npx tsx e2e/seed.ts` → note the `DB=` path
→ `DOCKET_DB_PATH=<path> DOCKET_E2E=1 npm start` (the scripted runner replaces only the SDK — the
REAL pipeline enforces the gate) → (a) the `uyarı` board: the known-basis warn line on every card
+ the band line while its drive runs; (b) the `kapı` WO: the refusal card, keep → standing line;
(c) the second `kapı` WO: raise → the drive re-runs; (d) Settings: the threshold section, month
readout, garbage-input refusal. Screenshots. Then commit → PR (body starts with a "Model Used"
line) → CI green → operator approves → merge.

## Risks

- R1 the unconditional `budgetBlockFor` breaks both test fakes — S4 updates them in the same
  commit; a miss fails loudly at `npm test`, never in production. R2 the month window is UTC; the
  operator's local-month perception may differ near midnight on the 1st (Paperclip accepted the
  same trade). R3 cap-boundary undercount: a refused-then-raised drive's own final leg lands
  after the raise; the next drive reads the updated sum fresh at spawn — honest, no double
  count. R4 `restart` re-issues the renderer-side `DriveInput` verbatim; main re-resolves
  cwd/prompt/rule, so no stale assembly leaks. R5 the dismissal is per-mount (re-entry re-shows
  the card) — honest (drives still refuse); a drive-store-level consumed flag is a one-line
  follow-up if ruled noisy. R6 numeric parsing accepts `,` and `.`; invalid → field error, no
  locale-dependent surprises. R7 E2E asserts `data-*` attributes + pinned figure substrings
  (`$4,20`) — robust to copy edits that keep the figures. R8 label parity is enforced at compile
  time (`const en: Labels`); `labels.test.ts` is the runtime belt.
