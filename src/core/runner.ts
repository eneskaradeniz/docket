// src/core/runner.ts — the session-runner PORT, declared in core (ADR-0006).
//
// Pure declaration + pure helpers only: no React, no I/O, no Node, no provider
// concept. The SDK adapter (src/adapters/runner/) implements `SessionRunner`; the
// renderer reaches a runner only through this port, realised across the process
// boundary by the preload. The shapes are derived from what WO-0001 observed
// (docs/probes/cc-surface/findings.md), named as PRODUCT concepts — never provider
// concepts. `permission_request`/`decide` are the human-approval need the adapter
// satisfies via the provider's per-call callback; they are not that callback.
//
// The role write-scope fence (ADR-0002) is pure domain logic and lives here so it
// is testable without an agent (TD-001: the runner enforces role write-scopes in the
// permission callback, not in a prompt). The event→pane fold is likewise pure.
import type { AgentTaskStatus, CostSummary, LimitStop, LimitWindow, PermissionAsk, SessionRef, SessionRole, SteerNote, TrackId, TurnUsage, WorkOrderId, WorkspaceId, TranscriptLine } from './types';
import type { PermissionRule } from './source';

// --- The stream the runner yields. A vendor-neutral projection of a session.
//     The adapter translates the provider's message stream into these events. ---
export type RunnerEvent =
  | { kind: 'started'; sessionId: string; at?: string }
  // WO-0046: the content events carry the same ISO receive-stamp as the lifecycle ones — the fold
  // turns each into the staleness anchor (`lastLifeAt`); an unstamped event (a scripted fake)
  // honestly leaves the prior anchor alone.
  // WO-0055: `parentToolUseId` is the subagent nesting link (the delegation call's id) — the fold
  // threads it onto the transcript line so the döküm nests identically live and archived.
  | { kind: 'assistant_text'; text: string; parentToolUseId?: string; at?: string }
  | { kind: 'tool_use'; callId: string; tool: string; input: Record<string, unknown>; parentToolUseId?: string; at?: string }
  | { kind: 'tool_result'; callId: string; summary: string; isError: boolean; parentToolUseId?: string; at?: string }
  | { kind: 'permission_request'; requestId: string; tool: string; input: Record<string, unknown>; title?: string; reason?: string }
  // The runner emits this when decide() answers a requestId (WO-0027): with PARALLEL asks, nothing else can
  // identify which held ask was answered (tool_result carries callId, not requestId) — the old fold guessed
  // "any event clears the ask" and made sibling cards vanish while still held (Bulgu 10).
  | { kind: 'ask_resolved'; requestId: string; at?: string }
  | { kind: 'plan_ready'; planText: string }
  // 2026-08-24 (operator: "hangi saniye… onun dışında olmuş gibi duruyor"): the lifecycle events
  // carry an ISO receive-time stamp — the fold turns each into a CLOCKED transcript note, so the
  // döküm reads as a timeline in BOTH the live pane and the archived card (the fold is pure; the
  // stamp comes from the adapter's receive moment, "hangi saniye" resolution).
  | { kind: 'turn_complete'; stopReason: string; cost: CostSummary; usage?: TurnUsage; result?: string; at?: string }
  // WO-0052: ONE event per OBSERVED provider result — including the HELD intermediates of a steered
  // drive (the adapter emits it BEFORE its hold check). `delta` is the per-result difference under
  // the `applyResultCost` baseline (usd on `turn_complete` is ACCUMULATED; here it is the turn's own
  // spend — hence the different name), `usage` the optional rich detail. Never emitted for the
  // synthetic plan-exit or an interrupt close: an abort precedes the result message, nothing was
  // observed, no row (the honest no-claim, WO-0026/TD-030). The fold stores it as state, appends NO
  // transcript line (the steer_queued precedent) and NEVER touches `cost` (the pane costline is the
  // accumulated terminal event's — a per-turn cost write would double-count it).
  | { kind: 'turn_usage'; delta: CostSummary; usage?: TurnUsage; at?: string }
  // WO-0039 stabilization (2026-08-23, "Durdur must never say Oturum çöktü"): the runner emits this
  // when an INTENTIONAL interrupt closed the stream without a turn_complete. It is a terminal,
  // calm close — the fold lands in 'stopped' (Durduruldu + ▶ Sürdür), never 'error' (the fail
  // card). `cost` rides only when the runner could observe it (a scripted fake can; a real abort
  // throws before the result message that carries cost — the honest no-claim, WO-0026/TD-030).
  | { kind: 'interrupted'; cost?: CostSummary; at?: string }
  // WO-0045 operator tempo — the steer queue's lifecycle. Queued: the note entered the mirror (the ONLY
  // visible change mid-turn is the pending count — no transcript line). Delivered: the adapter observed
  // the note applied at an agent-turn boundary (command_lifecycle uuid match — probe s2: notes never echo
  // as user messages). Retracted: pulled back before delivery (best-effort by SDK contract — probe s5/s5b).
  | { kind: 'steer_queued'; noteId: string; note: string; at?: string }
  | { kind: 'steer_delivered'; noteId: string; text: string; at?: string }
  | { kind: 'steer_retracted'; noteId: string; at?: string }
  // WO-0046 live honesty — the context-window reading, sourced from the provider's live usage
  // report (probe c1: works in streaming mode, ~2-3s latency, no experimental flag). NO transcript
  // line: the fold stores it as state (the steer_queued precedent) and the pane renders percentage
  // + used/max tokens beside the costline. `cost` rides along because a live drive folds exactly
  // ONE terminal turn_complete (WO-0045/D3) — mid-drive token spend reaches the live costline
  // here, nowhere else. `at` also refreshes the staleness anchor: the adapter fires this at tool
  // events AND throttled on thinking-token bursts (probe c1 — a long-thinking model produces no
  // transcript entries for minutes while healthy; a fresh reading proves liveness).
  | { kind: 'context_usage'; usedTokens: number; maxTokens: number; percentage: number; cost?: CostSummary; at?: string }
  // WO-0053 live honesty — the provider's usage-limit windows, sourced from the provider's own
  // rate-limit surfaces (the push stream message and the session's usage control — the token
  // tour's S5 row 6). NO transcript line: the fold stores it as state (the context_usage
  // precedent) and the pane renders the warning line from it. `status` is the adapter's
  // neutralization of the provider's OWN status word (push channel only — the pull channel
  // reports windows with NO status, so its events omit it and the fold carries the prior one
  // forward; the warn line renders on 'warning' alone, never an invented 'ok'). `at` refreshes
  // the staleness anchor like context_usage: a fresh window reading is a liveness proof.
  | { kind: 'limit_windows'; windows: LimitWindow[]; status?: 'ok' | 'warning' | 'blocked'; at?: string }
  // WO-0055 live agent visibility — ONE provider agent task's lifecycle edge (probe t1: the SDK's
  // task_started / task_notification; task_id + tool_use_id === the delegation call's callId).
  // `started` carries the task's facts (callId, description, subagentType when reported);
  // `ended` carries the closing status + digest. Ambient/housekeeping tasks never reach here —
  // the adapter filters them (isAgentTask). A task may RESTART after its end under the SAME
  // taskId with a NEW callId (the parent's SendMessage re-open, t1 lines 221-226) — the fold's
  // replay guard keys on OPEN tasks, not on "ever started". State + transcript line only: no
  // status change, no cost touch (the turn_usage discipline); `at` refreshes the staleness
  // anchor (a task edge is a liveness proof — the context_usage precedent).
  | {
      kind: 'agent_task';
      phase: 'started' | 'ended';
      taskId: string;
      callId?: string; // started — the delegation call this task IS
      description?: string; // started — operator-language content (the detail-slot ruling)
      subagentType?: string; // started — provider vocabulary as DATA, never rendered (ADR-0007)
      status?: AgentTaskStatus; // ended — absent = not reported, never fabricated
      summary?: string; // ended — the provider's closing digest
      at?: string;
    }
  // `code` is the vendor-neutral classification of a provider/config failure (WO-0025 / B1) — the adapter
  // classifies the provider's raw message (the vendor vocabulary never leaves the adapter, ADR-0006) so the
  // UI can render Turkish copy instead of a raw English string.
  // WO-0047: a GATE refusal carries its facts — the month's observed spend and the cap it met. A
  // payload, not a code: the budget card needs both figures to compose its sentence, and
  // ProviderErrorCode stays a closed vendor-failure enum. Core's English message already carries
  // the numbers; the GUI composes the localized sentence from these fields.
  // WO-0053: a LIMIT stop carries its facts the same way (the payload-not-a-code precedent) —
  // the neutral ISO stamp of when the window opens, so the limit card states the clock and its
  // Sürdür appears only once the moment passes. Stamp-less limit stops carry the code alone and
  // degrade to the fail card's localized title (no fabricated time, mockup frame 04).
  | { kind: 'error'; message: string; code?: ProviderErrorCode; refusal?: BudgetRefusal; limit?: LimitStop };

