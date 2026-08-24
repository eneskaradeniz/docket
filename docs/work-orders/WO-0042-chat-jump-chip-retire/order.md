---
id: WO-0042
title: The live transcript's ▾ chip retires when content fits again
workspace: docket
status: open
mode: direct
review: light
review_mode: gates
tracks:
  - repo: app
    depends_on: []
---

# WO-0042 — The live transcript's ▾ chip retires when content fits again

## Objective

Operator bug report (2026-08-25): in the live session transcript, scrolling up shows the ▾
jump-to-bottom chip (correct); collapsing an expanded tool block ("Dosya oku" with a long output)
shrinks the column back under its cap — everything visible again — yet the chip stayed. The chip's
reason is gone; it must retire.

## Context

- `src/ui/components/session/ChatTranscript.tsx` — `showJump` was re-evaluated ONLY in `onScroll`
  and `jump()`. A tool block's open/close is `ToolPair`-local state; `ChatLog` never re-rendered on
  collapse. The browser fires a scroll event only when it CLAMPS `scrollTop` — a reader near the
  top (the exact "üstlere doğru çıkınca" case) holds a valid `scrollTop`, so the collapse fired
  **0 scroll events** and the chip state went stale. Repro (2026-08-25, e2e harness): collapsed
  geometry 218/218 — fully visible — chip still up.
- The fix follows the GEOMETRY, not a child's event: one content wrapper (`.chat-col`) carries a
  ResizeObserver. On shrink-to-fit while unpinned → the bottom-pin re-arms and the chip hides.
  Growth needs no case: pinned readers ride the pin effect, unpinned ones already have the chip
  up. The `archived` variant takes no observer (not scrollable).
- The wrapper's SIZE is what the observer needs — the scroller's box is capped by max-height and
  stops tracking content once content exceeds it.
- `src/index.css` — the measure rule `.chat > *` moved to `.chat-col > *` (the wrapper now stands
  between the scroller and the lines; the 562px measure knob stays functional).

## Acceptance criteria

1. Expanding a long-output tool block and scrolling up still shows the chip (unchanged behavior).
2. Collapsing it back under the cap hides the chip when the transcript is fully visible, and
   re-arms the bottom-pin (later appends ride along).
3. A collapse that leaves real overflow below the reading position keeps the chip.
4. `archived` cards render identically (no observer; same layout through the wrapper).
5. `npm run typecheck` (both), `npm test`, `npm run build`, `npm run check:boundaries`, E2E specs
   green.

## Evidence required

- plan_approval: n/a (`mode: direct`, `review: light` — solo; gates operator-covered)
- operator_checkpoint: root cause reproduced live through the e2e harness (0 scroll events on
  collapse; chip floating over a fully-visible 218/218 column), fix re-run clean; operator
  verified in the app and approved 2026-08-25 ("tamam düzeldi pr aç commit at ci yeşilse merge
  et") — `docs/ui-shots/chat-collapse-retired@980.png`
- ci: typecheck (both) / `npm test` 540/540 / `check:boundaries` / `build` / `test:ui` all specs
  green post-approval
- review: reviewer agent on the PR diff — no blocking findings
- closure: ROADMAP ticked; no new tech debt — merged #NN (`sha`)

## Notes

- The full-suite `test:ui` run regenerates every checked-in shot (seed timestamps ride the UI);
  only the shots this change legitimately alters are committed (`chat-collapse-retired` new,
  `chat-live` — its content now carries the spec's Read pair).
