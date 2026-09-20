---
id: WO-0080
title: "Overview's ready list adds only names the turn groups did not surface"
workspace: docket
status: open
mode: direct
review: light
review_mode: gates
tracks:
  - repo: app
    depends_on: ["WO-0079"]
---

# WO-0080 — overview's ready list adds only new names

## Objective

Atelier review (2026-09-20): the overview's BAŞLAMAYA HAZIR section re-lists work orders the Sıra
groups already showed one screenful above — on the seeded world all three ready rows are repeats,
so the projection reads emptier than the board it summarizes. ADR-0012's anti-redundancy and the
screen's own reading (a projection, not a second board) rule: a work order already surfaced in a
turn group does not list twice.

## The fix

- `deriveOverview` (core, test-first): the ready candidate rule gains one filter — a WO whose id
  landed in any turn group is dropped from `ready.wos`. Tasks are untouched (they have no turn
  presence). TD-008's no-stage-column stance is respected — no new row content, one fewer repeat.

## Verification

- `overview.test.ts` gains the dedupe pin (a turn-listed WO is absent from ready; an unlisted one
  stays; tasks unaffected).
- Full mechanical pass + `npm run test:ui` (the WO-0072 spec pins 'Genel hazır görev' via tasks —
  the section exists without the repeated WO rows).
- Atelier re-capture: the overview page shows no repeated names across sections.
