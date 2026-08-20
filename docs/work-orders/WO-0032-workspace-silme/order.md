---
id: WO-0032
title: Workspace deletion — full cascade, UI + CLI
workspace: docket
status: closed
mode: plan
tracks:
  - repo: app
    depends_on: []
---

# WO-0032 — Workspace deletion (full cascade, UI + CLI)

## İçindekiler

- [Objective](#objective)
- [Context](#context)
- [Scope](#scope)
- [Acceptance criteria](#acceptance-criteria)
- [Evidence required](#evidence-required)
- [Stop-and-ask gates](#stop-and-ask-gates)
- [Notes](#notes)

## Objective

Deleting a workspace removes it with everything Docket recorded under it: every work order of the
workspace and its rows (tracks, steps, sessions, events — the `deleteWorkOrder` cascade, including
the Docket-authored `docs/work-orders/WO-NNNN-*` directories in the decision store), plus the
definition and connection rows. The deletion surfaces in the console (workspace settings modal →
confirm dialog) and the CLI (`remove-workspace --yes`). Repo code and git history are never touched.

## Context

- docs/adr/ADR-0009-workspace-connection-vs-definition.md — and this order's addendum to it (the
  "Remove = disconnect-only" ruling is superseded at workspace level, operator-approved 2026-08-20)
- docs/adr/ADR-0010-docket-observes-it-does-not-own.md — owned rows die with intent
- docs/tech-debt.md — TD-021 (non-atomic mutations), TD-035 (decision-store-scoped numbering),
  TD-036 (the deleteWorkspace port/IPC/preload already exist — untouched by this order)
- src/adapters/store/index.ts — `deleteWorkOrderRow` (WO-0020 cascade precedent) and its dormant
  dir-resolution bug, fixed here: `woDir` was resolved AFTER the `work_order` DELETE, so the
  decision-store folder was never actually removed

## Scope

In scope:

- store: `connectedDecisionStorePath` (strict, no cwd fallback) + the `deleteWorkOrder` dir fix
- store: `deleteWorkspaceRow` full cascade + running-session guard; port doc comment on
  `src/core/source.ts`
- UI: the Sil entry in the workspace settings modal (edit mode, gated), `WsDeleteDialog` confirm,
  labels
- CLI: `remove-workspace <id-or-label> [--yes]`
- tests: store regression + cascade suite; E2E delete + gate specs

Out of scope:

- transactions (TD-021 keeps the whole class)
- a running-session guard on `deleteWorkOrder` (noted asymmetry — the UI gates it via driveLive)
- M3 yaml semantics (no `workspace.yaml` exists on disk in M2)
- soft delete / archive

## Acceptance criteria

1. `deleteWorkspace` removes the `workspace`, `workspace_repo` and `connection` rows AND every work
   order of the workspace across `work_order`, `work_order_source`, `track`, `track_depends_on`,
   `work_order_step`, `session`, `wo_event`.
2. The workspace's Docket-authored `docs/work-orders/WO-NNNN-*` dirs are removed — only those: a
   shared decision store keeps the other workspaces' dirs (TD-035 shape, proven by test).
3. Repo code and git history are never touched, and no directory is ever removed under the
   `process.cwd()` fallback (deletes resolve the decision store strictly from connection rows).
4. `deleteWorkspace` throws while any session of the workspace is `running`, deleting nothing.
5. UI: the Sil entry is absent with the "önce oturumu durdur" reason while a drive is live; the
   confirm dialog carries the work-order count + the irreversible line; a failed delete keeps the
   dialog open; deleting the last workspace lands on the onboarding hero; an open detail of a
   deleted workspace returns to the board.
6. CLI `remove-workspace` resolves id-or-label, refuses without `--yes` (naming the blast radius),
   cascades with it.
7. `deleteWorkOrder` now really removes the WO dir (regression test; it has been a silent no-op
   since WO-0020).
8. CI green: typecheck (both tsconfigs), test, build, check:boundaries, test:ui.

## Evidence required

- plan_approval: architect verdict, `plan.md` committed
- pr_open: PR URL, head sha
- ci_green: all required checks `success`
- verification: verifier report, all `path:line` pointers resolve at head sha
- closure: all tracks merged, `ROADMAP.md` + `docs/tech-debt.md` updated (commit sha)

## Stop-and-ask gates

- The strict-resolver ruling: deletes never operate on the cwd fallback (a workspace without a
  matching connection row deletes DB rows only) — an architect decision, recorded in the store.
- The ADR-0009 addendum wording: superseding the "Remove from Docket" label rule at workspace level
  while the disconnect-only stance survives at repo-connection level.

## Notes

- The cascade is non-atomic, matching the `deleteWorkOrderRow` precedent; TD-021 carries the
  structural fix for the whole class. A re-run after a mid-cascade failure is idempotent.
- `deleteWorkOrder` deliberately keeps no running guard (the UI gates it; the workspace delete is
  guarded because its blast radius spans every WO at once).
- A CLI delete racing a GUI drive is refused by the store guard (safe direction; TD-031 class).
- `wo_event` rows die with their work orders — the consequence line and the ADR addendum both say
  so; the audit's contract is per-WO, so nothing dangles.

## Closure

Merged PR #39 (`526b16d`), one PR, 11 commits: the work order, the strict resolver + the
`deleteWorkOrder` dir fix, the cascade + running-session guard, the Sil flow (UI + CLI), E2E, the
docs (ADR-0009 addendum, ROADMAP, TD-021), and the operator review round — four findings fixed
in-PR: Vazgeç returns to the settings modal (the confirm now STACKS over its invoker), the stacked
z-ladder + the narrow confirm vocabulary landed as kit capability (440px for the yes/no class;
Tooltip + toasts lifted to z-80 floaters), the WO Sil dialog joined the narrow class, and the
empty-DB hero invites the workspace (the line names what the button creates). Gates: typecheck ×2,
484 tests (+4), build, boundaries, E2E 36/36 (+2, including the z-ladder and geometry regression
guards), CLI scratch-db smoke; CI green on every push.

_Closed 2026-08-21 at 526b16d_
