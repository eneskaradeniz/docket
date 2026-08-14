# ADR-0003 — Workspace configuration lives in git

## İçindekiler

- [Context](#context)
- [Decision](#decision)
  - [v1 scope](#v1-scope)
- [Consequences](#consequences)

- Status: accepted
- Date: 2026-08-03
- Deciders: Enes (operator), architect session

## Context

Docket is built for one project (DateApp: `dateapp-api`, `dateapp-mobile`, `dateapp-docs`) but is intended
to serve other projects and eventually be released as open source. Nothing in the process model is specific
to DateApp. What *is* specific is data: repo identities, where the decision store lives, what the closure
gate requires, which CI checks matter, ADR conventions.

## Decision

A **workspace** is a set of repos plus one designated decision store. Its definition lives in git, at
`<decision-store>/.workflow/workspace.yaml`, and is versioned with the project.

The **decision store is a role, not a repo type.** A multi-repo project points it at a dedicated repo
(`dateapp-docs`). A single-repo project points it at a folder inside that repo. Both are expressed in the
same schema; Docket sees one concept.

**Local paths never enter the yaml.** The file carries repo identity (`id`, `remote`, `default_branch`).
Docket's own SQLite database maps `remote` to a local checkout path and holds machine-specific concerns such
as forge auth. This is the boundary between "shared, versioned process definition" and "this machine".

Two structural rules protect this without building a generalisation layer up front:

1. The string `dateapp` appears nowhere in the codebase. Anything project-shaped comes from `workspace.yaml`.
2. Project context always flows from a `Workspace` object. Never from a global or a singleton.

### v1 scope

Two workspaces: DateApp (multi-repo, dedicated decision store) and Docket itself (single-repo, decision store
inside the repo). The second is the generality test and it is free — Docket manages its own development from
day one.

## Consequences

- Docket needs a `workspace.yaml` authoring surface, or the operator hand-writes yaml. Acceptable for v1,
  a real onboarding problem before open source.
- The forge is accessed through a thin `Forge` interface with a single GitHub implementation (TD-002). A
  second provider is not written; the seam costs almost nothing today and lets a contributor add one later.
- Writing both yaml files immediately exposed a redundancy: repos carried `role: decision_store` while a
  separate `decision_store.repo` key said the same thing. Removed — the same "two copies, one goes stale"
  rule that applies to documents applies to configuration.
