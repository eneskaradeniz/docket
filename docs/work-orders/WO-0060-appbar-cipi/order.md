---
id: WO-0060
title: "Appbar drive/limit chip — the account's health at a glance (idle none · green running count · amber provider warning · red limit countdown)"
workspace: docket
status: open
mode: plan
review: light
review_mode: gates
tracks:
  - repo: app
    depends_on: []
---

# WO-0060 — Appbar drive/limit chip — the account's health at a glance (idle none · green running count · amber provider warning · red limit countdown)

## Objective

The top bar is silent about account health: when a drive is running, or a usage limit is near or
in effect, the operator must open the board or a detail screen to know. This WO adds ONE chip to
the appbar's right cluster that speaks the state in a four-tier ladder — nothing when idle; a
green `1 sürüyor` count when a drive runs (WO and ✦ draft alike); an amber `limit yaklaşıyor`
when the provider's own warning signal is up; a red countdown (hover = absolute reset clock) when
a limit stamp is in effect. The chip is passive — never a button, never a navigation, never a
second live surface; the drive's work surface stays the detail pane and the limit's work surface
stays the LimitCard.

## Context

- **Sibling earmark:** WO-0059's order locks the pairing ("limit/running appbar chip is the
  sibling WO-0060, separate session") and pre-records the chip rulings (countdown+hover,
  limit-wins). Branches off `main` — WO-0059's branch touches none of these files except the two
  label bundles; work by KEY names, never line numbers.
- **Sibling note recorded here:** WO-0059 carries a post-commit operator correction (2026-08-31)
  that lives only in session memory until its own round: the settings redesign restarts FROM
  SCRATCH and the presets become ALIAS TIERS (`sonnet`/`opus`/`haiku` + empty = Default) — the
  operator's gateway maps the tiers via `ANTHROPIC_DEFAULT_*_MODEL`, and Docket spawns the same
  CLI, so the mapping holds for Docket drives; full `glm-*` ids belong in the `özel` column.
  WO-0059's order.md gets this correction appended in its own round (its file lives only on its
  unmerged branch — writing it here would manufacture a conflict).
- **Data is ready; the UI is the work.** Active drive: `activeSnapshot()`
  (`src/ui/components/session/drive-store.ts:96-119`) — but it bails WO-less by truth
  (`:102`, the draft never overlays a board card), so the chip needs its own accessor keyed off
  `active` alone (UsageScreen's hand-rolled second arm, `src/ui/screens/UsageScreen.tsx:46-62`,
  is the shape to NOT copy). Limit: the live fold's `limitWindows.status`
  (`src/core/runner.ts:534`, `:726`) and `lastLimit.resetAt` (`:538` — the ONLY live red source;
  `limitWindows[].resetAt` is a window-OPENING time and would paint a mere warning red),
  persisted `limit_reset_at` rows, and core's `limitCrossing` (`src/core/runner.ts:845`).
- **Amber is the provider's word, not a threshold.** `status === 'warning'` is produced only by
  the push channel's `allowed_warning` (`neutralLimitStatus`,
  `src/adapters/runner/index.ts:921-926`); PaneWarnline's ruling is explicit — "never a locally
  invented threshold" (`src/ui/components/session/pane-chrome.tsx:164-166`). The chip keys on the
  status word; utilization is display-only (the tooltip).
- **The tone trio exists** — `Badge` tones `error`/`proceed`/`signal` are exactly
  `border-*/50 text-* bg-*/10` (`src/ui/kit/Badge.tsx:8-14`); amber = `signal`. `Badge` hardcodes
  `uppercase` and takes no `className` — it gains two optional props (S4).
- **Labels mostly exist:** `limitClock`, `usageLimitResetLine`, `limitWarnLine`,
  `limitWindowLabel`, `usageLimitUtilization` (the limit section of both bundles). Four new keys
  (S2). `appbarRunningCount` must NOT be `agentRunningLine` — that counts sub-agents (WO-0055),
  this counts drives; reusing it would lie in both directions.
- **Self-healing is real:** a clean leg clears the row stamp (the fold starts at
  `initialSessionState`, `src/core/pipeline.ts:242`; a clean close writes `limitResetAt: null`,
  `:283-313`) — and that clean close is also the E2E cleanup lever.

