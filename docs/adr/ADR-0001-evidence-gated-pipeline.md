# ADR-0001 — Evidence-gated work order pipeline

- Status: accepted
- Date: 2026-08-03
- Deciders: Enes (operator), architect session

## Context

A single-person team drives Claude Code in multiple roles across multiple repos. The relay between roles
runs on copy-paste: plan text, CI results and implementation reports are carried by hand. Work order state
lives in the operator's head. The failure mode is not "a stage was done badly" but "a stage was declared
done without anyone checking".

## Decision

The pipeline is fixed and every transition is guarded by a named evidence requirement.

```
written -> plan requested -> plan ready -> architect approval -> implementation
       -> PR opened -> CI -> verification -> architect audit -> merge -> CLOSURE -> closed
```

Gates:

| Gate | Requires |
| --- | --- |
| plan_approval | architect verdict, plan committed to the decision store |
| pr_open | PR URL, head sha |
| ci_green | all required check runs concluded `success`, **or** the track is explicitly exempt |
| verification | verifier report, **every `path:line` pointer resolves at head sha** |
| closure | all tracks merged **and** roadmap + tech-debt updated, proven by commit sha |

Three consequences that make this real rather than decorative:

1. **A transition whose evidence is missing is absent from the UI, not disabled.** There is no "force"
   button. Overrides, if ever added, must record a written reason on the work order.
2. **Evidence pointers are mechanically verified.** Claims of the form `src/Auth/TokenService.cs:142` are
   checked against the recorded sha. An unresolvable pointer is not evidence.
3. **Merge is not closure.** The documentation gate is a stage, not a courtesy.

**Evidence is three-valued, not two-valued.** A requirement is `satisfied`, `unsatisfied`, or `exempt`.
Exempt is a decision someone made and must be displayed as such, carrying its reason. Modelling evidence as
a boolean forces exemption to be encoded either as a silent pass — which is the failure this ADR exists to
prevent — or as a permanent block, which strands work that legitimately has no CI. `ci_green` is the first
place this bites; it will not be the last.

Gate *existence* is not configurable. Gate *contents* are: a workspace declares which files its closure
gate requires. A fully configurable pipeline is a workflow engine with no opinion, and that is not this
product.

## Consequences

- The most valuable surface of the app is the evidence model, not the screens. Screens follow it.
- Work orders spanning several repos need per-repo tracks, since PR/CI/merge are per-repo. Tracks may
  declare `depends_on`; a dependent track's merge action does not exist until its dependencies close.
- Bootstrapping is manual: WO-0001 is executed by hand because the tool does not exist yet (TD-004).

## Alternatives rejected

- **Status fields the operator sets freely.** This is what a kanban board already does, and it is exactly
  the mechanism that let stages be declared done without checking.
- **Advisory warnings instead of hard gates.** Warnings are dismissed. The point of the product is that
  the process cannot be skipped by being in a hurry.
