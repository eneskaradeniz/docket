# WO-0050 plan — running the WO-less draft drive end to end

Design by a plan agent that re-verified every load-bearing claim against the working tree
(three exploration passes preceded it: scope documents, core session/pipeline, UI/adapters).
Inline `path:line` pointers are that verification. Operator rulings settled BEFORE this file:
Düzenle is the structured editor (mockup hükmü "faz/görev listesi üzerinde"); a fresh draft
supersedes the pending row (no refusal gate); draft spend stays out of the roadmap head
figure. The session plan was approved 2026-08-27; this file is its committed form
(`mode: plan`).

## Design rulings

**D1 — `DriveInput` becomes a discriminated union: `WoDriveInput | DraftDriveInput`.**
`src/core/runner.ts:88-128` splits; the `workspaceId?: never` / `workOrderId?: never`
cross-guard makes both-set and neither-set object literals compile errors — the field pair IS
the discriminant. `isDraftDrive(i)` follows the `isPlanDrive` precedent (runner.ts:162) as the
single narrowing point. Why not optional fields: `workOrderId?` makes all 17 pipeline reads
plus `electron/main.ts:286`, `e2e-runner.ts:41`, `drive-store.ts:39/:47/:180` undefined-nullable
— a wider diff that also legalizes the invalid state. Every existing construction site
(SessionPane.tsx:89/:94/:116, StepPane.tsx:78, ReviewPane.tsx:50,
WorkOrderDetail.tsx:387/:406/:448/:466/:475/:510/:812/:822, cli/drive.ts:38-52) already matches
`WoDriveInput` — only READS of the union change (S4/S7). ADR-0003 holds: core never CONSTRUCTS
branded ids; carrying the typed ids is exactly today's shape. Draft specifics: `role:
'architect'`, `mode: 'plan'`, no step/review/approve → `isPlanDrive` is true UNCHANGED → the
adapter maps to the provider plan permission mode (adapter :220-225) and the ExitPlanMode DENY
"Plan submitted. STOP" contract applies verbatim (adapter :274-283) — zero runner-adapter
change. `goalNote`/`docPaths` ride the input (operator input collected main-side via
`pickFiles`; the renderer never discovers paths itself).

**D2 — Session schema: `workspace_id TEXT NOT NULL` added, `work_order_id` nullable; NEW
`roadmap_draft` table.** `schema.ts:62-80` becomes: `workspace_id TEXT NOT NULL` (every
session belongs to a workspace), `work_order_id TEXT` (nullable — the draft drive), all else
unchanged. Migration uses the established mechanism (`migrate()`, store `index.ts:372-457`):
additive ALTERs for columns, transactional rename → recreate (widened SCHEMA_SQL) →
id-preserving copy → drop when NOT NULL lives in the table definition (the `'stopped'` rebuild
precedent :411-430). Detection clause after the column ALTERs: `sessionSql &&
!sessionSql.includes('workspace_id')`. Backfill is total: every legacy session row is WO-owned
(the column was NOT NULL) and `deleteWorkOrderRows` deletes sessions before their WO
(store :820-829), so `INSERT … SELECT …, (SELECT w.workspace_id FROM work_order w WHERE
w.id = session_legacy.work_order_id)` resolves for every surviving row — NOT NULL holds.
`roadmap_draft`: `workspace_id TEXT PRIMARY KEY` (ONE pending draft per workspace), `md TEXT
NOT NULL`, `provider_session_id TEXT` (İtiraz's resume handle), `created_at/updated_at TEXT
NOT NULL`. Side effects: `recordSessionRow`'s upsert key goes NULL-safe —
`provider_session_id = ? AND workspace_id = ? AND work_order_id IS ?` (SQLite `IS ?`; the
2026-08-24 reviewer scoping preserved); `hydrateSessions` stays `WHERE work_order_id = ?`
(store :160) — draft rows are structurally invisible to every WO ledger, cost derivation and
`deriveStage`; the startup running-sweep (store :915) covers draft rows unchanged.

**D3 — Port widening: a `SessionOwner` union + draft-only additions; two budget methods.**
`src/core/session-store.ts` gains `export type SessionOwner = { kind: 'wo'; workOrderId:
WorkOrderId } | { kind: 'draft'; workspaceId: WorkspaceId }`. `RecordSessionInput.workOrderId`
→ `owner: SessionOwner` (the pipeline computes it once per drive). `pendingNotesFor(owner,
providerSessionId)`. `budgetBlockFor(workOrderId)` STAYS; `budgetBlockForDraft(workspaceId)`
is ADDED — two explicit methods, not one unified parameter: the two keys resolve differently
(store-side join through the WO vs the workspace directly) and branded ids are compile-time
only — a `WorkOrderId | WorkspaceId` union is indistinguishable at runtime. The port's "called
UNCONDITIONALLY" clause is restated for both; every fake implements both (the WO-0047 D10
discipline). New store methods: `roadmapDraftPromptFor(workspaceId, goalNote, docPaths):
string | undefined` (the `architectPromptFor` precedent, store :1046 — the store contributes
workspace facts, core builds the text) and `saveRoadmapDraft(workspaceId, md, {providerSessionId?})`.
The read/write half goes on `WorkOrderSource` (source.ts): `getRoadmapDraft(id): Promise<{md;
providerSessionId?; updatedAt} | null>`, `updateRoadmapDraft(id, md)` (parse-guarded — the
Düzenle write), `approveRoadmapDraft(id)` (atomic: parse-guard + `writeRoadmapMd` +
byte-identical re-read + row DELETE — no half state). `clearRoadmapDraft` stays internal
(the supersede path + the pipeline's fresh-draft clear). UNTOUCHED, deliberately:
`planApprovedFor`/`flowModeFor` gate step/review drives only — a draft never carries
step/review indexes (pipeline.ts:171/:183); `recordStep*`/`savePendingPlan`/`architectPromptFor`
stay WO-keyed.

**D4 — Budget widening: a draft cannot bypass.** After D2, `monthSpendRow(db, wsId)` (store
:706-718) drops the WO subselect and keys on the column: `SELECT COALESCE(SUM(cost_usd),0) …
FROM session WHERE workspace_id = ? AND started_at >= ? AND started_at < ?`. The pipeline's
first gate (pipeline.ts:157) branches once: `isDraftDrive(input) ?
store.budgetBlockForDraft(input.workspaceId) : store.budgetBlockFor(input.workOrderId)`. The
refusal payload is unchanged (`BudgetRefusal`, runner.ts:70); only the core message's subject
interpolation changes (pipeline.ts:161): `'roadmap draft'` vs the WO id. Both holes close at
the arithmetic layer — today a WO-less row is invisible to the subselect AND
`budgetBlockForWo` returns `undefined` on a missing WO row (store :729). `workspaceMonthSpend`
(the board warn line, settings readout) reads the same row — draft spend counts everywhere
the month figure appears.

**D5 — The draft prompt: a pure core builder, assembled in `prepareDriveInput`.** NEW
`src/core/roadmap-draft.ts`: `roadmapDraftPrompt({goalNote, docPaths, workspaceSlug,
knownRepos, roadmapMdPath}): string` and `draftSummaryOf(md): {fazCount; taskCount;
chainCount} | {parseError}`. The dispatch (pipeline.ts:31-48) gains its arm BEFORE the
architect arm (a draft would otherwise fall into `architectPromptFor(woId)` with no WO). A
draft whose prompt is still empty after preparation (workspace vanished) is refused pre-spawn
with one error event — the plan-gate refusal shape (pipeline.ts:171-174). Prompt contract (the
`architectPrompt` voice, order-md.ts:165-206, agent-facing English): identity ("You are the
architect drafting this workspace's roadmap.md"); the goal note VERBATIM; the source documents
as PATHS — "Read these documents yourself with your file tools: <path per line>", and when the
list is empty "No source documents were given — draft from the goal note alone."; the document
format contract (front-matter `workspace`/`title` as given, free prose, exactly ONE ```fazlar
fence); the fence schema as one canonical pretty-printed element mirroring `serializeFaz`'s
key order (roadmap-md.ts:271-282) with every field named; the parse rules stated so the model
emits a re-readable fence (ids `^[a-z0-9][a-z0-9-]*$` unique roadmap-wide, `blockedBy` naming
present faz ids, `repo` from the given slugs, values in the operator's language — the `aim`
precedent, order-md.ts:193-195 — 2-space JSON); "submit the complete roadmap.md via
ExitPlanMode"; the stop-notice and never-resubmit-on-resume clauses copied from
`architectPrompt`. WHY paths never contents: the mockup karar (frame 04 why, :557-563);
ADR-0016's rejected alternative (a content reader in the prompt is a parser by other means,
plus stale frozen bytes); import-vs-generate stays ONE mechanism — the path list's presence is
the only delta.