## Operator decisions (locked)

- 2026-08-30 (via WO-0059's session plan): idle → nothing; running → green count chip; limit →
  red countdown + hover absolute time; **limit outranks running** (running info stays in the live
  pane).
- 2026-08-31 (this order's planning round): the scope is WO-0060 (WO-0059's rev-4 round stays its
  own session); the running state KEEPS the locked cut — `1 sürüyor`, passive, no WO identity, no
  click; NEW this round: **the amber warning tier** (the provider's `warning` status), ladder
  red > amber > green > none.

## Plan (stages)

Each stage ends in the operator's manual check — no commit before the verdict.

### S1 — core, test-first: `limitInEffect` + `appbarDriveTier`

`src/core/derive.ts` (beside the WO-0053 limit arm of `deriveCardReason`, `derive.ts:234-236`) +
`src/core/__tests__/derive.test.ts` (fixtures via `aSession`/`aWorkOrder`):

- `limitInEffect(sessions: ReadonlyArray<Pick<SessionRef, 'limitResetAt'>>, liveResetAt: string |
  undefined, nowMs: number): string | undefined` — account-wide; keeps stamps that PARSE and are
  strictly future (`> nowMs` — `now === stamp` is already healed); returns the MAX (a live
  EARLIER stamp must not mask a later row stamp — "live outranks" is subsumed by max). Does NOT
  import `limitCrossing` (opposite garbage semantics: 'wait' claims a limit, the chip must
  exclude) and keeps `derive.ts:4`'s type-only-import note true for itself.
- `appbarDriveTier(input: { running: boolean; limitResetAt?: string; warn: boolean }, nowMs):
  'limit' | 'warn' | 'running' | 'none'` — `limitCrossing(limitResetAt, nowMs) === 'wait'` →
  `'limit'`; else `running && warn` → `'warn'`; else `running` → `'running'`; else `'none'` (the
  `deriveTurnState` precedent, `derive.ts:510`). A LOCKED product rule → core + test-first, not
  three ternaries in chrome. The value import of `runner` into `derive` amends `derive.ts:4`'s
  comment in the same commit (acyclic — runner imports nothing from derive).
- Tests FIRST: none → undefined; single future; only-past → undefined; several future → max;
  past+future mix; live+rows → max; live alone (the draft arm); unparseable mixed → ignored and a
  real future stamp still wins; unparseable alone → undefined; `nowMs === stamp` → undefined;
  `''`/absent skipped. Tier: the five arms + the hand-over (past stamp + running → running).
- Manual check: typecheck + test green; `npm run dev` boots with the appbar pixel-identical.

### S2 — labels, both bundles

`src/ui/data/labels/tr.ts` / `en.ts` (the limit section) + `labels.test.ts`:

- NEW: `appbarRunningCount(n)` (`1 sürüyor` / `1 running`); `limitCountdown(ms)` — day-aware
  (`42sn · 58dk · 4s 12dk · 2g 3s` / `42s · 58m · 4h 12m · 2d 3h`; a separate key on purpose —
  `formatDuration` tops out at `Xs Ydk` and perturbing it would change every elapsed readout);
  `appbarLimitAria(time)` (`Kullanım limiti doldu — ${time}'de sıfırlanır`); `appbarLimitWarn`
  (`limit yaklaşıyor` / `limit approaching`).
- REUSED (no new key): `limitClock`, `usageLimitResetLine`, `limitWarnLine`, `limitWindowLabel`,
  `usageLimitUtilization`.
- Manual check: typecheck + test green.

### S3 — the narrow activity signal + App wiring

`src/ui/components/session/drive-store.ts` + `src/ui/app/App.tsx`:

- drive-store: `let lastActive` — set in the drive loop's `finally` (`:160-167`); the snapshot
  key is `active ?? lastActive` (kills the end-of-drive blink: `onEnd` → `refreshWorkOrders` is
  async). No hand-clearing: `forgetWo` already deletes the fold (`:204-212`). `activitySnapshot()`
  — the `activeSnapshot` dirty-flag + content-compare cache over PRIMITIVE fields only
  (`running`, `limitStatus`, `limitResetAt`, `limitSubject.{window,utilization,resetAt}` — never
  the windows array, whose identity changes on every ~30s pull emit). Returns
  `DriveActivity { running: boolean; limitStatus?: 'ok'|'warning'|'blocked'; limitResetAt?: string;
  limitSubject?: { window; utilization: number|null; resetAt: string|null } }` — `limitResetAt` =
  `state.lastLimit?.resetAt`; `limitSubject` = the fullest window by PaneWarnline's own sort
  (`pane-chrome.tsx:180-182`; the UI never sorts). Exported hook `useDriveActivity(store)` beside
  `useActiveDrive` (`:308-314`). No renderer test harness exists in `src/ui` — this stage's
  correctness is pinned by S5's E2E (stated here, deliberately).
- App.tsx: `const driveActivity = useDriveActivity(driveStore);` beside the existing
  `useActiveDrive` (`:137`); a memo beside `cards`:
  `running = driveActivity?.running === true`; `limitResetAt: limitInEffect(workOrders.flatMap(w
  => w.sessions), driveActivity?.limitResetAt, Date.now())` (App already holds the UNFILTERED
  list, `:37` — an account fact wants account scope); `limitWarn` present only while `running &&
  limitStatus === 'warning' && limitSubject`. `Date.now()` in a memo is deliberate: the chip's
  own ticker owns every subsequent second. Pass `driveActivity` on `<AppShell>` (`:372-389`).
  AppShell never hears the word `'warning'` — the amber arm is already folded into `limitWarn`'s
  presence.
- Manual check (numbered): 1) idle board → appbar unchanged, no chip; 2) start a plan drive →
  `1 sürüyor` appears within one event; 3) `Durdur` → vanishes; 4) start a ✦ draft from the
  roadmap → `1 sürüyor` STILL appears (the accessor fix); 5) stream a long drive → the chip text
  never flickers per line.

