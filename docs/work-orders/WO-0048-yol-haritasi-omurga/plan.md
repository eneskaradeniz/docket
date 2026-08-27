# WO-0048 plan — the roadmap spine: roadmap.md format, derived faz/task views, the task link, the structure root

Design by a plan agent that re-verified every claim against the working tree (`src/core/order-md.ts`
front-matter helpers + `applyOrderMdEdits` setKey/dropKey; `src/core/plan-steps.ts` last-fence-wins
parse + fence-only `applyStepEdits`; `src/core/budget.ts` as the pure-module shape; the store's
`settingBudget` fail-open row pattern at `src/adapters/store/index.ts:661-674`;
`resolveDecisionStorePath`/`woDir` path resolution; `src/adapters/decision-store/decision-store.ts`
`WORK_ORDERS_DIR = ['docs','work-orders']` baked into the helpers; closed ⟺ `gate_closure_docs_sha`
set; `work_order.cost_*` inert (TD-023 — cost derives from `session.cost_usd`, nullable = unknown);
the flat 1:1 IPC forwarders in `electron/main.ts`; the mockup `docs/ui-mockups/wo-0048-yol-haritasi.html`
frame-01 figures). The planning round of 2026-08-27 (commit `19c6a38`) locked the four decisions
restated in the order's Context; nothing below depends on session memory. The session plan was
approved 2026-08-27; this file is its committed form (`mode: plan`).

## Design rulings

