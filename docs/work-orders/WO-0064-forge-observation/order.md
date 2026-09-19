---
id: WO-0064
title: "Forge observation — the port's first consumer: the observed forge cache + ADR-0010 reconciliation + the board's Depo section"
workspace: docket
status: open
mode: plan
review: light
review_mode: gates
tracks:
  - repo: app
    depends_on: []
---

# WO-0064 — Forge observation — the port's first consumer

## Objective

The forge chain's third link: the `Forge` port (WO-0063) gains its first consumer. The store's
observed half (ADR-0010) gains its forge tables — per connected repo, a cache of PR facts, the
open PRs' head-sha check runs, and a scan meta row carrying health + the last-looked stamp.
A core reconciliation function reads the forge and writes that cache; the composition root
fires it on ADR-0010's cadence (open, focus, after actions, manual refresh, a slow background
interval); the board surfaces one honest section per repo: health line, open PR rows, «son
gözlem» stamp. Read-only end to end — observation wins, a degraded scan never wipes the cache,
and nothing in the closure gate, stage derivation or drive pipeline changes.

## Context

- **ADR-0010 is this WO's constitution:** observed rows are a cache with `observed_at`
  (dropping them all costs only a re-scan); reconciliation is "on workspace open, on window
  focus, after any action it takes, on a manual refresh, and on a slow background interval";
  when observation disagrees with what Docket showed, observation wins and is surfaced; a
  degraded dependency yields `unknown`, never a guess; a screen that cannot say when it last
  looked is claiming more than it knows.
- **The port is ready:** `src/core/forge.ts` (`health` / `pullRequests` / `pullRequestForSha` /
  `checks`) + `src/adapters/forge/github.ts`, fixture-pinned. The composition root does not
  import it yet — this WO is that import.
- **Today's cache reality (probed 2026-09-19):** the OBSERVED half (workspace / work_order /
  track / step) is written only by `createWorkOrder` (`store/index.ts:1436-1457`); the fixture
  seed is dev/test-only (`reseedObserved`); NO git scanner exists (the M3 yaml scanner remains
  open — NOT this WO). `track.pr_url / pr_head_sha / merged_at` are NULL in practice; the
  closure sha lands in `gate_closure_docs_sha` at close time (`rev-parse HEAD`).
- **The connections are the read set:** `connection` rows (`workspace_id, repo_remote,
  local_path`) — the adapter's `parseRepoRemote` turns `repo_remote` into a `RepoRef` at read
  time (WO-0063 answer 1). An unparseable remote is a skipped repo with a degraded scan meta —
  never a guess, never a crash.
- **UI idioms (probed):** sections gate themselves absent when empty
  (`DetailSections.tsx:1-9`); refresh is the nonce re-fetch (`reloadDetail` / `refreshWorkOrders`,
  App.tsx:180-274); the renderer already runs 1s tick clocks; there is NO focus listener or
  interval today (main.ts subscribes only resize/move/close). IPC naming:
  `docket:<port>:<kebab-method>`, one `ipcMain.handle` per method.
- **Layering:** the scan runs in the composition root (the only place the adapter is imported);
  its orchestration is a pure core function with injected ports (the `pipeline.ts` precedent);
  the cache is store-implemented behind a core port. No vendor name leaves
  `src/adapters/forge/`.

## Scope

In scope:

- **Port additions (core, test-first):** `ForgePr.title?: string` (both wire paths carry it;
  the board reads it); the `ForgeObservations` port (the cache: per-repo scan write — meta +
  PR page + head-sha checks in ONE idempotent record; per-workspace view read); the
  `ForgeView`/`ForgeRepoView` types; ONE core function
  `reconcileWorkspaceForge({ forge, observations, connections, at })` — per connection:
  `parseRepoRemote` → `pullRequests(repo, 'open')` → `checks` for each open head sha (closed /
  merged PRs get no check reads in v1) → one `recordForgeScan`; any failure degrades THAT repo
  only (meta carries the reason + `at`; prior facts stay — a degraded scan never wipes the
  cache); a scan while the same repo's page returns fewer rows is a replace (observation wins —
  a PR fallen off the open page is absent after the scan).
- **Store:** three OBSERVED tables (`forge_scan`, `forge_pr`, `forge_check` — every row
  `observed_at`, all in `OBSERVED_TABLES`), the `ForgeObservations` implementation (one
  transaction per scan; upsert idempotent), the view join over connections × scan × prs ×
  checks; `WorkOrderSource` gains `reconcileForge(id)` + `forgeView(id)`.