/** The budget gate's refusal facts (WO-0047): what the month has cost and the cap it met. */
export interface BudgetRefusal {
  observedUsd: number;
  capUsd: number;
}

/**
 * Why a provider session could not run, vendor-neutrally. The runner adapter maps the provider's own error
 * strings/typed signals onto these; core/UI never name the vendor (c1). Unknown failures carry no code.
 */
export type ProviderErrorCode =
  | 'auth_missing' // no credentials available to the provider
  | 'auth_failed' // credentials present but rejected
  | 'timeout' // subprocess handshake/connection timed out
  | 'executable_missing' // the provider CLI binary was not found
  // WO-0053: the provider's USAGE LIMIT (the user's window — a 429-class stop), deliberately
  // NOT provider capacity (an `overloaded` 529 is overload_*: uncoded, the generic fail card —
  // the degradation title would otherwise claim a window that does not exist).
  | 'rate_limited';

// The operator's answer to a surfaced `permission_request` (the stop-and-ask).
// WO-0077: an allow MAY carry `updatedInput` — the structured ask's fold (core/askq.askDecision)
// crosses the port and reaches the runner's held permission callback as `{ behavior: 'allow',
// updatedInput }` verbatim (WO-0076 Q3's measured contract). Its ABSENCE stays the bare allow
// (the dismissed arm); the deny `reason` is the deny message.
export type PermissionDecision = { allow: true; updatedInput?: Record<string, unknown> } | { allow: false; reason: string };

// WO-0050 / D1: the drive input is a DISCRIMINATED union — a drive belongs to exactly one
// owner, a work order or a workspace. The `workOrderId?: never` / `workspaceId?: never`
// cross-guard makes both-set and neither-set object literals compile errors (the invalid
// state is unrepresentable); `isDraftDrive` is the single narrowing point (the isPlanDrive
// precedent). Every pre-WO-0050 construction site already matches WoDriveInput — only READS
// of the union change.
export interface WoDriveInput {
  role: SessionRole;
  /** The work order this session belongs to — main uses it to persist the association. */
  workOrderId: WorkOrderId;
  workspaceId?: never;
  /** The track an implementer session is scoped to, if any (ADR-0002). Nullable: track selection is a future UI refinement. */
  scope?: TrackId;
  /**
   * Working repo (ADR-0002); the provider session runs here and resume must originate here.
   * Optional: the renderer cannot know filesystem paths, so it omits this and the composition
   * root fills it — per-track paths resolve via the connection table (WO-0050's `driveCwd`,
   * retiring the M3/M4 note).
   */
  cwd?: string;
  /** WO-0051 / D9 (TD-056): the workspace's ABSOLUTE structure root, main-filled for architect
   *  drives — aligns the write fence's decision-store root with `docs_root:<wsId>` instead of
   *  the cwd-relative default. The renderer never carries a path; undefined → the adapter's
   *  `resolve(cwd, 'docs')` fallback stands. */
  decisionStoreRoot?: string;
  /** Work-order mode — the adapter maps role + mode → provider permission mode (plan/approve/default). */
  mode: 'plan' | 'direct';
  prompt: string;
  /** Session id to resume. Omit to start a fresh session. */
  resume?: string;
  /** Resume after a `plan_ready`: move the provider off plan mode + send an approval message. */
  approve?: boolean;
  /** The 1-based index of the plan step this drive runs (WO-0017). When set, the composition root fills the
   *  prompt server-side from the step's spec + writes the step's report at turn_complete. Omit for the
   *  architect plan session and free-form runs. */
  stepIndex?: number;
  /** The 1-based index of the step whose report the architect is REVIEWING (WO-0020). role:'architect' + this
   *  field = a review drive (distinct from the plan session): main fills the review prompt + captures the
   *  verdict at turn_complete. */
  reviewStepIndex?: number;
  /** The permission RULE for this drive (WO-0031c), resolved from the work order (or the Settings
   *  default) by the composition root. Omitted → the pipeline's injected policy governs (tests,
   *  scripted runners). The fence denies out-of-scope writes under every rule; this is cadence, not scope. */
  permissionRule?: PermissionRule;
  /** The provider model id for this drive (WO-0059): the GLOBAL `model` preference, resolved by the
   *  composition root at SPAWN time (the permissionRule posture — the renderer never sends it) and
   *  mapped verbatim to the provider's session options by the adapter. undefined = the provider's
   *  own default governs. Core never defaults it and never names a value (ADR-0006's WO-0052
   *  carve-out: a model id is data, not code). */
  model?: string;
  /** WHO started this drive (WO-0045). 'auto' = a host's sequencing effect (the verdict auto-advance, a
   *  pane's mount auto-drive) — the pipeline refuses these in `manual` flow mode before spawning.
   *  Absent = the operator (a click, the CLI, a test) — always allowed. */
  origin?: 'operator' | 'auto';
  /** A pending steer note being delivered AS the resume prompt (WO-0045 / D5): the pipeline folds the
   *  first queued note into the prompt and the runner emits the matching `steer_delivered` right after
   *  `started` — the note never enters the SDK queue, so it cannot double-apply. */
  deliveringNote?: { id: string; text: string };
}

