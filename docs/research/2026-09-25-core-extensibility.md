# Core extensibility — configurable roles, workflows, environments, conversational intake

A design note, not a work order — no product code changed. Supersedes the earlier framing of this as
a "module system" (Odoo module, .NET module, …): instead of an installable domain package with a
manifest and a trust boundary, the operator's actual preference is to make the CORE itself fully
configurable per workspace. An Odoo workspace configures its own roles/workflow/gates; an Antreo
workspace configures different ones; a Dateapp workspace different again — no packaging, no
distribution channel, no third-party trust problem to solve. This reads directly against
`docs/research/2026-09-25-multi-cli-provider-architecture.md`'s reference (nexu-io/open-design) and
the operator's own `Otomatik Odoo Geliştirme Sistemi` design doc, used throughout as the concrete case
that exercises every piece below.

## What's fixed today that this note proposes making configurable

- **`SessionRole` is a closed union** (`'architect' | 'implementer' | 'verifier'`, `src/core/types.ts`)
  referenced by name across labels, colors (`rlamp-<role>`), prompt assembly, and pipeline sequencing.
  Adding a role today means editing Docket's own source, not something an operator can do.
- **The work-order lifecycle is one fixed stage graph** (`deriveStage`, `src/core/derive.ts`):
  plan_approval → implementation (steps) → verification → closure. No workspace can shape a different
  one, even though the operator's own Odoo design needs a materially different shape (an explicit
  "Staging Test" human-gate stage with no Docket equivalent today).
- **No environment concept exists at all.** A work order has a git branch and a PR; "deploy to staging,
  get a human to click-test it, then promote to production" has no first-class representation —
  today's branch/PR discipline is the closest analogue, but it is not named or gated as an environment
  transition.
- **No conversational, read-only or intake-shaped session exists.** Every session today assumes a work
  order is already open in a git repo. Nothing lets an operator (or an end user) just ask a question
  and get an answer with zero write risk, and nothing turns a raw conversation (plus an attached
  screenshot, as the operator's Odoo design's Request agent does) into a new work order or a new
  workspace.

## The four pieces

### A — An open role registry

Replace the closed `SessionRole` union with operator-defined role records: id, a display name (operator
data, rendered verbatim — the ADR-0007 device-name/profile-name posture, not a label-bundle word),
a prompt (the WO-0070 override mechanism, generalized from "override one of five built-ins" to "define
N roles from scratch"), a write-scope (the ADR-0002 fence's per-role rule, now data instead of a
hardcoded switch), an active/inactive flag, and a position in whichever stage graph (piece B) uses it.

Resolved by the SAME precedence chain the driver route (`resolveDriverRoute`, WO-0104) already uses:
work-order override → workspace → global (account-wide) default. Onboarding suggests the three
built-in roles (architect/implementer/verifier) as a starting set the operator can accept as-is,
rename, deactivate, or extend — never a hardcoded floor.

**Consequence, not a separate system:** a role with an EMPTY write-scope is a read-only Q&A session for
free (piece D-1 below). No new session kind is needed — just a role whose fence denies every write.

This is the largest single piece — `SessionRole` being a closed union is relied on for TypeScript
exhaustiveness across the pipeline, prompt assembly, and every UI surface that colors or labels a role.
Comparable in size to the whole multi-CLI wave (WO-0104–0108) by itself.

### B — A configurable stage graph

Replace `deriveStage`'s one fixed pipeline with a per-workspace (or per-work-order-template) graph:
named stages, which role's completed action advances a stage, which stages require a human approval to
advance (matching the Odoo doc's Backlog→Ready, Staging Test→Done gates), and which local-gate command
set (WO-0089, once it exists — see issue #115) must pass before a stage can close. The Odoo doc's own
kanban (Backlog → Ready → In Progress → In Review → Staging Test → Done, plus Blocked) is the concrete
target shape to validate this against.

Depends on A (a stage names which role acts on it) and, for any stage that represents a deploy, on C.

### C — A first-class environment concept

An `Environment` (id, name — e.g. "staging", "production") that a stage transition can target: what
"promote to this environment" means (today, at minimum, a merge to a named branch; later, an actual
deploy hook), and who/what may approve the promotion. This is the missing piece behind the Odoo doc's
`feature/issue-<no> → staging → main` branch strategy being named and gated rather than an unstated
convention.

### D — Conversational agents

Two distinct capabilities, both built on A rather than as new subsystems:

- **D-1 — Read-only assistant.** A chat entry point at the Docket / workspace / work-order scope,
  backed by a role (piece A) whose write-scope is empty. Purpose is answering questions, never acting.
  No new mechanism beyond "a role can have zero write scope" plus a UI affordance to start one at each
  scope level.
- **D-2 — Intake / creation agent.** Generalizes the existing ✦ draft drive (`roadmap-draft.ts`,
  WO-0050/0051 — already a conversational session that proposes something for review-then-approve) from
  "propose a roadmap" to also "produce one new work order from a conversation (optionally with
  attached images, the Odoo doc's Request agent shape)" and, further out, "bootstrap a new workspace
  and its repos from scratch." This is a widening of a mechanism that already exists, not an invention.

## Sequencing

A first (everything else names a role). Within A, ship the precedence chain and the write-scope-as-data
change before worrying about a role-authoring UI — the mechanism matters more than its onboarding
surface at this stage. D-1 falls out of A for free. C can land in parallel with A (independent). B
depends on both A and, for deploy-shaped stages, C. D-2 can start anytime after A exists, since it only
needs a role to run as, and its own scope (issue a WO, or a workspace) grows independently of B/C.

## Risk

This is bigger than the multi-CLI wave — it touches the core state machine everywhere `SessionRole` is
matched on, not one adapter boundary. The recommended posture is the same one that made the multi-CLI
wave land clean: prove each piece against ONE real second case (the operator's own Odoo workspace, mode
already designed) before generalizing further, rather than speculating about a general role/workflow
DSL no real workspace has asked for yet. A over-built ahead of a second real user is exactly the
"smuggled work" this project's own tech-debt discipline warns against.

## Open questions

- Does a custom role's write-scope need finer grain than the ADR-0002 fence's existing categories, or
  do today's categories already cover what an Odoo/`.NET`/DevOps role would need?
- For B, is a per-workspace single stage graph enough, or does a workspace need several graphs (one per
  work-order "kind" — the Odoo doc's config-only vs new-module branch is itself a graph choice made at
  intake, before the stage graph runs)?
- D-2's "bootstrap a new workspace from scratch" is named in the operator's own vision but not detailed
  anywhere yet — needs its own pass once A/B/C have real shape.
