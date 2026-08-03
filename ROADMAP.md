# Roadmap

Updating this file is a closure gate. A work order is not closed until its entry here is accurate.

## M0 — Probe the ground (current)

Measure Claude Code's programmatic surface before any UI assumption is frozen. The stop-and-ask gate and
the plan-approval handoff are the most fragile parts of the design and the most central parts of the screen.

- [ ] **WO-0001** — Claude Code surface probe

## M1 — Clickable UI prototype

React + Tailwind, no Electron yet, no real sessions. Draw once, keep the code: this becomes the renderer of
the Electron shell. Blocked on M0 for the transcript and gate regions.

- [ ] Work order board ("whose turn is it": YOURS / RUNNING / EXTERNAL)
- [ ] Work order detail: header, stage rail, track lanes, session pane, single-primary-action bar
- [ ] Red CI, stop-and-ask, and missing-evidence states

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

## M4 — Second workspace

- [ ] DateApp onboarded (multi-repo, dedicated decision store, cross-repo tracks with `depends_on`)
- [ ] Briefing bundle assembly, including cross-repo contracts
- [ ] Workspace switcher

## Later

- Packaging and distribution
- Open source release: docs, workspace.yaml authoring, contribution guide