/** The WO-less roadmap draft drive (WO-0050 / ADR-0016): ONE mechanism — generation from the
 *  goal note and import from the source-doc list are the same workspace-scoped architect plan
 *  session. Always `role: 'architect'` + `mode: 'plan'` → `isPlanDrive` is true unchanged (the
 *  provider plan-mode + ExitPlanMode-DENY contract applies verbatim; zero runner-adapter
 *  change). `goalNote`/`docPaths` are the operator's dialog input; the prompt is assembled
 *  server-side from them (paths, never contents).
 *
 *  WO-0051 — the source set is the operator's free composition of CHANNELS: `docPaths` stays
 *  the flat union (store-scan included ∪ external picked) because the prompt wants ONE list;
 *  the composition itself rides as COUNTS (`docSource`) and ONE opt-in flag (`freeExplore`). */
export interface DraftDriveInput {
  role: 'architect';
  workspaceId: WorkspaceId;
  workOrderId?: never;
  cwd?: string;
  mode: 'plan';
  prompt: string;
  goalNote: string;
  /** The path UNION — store-scan included + external picked, one prompt list (mockup karar 4). */
  docPaths: string[];
  /** WO-0051 / D3: the operator opted the architect into exploring the repo itself (token
   *  cost); the prompt gains exactly ONE exploration sentence iff true. Default off — the
   *  ordinary flow stays deterministic and cheap. */
  freeExplore?: boolean;
  /** WO-0051 / D2: the dialog-computed channel COUNTS (store included / external picked) —
   *  display + persistence only, never the prompt. Counts are the composition's memory; a
   *  PATH never persists (mockup karar 5: paths die with the dialog). */
  docSource?: { store: number; external: number };
  /** WO-0051 / D9 (TD-056): the workspace's ABSOLUTE structure root, main-filled — the write
   *  fence lands exactly on the workspace's docs_root. Never renderer-supplied. */
  decisionStoreRoot?: string;
  resume?: string;
  scope?: never;
  approve?: never;
  stepIndex?: never;
  reviewStepIndex?: never;
  permissionRule?: PermissionRule;
  /** WO-0059: the same global model preference as the WO arm — main-resolved at spawn time,
   *  verbatim to the adapter. Drafts are drives; one preference, both owners. */
  model?: string;
  origin?: 'operator' | 'auto';
  deliveringNote?: { id: string; text: string };
}

export type DriveInput = WoDriveInput | DraftDriveInput;

/** WO-0050 / D1: narrow the drive union to its draft arm. The `workspaceId` presence is the
 *  discriminant — `WoDriveInput.workspaceId` is `never | undefined`, so a defined value can
 *  only be the draft. Pure, like `isPlanDrive`. */
export function isDraftDrive(input: DriveInput): input is DraftDriveInput {
  return input.workspaceId !== undefined;
}

/** WO-0088: the drive's OWNER TAG — the parallel spine's ONE key. Every layer that must target
 *  exactly one live drive (main's active-drive map, the pipeline's steer/interrupt surface, the
 *  renderer's event filter and the drive-store's per-owner guard) derives the SAME string from
 *  the drive input; nothing else parses keys. One owner = one live drive (a work order or the
 *  workspace's draft), N owners in parallel. Pure, like `isDraftDrive`. */
export function driveOwnerTag(input: DriveInput): string {
  return isDraftDrive(input) ? `ws:${input.workspaceId}` : `wo:${input.workOrderId}`;
}

// --- The port. Async throughout: the provider stream is an async generator and the
//     permission callback is a Promise the provider awaits. ---
export interface SessionRunner {
  /** Open or resume a session, yielding its events until the turn completes or errors. */
  drive(input: DriveInput): AsyncIterable<RunnerEvent>;
  /** Answer a surfaced `permission_request`. Resolves the held permission callback and emits `ask_resolved`. */
  decide(requestId: string, decision: PermissionDecision): Promise<void>;
  /** The asks currently held (unanswered) by this runner — the re-attach surface (WO-0027 / Bulgu 9): a
   *  remounted pane re-seeds its cards from this, and decide() still works (the resolver is still held).
   *  Async: across IPC the answer travels a round-trip. */
  pendingAsks(): Promise<PermissionAsk[]>;
  /** Controlled stop of the current run. */
  interrupt(): Promise<void>;
  /** FORCED stop (WO-0031c, Zorla kes): the 5s-stuck escape hatch after an interrupt that did not land.
   *  Hosts with a harder mechanism use it (the GUI aborts the pipeline generator — its finally still
   *  records the terminal state); hosts without one alias interrupt. */
  abort(): Promise<void>;
  /** Queue an operator steering note into the RUNNING drive (WO-0045) — injected once at the next
   *  agent-turn boundary; never an interrupt. Optional: optional-implementers (the CLI's one-shot
   *  drive) simply never support steering. `emit:false` re-queues silently (Sürdür carry — the fold
   *  already seeded the note from the row). Resolves false when no drive is live. */
  steer?(note: string, opts?: { noteId: string; emit?: boolean }): Promise<boolean>;
  /** Pull back a queued note before delivery (WO-0045). Best-effort by SDK contract (probe s5/s5b):
   *  false means the note already left the cancel window and WILL run. */
  retractSteer?(noteId: string): Promise<boolean>;
  // ===== WO-0088 — keyed control: target exactly ONE live drive by its owner tag =====
  // The unkeyed forms above name no drive; with N owners driving they are ambiguous. The GUI's
  // transport realization (the renderer port over the preload bridge) implements these; the
  // unkeyed forms stay for single-drive realizations (the pipeline's per-drive adapter instances,
  // tests' fakes). A drive-store falls back to the unkeyed form when the keyed one is absent.
  /** Controlled stop of ONE drive (Durdur). */
  interruptDrive?(owner: string): Promise<void>;
  /** FORCED stop of ONE drive (Zorla kes). */
  abortDrive?(owner: string): Promise<void>;
  /** Queue an operator steering note into ONE running drive; resolves the minted noteId (or null). */
  steerDrive?(owner: string, note: string): Promise<string | null>;
  /** Pull back a queued note from ONE drive. */
  retractSteerDrive?(owner: string, noteId: string): Promise<boolean>;
}

