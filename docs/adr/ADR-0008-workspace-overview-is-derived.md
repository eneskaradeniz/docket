# ADR-0008 — The workspace overview is derived, not a planning surface

## İçindekiler

- [Context](#context)
- [Decision](#decision)
  - [What it shows](#what-it-shows)
  - ["Ready to start" is computed, not suggested](#ready-to-start-is-computed-not-suggested)
  - [Roadmap progress without machine-readable roadmaps](#roadmap-progress-without-machine-readable-roadmaps)
- [Consequences](#consequences)
- [Alternatives rejected](#alternatives-rejected)

- Status: accepted
- Date: 2026-08-03
- Deciders: Enes (operator), architect session

## Context

Selecting a workspace should show where the project stands: roadmap progress, open work orders, outstanding
tech debt, and what could sensibly be started next. The reference points offered were Trello and Odoo project
management.

The need is real. The reference is wrong, and the reason matters enough to write down.

## Decision

The workspace overview is a **read-only projection of the decision store**. It renders what git already says.
It has no state of its own and no way to change a work order's position.

Explicitly rejected: dragging a card to change its status; setting a stage by hand; creating a work order by
typing into a column; any control that alters state without evidence.

ADR-0001 rejected freely-settable status fields as "exactly the mechanism that let stages be declared done
without checking". A drag-and-drop board is that mechanism with a nicer interaction. Building one would put a
second source of truth next to git and undo the invariant the product exists to enforce.

### What it shows

| Panel | Source | Derivation |
| --- | --- | --- |
| Milestone progress | work orders declaring a `milestone` | count by state per milestone |
| Open work orders | decision store | grouped by board column (whose turn it is) |
| Open tech debt | `docs/tech-debt.md` | rows with status `open`, linked to the work orders that opened them |
| Ready to start | work orders + tracks | see below |
| Recently closed | git history of the work-order directory | last N closures with their closing sha |

### "Ready to start" is computed, not suggested

A work order is *ready* when every work order it depends on is closed, no gate on it is unsatisfied by
something outside the operator's control, and it has no running session. This is a deterministic query over
state Docket already holds — the same gate engine, read a third way.

It is **not** a model proposing work. If the architect should propose the next work order, it does so in an
architect session and the output is a work order committed to the decision store, reviewed like any other.
A dashboard that invents tasks is a different product, and an untrustworthy one: the suggestion would have no
evidence behind it, in an application whose entire thesis is that nothing moves without evidence.

### Roadmap progress without machine-readable roadmaps

`ROADMAP.md` stays human prose. Progress is **not** derived by parsing it. Instead each work order declares
`milestone: M1` in its front matter, and the overview counts work orders by state per milestone.

The alternative — parsing checkboxes out of `ROADMAP.md` — would turn a document written for humans and agent
sessions into a machine format, and its formatting would then be constrained by a rendering concern. The
document stays the narrative; the work orders carry the structure.

## Consequences

- Work order front matter gains an optional `milestone` field. `workspace.yaml` gains an optional milestone
  list so the overview can order and label them.
- The overview is a third consumer of the same gate model (`core`), after the board and the detail view. If
  it needs state of its own, that is a signal the design has gone wrong.
- Closing a work order already requires updating `ROADMAP.md` (ADR-0001 closure gate). The overview makes a
  stale roadmap visible rather than enforcing it — the gate does the enforcing.

## Alternatives rejected

- **A kanban board with drag-to-change-status.** Familiar, and it removes the product's only real guarantee.
- **Model-generated next-task suggestions in the dashboard.** Suggestions without evidence, in an evidence-gated
  tool. If the proposal is worth acting on it is worth being a work order.
- **Parsing `ROADMAP.md` for progress.** Makes a human document answer to a UI.

---

**Addendum (2026-08-27, WO-0048 — the roadmap layer):** the "Roadmap progress without machine-readable
roadmaps" section above is superseded FOR THE WORKSPACE ROADMAP ARTIFACT by ADR-0016 — a per-workspace
`roadmap.md` with one machine fence (the ```steps tradition), tasks linked from order.md front-matter,
and every status derived. The `milestone:` front-matter mechanism is retired for new work (the
repository's own root `ROADMAP.md` stays human prose — it is a closure gate, not a workspace planning
artifact). Both disciplines of this ADR stand unchanged and carry into ADR-0016 unchanged: status is
computed, never set by hand or dragged, and a model proposes work only as a reviewed, committed
document.
