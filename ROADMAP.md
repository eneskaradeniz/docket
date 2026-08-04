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

- [x] **WO-0002** — Board + work order detail, fixture-driven, six states covered. Merged `042231f`.
      First work order to run the full pipeline. Two returns on acceptance-criteria misses, a blind
      verification with mutation checks, and a reconstructed plan (TD-005). 75 tests; `src/core/` pure and
      test-first; components carry no display copy. `ci_green` was exempt — see TD-012.
- [ ] **WO-0005** — `CLAUDE.md`, CI, and watch scripts. Runs before WO-0003: it ends the `ci_green`
      exemption and moves the mechanical half of verification off the operator
- [ ] **WO-0003** — Visual hierarchy pass. The prototype is structurally right and visually flat; nothing is
      dominant, so the board does not answer "what needs me most" at a glance. Presentation only.
- [ ] **WO-0004** — Workspace connection management: add, update, remove connections (ADR-0009). Replaces the
      two hardcoded workspaces. Also the onboarding path a third party would use.
- [ ] **WO-0006** — ADR-0007/0003 live violations and detection gaps (TD-014, TD-015). Follow-up to WO-0005
      verification: three violations in WO-0002 code the checks miss, and the gaps that let them through.

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
- [ ] **Health checks** — `git`, `gh auth status`, the agent CLI: presence, version, auth. Blocking on first
      run, visible and non-blocking afterwards; a degraded dependency yields `unknown`, never a guess
- [ ] **Reconciliation** — re-read git and the forge on open, focus, after actions, on manual refresh and on
      a background interval. Observation wins over what Docket last showed. Merged-outside-Docket is normal
- [ ] `stage` derived from observed facts rather than stored (TD-008); `EvidenceStatus` gains `unknown`
- [ ] A defined home in the decision store for architect verdicts and verifier reports (TD-009)
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