**D6 — `plan_ready` routing: the pending `roadmap_draft` row.** The pipeline's `plan_ready`
case (pipeline.ts:292-297) branches on drive kind: WO → `savePendingPlan` (unchanged); draft →
`store.saveRoadmapDraft(input.workspaceId, ev.planText, {providerSessionId})` — the provider
session id is in hand (set at `started`, pipeline.ts:263). Row semantics: written at
`plan_ready`; cleared on (a) `approveRoadmapDraft` (Onayla) and (b) a fresh non-resume draft
passing its gates — the pipeline calls `clearRoadmapDraft` once, after the budget/empty-prompt
guards, before the runner spawns (operator ruling 2: supersede); an İtiraz resume (`resume`
set) never clears. Supersede guard inside `saveRoadmapDraft`: refuses to overwrite a row whose
md PARSES with one that does not (both sides through `parseRoadmapMd` — the `savePendingPlan`
mechanical guard, store :1353-1365); the disk file is never touched by the draft path. Invalid
drafts are STORED, not rejected — "bozuk taslak geçerliyi ezmesin" lives at the approval
boundary (D11). The `plan_original` carve-out (document text in the DB as a PENDING proposal,
never the live document) is recorded in the ADR-0016 addendum.

**D7 — Fence and permission shape: no adapter change.** `role: 'architect'` + `mode: 'plan'` +
no step/review/approve → `isPlanDrive` → provider plan permission mode (adapter :220-225);
writes are denied in plan mode by the provider, the Docket fence still classifies
(`writeScopeFor` decision_store from cwd, runner.ts:201-210), and READS ARE ALLOWED EVERYWHERE
(`fenceDecision`, runner.ts:225 — the fence is read-asymmetric) — source documents outside the
structure root stay readable, which is the whole point of paths-in-prompt. Permission rule: a
draft has no order.md, so main.ts:286 branches — `isDraftDrive(input) ?
store.getPermissionRule() : store.getPermissionRuleFor(input.workOrderId)` (the Settings
default, with its legacy mapping, store :655-660).

