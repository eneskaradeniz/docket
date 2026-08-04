// src/adapters/runner — the ONE provider adapter (ADR-0006). Implements the
// `SessionRunner` port (src/core/runner.ts) over @anthropic-ai/claude-agent-sdk.
//
// This is the only place under src/ that names the provider, permitted by ADR-0006
// line 74-75 ("a vendor name appears … inside a provider adapter") and by the
// boundary check's src/adapters/ exemption. It is imported only by the composition
// root (electron/main.ts). Verified by running, not by unit tests (ADR-0006:
// test-first is for core; adapters are exercised end-to-end).
//
// Design (see docs/work-orders/WO-0008-session-runner/plan.md):
// - drive() spawns a query() and translates SDKMessage → RunnerEvent through an
//   async queue, so the canUseTool callback can surface a permission_request and
//   then await the operator's decide() — the "hold" (TD-001).
// - canUseTool enforces the role write-scope fence (core's fenceDecision) before
//   anything reaches the operator: out-of-scope writes deny with no prompt.
// - plan approval is resume + a move off plan mode (findings Q2/Q3); cost is read
//   from the result message (findings Q1).
import { resolve } from 'node:path';
import { query } from '@anthropic-ai/claude-agent-sdk';
import type {
  CanUseTool,
  Options,
  PermissionMode,
  PermissionResult,
} from '@anthropic-ai/claude-agent-sdk';
import {
  fenceDecision,
  summarizeToolInput,
  writeScopeFor,
  type DriveInput,
  type RunnerEvent,
  type ScopeRoots,
  type WriteAttempt,
} from '../../core/runner';
import type { CostSummary } from '../../core/types';
import type { SessionRunner } from '../../core/runner';

const WRITE_TOOLS = new Set(['Write', 'Edit', 'MultiEdit', 'NotebookEdit', 'NotebookEditNew']);
const DECISION_STORE_DIR = 'docs'; // single-repo pilot (docket); multi-repo config is M4.

// --- Async push-queue: lets canUseTool push events into the drive() stream. ---
class AsyncQueue<T> {
  private buf: T[] = [];
  private waiters: Array<(r: IteratorResult<T>) => void> = [];
  private closed = false;
  push(v: T): void {
    if (this.closed) return;
    const w = this.waiters.shift();
    if (w) w({ value: v, done: false });
    else this.buf.push(v);
  }
  next(): Promise<IteratorResult<T>> {
    if (this.buf.length) return Promise.resolve({ value: this.buf.shift()!, done: false });
    if (this.closed) return Promise.resolve({ value: undefined as unknown as T, done: true });
    return new Promise((res) => this.waiters.push(res));
  }
  close(): void {
    if (this.closed) return;
    this.closed = true;
    while (this.waiters.length) this.waiters.shift()!({ value: undefined as unknown as T, done: true });
  }
}

// --- Provider-message structural view (the SDKMessage union is large; translate
//     off this shape, which is all we read). ---
type AnyBlock = {
  type: string;
  text?: string;
  name?: string;
  input?: Record<string, unknown>;
  id?: string;
  tool_use_id?: string;
  content?: unknown;
  is_error?: boolean;
};
type AnyMsg = {
  type: string;
  subtype?: string;
  session_id?: string;
  message?: { content: AnyBlock[] };
  total_cost_usd?: number;
  usage?: { input_tokens?: number; output_tokens?: number };
  stop_reason?: string | null;
  result?: string;
  errors?: string[];
};

/** Heuristic: does this shell command write, and to where? (Bash is the TD-001 gap.) */
function classifyShell(command: string, cwd: string): WriteAttempt {
  const redir = command.match(/(?:>>|>)\s*(\S+)/);
  if (redir) return { isWrite: true, command, targetPath: resolve(cwd, redir[1]) };
  if (/\b(cp|mv|rm|mkdir|touch|tee|chmod|chown|dd|install|rsync|sed)\b/.test(command)) {
    return { isWrite: true, command, targetPath: undefined };
  }
  return { isWrite: false, command };
}

function classifyAttempt(toolName: string, input: Record<string, unknown>, cwd: string): WriteAttempt {
  if (WRITE_TOOLS.has(toolName)) {
    const target = input.file_path ?? input.notebook_path ?? input.path;
    return { isWrite: true, targetPath: typeof target === 'string' ? resolve(cwd, target) : undefined };
  }
  if (toolName === 'Bash' && typeof input.command === 'string') {
    return classifyShell(input.command, cwd);
  }
  return { isWrite: false };
}

function blockSummary(content: unknown): string {
  if (typeof content === 'string') return content;
  if (Array.isArray(content)) {
    return content
      .map((c) => (typeof c === 'string' ? c : (c as { text?: string })?.text ?? ''))
      .join(' ')
      .slice(0, 200);
  }
  return '';
}

function costOf(m: AnyMsg): CostSummary {
  return {
    usd: m.total_cost_usd ?? 0,
    tokensIn: m.usage?.input_tokens ?? 0,
    tokensOut: m.usage?.output_tokens ?? 0,
  };
}

function planTextFromInput(input: Record<string, unknown> | undefined): string {
  if (!input) return '';
  if (typeof input.plan === 'string') return input.plan;
  return summarizeToolInput(input) || JSON.stringify(input, null, 2);
}

