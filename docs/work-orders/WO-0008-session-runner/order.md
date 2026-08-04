---
id: WO-0008
title: Session runner — Agent SDK (drive, stream, stop-and-ask fence, plan approval, cost)
workspace: docket
status: implementing # draft | planning | plan-review | implementing | review | audit | merging | closing | closed
mode: plan # plan | direct
tracks:
  - repo: app
    depends_on: []
---

# WO-0008 — Session runner — Agent SDK

## Objective

Stand up the session runner M2 rests on. A vendor-neutral **runner port** is declared in `src/core/` from
what WO-0001 actually observed; one **SDK adapter** realises it; an **async IPC bridge** carries it across
the main↔renderer boundary alongside the throwaway sync data bridge; and the work-order detail view's
**session pane goes live** — start/resume a role session, stream the transcript, answer a stop-and-ask,
approve a plan, read the cost. This replaces the provisional `SessionPane`/`Transcript` left by WO-0002/0007
("PROVISIONAL until WO-0001"). No xterm, no SQLite, no board-column rework — the runner is the load-bearing
piece; the rest of M2 bolts onto it.

## Context

Paths into the decision store; the text lives in git, not here.

- `docs/probes/cc-surface/findings.md` — M0 outcome: SDK is a contractual surface. `canUseTool` is
  observable + answerable (Q4) and the write-fence holds via a host policy (Q6/TD-001); plan-approval is
  `resume` + a mode change, turn ends on completion (Q2/Q3); cost is `result.total_cost_usd` (Q1); resume is
  cwd-scoped (Q5); `Query.interrupt()` is the controlled stop (Q7). Carries forward: "define the
  session-runner port in core from these observed facts, with one adapter; do not generalize the permission
  channel into the port's required shape."
- `docs/adr/ADR-0006-layering-and-provider-independence.md` — three-layer rule; "M2 defines the
  session-runner port in core … with one adapter"; "ui reaches the outside world only through a port defined
  in core"; line 74-75 — a vendor name appears "inside a provider adapter and its configuration" (the basis
  for the boundary-check narrowing in this WO).
- `docs/adr/ADR-0002-session-roles-and-lifetimes.md` — role write-scopes the fence enforces: architect →
  decision-store paths only; implementer → the track repo; verifier → read-only. "Role isolation must be
  enforced by configuration … not by instructions in a prompt."
- `docs/adr/ADR-0001-evidence-gated-pipeline.md` / `ADR-0007-localisation-and-theming.md` — absent-not-
  disabled; all display copy in `labels.ts`.
- `src/core/source.ts` — the existing (synchronous) port pattern this WO parallels for the async runner.
- `src/core/types.ts:56-80` — provisional `SessionRole`, `TranscriptEntry`, `SessionRef` (`stopped_asking`
  variant) this WO makes live.
- `electron/main.ts`, `electron/preload.ts` — WO-0007 shell; the sync `docket:get-source-snapshot` channel
  stays (TD-017); the runner adds a parallel async channel.
- `src/ui/components/session/{SessionPane,Transcript,StopAndAskCard}.tsx` — self-marked provisional, isolated
  for this WO to replace.
- `docs/tech-debt.md` — TD-001 (fence addendum: enforce role write-scopes in `canUseTool`), TD-016 (SDK
  version-pin 0.3.221; re-measure on bump), TD-017 (sync bridge, stays open).

## Scope

In scope:

- A vendor-neutral `SessionRunner` port in `src/core/runner.ts`, async throughout, naming product concepts
  only. Pure role write-scope fence logic + a pure event→state fold, written **test-first**.
- One SDK adapter under `src/adapters/runner/`: `query()` stream → runner events; `canUseTool` enforces the
  role write-scope fence (deny out-of-scope writes incl. `Bash` redirection without prompting; ask for
  in-scope writes); plan-mode approval via `resume` + `setPermissionMode` off `plan`; `total_cost_usd` +
  `usage` → `CostSummary` on the `result` message; `interrupt()` for a controlled stop.
- Async IPC: `ipcMain.handle` for `drive`/`decide`/`interrupt` + `webContents.send` for stream events; the
  preload exposes the runner port; `Window.docket` widened.
- A live session pane in the work-order detail view: start/resume (role + mode from the WO), stream
  transcript, stop-and-ask card wired to permission events, plan approval, cost display. Replaces the
  provisional components.
- `scripts/check-boundaries.mjs`: check 1 (vendor names) skips `src/adapters/` — aligning the mechanical
  check with ADR-0006's "provider adapter" allowance. `core`/`ui`/`renderer` and `electron/main.ts` stay
  vendor-neutral.
- Add `@anthropic-ai/claude-agent-sdk@0.3.221` (the measured version).

Out of scope:

- xterm.js terminal rendering (later M2 item); the transcript is a simple stream-fed list.
- SQLite / session-id & transcript persistence across restart — sessions are in-memory this WO (resume uses
  the SDK's on-disk transcript by id, but Docket does not yet persist the id).
- Per-work-order cost aggregation/persistence (later M2 item); this WO captures per-session cost.
- Board-column / evidence derivation from live sessions; Forge/git reconciliation (M3).
- A second provider adapter (ADR-0006: one adapter first).

## Acceptance criteria

Numbered, each checkable by someone who did not do the work.

1. `src/core/runner.ts` declares the runner port and pure helpers with **no provider concept** in core: no
   import of `@anthropic-ai/claude-agent-sdk`, no `canUseTool`/`SDKMessage`/vendor name in any `src/core/`
   file. The port names product concepts (`permission_request`, `decide`, `plan_ready`).
2. The role write-scope fence is pure logic in `core`, covered by tests: architect writes are allowed only
   under decision-store paths and denied elsewhere; implementer writes allowed in the track repo, denied
   outside; verifier writes always denied; a `Bash` write/redirection to a protected path is denied; reads
   are allowed for every role. Tests written first and pass.
3. The SDK adapter implements `SessionRunner` and is imported **only** by `electron/main.ts` (boundary check
   4 clean). It maps WO `mode` + role → SDK `permissionMode` (plan/approve/default per the plan); on plan
   completion it emits `plan_ready`; approval resumes with mode moved to `default` + an approval message.
4. The adapter's `canUseTool` holds a pending write until `decide()` resolves or the fence denies; an
   out-of-scope write is denied without a human prompt. (`interrupt()` stops a run via `Query.interrupt()`.)
5. The renderer reaches the runner only through `Window.docket.runner` realising the `SessionRunner` port;
   no Node/Electron/vendor surface leaks to the renderer (boundary checks 1/3 clean; preload exposes only the
   port).
6. `npm run check:boundaries` is clean, with check 1 exempting `src/adapters/` and still banning vendor
   names in `src/core/`, `src/ui/`, `src/renderer/` and `electron/`.
7. The session pane renders a live transcript from stream events, shows the stop-and-ask card on a
   `permission_request`, offers plan approval on `plan_ready`, and shows cost on `turn_complete`. No
   component carries display copy (all in `labels.ts`); no `disabled` control (ADR-0001).
8. `npm run typecheck` (both `tsconfig.json` and `tsconfig.electron.json`), `npm test`, `npm run build`, and
   `npm run check:boundaries` are green on the PR.

## Evidence required

What must exist before this work order can pass each gate.

- plan_approval: architect verdict (operator-covered, solo — reason recorded), `plan.md` committed
- pr_open: PR URL, head sha
- ci_green: all required checks `success` (observed, not enforced — TD-013)
- verification: verifier report (operator-covered, solo), all `path:line` pointers resolve at head sha; a
  headless drive of the adapter (or, where the CLI/auth is unavailable, a note that the adapter is verified
  by typecheck+build and the live drive is operator-pending)
- closure: all tracks merged, `ROADMAP.md` + `docs/tech-debt.md` updated (commit sha)

## Stop-and-ask gates

Points where the implementer must stop and report rather than decide alone.

- **Port shape — async, vendor-neutral, product-named.** The port is async throughout (the SDK stream is an
  async generator; `canUseTool` is a Promise). It must not bake `canUseTool` into the required shape (findings
  caution / ADR-0006): `permission_request`/`decide` are the product's human-approval need that the adapter
  satisfies via `canUseTool`. Ruling in `plan.md`.
- **Fence policy vs. canUseTool glue.** The fence *policy* (ADR-0002 role scopes) is pure `core`, test-first;
  the `canUseTool` *glue* is adapter. Out-of-scope writes (incl. `Bash` redirection) deny without prompting;
  in-scope writes ask. Ruling in `plan.md`.
- **Plan-mode approval handoff + stop-and-ask UI mapping.** Plan completion ends the turn (no blocking);
  approval is `resume` + mode to `default` (not `acceptEdits`, which would bypass the fence). The pane maps
  each event kind to a region. Ruling in `plan.md`.
- **Vendor-name boundary check.** Check 1 currently bans vendor names everywhere in `src/`. The adapter must
  import the SDK by its real package name. Ruling: exempt `src/adapters/` (ADR-0006 line 74-75). Confirmed
  with the operator; recorded in `plan.md`.

## Notes

- CI cannot drive a real session (no API key / `claude` CLI in CI), so the adapter is not exercised there;
  core logic (fence + fold) is what CI covers. The adapter is verified by typecheck+build and, where the
  environment allows, a headless drive.
- TD-016 pins the measured surface to `@anthropic-ai/claude-agent-sdk@0.3.221` / CLI 2.1.220; re-measure on
  bump before trusting the shapes.
- ADR-0012 (SDK-primary; port shaped from observations; permission channel a Claude-adapter capability) is a
  recommended lightweight companion — WO-0007 flagged it as fitting this WO.
- Solo mode (no separate architect session); gates operator-covered per ADR-0001, reasons recorded here and
  in `plan.md`.
