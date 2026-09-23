---
id: WO-0091
title: "The stall gate — a live drive that stops making progress is the operator's turn, not a running one"
workspace: docket
status: open
mode: direct # plan | direct (operator ruling 2026-09-22: the parallel wave runs direct)
review: full # light | full
review_mode: gates
tracks:
  - repo: app
    depends_on: []
---

# WO-0091 — the stall gate

## Objective

Docket distinguishes a dead drive from a live one (WO-0026 closed TD-031: crashed and
window-closed drives are reconciled to `idle`). It does not distinguish a live drive that is
**making progress** from one that is **stuck**. Both render as running, indefinitely.

A stuck drive is worse than a crashed one: the board says work is happening, so the operator waits.

## Context (measured 2026-09-22)

**The signal already exists; nothing consumes it.**
- `src/adapters/runner/index.ts` runs two throttled feeds with timestamps: `emitContext` (line ~624)
  pushes `context_usage` events carrying `usedTokens` and an ISO `at`, and `emitLimits` (~656) the
  rate-limit windows. Both already guard on `Date.now()` for throttling.
- A stall is therefore observable with what is already on the wire: token count not advancing AND no
  tool events, for N minutes.
- Nothing watches it. `git grep setTimeout` over `pipeline.ts` / `main.ts` finds one 400 ms state-save
  debounce and nothing else. TD-031's reconciliation covers the process being GONE, not the process
  being idle-but-alive.

**The observed case (2026-09-22, operator's screen):**
An `implementer` drive showed `1h 11m · ↓ 205 tokens`. One hour of wall clock for 205 tokens. Whether
it was truly wedged is not established — the point is that **the product could not tell the operator
either way**, and the card kept claiming progress.

**The precedent this mirrors.** The antreo repo grew an "agent budget gate" in its `CLAUDE.md` for
exactly this: an agent turn stops and reports when it exceeds a ceiling — more than 3 rounds in the
same compile-error family, 10+ files outside the order, a second `pumpAndSettle` hang. The stated
reason: *"tavansız turda 'ilerliyor' ile 'takıldı' ayırt edilemez."* Without a ceiling, progress and
paralysis look identical.

## Frozen decisions

- **The gate surfaces, it does not kill.** A stalled drive becomes the operator's turn with a reason;
  aborting stays the operator's act. Docket never silently terminates work.
- **Observed, not inferred from wall clock alone.** Long is not stuck: a build legitimately takes
  minutes. The signal is *no token movement AND no tool events*, not elapsed time by itself.
- **Absent is not zero** (WO-0053's rule): if the context feed is dead for a drive
  (`contextFeedLive = false`), the stall detector reports "cannot tell", never "stalled".

## Open design questions (settled in implementation, pinned by tests)

- **The threshold.** A single N-minute constant, or per-role (a verifier reading a diff is quieter
  than an implementer writing)? Lean: one constant to start, named and test-pinned, tuned once there
  is data.
- **Where the clock lives.** Pure core given `(lastProgressAt, now)`, adapter-fed — so it is testable
  without timers.
- **Interaction with WO-0089's gate lock.** A drive blocked WAITING on the host-wide gate lock is not
  stalled; it must be distinguishable, or the lock will generate false stalls.

## Scope

- `src/core/`: the pure stall derivation + its three-valued status (progressing / stalled /
  cannot-tell), and the board reason it produces.
- Adapter/composition: feed `lastProgressAt` from the events already emitted.
- UI: the card's reason line, in operator words (WO-0078).

## Non-goals

- Auto-aborting or auto-resuming.
- Per-tool timeouts inside the SDK.
- Cost ceilings — that is `budget.ts`, a different axis (money per month, not progress per drive).

## Acceptance

- [ ] A drive with no token movement and no tool events past the threshold renders as the operator's
      turn with a named reason.
- [ ] A drive that is slow but advancing never trips the gate (pinned by a test with a moving count).
- [ ] A drive whose context feed is dead reports cannot-tell, never stalled.
- [ ] A drive waiting on the gate lock (WO-0089) is not reported as stalled.
- [ ] The derivation is pure and timer-free in tests.