/** Is this the pure architect PLAN drive — the one drive that proposes a plan and runs in the provider's plan
 *  mode? A step drive (`stepIndex`), a review drive (`reviewStepIndex`), and an approve-resume are NOT plan
 *  drives: they run in default mode. Pure (provider-agnostic) so the adapter's permission-mode resolution is
 *  testable without dragging a provider type into core (WO-0023; this is the root fix for the P1-1 review-runs-
 *  in-plan-mode corruption — the review drive is `role:'architect'` but must not be plan mode). */
export function isPlanDrive(input: DriveInput): boolean {
  return input.role === 'architect'
    && input.stepIndex === undefined
    && input.reviewStepIndex === undefined
    && !input.approve;
}

// ===== Role write-scope fence (ADR-0002 / TD-001) =====
//
// Pure policy. The adapter classifies a provider tool call into a `WriteAttempt` and
// calls `fenceDecision`; the verdict drives the provider's permission callback:
//   'allow' → proceed (reads always); 'deny' → reject with NO human prompt (the fence);
//   'ask'   → surface a `permission_request` and hold until `decide()`.
export type WriteScope =
  | { kind: 'decision_store'; root: string } // architect — decision-store paths only
  | { kind: 'repo'; root: string } // implementer — the track repo
  | { kind: 'read_only' }; // verifier — no writes

export interface WriteAttempt {
  isWrite: boolean;
  /** Absolute target path for a file write/edit, when known. */
  targetPath?: string;
  /** A shell command, when the tool is a shell (the adapter pre-classifies it as a write). */
  command?: string;
  /** True for a shell command with no recognised read verb and no redirect (e.g. `make`, `./s.sh`). Reads for
   *  known verbs stay asymmetric; an ambiguous command COULD write, so the fence asks the verifier (WO-0019). */
  ambiguous?: boolean;
}

export type FenceVerdict = 'allow' | 'deny' | 'ask';

/** Roots the adapter resolves from configuration + the session `cwd`. */
export interface ScopeRoots {
  /** Absolute path of the track repo (the implementer's working repo). */
  repoRoot: string;
  /** Absolute path of the decision store (e.g. `<repoRoot>/docs`). */
  decisionStore: string;
}

export function writeScopeFor(role: SessionRole, roots: ScopeRoots): WriteScope {
  switch (role) {
    case 'architect':
      return { kind: 'decision_store', root: roots.decisionStore };
    case 'implementer':
      return { kind: 'repo', root: roots.repoRoot };
    case 'verifier':
      return { kind: 'read_only' };
  }
}

/** `target` is under `root` (string-normalised; core imports no Node path module). */
export function isUnder(root: string, target: string): boolean {
  const r = root.replace(/\/+$/, '');
  const t = target.replace(/\/+$/, '');
  return t === r || t.startsWith(r + '/');
}

export function fenceDecision(scope: WriteScope, attempt: WriteAttempt): FenceVerdict {
  // Reads are always allowed for KNOWN read verbs — the fence is asymmetric (TD-001: reads retained). An
  // ambiguous shell command (no recognised read verb, no redirect) could still write, so for the strictly
  // read-only verifier we surface it as a question rather than silently allow (WO-0019 / TD-026). The
  // architect/implementer are trusted to write in scope, so ambiguity stays allowed for them.
  if (!attempt.isWrite) {
    if (attempt.ambiguous && scope.kind === 'read_only') return 'ask';
    return 'allow';
  }
  switch (scope.kind) {
    case 'read_only': // verifier writes nothing.
      return 'deny';
    case 'decision_store':
    case 'repo': {
      const root = scope.kind === 'decision_store' ? scope.root : scope.root;
      // A write with no resolvable target (e.g. an ambiguous shell command) is not
      // auto-allowed (unsafe) nor auto-denied (would block permitted work) — ask.
      if (attempt.targetPath === undefined) return 'ask';
      return isUnder(root, attempt.targetPath) ? 'ask' : 'deny';
    }
  }
}

// ===== Command classification (WO-0019 / TD-026) =====
//
// Pure shell-command classification — does this Bash command write, and to where? The adapter calls
// `classifyCommandLine` and resolves any redirect target against cwd (core imports no Node path module; the
// target is returned as an UNRESOLVED token). The fence is read-asymmetric; the classifier recognises KNOWN
// reads (allow), clear writes + redirects (gate), and marks unknowns `ambiguous` (the fence asks the verifier
// for those). Bash parsing is irreducibly heuristic (TD-001); this is the safest small policy. The only
// behavior change vs. pre-WO-0019 is that UNKNOWN verbs now `ask` the verifier (was: silent allow — the hole
// TD-026 fixes).

export interface ShellCommandClassification {
  isWrite: boolean;
  command: string;
  /** Unresolved redirect target token (present only for a real `>`/`>>`). The adapter resolves it against cwd. */
  redirectTarget?: string;
  /** True when no write was detected AND no read verb was recognised (e.g. `make`, `./s.sh`, `node`). */
  ambiguous?: boolean;
}

// Verbs that mutate the filesystem by default. `sed` is always here (catches `sed -i`; `sed -n` read sacrificed).
const WRITE_VERBS = new Set([
  'cp', 'mv', 'rm', 'rmdir', 'mkdir', 'touch', 'tee', 'chmod', 'chown', 'chgrp', 'dd', 'install', 'rsync',
  'sed', 'truncate', 'ln', 'unlink',
]);

// Known read-only verbs. A leading token here (with no redirect) => allow for every role.
const READ_VERBS = new Set([
  'cat', 'head', 'tail', 'less', 'more', 'od', 'hexdump', 'xxd', 'strings', 'wc', 'nl', 'cut', 'sort', 'uniq',
  'tr', 'ls', 'find', 'file', 'stat', 'du', 'df', 'tree', 'locate', 'which', 'grep', 'egrep', 'fgrep', 'rg',
  'ack', 'ag', 'echo', 'printf', 'test', 'pwd', 'whoami', 'id', 'uname', 'date', 'env', 'printenv', 'jq', 'yq',
  'diff', 'cmp', 'comm', 'md5sum', 'sha256sum', 'shasum', 'cksum',
]);