### S4 — the chip in AppShell

`src/ui/chrome/AppShell.tsx` + NEW `src/ui/chrome/AppbarDriveChip.tsx` + `src/ui/kit/Badge.tsx`:

- AppShell: `export interface AppbarActivity { running: number; limitResetAt?: string;
  limitWarn?: { window: string; utilization: number | null; resetAt: string | null } }` exported
  FROM THIS FILE (presentational — no drive-store import). `<AppbarDriveChip activity={…} />` as
  the FIRST child of the `ml-auto` group (`AppShell.tsx:90` — already
  `WebkitAppRegion: 'no-drag'`; a chip in the drag half would swallow window drags), OUTSIDE the
  `workspaceId !== null` fragment — an account fact is not workspace-scoped.
- The chip: `appbarDriveTier` decides; `'none'` → `null` (ADR-0001: idle renders nothing, not a
  dim shell). Red: `Badge tone="error"` + `Hourglass` (LimitCard's icon) +
  `limitCountdown(Date.parse(resetAt) - now)`; `Tooltip` = `usageLimitResetLine(limitClock(resetAt))`;
  `aria-label` = `appbarLimitAria(...)`. Amber: `tone="signal"` + `appbarLimitWarn` (figure-free
  body); `Tooltip`/aria = `limitWarnLine(limitWindowLabel(w), util, clock)` — one amber voice,
  the pane's own sentence. Green: `tone="proceed"` + `appbarRunningCount(running)` + the optional
  `.dot-run` (already in the reduced-motion kill list, `src/index.css:790`). One element, one
  attribute: `data-appbar-drive` + `data-tier="limit|warn|running"`. No `aria-live`, no new
  animation; transitions only. The ticker exists ONLY under red: `useState(Date.now())` +
  `setInterval(…, 1000)` gated on `tier === 'limit'` via `limitCrossing(resetAt, now) === 'wait'`
  (the `WorkOrderDetail.tsx:351-358` pattern); the crossing unmounts the chip, and the stale
  memo string heals at the next rows refresh.
- Badge: two OPTIONAL props, `caps = true` and `className`; defaults unchanged (all existing call
  sites pixel-identical); the tone map stays the one source of truth. The chip asks
  `caps={false}` (`1 SÜRÜYOR` / `4S 12DK` is unreadable — `S` is both saniye and saat),
  `shrink-0`, and a `gap` for the icon.
- Manual check (numbered): 1) idle → nothing; 2) drive → green, and the header still drags from
  the wordmark and around the chip; 3) hover the red chip → the absolute clock; 4) seed a short
  future stamp → the countdown ticks and the chip vanishes on its own; 5) a warning fold → amber,
  figure-free, tooltip names window + % + clock; 6) warning + running → amber ONLY; 7)
  `prefers-reduced-motion` → the dot is static.

