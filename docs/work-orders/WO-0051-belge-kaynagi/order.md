---
id: WO-0051
title: "✦ Belge kaynağı — the draft's channel composition (store scan ∪ external ∪ free exploration), the TD-057 döküm chip"
workspace: docket
status: open
mode: direct
review: light
review_mode: gates
tracks:
  - repo: app
    depends_on: []
---

# WO-0051 — ✦ Belge kaynağı — the draft's channel composition (store scan ∪ external ∪ free exploration), the TD-057 döküm chip

## Objective

The ✦ roadmap-draft dialog learns how source documents actually REACH the architect: not one
fixed form but the operator's free composition of channels — a **depo scan** (the structure
root's `.md`s, scanned at dialog open, ALL included by default, exceptions excluded at GROUP
level) ∪ **dışarıdan paths** (any path via the native picker, including outside the structure
root and outside the repo) ∪ **serbest keşif** (an opt-in chip, default OFF: the architect may
browse the repo itself, at token cost) + the goal note (required as ever — the zero-doc floor).
The prompt carries the path UNION as one list plus, iff exploration is on, exactly ONE
exploration sentence — contents never (ADR-0016). Plus **TD-057**: the finished TASLAK card
gains the `Dökümü aç/kapat` chip — the draft session's transcript one click away. TD-056 (the
fence root aligned with `docs_root:<wsId>`) rides along if it fits the scan stage cleanly.

## Context

- **Acceptance basis: mockup frames 01–03** (`docs/ui-mockups/draft-belge-kaynagi.html`, rev 2,
  approved 2026-08-28, commit `a22c32b`). Rev 1 offered three forms (A exploration / B
  selection / C pre-folded); the operator's revision found the right question — **the form is
  not chosen, the channels are composed**. One dialog stays; the source set is the operator's
  free composition. Frames drawn against two real workspaces: antreo-app (clean repo, ~10 faz
  docs) and docket's own root (90 `.md` — 18 signal, ~70 work-order noise).
- **Mockup rulings (locked, 2026-08-28).** (1) The source set is the union of channels; empty
  set = generate from the note alone — the SAME dialog's floor, no second form. (2) Depo scan
  defaults to ALL included; the exception is excluded — at group level where the scan has
  directories (docket scale: 70 work orders drop with one touch). (3) Defaults discipline: the
  ordinary flow (a full store) is zero selection work and deterministic — `Taslağı başlat`
  sends everything while the countline stays collapsed; exploration is opt-in because it costs
  tokens (queue item 2 alignment). (4) The prompt carries paths + one exploration clause,
  never contents; the read fence is always open for the architect (`fenceDecision` verified:
  reads allow, writes fence to the decision-store root). (5) Paths die with the dialog — no
  persistent setting, no DB; the goal note stays required; the budget gate and the busy line
  unchanged. (6) TD-056 is not visual (no mockup frame); TD-057 is frame 03.
