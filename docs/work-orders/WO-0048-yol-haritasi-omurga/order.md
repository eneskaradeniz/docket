---
id: WO-0048
title: Roadmap spine — roadmap.md format, derived faz/task views, the task link, the structure root
workspace: docket
status: draft
mode: plan
review: light
review_mode: gates
tracks:
  - repo: app
    depends_on: []
---

# WO-0048 — Roadmap spine — roadmap.md format, derived faz/task views, the task link, the structure root

## Objective

The data spine of the **roadmap layer** — the planning surface ABOVE the work order (roadmap →
faz → task → work order) — with NO GUI (WO-0049) and NO LLM drive (WO-0050): a per-workspace
`roadmap.md` in the decision store carrying fazlar and tasks in one machine fence; a test-first
pure core that parses, diagnoses, builds and surgically edits it; derivation functions that turn
the parsed spec plus linked work orders into `RoadmapView/FazView/TaskView` (status is NEVER
stored — task status derives from its WOs, faz status from its tasks); the task→WO link carried
ONLY in order.md front-matter (`task:`); the workspace **structure root** setting (default
`docs/`, `.docket/` one setting away); CLI `roadmap show|validate` + `create-work-order --task`.

## Context

- **Planning round 2026-08-27 (operator-approved).** Four locked decisions: (1) tasks are
  persistent, WOs are linked 1:N, statuses derived; (2) generation and import are ONE mechanism —
  an architect draft session (WO-0050), no source-format-specific import parser; (3) the feature
  splits WO-0048 (spine) → WO-0049 (GUI) → WO-0050 (AI); (4) the surface is a sibling screen
  (`Pano | Yol Haritası`) — board and detail untouched (detail gains one chip).
- **The real scenario is antreo-app** (`~/source/antreo-app/{api,mobile,docs}`; decision store =
  the docs repo; 9 faz docs `faz-0..8-*.md`, 20–106 lines each, with status lines, `N.M` decision
  sections, decision-summary tables, cross-faz dependencies — faz-2 blocked by faz-4). Today the
  operator runs this by hand: "Ana Görev / Görev N" issues, `[API]`/`[Flutter]` labels, manual
  cross-links. This layer is that pattern, in Docket.
- **Mockup (approved, 7 frames):** `docs/ui-mockups/wo-0048-yol-haritasi.html` — the acceptance
  basis for WO-0049 (faz strip minimap, per-faz task fill, `sıradaki` marker, collapsed done
  fazlar, the ✦ dialog, the TASLAK decision card, prefilled spawn, the detail chip). Tour
  rulings folded in: empty surface keeps ONE action (✦); NO faz label on board cards; NO reward
  pulse when a task flips Tamam; BEKLİYOR task rows dim + actionless; collapsed-past fold sits at
  the TOP (chronological read; the board's closed list stays bottom).
- **ADR-0016 comes first** (new): the roadmap layer supersedes ADR-0008's blanket no-planning-
  surface stance FOR THIS ARTIFACT while keeping its two disciplines (status is derived, never
  dragged; a model never invents work unreviewed — the WO-0050 draft is an architect plan-mode
  session approved and committed by the operator). ADR-0010-clean: document text lives in git,
  the DB persists only run outcomes (+ the pending-draft row, the `plan_original` exception).
- **roadmap.md format** (the ```steps tradition): front-matter (`workspace`, `title`) + free
  prose + exactly ONE ```fazlar fence holding a JSON array — fazlar
  `{id, title, aim?, blockedBy[], notes?, tasks[]}`, tasks `{id, title, repo?, note?}`. Ids
  explicit, stable, `^[a-z0-9][a-z0-9-]*$`, unique across the roadmap (`f0`, `f0-t1`); minted by
  pure `nextFazId`/`nextTaskId`. Keys English, values verbatim in the operator's language (the
  `aim` precedent). **Status appears nowhere in the file** — `blockedBy` is data, not status.
  No backlinks: a task never lists its WOs.
- **The task→WO link lives ONLY in order.md front-matter** (`task: f1-t3`): `buildOrderMd`
  writes it, `parseOrderMd` reads it, `applyOrderMdEdits` sets/drops it. NO `work_order.task_ref`
  column — a DB column would be a denormalized cache of document text (ADR-0010 rule 1's stalest
  copy); `getRoadmap` joins by reading the workspace's order.md files at view time (solo scale,
  roadmap screen only; the cost is tech-debt-noted).
- **Derivation (`src/core/roadmap.ts`, the budget.ts module shape):**
  `taskStatusOf(linked)` — no WO → `planli`; any open WO → `kosuyor`; all closed (≥1) → `tamam`.
  `fazStatusOf` — any task `kosuyor` → `kosuyor`; any blocker not `tamam` → `bekliyor`;
  tasks>0 and all `tamam` → `tamam`; else `planli` (vacuous truth refused). The spawn action
  (`İş emri aç`) is available on a `planli` task with a resolved repo in an unblocked faz;
  otherwise ABSENT with a structural reason (`kosuyor|bloke|repo_yok`) — ADR-0001. Named edge
  cases, each a test: unresolved repo slug, empty/absent roadmap (invitation + `parseError`
  line), orphan WO (`task:` points at a deleted task — invisible on the roadmap; the detail chip
  degrades to a qualifier, raw ids never render), zero-task faz, blockedBy cycles (both
  `bekliyor` + a diagnostic warning; self-block is a diagnostic error).