- **Composition root:** the `GitHubForge` singleton; `docket:source:reconcile-forge` +
  `docket:source:forge-view` handlers; a per-repo in-flight guard (a scan that overlaps a
  running one is a no-op — the loop is idempotent).
- **Renderer triggers:** workspace/board mount (open), window `focus`, the existing
  after-action handlers, a manual «Yenile» chip on the section, a 60 s interval (the slow
  background tick — renderer-hosted like the existing clocks; no push channel needed).
- **UI:** the board screen's `Depo` section — per connected repo ONE line: repo + health/stamp
  (ok: «son gözlem HH:MM»; degraded: the reason line), open PR rows beneath (number, title,
  branch → state); the section ABSENT when the workspace has no parseable connection (ADR-0001
  absent-not-disabled; ADR-0012 empty grammar). Labels in both bundles, key parity.
- **Tests:** core reconcile pins (happy path, degraded-preserves-cache, replace-on-scan,
  unparseable-remote skip, checks only for open heads); store pins (OBSERVED_TABLES drops
  them on reseed, upsert idempotence, view join, per-repo isolation).

Out of scope:

- The closure gate, `canClose`, `gate_closure_docs_sha`, evidence status/stage (TD-008) —
  queue item 5's WO; `pullRequestForSha` stays unconsumed until then.
- Agent git actions / the operator git console (queue item 6); the git yaml scanner
  (its own M3 item); `wo_event` forge kinds (the schema comment's anticipation — observations
  are cache, not audit; revisit if a consumer needs the trail).
- Any forge WRITE; any PR click-through/browser open (rows are facts, not links, in v1).
- WO detail's record sections (the board carries the v1 surface; ADR-0013's scroll untouched).

## Acceptance criteria

1. `reconcileWorkspaceForge` is unit-pinned: happy scan records meta + PR page + per-head
   checks; a degraded forge records the reason and PRESERVES prior rows; the replace rule and
   the unparseable-remote skip both pinned; checks are read for open heads only.
2. The three tables sit in `OBSERVED_TABLES` (a reseed drops them; a re-scan rebuilds them —
   pinned); `recordForgeScan` is idempotent under repeat (no duplicate rows, `observed_at`
   refreshed).
3. The board's Depo section renders health + open PRs + «son gözlem» after a successful scan,
   the degraded reason line after a failed one, and is absent with no connection; focus,
   after-action, manual and the 60 s tick all trigger reconciliation; labels parity tr/en.
4. Full ladder green: `npm run typecheck` (both), `npm test`, `npm run build`,
   `npm run check:boundaries`; E2E untouched (a live-forge-dependent spec would be
   environment-flaky — the surface is verified by running, per the house rule).

## Evidence required

- plan_approval: mode `plan` — this order IS the approved session plan (the operator's
  continuing BUILD-FIRST delegation; the explore map of 2026-09-19 is the ground truth).
- operator_checkpoint: DEFERRED to the end-of-build test phase (BUILD-FIRST, 2026-09-19) — the
  board section joins the deferred tour list.
- ci_green: PENDING — the ladder at the working tree, recorded at PR time.

## Stop-and-ask gates

- Any change to `canClose`, the closure flow, or `track` row semantics (the scanner's future
  home — not here).
- A forge WRITE, or a scan path that would prompt, cache credentials, or log auth output.
- Cache rows without `observed_at`, or an observed table outside `OBSERVED_TABLES`.
- A degraded scan wiping prior facts (observation wins — the wipe is the lie).
- A vendor literal outside `src/adapters/forge/`; a `.replace(` in `src/ui/`; a disabled
  control anywhere.

## Notes

- Chain position: probe (WO-0062) → port (WO-0063) → **observation (this)** → closure gate
  upgrade (queue 5) → agent git actions + Changes surface (queue 6).
- Rate budget (probe §2): one scan = 1 + openPR-count calls per repo; at the 60 s tick with
  docket's single repo and zero-to-few open PRs this is two orders of magnitude inside the
  5000/h budget.
- The Depo section is the reconciliation's VISIBLE proof; «son gözlem» is ADR-0010's
  last-looked vocabulary entering the UI for the first time.