- **D1 Core document module — `src/core/roadmap-md.ts` (types + parse).**
  `export interface TaskSpec { id: string; title: string; repo?: string; note?: string }`;
  `export interface FazSpec { id: string; title: string; aim?: string; blockedBy: string[]; notes?: string; tasks: TaskSpec[] }`;
  `export type RoadmapParseError = { reason: 'no_fence' } | { reason: 'bad_json'; message: string } | { reason: 'bad_element'; index: number; problem: string }`;
  `export interface ParsedRoadmapMd { workspace: string; title: string; fazlar: FazSpec[]; parseError?: RoadmapParseError }`;
  `export function parseRoadmapMd(md: string): ParsedRoadmapMd`.
  Front-matter split via a LOCAL copy of order-md's `FRONT_MATTER_RE` + `frontValue` (the plan-steps.ts
  precedent — sibling fence parsers own their regex; no yaml lib). Fence: LAST ```fazlar wins (a stray
  earlier draft cannot override). Shape validation reads known fields and IGNORES unknown keys
  (forward-compat, the `parsePlanSteps` reading); a wrong-typed/empty known field on ANY element
  collapses `fazlar` to `[]` all-or-nothing with `parseError` naming why — the invitation surface's
  reason line never gets lost (the order's stop-and-ask gate). Id/ref/repo checks need workspace
  facts and live in diagnostics, not the parser.
- **D2 Diagnostic vocabulary — `roadmapDiagnostics`.**
  `export type RoadmapDiagnosticSeverity = 'error' | 'warning'`;
  `export interface RoadmapDiagnostic { code: RoadmapDiagnosticCode; severity: RoadmapDiagnosticSeverity; detail: string }`;
  `export type RoadmapDiagnosticCode = 'no_fence' | 'bad_json' | 'bad_element' | 'duplicate_id' | 'bad_id_shape' | 'empty_title' | 'unknown_blocked_by' | 'self_blocked_by' | 'cyclic_blocked_by' | 'front_matter_mismatch' | 'unknown_repo'`;
  `export function roadmapDiagnostics(md: string, ctx: { workspaceSlug: string; knownRepos: string[] }): RoadmapDiagnostic[]`.

  | code | severity | detail carries |
  | --- | --- | --- |
  | `no_fence` | error | — |
  | `bad_json` | error | the JSON.parse message |
  | `bad_element` | error | element index + problem |
  | `duplicate_id` | error | the duplicated id |
  | `bad_id_shape` | error | the offending id |
  | `empty_title` | error | element path (`f1` / `f1-t3`) |
  | `unknown_blocked_by` | error | faz id + the unknown ref |
  | `self_blocked_by` | error | the faz id |
  | `cyclic_blocked_by` | warning | the cycle's member ids |
  | `front_matter_mismatch` | error | found slug vs expected slug |
  | `unknown_repo` | warning | task path + repo slug |

  Id rule `^[a-z0-9][a-z0-9-]*$`, unique across the WHOLE roadmap (faz + task ids share one
  namespace). Readiness: a view is `ready` only when parse succeeds AND zero ERROR diagnostics
  exist; warnings (cycle, unknown repo) ride the ready view. `unknown_repo` is a warning because one
  typo'd repo must not blank the whole surface (the row renders with a `repo_yok` spawn absence);
  `cyclic_blocked_by` is a warning per the order (both members render `bekliyor` + the warning line).
- **D3 Fence serialization + edits + builder + root — same module.** Canonical fence body =
  `JSON.stringify(fazlar, null, 2)` (2-space pretty — this file is hand-edited by the operator, unlike
  plan.md's compact fence), key order fixed by an explicit serializer in interface order — faz
  `id, title, aim?, blockedBy, notes?, tasks`; task `id, title, repo?, note?`; absent optionals are
  OMITTED keys, never `null`. Fence emission is ` ```fazlar\n<body>\n``` `.
  `export function applyFazlarEdits(md: string, fazlar: FazSpec[]): string` — rewrites ONLY the last
  fence's body (range splice, the `applyStepEdits` precedent); no fence → returned UNCHANGED; every
  byte outside `[start,end)` preserved (AC1). `export interface RoadmapMdInput { workspaceSlug:
  string; title: string; prose?: string; fazlar: FazSpec[] }`; `export function buildRoadmapMd(input:
  RoadmapMdInput): string` — front-matter (`workspace`, `title`) + prose + exactly one canonical
  fence; `parseRoadmapMd(buildRoadmapMd(x)).fazlar` deep-equals `x.fazlar`. The structure-root
  setting's arithmetic lives here too: `export const DEFAULT_DOCS_ROOT = 'docs'`;
  `export function normalizeDocsRoot(v: string): string | undefined` — trimmed, leading `./`
  stripped, trailing `/` stripped, valid iff `^[A-Za-z0-9._-]+(\/[A-Za-z0-9._-]+)*$` with no `..`
  segment and not `.`, else undefined. One module: the fence writer and the id-shape rule it must
  round-trip are one contract, and a third one-function core file buys nothing.
- **D4 Derivation module — `src/core/roadmap.ts` (the budget.ts shape: small pure fns + composed
  View).** `export type TaskStatus = 'planli' | 'kosuyor' | 'tamam'`;
  `export type FazStatus = 'planli' | 'kosuyor' | 'bekliyor' | 'tamam'`;
  `export type SpawnAbsentReason = 'kosuyor' | 'bloke' | 'repo_yok'`.
  `export function taskStatusOf(linked: { closed: boolean }[]): TaskStatus` — none → `planli`; any
  open → `kosuyor`; all closed (≥1) → `tamam`.
  `export function fazStatusOf(input: { tasks: TaskStatus[]; blockers: FazStatus[] }): FazStatus` —
  precedence: any task `kosuyor` → `kosuyor`; else any blocker ≠ `tamam` → `bekliyor`; else tasks>0
  and all `tamam` → `tamam` (the vacuous-truth refusal); else `planli`. Precedence-fixed: the order
  lists kosuyor first; a faz that IS running must not read as blocked.
- **D5 The View + `deriveRoadmapView`.**
  `export interface RoadmapOrderFact { id: string; closed: boolean; costUsd: number; taskRef?: string }`;
  `export interface DeriveRoadmapInput { roadmapMd: string; workspaceSlug: string; knownRepos: string[]; orders: RoadmapOrderFact[] }`;
  `export interface TaskView { id: string; title: string; repo?: string; note?: string; status: TaskStatus; closedWoCount: number; closedCostUsd: number; openWoIds: string[]; spawn: { available: true } | { available: false; reason?: SpawnAbsentReason } }`;
  `export interface FazView { id: string; title: string; aim?: string; notes?: string; blockedBy: string[]; status: FazStatus; closedWoCount: number; closedCostUsd: number; openWoCount: number; tasks: TaskView[] }`;
  `export interface RoadmapHead { title: string; doneFazCount: number; totalFazCount: number; openWoCount: number; totalCostUsd: number; costUnknown: boolean }`
  (`costUnknown`: any order fact with unknown-cost sessions — the honest undercount flag, the
  `workspaceBudgetView` precedent; a NULL session cost is never silently summed as truth);
  `export type RoadmapView = { kind: 'absent' } | { kind: 'invalid'; reasons: RoadmapDiagnostic[] } | { kind: 'ready'; head: RoadmapHead; fazlar: FazView[]; siradaki: { fazId: string; taskId: string } | undefined; warnings: RoadmapDiagnostic[] }`;
  `export function deriveRoadmapView(input: DeriveRoadmapInput): RoadmapView`.
  `roadmapMd === ''` → `absent`; parse error or ANY error diagnostic → `invalid` with those
  diagnostics as `reasons` (a duplicate-id or foreign-workspace roadmap never renders half-trusted).
  The union member is named `invalid`, not `parse_error`: it also carries structural errors a clean
  parse can still contain. Orders group onto tasks by `taskRef`; an order whose `taskRef` names no
  task is INVISIBLE in `fazlar` (the orphan ruling) but still counts in the head. Head arithmetic
  (pinned by the mockup): `totalCostUsd` = Σ costUsd over ALL orders (closed AND open —
  $12,40 + $1,62 = $14,02); `openWoCount` = orders with `closed === false`; `doneFazCount`/
  `totalFazCount` over fazlar. Faz statuses resolve via memoized recursion with a visited set — a
  back-edge reads that blocker as not-`tamam`, so a 2-cycle yields both `bekliyor` without looping.
- **D6 Spawn + sıradaki.** `export function spawnActionOf(input: { task: TaskStatus; faz: FazStatus;
  repo: string | undefined; knownRepos: string[] }): { available: true } | { available: false;
  reason?: SpawnAbsentReason }`. Available iff `task === 'planli'` AND `faz !== 'bekliyor'` AND
  `repo` is set and ∈ `knownRepos` (a `kosuyor` faz's planli tasks ARE spawnable — mockup frame-01
  shows the action on f1's planli rows while f1 runs). Absence reasons: task `kosuyor` → `kosuyor`;
  task `planli` + faz `bekliyor` → `bloke`; task `planli` + faz unblocked + repo missing/unknown →
  `repo_yok`; task `tamam` → no reason (the "N WO kapandı" evidence line is the tail — the order
  names exactly three codes). `siradaki` = the FIRST task with `spawn.available === true`, scanning
  fazlar in array order then tasks in array order; `undefined` when none. Spawnable-scoped: the
  mockup defines it as "ilk yapılabilir görev", not merely first planli (a `repo_yok` first row must
  not steal the marker).
- **D7 Id minters.** `export function nextFazId(fazlar: FazSpec[]): string` — among ids matching
  `^f(\d+)$` take max+1 (`[]`→`f0`; `f0,f1,f2,f4`→`f5` — gaps are honest); none matching → `f0`.
  `export function nextTaskId(fazId: string, fazlar: FazSpec[]): string` — `<fazId>-t<n>` with n =
  max existing `^t(\d+)$` suffix within that faz, bumped while the candidate collides with ANY task
  id across the roadmap (a hand-named `f1-t3` elsewhere cannot be shadowed).
- **D8 order.md `taskRef` round-trip.** `ParsedOrderMd` gains `taskRef?: string` (read via
  `frontValue(front, 'task')`, non-empty → present; no validation here — the roadmap's diagnostics
  own ref validity at join time). `OrderMdEdit` gains `taskRef?: string | null` — a string sets the
  key (inserted at the front-matter end when absent, `setKey`), `null` DROPS the key (the `dropKey`
  precedent); `undefined` = untouched (the patch contract every other field follows). `OrderMdInput`
  (adapter) gains `taskRef?: string`, emitted as `task: <ref>` after `permission_rule`, before
  `tracks` — omitted when absent (the minimal-front-matter rule).
- **D9 Ports.** `WorkOrderSource` gains `getRoadmap(workspaceId: WorkspaceId): Promise<RoadmapView>`,
  `getRoadmapMd(workspaceId: WorkspaceId): Promise<string>` (`''` when the file is absent),
  `saveRoadmap(workspaceId: WorkspaceId, md: string): Promise<void>`; `CreateWorkOrderInput` gains
  `taskRef?: string`; `UpdateWorkOrderInput` gains `taskRef?: string | null`. `AppSettings` gains
  `getDocsRoot(workspaceId: WorkspaceId): Promise<string>` (returns the EFFECTIVE root —
  `DEFAULT_DOCS_ROOT` when unset/garbage, so callers never repeat the default) and
  `setDocsRoot(workspaceId: WorkspaceId, root: string | undefined): Promise<void>` (undefined =
  DELETE the row = back to `docs`). The ONLY other port implementer is the preload object literal —
  typecheck forces its update in the same WO (verified: no fixture/fake source adapter exists).
- **D10 Decision-store adapter — the structure root.** `WORK_ORDERS_DIR` becomes `['work-orders']`
  and every helper's first param is renamed `structureRoot` (same position, same type — the store
  now passes `<decisionStorePath>/<docsRoot>`). Store-side: `function structureRoot(db, wsId)` =
  `join(resolveDecisionStorePath(db, wsId), settingDocsRoot(db, wsId))` replaces the bare resolver at
  every WO-doc/roadmap call site (`woDir`, `getWorkOrderDocs`, `approvePlan`, `savePlanDraft`,
  `restoreOriginalPlan`, `createWorkOrder`, `updateWorkOrder`, `closeWorkOrder`, `architectPromptFor`,
  the deletion dir) — the threading is ONE resolver, not 10 optional params. Deletions keep using
  `connectedDecisionStorePath` + the same root join (never the cwd fallback). New helpers:
  `export function readRoadmapMd(structureRoot: string): string` — `<root>/roadmap.md`, `''` when
  absent; `export function writeRoadmapMd(structureRoot: string, body: string): string` —
  `mkdirSync(root, {recursive:true})` + write, returns the path. `nextWorkOrderNumber`,
  `findWorkOrderDir`, `writeOrderMd`, etc. are otherwise byte-identical.
- **D11 Store wiring.** `settingDocsRoot(db, wsId): string` — reads key `docs_root:<wsId>` (RAW
  string, not JSON), runs `normalizeDocsRoot`, falls back to `DEFAULT_DOCS_ROOT` on absent/invalid
  (the `settingBudget` fail-open pattern: a corrupt row must not hide the workspace's work orders).
  `setDocsRoot` validates via `normalizeDocsRoot` and THROWS on invalid (a write is
  operator-initiated — refuse loudly, unlike the fail-open read); stores the normalized value;
  undefined → DELETE. `getRoadmap(wsId)`: `md = readRoadmapMd(structureRoot(db, wsId))`; `''` →
  `{kind:'absent'}`; `knownRepos` = the workspace's repo slugs; per-WO facts from ONE query
  (`SELECT w.id, w.gate_closure_docs_sha, (subquery SUM session.cost_usd) AS usd, (subquery COUNT
  NULL-cost sessions) AS unknownCount FROM work_order w WHERE w.workspace_id = ?`) with `closed ⇔
  gate_closure_docs_sha != null` (deriveStage's closed); `taskRef`s from ONE
  `readdirSync(<root>/work-orders)` → per `WO-\d{4}-*` dir read `order.md` → `parseOrderMd().taskRef`
  (missing file → no ref); feed `deriveRoadmapView`. `getRoadmapMd(wsId)` = `readRoadmapMd`.
  `saveRoadmap(wsId, md)` guard: `parseRoadmapMd(md).parseError` present (no fence, bad JSON, bad
  element) → THROW with the reason, write nothing (the write path must not destroy the machine fence
  — prose-only saves included); else write, re-read, byte-compare, mismatch → throw.
  `createWorkOrder` threads `input.taskRef` into `buildOrderMd`. `updateWorkOrder` passes the patch
  through to `applyOrderMdEdits` (taskRef rides free) — the existing closed-WO throw (WO-0031f K1)
  fires FIRST for any patch on a closed WO, so `task:` on a closed WO is immutable like every other
  edit; `'task'` joins the `wo_edited` field list. `deleteWorkspaceRow` sweeps `docs_root:${id}`
  beside `budget:${id}`. NO SCHEMA_SQL / `migrate` change (AC3's "PRAGMA diff: EMPTY", proven by a
  `PRAGMA table_info(work_order)` column-list test).
- **D12 CLI.** Dispatch: `case 'roadmap':` with `positional[1]` ∈ `show|validate`; `--workspace
  <id-or-label>` REQUIRED (slug first, label fallback; missing → refusal listing known workspaces).
  Pure presentation in a new `src/cli/roadmap.ts` (the `create.ts` pattern — no Node, no store):
  `formatRoadmapShow(view: RoadmapView): string`, `formatRoadmapValidate(diags:
  RoadmapDiagnostic[] | 'absent'): { text: string; exitCode: 0 | 1 }`, `resolveTaskRef(md: string,
  ref: string): { ok: true } | { ok: false; error: string }`. `show` prints English chrome + the
  Turkish status vocabulary as data: head line `faz 1/4 tamam · 4 open work orders · $14.02
  observed`; one line per faz (`f0  tamam   2/2 tasks  5 closed WOs  $12.40  Kullanıcı Yönetimi`);
  indented task lines with status/counts/open chips (`WO-0012`); a `siradaki:` line; warnings last;
  money as `toFixed(2)` (an English-speaking host, the WO-0047 ruling). `validate` prints one line
  per diagnostic (`error: duplicate_id — f1`), exits 1 iff any ERROR line, 0 on warnings-only, and
  on an absent file prints `no roadmap.md — nothing to validate` and exits 0 (an empty surface is
  legitimate, not broken). `create-work-order` gains `--task <ref>`: the flag joins the known list,
  `CreateWorkOrderDraft.task?: string`; the handler resolves via `getRoadmapMd` + `resolveTaskRef`
  (NOT `getRoadmap` — no orders join needed) and refuses `unknown task "<ref>" — not a task of this
  workspace roadmap (valid: f0-t1, …)` (the resolveTracks voice) or, when the roadmap is
  absent/unparsable, `--task needs a parseable roadmap.md — run 'roadmap validate' first` (fail
  closed). New command `docs-root --workspace <id-or-label> [--root <dir>] [--clear]`: prints the
  effective root (and the raw stored row when one exists); `--root` validates via `normalizeDocsRoot`
  and writes; `--clear` deletes the row; on `--root` it WARNS when the target
  `<ds>/<new>/work-orders` is empty/missing while the OLD root holds N WO dirs (`numbering restarts
  at WO-0001 under the new root — move the folders yourself; Docket never moves files`) — the one
  honest guard against silent re-numbering (R3). HELP_TEXT gains all three. Why a CLI docs-root: the
  order's In-scope says "store + CLI"; the operator checkpoint needs a no-GUI switch; the settings
  FIELD stays WO-0049's.
- **D13 IPC.** `electron/main.ts` adds flat 1:1 forwarders `docket:source:get-roadmap`,
  `docket:source:get-roadmap-md`, `docket:source:save-roadmap`, `docket:settings:get-docs-root`,
  `docket:settings:set-docs-root`; `electron/preload.ts` adds the three source methods and two
  settings methods to its object literals (typecheck-driven — `preload.d.ts` reuses port types and
  updates itself). No renderer consumer this WO (the screen is WO-0049's); the channels exist so
  WO-0049 wires UI-only.
- **D14 Status nowhere — the belt.** No `work_order.task_ref` column, no stage/status column, no
  roadmap cache row (ADR-0010 rule 1: a column would be the stalest denormalized copy of document
  text). Every status is computed inside `deriveRoadmapView` per read. Both stop-and-ask triggers
  (status stored / task_ref column) are restated in ADR-0016 so a successor session cannot
  "optimize" the join into the DB without meeting the gate.

## Steps

- **S1** (docs — FIRST COMMIT of the WO, per the order). Files: this plan.md; new
  `docs/adr/ADR-0016-roadmap-layer-derived-planning-surface.md`; ADR-0008 dated bold addendum
  (pointer, old text stands); `CLAUDE.md` new `## Roadmap layer — ADR-0016` section + a
  "Where things live" line; `docs/tech-debt.md` TD-055 row. `ROADMAP.md` is NOT touched — M6 already
  lists WO-0048/0049/0050 unchecked (planning commit `19c6a38`); the closure commit ticks them.
  Gate: `npm run typecheck` + commit.