- **What WO-0050 left in place (verified):** `DraftDriveInput` already carries `goalNote` +
  `docPaths` (the manual picker's flat list); the prompt's IMPORT/GENERATE branches assemble
  paths-never-contents; `draft.session` already reaches the TASLAK card (today only the
  İtiraz resume seed); the `PaneLogChip` grammar, `ChatTranscript variant="archived"` and the
  `SessionCards` card-expand precedent all exist. Missing: the store scan (no recursive `.md`
  walk exists), the channel counts anywhere persistent (the live pane's source line dies with
  the renderer), and the card's transcript surface (TD-057).
- **The counts-not-paths ruling (this WO's D2):** frame 03's kaynak line (`kaynak: 11 belge +
  1 dışarıdan`) must survive the drive's end, yet karar 5 keeps paths dialog-mortal. The
  resolution: the pending `roadmap_draft` row gains a nullable `source_summary` of COUNTS and
  the explore flag — never a path — written at `plan_ready`, kept across an İtiraz resume,
  deleted with the row at approval. Counts are the composition's memory; paths die on schedule.
- **The workspace's own `roadmap.md` is included by default** (a re-draft is a revision — the
  prior document is a primary source; the prompt already names the destination). The operator
  who disagrees excludes the root group.
- **Design pass:** three exploration agents (core/pipeline, UI carriers, records conventions)
  re-verified against the working tree, plus one design pass — every load-bearing claim above
  cites code. The operator pre-approved the S1–S7 stage skeleton (2026-08-28 queue ruling).

## Scope

In scope:

- Core (test-first, ADR-0006): `DraftDriveInput` gains `freeExplore?: boolean` +
  `docSource?: { store: number; external: number }` (dialog-computed COUNTS — display and
  persistence only, never the prompt) + (conditional, D9) `decisionStoreRoot?: string`;
  `roadmap-draft.ts` gains the exploration clause (ONE sentence, iff `freeExplore`, in BOTH
  the import and generate branches) and the pure helpers `draftDocGroups` /
  `draftStorePaths` / `DraftSourceSummary`.
- Port + store: `roadmapDraftPromptFor(..., freeExplore?)` (additive optional — old fakes
  compile); `saveRoadmapDraft(..., { sourceSummary? })`; `roadmap_draft.source_summary`
  (nullable JSON) + the PRAGMA-guarded migration; keep-prior on a summary-less resume write;
  fail-open parse on read; `decisionDocs(wsId)` public read (`{ docsRoot, files }` — the
  ABSOLUTE root never crosses to the renderer).
- Scan adapter: `scanDecisionDocs(structureRoot)` in `src/adapters/decision-store` — the
  recursive `.md` walk, PATHS ONLY (dot-dirs and symlinked dirs skipped, fail-open on a
  missing root).
- IPC: `docket:list-decision-docs` (main + preload + typed), called at dialog open.
- UI: `RoadmapDraftDialog` rebuilt as the channel composition (collapsed countline · grouped
  exclude/restore · capped flat file rows + moreline · external subhead + tag · `+ Belge ekle`
  · `Serbest keşif` chip with its ONE consequence line · `belge bulunamadı` floor);
  `RoadmapPane`'s live source line widens to the composition; `RoadmapDraftCard` gains the
  TD-057 döküm chip + the sibling log surface (identity line + archived transcript).
- CLI: `roadmap draft --explore` (the store scan stays a GUI affordance — documented).
- E2E: the `taslak-depo` world; the `DOCKET_E2E`-gated staged-pick seam (`e2e.pickFiles`);
  specs for opening posture, group exclude/restore, external add, explore toggle,
  default-all start (pane + card kaynak lines), the döküm chip, and the CLI `--explore` smoke.
- Docs: ADR-0013 addendum (the chip grammar descends to the card), ADR-0016 addendum (the
  channel composition + counts-not-paths + own-roadmap.md rulings), CLAUDE.md clauses, TD-057
  closed, TD-056 closed-if-shipped, ROADMAP M6 fourth item.

Out of scope:

- Reading any document's CONTENTS anywhere (the scan lists paths — a content reader is the
  source-format parser ADR-0016 rejects, by other means).
- Persistent source settings or DB PATH lists beyond the pending row's counts (karar 5: paths
  die with the dialog).
- A CLI store-scan flag (the scan is a GUI affordance).
- A ledger/board surface for the draft session (WO-0050 D15 stands — the card chip is the one
  window; after Onayla the roadmap file + git is the record).
- Steer/wo_event on drafts, re-sync import, task auto-spawning (all WO-0050 out-of-scope
  rulings stand).
- Forcing TD-056: if the per-workspace fence root fights the adapter contract, the TD stays
  open with its text narrowed to what shipped.

## Acceptance criteria

1. **Frame 01 — default posture:** opening ✦ scans the structure root (`docs_root:<wsId>`,
   default `docs/`); the dialog shows the collapsed countline (`N belge bulundu · M dahil ·
   yapı kökü docs/`, with the directory count when grouped); with nothing touched,
   `Taslağı başlat` dispatches ALL scanned docs + the goal note — zero selection work,
   deterministic, no exploration sentence.
2. **Group exclude:** an expanded multi-directory scan renders group rows (root files = the
   `kök` group); `dışla` drops a whole group and its count, `↩ geri al` restores it; an
   entirely flat scan renders file rows (capped) + the `+N belge — tümü dahil` line.
