---
id: WO-0071
title: "M4 makinesi — the cross-repo machinery: track depends_on input + the briefing bundle (DateApp onboards on it)"
workspace: docket
status: open
mode: plan
review: light
review_mode: gates
tracks:
  - repo: app
    depends_on: []
---

# WO-0071 — M4 makinesi — the cross-repo machinery

## Objective

M4's machinery, so the second workspace onboards on rails rather than by hand: (1) the WO
create flow gains per-track `depends_on` selection — the `track_depends_on` table gets its
first runtime write path (the table has existed, empty, since the fixture era; the read side
`deriveTrackMerge` already consumes it); (2) the briefing bundle: a dependent implementer's
prompt carries its dependency's latest report — the cross-repo contract reaches the agent
through the prompt, read at view time per ADR-0010 (no text stored). DateApp itself onboards
in the operator's tour; this WO makes that tour a fill-in-a-dialog act.

## Context

- **The gap map (2026-09-19):** `CreateWorkOrderInput.trackRepos` is plural and the modal
  multi-selects tracks (WoCreateModal.tsx:156-177) — but `track_depends_on` has NO runtime
  write path (created at schema.ts:57, read at hydrate :180-184, never inserted; all fixtures
  `dependsOn: []`). The consumer waits ready: `deriveTrackMerge` (derive.ts:342) derives the
  merge-waiting state from it.
- **The briefing bundle's honest v1:** when track A depends on track B, A's implementer steps
  read B's LATEST step report as briefing material — the dependency's contract is the report
  the dependency's implementer already wrote (WO-0020's artifact). The prompt names the file
  PATH (the agent reads it at its own fence — the order's `orderMdPath` precedent: prompts
  carry paths, never contents; the WO-0050 draft-drive ruling). Multiple dependencies → the
  latest report per dependency, listed.
- **The modal grammar (ADR-0012):** the depends_on picker appears per selected track ONLY
  when ≥2 tracks are selected (one track = nothing to depend on — the group is absent); a
  track cannot depend on itself; the selection is chips like the track picker.
- **The plans' step model already scopes per track** (`resolveStepScope`, StepScope) —
  depends_on composes with it at the derive level; this WO writes and carries the facts, the
  derive half exists.

## Scope

In scope:

- **Core (test-first):** `CreateWorkOrderInput` gains `trackDependencies?: Array<{ repo:
  RepoId; dependsOn: RepoId[] }>` (absent = today byte-for-byte); validation pure (self-
  dependence rejected, unknown repo rejected, duplicate pairs rejected) — pin the rejections;
  the store's `createWorkOrder` inserts `track_depends_on` rows from it; `buildOrderMd`
  (decision-store) serializes `depends_on:` back into the order.md `tracks:` fence (the
  keys are English, values verbatim — ADR-0016's fence discipline; today it writes
  `depends_on: []` always) and the round-trip is pinned (write → re-read → same rows).
- **The briefing bundle (store, test-first):** `buildStepPrompt`'s input gains the
  dependency briefing: for the step's scope track, each `depends_on` track's LATEST verifier
  or implementer report path (from `work_order_step` rows, latest idx first, first existing
  file wins) — the prompt gains ONE section listing the paths (never file contents); no
  dependencies → the section is absent byte-for-byte. Pinned.
- **UI:** WoCreateModal — the per-track depends_on chips (visible when ≥2 tracks; cannot
  target self; ADR-0001 grammar — a track with no possible dependencies shows nothing);
  labels tr/en parity; the create flow round-trips through the store pins.
- **The ROADMAP M4 boxes** at closure: the two machinery lines mark what DELIVERED
  (`depends_on` + briefing bundle); the «DateApp onboarded» box stays OPEN (the operator's
  tour onboards it — the machinery is this WO's deliverable; honesty over box-ticking).

Out of scope:

- Cross-WO dependencies (track_depends_on is intra-WO by schema — `depends_on_track_id` is
  the WO's OWN track; cross-WO ordering is the roadmap layer's `depends_on`, ADR-0016);
  briefings from OTHER work orders; DateApp's actual onboarding (the operator's act);
  `deriveTrackMerge` changes (it exists); the workspace overview (M5, next WO).

## Acceptance criteria

1. `createWorkOrder` with `trackDependencies` writes the `track_depends_on` rows (pin);
   absent → zero rows written (byte-stable); the validation rejections pinned.
2. order.md `tracks:` round-trips `depends_on:` (write → parse → same dependency pairs).
3. A dependent track's step prompt lists the dependency's latest report path(s); an
   independent track's prompt is byte-identical to today (the existing prompt tests pass
   unmodified; new pins for the briefing section).
4. The modal's picker appears only with ≥2 tracks, blocks self-dependence, round-trips the
   selection into the store pin; labels parity tr/en.
5. Full ladder green: typecheck (both), `npm test`, `npm run build`, `check:boundaries` (10).

## Evidence required

- plan_approval: mode `plan` — this order IS the approved session plan (the "tüm işleri
  bitir" delegation, 2026-09-19).
- operator_checkpoint: DEFERRED to the end-of-build test phase (BUILD-FIRST, 2026-09-19) —
  the DateApp onboarding IS the deferred tour's M4 act.
- ci_green: PENDING — the ladder at the working tree, recorded at PR time.

## Stop-and-ask gates

- Briefing CONTENT entering the store or the prompt (paths only — the WO-0050 ruling).
- A cross-WO dependency shape sneaking into `track_depends_on`.
- The M4 «DateApp onboarded» box checked by anything but the operator's real onboarding.
- A derive change to `deriveTrackMerge` (it consumes; it does not move).

## Notes

- Chain position: M3.5 (WO-0070) → **M4 machinery (this)** → M5 overview (WO-0072) → the
  operator's single test phase (DateApp onboarding among the tours).
- The empty-since-birth table finally carrying rows is the same arc as `track.pr_url`
  (WO-0067): the schema anticipated, the machinery arrives when the product needs it.
