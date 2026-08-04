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
import type { CostSummary, SessionRole } from './types';

// --- The stream the runner yields. A vendor-neutral projection of a session.
//     The adapter translates the provider's message stream into these events. ---
export type RunnerEvent =
  | { kind: 'started'; sessionId: string }
  | { kind: 'assistant_text'; text: string }
  | { kind: 'tool_use'; callId: string; tool: string; input: Record<string, unknown> }
  | { kind: 'tool_result'; callId: string; summary: string; isError: boolean }
  | { kind: 'permission_request'; requestId: string; tool: string; input: Record<string, unknown>; title?: string; reason?: string }
  | { kind: 'plan_ready'; planText: string }
  | { kind: 'turn_complete'; stopReason: string; cost: CostSummary }
  | { kind: 'error'; message: string };

// The operator's answer to a surfaced `permission_request` (the stop-and-ask).
export type PermissionDecision = { allow: true } | { allow: false; reason: string };

export interface DriveInput {
  role: SessionRole;
  /** Working repo (ADR-0002). The provider session runs here; resume must originate here. */
  cwd: string;
  /** Work-order mode — the adapter maps role + mode → provider permission mode (plan/approve/default). */
  mode: 'plan' | 'direct';
  prompt: string;
  /** Session id to resume. Omit to start a fresh session. */
  resume?: string;
  /** Resume after a `plan_ready`: move the provider off plan mode + send an approval message. */
  approve?: boolean;
}

// --- The port. Async throughout: the provider stream is an async generator and the
//     permission callback is a Promise the provider awaits. ---
export interface SessionRunner {
  /** Open or resume a session, yielding its events until the turn completes or errors. */
  drive(input: DriveInput): AsyncIterable<RunnerEvent>;
  /** Answer a surfaced `permission_request`. Resolves the held permission callback. */
  decide(requestId: string, decision: PermissionDecision): Promise<void>;
  /** Controlled stop of the current run. */
  interrupt(): Promise<void>;
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
  // Reads are always allowed — the fence is asymmetric (TD-001: reads retained).
  if (!attempt.isWrite) return 'allow';
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

/** Human label for a tool-use input (a path/command when present) — keeps the UI off raw ids. */
export function summarizeToolInput(input: Record<string, unknown>): string {
  for (const k of ['file_path', 'path', 'command', 'notebook_path', 'url']) {
    const v = input[k];
    if (typeof v === 'string' && v.length > 0) return v;
  }
  return '';
}

// ===== Event → live-session-state fold (pure; the pane renders this) =====
export type TranscriptLine =
  | { speaker: 'assistant'; text: string }
  | { speaker: 'tool_use'; tool: string; detail: string }
  | { speaker: 'tool_result'; summary: string; isError: boolean }
  | { speaker: 'system'; text: string };

export type LiveSessionStatus = 'idle' | 'running' | 'stopped_asking' | 'plan_ready' | 'done' | 'error';

export interface LiveSessionState {
  status: LiveSessionStatus;
  sessionId?: string;
  entries: TranscriptLine[];
  pendingAsk?: { requestId: string; tool: string; input: Record<string, unknown>; title?: string; reason?: string };
  pendingPlan?: string;
  cost: CostSummary;
  lastError?: string;
}

export const initialSessionState: LiveSessionState = {
  status: 'idle',
  entries: [],
  cost: { tokensIn: 0, tokensOut: 0, usd: 0 },
};

/** Clear a resolved stop-and-ask: any non-request event means the operator answered. */
function clearPendingAskIfResolved(state: LiveSessionState, event: RunnerEvent): LiveSessionState {
  if (state.pendingAsk && event.kind !== 'permission_request') {
    return { ...state, status: 'running', pendingAsk: undefined };
  }
  return state;
}

export function foldSessionEvent(state: LiveSessionState, event: RunnerEvent): LiveSessionState {
  const s = clearPendingAskIfResolved(state, event);
  switch (event.kind) {
    case 'started':
      // A new/resumed drive supersedes a pending plan (e.g. after approval).
      return { ...s, status: 'running', sessionId: event.sessionId, pendingPlan: undefined };
    case 'assistant_text':
      return { ...s, status: s.status === 'idle' ? 'running' : s.status, entries: [...s.entries, { speaker: 'assistant', text: event.text }] };
    case 'tool_use':
      return { ...s, entries: [...s.entries, { speaker: 'tool_use', tool: event.tool, detail: summarizeToolInput(event.input) }] };
    case 'tool_result':
      return { ...s, entries: [...s.entries, { speaker: 'tool_result', summary: event.summary, isError: event.isError }] };
    case 'permission_request':
      return { ...s, status: 'stopped_asking', pendingAsk: { requestId: event.requestId, tool: event.tool, input: event.input, title: event.title, reason: event.reason } };
    case 'plan_ready':
      return { ...s, status: 'plan_ready', pendingPlan: event.planText };
    case 'turn_complete':
      return { ...s, status: 'done', cost: event.cost, pendingAsk: undefined };
    case 'error':
      return { ...s, status: 'error', lastError: event.message };
  }
}