- **S2** (core, test-first) `src/core/__tests__/roadmap-md.test.ts` BEFORE
  `src/core/roadmap-md.ts`. Tests: antreo fixture parse (4 fazlar, 12 tasks, verbatim Turkish,
  blockedBy data); no fence → `[]` + `no_fence`; non-JSON → `[]` + `bad_json`; one bad element →
  `[]` + `bad_element` with index; unknown extra keys ignored; two fences → last wins;
  `applyFazlarEdits` byte-identical outside the fence + canonical-body idempotence; no fence →
  unchanged; `buildRoadmapMd` round-trip + key-order pins; `roadmapDiagnostics` one minimal case per
  code (11) + clean antreo → `[]`; `nextFazId`/`nextTaskId`; `normalizeDocsRoot` accept/reject table.
  Gate: `npm test -- roadmap-md`.
- **S3** (core, test-first) `src/core/__tests__/roadmap.test.ts` before `src/core/roadmap.ts`.
  Tests: taskStatusOf branches; fazStatusOf branches + kosuyor-over-blocker precedence + zero-task →
  planli; the antreo derivation pins every mockup fact (numbers under "The antreo fixture"); '' →
  absent; broken fence / duplicate id / front-matter mismatch → invalid; 2-cycle → both bekliyor +
  one warning; self-block → invalid; unknown repo → warning + repo_yok; orphan invisible but counted
  in head; zero-task faz → planli; all-blocked → siradaki undefined. Gate: `npm test -- roadmap`.
