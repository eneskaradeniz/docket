---
id: WO-0041
title: Delete copy in user terms + the detail's entrance cascade
workspace: docket
status: closed
mode: direct
review: light
review_mode: gates
tracks:
  - repo: app
    depends_on: []
---

# WO-0041 — Delete copy in user terms + the detail's entrance cascade

## Objective

Two surface-polish items, both operator-raised 2026-08-24:

1. The delete confirmations name raw files — "…order.md, plan.md, raporlar ve tüm oturum
   kayıtları…" (`deleteWoHint`, `wsDeleteHint`). Rewritten in the vocabulary the operator already
   sees: **iş emri dokümanı / plan / raporlar / oturum kayıtları** ("the work order document, the
   plan, reports and all session records"), tr/en parallel, same severity and length.
2. The detail screen mounts motionless while the board's cards glide in (WO-0031f H-3). The
   detail now enters as a **banded cascade**: the DOSYA's bands glide in reading order — strip →
   decision → instrument → steps → records — the board's own `.glide`, 300ms each, 30ms stagger.
   A **CLOSED** work order opens calm (no cascade).

## Context

- docs/adr/ADR-0012 — the juice contract. r7 (WO-0031f): "entrance glides are the named exception
  to never-on-mount — a surface ENTERING VIEW glides in ONCE, ≤400ms, translate+fade only,
  siblings staggered ≤40ms". r1: "reopening a finished thing is calm" — the CLOSED branch's basis.
- src/index.css:211-223 — `.glide` (0.3s ease-out, translateY(6px)+fade, `both`); already named in
  the one reduced-motion block (:~783), so reuse carries the kill for free.
- src/ui/components/board/Board.tsx:67-72 — the board's stagger precedent (first batch, 30ms/index).
- src/ui/components/detail/WorkOrderDetail.tsx:1115-1136 — the mount site: DetailStrip, then the
  one DOSYA scroll (`decision`, `instrument`, `spine`, `RecordStack`). `phase.kind === 'done'` is
  already in scope (:1116).
- src/ui/data/labels/tr.ts:494,786-788 / en.ts:441,661-663 — the two hints. The n=0 branch of
  `wsDeleteHint` names no file and stays untouched.

## Decisions

- **Naming**: the operator picked the explicit form ("iş emri dokümanı" — preview-approved) over
  the shorter possessive ("belgesi, planı…"); recognition over recall, matching the Belgeler
  rows' own labels.
- **Cascade over whole-surface glide** (design spec by the ui-ux-designer agent): the board's
  signature is staggered siblings, not one block; the bands are ADR-0013's own, so the DOSYA
  unrolls in reading order. `.glide` reused verbatim — no new keyframe, class, or reduce-block
  entry (ADR-0012 r3 holds by construction).
- **CLOSED opens calm**: r1 + the repo's own framing ("a record, not a document", DetailStrip:80);
  the closed board card is already calm. Gate: `phase.kind === 'done'` → no class.
- **Wrappers unkeyed on purpose**: `reloadDetail` re-renders (approvals, drive ends) must never
  restart the entrance — re-renders stay motionless.
- **Back-navigation unchanged**: the board remounts and re-glides (today's behavior, contract-clean
  — each direction glides exactly once).

## Scope

In scope: `deleteWoHint` + `wsDeleteHint` n>0 branch (tr/en); `WorkOrderDetail.tsx` entrance
wrapper helper + five fixed role slots. Out of scope: `closeNotePlaceholder` (names the real
artifact the operator can open), `orderDoc`/`planDoc` (file rows — the file name IS the data), any
exit animation, any new CSS.

## Acceptance criteria

1. Both delete dialogs (WO delete; workspace delete with n>0 and n=0) show the new copy in tr and
   en; locale switch follows.
2. Opening a non-closed WO plays the cascade once (strip 0ms → decision 30ms → instrument 60ms →
   steps 90ms → records 120ms, each 300ms); a null band skips its slot silently.
3. A CLOSED WO opens with no animation.
4. `reloadDetail`-triggered re-renders (plan approval, permission decision, drive end) do not
   replay the cascade.
5. `prefers-reduced-motion` kills the entrance (`.glide` already in the one block).
6. `npm run typecheck` (both), `npm test`, `npm run build`, `npm run check:boundaries` green.

## Evidence required

- plan_approval: n/a (`mode: direct`, `review: light` — solo; gates operator-covered)
- operator_checkpoint: app presented live (seeded temp DB) + `docs/ui-shots/wo0041-*.png` —
  cascade mid-flight opacities `[0.56, 0.43, 0.14, 0.00]` → settled all `1`, CLOSED `.glide`
  count 0 at +110ms; operator approved 2026-08-24 ("tamam olmuş eline sağlık. onaylıyorum")
- ci: typecheck (both) / `npm test` 540/540 / `check:boundaries` / `build` / `test:ui` all specs
  green post-approval. The first `test:ui` run's 3 reds were the WS-depo guard-tooltip flake +
  its modal domino — proven diff-independent (clean main and this branch each reran green) → TD-048
- review: reviewer agent on the PR #47 diff — no blocking findings (4 notes, all no-action)
- closure: ROADMAP ticked + TD-048 — merged #47 (`1af3983`)

## Notes

- Design spec produced by the ui-ux-designer agent (2026-08-24), grounded on the live structure;
  the operator preview-approved the copy variant and the calm-closed rule before implementation.
- No test changes: e2e/tests assert neither the old copy nor `.glide` (checked 2026-08-24).
