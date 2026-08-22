---
id: WO-0037
title: Okunur akış — chat transcript (xterm retires), SADE activity tail, strip gate as guarded control
workspace: docket
status: open
mode: direct
tracks:
  - repo: app
    depends_on: []
---

# WO-0037 — Okunur akış (chat transcript + SADE tail + strip gate)

## İçindekiler

- [Objective](#objective)
- [Context](#context)
- [Scope](#scope)
- [Acceptance criteria](#acceptance criteria)
- [Evidence required](#evidence-required)
- [Stop-and-ask gates](#stop-and-ask-gates)
- [Notes](#notes)

## Objective

Three pieces of operator feedback (2026-08-22), one work order — all presentation-layer work over
the existing structured stream (`LiveSessionState.entries: TranscriptLine[]`; runner, IPC, fold and
store untouched):

1. **The strip gate becomes a guarded control.** While a drive spends, the title pencil and the
   delete button render IN PLACE, dimmed, handler-less, with a tooltip naming the unblocking move —
   the ADR-0001 2026-08-21 guarded-row idiom. The "önce oturumu durdur" standing line dies on the
   DetailStrip (the substrip already says "Çalışıyor" — the cause is on screen); it survives in
   WsSettingsModal where the cause is genuinely off-screen. The CLOSED pencil joins the same guarded
   form (kit `locked`'s `pointer-events-none` made its tooltip unreachable — that bug dies too).
2. **SADE gains an activity tail.** Under the phase line, the last 3 transcript entries render as
   quiet mono lines (run-dot on the last) — the phase says WHAT KIND of thing is happening, the tail
   says exactly WHAT ("Komut çalıştır — npm test"). Static, no motion: SADE stays calm (ADR-0012).
3. **DETAY's live flow becomes a chat transcript; xterm.js retires.** One reading column in the app
   card idiom: assistant turns as markdown bubbles with a role-colored left edge, tool calls as
   compact mono rows, tool results as indented quiet lines (error tone when failed), system/note as
   centered readout lines. Fenced code renders as IDE-style blocks (language header + copy button +
   rehype-highlight in the warm-dark tokens). The Kayıt ledger's archived transcript joins the same
   renderer. A bottom-pin + "▾ en son" jump chip replaces the terminal's scrollback; a 400ms pulse
   on true appends replaces the terminal's decoration.

Decisions approved by the operator (2026-08-22, after an HTML before/after preview): gate → dimmed
controls + tooltip; xterm → full replacement, NO chat/terminal toggle.

## Context

- src/ui/components/detail/DetailStrip.tsx:155-161 (absent trash), 167-187 (absent pencil + the
  `stripGateReason` readout; the `closed` locked pencil), 192-210 (review-cadence chip — untouched,
  it states a fact, it is not a gated action).
- src/ui/data/labels/tr.ts:539 (`stripGateReason`) / en.ts:473; `wsDeleteGateReason` stays
  (WsSettingsModal.tsx:366-370 — cause off-screen, absent + reason is correct there).
- src/ui/components/session/Terminal.tsx — the retiring xterm surface; the ONLY consumer of
  src/core/transcript-format.ts (+ its test) — verified, nothing else imports it (CLI included).
- src/core/runner.ts:19-34 (RunnerEvent), 316-322 (summarizeToolInput), 376-410 (foldSessionEvent —
  drops callId, keeps tool + detail), 431-476 (simplePhaseFromState).
- src/ui/components/session/pane-chrome.tsx:44-64 (PhaseLine, StreamLine); SessionPane.tsx:145-159
  (SADE PhaseLine / DETAY Terminal), StepPane.tsx:89-128 (compact inline terminal), ReviewPane.tsx.
- src/ui/components/detail/AuditTable.tsx:87-100 (plain-text archived transcript).
- src/ui/components/detail/MarkdownBody.tsx (react-markdown + remark-gfm — gains rehype-highlight).
- docs/adr/ADR-0004:21 ("xterm.js for transcript rendering" — superseded by addendum),
  ADR-0001 (gate presentation addendum), ADR-0012 (transcript motion addendum).
- e2e/ui.mjs:552-568 (strip-gates spec — updated), :796-820 (audit transcript spec — must pass
  unchanged: the chat renders the same label projections).

## Scope

In scope:

- ChatTranscript (new, session/): entries + role + variant (live | compact | archived); memoized
  entries; bottom-pin 48px + jump chip; append pulse only on a true append (`prevLen > 0` — a
  resume seed 0→N stays calm); 800-entry cap with a head line; `data-chat`, `role="log"`,
  `data-chat-entry={speaker}`.
- CodeBlock (new, detail/): the `pre` override for MarkdownBody — language header (`data-code-lang`)
  + copy `.ibtn` (2s confirmation); `rehype-highlight` with `detect: false`.
- pane-chrome: `PhaseTail` (last 3 entries, `data-sade-tail` / `data-tail-line`, run-dot on last,
  `transcriptTailText` projection).
- Panes swap: SADE → PhaseLine + PhaseTail; DETAY → ChatTranscript (StepPane variant compact).
- AuditTable: archived transcript = ChatTranscript variant archived, role from SessionRef.
- DetailStrip gate: guarded pencil + trash while `driveLive`; closed pencil joins the guarded form;
  `stripGateReason` label deleted (both bundles).
- CSS: `.chat` block, `.brole-*` role edges (signal/info/proceed), `linepulse` + `[data-live="1"]`,
  jump-chip positioning, `.hljs-*` warm palette from EXISTING tokens (denim/sage/clay are gone);
  pulse added to the reduced-motion kill block.
- Delete: Terminal.tsx, core/transcript-format.ts + its test, the three `@xterm/*` deps.
- Docs: ADR-0001 / ADR-0004 / ADR-0012 addenda; tech-debt TD-020 / TD-034 / TD-040 closed, one new
  TD (unwindowed chat list); ROADMAP line; E2E specs + 5 shots.

Out of scope:

- Streaming deltas (the adapter drops partial events — `assistant_text` arrives complete; a future
  `progress` event is runner.ts:412-416's note, not this order).
- Diffs in the stream (diff-peek stays the on-demand IPC it is).
- Syntax highlighting for tool_result summaries (truncated summaries stay plain mono).
- WsSettingsModal's gate (absent + reason survives there by design).
- Virtualizing the chat list (800-cap + memo first; TD records the escape hatch).

## Acceptance criteria

1. While a drive runs: pencil AND trash render in place (dimmed, no handler, pointer events kept);
   hovering the pencil shows the unblocking tooltip; the string "önce oturumu durdur" appears
   nowhere — E2E.
2. On a CLOSED work order the pencil renders in the same guarded form and its tooltip OPENS (the
   old kit-locked pencil's tooltip was unreachable) — E2E or shot.
3. SADE during a live drive: phase line + `data-sade-tail` with ≤3 `data-tail-line`, the last
   carrying the run-dot and a concrete transcript line ("Komut çalıştır — npm test") — E2E.
4. DETAY live: `data-chat` renders assistant bubbles (markdown, role edge), tool rows
   (`text-info`), indented results with `→ ` (error tone on `isError`), centered system/note lines;
   fenced ```ts code gets `[data-code-lang]` + a working copy button — E2E.
5. Chat pins to the bottom while the user is at the bottom; scrolling up escapes (scrollTop
   unmoved on append) and the `data-chat-jump` chip restores the bottom — E2E.
6. The Kayıt ledger expansion renders the archived transcript through the same chat grammar
   (existing audit spec passes unchanged — label projections preserved).
7. xterm is gone: package.json has no `@xterm/*`, Terminal.tsx and core/transcript-format.ts (+test)
   do not exist; no renderer console errors in the full E2E run.
8. en/tr bundles mirror (labels.test.ts green); no `.replace(`, no `disabled` in src/ui
   (check:boundaries green).
9. ADR-0001 / ADR-0004 / ADR-0012 carry dated addenda; tech-debt closes TD-020/034/040 and opens
   the unwindowed-list TD; ROADMAP ticked at closure.
10. CI green: typecheck (both), test, build, check:boundaries, test:ui (zero renderer console
    errors; shots strip-gated / chat-live / chat-compact / sade-tail / audit-transcript @980).

## Evidence required

- plan_approval: (mode: direct — waived, WO-0005 precedent; operator approved the HTML preview)
- pr_open: PR URL, head sha
- ci_green: all required checks `success`
- verification: reviewer report, `path:line` pointers resolve at head sha
- closure: merged, `ROADMAP.md` updated (commit sha)

## Stop-and-ask gates

- None open. The two design decisions were asked and answered 2026-08-22 (gate form; xterm removal).
  Anything unexpected stops the session and reports.

## Notes

- The data was always structured; xterm synthesized ANSI to paint it onto a canvas. The DOM
  transcript loses zero fidelity and gains markdown, theming, locale re-localization (TD-040) and
  E2E assertability.
- Role attribution does NOT touch the drive store: panes know their role (SessionPane state,
  StepPane's step, ReviewPane hardcodes architect; archived rows carry SessionRef.role).
- The base-mobile work (turn-state + live overlay) sits uncommitted in the tree by operator choice
  (2026-08-22); this order's commits must stay separable — the only shared file is e2e/ui.mjs.

## Supersession note (2026-08-22, same day)

The SADE activity tail (PhaseTail) and the 'sade' chat variant shipped with this order and were
approved in-app, then DIED hours later with WO-0038's radical ruling — SADE/DETAY itself was removed
(single view, ADR-0013). This order's surviving deliverables: the Ray chat column (ChatTranscript —
later extended with collapsible tool blocks after operator review), CodeBlock + rehype-highlight,
the guarded strip gate (ADR-0001 addendum), the pipeline's bottom-pin/jump contract, and the xterm
retirement. The tool-block aç/kapa and the open-command-wraps ruling are same-day operator reviews
recorded in the components.