- **S4** (core) `order-md.ts` taskRef (D8) + tests in `order-md.test.ts` / `order-md-edit.test.ts`:
  parse reads `task: f1-t3` / absent → undefined; edit sets (inserts when absent), `null` drops;
  neighbours byte-preserved; empty patch identity. Gate: `npm test -- order-md`.
- **S5** (ports) `src/core/source.ts` + `src/core/app-settings.ts` additions (D9), type-only.
  Gate: `npm run typecheck` fails ONLY on `store/index.ts` + `electron/preload.ts` — that failure
  list is the checklist for S7/S9.
- **S6** (adapter) `decision-store.ts` (D10): root parameterization, `buildOrderMd` taskRef,
  `readRoadmapMd`/`writeRoadmapMd`. `decision-store.test.ts`: mechanical path updates + new tests
  (buildOrderMd emits `task: f1-t3` after permission_rule / omits when absent; readRoadmapMd '' when
  absent; writeRoadmapMd creates the root; nextWorkOrderNumber scans a custom root). Gate:
  `npm test -- decision-store`.
- **S7** (store + settings) `store/index.ts` (D11) + `AppSettingsData` getDocsRoot/setDocsRoot. New
  `store.test.ts` describe `WO-0048 — roadmap spine` on a temp antreo store: absent →
  `{kind:'absent'}`; `saveRoadmap(buildRoadmapMd(antreo))` → `getRoadmapMd` byte-equal + `getRoadmap`
  reproduces every S3 fact through REAL files + DB rows; `saveRoadmap` refuses bad_json AND no-fence
  docs (throws, file untouched) + the read-back byte guard; `createWorkOrder({taskRef:'f1-t2'})`
  writes `task:` (readFileSync assert) and `getRoadmap` joins it into f1-t2's openWoIds; taskRef
  patch on a closed WO → throws; docs_root default docs → set `.docket` → roadmap + new WO dirs
  under `<ds>/.docket/`; invalid roots throw; garbage row reads back as docs; deleteWorkspace sweeps
  docs_root + budget keys; PRAGMA diff EMPTY — `PRAGMA table_info(work_order)` column list
  unchanged. Gate: `npm test -- store`.
