---
id: WO-0050
title: Roadmap AI — the WO-less architect draft drive, paths-in-prompt import, RoadmapPane, the TASLAK card
workspace: docket
status: open
mode: plan
review: light
review_mode: gates
tracks:
  - repo: app
    depends_on: []
---

# WO-0050 — Roadmap AI — the WO-less architect draft drive, paths-in-prompt import, RoadmapPane, the TASLAK card

## Objective

The AI round of the roadmap trilogy: the **WO-less architect draft drive** (taslak sürüşü) — ONE
mechanism where generation from a goal note and import from existing faz docs are the same
workspace-scoped architect plan session, distinguished only by the source-doc list, with the
prompt carrying document PATHS and never contents. The session store learns workspace-owned
sessions (`workspace_id` NOT NULL, `work_order_id` nullable); the budget gate is widened so a
draft counts and can never bypass; the proposal lands in a `roadmap_draft` pending row and
becomes `roadmap.md` only through the operator's Onayla (the parse-guarded `saveRoadmap` write;
the commit stays the operator's). Plus: the **cwd fix from the connection table** (every GUI
drive), the roadmap screen's live surface (**RoadmapPane**, `MİMAR — TASLAK`) and the **TASLAK
decision card** (Onayla / Düzenle / İtiraz et — mockup frames 03/04/05), the ✦ dialog, CLI
`roadmap draft|approve`, E2E FakeRunner scenarios.

## Context

- **Locked by WO-0048's planning round (2026-08-27) + ADR-0016.** Generation and import are ONE
  mechanism — an architect draft session, no source-format-specific parser (decision 2); the
  trilogy splits 0048 spine → 0049 GUI → 0050 AI (decision 3); "a model never invents work
  unreviewed — the draft is an architect plan-mode session the operator approves; the write is
  a parse-guarded `saveRoadmap` and the commit is the operator's" (ADR-0016 §supersedes).
