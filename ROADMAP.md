# Roadmap

Updating this file is a closure gate. A work order is not closed until its entry here is accurate.

## M0 — Probe the ground (current)

Measure Claude Code's programmatic surface before any UI assumption is frozen. The stop-and-ask gate and
the plan-approval handoff are the most fragile parts of the design and the most central parts of the screen.

- [ ] **WO-0001** — Claude Code surface probe

## M1 — Clickable UI prototype

React + Tailwind, no Electron yet, no real sessions. Draw once, keep the code: components live at `src/ui/`
and do not move when the Electron shell arrives. Information architecture is settled in ADR-0005. The
transcript and stop-and-ask regions stay provisional until M0 reports.

- [ ] **WO-0002** — Board + work order detail, fixture-driven, six states covered

Running ahead of M0 deliberately: the board, stage rail, track lanes and evidence panel do not depend on
Claude Code's surface. Only the session pane does, and it is isolated for that reason.

## M2 — Electron shell and session runner

- [ ] Electron + TS scaffold, renderer = M1 prototype
- [ ] Session runner (CLI spawn or Agent SDK — decided by M0)
- [ ] xterm.js transcript, session persistence and resume
- [ ] SQLite state: work orders, tracks, sessions, evidence pointers
- [ ] Per-work-order token/cost accounting from stream usage data

## M3 — Evidence layer

- [ ] `Forge` interface, GitHub implementation over `gh`
- [ ] PR / head sha / check-run ingestion
- [ ] Pointer resolution: every `path:line` claim must resolve at the recorded sha
- [ ] Gate engine: transitions absent, not disabled, when evidence is missing

## M3.5 — Shell foundations

Presentation-only, no domain change. Cheap because ADR-0006 kept `core` free of display strings and
WO-0002 routed all copy through `labels.ts`.

- [ ] Locale `en` / `tr`, keyed labels, `en` fallback, preference persisted (ADR-0007)
- [ ] Theme light / dark / system via semantic tokens, preference persisted (ADR-0007)
- [ ] Lint rule against hardcoded strings and literal colours in components

## M4 — Second workspace

- [ ] DateApp onboarded (multi-repo, dedicated decision store, cross-repo tracks with `depends_on`)
- [ ] Briefing bundle assembly, including cross-repo contracts
- [ ] Workspace switcher

## M5 — Workspace overview

A read-only projection of the decision store, not a planning surface (ADR-0008). Third consumer of the same
gate model, after the board and the detail view.

- [ ] Milestone progress from work-order `milestone` front matter
- [ ] Open work orders grouped by whose turn it is
- [ ] Open tech debt linked to the work orders that opened it
- [ ] "Ready to start" computed from closed dependencies and unsatisfied gates
- [ ] Recently closed, with closing sha

## Later

- Packaging and distribution
- Open source release: docs, workspace.yaml authoring, contribution guide