3. **Frame 02 — external + exploration:** `+ Belge ekle` adds any path (structure-root and
   repo outside included) under the `dışarıdan · N` subhead with its tag; the `Serbest keşif`
   chip is OFF by default; ON shows exactly ONE consequence line and adds exactly ONE
   exploration sentence to the prompt. The prompt carries the union as ONE list — no channel
   labels, never contents (test-pinned).
4. **Zero-doc floor:** an empty or failed scan renders `belge bulunamadı`; the external
   channel stays usable; a zero-selection start takes the GENERATE branch (a live button,
   never locked — ADR-0001).
5. **Frame 03 — TD-057:** after the drive ends the TASLAK card head carries the
   `Dökümü aç/kapat` chip (default closed; only when a session row exists); opening reveals
   the identity line (`MİMAR — TASLAK · clock · kaynak: N belge + M dışarıdan(· keşif) · $ ·
   duration`) and the archived transcript (empty → the no-transcript line); NULL/old rows
   omit the source part honestly.
6. **Persistence:** `source_summary` is written at `plan_ready`, read through
   `getRoadmapDraft()`, KEPT across an İtiraz resume's `plan_ready`, and dies with the row at
   approval; a garbage value reads as absent (fail-open).
7. **CLI + gates:** `roadmap draft --explore` threads the flag; the budget gate, the busy
   line, the note-required validation and the supersede guard are unchanged; core
   prompt/grouping/summary behaviors are test-pinned; E2E covers the seven new scenarios with
   the prior suite green.
8. **TD-056 (conditional):** if shipped, the architect fence's decision-store root aligns
   with `docs_root:<wsId>` via the main-filled `decisionStoreRoot` for both drive arms;
   otherwise the TD entry is narrowed to what shipped and stays open.

## Evidence required

- plan_approval: n/a — mode: direct (the mockup rev 2 + the operator-approved S1–S7 skeleton
  are the plan; `plan.md` records the design rulings).
- operator_checkpoint: PENDING — the in-app walkthrough of the three channels (default-all
  start · group exclude/restore · external add · explore chip) and the TASLAK card's döküm
  chip, presented with screenshots; test rounds do not run before this approval (the standing
  workflow rule; deferral is the operator's to grant and gets written here).
- ci: the PR runs the full ladder — typecheck (both), `npm test`, `check:boundaries`,
  `build`, `test:ui` (TD-012: `ci_green` is not exempt).
- closure: the merge sha + ROADMAP M6 tick + TD-057 (and TD-056 if shipped) updates, proven
  by the closure commit.

## Closure

PENDING.

## Stop-and-ask gates

- Reading source-document CONTENTS into the prompt, the DB, or anywhere else — paths and
  counts only (ADR-0016's rejected alternative, unchanged).
- Persisting source PATHS anywhere (the summary is counts + a flag; a path column or setting
  contradicts karar 5).
- Any host-side budget work-around or force flag (WO-0047's line — the gate stays in the
  pipeline).
- Rendering raw faz/task ids (`fazLabel`/`fazIdLabel` only — ADR-0007's addendum); path
  truncation via CSS, never `.replace(` in `ui/`.
- A `disabled`/`aria-disabled` attribute in `src/ui/` (ADR-0001 — dimmed classes + reason
  lines are the vocabulary).
- The fs walk outside `src/adapters/` (or the composition root) — grouping and path joins are
  pure string work in core (ADR-0006 + the boundary CI).

## Notes

- The default posture FLIPS full workspaces to the import branch (docket's own `docs/` ≈ 90
  paths ≈ 4 KB of prompt) — intended (mockup karar 3); the group exclude is the operator's
  noise tool. The existing WO-0050 E2E worlds keep empty roots, so their GENERATE semantics
  survive byte-identical.
- The E2E pick seam (`e2e.pickFiles`) is `DOCKET_E2E`-gated and lives in the composition root
  — invisible in production; the native dialog itself is undrivable.
- The İtiraz resume path is untouched by construction: it pre-fills `prompt`, so
  `prepareDriveInput` never re-assembles — and the keep-prior discipline preserves the
  original composition figures through the objection round.
- Successor pressure valve: if TD-056 (D9) overruns S3, drop it without guilt — the TD entry
  narrows, nothing else in this WO depends on it.
