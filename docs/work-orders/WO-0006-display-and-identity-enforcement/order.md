---
id: WO-0006
title: ADR-0007/0003 live violations and detection gaps
workspace: docket
milestone: M1
status: draft
mode: plan
review: full
tracks:
  - repo: app
    depends_on: []
---

# WO-0006 — ADR-0007/0003 live violations and detection gaps

## İçindekiler

- [Objective](#objective)
- [Context](#context)
- [Mode and review weight](#mode-and-review-weight)
- [Scope](#scope)
- [Acceptance criteria](#acceptance-criteria)
- [Evidence required](#evidence-required)
- [Stop-and-ask gates](#stop-and-ask-gates)

## Objective

Close the three ADR violations WO-0005's verification found in WO-0002 code, and extend the boundary checks to
catch the shapes that slipped past them. Opened from WO-0005 verification (TD-014, TD-015).

## Context

- `docs/adr/ADR-0007-localisation-and-theming.md` — UI vocabulary vs domain data; no raw identifier as display
  text
- `docs/adr/ADR-0003-workspace-configuration-in-git.md` — branded identities constructed only in adapters
- `docs/adr/ADR-0006-layering-and-provider-independence.md` — `core` is pure; identities carried by branded
  types
- WO-0005 verification report (PR #2) — the findings below
- `scripts/check-boundaries.mjs` and `CLAUDE.md` — the checks to extend

## Mode and review weight

`mode: plan` and `review: full`. Item 1 is a design decision (is the work-order id in a Badge intended display
or a violation?), and the work touches `src/core/` (TD-014 #3), so the lighter weight does not apply
(ADR-0011: `review: full` for anything touching `src/core/`).

## Scope

**Live violations (TD-014).**

1. `src/ui/components/board/WorkOrderCard.tsx:22` and `src/ui/components/detail/Header.tsx:25` render a raw
   `WorkOrderId` inside a `<Badge>`. Decide: intended as display (→ refine ADR-0007 to permit it, routed
   through `labels.ts`), or a violation (→ stop rendering the raw id)? This is the primary case ADR-0007
   exists for; the decision is the plan's first output, not a silent fix.
2. `src/core/derive.ts:192` brands a `RepoId` with `'' as RepoId`. `core` must not construct an identity; take
   the typed value from data, or change the derivation so the cast disappears.

**Detection gaps (TD-015).** Extend `scripts/check-boundaries.mjs` (and `CLAUDE.md` where a rule is restated):

3. Ban `as (WorkspaceId|RepoId|WorkOrderId|TrackId)` casts outside `src/adapters/` (and tests) — the
   name-independent form of the identity rule, complementing the branded-constructor check.
4. Widen the Node-import check to all Node builtins and to any `node:` specifier, not just the four documented
   today.
5. Close the `disabled` false-negative on the spread form `{...{ disabled: true }}` (and `data-disabled`).

Out of scope: a general raw-identifier-rendered-as-text check beyond `.replace(` (the JSX `{id}` case is
covered by resolving item 1, not by a new grep); vendor-list extensibility.

## Acceptance criteria

1. The three live violations are resolved — fixed, or re-permitted by an ADR change that `CLAUDE.md` reflects.
2. Each extended detection check fails on a deliberate violation naming the rule and its ADR, demonstrated as
   in WO-0005 AC3.
3. CI is green; `npm run check:boundaries` clean on `main`.
4. No new check is a false-positive trap — WO-0005's stop-and-ask gate 1 carries over unchanged.

## Evidence required

- pr_open: PR URL, head sha
- ci_green: not exempt
- verification: verifier report, `path:line` at head sha
- closure: track merged, `ROADMAP.md` + `docs/tech-debt.md` updated (close TD-014, TD-015)

## Stop-and-ask gates

1. If an extended check cannot be expressed without false positives, report rather than widen it until it
   passes.
2. If the id-in-Badge decision needs an ADR change, that is the plan's first output, not a silent
   re-interpretation of ADR-0007.
