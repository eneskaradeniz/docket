# ADR-0007 — Localisation and theming

## İçindekiler

- [Context](#context)
- [Decision — localisation](#decision--localisation)
- [Decision — theming](#decision--theming)
- [Consequences](#consequences)
- [Alternatives rejected](#alternatives-rejected)
- [Addendum — 2026-08-24 (WO-0040: theming revived)](#addendum--2026-08-24-wo-0040-theming-revived)
- [Addendum — 2026-09-23 (WO-0100: native chrome vocabulary)](#addendum--2026-09-23-wo-0100-native-chrome-vocabulary)

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

**Addendum (2026-08-27, WO-0049): the roadmap's faz/task ids join the carve-out.** A faz id (`f0`) or task
id (`f0-t3`) from roadmap.md's ```fazlar fence is the same KIND of thing as `WO-0006` — the operator-authored
reference the operator reads and cites (order.md's `task:` key names it verbatim), not an opaque internal id.
It renders through the same seam: `fazIdLabel` for the raw marker (the done-fold's `f0 · f3` run — the
approved mockup frame 02) and `fazLabel` for the word form (`FAZ 4`). Everything else stays as it was: a raw
id never reaches JSX as display copy, and the label functions are the only route.

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

## Addendum — 2026-08-21 (WO-0035: the en/tr selector ships)

Two debts paid and one clause superseded:

- **The live locale is `tr` — since WO-0013.** WO-0013 promised this addendum and never wrote it;
  CLAUDE.md kept saying "UI copy is English" long after the Turkish pass landed. Recorded here,
  corrected there.
- **The selector shipped** (WO-0035): per-locale bundles at `src/ui/data/labels/{tr,en}.ts`, read
  only through `useLabels()` (`src/ui/data/locale.tsx`); the preference persists in `app_setting`
  exactly as this ADR ruled — a property of the operator, never of the project. A fresh install
  with no stored choice detects the system language (`navigator.language` tr-prefix → tr, else en;
  operator ruling 2026-08-21); detection is renderer-side presentation and only an explicit pick
  is ever written.
- **"En as the fallback for any missing key" is superseded by the type system.** Both bundles
  satisfy one derived `Labels` type (`type Labels = typeof tr`), so a missing key is a compile
  error — the fallback rule now holds vacuously. A runtime parity test remains as a belt
  (`labels/labels.test.ts`).
- **The theming half of this ADR is dead.** Dark-only is the ruling (ADR-0012, recorded in
  `src/index.css`); the M3.5 theme bullet dies with it. Noted here, not re-decided.

## Addendum — 2026-08-24 (WO-0040: theming revived)

The operator reversed the 2026-08-21 dead-note; the 2026-08-24 ruling below supersedes it. The
earlier note stands as history.

- **Three modes.** Sistem (follows the OS, the default when nothing is picked — live, via
  `matchMedia`), Açık, Karanlık. One `Tema` Segmented in Settings under the DİL section (the
  WO-0035 pattern). A fresh install with no stored choice never writes one — detection is
  presentation, the locale precedent.
- **The faces.** Karanlık is layered black (`#000000` ground, `#0a0a0a` surface, `#171717`
  raised, `#262626` hairline, `#f2f2f2`/`#8f8f8f` ink) — replacing the navy palette, per the
  operator's explicit ask. Açık is pure white (`#ffffff` ground and surface, `#f2f2f0` raised,
  `#e3e3e0` hairline, `#191917`/`#6e6e69` ink). Accents keep their dark values in Karanlık and
  gain light variants holding ~4.5:1 as text on white (`#9a6700` signal, `#1a7f37` proceed,
  `#0969da` info, `#cf222e` error); lamps and glows follow via `color-mix`.
- **Persistence narrowed vs the original body** ("a user preference in the app database,
  alongside locale"): theme is renderer-local localStorage (`docket.theme`), per the standing
  ruling in `src/core/app-settings.ts` — only the GUI renders colour, so the preference is
  presentation-only and machine-local, like window state. No port member, no DB row; the locale
  keeps its `app_setting` row (words travel across hosts, colour does not).
- **The mechanism is the original decision's, unchanged:** semantic tokens only. `@theme` holds
  the dark defaults (and doubles as the no-attribute fallback, so a dark room never flashes);
  one `:root[data-theme='light']` block in `@layer base` is the whole light theme; `src/ui`
  keeps zero colour literals. ADR-0012's interaction/motion contract is theme-agnostic and
  untouched by this revival.

## Addendum — 2026-09-23 (WO-0100: native chrome vocabulary)

WO-0100 gives the app a native menu and a tray. Both are host chrome: the OS draws them from the main
process, and no component renders them. Two rulings follow, both operator-approved on 2026-09-23 (the
WO-0100 plan, §3 and §14):

- **Native chrome words live in `electron/chrome-words.ts`, fixed in Turkish.** The per-locale bundles
  (`src/ui/data/labels/`, read through `useLabels()`) stay the COMPONENT display surface this ADR
  governs. The native vocabulary is about 25 words: the menu labels, the tray's header, quiet line,
  row and secondary words, and the log lines of the honest degrade. It sits in one frozen
  `CHROME_WORDS` table outside `src/ui`, because importing `src/ui/**` from `electron/` would make
  the host depend on the UI layer (ADR-0006). The table does not follow the UI locale. That is a named
  follow-up (TD-062): an `en` table beside it, rebuilt from the set-locale handler. The
  "components carry no display copy" rule is untouched, because the table is not a component and
  `src/core/tray-menu.ts` emits structure only.
- **Native chrome renders the WO number verbatim.** A tray row reads `WO-0093 · <title>`: the id
  comes straight from main's owner entry, not through `woIdLabel`. This is a second, host-side
  carve-out beside the component one above. It changes nothing today, since `woIdLabel` is the
  identity in both bundles. When chrome follows the locale (TD-062), the row goes through the same
  formatter `woIdLabel` uses, so the two surfaces cannot drift.