- **Parser contract (`src/core/roadmap-md.ts`, sibling of order-md.ts):** `parseRoadmapMd` is
  all-or-nothing (missing fence / non-JSON / any bad element → `fazlar: []`, never partial);
  `roadmapDiagnostics` names hand-edit errors (no fence, duplicate id, bad id shape, empty
  title, unknown/cyclic/self blockedBy, front-matter mismatch, unknown repo slug);
  `applyFazlarEdits` rewrites ONLY the fence body, every other byte preserved (the
  `applyStepEdits` precedent); `saveRoadmap` refuses to write over a doc it cannot re-read.
- **Structure root:** an `app_setting` key `docs_root:<wsId>` (the `budget:<wsId>` precedent —
  NO schema change), default `docs/`; the decision-store adapter's directory anchor becomes
  per-workspace-resolved. `.docket/` is one setting away; gitignore-vs-commit is the operator's
  choice — **Docket never writes a .gitignore line**; the local-only mode's one cost is
  documented (closure sha does not carry the documents into history).
- **CLI:** `roadmap show|validate` (validate prints diagnostics, exit 1 on any error line);
  `create-work-order --task <ref>` refuses unknown refs listing the known ones.

## Scope

In scope:

- NEW `src/core/roadmap-md.ts` + `src/core/roadmap.ts` (+ tests, test-first — ADR-0006).
- `src/core/order-md.ts` gains the `taskRef` round-trip (build/parse/edit).
- `WorkOrderSource` gains `getRoadmap/getRoadmapMd/saveRoadmap`; `CreateWorkOrderInput.taskRef?`.
- Decision-store adapter: `readRoadmapMd`/`writeRoadmapMd` + the per-workspace root resolution;
  store joins WOs by parsing each order.md's `task:`.
- `docs_root:<wsId>` setting read/write (store + CLI; the settings field is WO-0049's).
- CLI `roadmap show|validate`, `create-work-order --task`; IPC delegates + preload typing.
- ADR-0016 (first commit of the WO); CLAUDE.md "Roadmap layer" section + "Where things live"
  line; ROADMAP.md M6 entries (this commit opens them); tech-debt note for the N-file join.

Out of scope:

- All GUI (sibling screen, strip, fills, `sıradaki`, fold, dialogs, detail chip — WO-0049).
- The draft drive, source-doc import, the WO-less session migration, the cwd fix — WO-0050.
- Drag-reorder of fazlar (array order IS the order; moving is a file edit), re-sync import,
  backlog/sprint/labels/assignees/task-level dependencies/due dates/search, estimates (cost and
  duration are OBSERVED — that is the product's difference), a node-edge graph view, `.docket/`
  as the default root.

## Acceptance criteria

1. `parseRoadmapMd`/`applyFazlarEdits` round-trip the antreo example byte-identically outside the
   fence; any single malformed element collapses the whole list to `[]` with a named diagnostic.
2. `deriveRoadmapView` reproduces the mockup's facts on the antreo fixture: f0 TAMAM with summed
   closed-WO counts/cost, f1 KOŞUYOR with the open-WO chip on its running task, f2 BEKLİYOR
   naming its blocker, plus the named edge cases (orphan, zero-task, cycle, unresolved repo).
3. `createWorkOrder({..., taskRef})` writes `task:` into order.md; `parseOrderMd` reads it back;
   `getRoadmap` joins it into the task's row. PRAGMA diff: EMPTY (no schema change).
4. `roadmap validate` exits 1 on a hand-broken fence and names it; `create-work-order --task
   <bogus>` refuses, listing the roadmap's task ids.
5. Setting `docs_root:<wsId>` to `.docket` moves every read/write (work orders + roadmap)
   under `<ds>/.docket/` for that workspace; the default stays `docs/`.
6. `npm run typecheck` (both), `npm test`, `npm run build`, `npm run check:boundaries` green;
   E2E unchanged and green (56 specs — no UI in this WO).

## Evidence required

- plan_approval: PENDING — the architect plan round runs at the WO session open (mode: plan).
- operator_checkpoint: a CLI walkthrough (`roadmap show/validate` on a hand-broken antreo-shaped
  file, `create-work-order --task`, the `docs_root` switch) — the spine is verifiable without GUI.
- ci: green on the WO PR (typecheck both / test / boundaries / build / E2E).

## Stop-and-ask gates

- Any pressure to store a status (faz or task) or to add a `work_order.task_ref` column — both
  contradict this order; stop and ask.
- Any pressure to write or manage `.gitignore` from Docket — never; the choice stays the
  operator's.
- A roadmap.md that fails to parse on hydrate renders as the invitation surface + reason line,
  never as silent empty — if an implementation path loses the reason, stop and ask.

## Notes

- Successors: WO-0049 (GUI — the approved mockup is its acceptance basis) and WO-0050 (the AI
  draft drive + import + the WO-less session migration + the cwd fix) run in their own fresh
  sessions; this order's Context is their orientation.
- The full planning record (exploration reports, the three-agent design pass, the mockup tour)
  lives in the 2026-08-27 planning session; every decision that survives into code is restated
  here or in ADR-0016 — nothing in this WO depends on session memory.
