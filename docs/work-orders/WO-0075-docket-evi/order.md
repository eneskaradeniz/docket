---
id: WO-0075
title: "The app home is ~/.docket — one path, every platform, one rename-migration"
workspace: docket
status: closed
mode: direct
review: light
review_mode: gates
tracks:
  - repo: app
    depends_on: []
---

# WO-0075 — the app home is `~/.docket`

## Objective

Operator question (2026-09-20): "Claude Code nasıl projede kendi dosyalarını tutmuyor, bizde de
tutmayalım — `~/.docket` gibi bir yerde olmaz mı?" The discussion SPLIT the question in two, and
each half got its own answer:

- **The decision store STAYS in the repo** — it is project knowledge (the CLAUDE.md half of the
  Claude model, not the ~/.claude half): git-versioned, greppable, PR-reviewable, multi-repo,
  and the evidence chain (closure sha = store HEAD) stands on it. Moving it would reverse
  ADR-0010. The runtime/personal state, though, was ALREADY out-of-repo — it just lived in the
  Electron-userData location, which is a GUI-app convention, not a developer-tool one.
- **This WO moves the runtime state to `~/.docket/`** — the dotdir convention of this tool's own
  peers (git, ssh, gh, claude): one path, every platform, findable by hand, backupable as a folder.

## The fix

- `src/adapters/store/db-path.ts` (NEW, pure): `resolveDbPath(env, home, platform, io)` — the
  `DOCKET_DB_PATH` override wins verbatim (no migration logic on an explicit path — the E2E
  driver's seam); otherwise `~/.docket/docket.db`; a pre-WO-0075 legacy db (the per-platform
  Electron-userData location) is MKDIR + RENAMED into place exactly once — never copied (two live
  dbs is a split-brain); every other shape touches nothing; an un-migratable legacy is FAIL-SAFE
  (the legacy file stays the truth).
- `electron/main.ts`: the store line becomes `resolveDbPath(process.env, homedir(), process.platform)`
  — the composition root is the resolver's only production caller (WO-0073's CLI removal made
  that literally true).
- CLAUDE.md "Where things live": the app-home line, with the principle attached (machine-local
  cache, never project truth).

## Acceptance criteria

1. The resolver is pinned: override, fresh machine, rename-once, new-wins, fail-safe, the four
   platform legacy shapes (+6 tests).
2. E2E is untouched by construction: the harness always passes `DOCKET_DB_PATH`, and an explicit
   path never migrates.
3. Full ladder green.

## Evidence required

- plan_approval: mode `direct` — the operator proposed the direction ("~/.claude gibi"),
  the discussion settled the split (store in repo, runtime state to ~/.docket), approved
  2026-09-20 ("önerinle sırayla gidelim").
- operator_checkpoint: DEFERRED (BUILD-FIRST) — and the visible moment is the operator's next
  `npm run dev`: their real db renames into ~/.docket losslessly on first launch.
- ci_green: RESOLVED — green, 2026-09-20: typecheck (both tsconfigs), **1062 unit tests** (+6
  resolver), build, `check:boundaries`.
- pr_open / closure: RESOLVED — PR #80 (`https://github.com/eneskaradeniz/docket/pull/80`),
  head `98beae9`, merged `ea9b9c7` (operator merge order); closed at this commit.

## Stop-and-ask gates

- Copying instead of renaming (a second live db).
- Migrating when the new path already exists (a manual setup wins).
- Any migration logic on an explicit DOCKET_DB_PATH.

## Notes

- window-state.json stays in the Electron userData — it is Electron's own chrome, not Docket state.
- Issue/milestone tracking: decided separately (link-and-observe; a probe WO first). Not here.
