# ADR-0006 — Layering and provider independence

## İçindekiler

- [Context](#context)
- [Decision — layering](#decision--layering)
- [Decision — test-first for the domain](#decision--test-first-for-the-domain)
- [Decision — provider independence is a goal, not yet an interface](#decision--provider-independence-is-a-goal-not-yet-an-interface)
- [Consequences](#consequences)
- [Alternatives rejected](#alternatives-rejected)

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
- `adapters` implement ports defined in `core`. Nothing imports an adapter except **a** composition root — the
  Electron main process (`electron/main.ts`) or the CLI entry (`src/cli/index.ts`). (WO-0024 widened this from
  the single Electron root; the earlier `src/dev-main.tsx` reference predated the Electron shell.)

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

## Addendum (WO-0031d) — the agent-configuration carve-out is mechanical, in CI

Boundary check c1 strips the literals `CLAUDE.md` and `.claude` from each line before running the
vendor-name test (`scripts/check-boundaries.mjs`). Rationale: `src/core/risky.ts` must match those
exact paths to classify agent-configuration writes as risky; naming the agent's *configuration file*
is not naming the vendor's *product*. The strip is scoped to those two literals — any other vendor
name in `core/`, `ui/`, `renderer/` or `electron/` still fails the check. Recorded here because the
carve-out shipped in WO-0031c's pre-merge fixes with only a script comment as its home.

## Addendum (WO-0052) — the vendor-name ban is a CODE ban; usage metrics carry model ids as DATA

The usage-instrumentation floor persists what the provider's result message already carries,
including the per-model usage map keyed by model id (`claude-sonnet-4-5` and kin). Those strings
flow through `usageOf` (the adapter, where the SDK is named) into `session_usage.model` /
`model_usage` rows and the session's `final_model_usage` — verbatim, as row DATA. The ban above
governs CODE: no vendor or model name becomes a constant, a branch, or a copy line outside
`src/adapters/`. A model id in a metrics row is an observation, the same class as a tool-target
path in `wo_event.detail` (the Records rule, CLAUDE.md 2026-08-26); a model id in a predicate is
the vendor reaching past the adapter — that stays forbidden.

## Addendum (WO-0073) — the composition root is ONE again

The CLI host (`src/cli/index.ts`, WO-0024's second composition root) is removed; Docket is GUI-only
(operator ruling 2026-09-20). The decision above is unchanged in substance — nothing imports an
adapter except a composition root — and the root is now only the Electron main process. WO-0024's
widening and this narrowing are both history, kept here rather than rewritten into the decision
text. What the CLI carried — a headless way to drive the pipeline without a browser or a human at
the keyboard — lives on in the test estate only: the core port fakes and the E2E spec's in-app e2e
bridge. The layering rationale (the product's rules testable without a browser, a repo, or an
agent) is untouched: `core` stays pure, the ports stay in `core`, and the provider/forge adapters
stay single-per-vendor behind them.
