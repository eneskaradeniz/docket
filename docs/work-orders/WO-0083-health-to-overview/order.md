---
id: WO-0083
title: "Health moves to the overview — collapsed when healthy, speaking when degraded"
workspace: docket
status: open
mode: direct
review: light
review_mode: gates
tracks:
  - repo: app
    depends_on: ["WO-0082"]
---

# WO-0083 — health moves to the overview

## Objective

Operator review (2026-09-21): the board's health strip (`Sağlık ✓ git 2.55.0 ✓ forge ✓ agent`) is
disliked four ways — it spends a whole row on an always-green state (noise); `forge` is Docket's
internal port name and `agent` collides with the role words (ADR-0012 jargon); git's version is
support detail, not an operator fact; and a degraded check still spoke raw stderr — the last
surface WO-0078's humanization missed. The placement ruling (AskUserQuestion, 2026-09-21):
**the strip moves to the Overview**, made presentable, and per the operator's mid-review word —
«gerekiğinde göstermeli, gizle/göster gibi» — it must collapse when healthy and speak when not.

## The fix

- `HealthSection` (replaces `HealthSection.tsx`'s strip twin): the overview section grammar —
  head row = Sağlık + summary (`3/3 hazır` | `1 sorun`) + the ▾/▸ toggle; healthy tools collapse
  behind it; a degraded tool OPENS the section (auto) and its line never hides. Tool words:
  Git · Bağlantı · Sağlayıcı (labels); version + raw reason live in tooltips.
- `OverviewScreen` gains the optional `health` prop; the section renders when the surface has
  content — the pure-empty face stays the ONE invitation line unless a tool is degraded
  (must-speak beats the empty grammar).
- The board drops the strip (mount + prop). The empty face's create door (App's `healthCreateWaits`
  gate) keeps its health look — untouched.
- ADR-0010 dated addendum: «first-class visible» becomes «first-class on the facts screen —
  collapsed when healthy, speaking when degraded; the board carries only the create door».

## Verification

- Mechanical pass + `npm run test:ui` (no spec bound the strip — checked).
- Atelier re-capture: the board shows no health row; the overview carries the collapsed section;
  the degraded face is only observable in a broken-tool world (unit of the classifier already
  pinned; the line reuses WO-0078's map).