**D8 — The cwd fix from the connection table (every GUI drive).** One concrete-store method
(cwd is a host concern — off the core ports): `driveCwd(input: DriveInput): string`. Chain,
all through the owned `connection` table (schema.ts:104-109): (1) draft → the decision-store
repo's connected `local_path` (the `connectedStructureRoot` lookup minus the docs suffix,
store :596-608); (2) WO drive with a resolved track `scope` → that repo's connection path (the
`resolveStepScope`/`woRepoPaths` matching rule, store :623-635/:751-755); (3) WO drive without
scope (architect plan/review, free, verifier, 'all') → the decision-store repo's path; (4) no
connection matches (fixtures, tests, unconnected) → `process.cwd()` — today's behavior
byte-for-byte. `electron/main.ts:287` becomes `input.cwd ?? store.driveCwd(input)` — the
renderer always omits cwd, so this is the single wiring point. WHY the repo root, not the
structure root: the adapter derives fence roots as `repoRoot: cwd, decisionStore:
resolve(cwd, 'docs')` (adapter :232-233) — cwd at the decision-store REPO makes the architect
write fence exactly `<repo>/docs` = the structure root at the default `docs_root`. Residue:
under a non-default `docs_root` the fence stays at `<repo>/docs` while documents live
elsewhere — a wider write window, accepted (plan mode denies writes during drafts; the
parse-guarded save is the boundary that matters; the arithmetic is pre-existing). Opened as
TD-056, not fixed here. Scope: the GUI host only — the CLI keeps `--cwd` explicit with
`process.cwd()` default (headless control). Retires the "per-track paths via the connection
table" note in runner.ts:98.

