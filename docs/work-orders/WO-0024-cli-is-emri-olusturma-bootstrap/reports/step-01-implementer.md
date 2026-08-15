# WO-0024 step 1 — implementer report

## What changed
- **`src/cli/create.ts` (new, 170 lines, pure)** — argv→input mappers, no Node/store/branding:
  - `parseCreateWorkspaceArgs` → `CreateWorkspaceInput` (`--label`, repeatable `--repo`, optional `--decision-store`)
  - `parseCreateWorkOrderArgs` → `CreateWorkOrderDraft` (plain strings; `--workspace`, `--title`, optional `--description`, repeatable dedup `--track`, `--review-mode` default `gates`, invalid → error naming both values; fills `description: ''` / `contextFiles: []`)
  - `resolveTracks(repos, decisionStore, requested)` — mirrors `WoCreateModal`: multi-repo excludes the decision store, single-repo keeps its repo, default = all code tracks
  - `repoSlugOf` (adapter `repoBase` mirrored — adapters are unimportable here), shared tokenizer that skips the global `--db` pair and the command token, rejects unknown flags / valueless flags / stray positionals
- **`src/cli/index.ts`** — `create-workspace` / `create-work-order` handlers (usage errors → rc 2; data errors → rc 1); `--workspace` resolved id-first-then-label over `store.getWorkspaces()`; `rid()` branding here (composition root); db-existence guard exempts `create-workspace` (`createStore` creates+migrates fresh `--db`); help updated + `help` command added; unknown command → help on **stderr, rc 2** (was 0)
- **`src/cli/__tests__/create.test.ts` (new)** — 34 pure tests: happy paths, defaults, every error branch; no IPC/DB
- **Docs** — `ROADMAP.md` WO-0024 entry extended (bootstrap landed); `docs/tech-debt.md` TD-032 **narrowed**

## Verification (all green)
- `npm run typecheck` (both tsconfigs) · `npm test` **377 passed** (+34) · `npm run build` · `npm run check:boundaries` clean
- Sandbox (fresh `--db`, scratch repo, cleaned up after): fresh-db `create-workspace` → rc 0; WO-0001/0002 created, `order.md` under the decision store's `docs/work-orders/WO-NNNN-<slug>/` with correct front-matter; multi-repo workspace: default tracks exclude the decision store, requesting it refused, order.md landed in the decision-store repo; error matrix all rc as designed (`--review-mode always`→2, unknown workspace→1, unknown track→1, typo flag→2, stray positional→2, unknown command→2, missing-db `ls` guard intact→2)

## Concerns for the verifier
- **Pre-existing store bug exposed (not introduced):** two workspaces in one db with *separate* decision stores collide on `work_order.id` — `nextWorkOrderNumber` scans the decision store's own folder but the PK is db-global (`src/adapters/store/index.ts:647,566`). Fails safely rc 1, but `writeOrderMd` precedes the insert → an orphan `order.md` stays in the decision store. Out of scope here (store layer); recommend a TD entry at closure.
- **Plan deviations (all flagged, none structural):** (1) TD-032 narrowed not closed — it also bundles interactive `--policy ask`, untouched here; (2) `--repo` made repeatable (plan showed single — strict superset, makes `--decision-store` meaningful); (3) mapper rejects `--decision-store` ∉ repos — prevents the store's silent cwd fallback; (4) `--db` skipped inside the mappers' tokenizer rather than sliced in `index.ts` (keeps mappers self-contained + purely testable); (5) unknown-flag/stray-positional guards added (typo safety).
- Sandbox note: the fence blocked `/tmp` writes and `rm -rf` compounds — sandbox ran inside the repo and was removed after; worth knowing for the verifier's own sandbox run.
- Changes are **uncommitted** in the working tree (branch/PR is the orchestrator's call after your verification); exact files: `src/cli/create.ts`, `src/cli/__tests__/create.test.ts`, `src/cli/index.ts`, `ROADMAP.md`, `docs/tech-debt.md` + the pre-existing untracked WO doc dir.