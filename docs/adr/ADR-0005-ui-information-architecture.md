# ADR-0005 — UI information architecture

- Status: accepted
- Date: 2026-08-03
- Deciders: Enes (operator), architect session

## Context

The operator already knows what every work order is doing. What he loses track of is which one is waiting on
him, and what a stalled one is waiting for. A conventional stage-column board answers the question he can
already answer and stays silent on the one he cannot.

## Decision

### The board is partitioned by whose turn it is, not by stage

Three columns: **your turn**, **running**, **external**. A work order lands in "your turn" when a session
stops and asks, when CI fails, when evidence is awaiting audit, or when a gate is ready to be passed. Stage
is a detail on the card, not the axis.

### A locked stage states what it needs

`PR · needs url, sha`. The gate is an instruction, not a punishment. This is the concrete form of "the app
carries the operator" — the screen answers "what now?" at every moment.

### The evidence panel is always visible

A checklist in the left column of the detail view, not a tab. The evidence model is the product's most
valuable surface; it does not get hidden behind a click.

### Documents are rendered, never stored or edited

`order.md`, `plan.md` and linked ADRs are read from disk and displayed read-only. Docket is a viewer, not
a second copy and not an editor. Editing happens in the operator's editor, and git stays the source of truth.

### One session pane, tabbed by role

`implementer / architect / verifier` tabs over a single transcript pane, with an activity badge on inactive
tabs. Two live terminals side by side in a single-operator tool is noise, not information.

### The stop-and-ask card is pinned above the transcript

Not inline in the stream. A question that scrolls away is a question that was not asked.

### One primary action

The action bar shows exactly one primary action for the current stage. Actions whose evidence is missing are
**absent**, with a line stating why — never rendered disabled.

### Per-work-order cost is displayed

Token and cost totals are shown in the sidebar. Cost is a first-class outcome of the session-lifetime
decisions in ADR-0002, so it is visible rather than inferred.

## Consequences

- The board needs a rule engine that computes "whose turn" from state plus evidence. This is the same gate
  engine from ADR-0001, read in the other direction.
- The transcript and stop-and-ask regions are **provisional** until WO-0001 reports. Their shape depends on
  whether permission prompts are observable. They are marked as such in the prototype.
- UI copy is English, matching the repository language and the open-source destination.