// `git` subcommands that mutate. `git` itself is neither a read nor a write verb — it's a dispatcher.
const GIT_WRITE_SUBS = new Set([
  'push', 'commit', 'add', 'mv', 'rm', 'merge', 'rebase', 'reset', 'checkout', 'restore', 'switch', 'clean',
  'apply', 'stash', 'fetch', 'pull', 'clone', 'init', 'gc', 'prune', 'tag', 'notes', 'cherry-pick', 'revert',
  'bisect', 'update-ref', 'symbolic-ref', 'config', 'worktree', 'archive', 'branch',
]);
// Read-only `git` subcommands (so `git show`/`log` are not "ambiguous"). Note: `git config` is treated as a
// WRITE above (mutating by default; `--get` reads are sacrificed for safety).
const GIT_READ_SUBS = new Set([
  'show', 'log', 'diff', 'blame', 'cat-file', 'ls-files', 'rev-parse', 'name-rev', 'describe', 'status',
  'shortlog', 'reflog', 'ls-tree', 'grep', 'fsck', 'count-objects', 'remote', 'annotate',
]);

// The forge CLI's WRITE-shaped actions (ADR-0017): `gh pr create/merge` are the world-write
// surface alongside `git push` — the fence rules them writes (the risky set makes them asked
// under every rule but full_auto; core/risky.ts carries the patterns). `gh` is a dispatcher like
// `git`: the noun (pr/repo/issue/auth/api/…) is tokens[1], the action tokens[2].
const GH_WRITE_ACTIONS = new Set([
  'create', 'merge', 'close', 'reopen', 'edit', 'delete', 'comment', 'label', 'pin', 'unpin', 'transfer', 'lock', 'unlock', 'auto-merge',
]);

// Strip single/double-quoted spans so a `>` inside an argument isn't seen as a shell redirect.
function stripQuoted(s: string): string {
  let out = '';
  let quote: '' | "'" | '"' = '';
  for (const ch of s) {
    if (quote) {
      if (ch === quote) quote = '';
      // else: drop the quoted char
    } else if (ch === "'" || ch === '"') {
      quote = ch;
    } else {
      out += ch;
    }
  }
  return out;
}

// Prefixes that wrap a real command (`sudo rm`, `FOO=bar tee`, `env grep`).
const COMMAND_PREFIX_RE = /^(?:(?:sudo|env|nice|nohup|time|command|stdbuf|exec)\s+|[A-Za-z_][A-Za-z0-9_]*=\S*\s+)*/;

// The leading command token, after stripping prefixes. '' for empty input.
function leadingVerb(cmd: string): string {
  const m = cmd.replace(COMMAND_PREFIX_RE, '').trim().match(/^(\S+)/);
  return m ? m[1]! : '';
}

// The git subcommand: the first positional token after `git`, skipping global options that take a value
// (`-C <path>`, `--git-dir`, `--work-tree`, `-c <conf>`, `-G`, `-S`). '' if none.
function gitSubcommand(cmd: string): string {
  const tokens = cmd.trim().split(/\s+/).slice(1); // drop "git"
  const valueOpts = new Set(['-C', '--git-dir', '--work-tree', '-c', '--namespace', '--upload-pack', '-S', '-G']);
  let i = 0;
  for (; i < tokens.length; i++) {
    const t = tokens[i]!;
    if (t === '--') { i++; break; }
    if (valueOpts.has(t)) { i++; continue; } // skip option + its value (loop's i++ consumes the value)
    if (t.startsWith('-')) continue;          // flag, no value
    break;                                    // first positional = subcommand
  }
  return tokens[i] ?? '';
}

/**
 * Classify a shell command (pure; WO-0019 / TD-026). Recognises known reads (allow), clear writes + redirects
 * (gate), and marks unknowns `ambiguous` (the fence asks the verifier). Bash parsing is heuristic (TD-001).
 */
export function classifyCommandLine(command: string): ShellCommandClassification {
  const trimmed = command.trim();
  // 1) Real shell redirect? Scan the quote-stripped form so `grep ">"` is NOT a redirect.
  const redir = stripQuoted(trimmed).match(/(?:>>|>)\s*([^\s;&|()<>]+)/);
  if (redir) return { isWrite: true, command: trimmed, redirectTarget: redir[1] };
  // 2) Leading write verb?
  const verb = leadingVerb(trimmed);
  if (WRITE_VERBS.has(verb)) return { isWrite: true, command: trimmed };
  // 3) git subcommand dispatch.
  if (verb === 'git') {
    const sub = gitSubcommand(trimmed);
    if (GIT_WRITE_SUBS.has(sub)) return { isWrite: true, command: trimmed };
    if (GIT_READ_SUBS.has(sub)) return { isWrite: false, command: trimmed }; // known git read
    return { isWrite: false, command: trimmed, ambiguous: true };             // unmapped git sub — safe side
  }
  // 3b) the forge CLI's dispatch (ADR-0017): write-shaped actions gate; everything else stays
  // ambiguous (the pre-WO-0067 behavior for `gh pr list`/`auth status` — reads, silently
  // allowed for the writing roles, asked for the verifier).
  if (verb === 'gh') {
    const parts = trimmed.split(/\s+/);
    const action = parts[2] ?? '';
    if (GH_WRITE_ACTIONS.has(action)) return { isWrite: true, command: trimmed };
    return { isWrite: false, command: trimmed, ambiguous: true };
  }
  // 4) Known read verb?
  if (READ_VERBS.has(verb)) return { isWrite: false, command: trimmed };
  // 5) Ambiguous (could write): `make`, `./s.sh`, `node`, `python`, `npm …`. Empty input => plain read.
  return { isWrite: false, command: trimmed, ambiguous: verb !== '' };
}

/** Should the adapter synthesise a `turn_complete` when a plan-mode stream ended without one? Only when
 *  `plan_ready` fired (ExitPlanMode) but no result message followed — the SDK can end the stream there, leaving
 *  the architect plan session without a cost-carrying turn_complete (so its cost stays NULL → WO cost misses
 *  it; WO-0021). If the result DOES arrive (turn_complete emitted) this returns false — no double-emit. Never
 *  papers over a non-plan drive that ended without a result (planReadyEmitted false → false; that's the catch's
 *  error path, not this). */
export function shouldSynthesiseTurnComplete(planReadyEmitted: boolean, turnCompleteEmitted: boolean): boolean {
  return planReadyEmitted && !turnCompleteEmitted;
}