### S5 — precedence, crossing, restart, E2E + closure

`e2e/ui.mjs`, appended AFTER the WO-0054 block — the chip is account-wide, so WO-0053's limit-04
spec already leaves a future stamp on `Yeni iş emri örneği`; the new specs go LAST and must end
CLEAN. Reuse: `spec`/`page`/`SHOTS`, `openDetail`/`backToBoard`/`stopAllDrives`/`switchWs`/
`openRoadmap`/`startDraft`/`draftEmit`, `futureStamp`/`pastStamp`/`limitDeath` (`:2528-2534`),
the `docket:e2e.emit` bridge (`electron/main.ts:407-409`, `electron/preload.ts:124-127`):

1. Idle → `[data-appbar-drive]` count 0.
2. Green: start a drive → `[data-appbar-drive][data-tier="running"]` count 1, text contains
   `sürüyor`; `Durdur` → count 0.
3. Amber: with the drive live, emit `{kind:'limit_windows', windows:[{window:'five_hour',
   utilization:86, resetAt: futureStamp()}], status:'warning'}` (the pane spec's shape,
   `:2581-2588`) → tier `warn`; body has NO `%`; tooltip contains the window label and `%86`; a
   clean `turn_complete` → back to `running`.
4. Precedence + the red tick: warning again, then `limitDeath(futureStamp())` → exactly ONE chip,
   tier `limit`; two reads 1.2s apart differ; a SHORT stamp (`+8s`, the limit-01 pattern) is
   waited out — the chip unmounts itself and tier returns to `running` (the real-crossing pin).
5. Draft arm + cleanup: stop the WO drive; `startDraft` + the same warning emit → tier `warn`
   (the accessor fix, proven); end the draft; resume the WO drive and end it with a clean
   `turn_complete` → the row stamp clears, chip count 0, world clean for later specs.
6. Restart persistence: `limitDeath(futureStamp())` → chip present; `page.reload()` → the chip
   re-derives from the row via the mount-time `getWorkOrders()`; then cleanup per spec 5.

Closure: screenshots per tier into the WO folder; `npm run build`, `npm run check:boundaries`,
`npm run test:ui` green; ROADMAP entry (an M9 line, or an M8 addendum if the operator prefers to
keep live-visibility in one milestone — asked at closure); PR body carries the "Model Used" line.

## Scope

In scope:

- Core (test-first): `limitInEffect` + `appbarDriveTier` in `src/core/derive.ts` (+ the
  `derive.ts:4` comment amendment).
- Labels: four new keys in both bundles + `labels.test.ts` pins.
- drive-store: `lastActive` carry, `activitySnapshot()`, `useDriveActivity` (narrow,
  content-compared, primitive fields only).
- App.tsx → AppShell wiring (`driveActivity` prop; `AppbarActivity` exported from AppShell).
- The chip: NEW `AppbarDriveChip.tsx`; `Badge` gains optional `caps`/`className`.
- E2E: six specs after the WO-0054 block, ending clean.
- Docs: ROADMAP entry at closure; TD-059 (the draft-stamp restart gap, below) in
  `docs/tech-debt.md`; screenshots into the WO folder.

Out of scope:

- Click/navigation on the chip (locked: passive; the board and the detail are the navigation).
- The WO identity or agent count in the chip (locked cut stays `1 sürüyor`; `agentRunningLine`
  keeps its pane home).
- A local warning threshold or utilization math (the provider's signal or nothing — WO-0053's
  ruling).
- Budget figures/copy (WO-0047's card owns those; the two never compete — pre-spawn vs
  post-flight).
- Auto-resume or any timer that ACTS (the chip informs; the operator clicks).
- Persisting anything new (no schema change — the red tier reads existing `limit_reset_at` rows
  and the live `lastLimit`).
- The draft-stamp restart gap (TD-059 — recorded, not fixed).

## Acceptance criteria

