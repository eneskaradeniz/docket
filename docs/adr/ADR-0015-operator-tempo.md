# ADR-0015: Operator tempo — boundary steering and the flow mode

Date: 2026-08-26 · Status: accepted · Extends: ADR-0002 (roles), ADR-0013 (the single view's live
grammar), ADR-0014 (one adapter over a machine-readable mode).

## Context

The operator drives every role solo (the pipeline's standing shape). Until WO-0045 the only tempo
control was `Durdur` — an interrupt. Watching a running drive head somewhere wrong meant killing it;
letting it run meant ceding the cadence. The 2026-08-25 operator conception asked for the two
faces WO-0045 shipped: talk to a running drive without killing it, and a per-work-order mode word
for whether anything starts itself.

Two independently popular products converged on the same model (analyses in
`~/source/inspiration/ANALYSIS-*.md`, repos the durable reference): munder-difflin's `steer(text)`
— a bounded note queue injected once at the next hook boundary, `halt` a separate primitive;
Paperclip's comment semantics — an interrupt and/or an ownership change, "both, or neither,"
"plain text is not assignment." Docket takes the same split: steering and stopping are orthogonal
axes.

The SDK surface was measured before reliance (WO-0001's probe tradition; `docs/probes/cc-surface/`
§S, `raw/s1..s7`): streaming-input mode queueing, the `interrupt()` receipt, `cancel_async_message`,
and the delivery boundary. Every claim below that cites an `sN` log is measured on CLI 2.1.231 /
SDK 0.3.221.

## Decision

**1. A steer note is injected ONCE, at the next agent-turn boundary — never mid-turn.** The
adapter runs every drive in streaming-input mode (a push-side `AsyncIterable<SDKUserMessage>`
prompt; the iterable ITSELF is passed — a bare iterator kills the child, `raw/s1-baseline.log`
first run). A note is a uuid-stamped message pushed into that channel; the SDK queues it and runs
it at the boundary — merged into the ongoing command's next slot mid-turn (`raw/s2-midturn-note.log`)
or as a new turn on an idle query (`raw/s2b-late-note.log`), coalescing batched notes into one
turn (`raw/s3-two-notes.log`). `priority`-style mid-turn injection is deliberately NOT surfaced.

**2. Steering ⊥ stopping.** No UI action both steers and interrupts. A queued note never ends the
current turn; `Durdur` (the adapter's abort, not the SDK's `interrupt()` — see 5) stays the only
interrupt. The composer sits under the live pane's header (`PaneSteerBar`, one grammar for the
three surfaces, ADR-0013's `pane-chrome`); `DriveControls` is untouched.

**3. Extension IS the delivery mechanism (operator ruling 2026-08-26).** A queued note runs as its
own work inside the SAME drive: the adapter suppresses intermediate per-command results and emits
ONE terminal `turn_complete` per drive carrying the delta-accumulated cost (whether
`total_cost_usd` is cumulative or resets per command is ambiguous across the s-logs; deltas —
`≥ prior → difference, < prior → the figure` — are correct under both). The extension is visible,
never silent: the OPERATOR transcript line, the extra work in the döküm, one report. Delivery is
DETECTED from `command_lifecycle` uuid matches (capability `msg_lifecycle_v1`), because notes
never echo as user messages (every s-log; the only user-text in a stream is the interrupt's
synthetic notice, uuid not ours — skipped). Steering stays honest-off on a CLI without the
capability.

**4. The Docket mirror is the truth across a stop.** The SDK queue dies with the CLI process:
`abort()` with a queued note never runs it (`raw/s4b-abort-pending.log`), while `interrupt()`
— which Docket does NOT use for Durdur — leaves the queue running by design
(`raw/s4-interrupt-receipt.log`). So the pipeline owns the mirror: the drive closure's pending
list, persisted on the session row (`pending_notes`, LATEST-WINS unlike the monotonic
transcript/cost — deliveries shrink it; a record from a notes-blind path KEEPS the prior notes).
`Sürdür` delivers: the first queued note rides the PROMPT channel as `deliveringNote` (it never
enters the SDK queue — no double application; the runner emits the matching synthetic
`steer_delivered` after `started`), the rest re-queue silently (`emit:false`). A resume carrying
its own prompt (an ask answer) keeps the prompt and re-queues the notes for the boundary after
its turn. Known edge: a crash between spawn and the first record re-delivers the first note on
the next Sürdür — honest, recorded (TD-049).

**5. Retract is best-effort, with a receipt.** `cancel_async_message` exists at runtime but not in
`sdk.d.ts` 0.3.221 (declaration-augmented; TD-016 re-verifies on bump). An IMMEDIATE cancel can
race the enqueue and return `false` (`raw/s5-cancel.log`); a settled cancel returns `true` and the
note never runs (`raw/s5b-cancel-delayed.log`). `false` means the note WILL run — the pending row
stays until delivery. A stopped drive's notes retract through the data port (the row IS the queue
then): `retractSteerNote` rewrites the row and audits.

**6. Flow mode is per-work-order and PIPELINE-enforced.** `flow_mode` lives in order.md
front-matter (the `review_mode` precedent; silence IS auto — the key is emitted/kept only when
manual). In `manual`, no drive starts itself: the pipeline refuses any `origin:'auto'`
step/review spawn before the runner spawns (the `planApprovedFor` refusal shape) — the UI's
gated effects (verdict auto-advance, the panes' mount auto-drives) are the first line, the gate
the regression net for any host. The surface is the `Akış` chip beside `Denetim`, carrying the
pending-steer count while notes queue.

**7. Two operator rulings pin the chip's semantics (2026-08-26).** (a) The chip locks ONLY on a
closed work order — it is clickable WHILE a drive runs, because the mode is read at spawn time:
switching never touches the running drive, it takes effect at the next boundary. (b) A mode flip
never triggers a start: no auto-advance effect carries the mode as a dependency, and the waiting
card does not fire itself when flipped to auto — the click is the only card-triggered start
(the remount-in-auto corner is recorded as TD-050). The manuel card ("sıradaki: Adım N /
Denetim N [Başlat]") rides the decision stack's ActionCard seat; an `active` step yields no card
(its Sürdür lives in DriveControls), and the card outranks the all-done close card —
`allStepsDone` ignores verdicts, so the LAST review leg still needs the click.

**8. The audit carries targets, never secrets.** `steer_queued`/`steer_delivered` detail is a
bounded prefix of the operator's own words; `flow_mode_changed` carries the mode value
(CLAUDE.md's 2026-08-26 Records rule).

## Consequences

- `RunnerEvent` grows `steer_queued`/`steer_delivered`/`steer_retracted`; the fold counts queued
  notes (no transcript line until delivery — the chip's count is the only mid-turn visible
  change) and appends the `operator` transcript speaker on delivery (first-class session content,
  never a live-only `note`).
- The `SessionRunner` port grows OPTIONAL `steer`/`retractSteer` — optional-implementers (the
  CLI's one-shot drive) simply never support steering.
- A queued note's authority equals every operator-composed prompt (objection, reply): it does not
  bypass the fence — tool calls still fence under the drive's rule. Steering is not a second
  permission channel.
- "Akış: manuel + İzin: hep sor" is the product answer to "onayım olmadan işlem yok" — the chip's
  words must not drift from the permission rule's vocabulary.
