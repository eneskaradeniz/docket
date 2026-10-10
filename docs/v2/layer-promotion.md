# v2 → main layer-by-layer promotion plan

Layer names, folders, and order come from `docs/v2/architecture.md` → "Layers"; this plan adds no
architecture of its own.

## Operator decision (2026-10-07)

1. v2 is promoted to `main` layer by layer. Each layer is its own PR into `main`, with its own
   acceptance criteria and the operator's signature. There is no bulk `v2 → main` merge.
2. The UI layer (Presentation) ships last, with dogfood evidence — the ladder A → B → C below.
3. From the UI promotion on, Docket is developed in Docket: low-risk work first (A), then one
   real work order per day (B), then Docket's own issues (C). The claude-hybrid pipeline stays
   the safety net for the whole ramp. The operator performs every merge into `main`.

## Preconditions

- `main` is the only integration branch and v1 code is already removed from the tree;
  `npm run typecheck && npm test && npm run build && npm run check:boundaries` is
  green on the head being sliced. That head is tagged once (e.g. `v2-promote-0`) so every slice
  stays re-derivable. A fix found during promotion lands on `main` as its own issue and rides
  with the next promotion PR.
- #802, #803, and #804 are closed on `v2` before the head to be sliced is tagged — no slice is
  cut from a head that still carries any of them (#802 changes `src/domain/providers/fold-run.ts`,
  so inner layers are affected too, not only the UI).
- Shared non-layer files (`package.json`, `scripts/`, `e2e/`, `docs/v2/`, tooling config) ride
  with the earliest promotion PR that needs them and are refreshed by every later one. Earlier
  batch `v2 → main` merges only shrink a slice; they never reorder the plan.

## Promotion order and acceptance

Dependencies point inward, so each PR merges into a `main` that already holds everything its
layer imports. Promotions run strictly in order — one open promotion PR at a time, titled
`promote(<layer>): …`. Until step 6, `main` keeps running v1 beside the arriving v2 layers (the
CI-green state the `v2` branch was in during Phases 1–4); step 6 deletes v1 from `main`. Every
layer additionally requires the four CI commands green on the PR and on `main` after the merge.

| # | Layer | Paths | Acceptance beyond CI (measurable) | Sign-off | Rollback |
| - | ----- | ----- | ---------------------------------- | -------- | -------- |
| 1 | Domain | `src/domain/` | every R-rule has a passing test named `R-n: …`; `check:boundaries` clean (no npm/Node-builtin/`Date`/`Math.random` use) | Operator: ____ | revert the promotion commit; nothing on `main` imports domain yet |
| 2 | Application | `src/application/` | headless work order runs end to end in `npm test` (Phase 2 done-when) | Operator: ____ | revert; re-promote after step 1 |
| 3 | API boundary | `src/api/` | commands/queries/events contracts are plain JSON types; layer check shows no infrastructure/presentation import | Operator: ____ | revert; presentation is not on `main` yet |
| 4 | Infrastructure | `src/infrastructure/` | recorded provider evidence stays valid — Claude, Codex, and one ACP agent ran the same work order (Phase 3 done-when); no new live run required at promotion time | Operator: ____ | revert; no promoted layer consumes the ports yet |
| 5 | Presentation (UI — last) | `src/presentation/` | dogfood rungs A and B complete (below); `npm run test:ui:report` clean on the PR head: layout audit 0 FAIL, no page/console errors, `report.json` `run.commit` = PR head; permitted FAILs: the J-1 allowlist only | Operator: ____ | revert; `main` still runs the v1 UI until step 6 |
| 6 | Composition root | `electron/` (`main.ts`, `preload.ts`) + deletion of v1 (`src/core/`, `src/adapters/`, `src/ui/`, `src/renderer/`) | "first real run" on a build of promoted `main`: GLM only, `~/.docket-test`, throw-away repo — project added, work order opened, run executed, diff seen, merged; operator scenario signed | Operator: ____ | revert restores v1 and forfeits the v2 app — the one expensive rollback; needs a fresh operator decision |

## Dogfood ladder (gates steps 5–6)

Live runs in the ladder use the GLM route only, against `~/.docket-test` or a throw-away repo
(operator gate, CLAUDE.md). No rung is skipped; a failed rung is re-run. Rungs A and B gate
step 5; rung C starts after step 6 and confirms it.

| Rung | What runs | Exit criterion (measurable) | Evidence |
| ---- | --------- | ---------------------------- | -------- |
| A — low risk | small, low-risk work orders in Docket | 3 consecutive work orders complete with truthful records, no claude-hybrid fallback; the operator fixes 3 | work-order and run records under `~/.docket-test`, walked in the Docket UI |
| B — one real work order per day | the operator's daily work in Docket | a Docket work order's diff reviewed and merged by the operator, on 5 consecutive workdays | the merged PRs, listed in the sign-off record |
| C — Docket's own issues | this repo's issues run through Docket | the first issue of this repo implemented, PR'd, and merged via a Docket run | the PR authored by that run |

## Known blockers

| Issue | What it breaks | Blocks acceptance of | Unblocked when |
| ----- | -------------- | -------------------- | -------------- |
| #802 — a run with zero tokens must not end `succeeded` | run records can claim success with no agent work, so live-run evidence can lie | dogfood rungs B and C; steps 5 and 6 (every acceptance that reads a live run outcome). The tagging precondition holds every layer — #802 touches `src/domain/providers/fold-run.ts`, so inner slices wait for the fix too; their command suites stay green meanwhile | fix on `v2`; an empty run ends `failed`/`error`; red-first regression test |
| #803 — a human gate cannot be decided before the stage has run; `ready` hides "Start stage" (`Aşamayı başlat`) | invariant 1 — a human owns every irreversible step — is not enforceable in the work-order UI | step 5; dogfood rung B | fix on `v2`; in `ready` the gate cannot be decided and the start control is present (a11y + interaction evidence on the fix PR) |
| #804 — zai-glm runs fail with "issue with the selected model" | no GLM live run is possible, so no live evidence can be produced at all | dogfood rungs B and C; step 6 (first real run); any promotion-day live re-verification. Step 4's acceptance still uses recorded evidence, but its slice waits with the others under the tagging precondition | fix on `v2`; one GLM run completes with usage > 0 tokens in `~/.docket-test` |

## Sign-off record

One row per promotion, filled at merge time. Evidence entries are paths only (CI run,
`e2e/.out/report.json`, run-record ids); a UI report's `run.commit` must equal the promotion
PR's head commit. The operator's signature is the approval line on the promotion PR, copied
into this record.

| Layer | Date | Promotion PR | Merge commit on `main` | Evidence | Operator |
| ----- | ---- | ------------ | ----------------------- | -------- | -------- |
| 1 Domain | YYYY-MM-DD | #— | — | CI run; test list | name — approved |
| 2 Application | | | | CI run; headless scenario id | |
| 3 API boundary | | | | CI run | |
| 4 Infrastructure | | | | CI run; recorded probe evidence | |
| 5 Presentation | | | | report.json; ladder A/B records | |
| 6 Composition root | | | | first-real-run records; scenario verdict | |
