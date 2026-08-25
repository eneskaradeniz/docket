---
id: WO-0044
title: One live grammar — the ledger is pure history, the driven row is the one live surface
workspace: docket
status: open
mode: direct
review: light
review_mode: gates
tracks:
  - repo: app
    depends_on: []
---

# WO-0044 — One live grammar — the top instrument, the status spine, the self-declaring ledger

## Objective

Operator bug report (2026-08-25, the first real step-drive dogfood — base-mobile WO-0001 running inside
Docket): three complaints, one root — the DOSYA's design language forked while a pipeline drive runs.

1. "bu sırayla çalışan ajanlarda dökümü gizle göster yok" — the driven step's inline transcript
   (`StepPane`, compact) cannot be closed; the 2026-08-23 live-pane revision (activity verb line +
   "Dökümü aç/kapat" chip) reached `SessionPane` but never `StepPane`/`ReviewPane`. And the ledger's
   running session renders as a "▸ Canlı oturum" POINTER card (WO-0039/C Q1) — a grammar the completed
   cards do not speak ("bizim ilk mimar plandaki tasarım gibi olmalıydı").
2. "çalışıyor oturumu sürdür yazıyor gerek var mı?" — `ActionCard`'s read-only pairing "Çalışıyor /
   Oturumu sürdür" while a drive runs: the label of a button that died in WO-0027, reading as a
   standing offer.
3. "tasarımlar birbirini takip etmeli, gereksiz şeyler olmamalı" — the state word on five surfaces,
   the step's meta on two, "Uygulama" twice in the band.

Operator rulings (2026-08-25, this order's question round): the ledger is **pure history** (no running
card at all; a session joins as a plain card the moment it ends) and the **ActionCard is absent while a
drive is live**. Design decree (ui-ux-designer, 2026-08-25): *belge sakin, enstrüman istekli* — the
"Çalışıyor" WORD lives once, in the band; live surfaces speak in verbs ("Dosya okuyor…").

## Context

- `src/ui/components/session/pane-chrome.tsx` — NEW shared pieces: `usePaneActivity` (the activity
  verb machine lifted from SessionPane: newest unmatched tool's progressive verb / "Düşünüyor" /
  frozen fold words), `PaneLogChip` (the `data-pane-log-toggle` ichip), `usePaneLog` (closed default +
  the scroll-on-open contract). One grammar, three panes.
- `src/ui/components/session/StepPane.tsx` — the driven row's instrument speaks the SessionPane
  grammar: `● ROL — Dosya okuyor···` + costline + DriveControls + the chip; the Ray column (compact)
  rides BEHIND the chip. v6's "the live thing is never hidden behind a toggle" comment dies — the
  2026-08-23 operator ruling ("sadece çalışan şey gözüksün") supersedes it; the live thing still
  travels with its step, on demand.
- `src/ui/components/session/ReviewPane.tsx` — same grammar (+ `now` costline parity).
- `src/ui/components/session/SessionPane.tsx` — consumes the shared pieces; the `logOpenSignal` nonce
  prop dies (only goLive serviced it).
- `src/ui/components/detail/SessionCards.tsx` — `LiveSessionCard`, `LiveSessionRow` and the pointer
  selection die. Every row is a `SessionCard`; a stale 'running' row (crash leftover) still opens
  itself, honestly incomplete. Reverses WO-0039/C's Q1 pointer clause and ADR-0013's "the running
  session's card opens itself" clause (dated addendum written; text untouched).
