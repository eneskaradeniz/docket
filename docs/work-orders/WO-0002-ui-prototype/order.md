---
id: WO-0002
title: Clickable UI prototype (board + work order detail)
workspace: docket
status: draft
mode: plan
tracks:
  - repo: app
    depends_on: []
---

# WO-0002 — Clickable UI prototype

## Objective

Build a clickable prototype of the two screens that carry the whole product: the board and the work order
detail view. Fixture data only, no sessions, no git, no forge. The purpose is to argue about the interaction
by using it rather than by reading a specification.

**This code is not thrown away.** It becomes the renderer of the Electron shell in M2. Draw once.

## Context

- `docs/adr/ADR-0005-ui-information-architecture.md` — the UI decisions this implements
- `docs/adr/ADR-0001-evidence-gated-pipeline.md` — stages, gates, evidence
- `docs/adr/ADR-0002-session-roles-and-lifetimes.md` — roles, tabs, mode field
- `docs/adr/ADR-0004-technology-stack.md` — React + Tailwind, and the still-open runner question

## Mode

`plan`. Component boundaries and the fixture data shape are design decisions with downstream cost: the
fixture types become the app's view model in M3. Plan first.

## Layout constraint

Three layers with a one-way dependency rule (ADR-0006):

```
src/core/      domain: types, gate model, derivations. Pure — no React, no I/O, no Node.
src/adapters/  the outside world: fixtures now. Implements ports defined in core.
src/ui/        presentation: React components and screens. Imports core, never adapters.
```

A Vite dev harness (`index.html`, `src/dev-main.tsx`) is the composition root: it is the only file that may
import an adapter. M2 replaces the harness with the Electron shell and **must not move any file under
`src/core/` or `src/ui/`**.

Nothing under `src/core/` or `src/ui/` may import Electron, Node or filesystem APIs. All data enters through
a port declared in `src/core/`; M3 swaps the adapter, not the call sites.

## Scope

In scope:

- Vite + React + TypeScript + Tailwind scaffold, plus Vitest for the domain layer
- `src/core/` written **test-first**: the gate model and every derivation
  (`whoseTurn`, rail, evidence, primary action) has a failing test before it has an implementation
- Board screen: three columns (your turn / running / external), work order cards, workspace switcher in the
  chrome (switching may be non-functional)
- Work order detail: header, stage rail, track lanes, evidence panel, source links, role-tabbed session pane,
  single-primary-action bar
- Read-only markdown rendering of `order.md` and `plan.md` from fixture strings. Referenced documents
  (ADRs, tech-debt, ROADMAP, contracts) are links only — see the ownership table in ADR-0005.
- Navigation between the two screens

Out of scope: Electron, real sessions, xterm.js, git or `gh` calls, SQLite, settings screens,
`workspace.yaml` editing, authentication, dark/light theming beyond what Tailwind gives for free.

## Fixture data

Fixtures must cover every state that matters, including the ones that are easy to forget:

1. **Stopped and asking** — session halted at a named gate, question pinned above the transcript
2. **Failed CI** — work order pulled back to "your turn", failing check named
3. **Missing evidence** — a stage the operator wants to pass but cannot; the primary action is absent and a
   line states what is missing
4. **Closure gate open** — all tracks merged, roadmap and tech-debt not yet updated, work order still open
5. **Multi-track** — a DateApp work order with `api` and `mobile` tracks where `mobile` declares
   `depends_on: [api]`; the dependent track's merge action does not exist until `api` merges
6. **CI exempt** — a track with no CI configured, shown as an explicit exemption, never as a silent skip

## Acceptance criteria

1. Both screens render from fixtures with no hardcoded strings in components; all copy and data come from
   `src/ui/data/`.
2. All six fixture states above are reachable by clicking, with no dev-only toggles.
3. No action whose evidence is missing is rendered as a disabled control. It is absent, with a reason line.
4. Every stage shown as locked names what it requires.
5. The string `dateapp` appears in fixture data only, never in component code (ADR-0003 rule 1).
6. Nothing under `src/ui/` imports Electron, Node or `fs`.
7. The session pane and stop-and-ask card are visibly marked provisional and isolated in their own components,
   so WO-0001's outcome can replace them without touching the rest.
8. `npm run build` passes with `tsc --noEmit` clean.
9. `src/core/` has no import of React, Node, `fs`, Electron or any adapter, and its tests run without a DOM.
10. Every derivation in `src/core/` has tests covering all six fixture states, plus these named cases:
    an unsatisfied gate yields `{kind:'absent'}` and never a disabled control; a track whose `dependsOn` is
    open has no `merge`; a CI-exempt track is never treated as passing; a work order that matches no
    `whoseTurn` rule falls to `your_turn`.
11. No type, field name or UI string names an agent vendor (ADR-0006).

## Evidence required

- plan_approval: architect verdict, `plan.md` committed
- pr_open: PR URL, head sha
- ci_green: exempt — no CI on this repo yet. Recorded as an explicit exemption, not a silent skip.
- verification: verifier report; every `path:line` pointer resolves at head sha; screenshots of all six
  fixture states attached to the PR
- closure: track merged, `ROADMAP.md` M1 updated, `docs/tech-debt.md` reviewed

## Stop-and-ask gates

1. **Before writing the fixture types.** These types become the view model in M3. Report the proposed shape
   and stop.
2. **If a designed screen cannot represent a state without a new concept.** Do not invent a concept. Report
   the state and the gap.
3. **If the session pane appears to need real streaming to be designed at all.** Stop. WO-0001 has not
   reported and its region is deliberately provisional.

## Notes

UI copy is English. The `provisional` badge on the session pane is a real product decision, not a placeholder:
until WO-0001 reports, that region's shape is unowned.
