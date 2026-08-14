# ADR-0002 — Session roles and lifetimes

## İçindekiler

- [Context](#context)
- [Decision](#decision)
  - [Roles and isolation](#roles-and-isolation)
  - [Session lifecycle is decided by the app](#session-lifecycle-is-decided-by-the-app)
  - [Verifier independence](#verifier-independence)
  - [Fresh architect and the briefing bundle](#fresh-architect-and-the-briefing-bundle)
  - [Mode is an explicit field](#mode-is-an-explicit-field)
- [Consequences](#consequences)
- [Alternatives rejected](#alternatives-rejected)

- Status: accepted
- Date: 2026-08-03
- Deciders: Enes (operator), architect session

## Context

Three roles are already in use manually: architect (writes work orders, audits plans and evidence, never
writes code), implementer (writes code, opens a PR, stops there), verifier (independent review — not yet in
use, wanted). The operator currently decides by memory which session to `/clear` and which to continue, and
gets it wrong.

## Decision

### Roles and isolation

| Role | Working repo | Write scope | Lifetime |
| --- | --- | --- | --- |
| architect | decision store | decision store paths only | **per work order — fresh** |
| implementer | the track's repo | that repo | **per track** — survives PR fixes |
| verifier | the track's repo | none (read only) | **per review — always fresh** |

Architect and implementer are never opened in the same working directory in a multi-repo workspace. In a
single-repo workspace they share a repo and isolation rests on the tool's permission mechanism — see TD-001.

### Session lifecycle is decided by the app

New work order means a clean session. A fix on an existing PR means `--resume` on that track's session. The
operator does not remember this rule; the app applies it. The operator may override, and an override records
a reason on the work order.

### Verifier independence

The verifier receives the work order, the approved plan and the diff. It does **not** receive the
implementer's transcript, rationale or CI output. A verifier that reads the implementer's reasoning inherits
its framing, which is most of what independent review is for.

The verifier writes a plan of its own, and that plan is approved by the architect like any other.

### Fresh architect and the briefing bundle

A per-work-order architect rebuilds context from git every time. This keeps work orders from contaminating
each other and keeps context small, but it makes the architect only as informed as the decision store. The
app compensates by assembling a **briefing bundle** into the first prompt: work order, linked ADRs, the
relevant roadmap section, open tech debt. How linked ADRs are selected is not yet designed (TD-003).

### Mode is an explicit field

Each work order declares `plan` or `direct`. Design decisions run in plan mode. Surgical edits where the
operator already determined the change run direct.

## Consequences

- Token cost per work order becomes a tracked metric. Fresh sessions plus targeted briefings plus a blind
  verifier are all cost decisions as much as correctness decisions.
- Role isolation must be enforced by configuration (working directory, allowed tools, permission mode), not
  by instructions in a prompt. Whether that enforcement actually holds is measured by WO-0001.

## Alternatives rejected

- **One long-lived architect session.** Live memory across work orders, but context bloat, cross-contaminated
  decisions, and no clear `/clear` moment. It also removes the pressure that keeps ADRs written down.
- **Verifier sees everything.** Faster reviews, but the independent view is the entire reason the role exists.
