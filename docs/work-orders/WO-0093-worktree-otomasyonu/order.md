---
id: WO-0093
title: "Worktree automation — Başlat prepares the working copy; the operator runs nothing"
workspace: docket
status: open
mode: direct # plan | direct
review: full # light | full
review_mode: gates
tracks:
  - repo: app
    depends_on: ["WO-0088", "WO-0092"]
---

# WO-0093 — worktree automation

## Objective

The wave's last manual act is the working copy: today the operator runs `setup.sh`, opens
`wt/issue-N` worktrees by hand, and pastes the path into the WO's `cwd:` field. This WO
removes the act: **starting a work order prepares its working copy automatically** — a git
worktree branched from the repo's main, living under Docket's app home, removed when the
order is deleted (or closed clean). The operator's full wave becomes: see the issues →
spawn → Başlat. The operator ruling 2026-09-22 ("setup.sh olmasın, repoyu kirletmesin")
AMENDS WO-0088's frozen decision ("worktrees stay the operator's act") — the worktree
becomes the operator's CLICK's act, the ADR-0018 grammar: it fires only from the operator's
own start/delete/close actions, never from the drive pipeline, never on a timer.

## Frozen decisions (2026-09-22, operator)

- **Location: under the app home** — `~/.docket/worktrees/<workspaceId>/<wo-NNNN>-<slug>`
  (`DOCKET_DB_PATH`'s directory is the anchor, not `process.cwd()`; the WO-0075 home rule).
  The user's source tree gains nothing; the connected repo gains nothing but git's own
  internal `.git/worktrees` bookkeeping (removable via `git worktree remove`, never a file
  in the working tree).
- **The connected repo's working tree stays untouched** — spawn never checks out, never
  writes a path under the connected repo (a porcelain-clean assertion pins it).
- **cwd precedence** (extends the WO-0088 contract, unchanged for existing orders):
  explicit `cwd:` front-matter > worktree (when enabled) > the connected repo root.
- **Branch from main**: the worktree branches from the connected repo's main at START time
  (fresh main, the wave discipline). The branch name is the ADR-0017 convention
  `wo-NNNN-<slug>` — spawned WITH the worktree (one `git worktree add -b` call), so the
  agent inherits a ready branch and only commits/pushes (push stays the witnessed risky
  act; ADR-0017's world-write surface unchanged). Note the small shift for the closure
  record: the branch is created by Docket's start click, not the agent's first commit —
  the name rule and the witnessed path are untouched.
- **The worktree is disposable state, never the record** — it is not stored in order.md
  (no machine-local paths in committed documents beyond the operator-authored `cwd:`);
  the path is DERIVED from the convention, an observed fact at view time.

## The surface

- The create/edit dialog grows a working-copy choice (the ADR-0012 form grammar, labels
  via the bundles): **Ayrı çalışma kopyası (worktree)** — default ON for new orders in a
  workspace whose repo is connected; the `cwd:` field stays as the operator override and
  says so when both are set (the override wins, honest precedence line).
- Starting a worktree-enabled order: main prepares the worktree BEFORE the runner spawns
  (inside the start click); a prep failure (git absent, base missing, path collision) is a
  refusal card with the reason — never a half-prepared spawn. Already-prepared (resume
  legs) is a no-op, never a re-add.
- The detail's meta shows the derived working-copy path (mono, the ledger idiom); the work
  order card/detail carry nothing new when the order is not worktree-enabled.
- **Removal**: on WO delete (the existing cascade — the confirm counts the working copy
  among what dies), and on CLOSE when the working tree is clean (`git status --porcelain`
  empty → remove; dirty → kept with a reason line, the operator decides). Removal failures
  degrade honest (kept + reason), never block the delete/close.

## Open design questions (settled in implementation, pinned by tests)

- The enablement carrier in order.md front-matter (a `checkout:` key riding the
  `cwd:`/`task:` set/drop idiom) vs a store column — lean front-matter, the WO-0092
  precedent (the document is the record; the path itself is never stored either way).
- The prep seam: a composition-root git-process call (the git-console seam's pattern,
  `src/adapters/git-console.ts`) vs reusing the agent — the start click must be
  synchronous and witnessed, so: Docket's hand (the seam), one `git worktree add -b`
  per start, output captured for the refusal card.
- E2E: the scripted world gains real local git ops (the seed already builds fixture
  repos with git — extend, no network); the parallel spec drives TWO worktree-enabled
  orders simultaneously (the spine's isolation, now per-checkout).

## Scope

**In**: spawn-prep + derived path + cwd precedence; the dialog choice + meta line;
removal on delete/close-clean; the refusal cards; tests (store/decision-store/pipeline)
and E2E (parallel auto-worktree spec, the porcelain-clean pin, the dirty-close keep).
**Out**: merge-time rebase of other wave branches (the queued unnumbered item);
auto-closing forge issues; the agy line (WO-0095/0096); pruning stale worktrees of OLD
orders (a future sweep if the operator asks).

## Acceptance

1. Başlat on a worktree-enabled order creates `~/.docket/worktrees/<ws>/wo-NNNN-<slug>`
   branched from main and the drive runs THERE (the transcript's cwd proves it); a second
   start (resume) never re-adds.
2. Two worktree-enabled orders start simultaneously — two isolated worktrees, two branches,
   zero collisions; the connected repo's working tree is porcelain-clean after both.
3. Delete removes the worktree (the confirm names it); close with a clean worktree removes
   it; close with a dirty one keeps it and says so.
4. An explicit `cwd:` front-matter still wins over the worktree (the WO-0088 contract
   intact, precedence pinned by a store test).
5. A prep failure (git missing, base missing) refuses the start with the reason — no
   session row, no half state.
6. Mechanical ladder green: typecheck ×2, unit (1173 baseline), boundaries, build, E2E
   (103 baseline + the new worktree specs).

## Notes

- The wave's economics after this lands: issues → spawn → Başlat → parallel drives in
  isolated copies → PRs observed → merge in the console. setup.sh is dead; rebase-after-
  merge is the one remaining manual act (queued, unnumbered).
- The old wave's `wt/` dirs (antreo-app/wt) stay the operator's — Docket never migrates
  or touches them.
- Queue context: WO-0094 next (agent issue creation + the gh issue-create fence gap);
  WO-0095 the agy probe; WO-0096 the adapter; WO-0097 billing axes.
