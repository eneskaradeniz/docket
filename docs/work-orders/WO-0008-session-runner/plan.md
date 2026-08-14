# WO-0008 — plan

## İçindekiler

- [Objective (restated)](#objective-restated)
- [Rulings — the four gates](#rulings--the-four-gates)
  - [1. Port shape — ASYNC, vendor-neutral, product-named](#1-port-shape--async-vendor-neutral-product-named)
  - [2. Fence policy (core, test-first) vs. canUseTool glue (adapter)](#2-fence-policy-core-test-first-vs-canusetool-glue-adapter)
  - [3. Plan-mode approval handoff + stop-and-ask UI mapping](#3-plan-mode-approval-handoff--stop-and-ask-ui-mapping)
  - [4. Vendor-name boundary check — EXEMPT `src/adapters/`](#4-vendor-name-boundary-check--exempt-srcadapters)
- [Design](#design)
  - [Process model](#process-model)
  - [IPC contract (async, alongside the throwaway sync channel)](#ipc-contract-async-alongside-the-throwaway-sync-channel)
  - [Mode/cost capture](#modecost-capture)
- [Task breakdown](#task-breakdown)
- [Verification (AC → how checked)](#verification-ac--how-checked)
- [Risks](#risks)
- [Tech debt to open (closure gate)](#tech-debt-to-open-closure-gate)

> Rulings on the four stop-and-ask gates, the resulting design, and the implementation path. `mode: plan`;
> solo mode — the operator covers the architect role, reasons recorded here (ADR-0001).

## Objective (restated)

Stand up the session runner M2 rests on: a vendor-neutral runner port in `src/core/` (test-first), one SDK
adapter, an async IPC bridge alongside the throwaway sync data bridge (TD-017), and a live session pane that
replaces the provisional `SessionPane`/`Transcript`. No xterm, no SQLite, no board rework.

## Rulings — the four gates

### 1. Port shape — ASYNC, vendor-neutral, product-named

The port is async throughout. This is unavoidable: `query()` yields an async generator of `SDKMessage` and
`canUseTool` returns a `Promise` the SDK awaits. A sync port (like `WorkOrderSource`) cannot carry a stream.

It names **product** concepts, never provider concepts (ADR-0006). `permission_request` / `decide` are the
human-approval *need*; `canUseTool` is the provider mechanism the adapter uses to satisfy it. Per the
findings' caution ("do not generalize the permission channel into the port's required shape"), the permission
channel is expressed as vendor-neutral product events — a presently Claude-only adapter capability — not a
per-provider callback signature baked into the required shape. A future coarse-mode provider simply never
emits `permission_request`.

Shape (in `src/core/runner.ts`):

```ts
export type RunnerEvent =
  | { kind: 'started'; sessionId: string }
  | { kind: 'assistant_text'; text: string }
  | { kind: 'tool_use'; callId: string; tool: string; input: Record<string, unknown> }
  | { kind: 'tool_result'; callId: string; summary: string; isError: boolean }
  | { kind: 'permission_request'; requestId: string; tool: string; input: Record<string, unknown>; title?: string; reason?: string }
  | { kind: 'plan_ready'; planText: string }
  | { kind: 'turn_complete'; stopReason: string; cost: CostSummary }
  | { kind: 'error'; message: string };

export type PermissionDecision = { allow: true } | { allow: false; reason: string };

export interface DriveInput {
  role: SessionRole;
  cwd: string;                 // the working repo (ADR-0002); resume must originate here (findings Q5)
  mode: 'plan' | 'direct';     // WO mode — adapter maps role+mode → SDK permissionMode (gate 3)
  prompt: string;
  resume?: string;             // session id to resume
  approve?: boolean;           // resume after plan_ready: move mode off plan + approval message
}

export interface SessionRunner {
  drive(input: DriveInput): AsyncIterable<RunnerEvent>;
  decide(requestId: string, decision: PermissionDecision): Promise<void>;
  interrupt(): Promise<void>;
}
```

### 2. Fence policy (core, test-first) vs. canUseTool glue (adapter)

The role write-scope is domain logic (ADR-0002), so the **policy** is pure and lives in `core`, tested first;
the SDK **glue** lives in the adapter. `core` exports:

```ts
export type WriteAttempt = { isWrite: boolean; targetPath?: string; command?: string };
export type FenceVerdict = 'allow' | 'deny' | 'ask';
export type WriteScope =
  | { kind: 'decision_store'; root: string }   // architect — decision-store paths only
  | { kind: 'repo'; root: string }             // implementer — the track repo
  | { kind: 'read_only' };                     // verifier — no writes

export function writeScopeFor(role: SessionRole, cwd: string): WriteScope;
export function fenceDecision(scope: WriteScope, attempt: WriteAttempt): FenceVerdict;
```

Adapter `canUseTool(toolName, input)`:
1. build a `WriteAttempt` — `Write`/`Edit`/`NotebookEdit`/`MultiEdit` → `{isWrite:true, targetPath:
   input.file_path}`; `Bash` → inspect `input.command` for redirection/write targets (`>`, `>>`, tee into a
   path, `cp`/`mv`/`mkdir`/`rm`/`touch` etc.) → `{isWrite:true, targetPath?, command}`; anything else →
   `{isWrite:false}` (a read);
2. `fenceDecision(scope, attempt)` → `deny` resolves the SDK call immediately with `{behavior:'deny',
   message}` and **no human prompt** (the fence, including the `Bash`-redirection gap from TD-001); `ask`
   emits `permission_request` and parks a resolver in `Map<requestId, resolver>` — the SDK's tool call blocks
   until `decide()` resolves it; `allow` returns `{behavior:'allow'}`.

This is the **hold**: the SDK awaits the `canUseTool` Promise, and the adapter does not resolve it until the
human answers or the fence denies (TD-001).

### 3. Plan-mode approval handoff + stop-and-ask UI mapping

**Mode mapping (adapter, role + WO mode → SDK `permissionMode`):**

| role | WO mode | first drive | on approve |
| --- | --- | --- | --- |
| implementer | `plan` | `plan` (turn ends on completion → `plan_ready`) | resume + `default` + "approved, proceed" |
| implementer | `direct` | `default` | n/a |
| architect | — | `plan` (writes the order/plan into the decision store) | as implementer |
| verifier | — | `default` (read-only fence) | n/a |

`acceptEdits` is **not** used post-approval: it auto-approves file ops and would bypass the fence + ask. The
approved plan survives resume (findings Q3). Plan completion is detected from the stream (an `ExitPlanMode`
`tool_use`, or — as in the probe run where that tool was absent — the final assistant text in a `plan`-mode
turn) and surfaced as `plan_ready`; the turn has already ended, so approval is a separate `drive({resume,
approve:true})`.

**UI mapping (live session pane):** a pure core fold derives pane state from events so the logic has no
browser/agent dependency:

```ts
export type LiveSessionStatus = 'idle' | 'running' | 'stopped_asking' | 'plan_ready' | 'done' | 'error';
export interface LiveSessionState {
  status: LiveSessionStatus;
  sessionId?: string;
  entries: TranscriptEntry[];     // appended from assistant_text / tool_use / tool_result
  pendingAsk?: { requestId: string; tool: string; reason?: string };
  pendingPlan?: string;
  cost: CostSummary;
}
export function foldSessionEvent(state: LiveSessionState, event: RunnerEvent): LiveSessionState;
export const initialSessionState: LiveSessionState;
```

`permission_request` → `stopped_asking` + `pendingAsk` → `StopAndAskCard` (Allow/Deny → `decide`);
`plan_ready` → `plan_ready` + `pendingPlan` → Approve → `drive({resume, approve:true})`;
`turn_complete.cost` → `CostSummary` (`formatUsd`); `started.sessionId` → captured for resume.

### 4. Vendor-name boundary check — EXEMPT `src/adapters/`

Check 1 bans vendor names everywhere under `src/` + `electron/`. The adapter must `import … from
'@anthropic-ai/claude-agent-sdk'`. Ruling (confirmed with the operator): check 1 skips `src/adapters/`,
mirroring the existing adapter exemptions in checks 2a and 4, and aligning the mechanical check with ADR-0006
line 74-75 ("a vendor name appears … inside a provider adapter and its configuration"). The adapter directory
keeps a vendor-neutral name (`src/adapters/runner/`); `electron/main.ts` imports it by a neutral factory name
(`createRunner`), so main stays clean. `core`/`ui`/`renderer` remain vendor-neutral.

## Design

### Process model

```
src/core/runner.ts           port + pure fence/fold (test-first). No provider concept.
src/adapters/runner/         SDK adapter: query()→events, canUseTool fence glue, resume+mode, cost, interrupt.
                            Vendor-name-exempt (gate 4). Imported only by main.
electron/main.ts            wires createRunner(); ipcMain.handle drive/decide/interrupt; webContents.send events.
electron/preload.ts         exposes window.docket.runner realising SessionRunner (async over IPC).
src/renderer/preload.d.ts   widens Window.docket = { source; runner }.
src/ui/.../session/         live SessionPane/Transcript/StopAndAskCard over LiveSessionState.
```

### IPC contract (async, alongside the throwaway sync channel)

- `docket:get-source-snapshot` (sendSync) — unchanged (TD-017).
- `docket:runner:drive` (invoke) → starts/resumes; main iterates the adapter stream and forwards each event
  with `webContents.send('docket:runner:event', event)`; resolves on `turn_complete`/`error`.
- `docket:runner:decide` (invoke) → `{requestId, decision}` → `runner.decide()`.
- `docket:runner:interrupt` (invoke) → `runner.interrupt()`.
- Preload realises `SessionRunner`: `drive()` returns an `AsyncIterable` backed by an `ipcRenderer.on(
  'docket:runner:event')` listener that fills a queue and completes on `turn_complete`/`error`; `decide`/
  `interrupt` are `invoke` wrappers. **To verify:** contextBridge proxying an async-iterator return. Fallback
  (in the same WO if needed): preload exposes `drive(input, onEvent)` and a renderer-side wrapper folds it
  into `SessionRunner`.

### Mode/cost capture

Cost is read from the `result` message (`total_cost_usd`, `usage.input_tokens`, `usage.output_tokens`) →
`CostSummary` on `turn_complete`. Per-turn `assistant.message.usage` is unreliable (read 0 in the probe) — the
result message is the source of truth (findings Q1).

## Task breakdown

1. Add dep `@anthropic-ai/claude-agent-sdk@0.3.221`; confirm install.
2. `src/core/runner.ts` + `src/core/__tests__/runner.test.ts` (tests first): fence per role incl. Bash
   redirection + reads; `foldSessionEvent` status transitions, pending ask, cost, plan_ready.
3. `scripts/check-boundaries.mjs`: check 1 skips `src/adapters/` (comment citing ADR-0006 74-75); confirm
   `npm run check:boundaries` clean before the adapter lands.
4. `src/adapters/runner/`: the SDK adapter (gate 2 + gate 3 mapping + cost + interrupt).
5. `electron/main.ts` + `electron/preload.ts` + `src/renderer/preload.d.ts`: the async bridge.
6. `src/ui/`: live session pane + `StopAndAskCard` wiring + plan approval + cost; new copy in `labels.ts`;
   provisional badges removed.
7. Verify: `npm run typecheck` (both), `npm test`, `npm run build`, `npm run check:boundaries`; headless
   adapter drive where the CLI/auth allow; else mark e2e operator-pending.
8. PR; stop for the operator to merge.

## Verification (AC → how checked)

- **AC1:** grep `src/core/` for the SDK specifier / `canUseTool`/`SDKMessage`/vendor names — none.
- **AC2:** `runner.test.ts` — fence matrix + fold behaviours green (written first).
- **AC3/AC4:** read the adapter; boundary check 4 clean; a headless drive (or operator-pending note) shows
  the hold + fence denial + plan approval.
- **AC5/AC6:** `npm run check:boundaries` clean (check 1 exempts `src/adapters/`; bans vendor names
  elsewhere); preload exposes only the port.
- **AC7:** run the app — transcript streams, stop-and-ask card appears, plan approval, cost shows.
- **AC8:** typecheck (both) / test / build / boundaries green on the PR.

## Risks

- **contextBridge × AsyncIterable** — verify; fall back to the callback form in-WO if it balks.
- **SDK runtime needs `claude` CLI + auth** — adapter verified locally/headless, not in CI.
- **SDK version pin (TD-016)** — pin 0.3.221; re-measure on bump.
- **Fence completeness (TD-001)** — `Bash` redirection must be caught; covered by tests.
- **Plan-completion detection** — `ExitPlanMode` was absent in the probe run; detect defensively (tool_use OR
  final assistant text in a `plan` turn).
- **Fixture session data** — `SessionRef`/`TranscriptEntry` in the six fixtures becomes historical once the
  pane is live; full live↔fixture unification deferred to avoid churning fixtures + `derive`.

## Tech debt to open (closure gate)

- **TD-019** — In-memory session state: session ids/transcripts are not persisted across restart (resume uses
  the SDK's on-disk transcript by id, but Docket does not store the id). Addressed by the SQLite WO.
- **TD-020** — Minimal non-xterm transcript: the live pane renders a simple list, not a terminal emulator.
  Addressed by the xterm M2 item.
- TD-016 (version pin) cited, not closed. TD-017 (sync bridge) stays open — `WorkOrderSource` is sync until
  SQLite; the runner adds a parallel async channel.