- **S8** (CLI) `src/cli/roadmap.ts` (pure) + `create.ts` `--task` + `index.ts` dispatch (roadmap,
  docs-root) + HELP_TEXT. Tests: new `src/cli/__tests__/roadmap.test.ts` + `create.test.ts` `--task`
  parse + valueless rejection. Gate: `npm test -- cli`, then `npm run check:boundaries` (the new
  src/cli file stays pure).
- **S9** (IPC) main.ts five forwarders + preload.ts literals (D13). Gate: `npm run typecheck` both.
- **S10** (full ladder + checkpoint): typecheck → test → boundaries → build → test:ui (UNCHANGED 56
  specs); the operator checkpoint CLI walkthrough; commit → PR (body starts with a "Model Used"
  line) → CI green → operator approves → merge.

## The antreo fixture

Main fixture = mockup frame-01 EXACTLY (4 fazlar). Core tests inline the md; store tests build the
same world on a temp decision store with repo dirs `api/`, `mobile/`, `docs/` (decision store =
docs).

```json
[
  { "id": "f0", "title": "Kullanıcı Yönetimi", "aim": "Rol ayrımı ve kimlik doğrulama",
    "blockedBy": [], "tasks": [
      { "id": "f0-t1", "title": "Rol ayrımı ve kayıt akışı", "repo": "api" },
      { "id": "f0-t2", "title": "Kimlik doğrulama yöntemleri", "repo": "api" } ] },
  { "id": "f1", "title": "Antrenör Profili", "aim": "Profil, doğrulama ve fotoğraf",
    "blockedBy": [], "tasks": [
      { "id": "f1-t1", "title": "Profil oluşturma", "repo": "api" },
      { "id": "f1-t2", "title": "Doğrulama akışı", "repo": "api" },
      { "id": "f1-t3", "title": "Fotoğraf yükleme", "repo": "mobile" },
      { "id": "f1-t4", "title": "Deneyim ve ücret alanları", "repo": "mobile" } ] },
  { "id": "f2", "title": "Değerlendirme", "aim": "Antrenör puanlama ve yorumlar",
    "blockedBy": ["f4"],
    "notes": "Rezervasyon kavramı henüz kodlanmadı — Faz 4 tamamlanmadan başlanmayacak (gap analizi kararı)",
    "tasks": [
      { "id": "f2-t1", "title": "Puanlama modeli", "repo": "api" },
      { "id": "f2-t2", "title": "Yorum akışı", "repo": "api" },
      { "id": "f2-t3", "title": "Yorum moderasyonu", "repo": "api" } ] },
  { "id": "f4", "title": "Rezervasyon", "aim": "Seans takvimi ve rezervasyon",
    "blockedBy": ["f1"], "tasks": [
      { "id": "f4-t1", "title": "Seans takvimi", "repo": "api" },
      { "id": "f4-t2", "title": "Rezervasyon oluşturma", "repo": "api" },
      { "id": "f4-t3", "title": "İptal koşulları", "repo": "mobile" } ] }
]
```

