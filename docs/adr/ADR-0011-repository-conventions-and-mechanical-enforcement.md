# ADR-0011 — Repository conventions and mechanical enforcement

- Status: accepted
- Date: 2026-08-04
- Deciders: Enes (operator), architect session

## Context

WO-0002 ran the full pipeline for the first time. It caught real defects, and it cost several rounds. Looking
at where the cost went: a large share of both the implementer's and the verifier's effort was spent on work a
machine does better — greps, type checks, test runs, builds — and on rediscovering conventions that are
written down but not enforced.

Separately, every session starts by reading its way into ten ADRs to learn rules it must obey on every
keystroke.

## Decision — `CLAUDE.md` carries rules, not reasons

The repository gets a `CLAUDE.md`. It contains only rules that are **always on and mechanically checkable**,
plus pointers to where each rule's rationale lives.

In scope for `CLAUDE.md`: the layering rule, test-first for `core`, no display copy in components and no raw
identifier rendered as text, an action with unmet evidence is absent rather than disabled, no agent-vendor
names, English for code and documents, and where work orders and decisions live.

Out of scope: rationale, alternatives, and anything role-specific. Rationale belongs to the ADR that decided
it — a rule restated with its reasoning in two places is the duplication this project refuses everywhere
else. Role instructions vary per session and are the briefing bundle's job (ADR-0002), not a file's.

The test for whether a line belongs in `CLAUDE.md`: could a linter or a reviewer check it without knowing
why it exists? If not, it is an ADR.

## Decision — mechanical acceptance criteria run in CI

Acceptance criteria that a machine can check are checked by a machine. CI runs `tsc --noEmit`, the test
suite, the production build, and the boundary greps that WO-0002's verification ran by hand: no vendor names,
no workspace name outside fixtures, no Node or Electron imports in `core` or `ui`, no adapter import outside
the composition root.

This changes what verification is for. The verifier stops re-running greps and spends its attention on the
things only judgement covers: is the coverage real, do the tests actually fail when the code breaks, is the
dependency safe, does the change do what the work order asked. WO-0002's mutation checks were the most
valuable part of that review and the greps were the least.

`ci_green` stops being exempt (TD-012). A gate the project has waived for every work order it has ever run is
not a gate.

## Decision — process weight scales with the work order

WO-0002 was heavy deliberately: the pipeline was running for the first time and needed to be watched. That
weight is not the default.

From WO-0005 onward, a work order may declare `review: light`, which means: the verifier goes straight to
verifying without submitting a review plan first, and the architect audit is a spot check of cited evidence
rather than a full re-resolution. Gates are unchanged — evidence is still required, findings still cite
`path:line`, and nothing merges without verification. Only the ceremony around them shrinks.

`review: full` remains the default for anything touching `src/core/`, the gate model, or an ADR.

## Consequences

- A work order that changes a convention must change `CLAUDE.md` and the ADR together, or the two disagree.
  This is the one place duplication is accepted, and it is accepted because the cost of a session not knowing
  a rule is higher than the cost of keeping one line in sync.
- CI becomes a dependency of the pipeline. When it is unavailable, `ci_green` is `unknown`, not exempt and
  not failed (ADR-0010).
- Verification reports get shorter, which makes the judgement parts easier to read rather than easier to
  skip.

## Alternatives rejected

- **Put the ADR content into `CLAUDE.md`.** Every session then reads ten ADRs' worth of reasoning to learn
  rules it could have obeyed from one line, and the two copies drift.
- **Keep the greps in verification.** They found nothing in WO-0002 that a CI job would not have found
  earlier and cheaper, and they crowded out the review that mattered.
- **Lighten the gates rather than the ceremony.** The gates are the product. The ceremony is not.
