---
id: WO-0086
title: "The surface review — the board is work-only, Depo moves to the overview, PR folds, scan skeleton"
workspace: docket
status: open
mode: direct
review: light
review_mode: gates
tracks:
  - repo: app
    depends_on: ["WO-0084"]
---

# WO-0086 — the surface review

## Objective

Operator's live-use review (2026-09-21, real antreo-app workspaces): (a) the all-done platform
line carries its own create button beside the appbar's ever-present global CTA — two owners, one
action; (b) the Depo section POPS IN after the first forge scan lands (no skeleton — the board
jumps); (c) a repo's open-PR list renders UNBOUNDED — fifty open PRs would bury the work orders;
(d) the information architecture itself: the BOARD carries environment facts (repo connections,
PRs) that belong on the facts screen. Four decisions taken in discussion; the designs are shown
in the atelier FIRST (the operator's flow: gör → beğen → koda geç), code follows approval.

## The four decisions

1. **All-done line loses its button** — the platform line is the sentence alone; creation's single
   owner is the appbar's global `＋ Yeni iş emri` (one owner per action, ADR-0012's discipline).
2. **Depo scan skeleton** — while the first look is in flight the section holds its place in the
   app's own grammar: `loadline` «Depo taranıyor…» + one animated `.hairline-progress`. No pop-in.
3. **PR folds** — per repo the newest 3 PRs render; the rest live behind `▸ N açık PR daha`
   (the done-fold grammar — no pagination chrome, one scroll preserved).
4. **Depo moves to the OVERVIEW** — connections, PR list (folded) and the son-gözlem stamps are
   facts; the facts screen is their home (the health move's own principle). The board keeps at
   most ONE dim summary line (`N depo bağlı · M açık PR → Genel bakış`); the detail screen's
   Kaynaklar keeps the evidence links, so nothing is lost.

## Non-goals

- No forge/scan behavior changes — the observation cadence and records stand.
- Roadmap and Usage surfaces are untouched (the review found them correctly placed).

## Verification

- Atelier preview `surface-review.html` approved by the operator BEFORE implementation.
- Mechanical pass + `npm run test:ui` (the forge/health spec pins updated to the new homes).
- Atelier full re-capture: the board carries no Depo section; the overview carries Depo (folded
  PRs); the all-done platform line carries no button; a fresh boot shows the scan skeleton.
