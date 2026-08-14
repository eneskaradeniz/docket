---
id: WO-0014
title: Workspace + repo-connection management (create / edit / remove)
workspace: docket
status: draft # draft | planning | plan-review | implementing | review | audit | merging | closing | closed
mode: direct # plan | direct
review: light # light | full
tracks:
  - repo: app
    depends_on: []
---

# WO-0014 — Workspace + repo-connection management

## İçindekiler

- [Objective](#objective)
- [Context](#context)
- [Decisions](#decisions)
- [Scope](#scope)
- [Acceptance criteria](#acceptance-criteria)
- [Evidence required](#evidence-required)
- [Notes](#notes)

## Objective

Replace the hardcoded fixture workspaces with real, operator-managed workspaces: **create / edit /
remove** workspaces, **add / remove repo connections** (local path; GitHub remote best-effort from
`git remote`), and **set the decision store**. The approved UI is in `design-mock/index.html`
(`wsSettingsModal` / `wsListModal` / `wsMenu` with per-row gear + "Çalışma alanı ekle").

## Context

- `src/core/types.ts` — `Workspace { id, label, repos, decisionStore }` (unchanged).
- `src/core/source.ts` — `WorkOrderSource` (read-only today; needs write methods).
- `src/adapters/store/schema.ts` — `workspace` (observed), `workspace_repo` (observed), `connection`
  (owned: `local_path` + `repo_remote`; currently unused — this WO first populates it).
- `docs/adr/ADR-0009-…` — connection-vs-definition ruling (this WO adds an M2 addendum — see Decisions).
- `design-mock/index.html` — the approved ws-management UI; `src/ui/chrome/AppSettingsModal.tsx` — modal
  shell to mirror.

## Decisions

- **ADR-0009 M2 addendum (the load-bearing call).** Strict ADR-0009 says the UI operates on
  *connections* only; the *definition* is git-owned (yaml). That needs M3's git scanner to be usable.
  This WO takes the **pragmatic M2 path**: the UI creates/edits the definition directly (observed
  `workspace`/`workspace_repo`) **and** the connection (owned `connection`). An addendum records it:
  when M3's git scanner lands, definitions are re-observed from `workspace.yaml`; owned connection rows
  persist. Seed-from-fixtures coexists until the operator creates real workspaces.
- **Folder picker** via native `dialog.showOpenDialog` (main-only IPC `pick-folder`).
- **GitHub remote** best-effort on connect (`git -C <path> remote get-url origin`, adapter-side); on
  failure left empty (M3 forge fills). No separate GitHub field (path is the only input).
- **MRU** in UI state (persistence deferred).

## Scope

In scope: the six port methods + store impl (observed definition + owned connection writes) + tests;
main IPC + `pick-folder` + preload; UI (WorkspaceSwitcher gear/Ekle/Tümünü gör, WsSettingsModal
create/edit, WsListModal, App.refreshWorkspaces); labels keys; ADR-0009 addendum.

Out of scope: deep `.github/` workflow parsing, yaml authoring, forge reconciliation (M3); work-order
creation (WO-0015); en/tr toggle (M3.5).

## Acceptance criteria

1. create/edit/remove workspace + add/remove repo + set decision store, persisted in the store (observed
   definition + owned connection); survives reopen.
2. A `connection` row survives `reseedObserved()` (ADR-0010 contract — covered by a test).
3. The folder picker opens the native dialog; the repo row shows path validity + derived name; the
   decision-store select lists the workspace's repos (+ "aynı reponun docs/" empty option).
4. After any CRUD, the workspace list + board re-scope without a restart.
5. `npm run typecheck` (both), `npm test`, `npm run build`, `npm run check:boundaries` green.

## Evidence required

- plan_approval: n/a (`mode: direct`, `review: light` — solo; gates operator-covered)
- pr_open / ci_green / verification: store CRUD tests; run-verify the create/edit/remove flow (operator-
  pending); boundaries clean.

## Notes

- Branded construction (`wid`/`rid`) only in `src/adapters/`; `child_process`/`dialog` only in the
  store adapter + `electron/main.ts`; no `disabled`/`.replace(`/vendor in `src/ui/`.
