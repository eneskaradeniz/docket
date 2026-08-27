---
id: WO-0049
title: Roadmap GUI — the sibling Yol Haritası screen, prefilled spawn, the detail chip, the structure-root field
workspace: docket
status: closed
mode: direct
review: light
review_mode: gates
tracks:
  - repo: app
    depends_on: []
---

# WO-0049 — Roadmap GUI — the sibling Yol Haritası screen, prefilled spawn, the detail chip, the structure-root field

## Objective

The GUI round over the WO-0048 spine: the appbar `Pano | Yol Haritası` switch and the sibling
screen (faz cards, task rows, the approved mockup's strip / task fill / `sıradaki` / collapsed
done fazlar), Ekle-only editing (`+ Faz ekle`, `+ görev ekle` — no edit/delete; the file stays
the decision store), the prefilled task→WO spawn (`Oluştur ve plan iste`) writing `task:` into
order.md, the detail band's one `FAZ N · task` chip with its orphan degrade, the structure-root
settings field, labels (tr/en), E2E. `mode: direct` — the mockup is the approved design; no
plan round, implementation follows this order.

## Context

- **Acceptance basis: `docs/ui-mockups/wo-0048-yol-haritasi.html` frames 01/02/03/06/07**
  (04/05 — the ✦ dialog and the TASLAK draft drive — are WO-0050's). Tour rulings already
  folded by WO-0048: the empty surface keeps ONE action (✦ — absent this round, so ZERO
  actions + an informative file line); NO faz label on board cards; BEKLİYOR task rows dim +
  actionless; the collapsed-past fold sits at the TOP. The mockup is the INFORMATION contract,
  not the pixel spec (its own header says so).
- **Operator decisions at order time (2026-08-27):** (1) Ekle-only editing — `+ Faz ekle` +
  `+ görev ekle` dialogs write through `applyFazlarEdits` + `saveRoadmap`; existing fazlar/
  tasks are never edited or deleted in the GUI (hand-edit the file); (2) `mode: direct` —
  no plan.md round.
- **The spine ships everything consumed** (WO-0048, merged #54): `RoadmapView =
  absent | invalid | ready{head, fazlar, siradaki, warnings}` + `FazView`/`TaskView` +
  `spawnActionOf` (absent reason `kosuyor|bloke|repo_yok`) in `src/core/roadmap.ts`;
  `parseRoadmapMd`/`roadmapDiagnostics`/`applyFazlarEdits`/`nextFazId`/`nextTaskId`/
  `normalizeDocsRoot` in `src/core/roadmap-md.ts`; port `getRoadmap`/`getRoadmapMd`/
  `saveRoadmap` (parse-guarded) + `CreateWorkOrderInput.taskRef`; **5 IPC channels already
  wired to the renderer** (`electron/main.ts` `docket:source:get-roadmap|get-roadmap-md|
  save-roadmap` + `docket:settings:get-docs-root|set-docs-root`, typed in
  `src/renderer/preload.d.ts`) — this WO wires UI only.
- **One core addition:** `roadmapTaskOf(readyView, taskRef)` — the detail chip's wo→task
  reverse lookup (faz + task + 1-based ordinal; orphan → undefined → the chip degrades).
  `TaskView.closedWoIds` is deliberately NOT added — no surface this round consumes closed WO
  identities (tails show counts; the clickable chip is open-only).
- **UI anchors (house patterns to copy):** App.tsx owns all data + the screen switch (no
  router; a new `surface: 'board' | 'roadmap'` state beside `selectedId` — detail renders over
  either surface, back reveals the last one); ports arrive as props, never `window.docket`
  for data; the WO-0047 budget section is the settings-field pattern (atomic draft, errors
  only after a save attempt); `WoCreateModal` already carries the `onCreated(wo, withPlan)`
  → navigate + auto-plan hook; `ClosedToggle` is the fold idiom; `.lamp-*`,
  `.hairline-progress`, `.irow`, `.ichip`, `.alink` carry hover/motion — the strip's kosuyor
  breathe reuses the ambient-lamp exception and joins the reduced-motion off-block.
- **Reads once per mount (WO-0048 R2):** the roadmap state refreshes on workspace change,
  surface entry, detail open, the drive-store end/start/ask-resolved/error triggers (beside
  `refreshBudget`), and after every save — never on a timer.

## Scope

In scope:

- `src/core/roadmap.ts`: `roadmapTaskOf` + tests (test-first — ADR-0006).
- `src/ui/screens/RoadmapScreen.tsx` + `src/ui/components/roadmap/{FazStrip,FazCard,TaskRow,
  DoneFold,FazAddDialog,TaskAddDialog}.tsx`; `InviteHero` gains an optional CTA; 3 CSS blocks
  in `src/index.css` (`.fazstrip`/`.fseg-*`, `.bloke`, `.donefold`) + the reduced-motion entry.
- `App.tsx`: surface state, roadmap state + refresh, spawn wiring, the detail-chip memo;
  `AppShell`: the `Pano | Yol Haritası` Segmented + `onDocsRootChanged`.
- `WoCreateModal`: `WoSpawnPrefill` (uneditable context line, seeded title/description/repo
  chips, `taskRef` into the create input).
- Detail chain (`DetailScreen` → `WorkOrderDetail` → `DetailStrip`): the one task chip +
  the orphan degrade.
- `AppSettingsModal`: the workspace-scoped `Yapı kökü` section (`docs_root:<wsId>`).
- Labels tr/en (UI keys + `FAZ_STATUS_LABELS` + `fazLabel` + `ROADMAP_DIAGNOSTIC_LABELS`)
  + label-test pins; E2E seed + 6 specs.

Out of scope:

- The ✦ `Üret / İçe aktar` action (footer right cluster stays EMPTY — it lands with WO-0050)
  and everything behind it (the draft drive, source-doc import, the TASLAK card).
- Edit/delete of existing fazlar/tasks; drag-reorder; a node-edge graph view; board-card faz
  labels; `TaskView.closedWoIds`.
- A `work_order.task_ref` column, any stored faz/task status, any `.gitignore` write
  (ADR-0016 gates, carried from WO-0048).

## Acceptance criteria

1. The appbar `Pano | Yol Haritası` switch renders (workspace present); the screen reproduces
   mockup frames 01/02 on the seeded world: the head meta (`2/5 faz tamam · 2 açık iş emri ·
   $7,32`), the status-colored strip (click scrolls to the faz, reduced-motion respected), the
   2px task fill, `sıradaki` on the first spawnable task, the donefold at ≥2 done fazlar
   (none at 1), the BEKLİYOR faz's Bloke line + dimmed actionless rows, and the running task's
   WO chip → detail → back returns to Yol Haritası.
2. The spawn dialog opens prefilled from the task row (`▸ İş emri aç`): the uneditable
   `FAZ N · GÖREV K · title · hedef: repo` context line, seeded title/description, the task's
   repo alone pre-checked; both footers work and `task:` lands in order.md regardless of the
   repo selection (the link is the task identity).
3. The detail band carries exactly ONE `FAZ N · task` chip beside the WO id (signal tone,
   non-interactive); an orphan `task:` degrades to `(görev yol haritasında yok)`; an unlinked
   WO shows no chip; raw task ids never render.
4. `+ Faz ekle` / `+ görev ekle` re-read the document at save time, write through
   `applyFazlarEdits` + `saveRoadmap` (parse-guarded: refusal = toast, nothing written, the
   draft survives), and the screen refreshes; form errors sit under their field (WO-0036
   contract); no edit/delete anywhere.
5. The settings `Yapı kökü` field writes `docs_root:<wsId>` (invalid refused under the field);
   switching never moves files and the Yol Haritası follows the root; `.gitignore` untouched.
6. Absent renders the invitation + the `<docsRoot>/roadmap.md` file line (zero actions);
   invalid renders the named diagnostic reasons — never silent empty. All copy flows through
   the labels bundles (tr/en, compiler-enforced parity).
7. `npm run typecheck` (both), `npm test`, `npm run check:boundaries`, `npm run build` green;
   `npm run test:ui` green (56 → 62 specs).

## Evidence required

- plan_approval: n/a — `mode: direct`, `review: light` (the operator settled scope at order
  time: Ekle-only editing, no plan round; the mockup is the approved design; the order itself
  approved + committed as `571f597` before implementation)
- operator_checkpoint: RESOLVED 2026-08-27 — the surface walked in the app on the e2e-seeded
  `yol` world (strip scroll, fold, sıradaki, the WO chip → detail → back, the prefilled spawn,
  both add dialogs, the `.docket` root round-trip, the invalid surface on the shared store) AND
  the absent surface on a real roadmap-less workspace; 5 shots in `docs/ui-shots/roadmap-*.png`.
  The operator approved the commit on this evidence; the reviewer round landed after it
  (`c818685`).
- ci: RESOLVED — green on PR #55 and locally: typecheck (both) / `npm test` 705 /
  `check:boundaries` clean / `build` / `npm run test:ui` 62/62 (56 + 6)
- closure: RESOLVED — ROADMAP M6 WO-0049 ticked (this commit); PRAGMA diff EMPTY unchanged
  (no schema change anywhere in the WO)

## Closure

Merged **#55** (`759f432`, 2026-08-27) — order `571f597` + feature `430fb4d` + review `c818685`
(55 files, +1532/−48 across the three). Evidence state: the screen reproduces the approved
mockup's frames 01/02/03/06/07 on the seeded `yol` world (head `2/5 faz tamam · 2 açık iş
emri · $7,32`, fold `2 tamamlanan faz · f0 · f3 · 3 WO · $5,20` — both E2E-pinned); Ekle-only
edits re-read the document at save and ride the parse guard (a refused write moves no byte,
the draft survives); the spawn writes `task:` into order.md and the row flips to the WO chip;
the detail chip degrades on the orphan and renders nothing while the read is in flight; the
root switch follows the surface end to end without moving a file. The reviewer round cost three
small fixes and one rule: the spawn action rides `.alink`, tooltips/fold run through the
bundles, and ADR-0007's 2026-08-27 addendum carries the faz/task ids into the WO-NNNN carve-out
(`fazIdLabel`). One core-typing decision survived review: `TaskView.openWoIds` is branded
`WorkOrderId[]` — the identity flows through the type system, the single re-brand lives in the
store adapter. Open follow-up: WO-0050 (the ✦ footer slot + the AI draft drive, the TASLAK
card, the WO-less session migration).

## Stop-and-ask gates

- Any pressure to store a faz/task status, add a `work_order.task_ref` column, or write
  `.gitignore` from Docket — stop and ask (ADR-0016, carried from WO-0048).
- Any pressure to render a raw task id as display text, or a disabled control where an absent
  action + reason belongs — stop and ask.
- If the invalid surface cannot carry its diagnostic reasons, or a save path could destroy
  the fence — stop and ask.

## Notes

- The N-file view-time join (TD-055) now runs per roadmap read including the drive-end
  refreshes — accepted at solo scale; the absent case is one stat.
- E2E seed prints the created WO ids (`ROADMAP=` line); specs never hard-code WO numbers
  (numbering is store-global and drifts as earlier seeds evolve).
- WO-0050 will add the ✦ footer slot (the right cluster) and may revisit the empty surface's
  single action; the shared-store seeding makes every OTHER workspace's Yol Haritası read
  `invalid` (`front_matter_mismatch` — the file names its own workspace), which is correct
  and spec-pinned.
