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
import type { CostSummary, PermissionAsk, SessionRef, SessionRole, TrackId, WorkOrderId, TranscriptLine } from './types';
import type { PermissionRule } from './source';

// --- The stream the runner yields. A vendor-neutral projection of a session.
//     The adapter translates the provider's message stream into these events. ---
export type RunnerEvent =
  | { kind: 'started'; sessionId: string }
  | { kind: 'assistant_text'; text: string }
  | { kind: 'tool_use'; callId: string; tool: string; input: Record<string, unknown> }
  | { kind: 'tool_result'; callId: string; summary: string; isError: boolean }
  | { kind: 'permission_request'; requestId: string; tool: string; input: Record<string, unknown>; title?: string; reason?: string }
  // The runner emits this when decide() answers a requestId (WO-0027): with PARALLEL asks, nothing else can
  // identify which held ask was answered (tool_result carries callId, not requestId) — the old fold guessed
  // "any event clears the ask" and made sibling cards vanish while still held (Bulgu 10).
  | { kind: 'ask_resolved'; requestId: string }
  | { kind: 'plan_ready'; planText: string }
  | { kind: 'turn_complete'; stopReason: string; cost: CostSummary; result?: string }
  // `code` is the vendor-neutral classification of a provider/config failure (WO-0025 / B1) — the adapter
  // classifies the provider's raw message (the vendor vocabulary never leaves the adapter, ADR-0006) so the
  // UI can render Turkish copy instead of a raw English string.
  | { kind: 'error'; message: string; code?: ProviderErrorCode };

/**
 * Why a provider session could not run, vendor-neutrally. The runner adapter maps the provider's own error
 * strings/typed signals onto these; core/UI never name the vendor (c1). Unknown failures carry no code.
 */
export type ProviderErrorCode =
  | 'auth_missing' // no credentials available to the provider
  | 'auth_failed' // credentials present but rejected
  | 'timeout' // subprocess handshake/connection timed out
  | 'executable_missing'; // the provider CLI binary was not found

// The operator's answer to a surfaced `permission_request` (the stop-and-ask).
export type PermissionDecision = { allow: true } | { allow: false; reason: string };

export interface DriveInput {
  role: SessionRole;
  /** The work order this session belongs to — main uses it to persist the association. */
  workOrderId: WorkOrderId;
  /** The track an implementer session is scoped to, if any (ADR-0002). Nullable: track selection is a future UI refinement. */
  scope?: TrackId;
  /**
   * Working repo (ADR-0002); the provider session runs here and resume must originate here.
   * Optional: the renderer cannot know filesystem paths, so it omits this and the composition
   * root fills it (the pilot uses the docket repo; per-track paths come via the connection
   * table in M3/M4, ADR-0003).
   */
  cwd?: string;
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

export type LiveSessionStatus = 'idle' | 'running' | 'stopped_asking' | 'plan_ready' | 'done' | 'error';

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
  pendingPlan?: string;
  cost: CostSummary;
  lastError?: string;
  /** The vendor-neutral classification of `lastError`, when the adapter could classify it (WO-0025). */
  lastErrorCode?: ProviderErrorCode;
}

export const initialSessionState: LiveSessionState = {
  status: 'idle',
  entries: [],
  pendingAsks: [],
  cost: { tokensIn: 0, tokensOut: 0, usd: 0 },
};

/** Seed a live-session state from a PERSISTED session (WO-0026 / F14): the transcript the pipeline folded
 *  and the store checkpointed, plus the recorded cost and provider id, so a resumed pane appends to what
 *  already happened instead of opening blank. `asks` re-seeds persisted-but-unanswered permission asks
 *  (WO-0027 / Bulgu 9) — the pane offers to answer them; the resolver is still held in the host's runner.
 *  Pure; empty input → the initial state. */
export function seedLiveState(
  session: Pick<SessionRef, 'transcript' | 'cost' | 'providerSessionId'>,
  asks: PermissionAsk[] = [],
): LiveSessionState {
  if (!session.transcript.length && !session.cost && !session.providerSessionId && asks.length === 0) {
    return initialSessionState;
  }
  return {
    ...initialSessionState,
    entries: session.transcript,
    ...(asks.length ? { status: 'stopped_asking' as const, pendingAsks: asks } : {}),
    ...(session.cost ? { cost: session.cost } : {}),
    ...(session.providerSessionId ? { sessionId: session.providerSessionId } : {}),
  };
}

