---
id: WO-0013
title: UI redesign port — approved warm-dark design into the real renderer
workspace: docket
status: draft # draft | planning | plan-review | implementing | review | audit | merging | closing | closed
mode: direct # plan | direct
review: light # light | full
tracks:
  - repo: app
    depends_on: []
---

# WO-0013 — UI redesign port

## İçindekiler

- [Objective](#objective)
- [Context](#context)
- [Scope](#scope)
- [Decisions](#decisions)
- [Acceptance criteria](#acceptance-criteria)
- [Evidence required](#evidence-required)
- [Notes](#notes)

## Objective

Port the approved UI direction (`design-mock/index.html`, PR #10) into the real React renderer on the
**existing domain model** (no new model fields). The current renderer is flat/generic (indigo-on-slate,
3-column board, always-on 9-stage rail + 3-valued evidence grid) and English; the approved direction is
warm dark "aged-paper-meets-terminal", **evidence-ticket** cards, a two-bucket board, session-centric
detail, **Turkish**. This is the foundation for later UI WOs (workspace CRUD→WO-0014, WO
creation→WO-0015, plan-steps→WO-0016).

## Context

- `design-mock/index.html` (PR #10) — the approved visual direction + screens + data model.
- `docs/PRODUCT.md` — the product spec.
- `src/core/types.ts` (`WorkOrderCardView`, `WorkOrderDetailView`), `src/core/derive.ts`
  (`toCardView`/`toDetailView`/`whoseTurn`/`deriveCardReason`/`derivePrimaryAction`).
- `src/ui/` component tree (Board/BoardColumn/WorkOrderCard, detail/*, session/*, chrome/*, labels.ts).
- `src/index.css` = `@import "tailwindcss";` (Tailwind v4 via `@tailwindcss/vite`).

## Scope

In scope:

- **Token system** (`src/index.css`): Tailwind v4 `@theme` palette + fonts, `html.light` override, base
  (`:focus-visible`, `details>summary`), and the signature component classes (`.perf`, `.bar`, `.pulse`,
  `.alink`, `.btn-primary`/`.btn-ghost`, `.evx`/`.evblank`/`.err`/`.evexempt`). Plex via `<link>` interim.
- **Board**: two buckets ("Sıra sende" / "Çalışıyor") + a `▾ Kapalı` `<details>` drawer; evidence-ticket
  cards (bar+perf strip from bucket, inline `▸ action`). Delete `BoardColumn.tsx`.
- **Detail**: ActionCard (read-only "what's needed" banner — no buttons; controls stay in SessionPane),
  SessionPane as the spine, three-valued evidence prose line, and a `▾ Akışı göster` expander demoting
  StageRail + EvidencePanel + TrackLane + SourceLinks + owned docs.
- **Chrome + settings**: sticky header (`▎ workspace ▾` + gear), workspace popover (read-only), and an
  App-settings modal (theme that actually swaps `<html>` classes; language inert; version).
- **Core (test-first)**: `BoardBucket` + `deriveBucket` (external→working), `WorkOrderCardView` +=
  `bucket`/`actionRank`/`action?`/`role?`.
- **`labels.ts` → Turkish** + `version.ts`.

Out of scope (deferred):

- Plan-steps list + review-mode radio → **WO-0016**.
- Context files → **WO-0015**.
- Workspace CRUD + repo connections + the ws modals → **WO-0014** (switcher stays read-only here).
- Work-order creation modal → **WO-0015** (no create button yet).
- en/tr toggle wiring → **M3.5** (this WO ships Turkish; the language control is inert).
- Fixing `card.id` / `track.repo` raw render → **WO-0006** (TD-014; carried, not fixed here).
- Self-hosting Plex woff2 → fast-follow (TD); `<link>` interim now.

## Decisions

- Build on **merged #9 (xterm)** — `Terminal.tsx` is the session spine, kept as-is.
- Ship **Turkish** labels now; ADR-0007 addendum records `tr` as the live locale, en/tr selector at M3.5
  (documented partial application — the rule is "copy in one module", locale-agnostic).
- **ActionCard has no buttons** — avoids double-wiring the runner (controls live in SessionPane) and the
  `disabled`-control ban (ADR-0001). Open a TD.
- `external` board column folds into **"Çalışıyor"** (forge/CI work happening without the operator).
- Evidence stays **three-valued** (`satisfied`/`unsatisfied`/`exempt`); the mock's boolean is not adopted.

## Acceptance criteria

1. The renderer matches the approved mock for the in-scope surfaces: warm-dark palette, Plex, ticket
   cards, two-bucket board + Kapalı drawer, session-centric detail, Akışı göster expander.
2. `deriveBucket` maps work orders to `up`/`working`/`closed` (external→working); card view carries
   `bucket`/`actionRank`/`action?`/`role?`. Covered test-first in `src/core`.
3. The board sorts "Sıra sende" by action rank; the Kapalı drawer collapses closed work orders.
4. The ActionCard is a read-only banner per `PrimaryAction`/`CardReason`; no `disabled` controls.
5. Evidence prose renders all three values (`[x]`/`[ ]`/`[~]`); per-track scope shown.
6. The settings modal theme toggle live-swaps the palette; language is inert (not disabled); version line.
7. UI copy is Turkish, all from `labels.ts` (no hardcoded copy; no `.replace(` in `src/ui/`).
8. `npm run typecheck` (both), `npm test`, `npm run build`, `npm run check:boundaries` are green.

## Evidence required

- plan_approval: n/a (`mode: direct`, `review: light` — solo; gates operator-covered)
- pr_open: PR URL, head sha
- ci_green: all required checks `success` (observed, not enforced — TD-013)
- verification: the derive tests; run-verify mock parity (board/detail/chrome/theme); GUI rendering is
  operator-pending
- closure: all tracks merged, ROADMAP updated, TDs opened (ActionCard wiring; fonts self-host)

## Notes

- Solo; gates operator-covered. Test-first for the `core` additions; `src/ui/` is run-verified.
- **Boundary watch**: no `cursor` token in new chrome (check 1 greps it word-boundary-less); no
  `disabled`/`aria-disabled`; `labels.ts` discipline; `card.id`/`track.repo` raw render carried (TD-014).
