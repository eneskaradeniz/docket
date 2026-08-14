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
import { existsSync } from 'node:fs';
import { homedir } from 'node:os';
import { join, resolve } from 'node:path';
import { query, startup } from '@anthropic-ai/claude-agent-sdk';
import type {
  CanUseTool,
  Options,
  PermissionMode,
  PermissionResult,
} from '@anthropic-ai/claude-agent-sdk';
import type { ProviderErrorCode } from '../../core/runner';
import type { ProviderStatus } from '../../core/app-settings';
import {
  PLAN_EXIT_WITHOUT_RESULT,
  classifyCommandLine,
  fenceDecision,
  isPlanDrive,
  shouldSynthesiseTurnComplete,
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

// Shell-command write classification. Delegates the pure policy to core's `classifyCommandLine` (tested
// there); this thin shim only resolves a redirect target against cwd (core imports no Node path module —
// ADR-0006). The policy — quote-aware redirect, leading write verb, git subcommand split, read allowlist,
// ambiguous→verifier ask — closes TD-026; the irreducible gap (arbitrary binaries/scripts) stays TD-001.
function classifyShell(command: string, cwd: string): WriteAttempt {
  const c = classifyCommandLine(command);
  if (c.isWrite && c.redirectTarget !== undefined) {
    return { isWrite: true, command: c.command, targetPath: resolve(cwd, c.redirectTarget) };
  }
  return { isWrite: c.isWrite, command: c.command, ambiguous: c.ambiguous };
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

/** Optional runner construction (WO-0025 / B1): `env` REPLACES the subprocess env (SDK semantics), so the
 *  host spreads process.env itself — see `providerEnvForKey`. */
export interface RunnerOptions {
  env?: Record<string, string>;
}

export function createRunner(runnerOpts: RunnerOptions = {}): SessionRunner {
  // Pending stop-and-asks: requestId → resolver. The SDK's canUseTool awaits the resolver.
  const pending = new Map<string, (d: PermissionResult) => void>();
  let currentAbort: AbortController | undefined;

  function resolvePermissionMode(input: DriveInput): PermissionMode {
    if (input.approve) return 'default'; // resuming after plan_ready → implement (fence + ask active)
    if (isPlanDrive(input)) return 'plan'; // ONLY the pure architect plan drive — not a review/step drive (WO-0023 / P1-1)
    if (input.role === 'verifier') return 'default'; // read-only is enforced by the fence
    return input.mode === 'plan' ? 'plan' : 'default';
  }

  async function runDrive(input: DriveInput, queue: AsyncQueue<RunnerEvent>): Promise<void> {
    const permissionMode = resolvePermissionMode(input);
    const isPlanDrive = permissionMode === 'plan';
    // The renderer omits cwd (it cannot know filesystem paths); the composition root fills
    // it. Default to the process cwd as a pilot fallback (ADR-0003 per-track paths later).
    const cwd = input.cwd ?? process.cwd();
    const roots: ScopeRoots = { repoRoot: cwd, decisionStore: resolve(cwd, DECISION_STORE_DIR) };
    const scope = writeScopeFor(input.role, roots);
    let planReadyEmitted = false;
    let turnCompleteEmitted = false; // tracked to synthesise a turn_complete if the plan-mode stream ends without one (WO-0021)
    const abort = new AbortController();
    currentAbort = abort;

    const canUseTool: CanUseTool = (toolName, toolInput, o) =>
      new Promise<PermissionResult>((settle) => {
        const attempt = classifyAttempt(toolName, toolInput, cwd);
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
          // `result` is the SDK's canonical turn answer (WO-0017) — the composition root captures it as the
          // step report at turn_complete. Omitted when absent (the fold ignores it either way).
          out.push(
            msg.result
              ? { kind: 'turn_complete', stopReason: msg.stop_reason ?? 'unknown', cost: costOf(msg), result: msg.result }
              : { kind: 'turn_complete', stopReason: msg.stop_reason ?? 'unknown', cost: costOf(msg) },
          );
          break;
        }
        default:
          break; // hook/partial/status messages are not part of the product stream yet.
      }
      return out;
    };

    const options: Options = {
      cwd,
      permissionMode,
      canUseTool,
      abortController: abort,
    };
    // Options.env REPLACES the subprocess env — compose over process.env so PATH/HOME survive.
    if (runnerOpts.env) options.env = { ...process.env, ...runnerOpts.env };
    if (input.resume) options.resume = input.resume;

    try {
      for await (const msg of query({ prompt: input.prompt, options })) {
        for (const e of translate(msg as unknown as AnyMsg)) {
          if (e.kind === 'turn_complete') turnCompleteEmitted = true;
          queue.push(e);
        }
      }
    } catch (e) {
      const err = e as { name?: string; message?: string };
      // An interrupt is intentional — end the stream without an error event.
      if (err?.name !== 'AbortError') {
        const raw = err?.message ?? String(e);
        queue.push({ kind: 'error', message: raw, ...(classifyProviderError(raw) ? { code: classifyProviderError(raw) } : {}) });
      }
    } finally {
      currentAbort = undefined;
      // If a plan-mode turn emitted plan_ready but the SDK ended the stream without a result (so no
      // turn_complete), synthesise one — so the architect plan session still records cost + the main
      // capture side-effects fire (WO-0021). Cost is honest zeros when the SDK gave none; result is left
      // absent so main falls back to its accumulated assistantText for review verdicts.
      if (shouldSynthesiseTurnComplete(planReadyEmitted, turnCompleteEmitted)) {
        queue.push({ kind: 'turn_complete', stopReason: PLAN_EXIT_WITHOUT_RESULT, cost: { usd: 0, tokensIn: 0, tokensOut: 0 } });
      }
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

// ===== Provider surface (WO-0025 / B1) — the vendor vocabulary lives HERE ONLY (c1 / ADR-0006) =====
// Core speaks ProviderErrorCode/ProviderStatus; this module classifies the provider's raw strings, builds
// the env-var map, and can run a token-free handshake check. Everything crossing the boundary is neutral.

/** The provider's API-key env var name. Only this module (and hosts wiring env) may spell it. */
const PROVIDER_KEY_ENV = 'ANTHROPIC_API_KEY';
/** The provider CLI's login directory (auth present when it exists). */
const PROVIDER_LOGIN_DIR = '.claude';

/** Build the env map for a stored key. NOTE: Options.env REPLACES the subprocess env — the host MUST
 *  spread process.env when composing: { ...process.env, ...providerEnvForKey(key) }. */
export function providerEnvForKey(key: string): Record<string, string> {
  return { [PROVIDER_KEY_ENV]: key };
}

/** A cheap, spawn-free readiness hint: the key env var is set, or the provider CLI's login dir exists.
 *  Unknown ('unknown', never a guess) otherwise — the same honesty rule as M3 health checks. */
export function quickProviderCheck(env: NodeJS.ProcessEnv = process.env): 'env' | 'login' | 'unknown' {
  if (env[PROVIDER_KEY_ENV]) return 'env';
  try {
    if (existsSync(join(homedir(), PROVIDER_LOGIN_DIR))) return 'login';
  } catch {
    // fall through
  }
  return 'unknown';
}

/** Map a raw provider error string onto the neutral code. String matching is heuristic — the messages are
 *  the SDK's own (extracted from its bundle); unknown shapes return undefined (the UI shows the raw text). */
export function classifyProviderError(message: string): ProviderErrorCode | undefined {
  const m = message.toLowerCase();
  if (m.includes('could not resolve authentication') || m.includes('api key') && m.includes('required')) return 'auth_missing';
  if (m.includes('authentication') || m.includes('credentials') || m.includes('401') || m.includes('unauthorized')) return 'auth_failed';
  if (m.includes('timed out') || m.includes('timeout') || m.includes('did not complete within')) return 'timeout';
  if (m.includes('executable not found') || m.includes('claude code executable')) return 'executable_missing';
  return undefined;
}

/** Full provider check (WO-0025): pre-spawn the provider subprocess and complete the initialize handshake
 *  WITHOUT sending a prompt — zero tokens — then close. Reports the auth source on success; classifies the
 *  throw on failure. Used by the settings "Test" button and `docket doctor --verify`. */
export async function checkProvider(env?: Record<string, string>): Promise<ProviderStatus> {
  try {
    const warm = await startup({
      options: {
        cwd: process.cwd(),
        // Same replace-semantics as runDrive: compose over process.env.
        ...(env ? { env: { ...process.env, ...env } } : {}),
      },
    });
    let source = 'handshake';
    try {
      const acc = await (warm as unknown as { accountInfo?: () => Promise<{ tokenSource?: string; apiKeySource?: string }> }).accountInfo?.();
      if (acc?.tokenSource ?? acc?.apiKeySource) source = String(acc?.tokenSource ?? acc?.apiKeySource);
    } catch {
      // accountInfo may not exist on a bare warm handle — the handshake itself succeeding is the check.
    }
    await warm.close();
    return { ok: true, source };
  } catch (e) {
    const message = (e as Error)?.message ?? String(e);
    return { ok: false, code: classifyProviderError(message) ?? 'auth_missing', message };
  }
}