/** The stopReason of the SYNTHESISED plan-exit turn_complete (the adapter emits it when a plan stream ends
 *  after ExitPlanMode with no result). The pipeline keys on it to record the session WITHOUT cost — the
 *  synthesis has no cost data, and a fake $0.00 is a claim (WO-0026 / TD-030: honest NULL instead). */
export const PLAN_EXIT_WITHOUT_RESULT = 'plan_exit_without_result';

/** Human label for a tool-use input (a path/command when present) — keeps the UI off raw ids. */
export function summarizeToolInput(input: Record<string, unknown>): string {
  for (const k of ['file_path', 'path', 'command', 'notebook_path', 'url']) {
    const v = input[k];
    if (typeof v === 'string' && v.length > 0) return v;
  }
  return '';
}

// ===== Event → live-session-state fold (pure; the pane renders this) =====
export type { TranscriptLine } from './types';

export type LiveSessionStatus = 'idle' | 'running' | 'stopped_asking' | 'plan_ready' | 'done' | 'stopped' | 'error';

/** One surfaced permission ask. The agent may issue SEVERAL in parallel (multiple tool calls in one
 *  message) — each carries its own requestId and is answered independently (WO-0027 / Bulgu 10). */
export type { PermissionAsk } from './types';

export interface LiveSessionState {
  status: LiveSessionStatus;
  sessionId?: string;
  entries: TranscriptLine[];
  /** Every unanswered ask, in arrival order. A single `pendingAsk` could hold only one of a parallel
   *  batch — the rest became invisible-but-held (WO-0027 / Bulgu 10). Removed only by `ask_resolved`
   *  (the runner emits it when `decide` answers THAT id), by turn end, or by an error. */
  pendingAsks: PermissionAsk[];
  /** Queued steer notes, in submission order (WO-0045). A queued note adds NO transcript line — the
   *  pending count is the only mid-turn visible change (AC2). Removed by `steer_delivered` /
   *  `steer_retracted` for THAT id; SURVIVES `interrupted` (Durdur persists the queue for Sürdür, AC4). */
  pendingNotes: SteerNote[];
  pendingPlan?: string;
  cost: CostSummary;
  /** The latest context-window reading (WO-0046): percentage + used/max tokens, rendered beside
   *  the costline. Absent until the runner first reports one — never zero, never seeded (a
   *  restarted renderer re-reads it on the drive's next tool event or thinking burst). */
  context?: { usedTokens: number; maxTokens: number; percentage: number };
  /** The latest observed rich usage detail (WO-0052): the cache split, per-model usage, turns,
   *  durations — folded from `turn_usage` and the usage-bearing `turn_complete` (latest-wins).
   *  Absent until the runner first reports one — never zero, never an empty object (the
   *  `context` precedent). */
  lastUsage?: TurnUsage;
  /** The latest usage-limit windows reading (WO-0053): the windows plus the push channel's
   *  own status word (neutralized). Absent until the runner first reports one — never zero,
   *  never seeded (the `context` precedent). A status-less (pull) reading folds the windows
   *  and carries the prior status forward; only the push channel asserts status. */
  limitWindows?: { windows: LimitWindow[]; status?: 'ok' | 'warning' | 'blocked' };
  /** The limit STOP's facts when the error IS one (WO-0053) — the discriminator the detail
   *  view branches on: the LimitCard instead of the generic fail card (the `lastRefusal`
   *  pattern). Cleared by `started` (a Sürdür supersedes the stop; a re-hit re-stamps). */
  lastLimit?: LimitStop;
  /** ISO moment the drive last PROVED itself alive (WO-0046): an entry was appended (the event's
   *  `at` stamp) or a context reading arrived. The staleness line's anchor — deliberately NOT an
   *  entry-only concept: probe c1 showed a long-thinking model streams no transcript entries for
   *  minutes while the drive is healthy, so liveness is what honesty requires. */
  lastLifeAt?: string;
  lastError?: string;
  /** The vendor-neutral classification of `lastError`, when the adapter could classify it (WO-0025). */
  lastErrorCode?: ProviderErrorCode;
  /** The budget gate's refusal facts when the error IS one (WO-0047) — the discriminator the
   *  detail view branches on: the two-choice BudgetRefusalCard instead of the generic fail card.
   *  Cleared by `started` (a raise-and-re-run supersedes the refusal, the pendingPlan precedent). */
  lastRefusal?: BudgetRefusal;
}

export const initialSessionState: LiveSessionState = {
  status: 'idle',
  entries: [],
  pendingAsks: [],
  pendingNotes: [],
  cost: { tokensIn: 0, tokensOut: 0, usd: 0 },
};

/** Seed a live-session state from a PERSISTED session (WO-0026 / F14): the transcript the pipeline folded
 *  and the store checkpointed, plus the recorded cost and provider id, so a resumed pane appends to what
 *  already happened instead of opening blank. `asks` re-seeds persisted-but-unanswered permission asks
 *  (WO-0027 / Bulgu 9) — the pane offers to answer them; the resolver is still held in the host's runner.
 *  2026-08-24: a row whose status is 'stopped' seeds the fold's 'stopped' — the Sürdür offer and the
 *  "Durduruldu" turn line then derive after an app RESTART too (the fold's own memory dies with the
 *  renderer; the row does not).
 *  WO-0053: a row carrying `limitResetAt` re-seeds the fold's 'error' + `lastLimit` — the LimitCard
 *  re-derives after a restart (a five-hour window outlives the process). ONE boundary: a 'stopped'
 *  row never re-seeds it — the operator's Durdur is the last real event and raises the stopped pane,
 *  not a limit card; the stamp stays in the column for the ledger. Pure; empty input → the initial state. */
export function seedLiveState(
  session: Pick<SessionRef, 'transcript' | 'cost' | 'providerSessionId' | 'status' | 'pendingNotes' | 'limitResetAt'>,
  asks: PermissionAsk[] = [],
): LiveSessionState {
  if (!session.transcript.length && !session.cost && !session.providerSessionId && asks.length === 0 && session.status === 'none') {
    return initialSessionState;
  }
  return {
    ...initialSessionState,
    entries: session.transcript,
    ...(session.status === 'stopped' ? { status: 'stopped' as const } : {}),
    ...(asks.length ? { status: 'stopped_asking' as const, pendingAsks: asks } : {}),
    ...(session.pendingNotes?.length ? { pendingNotes: session.pendingNotes } : {}),
    ...(session.cost ? { cost: session.cost } : {}),
    ...(session.providerSessionId ? { sessionId: session.providerSessionId } : {}),
    ...(session.limitResetAt && session.status !== 'stopped'
      ? { status: 'error' as const, lastLimit: { resetAt: session.limitResetAt } }
      : {}),
  };
}

