# Docket — Product Spec

> Status: **draft for alignment** (2026-08-06). The single source of truth for *what* Docket is.
> ROADMAP milestones, ADRs, and work orders are derived from this. English per ADR-0007; UI is
> localized (en/tr) — copy terms shown below in `code`.

## One line

Docket drives AI coding-agent sessions through an **architect-led, plan-driven, evidence-gated
pipeline** across one or more git repos, under the operator's control.

## The end-to-end loop

1. **Workspace.** The operator opens a *workspace* (e.g. `dateapp`) backed by one or more **repo
   connections** (local path + GitHub remote) and **designates a decision store** (a workspace
   setting — e.g. `dateapp-docs`, or a same-repo `docs/` folder for single-repo workspaces like
   `docket`). The decision store is the shared home for the roadmap, architecture, ADRs, work orders,
   plans, and reports; it is never a code track.
2. **Work order.** The operator opens a *work order*: title, description, optional **context
   files/images**, the **track(s)** it concerns (**code repos only** — the decision store is excluded;
   it's a workspace setting), and a **review mode** (see §Review mode).
3. **Architect plan.** An *architect* session reads the work order + context, asks the operator
   questions, proposes a **plan** — an ordered sequence of **steps**, each a role session scoped to
   track(s) (e.g. `implementer·backend`, `verifier·security`, `verifier·test`). The operator
   approves; the plan commits to the decision store.
4. **Steps in sequence.** Each step runs as a session and produces a **report**. The architect
   reviews each report and either proceeds or revises. The review mode decides how often the
   operator is pulled in.
5. **Close.** When all steps are done, the architect signs off ("work order complete"). The operator
   reviews and **merges** each track's PR. Docket then **auto-drafts the decision-store updates** —
   ROADMAP (mark the work order done), tech-debt (open/close entries), the work order's own `order.md`
   closure note, and **a proposed ADR if the work order made an architectural decision** — shows a
   single preview, and the operator **Approve / Edit / Skip**. On approve, the updates commit to the
   decision store; that commit sha satisfies the closure gate, and the work order closes.

## Concepts

| Term | Meaning |
| --- | --- |
| **Workspace** | A project: a set of repo connections + one decision store. |
| **Decision store** | A **workspace-level setting** (set once, not per work order): the repo (e.g. `dateapp-docs`) or a same-repo `docs/` folder (e.g. `docket`/`docs`) that holds shared docs — roadmap, architecture, ADRs, work orders (`order.md`), plans (`plan.md`), session **reports**. Single source of truth; **never a code track**. |
| **Repo connection** | Local path + forge (GitHub) remote, per repo. CRUD by the operator. |
| **Work order** | The unit of work: objective (title + description), context attachments, tracks, review mode, plan, sessions. |
| **Track** | A repo the work order touches. A multi-repo work order has several tracks. |
| **Context** | Files/images attached to a work order as input. |
| **Plan** | Architect-proposed, ordered list of **steps**; committed to the decision store; **drives the flow** (replaces the fixed stage rail as the primary driver). |
| **Step** | One unit of the plan: a **role** + an **aim** + track **scope**. Runs as one session. |
| **Session** | One agent run in a role, scoped; produces a transcript (provider-owned, on disk) and a **report**. |
| **Report** | A step's structured output, written to the decision store; read by the architect. |
| **Architect review** | After each step's report, the architect audits and gives a **verdict**: *proceed* or *revise*. |
| **Gate / evidence** | A transition requires evidence: plan approval (+committed plan), each step's architect verdict, merge + CI green, closure docs. |
| **Review mode** | Per-work-order setting: `gates` or `every-step` (see below). |

## Roles

Three vendor-neutral roles (ADR-0006): **architect** (plans, supervises, audits), **implementer**
(codes, scoped to a repo), **verifier** (reviews/tests/audits). "Backend developer / review / test /
security" are modeled as **role + aim**: `implementer·backend`, `verifier·test`, `verifier·security`.
The aim is a label; the role drives write-scope and the fence (ADR-0002).

## The plan-driven pipeline

Flow is driven by the **plan** (architect-proposed per work order), **not** a fixed stage rail. The
fixed 9-stage rail is retained only as a derived, secondary view ("show pipeline"). The primary
surface is the **plan's step list** — each step shows status (`pending` / `active` / `done` /
`blocked`) and, when open, its session transcript + report + architect verdict.

## The review loop + review mode

After each step, the architect reviews the report. The **review mode** (chosen when the work order is
created; default `gates`) sets the operator's involvement:

- **`gates` (Sade — default):** the architect proceeds autonomously between steps and engages the
  operator at three points — (1) plan approval, (2) any step where it wants a revision or is
  uncertain, (3) final merge. Calm and fast.
- **`every-step` (Her adımda):** after every step's report, the architect surfaces its verdict to the
  operator, who approves or requests revision before the next step. Maximum control, more pauses.

## Decisions (agreed 2026-08-06)

1. **Review granularity is per-work-order** (`gates` default / `every-step`).
2. **Stages are plan-defined** (architect-proposed), not a fixed rail.
3. **Roles stay three**; rich steps are **role + aim + scope** (no new role types).
4. **Context attachments** are first-class work-order input.
5. **Decision store** is the per-workspace docs repo (shared roadmap/architecture/work orders/reports).
6. The decision store is a **workspace setting, not a track** (excluded from the work-order track list);
   single-repo workspaces use the same repo's `docs/` folder.
7. **Closure auto-drafts** the decision-store updates (ROADMAP / tech-debt / `order.md` / a proposed
   ADR) and asks the operator **once** (Approve / Edit / Skip); the commit satisfies the closure gate.

## Already in the model vs new

- **Already modelled:** multi-repo tracks (`depends_on`), decision store (`Workspace.decisionStore`),
  three roles, evidence-gated merge + closure, vendor-neutral runner port, SQLite store, persistence
  + resume, derived cost, xterm transcript.
- **New (to build):**
  - Workspace + repo-connection **management UI** (WO-0004; ADR-0009 connection model).
  - **Context attachments** on the work order.
  - **Plan-defined steps** + the **per-step architect-review loop** (the plan replaces the fixed rail
    as the flow driver; the rail becomes a derived view).
  - The configurable **review mode** (`gates` / `every-step`).
  - A **home in the decision store for reports + architect verdicts** (TD-009).
  - Real **forge** (GitHub-over-`gh`): PR / CI / merge observation, reconciliation, pointer resolution
    (M3) — so the board tracks the operator's *real* repos, not fixtures.

## Open questions (to settle)

- **Context storage location** — decision store (git) vs local; decide in M3.
- **Report structure** — the shape of a step's report + architect verdict in the decision store
  (closes TD-009).
- Whether custom **aims** can later define their own write-scope/fence, or remain labels over the
  three roles.
- Onboarding: how a brand-new workspace bootstraps its decision store (ADR-0009 connection vs
  definition).

## Relationship to existing docs

- Augments **ADR-0001** (evidence-gated pipeline): the plan now *defines* the gate sequence per work
  order; the fixed rail becomes derived.
- Augments **ADR-0002** (roles): roles unchanged; the *aim* label is introduced.
- Realises **ADR-0009** (workspace connection vs definition) via the management UI.
- Feeds **ROADMAP** M3 (evidence layer) and reorders priorities toward: workspace management (WO-0004)
  → work-order creation with context → plan-driven steps + review loop → real forge.
