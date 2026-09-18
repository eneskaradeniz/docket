---
id: WO-0062
title: "Forge surface probe — measure `gh` before the Forge port freezes (the M0 discipline, second application)"
workspace: docket
status: open
mode: direct
review: light
review_mode: gates
tracks:
  - repo: app
    depends_on: []
---

# WO-0062 — Forge surface probe — measure `gh` before the Forge port freezes

## Objective

M3's evidence layer (`Forge` interface, GitHub implementation over `gh`; health checks;
reconciliation; PR / head-sha / check-run ingestion) freezes a port contract against an external
programmatic surface. WO-0001's lesson applies verbatim: **measure the surface before any
assumption is frozen.** This WO probes the `gh` CLI's read surface and delivers a findings report
plus a proposed `Forge` port sketch. It writes NO production code — the port itself is the next
work order's job, informed by what the probe actually finds.

## Context

- **ROADMAP M3 head items this feeds:** `Forge` interface + GitHub implementation; health checks
  (`git`, `gh auth status`, the agent CLI — "a degraded dependency yields `unknown`, never a
  guess"); reconciliation ("merged-outside-Docket is normal"); PR / head sha / check-run
  ingestion.
- **The connection model already carries a remote:** `connection.repo_remote` is filled
  best-effort via `git remote get-url origin` (`src/adapters/store/index.ts:792`, applied at
  `:821-822` and `:884-889`). The probe must say whether that best-effort is enough or the
  remote→owner/repo mapping needs a real function (https / ssh / `git@alias:` / `.git` suffix /
  enterprise-host forms).
- **`RepoConnectionInput.remote`** (`src/core/source.ts:12-15`) exists but no UI sets it — the
  probe decides whether the Forge WO needs it at all or the resolution stays adapter-side.
- **Vendor-name line (ADR-0006):** `Forge` stays a vendor-neutral core interface; GitHub/`gh`
  names appear only in this report (a docs file), in `src/adapters/`, and in the ROADMAP line
  that already names it. The port sketch in the report must read like `SessionRunner`'s
  definition — roles and data, no vendor vocabulary in method names.
- **Sandbox lesson (2026-08-30 queue memory):** probes run sandboxless; every gh call in the
  matrix is READ-ONLY and listed in this order — the operator allow-lists them once (the
  WO-0055 probe-permission precedent: allow-list first, operator OK, then run).

## Probe matrix (READ-ONLY — every command listed here)

1. **Presence / version / auth.** `gh --version`; `gh auth status` (plain and `--json` if
   supported — probe whether machine-readable); token scopes. Deliverable: what a health check
   can honestly read without prompting, and the degraded shapes when absent/expired.
2. **Rate budget.** `gh api rate_limit` — REST core vs GraphQL budgets, reset windows. Can a
   ~30s-interval reconciler live inside them without a token of its own?
3. **PR ingestion.** `gh pr list --json <fields>` — enumerate the useful field set (state,
   headRefOid, headRefName, baseRefName, reviewDecision, statusCheckRollup, mergedAt, url, …).
   Which SINGLE call answers "this repo's open PRs + their CI state"?
4. **Check-runs.** `pr view --json statusCheckRollup` vs
   `gh api repos/{owner}/{repo}/commits/{sha}/check-runs` — shape, required-vs-all, pagination.
5. **Sha → PR resolution.** Given a head sha (Docket's closure-candidate fact): `gh pr list
   --head <branch>`, the commit-association endpoint
   (`gh api repos/{owner}/{repo}/commits/{sha}/pulls`), or search — which resolves reliably, and
   at what cost?
6. **Remote parsing.** The forms `git remote get-url origin` really returns across the
   operator's machines (https, ssh, alias, `.git`, enterprise) → the owner/repo mapping, and
   what today's raw-string storage misses.
7. **Multi-repo auth.** One token, many repos (antreo: 3) — scopes needed for private repos,
   and what `gh auth status` reveals per-host.
8. **Failure shapes.** Exit codes + stderr classes for: no auth, private repo without scopes,
   network down, empty repo. The honest `unknown` inputs for the health-check ruling.

## Deliverable

- `report.md` in this folder: one section per matrix item, each with the command, an observed
  output excerpt, and the finding. `unknown` where the environment blocks — never a guess.
- The report ENDS with the proposed `Forge` port sketch: the minimal method set for ingestion +
  reconciliation + health, each method annotated with the gh call(s) it would use and their
  observed cost, plus the open design questions for the next WO (e.g. does `connection` gain a
  column, or does the adapter resolve remotes at read time?).
- A throwaway probe script is allowed (WO-0001 precedent); it lives in the WO folder, not
  `scripts/`, and is not wired anywhere.

## Out of scope

- Any `src/` change — the tree must come back clean (`git status` shows only this folder).
- Any gh WRITE call (no comment, no label, no draft, no merge — read surface only).
- Implementing the `Forge` port, the health-check UI, or reconciliation.
- Fixing the store's best-effort remote (the report recommends; the next WO executes).

## Acceptance criteria

1. All eight matrix items have a section in `report.md` with command + excerpt + finding;
   environment-blocked items say `unknown` with the blocker named.
2. The report's port sketch is vendor-neutral in shape (reads like a core port definition) and
   cites the observed gh reality for every method.
3. `npm run typecheck` + `npm test` + `npm run check:boundaries` still green — nothing but this
   folder changed.
4. ROADMAP gains the WO-0062 line at closure (M3 section), and the report is cited from it.

## Evidence required

- plan_approval: mode `direct` — this order IS the plan (the light-review posture; the probe
  matrix above is the plan).
- probe_permissions: the read-only gh allow-list, presented to and OK'd by the operator before
  the first call (the WO-0055 precedent).
- operator_checkpoint: DEFERRED to the end-of-build test phase (BUILD-FIRST, 2026-09-19) — the
  report itself is the reviewable artifact.
- ci_green: green at the working tree (docs-only WO — the ladder runs to prove the tree clean).

## Stop-and-ask gates

- Any gh call outside the matrix's read-only list (write scope of any kind).
- Any `src/` edit, or a `Forge` interface file landing in `src/core/` before the findings exist.
- The port sketch drifting vendor-shaped (method names carrying forge-product vocabulary).
- Scope growth into the store's remote resolution (recommend, don't execute).

## Notes

- This WO is the M0 pattern applied to the evidence layer; its findings are the next WO's
  `Context`, exactly as WO-0001's findings seeded WO-0008.
- Antreo (3 private repos, cross-repo chain) is the calibration target for item 7 — if the
  operator's gh token can read them, probe against one as a live sample; if not, that is a
  finding about the onboarding path, not a blocker.