export function foldSessionEvent(state: LiveSessionState, event: RunnerEvent): LiveSessionState {
  switch (event.kind) {
    case 'started':
      // A new/resumed drive supersedes a pending plan (e.g. after approval) and any stale asks.
      // The drive's OPENING rides the transcript as a clocked note — a resumed session accumulates
      // one per run, so the döküm reads as the multi-run timeline it is (2026-08-24).
      return {
        ...state,
        status: 'running',
        sessionId: event.sessionId,
        pendingPlan: undefined,
        pendingAsks: [],
        lastRefusal: undefined,
        lastLimit: undefined,
        entries: [...state.entries, { speaker: 'note', kind: 'session_started', ...(event.at ? { detail: event.at } : {}) }],
        ...(event.at ? { lastLifeAt: event.at } : {}),
      };
    case 'assistant_text':
      return {
        ...state,
        status: state.status === 'idle' ? 'running' : state.status,
        entries: [...state.entries, { speaker: 'assistant', text: event.text, ...(event.parentToolUseId ? { parentToolUseId: event.parentToolUseId } : {}) }],
        ...(event.at ? { lastLifeAt: event.at } : {}),
      };
    case 'tool_use':
      // callId rides the entry (2026-08-23 §5): the transcript pairs a result to ITS call —
      // adjacency pairing broke on parallel calls (orphan headerless result walls).
      return {
        ...state,
        entries: [...state.entries, { speaker: 'tool_use', tool: event.tool, detail: summarizeToolInput(event.input), callId: event.callId, ...(event.parentToolUseId ? { parentToolUseId: event.parentToolUseId } : {}) }],
        ...(event.at ? { lastLifeAt: event.at } : {}),
      };
    case 'tool_result':
      // NOTE: a tool_result does NOT clear asks — with parallel asks we cannot know WHICH ask it answers
      // (the result carries callId, the ask carries requestId). Only `ask_resolved` removes an ask.
      return {
        ...state,
        entries: [...state.entries, { speaker: 'tool_result', summary: event.summary, isError: event.isError, callId: event.callId, ...(event.parentToolUseId ? { parentToolUseId: event.parentToolUseId } : {}) }],
        ...(event.at ? { lastLifeAt: event.at } : {}),
      };
    case 'permission_request':
      if (state.pendingAsks.some((a) => a.requestId === event.requestId)) return state; // dedupe on resume replays
      return {
        ...state,
        status: 'stopped_asking',
        pendingAsks: [...state.pendingAsks, { requestId: event.requestId, tool: event.tool, input: event.input, title: event.title, reason: event.reason }],
      };
    case 'ask_resolved':
      // The runner emits this when decide() answers THAT requestId — the only honest removal signal.
      // WO-0046 (review f1): the stamp refreshes the liveness anchor — the drive was parked on the
      // OPERATOR, and an anchor left at the pre-ask entry would flash the staleness line the instant
      // the answer resumes the fold, blaming the drive for the operator's own wait.
      return {
        ...state,
        pendingAsks: state.pendingAsks.filter((a) => a.requestId !== event.requestId),
        status: state.pendingAsks.length > 1 ? 'stopped_asking' : state.status === 'stopped_asking' ? 'running' : state.status,
        ...(event.at ? { lastLifeAt: event.at } : {}),
      };
    case 'plan_ready':
      return { ...state, status: 'plan_ready', pendingPlan: event.planText };
    case 'turn_complete':
      // The turn's OWN closing line rides the transcript (2026-08-24: a completed session showed
      // only its work — reads, commands — with no lifecycle at all; the stop had a line, the end
      // did not). Clock via the event's `at` stamp. A usage-bearing result folds its detail
      // latest-wins (WO-0052); a usage-less one leaves the prior reading alone.
      return {
        ...state,
        status: 'done',
        cost: event.cost,
        pendingAsks: [],
        entries: [...state.entries, { speaker: 'note', kind: 'session_done', ...(event.at ? { detail: event.at } : {}) }],
        ...(event.usage ? { lastUsage: event.usage } : {}),
        ...(event.at ? { lastLifeAt: event.at } : {}),
      };
    case 'turn_usage':
      // WO-0052: a per-result usage observation — state only. No transcript line (the
      // steer_queued precedent), no status change, and NEVER a cost touch: the pane costline
      // belongs to the accumulated terminal `turn_complete` (and the context_usage ride-along);
      // writing the per-turn delta here would double-count both.
      return {
        ...state,
        ...(event.usage ? { lastUsage: event.usage } : {}),
        ...(event.at ? { lastLifeAt: event.at } : {}),
      };
    case 'interrupted':
      // An intentional stop: terminal and calm. The asks die with the abort (the runner's finally
      // clears its held resolvers); a stale-'running' fold (the pre-stabilization bug) or an
      // interrupt-echo error must never survive an intentional Durdur. The fold also APPENDS the
      // session's own fact line ('interrupted') to the transcript — the pipeline records after
      // folding, so the LEDGER card's transcript carries the stop too (operator, 2026-08-23: the
      // archived döküm ended at the last tool checkpoint and read stale after Durdur; the ⏸/■
      // operator notes stay live-only by ruling — this line is the session's fact, not commentary).
      return {
        ...state,
        status: 'stopped',
        pendingAsks: [],
        entries: [...state.entries, { speaker: 'note', kind: 'interrupted', ...(event.at ? { detail: event.at } : {}) }],
        ...(event.cost ? { cost: event.cost } : {}),
        ...(event.at ? { lastLifeAt: event.at } : {}),
      };
    case 'steer_queued':
      // AC2: a queued note adds NO transcript line — the pending count is the only visible change
      // until the boundary delivers it. Status is untouched: queueing never interrupts or un-blocks.
      return { ...state, pendingNotes: [...state.pendingNotes, { id: event.noteId, text: event.note }] };
    case 'steer_delivered':
      // The note applied at the boundary — the operator line is first-class session content (not a
      // `note`: those are live-only Docket commentary). Delivery is authoritative even for an id the
      // fold never saw queued (a re-queue raced a remount).
      return {
        ...state,
        pendingNotes: state.pendingNotes.filter((n) => n.id !== event.noteId),
        entries: [...state.entries, { speaker: 'operator', text: event.text, noteId: event.noteId }],
        ...(event.at ? { lastLifeAt: event.at } : {}),
      };
    case 'steer_retracted':
      return { ...state, pendingNotes: state.pendingNotes.filter((n) => n.id !== event.noteId) };
    case 'context_usage':
      // No transcript line (the steer_queued precedent) — the reading is pane state. `cost` is the
      // drive-so-far spend (D3 folds one terminal turn_complete; this is the only mid-drive token
      // source) and `at` refreshes the staleness anchor: a fresh reading is a liveness proof.
      return {
        ...state,
        context: { usedTokens: event.usedTokens, maxTokens: event.maxTokens, percentage: event.percentage },
        ...(event.cost ? { cost: event.cost } : {}),
        ...(event.at ? { lastLifeAt: event.at } : {}),
      };
    case 'limit_windows':
      // WO-0053: a windows reading — pane state only (the context_usage precedent). No transcript
      // line, no status change, never a cost touch. A status-less (pull) reading carries the
      // prior status forward — the pull channel reports no triple and must not erase the push
      // channel's warning; a reading WITH a status is the push channel's own assertion.
      return {
        ...state,
        limitWindows: {
          windows: event.windows,
          ...(event.status ? { status: event.status } : state.limitWindows?.status ? { status: state.limitWindows.status } : {}),
        },
        ...(event.at ? { lastLifeAt: event.at } : {}),
      };
    case 'agent_task': {
      // WO-0055: the agent task's lifecycle edges. Openness is derived from the LATEST edge for
      // the taskId (a backward scan) — started-after-an-end legitimately re-opens (the
      // SendMessage restart, probe t1), so the guards key on the open/closed STATE, never on
      // "ever started".
      let open = false;
      for (let i = state.entries.length - 1; i >= 0; i--) {
        const e = state.entries[i];
        if (e && e.speaker === 'agent_task' && e.taskId === event.taskId) {
          open = e.phase === 'started';
          break;
        }
      }
      if (event.phase === 'started') {
        if (open) return state; // replay never double-opens an OPEN task
        return {
          ...state,
          entries: [
            ...state.entries,
            {
              speaker: 'agent_task',
              phase: 'started',
              taskId: event.taskId,
              ...(event.callId ? { callId: event.callId } : {}),
              ...(event.description ? { description: event.description } : {}),
              ...(event.subagentType ? { subagentType: event.subagentType } : {}),
              ...(event.at ? { at: event.at } : {}),
            },
          ],
          ...(event.at ? { lastLifeAt: event.at } : {}),
        };
      }
      if (!open) return state; // no OPEN task behind this end — dropped (no orphan wall)
      return {
        ...state,
        entries: [
          ...state.entries,
          {
            speaker: 'agent_task',
            phase: 'ended',
            taskId: event.taskId,
            ...(event.status ? { status: event.status } : {}),
            ...(event.summary ? { summary: event.summary } : {}),
            ...(event.at ? { at: event.at } : {}),
          },
        ],
        ...(event.at ? { lastLifeAt: event.at } : {}),
      };
    }
    case 'error':
      // WO-0047: a gate refusal folds its facts beside the message — the card branches on them.
      // WO-0053: a limit stop folds its facts the same way (`lastLimit`, the same discriminator
      // pattern); an error WITHOUT a limit payload leaves a prior stop untouched (the keep rule —
      // the stamp describes the stop that set it, only `started` or a clean close clears it).
      return {
        ...state,
        status: 'error',
        lastError: event.message,
        pendingAsks: [],
        ...(event.code ? { lastErrorCode: event.code } : {}),
        ...(event.refusal ? { lastRefusal: event.refusal } : {}),
        ...(event.limit ? { lastLimit: event.limit } : {}),
      };
  }
}

