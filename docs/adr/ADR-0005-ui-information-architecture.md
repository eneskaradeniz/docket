# ADR-0005 — UI information architecture

## İçindekiler

- [Context](#context)
- [Decision](#decision)
  - [The board is partitioned by whose turn it is, not by stage](#the-board-is-partitioned-by-whose-turn-it-is-not-by-stage)
  - [A locked stage states what it needs](#a-locked-stage-states-what-it-needs)
  - [The evidence panel is always visible](#the-evidence-panel-is-always-visible)
  - [Documents are rendered, never stored or edited](#documents-are-rendered-never-stored-or-edited)
  - [One session pane, tabbed by role](#one-session-pane-tabbed-by-role)
  - [The stop-and-ask card is pinned above the transcript](#the-stop-and-ask-card-is-pinned-above-the-transcript)
  - [One primary action](#one-primary-action)
  - [Per-work-order cost is displayed](#per-work-order-cost-is-displayed)
- [Consequences](#consequences)

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

"Not copied" is a rule about storage, not about display. Docket may show a document; it may not own one.
Every render reads from disk at view time. Nothing is cached in the database, nothing is editable in-app.

The line between rendered and linked is **ownership**:

| Document | Treatment | Why |
| --- | --- | --- |
| `order.md`, `plan.md` | rendered inline, read-only | Owned by this work order. Read constantly while working it. |
| ADRs, tech-debt, contracts, ROADMAP | link out only | Referenced, not owned. Reading them properly means reading them in context, in the editor. |

Rendering a referenced document inline invites reading it out of context and drifting toward becoming a
document browser. Editing always happens in the operator's editor; git stays the source of truth.

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

---

**Addendum (2026-08-22, WO-0038 / ADR-0013):** the dual-surface (SADE|DETAY) and the tab/rack forks
of the detail screen are superseded by the single-view dossier — one scroll, a merged header band,
the record as sections. ADR-0013 carries the ruling; this document's board/derivation decisions
stand.