Front-matter: `workspace: antreo-app`, `title: Antreo Yol Haritası`; one prose line above the fence.

Orders (the store test realizes them with session cost rows + a direct `gate_closure_docs_sha`
UPDATE, the WO-0047 direct-row idiom):

| WO | closed | costUsd | taskRef |
| --- | --- | --- | --- |
| WO-0001..0003 | yes | 3.10 / 4.20 / 1.00 | f0-t1 |
| WO-0004..0005 | yes | 2.60 / 1.50 | f0-t2 |
| WO-0006 | yes | 0.00 | f1-t1 |
| WO-0012 | no | 1.62 | f1-t3 |
| WO-0007..0009 | no | 0 | — (unlinked) |

Pinned numbers: f0 `tamam` `closedWoCount 5` `closedCostUsd 12.40` (3+2 split per task); f1
`kosuyor` `openWoCount 1`; f1-t1 `tamam` 1 closed $0 (reconciles f0's scoped $12,40 with head
$14,02); f1-t3 `kosuyor` `openWoIds ['WO-0012']`; f1-t2/f1-t4 `planli` + spawn available; f2
`bekliyor` `blockedBy ['f4']` (tasks spawn-absent `bloke`); f4 `bekliyor` `blockedBy ['f1']`; head
1/4 · 4 open · $14.02; `siradaki {fazId:'f1', taskId:'f1-t2'}`.

Edge-case fixtures (SEPARATE minimal docs, not folded into the main one): orphan (a `f9-t9` ref →
invisible in fazlar, still counted open in head); zero-task faz (`tasks: []` → `planli`); 2-cycle
(`fa`↔`fb` → both `bekliyor` + one warning); repo_yok (`repo: 'web'` vs knownRepos
[api, mobile, docs] → warning + spawn `repo_yok`).

## ADR / CLAUDE.md / TD sketches

