---
id: WO-0088
title: "The parallel spine — N work orders driving at once, each in its own working copy"
workspace: docket
status: open
mode: direct # plan | direct
review: full # light | full
review_mode: gates
tracks:
  - repo: app
    depends_on: []
---

# WO-0088 — the parallel spine

## Objective

The antreo wave (2026-09-21, `antreo-app/wt/DEVIR.md`): N issues → worktrees → parallel
sessions (2× Claude Code + 1× Antigravity pilot) → per-session reports → sequenced merges.
Docket cannot host this today because it is written around ONE drive at a time — a structural
assumption at four layers. This WO keys them: **one active drive per work order, N work orders
(and a ✦ draft) driving simultaneously, each in its own working copy.** This is the spine the
wave rides; the second backend (Antigravity) and the issue bridge are later WOs on top of it.

## Context (measured 2026-09-21)

The four single-drive assumptions, layer by layer:

1. **Adapter** — `src/adapters/runner/index.ts:301` holds per-instance singleton state
   (`currentQueue/currentAbort/currentInput/currentQuery`): one runner instance supports
   exactly one concurrent drive; a second `drive()` clobbers the first.
2. **Composition root** — `electron/main.ts:543` keeps a single `activeDrive` generator, and
   the `docket:runner:event` channel broadcasts every event to the single invoking sender
   (`main.ts:548`); `docket:runner:abort` closes the one drive.
3. **Pipeline** — `src/core/pipeline.ts:158` keeps a single `active` steer-note surface,
   cleared in the drive's `finally`.
4. **Renderer** — `src/ui/components/session/drive-store.ts:87` keeps one `active` key
   ("the one running key"); the per-surface key vocabulary (`woId:free`, `woId:step:N`,
   `woId:review:N`, `wsId:draft`) already exists — the singleton guard is what narrows it.

Plus the fifth wave fact: `driveCwd` (`src/adapters/store/index.ts:1538`) always resolves the
connected repo root. A wave lands each drive in a per-WO working copy (the operator's
worktree), so a WO needs its own cwd override.

## Frozen decisions (2026-09-21, operator)

- **Concurrency scope:** N work orders + one draft in parallel; still ONE drive per work
  order at a time — a WO's step sequencing stays serial (no parallel steps within a WO).
- **Worktrees stay the operator's act** (the `setup.sh` + rebase discipline; ADR-0010):
  Docket only aims the drive at a path; it never creates, moves or prunes working copies.
- **Branch discipline under Docket follows ADR-0017** (`wo-NNNN-<slug>`, PR titled
  `WO-NNNN — …`); the `feature/issue-N` habit remains the out-of-Docket terminal convention.
- **Prompt/discipline content rides the target repo** — the wave's kickoff rules live in the
  antreo repo's `CLAUDE.md`/`.claude/agents/`, which auto-load because the drive cwd IS the
  worktree. No Docket prompt-template change in this WO.

## Open design questions (settled in implementation, pinned by tests)

- **cwd override home:** order.md front-matter (`cwd:` — order.md already carries paths,
  WO-0015's local-context precedent) vs a store column. Lean: front-matter + a create/edit
  dialog field; main fills `driveCwd` from it, connection-table fallback unchanged.
- **Event envelope:** `docket:runner:event` carries the owner key (session/owner id) on every
  event; renderer listeners filter by key.
- **Runner instances:** one `createRunner()` per drive vs a keyed map inside the adapter —
  implementer's call; the port (`src/core/runner.ts`) unchanged either way (ADR-0014 holds).
- **Concurrent asks:** N sessions may hold permission/ask cards at once; the card must say
  WHICH work order asks (WO-0077's parallel-card groundwork is the seam).
- **Keyed control:** Durdur / steer / decide target exactly one drive; the others untouched.
- **The completion guarantee** (`pipeline.ts:510`) and the store's leftover-`running` sweep
  become per-drive; a kill mid-parallel folds each drive honest, no clobbered sessions.

## Scope

**In:** the four keyed layers; per-WO cwd override; multi-live UI — the board carries N
running cards, each detail keeps ITS one live instrument (ADR-0013's per-detail grammar
unchanged); isolation tests; an E2E multi-drive scenario (scripted FakeRunner).
**Out:** the Antigravity adapter (later WO, after the stream-json probe); the issue bridge
(the WO-0081 report's consumer); merge sequencing / rebase helpers; parallel steps within a
WO; per-workspace prompt overrides.

## Acceptance

1. Two WOs of one workspace drive simultaneously — separate branches, separate working
   copies, isolated events/costs/transcripts; a ✦ draft drive runs alongside both.
2. An ask held by WO A is answered without touching WO B's held ask; each card names its WO.
3. Durdur stops exactly the targeted drive; the others keep running to completion.
4. Kill/restart mid-parallel: every drive folds honest (per-drive sweep; no `running` ghosts).
5. A WO with a cwd override spawns there; the fence still jails writes to that root.
6. Mechanical ladder green: typecheck ×2, unit, boundaries, build, E2E including the new
   multi-drive scenario.

## Notes

- Permission cadence under parallelism: per-WO `permission_rule` already exists
  (`policyForRule`); `risky_excluded` keeps push/PR-create asking (ADR-0017). Three drives
  may ask at once — the concurrent-card UX question above covers it.
- The workspace budget gate is workspace-keyed and spawn-time already (`budgetBlockFor`) —
  a parallel wave is refused per-drive correctly; nothing to change.
- Sequenced after this WO (operator-approved queue, 2026-09-21): the `agy` stream-json probe
  → the issue bridge (the WO-0081 contract) → the second adapter if the probe passes.