- **Acceptance basis: mockup frames 03/04/05** (`docs/ui-mockups/wo-0048-yol-haritasi.html`;
  frames 01/02/06/07 shipped with WO-0049). Frame 03: the absent face's ONE action `✦ Üret /
  İçe aktar`. Frame 04: the dialog — Hedef notu (textarea) + Kaynak belgeler (isteğe bağlı —
  içe aktarma; `pickFiles`, ✕ removal, `+ Belge seç`); "prompt'a YOL yazılır, içeriği ajan
  okur — Docket hiçbir dosya içeriği okumaz"; paths die with the session; the draft starts a
  NEW session (plan-iste kuralı) and the budget gate sees it. Frame 05: the pane speaks
  pane-chrome verbatim (verb line + costline + Durdur + döküm chip; identity `MİMAR — TASLAK`;
  head meta `taslak sürüyor`) — but WO'suz, never a board overlay — then the TASLAK card
  descends on `plan_ready`: parsed per-faz preview (never raw markdown), Onayla ⏎ / Düzenle
  (faz/görev listesi üzerinde) / İtiraz et (resume with the note), parse-koruma ("bozuk taslak
  geçerliyi ezmesin").
- **Operator rulings, this round (2026-08-27).** (1) Düzenle is the STRUCTURED editor on the
  card's faz/task rows (`applyFazlarEdits` — bytes outside the fence preserved); (2) a fresh
  draft SUPERSEDES the pending row (no refusal gate — re-opening ✦ already decided the old
  proposal is dead); (3) draft spend is EXCLUDED from the roadmap head figure (the head is the
  WO layer's spend; the draft's costline is its pane; the workspace month pool counts it).
- **The three WO shackles the draft breaks** (verified): `DriveInput.workOrderId` REQUIRED
  (`src/core/runner.ts:91`), `session.work_order_id TEXT NOT NULL` (`src/adapters/store/
  schema.ts:65`), and a `SessionStore` whose 15 methods are all WO-keyed (`src/core/
  session-store.ts:30`). The runner adapter is already WO-agnostic (zero hits) — the coupling
  lives in pipeline + store only.
- **Budget double-keying** (WO-0047's gate, widened here): `monthSpendRow` sums sessions
  through `work_order_id IN (SELECT id FROM work_order WHERE workspace_id = ?)` (store
  `index.ts:706`) — a NULL `work_order_id` row is invisible; and `budgetBlockForWo` returns
  `undefined` on a missing WO row (`index.ts:725`) — a WO-less drive would silently bypass.
  Both close at the arithmetic layer, never host-side.
- **The cwd fix from the connection table**: `electron/main.ts:287` fills `cwd: process.cwd()`
  for every GUI drive today; fence roots derive from it (adapter `index.ts:232`). The fix:
  resolve from the owned `connection` table — a scoped WO drive runs in its track repo's
  `local_path`, a draft/unscoped drive in the decision-store repo's path, `process.cwd()` only
  when nothing matches. The CLI keeps `--cwd` explicit (headless control).
- **`plan_original` carve-out** (ADR-0010): the `roadmap_draft` row carries document text in
  the DB as a PENDING proposal, exactly like the plan-approval row — it is never the live
  document; `roadmap.md` is written only at approval, by the parse-guarded save; ADR-0016's
  addendum records this.
- **Design pass**: three exploration agents (scope documents, core session/pipeline, UI/adapters)
  + one design agent re-verifying every load-bearing claim against the working tree; 16 design
  rulings, restated in `plan.md` — nothing in this WO depends on session memory.

## Scope

In scope:

- Core (test-first, ADR-0006): `DriveInput` becomes `WoDriveInput | DraftDriveInput` with
  `isDraftDrive`; NEW `src/core/roadmap-draft.ts` (`roadmapDraftPrompt` — paths-not-contents
  contract, `draftSummaryOf`); `SessionStore` widening (`SessionOwner`, `budgetBlockForDraft`,
  `roadmapDraftPromptFor`, `saveRoadmapDraft`); `WorkOrderSource` gains the draft read/write
  trio (`getRoadmapDraft`/`updateRoadmapDraft`/`approveRoadmapDraft`).
- Store + schema: the transactional session rebuild (`workspace_id TEXT NOT NULL` backfilled
  through the WO join, `work_order_id` nullable); NULL-safe upsert key; `roadmap_draft` table;
  `monthSpendRow` workspace-keyed; `budgetBlockForDraft`; `driveCwd(input)`; workspace-delete
  guard + cascade widening.
- Pipeline: the draft arm in `prepareDriveInput` (before the architect arm), the budget-gate
  branch, the empty-prompt pre-spawn refusal, `plan_ready` routing, owner plumbing, steer
  refusal on drafts (İtiraz is the draft's note path).
- Electron: `driveCwd` fill (replacing `process.cwd()`), the permission-rule draft branch, the
  draft IPC forwarders; `e2e-runner` draft session ids.
- CLI: `roadmap draft --workspace --note [--docs] [--fake]` + `roadmap approve --workspace`
  (prompt assembly shared with the GUI through the same store-side path).
- UI: `RoadmapPane` (shared pane-chrome grammar), `RoadmapDraftDialog` (frame 04), the ✦ entry
  points (absent-face CTA + ready-face footer right cluster), head meta `taslak sürüyor`,
  `RoadmapDraftCard` + the structured Düzenle stage + the İtiraz composer, ask surfaces
  (`StopAndAskCard` + the derived question card), drive-store `keyWs` widening, App wiring
  (ask toast + surface switch + title counter); labels tr/en.
- E2E: seed `taslak` world + 6 specs (happy generate, invalid-draft parse-guard, objection
  resume, budget refusal + raise re-run, restart persistence, CLI import).
- Docs: ADR-0013 + ADR-0016 addenda, CLAUDE.md lines (Roadmap layer + Single view), TD-056/
  TD-057, ROADMAP M6 tick.

Out of scope:

- A source-format import parser — banned forever (ADR-0016 rejected alternatives; a content
  reader in the prompt is a parser by other means).
- Re-sync import: the draft is one-shot; after approval the file is hand-editable (the editor,
  git, or a fresh draft that supersedes).
- Steer bar / `wo_event` audit on drafts (WO-keyed by design; İtiraz is the note path).
- A ledger surface for draft sessions (transcript unreachable after the drive — TD-057).
- The fence-root alignment for non-default `docs_root` (TD-056, bounded by plan-mode
  read-only drafts + the parse-guard).
- Multiple concurrent drafts (the one-drive-at-a-time store rule stands, both directions).
- Task→WO auto-spawning from a draft (the spawn action stays manual, WO-0049).
- CLI cwd changes (`--cwd` stays explicit).

## Acceptance criteria

1. A draft drive runs WO-less end-to-end: the session row records `workspace_id` with
   `work_order_id` NULL; the plan-mode contract is unchanged (`isPlanDrive` true, ExitPlanMode
   DENY, `plan_ready` with cost); the draft session never appears in any WO ledger and never
   drives a board card.
2. The budget gate refuses a draft at the cap BEFORE the runner spawns (one error event,
   `BudgetRefusal` payload); `monthSpendRow` counts draft sessions; the missing-WO bypass is
   closed (test-pinned both ways).
3. `plan_ready` on a draft writes the `roadmap_draft` row (md + provider session id + stamps);
   a fresh draft clears the pending row after its gates; a resume never clears it; the
   supersede guard refuses valid→invalid overwrites.
4. Onayla writes `roadmap.md` ONLY through the parse-guarded approve path — invalid md refuses
   naming the diagnostic, valid md writes + re-reads byte-identical + clears the row atomically;
   `roadmap show` flips absent→ready; the git commit stays the operator's.
5. The assembled prompt carries the goal note verbatim and one PATH per source doc — never file
   contents (test-pinned); an empty doc list takes the generate-from-note branch; GUI and CLI
   assemble through the same store-side path.
6. `driveCwd`: a scoped WO drive resolves its track repo's connected `local_path`; a draft or
   unscoped WO drive resolves the decision-store repo's path; no connection matches →
   `process.cwd()` (byte-for-byte today's behavior).
7. UI matches frames 03/04/05: absent face = 1 line + the single ✦; ready footer right cluster
   = ✦ (signal); the dialog validates (note required, error under field, no disabled buttons);
   the pane speaks pane-chrome with `MİMAR — TASLAK` + head meta `taslak sürüyor`; the card
   shows the parsed preview (faz rows via `fazLabel`, never raw ids) + İtiraz/Düzenle/Onayla ⏎;
   an invalid draft renders the named diagnostic line with Onayla ABSENT; Düzenle round-trips
   through `applyFazlarEdits`; İtiraz resumes the same provider session.
8. CLI round-trip on a scratch db: `roadmap draft --fake` → pending line; `roadmap show` still
   absent; `roadmap approve` → summary + file written; a fence-less draft → approve exits 1
   naming `no_fence`.
9. E2E: 6 new specs green (62 → 68); the full ladder green (typecheck both, `npm test`,
   `check:boundaries`, `build`, `test:ui`).

## Evidence required

- plan_approval: RESOLVED — the operator approved the session plan 2026-08-27 (three open rulings
  settled before the docs commit: structured Düzenle, supersede, draft spend out of the head);
  `plan.md` committed as `a071333`.
- operator_checkpoint: RESOLVED 2026-08-28 — the zero-token CLI walkthrough on a scratch db:
  draft (`--note --docs --fake`) → `draft pending — 2 faz · 2 görev · 1 bağımlılık zinciri` → show
  absent (approval is the write) → approve (`written to roadmap.md … the git commit is yours`) →
  show ready (f1 bekliyor `bloke: f0`, sıradaki f0-t1) → the refusal path (a fence-less draft
  stays pending naming `no fazlar fence`; approve exits 1; the valid file untouched, validate ok).
  The GUI eyeball of frames 03/04/05 + the cwd-change announcement approved on the same evidence.
- ci: green on the PR (typecheck both / `npm test` 743 / `check:boundaries` / `build` /
  `test:ui` 69 specs).
- closure: ROADMAP M6 WO-0050 ticked with the merge sha; TD-056/TD-057 opened.

## Stop-and-ask gates

- Storing a faz/task status anywhere, or a `work_order.task_ref` column (ADR-0016 rule 2) —
  unchanged from WO-0048.
- Reading source-document CONTENTS into the prompt or DB — paths only; a content reader is a
  parser by other means (ADR-0016's rejected alternative).
- Any host-side budget work-around or force flag (WO-0047's line) — the gate stays in the
  pipeline.
- Rendering raw faz/task ids — `fazLabel`/`fazIdLabel` only (ADR-0007's 2026-08-27 addendum).

## Notes

- WO-0048's order is the spine orientation; WO-0049's shipped the surface this WO extends
  (the ✦ footer slot was left EMPTY for this round; `InviteHero`'s CTA slot is free).
- The cwd fix changes where GUI drives run for CONNECTED workspaces (their real repo roots) —
  announced at the operator checkpoint; fixture/unconnected workspaces are byte-identical.
- Successor pressure valve: if the structured Düzenle (S8) overruns, the raw-markdown textarea
  is the documented fallback — the parse-guard makes either form safe; ask before switching.
