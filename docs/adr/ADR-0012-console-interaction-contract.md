# ADR-0012 — Console interaction and micro-copy contract

## İçindekiler

- [Context](#context)
- [Decision — one interaction contract](#decision--one-interaction-contract)
- [Decision — empty states are invitations](#decision--empty-states-are-invitations)
- [Decision — no explainer copy](#decision--no-explainer-copy)
- [Decision — no jargon or mixed-case headers](#decision--no-jargon-or-mixed-case-headers)
- [Decision — keyboard hints are never standing text](#decision--keyboard-hints-are-never-standing-text)
- [Decision — a density band](#decision--a-density-band)
- [Decision — a juice contract](#decision--a-juice-contract)
- [Consequences](#consequences)
- [Alternatives rejected](#alternatives-rejected)

- Status: accepted
- Date: 2026-08-17
- Deciders: Enes (operator), architect session

## Context

After WO-0031c put the v4 console live, the operator toured the app. The layout spine held; what
drifted was everything around it. Hover feedback had forked into nine hand-rolled dialects — some
buttons wash, some only brighten their glyph, and a handful of clickable rows have no hover at all.
Every modal carried an explainer paragraph under its title. The board opened with a slogan header
and, on an empty database, rendered three bucket frames around two dashed "nothing here" boxes while
the appbar itself was missing. Keyboard hints stood as rendered text (`ESC GERİ`) next to controls
that already had affordances. Detail content sat in wide 24px gutters the operator read as
"her şey çok geniş boş". And the moment of closure — the payoff of the whole pipeline — was a flat
one-line card.

These are one problem: the console never had a written contract for interaction, copy, density or
motion. This ADR is that contract, delivered with WO-0031d's enforcement sweep.

## Decision — one interaction contract

Every interactive surface answers hover, active and focus the same way:

- **Focus** is the global signal ring already defined once in `src/index.css`.
- **Active** is the kit's press scale (`active:scale-[0.955]` in `kit/Button`).
- **Hover** flows through exactly three semantic classes in `src/index.css` — `.ibtn` (quiet icon
  button), `.irow` (selectable row wash), `.ichip` (bordered mono chip, with `.ichip-on` for its
  selected state) — or through `kit/Button` variants, which remain the only variant system.

Hand-rolled `hover:*` utilities on ad-hoc buttons are banned. Two idioms are named exceptions
because they are not buttons: the work-order card's lift (a card, not a control) and the text link's
underline (`.alink` family).

## Decision — empty states are invitations

An empty surface renders one short line and at most one action. A group with nothing in it — bucket,
section, drawer — renders nothing at all. This extends ADR-0001's "absent, not disabled" from
actions to surfaces: an empty frame is the layout's way of saying "disabled".

The first-run experience is the extreme case: an empty database shows the real appbar (brand and the
normal Settings — never a second, lesser chrome) and one invitation line with one CTA. The words are
the operator's: "Haydi ilk iş emrini açalım".

## Decision — no explainer copy

Helper and instructional paragraphs are banned. Field names and option labels must carry their own
meaning; if a control needs a sentence of instruction, the control is wrong. Informative lines stay
and are distinguished by saying something true about state rather than telling the user what to do:
absence reasons ("önce oturumu durdur"), consequences of irreversible actions ("Geri alınamaz."),
and state facts like "maliyet işlemez". The operator's test: instructions die, information stays.

## Decision — no jargon or mixed-case headers

A header is a plain Turkish word. `TRACK’LER (ILGILI REPOLAR)` — jargon, apostrophe plural, and a
mixed-script parenthetical in one — is the canonical offense; the display word is `Repolar`
(internal identifiers are untouched; ADR-0007 already separates the two worlds). Uppercase styling
is a CSS concern (`.readout`), never baked into the string.

## Decision — keyboard hints are never standing text

No hint renders as persistent text (`ESC GERİ` dies). Discoverability is affordance and shape, not
instruction. The single exception is the rail primary's `⏎` badge, which marks one concrete button
at the moment it matters — a label on a control, not standing text.

## Decision — a density band

Sibling content gaps sit in a 12–14px band (`gap-3`/`gap-3.5`); screen gutters are one 20px step;
the board caps at 840px and the detail console at 1160px. The console is a queue that reads
vertically on a laptop, not a dashboard that spreads. Numbers may be tuned by later dogfood; the
band is the contract.

## Decision — a juice contract

Motion is feedback, not decoration, and lives by six rules (the operator's, from the v4 mockup §7):

1. Motion fires on **state transitions only**, never on mount or reload — reopening a finished
   thing is calm.
2. Every animation is **≤400ms**.
3. `prefers-reduced-motion: reduce` turns every animation off via the one CSS block — no
   per-component exemptions.
4. The **cost counter is never animated**. Money does not celebrate.
5. **SADE stays calm**; juice lives in DETAY and in result moments.
6. No meta-game: no points, no badges, no sound. Feedback is visual and short — a flash, a drawn ✓,
   a filling hairline, a closure seal.

## Consequences

- WO-0031d's sweep (labels.ts dispositions, the interaction-class migration, the density pass) is
  the enforcement pass; review and dogfood are the ongoing gate.
- A mechanical CI check for `hover:` outside `kit/` and the semantic classes is a candidate future
  grep, deliberately not built in the same pass as the migration.
- New surfaces get their empty state and their hover class in the same PR that adds them — the
  contract is one thing, not two.
- CLAUDE.md carries the rules in short form, per ADR-0011.

## Alternatives rejected

- **Per-surface hover freedom.** WO-0031c shipped nine dialects in three weeks; freedom is how the
  drift happened.
- **Skeletons/spinners for empty groups.** An empty group is not "loading nothing" — it is absent.
  (Load-state skeletons remain a separate TD-037 question about *loading*, not emptiness.)
- **Celebration escalation** (confetti, sounds, streaks). Rejected by the operator as meta-game;
  the seal and the flash are the ceiling.
