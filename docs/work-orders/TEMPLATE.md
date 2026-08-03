---
id: WO-0000
title:
workspace: docket
status: draft # draft | planning | plan-review | implementing | review | audit | merging | closing | closed
mode: plan # plan | direct
tracks:
  - repo: app
    depends_on: []
---

# WO-0000 — <title>

## Objective

One paragraph. What changes and why. If this cannot be written in one paragraph, it is more than one work
order.

## Context

Links into the decision store: ADRs this depends on, contracts it touches, tech debt it pays or creates.
Paths only — the text lives in git, not here.

## Scope

In scope:

-

Out of scope:

-

## Acceptance criteria

Numbered, each one checkable by someone who did not do the work.

1.

## Evidence required

What must exist before this work order can pass each gate. Beyond the standard gates, list anything specific
to this order.

- plan_approval: architect verdict, `plan.md` committed
- pr_open: PR URL, head sha
- ci_green: all required checks `success`
- verification: verifier report, all `path:line` pointers resolve at head sha
- closure: all tracks merged, `ROADMAP.md` + `docs/tech-debt.md` updated (commit sha)

## Stop-and-ask gates

Points where the implementer must stop and report rather than decide alone.

-

## Notes

