Scratch removed — the tree is back to exactly the implementer's files.

## Review summary

**Claims independently verified — all reproduce:**

1. **`src/cli/create.ts`** — exists, pure as claimed: single type-only import from `core/source`, no Node builtins, no adapters, no branding. `repoSlugOf` is byte-for-byte the adapter's `repoBase` mirror (store/index.ts:351) — duplication forced by the layer rule, acknowledged in the comment.
2. **`src/cli/index.ts`** — both handlers follow the existing pattern; `rid()` branding stays in the composition root; db-guard exempts only `create-workspace` (index.ts:279); unknown command → help on stderr, rc 2 (was 0 — an improvement WO item 3 asked for); `help` command added.
3. **Tests** — I counted 34 `it` blocks in `create.test.ts`; suite went 343 → 377, exactly the claimed +34. No IPC/DB anywhere in the file.
4. **All four gates rerun green** — typecheck (both tsconfigs), 377 tests, build, `check:boundaries` clean.
5. **Sandbox rerun independently** — fresh `--db` `create-workspace` rc 0 (multi-repo + decision store); `create-work-order` rc 0 with default tracks correctly excluding the decision store (`repo1` tracked, `repo2` store); `order.md` landed in the store repo with correct front-matter; full error matrix: unknown workspace→1, decision-store-as-track→1 (error names why), invalid review-mode→2, typo flag→2, unknown command→2, missing-db `ls`→2.
6. **Docs** — ROADMAP extended and TD-032 correctly *narrowed* not closed (`--policy ask` warning still live at index.ts:78, confirming the honesty).
7. **Pre-existing bug claim is real** — `nextWorkOrderNumber` scans only the workspace's own decision-store folder (decision-store.ts:49-56) while `work_order.id` is a db-global PK → two workspaces with separate stores can collide on `WO-0001`. Genuinely pre-existing, store-layer, out of this WO's scope by the order's own KAPSAM; the recommended TD entry at closure is the right disposition.

**Deviations** — all five flagged in the report and all defensible; none structural. Repeatable `--repo` is the one that matters and it's what makes `--decision-store` meaningful at all.

**One non-blocking note for the orchestrator:** changes are uncommitted in the working tree. That's the right stopping point for this step (branch/PR was declared the orchestrator's call), but the WO's gate evidence (`pr_open`, `ci_green`, closure commit sha) still needs the commit + PR after the verifier step.

VERDICT: proceed