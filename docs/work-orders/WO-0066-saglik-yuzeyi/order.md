---
id: WO-0066
title: "Sağlık yüzeyi — the three dependencies become a first-class state: git + forge + agent, blocking on first run, visible afterwards"
workspace: docket
status: open
mode: plan
review: light
review_mode: gates
tracks:
  - repo: app
    depends_on: []
---

# WO-0066 — Sağlık yüzeyi — the dependencies become a first-class state

## Objective

M3's health-check line: `git`, the forge CLI and the agent identity get ONE health view —
`DependencyHealth` rows composed in the composition root, surfaced twice per the ROADMAP's own
words: **blocking on first run** (the zero-workspace onboarding hides the create action while a
required dependency is OBSERVED degraded — absent with a reason, never disabled), and **visible
and non-blocking afterwards** (a slim strip on the board). A degraded dependency yields
`unknown`, never a guess — and the gate itself never blocks on a look that failed.

## Context

- **Two of the three checks already exist:** `Forge.health()` (WO-0063, fixture-pinned,
  unconsumed) and `checkProvider()` (the runner adapter; the appbar's provider identity). The
  third — git presence/version — is new, one spawn (`git --version`), host-side.
- **The measurement basis:** WO-0062 §1 (auth shape) + §8 (exit≠0 is the universal degraded
  signal); the forge scan's per-repo degraded meta (WO-0064) is the per-repo face of the same
  ruling — this WO adds the TOOLING face.
- **ADR-0010 «Health is a first-class, visible state»:** checks at first run and on every
  reconciliation; first run blocks on anything required and explains what is missing;
  afterwards visible non-blocking; a degraded dependency turns the facts it feeds into unknown
  rather than stopping the app.
- **ADR-0001 absent-not-disabled governs the gate:** the create action whose evidence is unmet
  is ABSENT with a line stating why — never a disabled button. The terminal-lock and
  guarded-row exceptions do not apply here.
- **The gate blocks only on OBSERVED degradation.** A failed or absent health LOOK renders no
  gate (unknown never stops the app — the first-run block is the ROADMAP's explicit exception
  for observed missing dependencies, not for a broken look). Required for the gate: **git +
  agent** (the workspace can be created and driven without the forge; the forge's absence shows
  its reason and the forge-dependent facts stay unknown). This keeps the E2E environments
  (no forge auth) honest without bricks.
- **Layering:** core declares the types + the watch port; the composition root composes the
  three checks (it owns the forge adapter and the provider check); the git spawn is a tiny
  adapter file (node-side tsconfig, the store's pattern).

## Scope

In scope:

- **Core (test-first):** `src/core/health.ts` — `DependencyHealth`
  (`{ tool: 'git' | 'forge' | 'agent'; state: 'ok' | { degraded: reason }; version?: string }`),
  `SystemHealth` (`{ checks; at }`), the `SystemHealthWatch` port (`systemHealth()`).
- **Adapter:** `src/adapters/health.ts` — `gitHealth()` over an injected command seam (the
  GhResult shape, declared locally — adapters stay decoupled); parse the version token;
  non-zero exit / spawn failure → degraded with the stderr line; an unparseable version output
  is ok WITHOUT a version (absence is absence, never a guess).
- **Composition root:** the `SystemHealthWatch` implementation composing `gitHealth()` +
  `forge.health()` + `checkProvider()`; the `docket:health:system` channel; the bridge group
  `docket.health` (optional, the forge-group pattern).
- **Renderer:** the **health strip** on the board — one dim mono row (tool name verbatim, a ✓
  mark, git's version) above the Depo section; a degraded tool speaks its reason verbatim as
  its own line. Fetched on mount + riding the existing focus/60 s triggers (view-only — no
  reconcile). The **first-run gate**: on the zero-workspace surface, while git or agent is
  OBSERVED degraded, the create-workspace CTA is absent and the three health rows render in its
  place (the one-line "where the action waits" note per ADR-0001); afterwards (any workspace
  exists) the gate never fires again. Labels in both bundles, key parity.
- **Tests:** adapter pins (ok+version, exit≠0, spawn failure 127, versionless-ok); core shape
  pins; the gate rule is a renderer concern — verified by running (the house rule), its inputs
  pinned in core.

Out of scope:

- Turning dependent FACTS unknown (TD-008's `EvidenceStatus.unknown` — its own M3 line); the
  per-repo scan degraded meta already does this for forge facts (WO-0064).
- Reconciliation's git half (the yaml scanner); any auto-fix/install flow; settings UI for
  health; the appbar (WO-0060's chip already carries the account face).
- Any new forge call beyond the existing `health()`.

## Acceptance criteria

1. `gitHealth` is pinned: ok with the parsed version, non-zero exit and spawn failure degrade
   with the carried line, unparseable output is ok-without-version.
2. The strip renders the three tools' states (ok marks + git's version; degraded reasons
   verbatim) and rides mount/focus/interval; labels parity tr/en.
3. On the zero-workspace surface, an observed git/agent degradation hides the create CTA
   (absent + reason lines, no disabled attribute anywhere — the boundary check stays clean);
   a failed health look hides only itself.
4. Full ladder green: typecheck (both), `npm test`, `npm run build`, `check:boundaries`.

## Evidence required

- plan_approval: mode `plan` — this order IS the approved session plan (the continuing
  BUILD-FIRST delegation, 2026-09-19).
- operator_checkpoint: DEFERRED to the end-of-build test phase (BUILD-FIRST, 2026-09-19) — the
  scenario joins the deferred tour: an empty DB's onboarding shows the health rows; rename git
  off PATH, relaunch, read the gate.
- ci_green: PENDING — the ladder at the working tree, recorded at PR time.

## Stop-and-ask gates

- A disabled/aria-disabled control anywhere (the gate is absence + reason, ADR-0001).
- The gate firing on `unknown`/failed look, or after any workspace exists (first run means
  first run).
- The forge check gating workspace creation (visible-only by this order's ruling).
- A vendor literal outside `src/adapters/`; an auto-install side effect.

## Notes

- Chain position: probe → port → observation → closure evidence → **health (this)** → agent
  git actions + Changes surface → TD-008/009 + gate engine → M3.5 → M4 → M5.
- The strip is deliberately ONE row on an existing screen — ADR-0012's economy; the Depo
  section stays repo-scoped, the strip is tooling-scoped.
