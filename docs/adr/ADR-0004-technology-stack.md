# ADR-0004 — Technology stack

- Status: accepted
- Date: 2026-08-03
- Deciders: Enes (operator)

## Context

The core of the application is process supervision and rendering of streaming output. The operator works
solo and must be able to read and audit every line the implementer session writes.

## Decision

Electron + TypeScript + React + Tailwind. xterm.js for transcript rendering. SQLite for state.

Rationale: process management and stream rendering are Node's home ground, and the operator can read and
review TypeScript. Local-only; no server, no cloud state.

The UI prototype is built with the same React + Tailwind stack used previously in
`dateapp-mobile/design-kit`, and its code is **not** thrown away — it becomes the renderer of the Electron
shell. Draw once, do not write twice.

## Open — decided by WO-0001

How Docket drives Claude Code is **not** settled by this ADR:

- spawning the `claude` CLI and parsing `--output-format stream-json`, or
- using the Claude Agent SDK from the Node main process.

Both fit this stack. The deciding factor is which one gives a contractual, programmatic channel for the two
fragile points — plan-mode approval and tool permission prompts — rather than requiring stdout parsing. This
is measured, not assumed. See `docs/work-orders/WO-0001-claude-code-surface-probe/`.

## Consequences

- The session runner sits behind an interface so that the M0 outcome does not ripple through the UI.
- The transcript and stop-and-ask regions of the UI are not frozen until WO-0001 reports.