1. Idle → the chip renders NOTHING (no element, not a dim shell); the appbar is pixel-identical
   otherwise, and the header still drags from the wordmark and around the chip.
2. A running WO drive → green chip `1 sürüyor` (`data-tier="running"`), passive (no button, no
   navigation); `Durdur` removes it.
3. A running ✦ draft → the SAME green chip (the WO-less accessor — `activeSnapshot`'s WO-only
   truth is not silently inherited).
4. A provider warning on the live fold → amber chip `limit yaklaşıyor` (`data-tier="warn"`),
   figure-free body; the tooltip names the window, the utilization and the reset clock; amber
   outranks green.
5. A limit stamp in effect (live `lastLimit` or any persisted future row — account-wide) → red
   chip with a live countdown (`data-tier="limit"`), hover = the absolute reset clock,
   `aria-label` speaks the state; red outranks amber; the chip unmounts itself when the clock
   crosses; a PAST stamp never paints red (self-healing).
6. Every word through `useLabels()`; `limitCountdown` pinned per locale (day tier included); no
   `aria-live`, no new CSS animation, no `disabled` attribute anywhere.
7. Core is test-first: `limitInEffect` + `appbarDriveTier` pinned in `derive.test.ts` before any
   consumer lands; the full ladder green (typecheck both, `npm test`, `check:boundaries`, build,
   E2E with the six new specs).

## Evidence required

- plan_approval: this order IS the approved session plan (plan mode, 2026-08-31); `plan.md` not
  carried separately (the `review: light` posture).
- operator_checkpoint: DEFERRED to the operator's next session (the WO-0045 precedent) — the
  numbered scenarios in the stage plan ride `npm run dev`; the branch merged ahead of the tour at
  the operator's "kaldığın yerden devam et" tempo.
- pr_open: RESOLVED — PR #65 (`https://github.com/eneskaradeniz/docket/pull/65`), head `f5d9299`,
  merged `9f0e9fa` (the operator-ordered flow; the manual tour rides the next session).
- ci_green: green at the working tree, 2026-09-19 — typecheck (both tsconfigs), 931 unit tests
  (916 base + 14 chip-family), `check:boundaries` clean, build clean, **E2E 102/102 green
  (exit 0)** — the six chip specs rebased onto the post-rev-4 tree (the block runs after the
  rev-4 settings specs; limit-04's stamp deliberately +8s so it crosses before the block;
  'Model kanıt' as the healthy-resume target; `openWsEdit`-style current-workspace targeting).
- closure: PENDING — ROADMAP entry + TD-059 filed, proven by a commit sha.

## Stop-and-ask gates

- Any click/navigation, WO identity, or agent count added to the chip (the locked cut).
- A locally invented warning threshold or utilization figure in the chip body.
- Any `limitWindows[].resetAt` read as a limit-in-effect source (window-OPENING times — a mere
  warning must never paint red).
- A `disabled`/`aria-disabled` attribute, an `aria-live` on the countdown, or a new CSS animation
  in `src/ui/`.
- A vendor name or model literal outside `src/adapters/` (ADR-0006); a `.replace(` in `src/ui/`
  (ADR-0007).
- Scope growth into the settings surfaces (WO-0059's rev-4 round owns those).

## Notes

- The chip is the console's THIRD glance surface but never a live one: no transcript, no
  `useDrive` fold subscription beyond the primitive snapshot, no pane grammar — `pane-chrome`
  stays the panes' home.
- Amber's accessible name is the same `limitWarnLine` string as its tooltip (zero new aria keys);
  green needs none (`1 sürüyor` is self-describing); red needs `appbarLimitAria` (a bare
  countdown is not speakable).
- Known conservatism, by design: a stale FUTURE row stamp (an interrupted leg) holds the chip red
  until a clean leg clears it — the live fold carries no "no limit" fact that could honestly
  disprove it.
- TD-059 (to file): a ✦ draft's limit stamp survives a restart only in `roadmap_draft.session`,
  which `getWorkOrders()` never joins — the red chip covers drafts while their fold lives in the
  app session, WO drives both live and after a restart. Reading the draft row on every surface is
  out of proportion for a chip.
- The `agentRunningLine` distinction is a vocabulary ruling: sub-agent counts (WO-0055) and drive
  counts are different facts; if they ever merge into one chip line, that is a new order.
