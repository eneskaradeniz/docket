---
id: WO-0069
title: "M3'nin kuyruğu — the gates observe: EvidenceStatus gains unknown, the verification gate is computed from resolvable pointers, TD-009's line settles"
workspace: docket
status: closed
mode: plan
review: light
review_mode: gates
tracks:
  - repo: app
    depends_on: []
---

# WO-0069 — M3'nin kuyruğu — the gates observe

## Objective

M3's remaining evidence lines, delivered as one coherent move: `EvidenceStatus` gains its
fourth value `unknown` (ADR-0010 already mandates it; every consumer handles it); the
verification gate stops being a closure-time `= 1` attestation and becomes a COMPUTATION —
the `path:line` pointers in a verifier report are extracted, resolved against the work
order's repo roots, and the result is stored per-report at record time; the track CI state
learns `unknown` from the forge scan's degraded meta. The stale ROADMAP lines settle honestly:
TD-009's file home has existed since WO-0020 (tech-debt closed it); the gate ENGINE's grammar
has been delivered since WO-0031e — what this WO adds is the observation half they were
waiting for.

## Context

- **The gap map (2026-09-19, explored):** `deriveStage` reads stored gate flags — fine for
  plan/closure, but `gate_verifier_resolvable` is hardcoded `= 1` at closure
  (store/index.ts:1990) and `EvidenceStatus` (types.ts:374) is a three-union with no
  `unknown`; `trackCiStatus` seeds a `'running'` placeholder because "the Ci type has no
  unknown state yet — TD-008" (store/index.ts:1595). Nothing parses `path:line` anywhere.
- **TD-009 is already settled** (docs/tech-debt.md:16): reports live at
  `reports/step-NN-<role>.md`, verdicts at `verdicts/step-NN.md` (decision-store.ts), written
  by the store since WO-0020. This WO's closure marks the ROADMAP line with that truth.
- **The gate engine's grammar is delivered** (WO-0031e): `derivePrimaryAction`'s
  absent-reason arms, the `AbsentReason` map, the mechanical disabled-ban. The observation
  half (evidence states that can BE unknown) is this WO's contribution.
- **Resolution semantics (the honest v1):** a pointer resolves when its PATH exists under one
  of the work order's repo roots at record time (the working tree the report was just written
  against). Recorded-sha resolution (`git show <sha>:<path>`) needs a per-report sha — a
  deliberate v1 cut, recorded in Notes; the `EvidenceStatus.unknown` arm is where a future
  sha-level resolver lands without re-shaping consumers.
- **ADR-0010's rule governs every consumer:** an `unknown` never passes a gate, never renders
  as a failure — "we could not look" is not "we looked and it failed".

## Scope

In scope:

- **Core (test-first):** `EvidenceStatus` gains `'unknown'` (types.ts); `Ci`'s run-state gains
  `'unknown'` (the union at types.ts:50-52); `extractPointers(body: string): string[]` — the
  `path:line` token extractor (path-like tokens ending `:digits`, deduplicated, quoted/backtick
  forms tolerated) as a pure export (derive.ts or a new core/pointers.ts — your call, pin it);
  consumer mappings: `woGateStatus`, `deriveEvidence`, `deriveRail`, `trackCiStatus` carry
  unknown arms; `deriveStage`'s verification input treats unknown as NOT satisfied (a gate
  never passes on unknown).
- **Store:** at `recordStepReport` (verifier role): extract pointers → resolve each against
  `woRepoPaths` (path exists under a root) → write `gate_verifier_resolvable` as computed
  (all resolvable = 1, any unresolvable = 0, no verifier report / nothing extractable = NULL
  unknown); `closeWorkOrder` STOPS overwriting it with `= 1` (the hydration keeps legacy rows
  as they are — no backfill); `hydrateTracks` reads the forge scan's degraded meta for the
  track's repo and yields the `unknown` CI state with the reason in the existing `ci_blob`
  JSON shape (no schema change).
- **UI:** the evidence/rail/track surfaces render the unknown arm through the labels
  (ABSENT-grammar-adjacent: a dim informative line, never an error tone) — tr/en parity; the
  verification gate's reason line speaks unresolved pointers when present.
- **Docs at closure:** ROADMAP's TD-008 line splits honestly ([x] the unknown half + the
  computed verification gate; [ ] the stage-from-forge-facts refinement stays open, narrowed);
  TD-009's line flips with the tech-debt citation; the gate-engine line flips citing
  WO-0031e + this WO's derivation arms.

Out of scope:

- Recorded-sha pointer resolution (the v1 cut above — Notes); plan-approval-from-commit-sha
  (TD-005); the yaml scanner (the git half of reconciliation); `deriveStage`'s new
  plan_requested/plan_ready/verification/architect_audit arms (TD-025's line — its own
  follow-up); any UI restructure beyond the unknown arms.

## Acceptance criteria

1. `EvidenceStatus`/`Ci` carry `unknown`; `woGateStatus`, `deriveEvidence`, `deriveRail`,
   `trackCiStatus` are pinned for the unknown arms; a gate NEVER satisfies on unknown.
2. `extractPointers` is pinned (plain, backticked, `:line` suffixed, deduped, non-path
   rejection); the store's record-time computation is pinned (resolvable → 1, unresolvable →
   0, no report → NULL) and `closeWorkOrder` no longer writes `= 1`.
3. The track CI unknown arm rides the scan's degraded meta (store pin), renders as an
   informative line (labels parity).
4. Full ladder green: typecheck (both), `npm test`, `npm run build`, `check:boundaries`.

## Evidence required

- plan_approval: mode `plan` — this order IS the approved session plan (the operator's
  "tüm işleri bitir" delegation, 2026-09-19; the gap map of the same day is the ground).
- operator_checkpoint: DEFERRED to the end-of-build test phase (BUILD-FIRST, 2026-09-19).
- ci_green: RESOLVED — green, 2026-09-19: typecheck (both tsconfigs), **1063 unit tests**
  (+35), build, `check:boundaries` 8/8 clean. Subagent-implemented, independently verified.
- pr_open / closure: RESOLVED — PR #74 (`https://github.com/eneskaradeniz/docket/pull/74`),
  head `a193614`, merged `64d8c35`; closed at this commit.
- Behavior change (flagged in the PR): a WO closing without a recorded, fully-resolvable
  verifier report no longer derives stage `closed` — the honest face of the unknown arm. The
  deferred tour should close a WO through the full step+verify flow.

## Stop-and-ask gates

- An `unknown` satisfying a gate, or rendering in an error tone (ADR-0010's two sentences).
- Backfilling `gate_verifier_resolvable` for legacy rows (no backfill by design).
- A schema change for the CI unknown (the ci_blob JSON carries it — stop if "needed").
- Recorded-sha resolution sneaking in (the v1 cut is deliberate; it needs its own probe).

## Notes

- Chain position: console (WO-0068) → **M3's tail (this)** → M3.5 (lint + prompt overrides) →
  M4 machinery → M5 overview.
- The v1 resolution cut, stated plainly: today's reports are written minutes before recording;
  the working tree IS the recorded state at that moment. Sha-level resolution becomes
  meaningful the day reports gain a sha stamp — the unknown arm keeps the door shaped right.
