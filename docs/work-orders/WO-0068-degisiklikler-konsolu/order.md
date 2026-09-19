---
id: WO-0068
title: "Değişiklikler konsolu — the work-order Changes surface: repo-jailed status/diff with one-click commit / PR / merge (ADR-0018)"
workspace: docket
status: closed
mode: plan
review: light
review_mode: gates
tracks:
  - repo: app
    depends_on: []
---

# WO-0068 — Değişiklikler konsolu (ADR-0018)

## Objective

The M3 console line: the diff-peek idiom grows into a work-order **Changes** surface — per
connected repo: the current branch, the working-tree changes (porcelain list), the per-file
diff (the existing `diffPeek` grammar), and the operator's one-click commit / push / PR-create
/ merge. Every write is ADR-0018's operator act (explicit click, repo-jailed, confirming where
the consequence is destructive); the forge port stays read-only — the write ops are
adapter-extra methods only the console channels reach.

## Context

- **ADR-0018 amends ADR-0017 decision 3** on the console path only: Docket pushes/opens PRs as
  the OPERATOR'S HAND (`docket:console:*` channels), never on the agent path (the drive
  pipeline holds no reference to the write ops — structurally unreachable).
- **The jail exists:** `woRepoPaths` (store) is the diff-peek's containment (WO-0031c); the
  console reuses it — a Changes channel cannot touch a path outside the work order's repos.
- **The pieces to reuse:** `diffPeek` (main + preload + the LineDiff core type + the diff
  renderer), `unifiedDiffLines` (core/diff), the record-section grammar (DetailSections — a
  section with nothing to show is ABSENT), the confirm idiom (the delete-confirm discipline),
  `gitHealth`'s CommandRunner seam pattern for testable git spawns.
- **The repo reality:** the WO's connected repos each carry a working tree; the surface shows
  what git says (branch, porcelain), never a Docket-side claim. The console's commit message is
  the operator's typed text (the agent-authored commits are the ADR-0017 flow).
- **Observation wins:** after any console act, the next scan observes the result (a new PR
  fills the track link; the closure evidence sees the merge). The console records nothing of
  its own — wo_event gains NO console kinds (the acts are git/forge facts, not Docket
  decisions).

## Scope

In scope:

- **Core (test-first):** `ChangeSet` types — `RepoChanges { path: string; repo: string;
  branch?: string; files: { path: string; status: string }[]; ahead?: number }`; the
  `ChangesWatch` port (`changesFor(workOrderId)`, `diffFor(workOrderId, repo, file)`) — reads
  only; the write ops are NOT a core port (ADR-0018 decision 4).
- **Adapter:** `src/adapters/git-console.ts` — `gitStatus(run, repoPath)` (branch + porcelain
  parse + ahead count) and `gitDiff(run, repoPath, file)` over the injected CommandRunner seam
  (the health.ts pattern); the forge adapter's extra write methods `createPr` / `mergePr`
  (GitHubForge's own, NOT on the `Forge` interface), spawn-backed with the same GhRunner seam.
- **Composition root:** the `docket:console:*` channels — `status`, `diff`, `commit` (repo +
  message, the operator's), `push` (creates the remote branch — labeled), `create-pr` (head
  branch + WO-titled — the title rule), `merge` (PR number; counted confirm in the UI); every
  channel jailed via `woRepoPaths` + realpath containment; the write channels report the
  spawn's honest result (exit + stderr line), never a silent success.
- **UI:** the WO detail's **Değişiklikler** record section (DetailSections push; ABSENT when
  no connected repo has changes AND no branch info — an empty surface stays one line) — per
  repo one card: branch row, file rows (the irow grammar, click → the diff expansion, the
  repbody idiom), and the action row: Commit (message field — the form-errors-under-field
  grammar), Push, PR aç, Birleştir (counted confirm). Labels in both bundles.
- **Tests:** adapter pins (status parse: branch/ahead/porcelain classes; diff; createPr/mergePr
  arg shapes + degraded paths); core shape pins; the jail is a composition-root concern —
  verified by running (the house rule).

Out of scope:

- Staged/hunk-level commit selection (v1 commits the repo's changes as one — the operator's
  message); interactive rebase/conflict resolution (a failed git act surfaces its stderr —
  Docket does not resolve conflicts); worktree switching.
- Agent-path changes of ANY kind (WO-0067's machinery is frozen); closure-gate changes; track
  link writes (the scan owns those).
- The workspace-level console (this WO is work-order-scoped).

## Acceptance criteria

1. `gitStatus`/`gitDiff` are seam-pinned (branch/ahead/porcelain classes, the diff passthrough,
   degraded paths); `createPr`/`mergePr` arg shapes are pinned including the honest-failure
   path (exit≠0 → the carried line).
2. The `Forge` INTERFACE has no write method (a compile-level fact — the boundary check's
   vendor scan + the port's own tests); the write ops exist only as adapter-extra methods.
3. The Değişiklikler section renders per-repo cards (branch, files, diff expansion, the action
   row with confirm on merge) in both locales, key parity; absent when there is nothing.
4. Full ladder green: typecheck (both), `npm test`, `npm run build`, `check:boundaries`.

## Evidence required

- plan_approval: mode `plan` — this order IS the approved session plan (the operator's
  "tüm işleri bitir" delegation, 2026-09-19; ADR-0018 written and accepted in the same breath).
- operator_checkpoint: DEFERRED to the end-of-build test phase (BUILD-FIRST, 2026-09-19) —
  joins the deferred tour: edit a file in a WO repo, watch the section fill, commit + push +
  open the PR from the cards, merge with the confirm.
- ci_green: RESOLVED — green, 2026-09-19: typecheck (both tsconfigs), **1028 unit tests** (+29:
  4 core shape pins, 19 git-console pins, 6 forge write-op pins), build, `check:boundaries`
  8/8 clean. Subagent-implemented (the operator's delegation), independently verified: the
  port canaries, the jail on all six channels, the absent-grammar check.
- pr_open / closure: RESOLVED — PR #73 (`https://github.com/eneskaradeniz/docket/pull/73`),
  head `01d1a82`, merged `8fb16fd`; closed at this commit.
- Known edge for the deferred tour: `git diff -- <file>` shows unstaged-vs-index, so a
  staged-only change expands as «Değişiklik yok» while listing in porcelain — revisit if the
  operator hits it.

## Stop-and-ask gates

- A write method on the `Forge` INTERFACE, or a console channel reachable from the drive
  pipeline (ADR-0018 decision 4 — structural separation).
- A console write outside the `woRepoPaths` jail, or a merge without the counted confirm.
- A commit message authored by anything but the operator's input field.
- A `docket:console:*` channel that swallows a failed spawn (honest stderr or nothing).

## Notes

- Chain position: … → agent git actions (WO-0067) → **operator console (this)** → M3's tail
  (TD-008/009, pointer resolution, gate engine) → M3.5 → M4 → M5.
- The console and the agent path meet at the same truth: after EITHER acts, the scan's
  observation is the only record Docket keeps.