**D9 — RoadmapPane: the roadmap screen's live instrument.** NEW
`src/ui/components/roadmap/RoadmapPane.tsx`, at the TOP of the roadmap screen body above every
face (band-adjacent — ADR-0013's top-seat ruling), mounted while the drive store holds a fold
for the key. It speaks the shared grammar exclusively — `PaneShell` + `usePaneActivity` +
`PaneCostline` + `PaneLogChip` + `usePaneLog` + `DriveControls` + `ChatTranscript`
(pane-chrome.tsx) — with one substitution: the header readout renders the draft identity
`MİMAR — TASLAK` (new key `roadmapDraftIdentity`) instead of `ROLE_LABELS[role]`. No role
tabs, no composer inside the pane (the ✦ dialog owns starting; DriveControls owns
Durdur/Sürdür/Zorla kes). Drive key `${wsId}:draft` (the `${woId}:free` precedent);
`drive-store.ts` widens: `keyWs: Map<string, WorkspaceId>` beside `keyWo` (:47), a `wsId(key)`
accessor (the `woId(key)` precedent :180). `ActiveDriveSnapshot` stays WO-only (drive-store
:89-112) — a running draft returns `undefined`, which IS locked ruling 3: the draft never
overlays a board card. One-drive-at-a-time holds both ways (:121). Leaving the surface: the
pane unmounts, the drive lives in the app-level store (the WO-0028 precedent verbatim,
drive-store.ts:1-16) — the honest minimum is the head meta `taslak sürüyor` (mockup :581,
replacing the counts meta while the draft runs) plus the background reach: App's ask hook
gains the draft branch — toast + OS notification + switch `surface` to `'roadmap'` (the WO
toast's goTo precedent, App.tsx:508-526) and the window-title counter counts the draft's held
ask (App.tsx:541-545). No `PaneSteerBar` (D15). After restart the CARD is the surface; the
archived draft transcript is reachable nowhere — TD-057.

**D10 — The ✦ dialog and its two entry points.** NEW
`src/ui/components/roadmap/RoadmapDraftDialog.tsx` (frame 04, mockup :530-555): title "Yol
haritası taslağı"; Hedef notu textarea (3 rows); Kaynak belgeler (isteğe bağlı — içe aktarma)
— a docpick list of chosen absolute paths with ✕ removal, a `+ Belge seç` chip over the
existing `docket:pick-files` IPC (main.ts:256-259), a dim `+N belge` overflow line past 3;
footer Vazgeç / Taslağı başlat ⏎ (EnterMark). Validation: the note is REQUIRED — empty note
on submit = the field error under the textarea (`role="alert"`, WO-0036; validity never locks
the submit); docs optional (empty list = generate); duplicate paths deduped on add. Paths
live ONLY in the dialog's local state → the DriveInput → the prompt (mockup karar :560-561);
closing the dialog discards them. Start refusal: `driveStore.start` returns false while
another drive runs (:121) — surfaced as the dialog's one-line error (never a disabled
button). Entry points: (a) the absent face — `InviteHero`'s cta slot `✦ Üret / İçe aktar`
(the component takes `cta`/`onCta`, App.tsx:388; frame 03 :512-515); (b) the ready face's
footer RIGHT cluster (signal button; frame 01 :414-419; RoadmapScreen.tsx:106-110 gains the
right cluster). The INVALID face gains nothing (fix the file by hand). Start wires
`driveStore.start(`${wsId}:draft`, { role: 'architect', mode: 'plan', workspaceId, prompt: '',
goalNote, docPaths }, seed)`; the prompt assembles server-side (D5).

**D11 — The TASLAK decision card: the plan approval card's sibling.** NEW
`src/ui/components/roadmap/RoadmapDraftCard.tsx`, below RoadmapPane when `getRoadmapDraft`
returns a row (frame 05, :604-620). The card parses the md with core's `parseRoadmapMd` in the
renderer (the WO-0049 add-dialog precedent; ADR-0007 bans raw-id rendering, not core calls).
Head "Taslak hazır — gözden geçir"; summary from `draftSummaryOf` + the fixed tail
"onaylanınca docs/roadmap.md olarak karar deposuna yazılır — commit operatörün"; per-faz
preview rows (ordinal via `fazLabel` — never raw `{f.id}` — title, `N görev` + repo set,
"Faz X'i bekliyor" for blocked); the mockup's why-line; actions İtiraz et / Düzenle / Onayla ⏎.
Invalid draft: preview rows absent; the honest invalid line (`ROADMAP_DIAGNOSTIC_LABELS`);
Onayla ABSENT with the reason line (the parse-guard; ADR-0001); Düzenle and İtiraz remain.
Onayla → `approveRoadmapDraft(wsId)` → `refreshRoadmap()` — the screen flips to the ready
face; the commit stays the operator's. Düzenle (operator ruling 1) → the STRUCTURED edit stage
on the card's rows (the PlanSection editor precedent): each faz's title an input, `blockedBy`
a chip set, tasks editable (title / repo picker over `workspace.repos`) with add/remove;
Bitti = `applyFazlarEdits(draftMd, fazlar)` (roadmap-md.ts:290-294 — every byte outside the
fence preserved) → `updateRoadmapDraft`; a parse refusal renders as the field error with the
named reason (a read may degrade, an operator act may not). İtiraz → a one-line objection
composer (the `objectPlan` precedent, WorkOrderDetail.tsx:386-388): `driveStore.start(draftKey,
{ role: 'architect', mode: 'plan', workspaceId, prompt: note, resume:
row.providerSessionId }, seedFromSessionRow)` — the seed is the draft session row's transcript
(store `getDraftSession`) when no live fold exists; the resume re-enters the same session and
its next `plan_ready` rewrites the row.

**D12 — Restart and persistence.** The `roadmap_draft` row and the workspace-keyed session
row survive restart; the roadmap surface reads the row on entry (`refreshRoadmap` gains the
draft read, App.tsx:306-328) and remounts the card. A RUNNING draft killed by app close dies
like every drive (the fold dies; the startup sweep marks the row idle, store :915) — and since
the draft row is written only at `plan_ready`, a mid-run kill leaves no half-draft: the
surface honestly shows nothing. A `plan_ready` that landed persists; İtiraz still works after
restart (the provider session is resumable by id — the plan flow's identical stance).

**D13 — Asks on the roadmap surface.** Both plan-flow ask surfaces mount ABOVE RoadmapPane:
permission asks via `StopAndAskCard` per `state.pendingAsks` (decide through
`driveStore.decide`), `planContext` set, NO diffPeek (`docket:diff-peek` is WO-keyed,
main.ts:166 — absent, not adapted) and NO onAlwaysAuto (no order.md to persist a rule into);
the pipeline's `stopped_asking` row carries the asks on the workspace-keyed row
(pipeline.ts:276) — re-attach on remount via `pendingAsks()` unchanged. The TEXT question: a
plan-mode turn ending without `plan_ready` but with assistant text = the architect asking —
the SessionPane derivation (SessionPane.tsx:104-105) lifted to the roadmap surface: last
assistant line + Yanıtla → resume with the answer (mockup karar 5).

**D14 — CLI `roadmap draft|approve`.** `roadmap` gains two subs (cli/index.ts:248-274, help
:375): `roadmap draft --workspace <id-or-label> --note <TXT> [--docs <a,b,c>] [--fake
<SCRIPT>] [--format …] [--db PATH]` — `--note` required (usage exit 2), `--docs` comma-split
into `docPaths`, `--fake` runs the scripted FakeRunner (the refuse-against-default-GUI-db
guard applies, cli/index.ts:396-401); builds the DraftDriveInput and drives via the pipeline
(autoAllow, the `driveCommand` posture) — prompt assembly is the SAME store-side path as the
GUI; `plan_ready` → `saveRoadmapDraft` happens inside the pipeline; ends printing `draft
pending — run: roadmap approve --workspace <id>`. `roadmap approve --workspace <id-or-label>`
— `approveRoadmapDraft`: success prints the `draftSummaryOf` figures + the file path; refusal
(unparseable / no row) prints the named reason, exit 1 (the `roadmap validate` posture).
Presentation helpers join `src/cli/roadmap.ts`; handlers stay in index.ts.

**D15 — Steering and audit stay WO-only.** `pipeline.steer`/`retractSteer` refuse
(undefined/false) while the active drive is a draft (the `active` closure gains the draft
branch, pipeline.ts:135/:224-231/:409-432). İtiraz is the draft's note path; a mid-draft steer
bar is not in the mockup and has no audit home (`wo_event.work_order_id` is NOT NULL,
schema.ts:118-122 — draft lifecycle events are not recorded, and should not be: the roadmap
file + git is the record, ADR-0010). RoadmapPane renders no steer bar.

**D16 — Cost, audit-name, cascade.** `SessionAuditName` (derive.ts:538-545) UNCHANGED — draft
rows never hydrate into a WO. The roadmap head cost (`getRoadmap`'s per-WO subselects, store
:954-961) EXCLUDES draft spend (operator ruling 3): the head is the WO layer's observed
spend; the draft's costline is its pane; the month pool counts it (D4). Documented in the
ADR-0016 addendum. `deleteWorkspaceRow`'s running guard (store :530-535) widens to also count
`workspace_id = ? AND work_order_id IS NULL AND status = 'running'`; the cascade deletes the
workspace's `roadmap_draft` row (beside the budget/docs-root key deletes, store :539-541).

## Steps

Test-first for core (ADR-0006); each step names files + tests and ends with its Gate.
Docs-first commit; core → store/schema → pipeline → IPC → CLI → labels → UI → E2E → docs-close.

- **S1 (docs — FIRST COMMIT of the WO)** `order.md` + this file (`mode: plan`). Gate: the docs
  commit lands (no code).
- **S2 (core shapes + prompt, test-first)** `src/core/runner.ts`: the union + `isDraftDrive`.
  NEW `src/core/roadmap-draft.ts` + `roadmap-draft.test.ts`: the prompt carries the goal note
  verbatim, one line per doc PATH, never contents; the fence example round-trips
  `parseRoadmapMd`/`applyFazlarEdits`; the empty-list branch; the stop-notice clauses;
  `draftSummaryOf` counts + parse-error shape. `runner.test.ts`: union narrows both arms.
  Gate: `npm test -- runner roadmap-draft`; typecheck may stay red ONLY in `pipeline.ts`,
  `electron/main.ts`, `electron/e2e-runner.ts` (the scoped-red precedent, WO-0048 S5).
- **S3 (ports + store + schema)** `src/core/session-store.ts` + `src/core/source.ts` (D3);
  `schema.ts` (D2) + store: the transactional session rebuild with backfill (legacy-db fixture
  test — rows survive, `workspace_id` backfilled, NULL `work_order_id` writes stop throwing);
  NULL-safe upsert key (both arms); `monthSpendRow` workspace-keyed (a draft session counts,
  no WO row moves); `budgetBlockForDraft`; the `roadmap_draft` lifecycle (write → read →
  supersede-refusal → approve clears + file byte-identical → update refuses unparseable);
  `roadmapDraftPromptFor`; `driveCwd` (scope match / decision-store / cwd fallback);
  `hydrateSessions` never returns draft rows; workspace-delete guard + cascade. Gate:
  `npm test -- store`.
- **S4 (pipeline + hosts → typecheck green)** `src/core/pipeline.ts`: the draft arm before the
  architect arm; the budget branch + subject interpolation; the empty-prompt guard;
  `plan_ready` branch; `record()`'s owner; the fresh-draft clear; steer/retract refusal.
  `electron/main.ts`: the `driveCwd` fill (replacing `process.cwd()` :287), the permission-rule
  branch, the draft IPC forwarders. `electron/e2e-runner.ts`: `e2e-draft-<wsId>-<role>` ids
  (:41). `pipeline.test.ts`'s fakeStore gains every new method unconditionally: draft prompt
  assembled through the port; budget refusal of a draft (one error event, no spawn);
  `plan_ready` writes the row with the session id; fresh clears, resume does not; supersede
  guard; steer undefined on a live draft. Gate: BOTH typechecks GREEN + `npm test`.
- **S5 (CLI)** `src/cli/index.ts` + `src/cli/roadmap.ts` (D14); `cli.test.ts` fakes gain the
  port methods. Gate: `npm test -- cli`, then `npm run check:boundaries`.
- **S6 (labels)** Both bundles, one dated WO-0050 block (~25 keys): `roadmapDraftAction` (✦
  Üret / İçe aktar), dialog keys (title, note label + required error, docs label + optional
  suffix, + Belge seç, remove aria, Taslağı başlat, another-drive error, `+N belge`),
  `roadmapDraftRunning` (taslak sürüyor), `roadmapDraftIdentity` (MİMAR — TASLAK), card keys
  (head, summary composer with the root + commit tail, faz-row meta composers, blocked tail,
  why-line, the three actions, invalid line), objection composer, ask/toast keys.
  `labels.test.ts` pins the tr words. Gate: `npm test -- labels` + typecheck.
- **S7 (UI skeleton)** `RoadmapPane.tsx` (D9), `RoadmapDraftDialog.tsx` (D10),
  `RoadmapDraftCard.tsx` SANS the edit stage (D11), the entry points + head meta,
  `drive-store.ts` (`keyWs` + `wsId` + `ActiveDriveSnapshot` typing), App wiring (draft key in
  the drive hooks, ask toast + surface switch, title counter, the draft read in
  `refreshRoadmap`). Gate: `npm run build`.
- **S8 (Düzenle)** The structured edit stage (D11): in-place faz/task rows, `applyFazlarEdits`
  write, the parse-refusal field error. Gate: `npm run build`.
- **S9 (E2E)** `e2e/seed.ts`: a `taslak` world (workspace, no roadmap.md) + the draft fixtures
  built with `buildRoadmapMd` (never hand-typed JSON); `e2e/ui.mjs` six specs: happy generate
  (pane → card → Onayla → ready face), invalid draft (Onayla absent, named line),
  objection-resume (card updates, same session), budget refusal (the `kapı` world at cap; no
  pane; raise → re-run), restart persistence (fresh app on the same db → card remounts, no
  pane), CLI import (`--docs a,b --fake` → approve → ready). Gate: `npm run test:ui`.
- **S10 (docs-close)** ADR-0013 + ADR-0016 addenda, the two CLAUDE.md lines, TD-056/TD-057,
  ROADMAP.md M6 tick. Gate: the full ladder.

## ADR / CLAUDE.md / TD sketches

- **ADR-0013 addendum (2026-08-27, WO-0050)**: the roadmap screen carries the console's SECOND
  live surface — `RoadmapPane`, the shared pane-chrome grammar, identity `MİMAR — TASLAK`. A
  draft is workspace-scoped and never overlays a board card (the detail-screen rule stands).
  The roadmap head meta states `taslak sürüyor` while the draft runs (the honest minimum when
  the operator leaves the surface — the pane unmounts, the drive survives, the WO-0028
  precedent). Asks and the architect's text question surface as cards on the roadmap screen;
  a background draft ask toasts and switches to the roadmap surface.
- **ADR-0016 addendum (2026-08-27, WO-0050)**: the draft mechanics as built — ONE mechanism
  (the source-doc LIST is the only distinction; the prompt carries PATHS, never contents; no
  source-format parser exists or ever will); the session is WO-less (`session.workspace_id`
  NOT NULL, `work_order_id` nullable) and the workspace budget gate sees it like every drive;
  the proposal lands in a `roadmap_draft` row — document text in the DB under the
  `plan_original` carve-out (a pending proposal, never the live document; roadmap.md is
  written only by the parse-guarded save at approval, and the commit stays the operator's);
  approval refusal is the parse-guard; objection is a resume of the same provider session;
  draft spend counts in the workspace month pool but not in the roadmap head.
- **CLAUDE.md — Roadmap layer (ADR-0016) addition**: "The ✦ draft (WO-0050) is ONE mechanism
  — generation and import are the same workspace-scoped architect plan drive
  (`DraftDriveInput`); the prompt carries document PATHS, never contents (no source-format
  parser); the proposal is a `roadmap_draft` row (the `plan_original` document-text
  carve-out), approval is the parse-guarded `saveRoadmap` write and the commit is the
  operator's; the draft session is budget-gated like every drive."
- **CLAUDE.md — Single view (ADR-0013) addition**: "The roadmap screen carries the second
  live surface — RoadmapPane, the shared pane grammar, identity `MİMAR — TASLAK`; a draft
  never overlays a board card (workspace-scoped); the head meta says `taslak sürüyor` while
  it runs (ADR-0013's 2026-08-27 addendum)."
- **tech-debt.md**: the cwd fix closes no existing TD (it retires the runner.ts:98 note).
  NEW TD-056: the architect fence's decision-store root is cwd-relative `docs/`, aligned with
  `docs_root:<wsId>` only at the default — a wider write window under `.docket/`, bounded by
  plan-mode read-only drafts + the parse-guard. NEW TD-057: a workspace-scoped session's
  transcript is unreachable once the drive ends (no ledger surface mounts for draft rows; the
  card carries no döküm chip).

## Verification ladder + checkpoint

1. `npm run typecheck` (both tsconfigs) 2. `npm test` 3. `npm run check:boundaries`
4. `npm run build` 5. `npm run test:ui` (62 + 6).

Operator checkpoint (zero tokens, CLI-first, scratch db — `--fake` refuses the default GUI
db):

```
rm -rf /tmp/wo50 && mkdir -p /tmp/wo50/repo/docs
npm run cli -- create-workspace --label Demo --repo /tmp/wo50/repo --db /tmp/wo50/docket.db
# fake script: started → plan_ready (buildRoadmapMd output, 2 fazlar) → turn_complete
npm run cli -- roadmap draft --workspace demo --note 'iki fazlı yol haritası taslağı' \
  --docs /tmp/wo50/repo/docs/faz-a.md --fake /tmp/wo50/script.json --format stream --db /tmp/wo50/docket.db
npm run cli -- roadmap show --workspace demo --db /tmp/wo50/docket.db   # still absent
npm run cli -- roadmap approve --workspace demo --db /tmp/wo50/docket.db
npm run cli -- roadmap show --workspace demo --db /tmp/wo50/docket.db   # ready
# refusal: re-draft with a fence-less planText → approve exits 1 naming no_fence
```

GUI eyeball (frames 03/04/05): absent face's single ✦ → the dialog (note, two picked paths,
✕ removal, Taslağı başlat ⏎) → the pane (`MİMAR — TASLAK`, verb line, costline, Durdur,
döküm chip; head meta `taslak sürüyor`) → the card (parsed rows, İtiraz/Düzenle/Onayla ⏎) →
Onayla flips the surface to ready → a second draft's İtiraz resumes with the note. Screenshots
to `docs/ui-shots/`. The cwd change is announced here: connected workspaces' GUI drives now
run in their real repo roots.

## Risks

- **R1 — the session rebuild on the live GUI db.** Dropping NOT NULL needs
  rename→recreate→copy→drop; the migration is TRANSACTIONAL (`BEGIN IMMEDIATE`/`ROLLBACK`,
  the store :414-429 pattern), pinned by a legacy-db fixture test; backfill is total
  (sessions cascade-delete before their WO).
- **R2 — one drive at a time vs ✦.** A WO drive running while ✦ opens: `start` false → the
  dialog's error line (never a disabled button). The reverse direction surfaces through the
  panes as today.
- **R3 — asks on a surface with no ask chrome today.** StopAndAskCard + the question card
  mount on the roadmap screen (D13); the background reach is the toast + surface switch +
  title counter; misses are mitigated by the `stopped_asking` row (re-attach on return).
- **R4 — label creep.** ~25 keys in BOTH bundles; one dated block, composers for figures,
  `labels.test.ts` pins; no raw ids (faz rows via `fazLabel`).
- **R5 — E2E fake `plan_ready` for drafts.** The e2e session id would be `undefined` for a
  draft — widened in S4 (`e2e-draft-<wsId>-architect`); fixture md built with
  `buildRoadmapMd`, never hand-typed.
- **R6 — the empty-prompt window.** A draft whose assembly returns undefined is refused
  pre-spawn (D5's guard) — no empty-prompt provider run.
- **R7 — NULL-safe upsert key.** `work_order_id IS ?` must hold for both arms; tested for WO
  and draft rows (a regression silently merges rows across owners).
- **R8 — the cwd fix moves where GUI drives run.** Connected workspaces' drives now run in
  their real repos; fixture/unconnected workspaces are byte-identical (`process.cwd()`
  fallback); announced at the checkpoint.
- **R9 — Düzenle is the largest UI piece** (PlanSection-sized, its own S8). The
  raw-markdown textarea is the documented fallback behind an operator ask — the parse-guard
  makes either form safe.