export function createRunner(): SessionRunner {
  // Pending stop-and-asks: requestId → resolver. The SDK's canUseTool awaits the resolver.
  const pending = new Map<string, (d: PermissionResult) => void>();
  let currentAbort: AbortController | undefined;

  function resolvePermissionMode(input: DriveInput): PermissionMode {
    if (input.approve) return 'default'; // resuming after plan_ready → implement (fence + ask active)
    if (input.role === 'architect') return 'plan';
    if (input.role === 'verifier') return 'default'; // read-only is enforced by the fence
    return input.mode === 'plan' ? 'plan' : 'default';
  }

  async function runDrive(input: DriveInput, queue: AsyncQueue<RunnerEvent>): Promise<void> {
    const permissionMode = resolvePermissionMode(input);
    const isPlanDrive = permissionMode === 'plan';
    const roots: ScopeRoots = { repoRoot: input.cwd, decisionStore: resolve(input.cwd, DECISION_STORE_DIR) };
    const scope = writeScopeFor(input.role, roots);
    let planReadyEmitted = false;
    const abort = new AbortController();
    currentAbort = abort;

    const canUseTool: CanUseTool = (toolName, toolInput, o) =>
      new Promise<PermissionResult>((settle) => {
        const attempt = classifyAttempt(toolName, toolInput, input.cwd);
        const verdict = fenceDecision(scope, attempt);
        if (verdict === 'allow') return settle({ behavior: 'allow' });
        if (verdict === 'deny') {
          return settle({ behavior: 'deny', message: `fence: ${input.role} may not write there (ADR-0002)` });
        }
        // 'ask' — surface to the operator and hold until decide().
        const requestId = o.requestId;
        pending.set(requestId, settle);
        queue.push({
          kind: 'permission_request',
          requestId,
          tool: toolName,
          input: toolInput,
          title: o.title,
          reason: o.decisionReason,
        });
      });

    const translate = (msg: AnyMsg): RunnerEvent[] => {
      const out: RunnerEvent[] = [];
      switch (msg.type) {
        case 'system':
          if (msg.subtype === 'init' && msg.session_id) out.push({ kind: 'started', sessionId: msg.session_id });
          break;
        case 'assistant':
          for (const b of msg.message?.content ?? []) {
            if (b.type === 'text' && b.text) out.push({ kind: 'assistant_text', text: b.text });
            if (b.type === 'tool_use') {
              if (b.name === 'ExitPlanMode') {
                planReadyEmitted = true;
                out.push({ kind: 'plan_ready', planText: planTextFromInput(b.input) });
              } else {
                out.push({ kind: 'tool_use', callId: b.id ?? '', tool: b.name ?? '', input: b.input ?? {} });
              }
            }
          }
          break;
        case 'user':
          for (const b of msg.message?.content ?? []) {
            if (b.type === 'tool_result') {
              out.push({
                kind: 'tool_result',
                callId: b.tool_use_id ?? '',
                summary: blockSummary(b.content),
                isError: !!b.is_error,
              });
            }
          }
          break;
        case 'result': {
          // Plan-mode fallback: if the turn ended with no ExitPlanMode tool call
          // (the probe found it can be absent — TD-016), treat the result text as the plan.
          if (isPlanDrive && !planReadyEmitted && msg.result) {
            planReadyEmitted = true;
            out.push({ kind: 'plan_ready', planText: msg.result });
          }
          if (msg.subtype && msg.subtype !== 'success') {
            out.push({ kind: 'error', message: msg.errors?.[0] ?? msg.subtype });
          }
          out.push({ kind: 'turn_complete', stopReason: msg.stop_reason ?? 'unknown', cost: costOf(msg) });
          break;
        }
        default:
          break; // hook/partial/status messages are not part of the product stream yet.
      }
      return out;
    };

    const options: Options = {
      cwd: input.cwd,
      permissionMode,
      canUseTool,
      abortController: abort,
    };
    if (input.resume) options.resume = input.resume;

    try {
      for await (const msg of query({ prompt: input.prompt, options })) {
        for (const e of translate(msg as unknown as AnyMsg)) queue.push(e);
      }
    } catch (e) {
      const err = e as { name?: string; message?: string };
      // An interrupt is intentional — end the stream without an error event.
      if (err?.name !== 'AbortError') {
        queue.push({ kind: 'error', message: err?.message ?? String(e) });
      }
    } finally {
      currentAbort = undefined;
      queue.close();
    }
  }

  return {
    drive(input: DriveInput): AsyncIterable<RunnerEvent> {
      const queue = new AsyncQueue<RunnerEvent>();
      void runDrive(input, queue); // background: pushes events; closes on completion/error
      return (async function* stream() {
        while (true) {
          const r = await queue.next();
          if (r.done) return;
          yield r.value;
        }
      })();
    },
    async decide(requestId, decision): Promise<void> {
      const settle = pending.get(requestId);
      if (!settle) return;
      pending.delete(requestId);
      settle(
        decision.allow
          ? { behavior: 'allow' }
          : { behavior: 'deny', message: decision.reason || 'denied by operator' },
      );
    },
    async interrupt(): Promise<void> {
      currentAbort?.abort();
    },
  };
}
