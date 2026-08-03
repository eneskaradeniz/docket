---
id: WO-0003
title: Visual hierarchy pass on board and detail
workspace: docket
milestone: M1
status: draft
mode: plan
tracks:
  - repo: app
    depends_on: []
---

# WO-0003 — Visual hierarchy pass on board and detail

## Objective

The WO-0002 prototype is structurally correct and visually flat. Every element carries the same weight, so
the screen does not answer "what needs me most" at a glance — which is the one thing the board exists to do.

This work order changes presentation only. No type, derivation, gate or test in `src/core/` changes. If a
change here requires touching `src/core/`, that is a signal the change is out of scope.

## Context

- `docs/adr/ADR-0005-ui-information-architecture.md` — the decisions this refines, none of which are reopened
- `docs/adr/ADR-0007-localisation-and-theming.md` — semantic tokens; do not introduce literal colours
- WO-0002 acceptance criteria 1-13 remain in force

## Mode

`plan`. Visual hierarchy is a set of judgement calls that should be argued before they are built.

## Findings from the architect's review of the WO-0002 screenshots

These are the input, not an exhaustive list. Findings 1, 2 and 6 are the substance; the rest are symptoms.

**Board**

1. **Nothing is dominant.** A session stopped and asking looks identical to a work order whose docs are not
   updated. Urgency has no visual expression. The reason line — the most useful text on the card — is set at
   the same weight as everything else.
2. **Colour decorates instead of encoding.** Every work-order id badge is amber, which communicates nothing.
   Colour should carry state and nothing else; if a card is not urgent it should be quiet.
3. **Empty columns consume two thirds of the screen.** Three equal columns with "No work orders" twice. A
   column with nothing in it should shrink, not hold its width.
4. **Cost on every card is noise during a scan.** Per-work-order cost belongs in the detail view. Whether the
   board keeps an aggregate is a judgement call to make in the plan.
5. **`1 track(s)`.** Pluralise, or omit when there is one track. Programmer output leaking into the UI.
6. **The word "Docket" appears three times above the fold** — window title, workspace pill, and the
   "Docket · 4 work orders" line. Chrome is repeating itself instead of informing.

**Detail**

7. **The stage rail is the strongest element on the screen and should stay as it is.** `needs plan approval`
   under a locked stage does exactly its job. Preserve it.
8. **The evidence panel says "missing" under every unsatisfied row.** The empty checkbox already says that.
   Redundancy at the exact place the eye should scan fastest. Exempt rows must remain visually distinct from
   both satisfied and unsatisfied — three states, three appearances (ADR-0001).
9. **`order.md` and `plan.md` render as two large equal-weight cards** holding one line of text each,
   dominating the lower half. Owned documents are reference material: secondary, collapsible, or scrollable
   within a bounded region.
10. **Evidence and Tracks sit side by side at very different heights**, leaving a large empty area.
11. **Evidence rows do not say which track they belong to** (`EvidencePanel.tsx:22`). The model carries
    `scope: TrackId`; the UI prints a constant `· track`. In a multi-track work order two `PR open · track`
    rows are indistinguishable. The data is already there; only the rendering discards it. Group or label
    evidence by track.
12. **The primary action band reads like an error banner.** "No action available" as a full-width notice near
    the top puts the most negative message in the most prominent position. An absent action still needs to be
    stated, but stating it is not the same as leading with it.

## Scope

In scope: layout, spacing, typography, colour semantics, component density, empty states, pluralisation and
copy in `src/ui/`.

Out of scope: `src/core/`, `src/adapters/`, new screens, new data, workspace management (WO-0004), locale and
theme switching (M3.5), any change to the six fixture states.

## Acceptance criteria

1. On the board, a work order needing immediate attention is distinguishable from one that does not without
   reading any text.
2. Colour encodes state only. No decorative colour. Every colour used maps to a documented meaning.
3. Empty columns do not occupy the same width as populated ones.
4. Evidence rows show three visually distinct states — satisfied, unsatisfied, exempt — and no row repeats in
   words what its own marker already says.
5. Owned documents (`order.md`, `plan.md`) are present but visually secondary to the rail, evidence and
   action.
6. No English plural or grammar artifact reaches the screen (`1 track(s)`).
7. Chrome names the workspace once.
8. In a multi-track work order, every scoped evidence row identifies its track.
9. WO-0002 acceptance criteria 1-13 still hold; `npm test` unchanged and green; no file under `src/core/` or
   `src/adapters/` is modified.
10. Before-and-after screenshots of all six states.
11. `scripts/shot.mjs` runs on a machine other than the one it was written on: no hardcoded browser path,
    no assumption about which address Vite binds (TD-011). The architect ruled that the capture recipe is
    the durable evidence; that ruling is only true if the recipe is portable.

## Evidence required

- plan_approval: architect verdict, `plan.md` committed
- pr_open: PR URL, head sha
- ci_green: exempt unless CI has landed by then
- verification: verifier report; before/after screenshots; a diff confirming `src/core/` and `src/adapters/`
  are untouched
- closure: track merged, `ROADMAP.md` M1 updated, `docs/tech-debt.md` reviewed

## Stop-and-ask gates

1. **If a finding cannot be addressed without changing `src/core/`.** Stop and report. That would mean the
   information architecture is wrong, not the styling, and that is an ADR-0005 question.
2. **Before introducing any colour not already in the semantic token set.** New colour means new meaning, and
   new meaning is an architect decision.
