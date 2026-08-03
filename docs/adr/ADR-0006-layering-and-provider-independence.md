# ADR-0006 — Layering and provider independence

- Status: accepted
- Date: 2026-08-03
- Deciders: Enes (operator), architect session

## Context

Docket is expected to outlive both its first project and its first agent CLI. Two forward-looking concerns
were raised: clean layering with testable domain logic, and the ability to drive agents other than Claude
Code — Codex, Gemini, or whatever comes next.

Both are right as intentions. They differ sharply in what can responsibly be built today.

## Decision — layering

Three layers, with a one-way dependency rule:

```
src/core/       domain: types, gate model, derivations. Pure. No React, no I/O, no Node.
src/adapters/   the outside world: fixtures now; git, forge, agent providers later.
src/ui/         presentation: React components and screens.
```

- `core` imports nothing from `adapters` or `ui`.
- `ui` imports from `core`. It reaches the outside world only through a port defined in `core`.
- `adapters` implement ports defined in `core`. Nothing imports an adapter except the composition root
  (`src/dev-main.tsx` now, the Electron main process later).

The rule this enforces: **the product's rules are testable without a browser, a repo, or an agent.**
`whoseTurn`, the stage rail, the evidence checklist and the primary action are the product. They are pure
functions over data and they are tested as such.

This corrects a structural mistake in the first WO-0002 plan, which placed `types.ts`, `gates.ts` and
`derive.ts` under `src/ui/data/`. That is domain logic living inside the presentation layer; cheap to move
now, expensive after M2 and M3 build on it.

## Decision — test-first for the domain

`core` is written test-first. The gate model and the derivations encode the invariants of ADR-0001; a test
that asserts "an unsatisfied gate yields an absent action, never a disabled one" is a more durable guarantee
than a code review.

Test-first applies to `core`. It does not apply to React components, where it produces ceremony rather than
confidence; components are verified by clicking and by screenshots attached to the PR.

## Decision — provider independence is a goal, not yet an interface

Docket will eventually drive more than one agent CLI. It will **not** grow an `AgentProvider` interface
before at least one provider has been measured.

An abstraction written from zero observations is shaped like nothing in particular. The two hard parts of
driving an agent — plan-mode approval and tool permission prompts — are precisely the parts we have declared
unknown and scheduled for measurement (WO-0001). An interface designed ahead of that measurement would
encode our guesses as a contract, which is the failure this project's own principles exist to prevent:
do not assume, measure.

Sequencing:

1. **WO-0001** measures Claude Code, and additionally records — at a survey level only — whether comparable
   CLIs expose a streaming event format, a resumable session id, and a programmatic permission channel.
   Survey, not implementation.
2. **M2** defines the session-runner port in `core` from what was actually observed, with one adapter.
3. **Later** a second adapter is written by whoever needs it. If the port is wrong, it will be wrong with
   evidence rather than wrong on a hunch.

Until then, the protection is structural, not speculative: the runner lives behind a port in `core`, no
`ui` or `core` code names a provider, and no provider concept appears in the view model.

## Consequences

- WO-0002 moves domain out of `src/ui/`, adds Vitest, and is written test-first for `core`.
- WO-0001 gains a survey question on other providers. Its scope grows by a small, bounded amount.
- The word "Claude" appears in no type, no field name and no UI string outside a provider adapter and its
  configuration.

## Alternatives rejected

- **Define `AgentProvider` now.** Feels prudent, is not. It fixes a contract around the exact area we have
  declared unmeasured, and a wrong port is more expensive than a late one.
- **Test-first everywhere including components.** Produces slow, brittle tests around a surface whose whole
  purpose is to be looked at and argued with.
