---
id: WO-0074
title: "E2E rot repair — the seed re-learns WO-0069's honest close; the specs re-anchor to it"
workspace: docket
status: closed
mode: direct
review: light
review_mode: gates
tracks:
  - repo: app
    depends_on: []
---

# WO-0074 — E2E rot repair (the WO-0073 baseline's 60 red specs)

## Objective

WO-0073 recorded the honest baseline: the E2E suite is 60/98 red on `main` itself — the price of
the build queue's eleven E2E-untested merges (WO-0062..0072). This WO repairs the rot. MEASURED
ROOT CAUSE (live probe + store-recipe diffing, not guesswork): **one primary cause + its cascade.**

- **Primary:** WO-0069 tightened `deriveStage` — a work order derives `closed` only over a
  RECORDED verifier report whose file pointers resolve (plus the close-stamped merges and docs
  sha). The E2E seed's closed fixtures ('Kapandı', 'Eski iş') predate that contract: they close
  with a bare `closeWorkOrder` call, so today they derive `implementation`. The app is HONEST;
  the seed is stale.
- **Cascade:** the first failing spec abandons the app mid-flow (on a detail, on the wrong
  workspace, in 'arşiv'), and every later spec's positional/`switchWs` navigation assumes the
  previous spec left the app where its comment says. One deterministic lie propagates: the
  failure sets were byte-identical across two full runs and across branches.
- **Genuine spec rot (WO-0069's wording):** the close card's verification chip for a WO with no
  verifier leg now speaks the UNKNOWN form (`doğrulanamadı — bakılamadı`), never the absence
  sentence (`doğrulayıcı raporu yok`) — EvidencePanel's unknown arm is WO-0069's own addition.

The app needed NO code change. Every edit is seed + spec — the WO-0073 boundary ("E2E specs are
protected") belonged to that WO; this WO IS the spec repair.

## The fix

- **seed.ts:** the repo gains `src/a.ts` (a real file for the resolvable pointer). The closed
  fixtures ('Kapandı', 'Eski iş') grow the honest verifier leg: a two-leg plan +
  `recordStepReport(…, 'verifier', 'checked `src/a.ts:1`')` + proceed verdict — the exact recipe
  the store tests pinned for WO-0069. A NEW fixture 'Tamamlanmış iş' carries the full leg +
  two sessions so the Kapat-dialog spec closes a WO whose honest derivation COMPLETES (glow,
  Kapandı, seal). The single-leg fixture ('Uygulama sürüyor') stays — it is the unknown-chip pin.
- **ui.mjs:** the DOSYA-record spec asserts the unknown chip (WO-0069's wording); the Kapat spec
  targets 'Tamamlanmış iş' and reads '2/2 adım'.

## Acceptance criteria

1. The suite's red count collapses from 60 toward 0; every remaining red is individually
   root-caused (no cascade hand-waving).
2. App code changes ONLY by stop-and-ask approval — and one did: the repair exposed a REAL bug
   (a workspace switch kept the previous workspace's detail open under the new header —
   `onSwitch={setWorkspaceId}` never cleared the open detail; the WO-0032 delete flow's own
   guard was the missing twin). Operator-approved 2026-09-20: the switch lands on the new
   workspace's board, same-workspace re-picks keep the detail.
3. Full ladder green after the repair.

## Evidence required

- plan_approval: mode `direct` — the operator approved the repair approach (2026-09-20,
  "önerinle e2e çürüme onarımına bakalım").
- operator_checkpoint: the suite's own green IS the checkpoint here (BUILD-FIRST).
- pr_open / closure: recorded in ROADMAP.md at the closing commit.

## Stop-and-ask gates

- Weakening an assertion to make it pass without a contract reason (WO-0069's derivation and
  EvidencePanel's unknown arm ARE the contract reasons here).
- Touching SessionRunner/Forge ports or adapters.
- Deleting a spec instead of re-anchoring it.

## Notes

- Diagnosis artifacts: the WO-0073 closure recorded the 60-spec inventory and the identical-set
  proof; the live probe (seeded launch + per-world dumps) pinned `raf` as healthy and the two
  closed fixtures as the broken arm.
- The failing specs' titles remain the regression inventory — they pass again, they do not
  disappear.
