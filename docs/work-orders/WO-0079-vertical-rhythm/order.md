---
id: WO-0079
title: "The 4px vertical rhythm + the dispatch card's one right anchor"
workspace: docket
status: open
mode: direct
review: light
review_mode: gates
tracks:
  - repo: app
    depends_on: ["WO-0078"]
---

# WO-0079 — the 4px vertical rhythm + the dispatch card's one right anchor

## Objective

The atelier's measured rhythm audit (`e2e/inspect-design.mjs`, 2026-09-20): vertical gaps mix
2/6/8/10/12/14 across surfaces — the detail flow's sections sit 14px apart (`gap-3.5`), the board
clusters at 2px. (The audit's first read also flagged the usage screen at 10px — that turned out
to be its HORIZONTAL baseline gaps miscounted as vertical by the probe's rowGap read; the true
vertical offenders are the detail flow's.) Half-steps are legal Tailwind but there is no RULE, so
every surface drifts. And the dispatch card hangs its cost·duration meta off row 1's right while
the CTA hangs off row 3's right — two floating right anchors, the atelier's "asılı" finding.

## The fix

- **The rule (ADR-0012 addendum + CLAUDE.md):** vertical rhythm is the 4px grid — gaps are
  4/8/12/16; 2px only inside chip/icon pairs; 10/14 do not appear as vertical gaps.
- **The offenders:** `DetailSections` section stack `gap-3.5` → `gap-3`; card paddings and
  horizontal gaps are untouched (the rule is a VERTICAL one).
- **The dispatch card:** cost·duration moves DOWN beside the CTA — row 3 becomes
  reason … meta · ▸ action (one right anchor); row 1 is id + stage badge only. The WO-0031f T3
  contract survives verbatim (Süre still rides beside the cost; text asserts are position-free).

## Non-goals

- No horizontal spacing changes; no color/tone work (the degraded face's tone rides WO-0078's
  words-only scope).

## Verification

- `npm run typecheck && npm test && npm run check:boundaries && npm run test:ui`.
- Atelier re-capture + measure: the three flagged surfaces report on-grid vertical gaps.
