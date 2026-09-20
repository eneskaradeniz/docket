---
id: WO-0078
title: "Degraded faces speak operator words — adapter diagnostics never render raw"
workspace: docket
status: open
mode: direct
review: light
review_mode: gates
tracks:
  - repo: app
    depends_on: []
---

# WO-0078 — degraded faces speak operator words

## Objective

Operator review of the design atelier (OpenDesign capture, 2026-09-20): the board's DEPO card and
every detail's DEĞİŞİKLİKLER section render the adapter's raw diagnostic verbatim —
`unparseable remote (expected https://github.com/{owner}/{repo})` (English, developer jargon,
`src/adapters/forge/github.ts:74`) and git's `fatal: not a git repository …` stderr. Two contract
violations in one face: ADR-0007 (UI copy is Turkish by default) and ADR-0012 (no jargon; human
words). The old intent — "a degraded scan's reason speaks verbatim as its own line" — was an
honesty rule pointed at the wrong layer: the RECORD keeps the verbatim reason (Records & PRs:
evidence may name targets), but the SURFACE speaks operator words.

## The fix

- `src/core/humanize.ts` (test-first, pure): `degradedKind(reason)` classifies the common shapes —
  `unparseable-remote` / `not-git` / `tool-missing` / `unknown`.
- `src/ui/components/DegradedLine.tsx`: one shared degraded face — the kind picks the line from the
  locale bundles; the raw reason rides the kit Tooltip as the hint (ADR-0012: tooltips carry
  reasons). The face keeps its mono-dim form; degraded stays distinct from failure in WORDS
  («görüşemedik» ≠ «baktı ve başarısız oldu» — the forge.ts shaping ruling, now in operator language).
- `ForgeSection` + `ChangesSection` render the shared face instead of the raw string.
- `newWorkOrder` label drops the stray `▸` (a play-marker inside a solid primary button reads as a
  defect — atelier finding); the card CTAs' `▸` row-marker idiom stays.

## Non-goals

- No adapter/store changes — reasons stay verbatim in the observation rows and events.
- No color redesign of the degraded face (words only; tone belongs to the polish pass, WO-0079).

## Verification

- `humanize.test.ts` (new, red→green) pins the classifier shapes.
- `npm run typecheck && npm test && npm run check:boundaries`.
- `npm run test:ui` — no spec asserts the raw strings (checked), suite must stay green.
- Atelier re-capture: the leak scan in `e2e/inspect-design.mjs` reports zero raw-diagnostic nodes.
