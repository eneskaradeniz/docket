---
id: WO-0045
title: Operator tempo — steer the running drive + the Akış mode chip
workspace: docket
status: closed
mode: direct
review: light
review_mode: gates
tracks:
  - repo: app
    depends_on: []
---

# WO-0045 — Operator tempo — steer the running drive + the Akış mode chip

## Objective

Two faces of one thing — the operator sets the drive's tempo. **(1) Steering:** the operator can
talk to a **running** drive without killing it: a note submitted from the live instrument's header
is queued and injected **once, at the next turn boundary** — never mid-turn; an applied note renders
in the Ray transcript as an operator line; queued notes survive `Durdur` and are delivered on
`Sürdür`; a pending note can be retracted. Steering and stopping stay **orthogonal axes** — a note
never interrupts, `Durdur` remains the only interrupt ("plain text is not assignment").
**(2) The `Akış` chip (operator's 2026-08-25 conception):** a per-work-order mode word on the band —
`Akış: otomatik` (today's behavior: `gates` cadence auto-advances steps/reviews) or `Akış: manuel`
(**no drive starts itself**: a finished step yields a "sıradaki: Adım N [Başlat]" card; the review
leg starts on click too; the plan leg is already click-driven). "Onayım olmadan işlem yok" =
`Akış: manuel` + `İzin: hep sor`. The chip also carries the pending-steer count while notes queue.

## Context

- **Operator conception (2026-08-25, approved)**: single-line steering input under the live
  instrument + per-WO `Akış: otomatik/manuel` chip. Its mechanical assumption — "Enter = interrupt +
  mesaj + resume, yeni SDK yüzeyi yok" — was **disproven by the 2026-08-26 probe**: the SDK has a
  first-class surface that does this without interrupting (below). The interrupt+resume chain stays
  the documented fallback if the probe's shapes drift.
- **Measured SDK surface (probe 2026-08-26, installed `@anthropic-ai/claude-agent-sdk@0.3.221`
  `sdk.d.ts` — verified in the local install):** `Query.streamInput(AsyncIterable<SDKUserMessage>)`
  (`sdk.d.ts:2557`); `SDKUserMessage` carries optional `uuid` and `priority?: 'now' | 'next' | 'later'`
  (`:4605-4639`); `Query.interrupt()` resolves with `SDKControlInterruptResponse` whose `still_queued`
  lists queued messages that survive the interrupt (`:2293`, `:3499-3520`); `cancel_async_message`
  cancels an individual queued uuid (`:3023`). Docs: `code.claude.com/docs/en/agent-sdk/typescript`.
  Per TD-016 discipline: re-probe on any SDK bump.
- **External validation (two independently popular products, same converged model):**
  munder-difflin — `steer(text)` injects a bounded note queue (20/agent, latest-wins) once at the
  next hook boundary; `halt` is a separate primitive (`src/main/control.ts`, `src/main/hooks.ts`).
  Paperclip — a comment is an **interrupt** and/or an **ownership change**, "both, or neither"
  (`doc/execution-semantics.md` §Comment interrupts). Analyses live outside the repo
  (`~/source/inspiration/ANALYSIS-*.md`); the repos are the durable reference.
- `src/core/runner.ts` — `RunnerEvent` + `LiveSessionState` grow steer facts (queued/delivered/
  retracted; pending count folds test-first). The `SessionRunner` port grows an optional
  `steer(sessionId, note)` — the FakeRunner simulates the queue so pipeline semantics stay
  unit-tested.
- `src/core/pipeline.ts` — queue ownership: enqueue/retract while running; on stop the pending notes
  persist (the `stop_and_ask` precedent) and `Sürdür` delivers them (first queued note as the resume
  input; the rest re-queued). **Flow mode:** a per-WO `flow_mode` (like `review_mode` — stored,
  surfaced, editable via the pencil idiom); the auto-advance legs (step sequencing, review start)
  check it before spawning — enforcement lives in the pipeline beside `planApprovedFor`, never in a
  host. Audit kinds `steer_queued`/`steer_delivered`/`steer_retracted` + `flow_mode_changed` in
  `wo_event` (targets allowed, never env values — CLAUDE.md 2026-08-26).
- `src/adapters/runner/index.ts` — `streamInput` wiring: the query runs in streaming-input mode;
  a queued note is a uuid-stamped `SDKUserMessage`; delivery surfaces as the transcript's user turn.
- `src/ui/components/detail/DetailStrip.tsx` — the `Akış` chip beside the `Denetim` chip (mode word;
  pending-steer count while notes queue; pencil or chip-click to switch, the locked-cadence idiom).
- `src/ui/components/session/pane-chrome.tsx` + `DriveControls.tsx` — the steer composer on the live
  header (one-line input, ⏎ submits); `Durdur` unchanged. The "sıradaki: Adım N [Başlat]" card
  rides the ActionCard idiom (absent while any drive runs). Labels `tr.ts`/`en.ts`.
- ADR: an operator-tempo addendum (boundary-injection, orthogonality, mirror-is-truth, flow-mode
  pipeline enforcement) lands with the WO.

## Scope

In scope:

- Steer queue semantics in core (test-first): enqueue, pending count, once-only delivery, retract,
  stop-survival, resume delivery.
- Runner port `steer` + SDK adapter `streamInput` implementation + the real-drive probe.
- Steer composer on the live header; operator line in the transcript.
- Per-WO `flow_mode` (auto default, manuel) — pipeline-enforced; the `Akış` chip; the click-to-start
  next-step card; `flow_mode` in order.md front matter (the `review_mode` precedent).
- `wo_event` audit kinds; stopped-state persistence of pending notes.
- Labels (tr/en), E2E with the FakeRunner for chip/composer/retract/mode surfaces.

Out of scope:

- Context gauge / silence line / cost verification (WO-0046); budget gate (WO-0047).
- Mid-turn injection (`priority: 'now'`) — the queue is boundary-only in this order.
- Priority tiers in the UI (the SDK `priority` field is noted, not surfaced).
- Steering from the CLI host (the CLI `drive` stays one-shot).
- Re-running a stopped drive's step automatically in manuel mode (the card is the offer, the click
  is the consent — no auto-retry).

## Acceptance criteria

1. **Probe evidence** (real SDK, recorded as a script + raw log under this WO's dir or
   `docs/probes/`): a note pushed via `streamInput` mid-turn is consumed at the next turn boundary
   exactly once, appears in the stream as a user message, and `interrupt()` with a pending note
   returns a receipt consistent with `still_queued` semantics. Divergence from the shapes above →
   stop-and-ask, not adapt-around.
2. While a drive runs, the live header offers the steer composer; a submitted note does NOT appear
   mid-turn — the `Akış` chip's pending count is the only visible change until the boundary.
3. At the boundary the note applies once (no double application across mirror + SDK queue), renders
   as an operator line in the Ray transcript, and the count drops.
4. `Durdur` with pending notes: the drive stops, notes persist visibly; `Sürdür` delivers them;
   nothing is silently dropped.
5. A queued note can be retracted before delivery (chip → pending list → retract), via
   `cancel_async_message` while in-query and from the mirror when stopped.
6. Submitting a note never ends the current turn; no UI action both steers and interrupts in one
   step.
7. `Akış: otomatik` behaves exactly as today (auto step sequencing + review start; no regression —
   the existing E2E suite passes unchanged except for the chip's presence).
8. `Akış: manuel`: after a step's report, no new session starts by itself — the "sıradaki: Adım N
   [Başlat]" card appears; the review leg likewise waits for a click; switching modes mid-flow takes
   effect at the next boundary and is audited (`flow_mode_changed`).
9. Core queue + flow-mode semantics unit-tested (FakeRunner); E2E green for chip/composer/retract/
   mode surfaces; `npm run typecheck` (both), `npm test`, `npm run build`,
   `npm run check:boundaries` green.

## Evidence required

- plan_approval: n/a (`mode: direct`, `review: light` — solo; gates operator-covered)
- probe: the real-SDK steer probe log (AC 1) — the WO-0001 tradition for a new surface reliance
- operator_checkpoint: DEFERRED by operator ruling (2026-08-26, "şuan dockette yapabileceğim bir
  iş yok — devam edelim, sonra test ederim") — the real-drive pass (live steer on a base-mobile
  dogfood, the manuel boundary card → click, the card-seat ruling: currently the decision stack)
  runs as the operator's own post-merge test round; the shipped stand-ins: the 4 fake-runner E2E
  specs + the real-adapter smoke (started → steer_queued → steer_delivered → ONE turn_complete)
- ci: typecheck (both) / `npm test` / `check:boundaries` / `build` / `test:ui` green
- closure: ROADMAP ticked; ADR-0015 written; TD-049/050/051 recorded — merged #51 (`ece1bee`);
  CI green on the PR (`check` + GitGuardian); reviewer round pre-PR (12 findings — 4 major + 5
  notes fixed in scope, the rest live in the TD entries)

## Stop-and-ask gates

- The probe contradicts the documented `streamInput`/interrupt-receipt shapes (version drift) —
  report; the interrupt+resume fallback needs an operator ruling before substitution.
- The SDK's queued-note → next-turn auto-continuation semantics imply a drive extension the operator
  did not ask for (a note should not silently extend a step drive past its turn) — surface the
  behavioral choice for an operator ruling before shipping.
- Anything that would make steering a second permission channel (notes carrying instructions the
  fence should have gated) — stop and report.
- The manuel-mode card's exact seat (ActionCard vs the step row) — checkpoint ruling, not a spec
  constant.

## Notes

- The mirror-is-truth rule exists because the SDK queue dies with the CLI process: Docket's stop
  ends the query; the provider-side queue cannot carry notes across a stop→resume. The mirror
  (persisted, like `stop_and_ask`) is what `Sürdür` reads.
- Naming: "Akış" stays the surface word (operator's own term); internals say `steer` and
  `flow_mode`.
- **Probe outcome (2026-08-26, `docs/probes/cc-surface/` §S + `raw/s1..s7`):** the two GATED shapes measured TRUE
  (`streamInput` queueing; the `interrupt()` receipt `{still_queued:[uuid]}` — CLI 2.1.231 drifted from 2.1.220,
  capabilities unchanged). One assumption corrected: notes NEVER echo as user messages — delivery is detected from
  `command_lifecycle` uuid matches (`msg_lifecycle_v1`; steering honest-off without it). Measured additions the
  build carries: result arrives PER COMMAND (delta-accumulated drive cost), an immediate cancel can race the
  enqueue (`false` = the note WILL run — the row stays), abort kills the SDK queue (mirror-is-truth, evidenced
  s4b). No stop-and-ask gate fired.
- **Operator rulings (2026-08-26):** (1) the Akış chip locks ONLY on a closed WO — clickable while a drive runs,
  the mode is read at the next spawn; a mode flip never fires a start (the waiting card does not self-trigger on
  a flip to auto). (2) A boundary-queued note EXTENDS the same drive as its own turn — visibly (the operator line
  + the extra work in the döküm; intermediate results suppressed into one terminal event).
- **Operator checkpoint DEFERRED by operator ruling (2026-08-26, "şuan dockette yapabileceğim bir iş yok —
  devam edelim, sonra test ederim"):** the in-app real-drive pass (live steer on a base-mobile dogfood, the
  manuel boundary card→click, the card-seat ruling — currently the decision stack's ActionCard seat) runs
  post-merge as the operator's own test round. The fake-runner E2E (4 specs) + the real-adapter smoke
  (`started → steer_queued → steer_delivered → one turn_complete`) stand in as the shipped evidence.
- Explicit-prompt resumes re-queue the notes for the boundary after their turn (a D5 refinement made during
  implementation — notes never stall behind an ask answer).
- The `Akış: manuel` + `İzin: hep sor` pairing is the product answer to "onayım olmadan işlem yok" —
  the chip words must not drift from the permission rule's vocabulary.
