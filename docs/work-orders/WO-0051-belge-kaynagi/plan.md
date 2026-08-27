# WO-0051 — ✦ Belge kaynağı — plan

Provenance: the approved mockup (`docs/ui-mockups/draft-belge-kaynagi.html` rev 2, `a22c32b`)
+ the operator-approved S1–S7 skeleton (2026-08-28 queue ruling) + a design pass over three
exploration reports whose every load-bearing claim was re-verified against the working tree.
`mode: direct` — no separate plan-approval round (WO-0049 precedent: mockup-approved +
skeleton-approved); this file carries the rulings so nothing depends on session memory.

## Design rulings

- **D1 — input shape.** `docPaths` stays the FLAT union (store-included + external) — the
  prompt wants ONE list. New on `DraftDriveInput`: `freeExplore?: boolean` (the opt-in) and
  `docSource?: { store: number; external: number }` — the dialog-computed COUNTS, for display
  and persistence only, never the prompt. CLI gains `--explore`; the store scan is a GUI
  affordance (documented, not apologized for).
- **D2 — counts-not-paths persistence.** `roadmap_draft` gains nullable `source_summary`
  (JSON `{ store, external, freeExplore }`): written at `plan_ready` (pipeline passes it
  through `saveRoadmapDraft` opts), read through `getRoadmapDraft()`, KEPT across an İtiraz
  resume's summary-less write (the `providerSessionId` keep-prior discipline), deleted with
  the row at approval. Old/garbage rows read as absent (fail-open) — the source part of the
  line omits honestly. Karar 5 ("paths die with the dialog") is intact: counts persist, a
  path never does.
- **D3 — the scan.** IPC `docket:list-decision-docs` → `{ docsRoot, files }` with
  structure-root-RELATIVE posix paths (the ABSOLUTE root never crosses to the renderer). The
  walk (`scanDecisionDocs`) lives in `src/adapters/decision-store`: recursive, `.md` only,
  dot-dirs and symlinked dirs skipped, fail-open `[]` on a missing root. GROUPING is pure
  core (`draftDocGroups`): first-directory-segment groups, root files under `''`; >1 distinct
  group or a lone non-root group → group rows, an entirely-flat root → file rows (frames
  01 vs 02). `draftStorePaths(docsRoot, files)` composes the prompt paths (`docs/adr/x.md`) —
  resolvable from the drive cwd (the decision-store repo root). The workspace's own
  `roadmap.md` is included by default (a re-draft is a revision).
- **D4 — dialog posture.** Countline COLLAPSED by default, store-channel counts only
  (`N belge bulundu · M dahil · yapı kökü docs/`, `· K dizin` tail when grouped); expand →
  group rows with group-level `dışla`/`↩ geri al` (flat scan → capped file rows + the
  `+N belge — tümü dahil` line); the external channel under its own `dışarıdan · N` subhead
  with the tag; `+ Belge ekle` (the existing pickFiles, `data-draft-doc-pick` kept) +
  `Serbest keşif` chip (`aria-pressed`, the `repoChip` idiom) default OFF with ONE
  consequence line when on; the note stays required; zero-selection start = GENERATE; all
  state dialog-local. Excluded rows dim + strike via classes — never `disabled`.
- **D5 — the exploration sentence.** Exactly ONE sentence, iff `freeExplore`, present in
  BOTH the import and generate branches; never contents; test-pinned to appear exactly once.
- **D6 — TD-057.** The card head gains the `PaneLogChip` grammar (only when
  `draft.session` exists); the log body is a SIBLING surface below the card (the card's
  `overflow-hidden` container untouched): identity line (`MİMAR — TASLAK · clock · kaynak ·
  $ · duration`) + `ChatTranscript variant="archived"` + the `auditNoTranscript` empty
  fallback. No new data plumbing — `draft.session` and `draft.sourceSummary` already arrive.
- **D7 — the E2E pick seam.** The native dialog is undrivable; a `DOCKET_E2E`-gated
  staged-pick IPC (`e2e.pickFiles`) in the composition root is the minimum seam — the
  `docket:pick-files` handler returns-and-clears the staged list; invisible in production.
- **D8 — zero-doc floor.** Empty/failed scan → the `belge bulunamadı` LINE (not a button —
  nothing to open); the external channel stays live; start = GENERATE. Same dialog, no second
  form (mockup karar 1).
- **D9 — TD-056, conditional.** Optional `decisionStoreRoot?: string` (absolute) on the drive
  input; main fills it EVERY arrival via `decisionStoreRootFor(input)` (draft → workspace;
  WO → workspace through the join) — the renderer never carries it; the adapter computes
  `roots.decisionStore = input.decisionStoreRoot ?? resolve(cwd, 'docs')`. Both arms shipped
  → TD-056 closes; draft-only → the TD narrows to the WO residue; fights → clean abort.

## Steps

Docs-first commit; core → store/schema/scan → IPC/(D9) → labels+dialog → card chip → E2E →
docs-close. `src/core/` is test-first (ADR-0006); React is verified by running it.

- **S1 (docs — FIRST COMMIT):** this order.md + plan.md. Gate: the docs commit, no code.
- **S2 (core):** `DraftDriveInput` fields; `roadmap-draft.ts` exploration clause +
  `draftDocGroups`/`draftStorePaths`/`DraftSourceSummary`; port signatures
  (`roadmapDraftPromptFor(..., freeExplore?)` additive-optional so old fakes compile;
  `saveRoadmapDraft(..., { sourceSummary? })`); pipeline threads `freeExplore` and spreads
  `sourceSummary` at `plan_ready` iff `docSource`/`freeExplore` present. Tests: exploration
  sentence exactly-once iff (both branches), union list verbatim without channel labels,
  grouping rules (flat/multi/lone-subdir/sorted), `draftStorePaths` joins without `//`;
  pipeline: `sourceSummary` written iff carried. Gate: typecheck + `npm test` +
  `check:boundaries`.
