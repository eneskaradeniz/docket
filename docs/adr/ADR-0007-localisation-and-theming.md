# ADR-0007 — Localisation and theming

- Status: accepted
- Date: 2026-08-03
- Deciders: Enes (operator), architect session

## Context

The operator works in Turkish; the repository, the code and the agent sessions are in English. Docket is
also headed for an open-source release where an English-only UI is a limitation. Separately, a light / dark /
system theme is expected of any desktop tool.

Both are presentation concerns. Neither touches the domain.

## Decision — localisation

**UI vocabulary is translatable. Domain data is not.**

| Translatable | Never translated |
| --- | --- |
| Column headers, stage labels, evidence labels, role names, button text, empty states, reasons rendered from enums | Work order titles and bodies, ADR text, plan text, transcripts, git paths, branch names, PR titles, commit messages, evidence values, repo and workspace ids |

The groundwork is already in place and was not accidental: `src/core/` returns enums and structured data, never
display strings (ADR-0006), and WO-0002 AC1 forbade hardcoded copy in components by routing everything
through `src/ui/data/labels.ts`. Localisation is therefore a matter of keying that module by locale and
selecting one — not a refactor.

Locales: `en` and `tr`, with `en` as the fallback for any missing key. Locale is a user preference stored in
the app's own database, never in `workspace.yaml` — it is a property of the operator, not the project.

**Repository documents stay English** regardless of UI locale. A Turkish UI does not imply Turkish ADRs.
The audience for the documents includes agent sessions and future contributors.

**Ticket-reference identifiers are display, via `labels.ts`.** A work-order number (`WO-0006`) is the one kind
of identifier permitted as display text: it is not an opaque internal id (a UUID, a repo or workspace id, a
path) but the operator-authored reference the operator actually reads and cites — like an issue number. It is
rendered through a `labels.ts` function (`woIdLabel`), never raw JSX interpolation (`{id}`), so the formatting
and any future locale variant are owned by the vocabulary seam and components stay free of display copy. The
number stays in the "Never translated" column — it is domain data, only the rendering is routed. Closed by
WO-0006 (TD-014); the `.replace(` proxy check (c6) never caught `{id}` anyway, so enforcement stays on the
"components carry no display copy" rule rather than a new grep.

## Decision — theming

Light / dark / system, with system as the default. Implemented with semantic tokens (surface, text, border,
and role colours for success / warning / danger) rather than literal colours, so a component never names a
colour that only works in one mode.

Theme is a user preference in the app database, alongside locale.

## Consequences

- A small work order covers both: keyed labels, a locale selector, semantic colour tokens, a theme selector,
  and persistence of the two preferences. It touches `src/ui/` only.
- Any future component that hardcodes a string or a colour breaks one of these two decisions. Worth a lint
  rule rather than a review habit.

## Alternatives rejected

- **Translate documents as well.** Doubles every document and guarantees drift — the rule this project
  applies everywhere else.
- **Locale and theme in `workspace.yaml`.** They belong to the operator, not the project. A second operator
  on the same project should not inherit the first one's theme.
