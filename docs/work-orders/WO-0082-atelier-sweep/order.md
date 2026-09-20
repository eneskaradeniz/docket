---
id: WO-0082
title: "The atelier sweep — section-head actions, the 6/10px stragglers, the one stray glyph"
workspace: docket
status: open
mode: direct
review: light
review_mode: gates
tracks:
  - repo: app
    depends_on: ["WO-0080"]
---

# WO-0082 — the atelier sweep

## Objective

The operator's full-surface audit (38 pages, `e2e/audit-design-once.mjs`, 2026-09-20) and their
hand-found specimen: the detail's Değişiklikler Yenile chip hangs alone UNDER the section heading
(`ChangesSection` renders its own `flex justify-end` row) while the board's Depo section pairs it
with the heading on one row. The measured sweep also caught: a second `gap-3.5` the WO-0079 pass
missed (`WorkOrderDetail.tsx:1391`), the 6px stacks (`flex-col gap-1.5` between cards/rows) and
10px readouts (`mt-2.5`) that predate the ADR-0012 rhythm addendum, and one stray `▶` glyph on
the draft card's Sürdür (every other row-action speaks `▸`).

## The fix

- **P1** `DetailSection` gains `action?: ReactNode`; `RecordStack`'s h2 row renders it `ml-auto`.
  The Değişiklikler Yenile chip moves into that slot; `ChangesSection` drops its own header row
  (and the now-unneeded `onRefresh` prop).
- **P1** `WorkOrderDetail.tsx:1391` `gap-3.5` → `gap-3`.
- **P2** the 6px vertical stacks become 8px (`flex-col gap-1.5` / `space-y-1.5` between cards and
  rows); the 10px readouts become 8px (`mt-2.5` → `mt-2`: usage breakdown ×3, overview turn
  groups, draft card ×2). Horizontal gaps are untouched — the rule is a VERTICAL one.
- **P3** `driveResume`: `▶` → `▸` (tr + en).

## Non-goals (operator questions, unanswered → untouched)

- The 9.5px mono metas (the ⏎ badge is deliberately small; the step-row meta stays).
- The usage card's 13px inner inset and the chat column's indent.

## Verification

- Full mechanical pass + `npm run test:ui`.
- Atelier re-capture + re-audit: the Yenile finding reports on ZERO pages; the 14px and the
  between-card 6/10px gaps no longer appear.