- **ADR-0016** (`docs/adr/ADR-0016-roadmap-layer-derived-planning-surface.md`, accepted, 2026-08-27,
  deciders: Enes (operator), architect session): the roadmap layer — roadmap → faz → task → work
  order — is a planning surface ABOVE the work order, superseding ADR-0008's "ROADMAP.md stays human
  prose + `milestone:` front-matter" clause FOR THIS ARTIFACT while keeping both its disciplines
  (status is computed, never dragged; a model never invents work unreviewed — WO-0050's draft is an
  architect plan-mode session the operator approves and commits). Shape: ONE `roadmap.md` per
  workspace at the structure root, front-matter (`workspace`, `title`) + prose + exactly ONE
  ```fazlar fence (`{id,title,aim?,blockedBy[],notes?,tasks[]}` / `{id,title,repo?,note?}`; ids
  `^[a-z0-9][a-z0-9-]*$` unique across the roadmap; keys English, values verbatim operator
  language; STATUS APPEARS NOWHERE — `blockedBy` is data). The task→WO link lives ONLY in order.md
  front-matter (`task:`); NO `work_order.task_ref` column — a column is ADR-0010 rule 1's stalest
  denormalized copy; `getRoadmap` joins at view time (solo scale, the cost is TD-055). The structure
  root: `app_setting docs_root:<wsId>`, default `docs/`, `.docket/` one setting away; switching
  NEVER moves files and NEVER writes .gitignore — both stay the operator's acts (the local-only
  mode's one cost: the closure sha does not carry the documents into history). Derivations as ruled
  in D4–D6; named edges (orphan invisible, zero-task planli, cycle = both bekliyor + warning,
  self-block = error, repo_yok warning). WO split: 0048 spine / 0049 GUI / 0050 AI draft + import.
- **ADR-0008 addendum** (bold dated block appended, old text never rewritten — the ADR-0013
  pattern): the "Roadmap progress without machine-readable roadmaps" clause above is superseded FOR
  THE WORKSPACE ROADMAP ARTIFACT by ADR-0016 (a per-workspace roadmap.md with one machine fence; the
  `milestone:` front-matter mechanism is retired for new work). Both disciplines of this ADR stand
  unchanged: status is computed, never set by hand, and a model proposes work only as a reviewed,
  committed document.
- **CLAUDE.md** — new section after "Single view": `## Roadmap layer — ADR-0016` — one `roadmap.md`
  per workspace at the structure root (default `docs/`, the `docs_root:<wsId>` setting); fazlar and
  tasks live in ONE ```fazlar fence; task→WO links live ONLY in order.md front-matter (`task:`) —
  never a DB column; faz/task status is DERIVED (task from its linked WOs, faz from its tasks +
  blockers) and stored nowhere; the spawn action is absent with a structural reason
  (`kosuyor|bloke|repo_yok`); Docket never moves files on a docs-root switch and never writes
  .gitignore. Plus one "Where things live" line: `Workspace roadmap: <structure root>/roadmap.md
  (default docs/roadmap.md) — ADR-0016; work orders link to its tasks via the order.md task: key.`
- **TD-055** (low, open, opened by WO-0048): `getRoadmap` joins the task link by scanning every work
  order's order.md at view time (one readdir + N reads) because the link deliberately has no DB
  column (ADR-0010 rule 1 via ADR-0016). Solo scale makes this free today; a many-WO workspace or a
  board-level embed would want a discardable observed cache (re-scanned on the roadmap screen only)
  — revisit if the screen ever renders below ~100 WO or off the roadmap surface.

## Verification ladder + checkpoint

1. `npm run typecheck` (both tsconfigs) 2. `npm test` 3. `npm run check:boundaries`
4. `npm run build` 5. `npm run test:ui` (UNCHANGED 56 specs — no UI in this WO; it must stay green).

Operator checkpoint (zero tokens, scratch db + scratch decision store):

```
mkdir -p /tmp/wo48/docs /tmp/wo48/api /tmp/wo48/mobile
npm run cli -- create-workspace --label Antreo --repo /tmp/wo48/docs --repo /tmp/wo48/api \
  --repo /tmp/wo48/mobile --decision-store /tmp/wo48/docs --db /tmp/wo48/docket.db
npm run cli -- roadmap show --workspace antreo --db /tmp/wo48/docket.db        # no roadmap.md yet
# hand-write /tmp/wo48/docs/roadmap.md (the antreo fixture, canonical fence format)
npm run cli -- roadmap validate --workspace antreo --db /tmp/wo48/docket.db   # ok line, exit 0
npm run cli -- roadmap show --workspace antreo --db /tmp/wo48/docket.db       # faz/task/head/siradaki lines
# hand-break: duplicate f1's id in the fence
npm run cli -- roadmap validate --workspace antreo --db /tmp/wo48/docket.db ; echo "exit=$?"   # 1, names duplicate_id
npm run cli -- roadmap show --workspace antreo --db /tmp/wo48/docket.db     # the invitation reasons
# the task link
npm run cli -- create-work-order --workspace antreo --title 'Doğrulama akışı uçtan uca' \
  --task f1-t2 --track api --db /tmp/wo48/docket.db
