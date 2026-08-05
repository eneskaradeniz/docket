---
id: WO-0010
title: Session/cost persistence + resume (live sessions survive restart)
workspace: docket
status: closed # draft | planning | plan-review | implementing | review | audit | merging | closing | closed
mode: plan # plan | direct
tracks:
  - repo: app
    depends_on: []
---

# WO-0010 — Session/cost persistence + resume

## Objective

Make the runner's live sessions survive restart. WO-0008 drives real sessions but holds them in-memory
(TD-019); the SDK supports resume-by-id (cwd-scoped, WO-0001 Q5) but Docket does not store the id, so a
restart loses the association. WO-0009 stood up the SQLite store with an owned `session` table ready for
this. WO-0010 writes live sessions to the store **as a side-effect of driving** (provider id, role, scope,
status, cost — not the transcript, which the SDK keeps on disk) and the session pane offers
**resume-by-id**. Completes the runner loop; closes TD-019.

## Context

- `docs/adr/ADR-0010-docket-observes-it-does-not-own.md` — Docket owns session ids/role/scope; the
  conversation belongs to the provider. "Losing the database costs a re-scan, not a decision."
- `docs/adr/ADR-0006-layering-and-provider-independence.md` — adapters decoupled; the composition root
  orchestrates.
- `docs/adr/ADR-0002-session-roles-and-lifetimes.md` — implementer sessions are per-track (scope).
- `docs/probes/cc-surface/findings.md` Q5 — resume is cwd-scoped (resume from the originating project dir).
- `src/core/runner.ts` — `SessionRunner` port, `DriveInput`, `RunnerEvent`, `SessionRef`.
- `src/adapters/runner/` — the SDK adapter (emits `started`/`permission_request`/`turn_complete`/…).
- `src/adapters/store/` — the SQLite store; owned `session` table (id, work_order_id, role, scope_track_id,
  status, transcript, stop_and_ask). Read-only today.
- `electron/main.ts` — the composition root; the `docket:runner:drive` handler iterates events.
- `src/ui/components/session/SessionPane.tsx` — drives + folds events into `LiveSessionState`.
- `docs/tech-debt.md` — TD-019 (in-memory sessions, closed by this WO); TD-021 (no IPC for store writes).

## Scope

In scope:

- Persist live sessions to the store **as a main side-effect of driving**: provider session id, work order
  id, role, scope (nullable), status, per-session cost. (Not the transcript — ADR-0010.)
- A store `recordSession` upsert (by provider session id); hydrate exposes `providerSessionId`.
- `DriveInput` += `workOrderId` (+ `scope?`) so main can associate the session.
- Resume-by-id from the session pane when a persisted session exists for the role.

Out of scope:

- Per-work-order cost **aggregation** (a later M2 item); WO-0010 captures cost per session only.
- The transcript / stop-and-ask content (the SDK keeps the transcript on disk by id).
- Track-scoped session selection in the UI (the pane does not pick a track yet; `scope` is nullable).
- Exposing any store write over IPC (`recordSession` is main-internal — TD-021 analogy).

## Acceptance criteria

1. Driving a session writes a `session` row with the provider id; reopening the store hydrates it with
   `providerSessionId`, role, status and cost.
2. The persisted session survives an app restart: on reopen, `getWorkOrder` returns it; the pane offers
   resume, and resume (`drive({ resume })`) continues on the same provider session id.
3. Status is updated as the run progresses (`running` → `stopped_asking` → `idle`) and cost is recorded on
   `turn_complete`.
4. `recordSession` is an upsert (re-running for the same provider id updates, never duplicates); covered
   by a test.
5. The renderer never writes; `recordSession` is called only by `electron/main.ts`. No Node/vendor surface
   leaks to the renderer; `npm run check:boundaries` clean.
6. `npm run typecheck` (both), `npm test`, `npm run build`, `npm run check:boundaries` are green.

## Evidence required

- plan_approval: architect verdict, `plan.md` committed
- pr_open: PR URL, head sha
- ci_green: all required checks `success` (observed, not enforced — TD-013)
- verification: operator-covered (solo); the upsert/hydrate test; a headless drive → persist → reopen →
  resume; the GUI resume-across-restart is operator-pending
- closure: all tracks merged, `ROADMAP.md` + `docs/tech-debt.md` updated (commit sha)

## Stop-and-ask gates

- **Write path.** main side-effect (root holds runner + store) vs an IPC write port. Ruling in `plan.md`.
- **What persists.** provider id/role/scope/status/cost; **not** the transcript. Ruling in `plan.md`.
- **Resume + cwd.** resume is cwd-scoped; main fills cwd. Ruling in `plan.md`.

## Notes

- Solo mode; gates operator-covered (ADR-0001).
- TD-019 closes with this WO. Per-WO cost aggregation and track-scoped sessions are explicit follow-ups.

## Closure

Merged PR #7 (merge `2cd596a`). Live sessions persist to the owned `session` table as a main
side-effect of driving (provider id, role, scope, status, per-session cost); hydrate exposes
`providerSessionId`; the session pane resumes by id. **TD-019 closed.** Per-WO cost aggregation is
WO-0011; xterm transcript remains (TD-020). Verification: operator-covered (solo) — the
upsert/hydrate test, pre-WO-0010 migrate, and a headless drive → persist → reopen → resume; GUI
resume-across-restart is operator-pending.