export function foldSessionEvent(state: LiveSessionState, event: RunnerEvent): LiveSessionState {
  switch (event.kind) {
    case 'started':
      // A new/resumed drive supersedes a pending plan (e.g. after approval) and any stale asks.
      return { ...state, status: 'running', sessionId: event.sessionId, pendingPlan: undefined, pendingAsks: [] };
    case 'assistant_text':
      return { ...state, status: state.status === 'idle' ? 'running' : state.status, entries: [...state.entries, { speaker: 'assistant', text: event.text }] };
    case 'tool_use':
      return { ...state, entries: [...state.entries, { speaker: 'tool_use', tool: event.tool, detail: summarizeToolInput(event.input) }] };
    case 'tool_result':
      // NOTE: a tool_result does NOT clear asks — with parallel asks we cannot know WHICH ask it answers
      // (the result carries callId, the ask carries requestId). Only `ask_resolved` removes an ask.
      return { ...state, entries: [...state.entries, { speaker: 'tool_result', summary: event.summary, isError: event.isError }] };
    case 'permission_request':
      if (state.pendingAsks.some((a) => a.requestId === event.requestId)) return state; // dedupe on resume replays
      return {
        ...state,
        status: 'stopped_asking',
        pendingAsks: [...state.pendingAsks, { requestId: event.requestId, tool: event.tool, input: event.input, title: event.title, reason: event.reason }],
      };
    case 'ask_resolved':
      // The runner emits this when decide() answers THAT requestId — the only honest removal signal.
      return {
        ...state,
        pendingAsks: state.pendingAsks.filter((a) => a.requestId !== event.requestId),
        status: state.pendingAsks.length > 1 ? 'stopped_asking' : state.status === 'stopped_asking' ? 'running' : state.status,
      };
    case 'plan_ready':
      return { ...state, status: 'plan_ready', pendingPlan: event.planText };
    case 'turn_complete':
      return { ...state, status: 'done', cost: event.cost, pendingAsks: [] };
    case 'error':
      return { ...state, status: 'error', lastError: event.message, pendingAsks: [], ...(event.code ? { lastErrorCode: event.code } : {}) };
  }
}

// ===== SADE mode: a calm one-line phase derived from the live state (WO-0016 redesign) =====
// The DETAIL stream shows every entry; SADE shows a single human-readable status instead. This is a pure
// classification from `LiveSessionState` (status first, then the last meaningful entry's tool). It is an
// honest heuristic from tool names — "Kod taranıyor" really is a Read/Grep — not a paraphrase of the
// model's reasoning. A future structured `progress` event can replace the entry-inspection with one swap.
export type SimplePhase =
  | 'planning_started'
  | 'scanning'
  | 'thinking'
  | 'writing_decisions'
  | 'running_command'
  | 'delegating'
  | 'fetching'
  | 'asking_input'
  | 'asking_permission'
  | 'ready'
  | 'errored'
  | 'done';

function classifyTool(tool: string): SimplePhase {
  switch (tool) {
    case 'Read':
    case 'Grep':
    case 'Glob':
      return 'scanning';
    case 'Write':
    case 'Edit':
    case 'MultiEdit':
    case 'NotebookEdit':
      return 'writing_decisions';
    case 'Bash':
      return 'running_command';
    case 'Task':
      return 'delegating';
    case 'WebFetch':
    case 'WebSearch':
      return 'fetching';
    default:
      return 'thinking';
  }
}

export function simplePhaseFromState(state: LiveSessionState): SimplePhase {
  switch (state.status) {
    case 'error':
      return 'errored';
    case 'stopped_asking':
      return 'asking_permission';
    case 'plan_ready':
      return 'ready';
    case 'done':
      return state.pendingPlan ? 'ready' : 'asking_input';
    default:
      break; // 'running' | 'idle' — inspect the entries
  }
  // Walk back past trailing tool_results (a result completes the prior tool, not a new phase — avoids
  // flicker back to 'thinking' after every read), then classify the last meaningful entry.
  for (let i = state.entries.length - 1; i >= 0; i--) {
    const e = state.entries[i]!;
    if (e.speaker === 'tool_result') continue;
    if (e.speaker === 'tool_use') return classifyTool(e.tool);
    if (e.speaker === 'assistant') return 'thinking';
    return 'planning_started'; // system
  }
  return 'planning_started';
}