grep '^task:' /tmp/wo48/docs/work-orders/WO-0001-*/order.md                 # task: f1-t2
npm run cli -- create-work-order --workspace antreo --title x --task f9-t9 --track api --db /tmp/wo48/docket.db
# refuses, listing the roadmap's task ids
# the structure-root switch
npm run cli -- docs-root --workspace antreo --root .docket --db /tmp/wo48/docket.db   # + the move-your-files warning
mkdir -p /tmp/wo48/docs/.docket && mv /tmp/wo48/docs/roadmap.md /tmp/wo48/docs/.docket/ # OPERATOR moves; Docket never does
npm run cli -- roadmap show --workspace antreo --db /tmp/wo48/docket.db     # reads .docket/roadmap.md
npm run cli -- docs-root --workspace antreo --clear --db /tmp/wo48/docket.db            # back to docs/
```

Then commit → PR (body starts with a "Model Used" line — CLAUDE.md Records & PRs) → CI green on all
five ladder commands → operator approves → merge.

## Risks

- **R1 — `WORK_ORDERS_DIR` parameterization breaks the decision-store tests.** The path assertions
  in `decision-store.test.ts` hardcode `docs/work-orders`. S6 updates them mechanically in the same
  commit (the helpers' root semantics change once, tests follow); a miss fails loudly at `npm test`,
  never in production. The store's own call sites are covered by the S7 antreo test writing through
  the REAL path.
- **R2 — the view-time N-file scan.** `getRoadmap` readdirs the work-orders dir once and reads N
  order.md files per call (plus one SQL query). Accepted at solo scale and TD-055-noted; the screen
  (WO-0049) reads once per mount, the CLI once per command. No cache is built now — a cache would be
  the stalest-copy column under another name.
- **R3 — switching `docs_root` orphans existing files.** Files stay where they were: with the
  setting at `.docket` and the folders still under `docs/`, reads see an empty roadmap + no WOs, and
  `nextWorkOrderNumber` restarts at WO-0001 (a fresh create under the new root can then collide on
  the global PK — it throws at INSERT, honest but abrupt; TD-035's known shape). Resolution:
  DOCUMENTED-ONLY in ADR-0016 (Docket never moves operator files) + the CLI `docs-root --root`
  warning line when the new root is empty while the old one holds WO dirs (D12). No store-level
  block: moving files is the operator's act by ruling.
- **R4 — `task:` edits on a CLOSED WO.** The existing WO-0031f K1 immutability throw fires for ANY
  patch on a closed WO, `taskRef` included — a closed work order is an immutable archive, and its
  roadmap link is part of the historical record (the chip degrades to a qualifier in WO-0049 if the
  task later disappears).
- **R5 — fence-format churn.** `applyFazlarEdits` re-canonicalizes the fence body (fixed key order,
  2-space pretty). A hand-edited fence in another format is rewritten on the next apply;
  byte-preservation holds OUTSIDE the fence only — exactly AC1's wording. Canonical-body idempotence
  is pinned by test so the churn is once, not per-edit.
- **R6 — port growth breaks implementers.** `WorkOrderSource`/`AppSettings` gain methods; the only
  literal implementers are `store/index.ts` (S7) and `electron/preload.ts` (S9) — verified no
  fixture/fake source adapter exists. Typecheck is the belt; S5's expected-failure check makes the
  list explicit.

## Resolutions inside order.md (ambiguities settled)

1. **Head `$14,02` arithmetic** (not spelled out in the order): head total = ALL observed cost
   (closed + open: 12,40 + 1,62), and f1-t1's closed WO must carry $0.00 observed to reconcile f0's
   scoped "5 WO kapandı · $12,40" with the head. Unknown costs flagged via `head.costUnknown`
   (session.cost_usd NULL), never silently summed as truth.
2. **`parse_error` → `invalid`.** The union member carries structural errors (duplicate id,
   front-matter mismatch) that survive a clean parse — same shape, honest name.
3. **Spawn on a tamam task:** no reason code (only the three named codes); completion's evidence
   line ("N WO kapandı") is the tail — absence-with-reason is for actionable states (ADR-0001).
4. **`sıradaki` when everything is blocked/running:** `undefined`, no marker — it is the first
   SPAWNABLE task, so a `repo_yok` first row cannot steal it.
5. **`roadmap validate` on an absent file:** exit 0 ("nothing to validate") — the empty surface is
   the invitation state, not an error.
6. **`unknown_repo` severity:** warning (a typo'd repo blanks one task's spawn, never the whole
   surface); `front_matter_mismatch`: error and readiness-blocking (a foreign workspace's roadmap
   must not render).
7. **`saveRoadmap` strictness:** refuses no-fence documents too, not only non-empty broken fences —
   Docket's write path never destroys the machine fence.
8. **"store + CLI" for docs_root (In-scope) needs a CLI surface:** added the `docs-root` command
   (D12); the settings FIELD stays WO-0049's.
9. **Antreo fixture scope:** frame-01's 4 fazlar exactly (the mockup's f2/f4 metas say 0/3 while
   rendering 1–2 rows — offscreen rows; the fixture gives each 3 tasks). Frame-05's 9-faz world is
   the WO-0050 draft world and is deliberately not reproduced.