/** WO-0055: the tasks that started and never ended in this transcript — the activity line's
 *  "N ajan sürüyor" count, the running lamps, and (rev 2) the live strip's per-agent rows.
 *  DERIVED, not folded, so a seeded/restarted pane re-derives it from the persisted rows (the
 *  seedLiveState discipline: no new state field). The LATEST edge per taskId decides open-ness —
 *  a task that re-opened after an end (the SendMessage restart, probe t1) counts once, at its
 *  newest leg. `at` rides the newest start — the strip's elapsed clock. Pure. */
export function openAgentTasks(entries: TranscriptLine[]): { taskId: string; callId?: string; description?: string; at?: string }[] {
  const open = new Map<string, { taskId: string; callId?: string; description?: string; at?: string }>();
  for (const e of entries) {
    if (e.speaker !== 'agent_task') continue;
    if (e.phase === 'started') {
      open.set(e.taskId, {
        taskId: e.taskId,
        ...(e.callId ? { callId: e.callId } : {}),
        ...(e.description ? { description: e.description } : {}),
        ...(e.at ? { at: e.at } : {}),
      });
    } else {
      open.delete(e.taskId);
    }
  }
  return [...open.values()];
}

/** The staleness threshold (WO-0046, operator ruling 2026-08-26): a RUNNING drive whose last
 *  liveness proof is older than this many minutes shows the "N dk'dır yeni çıktı yok" line.
 *  One constant, no ladder — the solo operator decides what to do; the line informs, never acts
 *  (no watchdog, no snooze: out of scope by the order). */
export const STALE_AFTER_MIN = 3;

/** Whole minutes (floor) since the drive last proved itself alive — or undefined when there is
 *  nothing honest to claim: a fold that is not 'running' (a stopped/errored/asking drive keeps
 *  its frozen words; the ask surface itself says why it waits) or no liveness proof ever arrived
 *  (nothing to count from — the boot window until `started`). Pure: the caller owns the clock
 *  (the pane's one-second ticker), so tests and the renderer share one rule. */
export function staleMinutes(state: Pick<LiveSessionState, 'status' | 'lastLifeAt'>, nowMs: number): number | undefined {
  if (state.status !== 'running' || !state.lastLifeAt) return undefined;
  const then = Date.parse(state.lastLifeAt);
  if (Number.isNaN(then)) return undefined;
  return Math.max(0, Math.floor((nowMs - then) / 60000));
}

/** The limit card's ONE decision (WO-0053): has the stamped reset moment passed? Pure, clock
 *  injected — the card, its tests and the e2e (static past/future seeds) share one truth, no
 *  wall-clock seam. 'wait' → the Sürdür is ABSENT with the clock as the standing reason line
 *  (ADR-0001); 'ready' → exactly one primary button. An unparseable stamp waits — never invite
 *  a press the provider will reject (the stamp is the adapter's promise; garbage in, no claim). */
export function limitCrossing(resetAt: string, nowMs: number): 'wait' | 'ready' {
  const then = Date.parse(resetAt);
  if (Number.isNaN(then)) return 'wait';
  return nowMs >= then ? 'ready' : 'wait';
}