- `src/ui/components/detail/WorkOrderDetail.tsx` — `liveRow`/`goLive`/`liveLogNonce`/`liveSessionId`
  die; the record stack no longer depends on the drive fold. ActionCard renders only when
  `turn !== 'running'` (the gate is the turn state — a first-run drive has no persisted row for the
  card's own check to see).
- `src/ui/components/detail/ActionCard.tsx` — `return null` while a session row runs AND for the
  `resume` intent: Sürdür lives only in DriveControls ('▶ Sürdür', ⏎'s target). The word leaves the
  detail screen; `ACTION_LABELS.resume` survives on board cards only (there it is the honest next
  action of a stopped order).
- `src/ui/components/detail/StepList.tsx` — the driven/active row's meta carries its scope only (the
  state word lives in the row's pane header — where it stays TRUE when the drive is stopped; a
  stopped 'active' step made "çalışıyor" briefly wrong).
- Labels (`tr.ts`/`en.ts`): `phaseLabelText(implementing)` drops the leading "Uygulama ·" (the stage
  badge beside it already says the word); `reviewModeGatesShort/EveryShort` renamed
  "Denetim: kapıda / Denetim: her adımda" ("Kapılarda" alone begged "neyin kapıları?");
  `liveSessionGo` and `stepRunningShort` deleted.
- `src/ui/components/detail/DetailStrip.tsx` — the locked cadence chip dims (`opacity-45`), the
  guarded-row idiom beside its pencil.
- ADR-0013 addendum (2026-08-25) records the reversal; CLAUDE.md's Single-view clause updated.

## Acceptance criteria

1. A live step drive: the driven row shows the activity header + the döküm chip (closed by default);
   opening shows the compact transcript under the row's header; closing hides it. The ReviewPane and
   SessionPane speak the same grammar.
2. While a drive is live, "Oturum dökümü" carries only completed cards; no pointer card, no
   "Canlı oturum" line, in any reload/re-entry timing. A first plan run renders no ledger at all
   (empty group absent, ADR-0012).
3. While a drive is live, the ActionCard is absent; "Oturumu sürdür" appears nowhere on the detail
   screen. Stopped: DriveControls carries "Durduruldu. Rapor kısmi kalır." + ▶ Sürdür (⏎'s target).
4. The band's phase line reads "0/2 adım" during implementation (the badge says "Uygulama"); the
   driven row's meta reads its scope (or empty); the cadence chip reads "Denetim: kapıda".
5. `npm run typecheck` (both), `npm test`, `npm run build`, `npm run check:boundaries`, E2E specs
   green.

## Evidence required

- plan_approval: n/a (`mode: direct`, `review: light` — solo; gates operator-covered)
- operator_checkpoint: the live-run reading experience verified in the app on a real drive
  (base-mobile WO-0001's step 2 or a fresh drive) — chip open/close, pure-history ledger, absent
  ActionCard, deduped words
- ci: typecheck (both) / `npm test` (535) / `check:boundaries` / `build` green; `test:ui` green
  (after the round below)
- review: reviewer agent on the working-tree diff (2026-08-25, pre-PR — same diff). Dispositions:
  **finding 1 (AC-2 hole) FIXED** — the pipeline persists a session row 'running' at drive start, so
  a mid-run re-entry rendered the live drive's card in the ledger (self-opening, breathing
  "Çalışıyor" meta); `liveSessionId` returns as a prop and the ledger SKIPS the matching row (the
  reviewer's "in any reload/re-entry timing" read of AC 2). Finding 2 FIXED — the cadence tooltip
  CTAs still named the retired chip words ("Tıkla: Kapılarda"); they name the on-screen chips now.
  Finding 3 (unpinned behaviors) PARTIAL — added pins: "0/1 adım" phase form, the driven row's
  "Aktif" word, and the first-plan-run's absent ledger; the "Bekliyor" word stays unpinned (no
  fixture carries a pending row — a fixture for it is not worth the seed churn). Findings 4-5 FIXED
  (stale comments; `--bord` moved home to the base-layer token block and `.steprow.owner` rides the
  token — parity is structural). Finding 6 RECORDED (a done-without-verdict WO mounts the step's
  StepPane for one effect tick before the review pane takes the seat — a one-frame transient,
  watched at the checkpoint). Finding 7 noted (the mockup quotes local paths/PR numbers — the
  docs/ui-mockups precedent). No blocking findings.
- e2e (the closure round, five tours): run 1 RED (22) — two STALE EXPECTATIONS were the roots (the
  closed-WO ledger spec wanted the bare "Bağımsız" name span; the session-cards spec wanted
  "Adım 1 · a" + the role lamp) and everything after them died in cascade timeouts (the app never
  returned to the board); run 2 GREEN after both moved to the KİM — ROL anatomy. Run 3 RED (9) —
  an early-boot flake (the board read 0 seeded cards for ~30s, later specs found them; not
  reproducible, nothing in the diff touches boot — recorded, watch for recurrence). Run 4 RED (20)
  — the reviewer fix OVER-FILTERED: a Sürdür continues the SAME provider session, so the resumed
  leg's only ledger row matched `liveSessionId` and vanished ("the ledger lost its history rows");
  the spec died mid-way leaving a live drive, cascading the rest. Fix: the audit section gates on
  the VISIBLE rows (a resume-led live leg renders NO section at all — absent, not framed-empty,
  ADR-0012), and the spec pins BOTH halves (no section while live; the row rejoins when the leg
  ends). Run 5 GREEN: 0 failing.
- closure: ROADMAP ticked; ADR-0013 addendum + CLAUDE.md updated; no new tech debt (the stopped-state
  ActionCard/DriveControls duplication this order's plan flagged as TD was fixed in scope:
  ActionCard never renders the resume intent)

## Round 2 (2026-08-25, same day — the operator drove a real review session on the tur-1 build)

Rulings, mockup-approved first (`docs/ui-mockups/wo-0044-live-top.html`, ui-ux-designer decree):

- **The live instrument rides at the TOP, band-adjacent** (the architect live-plan pane's old seat);
  the driven step row carries no pane — ADR-0013's "driven row carries its live chat inline" trade
  and tur 1's restatement both reverse (dated, in the ADR's tur-2 addendum).
- **The spine is a pure status list**: row meta opens with the state word — `Aktif` (true even for an
  interrupted step; "Çalışıyor" lied there) · `Bekliyor` ("sırada" flattened) · done unchanged.
- **Record cards declare themselves**: session-card head = `KİM — ROL` readout (role word in its
  hue, 3px role edge, step aim on its own line — `auditNameStep` narrowed to the head); session +
  document cards wear the visible `--bord` edge (the `.steprow.owner` mix; flow surfaces keep the
  plain hairline). `--bord`/`--bord-on` + `.rcard*` land in `src/index.css`.
- StepPane wraps in `PaneShell` at the top slot; `StepList` loses the inline pane + the
  `workOrderId`/`now`/`drive` props; `stepQueued` dies; `STEP_STATUS_LABELS.active` becomes 'Aktif'.

## Round 3 (2026-08-25 — the operator's post-checkpoint audit; "düzelt" approved)

1. `StreamLine` + `UI.streamOpened` (tr/en) + `.streamline` CSS — dead, deleted (the empty-run
   state is the header's activity line on every pane).
2. **The özet leaked raw markdown** ("## Uygulayıcı Raporu — … **PR: …**", the operator's
   screenshot): the headline derivation moved to core as `sessionHeadline` (markdown stripped —
   links keep their label; first sentence; 140-char clamp; nothing readable → no headline), +5
   tests. The tur-3 test caught a real flaw: the old `split('. ')` missed a line-ended sentence
   boundary — the boundary is now a period + whitespace. Core owns the string work (the ui layer
   never `.replace`s — the ADR-0007 proxy).
3. StepPane's open döküm dropped `variant="compact"` — the TOP seat wears the one expansion height
   every pane shares (340px, SessionPane parity); the compact cap was the dead spine-row form.

## Notes

- The verb machine is lifted VERBATIM from SessionPane's 2026-08-23 form — including the two
  operator rulings it encodes: the empty-run window carries no second line (the header's
  "Düşünüyor···" is the honest state; two-then-one was the complaint) and "Çalışan oturum yok."
  never flashes during the provider's 1-3s boot window.
- The e2e ledger spec (re-entry) now asserts the pointer's ABSENCE — the re-entry dupe it guarded
  against is structurally gone (nothing appends live cards anymore).
- The plan's StreamLine note was superseded during implementation by the deeper 2026-08-23 precedent
  (SessionPane's empty-run form): the chip grammar says no second line; StreamLine left StepPane.
