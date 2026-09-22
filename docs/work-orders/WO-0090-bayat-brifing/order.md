---
id: WO-0090
title: "The briefing resolves before it ships — stale context is caught at assembly, not discovered mid-drive"
workspace: docket
status: open
mode: plan # plan | direct
review: full # light | full
review_mode: gates
tracks:
  - repo: app
    depends_on: []
---

# WO-0090 — the briefing resolves before it ships

## Objective

Docket already owns the idea that a claim must point somewhere real: `extractPointers`
(`src/core/derive.ts:163`) pulls `path:line` references out of a body, and the verification gate
refuses to pass when they do not resolve (`derive.ts:82`, `types.ts:249`). That discipline runs at the
END of a work order, on the verifier's report.

The briefing runs at the START and is not checked at all. A stale briefing does not fail loudly — it
sends a session to rebuild a plan mid-drive, which is the most expensive place to discover it.

## Context (measured 2026-09-22)

**The asymmetry, in code:**
- `extractPointers(body: string): string[]` — pure, already written, already tested (WO-0069).
- `verifierReport?: { resolvablePointers: boolean }` (`types.ts:249`) → consumed by `deriveEvidence`
  (`derive.ts:82`) and `deriveStage` (`derive.ts:132`).
- Nothing applies either to the briefing. TD-003 records the adjacent gap ("briefing bundle selection
  is undesigned", open); this WO is about **validity**, not selection: whatever is selected, do its
  claims still hold at the sha the drive starts from?

**The empirical case (antreo wave, 2026-09-21/22):**
Work order #218 carried three claims that had rotted since it was written:
1. "Veri katmanı HAZIR — dokunma" — the repository never sent `lat/lng`, so the radius was dead and
   the card's distance was always null. The session discovered this mid-drive and re-planned.
2. "Ölü slider" — the slider had already been removed by a merged work order (#228).
3. Acceptance criterion 4 (the filter counter counts distance) — #228 had deliberately fixed the
   counter NOT to count it; implementing the criterion would have reverted merged work.
The drive took 1h 07m, a large part of it spent re-planning. Two more were caught by hand before the
next wave launched: #205's body said "api#212 (OPEN) — work does NOT start" while api#212 was closed,
and #213's DTO dartdoc justified dropping `sponsoredResults` by pointing at a popular-carousel
ownership that does not exist in the api repo.

The human countermeasure now lives in `antreo-app/wt/kickoff/ISEMRI-YAZIM.md`: every factual claim is
grep-verified and written with `dosya:satır` before the order ships. That is a person remembering.

## Frozen decisions

- **Pointers are the cheap 80%.** A claim written as `path:line` is mechanically checkable; prose
  ("X is ready") is not. This WO checks pointers and makes prose claims *cheaper to write as
  pointers*, it does not attempt natural-language verification.
- **Checked at the sha the drive starts from**, the same discipline the verification gate uses.
- **Unresolvable is not fatal, it is surfaced.** A briefing may legitimately reference a file the work
  will create. The gate is operator-facing: "these 3 pointers do not resolve" before the drive, not a
  hard block.

## Open design questions (settled in implementation, pinned by tests)

- **Where it runs:** briefing assembly (store adapter) vs a pure core check fed by the adapter.
  Lean: pure core (`resolvePointers(pointers, readFileAtSha)`) so it is test-first like `extractPointers`.
- **What counts as resolved:** file exists, or file exists AND the line number is within range?
  The verification gate's existing answer should be reused, not re-invented.
- **Surface:** a pre-drive panel, or a line on the dispatch card. Whatever it is, it speaks operator
  words (WO-0078) and names the pointers.

## Scope

- `src/core/`: the resolver + its status, reusing `extractPointers`.
- Adapter: read-at-sha for the drive's repo.
- UI: the pre-drive surfacing.

## Non-goals

- Verifying prose claims.
- Deciding WHICH documents enter the briefing (TD-003, separate).
- Blocking a drive automatically.

## Acceptance

- [ ] A briefing whose pointers all resolve at the start sha shows nothing new (no noise).
- [ ] A briefing with an unresolvable pointer names it before the drive starts, not after.
- [ ] The check runs at a named sha and says which one.
- [ ] A briefing with zero pointers is not reported as a failure (absent, not zero).

## Notes

This is invariant 1 applied one stage earlier. Evidence gates the exit of a stage; nothing today gates
the quality of what a stage is handed. The wave's own runbook had to grow a hand-written rule for it.