- **S3 (scan + schema + IPC + D9):** `scanDecisionDocs`; `source_summary` column + migration;
  store: keep-prior save, fail-open read, `decisionDocs(wsId)`; `core/source.ts`
  `RoadmapDraft.sourceSummary?`; IPC main/preload/typed; D9 if it fits. Tests: recursive
  walk (`.md`/posix/sorted/dot-skip/missing→[]), persistence + read-back, garbage→undefined,
  keep-prior pin, `freeExplore` thread-through, old-db migration; D9 fence-root override pin
  if shipped. Gate: BOTH typechecks + `npm test` + `check:boundaries`.
- **S4 (dialog + labels):** `RoadmapDraftDialog` rebuilt (D4); `RoadmapPane` source line
  widens (legacy `roadmapDraftSourceLine` stays the fallback); labels tr/en + pins (~18
  keys; `roadmapDraftDocsOptional` copy change; reuse `transcriptOpen/Close`, `auditClock`,
  `formatUsd`, `formatDuration`, `auditNoTranscript`). Gate: typecheck + `npm test` +
  `npm run build` + `check:boundaries` + manual run.
- **S5 (TD-057):** the card chip + sibling log surface (D6). Gate: S4's ladder + a
  screenshot for the review round.
- **S6 (E2E):** the `taslak-depo` world (2 root docs + `adr/`×2 + `notlar/`×1 under
  `docs/`, an external candidate at the repo root, no `roadmap.md`; `TASLAK_DEPO=` line;
  the existing three worlds byte-identical); the D7 seam; 7 specs — opening posture, group
  exclude/restore, external add (store count unchanged), explore toggle (line present/
  absent), default-all start (pane composition line + card `kaynak: 5 belge`), döküm chip
  (identity line + archived transcript + close), CLI `--explore --fake` smoke; the
  `cli.test.ts` flag pin. Gate: `npm run test:ui`, prior suite green.
- **S7 (docs-close, after the operator checkpoint + review + merge):** ADR-0013 + ADR-0016
  addenda, CLAUDE.md clauses, TD-057/056, ROADMAP M6 fourth item, closure sha. Gate: the
  full ladder + the merge.

## ADR / CLAUDE.md / TD sketches

- **ADR-0013 addendum (2026-08-28, WO-0051):** the chip grammar descends to the TASLAK card
  — the finished draft's transcript is one `Dökümü aç/kapat` away (default closed): identity
  line + archived transcript, the card-level twin of `PaneLogChip`; the record-card stance is
  unchanged (the draft session still never enters a ledger — D15).
- **ADR-0016 addendum (2026-08-28, WO-0051):** the draft's source set is a free composition
  of channels — depo scan (structure root, all included by default, group-level exceptions)
  ∪ dışarıdan (any path) ∪ serbest keşif (opt-in) + the goal note; the prompt carries the
  path UNION as one list plus at most ONE exploration sentence — contents never; persistence
  carries COUNTS, never paths (`source_summary`, dying with the row); the scan lists paths
  only (a content reader would be the source-format parser by other means); the workspace's
  own `roadmap.md` is included by default (a re-draft is a revision).
- **CLAUDE.md:** one clause in the Single-view ADR-0013 paragraph (the TASLAK card's döküm
  chip) and one in the Roadmap-layer ✦-draft bullet (channel composition + counts-not-paths).
- **TD-057:** closed by WO-0051 (merge sha). **TD-056:** closed if D9 shipped both arms;
  otherwise narrowed to the WO-architect residue and left open.

## Verification ladder + checkpoint

1. `npm run typecheck` (both tsconfigs) 2. `npm test` 3. `npm run check:boundaries`
4. `npm run build` 5. `npm run test:ui` — per stage as its gate lists; the full set on the PR.

Operator checkpoint (before test rounds / PR): the in-app walkthrough — ✦ dialog: default-all
start on a full root · group exclude/restore · external add · explore chip with its line;
TASLAK card: the döküm chip + identity line + transcript. Presented with screenshots;
approval gates the rest (deferral is the operator's, written into order.md if used).

## Risks

- **R1 — the default posture flips full workspaces to IMPORT** (docket's own root ≈ 90
  paths). Intended (karar 3); the group exclude is the tool; WO-0050's empty-root E2E worlds
  keep GENERATE semantics byte-identical.
- **R2 — brittle dialog-content assertions in existing specs** — the empty-world semantics
  are unchanged; only assertions naming the old docs-field copy get maintenance.
- **R3 — signature ripples** — additive-optional `freeExplore` keeps pipeline/CLI fakes
  compiling; recorders extend, not rewrite.
- **R4 — prompt growth** (~4 KB at 90 paths) — accepted, no cap by design (default ALL).
- **R5 — scan edge cases** — snapshot semantics (state dies with the dialog anyway); skip
  dot-dirs/symlinks; fail-open on a missing root.
- **R6 — card head layout** — the chip wrapped `self-center`; the log body a sibling, not a
  child, of the `overflow-hidden` card.
- **R7 — the E2E seam leaking** — `DOCKET_E2E`-gated on both ends; the pick handler only
  consults the staged slot the gated IPC sets.
- **R8 — D9 fights** — the planned clean abort: TD-056 stays open, narrowed; nothing else
  depends on it.
