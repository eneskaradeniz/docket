# WO-0010 — plan

> Rulings on the three gates and the resulting design. `mode: plan`; solo — the operator covers the
> architect role (ADR-0001), reasons recorded here.

## Objective (restated)

Persist the runner's live sessions so they survive restart and resume-by-id works, without coupling the
runner adapter to the store and without storing the transcript.

## Rulings — the three gates

### 1. Write path — MAIN SIDE-EFFECT

The composition root (`electron/main.ts`) already holds both the runner and the store, and already
iterates the runner's event stream in the `docket:runner:drive` handler. It writes the session record as
events flow. This keeps the runner adapter and the store adapter **decoupled** (ADR-0006 — adapters
implement ports; the root orchestrates between them) and avoids a write IPC channel from the renderer. By
analogy to TD-021 ("`reseedObserved` not over IPC"), `recordSession` is main-internal.

Rejected: a renderer→main write IPC (the renderer would own persistence timing) and runner→store coupling
(the adapter would depend on the store). Both cross layers the root is meant to hold.

### 2. What persists — ID/ROLE/SCOPE/STATUS/COST; NOT THE TRANSCRIPT

Docket owns session ids/role/scope (ADR-0010); the conversation belongs to the provider, which writes its
own on-disk transcript keyed by id (`~/.claude/projects/…`). Docket stores the **pointer** (provider id)
plus the runtime facts the board/pane need (status, cost) — not the content. Per-WO cost **aggregation**
is a later item; WO-0010 captures cost **per session**.

### 3. Resume + cwd — MAIN FILLS CWD; PANE OFFERS RESUME

Resume is cwd-scoped (WO-0001 Q5): the SDK resumes a session only from its originating project directory.
The renderer cannot know filesystem paths (ADR-0006), so main fills `cwd` (the pilot's repo; per-track
paths via the connection table in M3/M4). The pane shows a resume affordance **only when** a persisted
session exists for the role (absent otherwise — ADR-0001); resume = `drive({ resume: providerSessionId })`.

## Design

### Data model changes

- `DriveInput` (`src/core/runner.ts`) += `workOrderId: WorkOrderId`, `scope?: TrackId`. The runner adapter
  ignores them (it uses cwd/mode/role/prompt/resume/approve); main reads them to associate the persisted
  session.
- `SessionRef` += `providerSessionId?: string` (present on live sessions; absent on the fixture examples;
  ignored by `derive.ts`).
- `session` table (`src/adapters/store/schema.ts`) += `provider_session_id TEXT UNIQUE`,
  `cost_tokens_in INTEGER`, `cost_tokens_out INTEGER`, `cost_usd REAL` — all nullable. Seeded rows carry
  NULL (SQLite allows multiple NULLs in a UNIQUE column).

### Store (`src/adapters/store/index.ts`)

- `recordSession({ providerSessionId, workOrderId, role, scope?, status, cost? })`: upsert by
  `provider_session_id` — `INSERT INTO session (provider_session_id, work_order_id, role, scope_track_id,
  status, transcript, stop_and_ask, cost_…) VALUES (…) ON CONFLICT(provider_session_id) DO UPDATE SET
  status=excluded.status, cost_…=excluded.cost_…`. (transcript/stop_and_ask left NULL for live rows.)
- `hydrateSessions` reads `provider_session_id` + the cost columns → `SessionRef.providerSessionId`.
- `Store` interface += `recordSession`.

### main (`electron/main.ts`)

The `docket:runner:drive` handler tracks the current `providerSessionId` and writes as events flow:
`started` → `recordSession({full})`; `permission_request` → status `stopped_asking`; `turn_complete` →
status `idle` + cost; `error` → status `idle`. (`workOrderId`/`role`/`scope` come from the `DriveInput`.)

### UI (`src/ui/components/session/SessionPane.tsx`, `WorkOrderDetail.tsx`)

`SessionPane` takes `workOrderId` + the WO's `sessions`. On mount, for the selected role, if a session
with a `providerSessionId` exists it shows a **resume** affordance → `drive({ resume })`. Start /
stop-and-ask / plan-approval / cost flow unchanged. New copy in `src/ui/data/labels.ts`; absent-not-disabled.

## Task breakdown

1. `order.md` + this `plan.md`.
2. Core: `DriveInput` += workOrderId/scope; `SessionRef` += providerSessionId.
3. Schema: `session` += provider_session_id + cost columns.
4. Store: `recordSession` upsert + hydrate; test the upsert (idempotent) + hydrate (providerSessionId).
5. main: persist in the drive handler.
6. UI: resume affordance + WorkOrderDetail wiring + labels.
7. Verify (typecheck/test/build/boundaries; headless drive→persist→reopen→resume); PR.

## Verification (AC → how checked)

- **AC1/AC4:** `store.test.ts` — `recordSession` upserts (no duplicate on re-run) and hydrates
  `providerSessionId`/cost.
- **AC2/AC3:** headless drive (`vite-node`) → `recordSession` writes; reopen the store → the row carries
  the provider id + status + cost; `getWorkOrder` hydrates it.
- **AC5:** `npm run check:boundaries` clean; `recordSession` called only in `electron/main.ts`.
- **AC6:** typecheck (both) / test / build / boundaries green.
- GUI resume-across-restart is operator-pending (CI can't drive a real session).

## Risks

- **Resume cwd mismatch.** If the pilot repo path changes between runs, resume fails (Q5). Acceptable for
  the pilot; per-track cwd via the connection table is M3/M4.
- **Stale status across restart.** A session persisted as `stopped_asking` shows that way on restart even
  though no drive is active; resume re-drives. Acceptable (the operator sees pending attention).
- **UNIQUE(provider_session_id) with NULLs.** SQLite allows multiple NULLs — verified behaviour; seeded
  rows (NULL) coexist with live rows.

## Tech debt

- TD-019 (in-memory sessions) **closes** with this WO. Per-WO cost aggregation and track-scoped session
  selection remain open as follow-ups (not re-numbered; noted here).
