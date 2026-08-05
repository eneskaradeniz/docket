# ADR-0009 — Workspace connection is not workspace definition

- Status: accepted
- Date: 2026-08-03
- Deciders: Enes (operator), architect session

## Context

The prototype ships two hardcoded workspaces. Docket needs the operator to add, update and remove workspaces
from inside the app. ADR-0003 put the workspace definition in git, so "create / update / delete a workspace"
runs straight into the invariant: the app does not own project documents.

Naming the two objects separately resolves it.

## Decision

| | Workspace **definition** | Workspace **connection** |
| --- | --- | --- |
| What | repos, decision store, roles, gates, briefings | this machine's link to that definition |
| Where | `.workflow/workspace.yaml`, in git | Docket's SQLite database |
| Shared | yes, versioned, travels with the project | no, local to this machine and operator |
| Contains | project shape | local checkout path, last opened, forge auth reference, locale/theme are separate operator prefs |

The management UI operates on **connections**. The definition is only ever created or changed through git.

### Add

The operator picks a local folder. Docket reads `.workflow/workspace.yaml` and connects it. If the file is
absent, Docket offers to scaffold one from a template — writing the file into the working tree and leaving it
for the operator to review and commit. Docket does not commit a definition on the operator's behalf.

### Update

Editing a definition is a git change. Docket may present a form, but the result is a file written to the
working tree and a commit the operator makes, never a silent database write. A definition that exists only in
Docket's database is the second copy this project refuses everywhere else.

### Remove

Removing a workspace **disconnects it locally**. It never deletes the yaml, the repos, or anything in git.
The action is labelled "Remove from Docket", not "Delete workspace", because the label is the safety
mechanism. Reconnecting the same folder restores everything, since nothing of value was in the database.

## Consequences

- Docket needs a workspace template and a folder picker. This is also the onboarding path a third party will
  use, so it is the first piece of work aimed past the operator (ADR-0003 flagged this as an open-source
  prerequisite).
- The board's workspace switcher becomes a list of connections plus an "Add workspace" affordance, replacing
  two hardcoded entries.
- Deleting is cheap and reversible by construction, because the database holds nothing irreplaceable. That is
  a property to preserve, not a coincidence.

## Alternatives rejected

- **Full CRUD on the definition inside the app.** Convenient, and it makes Docket the owner of a file that
  belongs to the project. The first time the yaml is edited both in git and in Docket, one silently wins.
- **Store the definition in the database and export to yaml.** The same failure with an extra step.

## Addendum: M2 pragmatic CRUD (WO-0014, 2026-08-06)

The M2 fixture era has no `workspace.yaml` scanner yet (that is M3). Strictly applying the ruling
above — "the management UI operates on connections only; the definition is created/changed through git"
— would mean the operator cannot create a workspace until M3. That blocks the product's core loop.

**M2 decision (temporary departure):** the management UI (WO-0014) **authors definitions directly**
into the observed `workspace`/`workspace_repo` tables **and** writes connections into the owned
`connection` table. This makes Docket usable now. The seed-from-fixtures coexists with operator-created
workspaces until the operator creates real ones.

**M3 reconciliation:** when the git scanner lands, it re-observes definitions from `workspace.yaml`. At
that point, operator-authored observed rows that are NOT backed by a yaml are orphaned (the scanner
rebuilds from yaml). The owned **connection rows survive** — that is the observed|owned split's whole
point (ADR-0010). The operator's local-path + GitHub-remote links persist across the reconciliation.

This is a documented, time-boxed departure from the "definition through git only" ruling, not a
reversal. The ruling's intent — "Docket does not own project facts; it observes them" — is preserved by
making the observed rows discardable and the connection rows owned.
