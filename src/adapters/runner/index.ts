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
import { randomUUID } from 'node:crypto';
import { query, startup } from '@anthropic-ai/claude-agent-sdk';
import type {
  CanUseTool,
  Options,
  PermissionMode,
  PermissionResult,
  Query,
  SDKUserMessage,
} from '@anthropic-ai/claude-agent-sdk';

// WO-0045: the runtime exposes Query.cancelAsyncMessage(uuid) (returns the receipt's `cancelled`
// boolean, verified live — docs/probes/cc-surface/raw/s5-cancel.log) but sdk.d.ts (0.3.221) does not
// declare it. Augment rather than cast at the call site; TD-016 re-verifies on every SDK bump.
declare module '@anthropic-ai/claude-agent-sdk' {
  interface Query {
    cancelAsyncMessage(uuid: string): Promise<boolean>;
  }
}
import type { PermissionAsk, ProviderErrorCode } from '../../core/runner';
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

// --- Async push-queue: lets canUseTool push events into the drive() stream. Also the STEER INPUT
//     channel (WO-0045): passed to query() as the AsyncIterable prompt. The iterable SELF must go to
//     query() — a bare {next} iterator kills the child at once (probe raw/s1-baseline.log, first run). ---
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
  [Symbol.asyncIterator](): AsyncIterator<T> {
    return { next: () => this.next() };
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
  // WO-0045: command lifecycle (capability msg_lifecycle_v1) — the delivery observability channel.
  command_uuid?: string;
  state?: string;
  capabilities?: string[];
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

/** Sum two cost figures (the drive accumulator). */
export function addCost(a: CostSummary, b: CostSummary): CostSummary {
  return { usd: a.usd + b.usd, tokensIn: a.tokensIn + b.tokensIn, tokensOut: a.tokensOut + b.tokensOut };
}

/** WO-0046 (probe findings §C, raw/c2.log + raw/s2b-late-note.log; review f2): fold one result's
 *  cost figures against the drive's running usd baseline. The two axes carry DIFFERENT measured
 *  semantics. usd is CUMULATIVE within one SDK query process (s2b: 0.1766 → 0.2059; the diff is
 *  the note command's own spend) and RESETS at the resume boundary (c2: leg 1 ended 0.0948; the
 *  resumed leg's first result reported 0.0562 — the leg's own spend, NOT the session total), so
 *  the per-drive baseline starts at zero every leg, the difference is the leg's delta, and the
 *  store's `prior + input` add-rule lands the true session total (no double-count). A usd figure
 *  BELOW the baseline is read as a per-command figure (§S/s2's defensive branch) and taken whole;
 *  the baseline ratchets to the max either way. usage TOKENS are PER-RESULT, never cumulative
 *  (s2b: result#1 27802/50, result#2 44/158 — result#2's input is a cache-hit call's uncached
 *  part, not a process total), so they sum plainly with no guard. Pinned by
 *  src/adapters/runner/index.test.ts against the raw numbers. */
export function applyResultCost(baselineUsd: number, reported: CostSummary): { baselineUsd: number; delta: CostSummary } {
  const usd = reported.usd >= baselineUsd ? reported.usd - baselineUsd : reported.usd;
  return {
    baselineUsd: Math.max(baselineUsd, reported.usd),
    delta: { usd, tokensIn: reported.tokensIn, tokensOut: reported.tokensOut },
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
  // The ask's surfaced details, keyed like `pending` (WO-0027): `pendingAsks()` reads this so a remounted
  // pane can re-render its cards (Bulgu 9) — the resolvers in `pending` are still held and still answerable.
  const askDetails = new Map<string, PermissionAsk>();
  let currentQueue: AsyncQueue<RunnerEvent> | undefined;
  let currentAbort: AbortController | undefined;
  // WO-0045 steering state (per-drive; cleared in runDrive's finally):
  let currentInput: AsyncQueue<SDKUserMessage> | undefined; // the query's push-side input channel
  let currentQuery: Query | undefined; // retained for cancelAsyncMessage (retract)
  let inputClosed = false; // steer() refuses once the final result closed the channel
  let lifecycleSupported = false; // msg_lifecycle_v1 on system/init — without it delivery is unobservable
  // noteId ↔ uuid: the uuid is ours (client-stamped — only uuid-stamped messages appear in receipts
  // and are individually cancellable, sdk.d.ts:4639/:3509); it never leaves this adapter.
  const noteByUuid = new Map<string, { noteId: string; text: string }>();
  const noteUuid = new Map<string, string>();
  // WO-0039 stabilization (2026-08-23): an interrupt's INTENT, set the moment interrupt() fires and
  // read by the drive's catch/finally. An abort can surface as a non-AbortError throw or an
  // error-shaped result message — the interrupt's echo, not a provider failure. Swallowing only
  // `name === 'AbortError'` let that echo through as an error event → the fold landed in 'error' →
  // the fail card said "Oturum çöktü" for an intentional Durdur. Cleared at each drive start.
  let interruptRequested = false;

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
    // WO-0051 / D9 (TD-056): the composition root also fills the workspace's ABSOLUTE structure
    // root — the write fence then lands exactly on docs_root:<wsId> instead of the cwd-relative
    // default. Undefined (CLI, tests) keeps the fallback byte-for-byte.
    const roots: ScopeRoots = { repoRoot: cwd, decisionStore: input.decisionStoreRoot ?? resolve(cwd, DECISION_STORE_DIR) };
    const scope = writeScopeFor(input.role, roots);
    let planReadyEmitted = false;
    let turnCompleteEmitted = false; // tracked to synthesise a turn_complete if the plan-mode stream ends without one (WO-0021)
    const abort = new AbortController();
    currentQueue = queue;
    currentAbort = abort;
    interruptRequested = false;
    // WO-0045: the drive runs in STREAMING-INPUT mode — the prompt is a push-side iterable the
    // steer() entry writes uuid-stamped notes into. Kept OPEN for the drive's life: completing the
    // iterable ends the input side, and with it the query (probe raw/s1-baseline.log) — the close
    // happens at the FINAL result (and is safe at any point: it never kills in-flight work).
    const inputQueue = new AsyncQueue<SDKUserMessage>();
    currentInput = inputQueue;
    currentQuery = undefined;
    inputClosed = false;
    lifecycleSupported = false;
    noteByUuid.clear();
    noteUuid.clear();
    inputQueue.push({
      type: 'user',
      message: { role: 'user', content: input.prompt },
      parent_tool_use_id: null,
      uuid: randomUUID(),
    });
    // 2026-08-23 (same-day correction): the 5s plan-exit grace abort is DEAD — the hang it
    // guarded was the AUTO-APPROVED plan gate (see canUseTool); with the gate denied the SDK
    // ends the turn on its own and the result (cost included) arrives naturally. Aborting was
    // also what LOST the cost: total_cost_usd rides the result message only, and a mid-turn
    // abort throws before it. The synthesized close below survives as the ABORT safety net
    // (an operator Durdur mid-plan) with honest zeros (a no-claim, WO-0026/TD-030).

    const canUseTool: CanUseTool = (toolName, toolInput, o) =>
      new Promise<PermissionResult>((settle) => {
        // 2026-08-23 (maliyet kaybı, PROVEN via SDK probes 3+4): the ExitPlanMode PLAN GATE must
        // be DENIED, not auto-allowed. Allowing it tells the SDK "the host approved the plan" →
        // the model starts CODING → the turn never ends → the result message (the SDK's ONLY
        // cost carrier) never arrives → $0.00 sessions. Denying it with this message ends the
        // turn naturally: result + cost arrive, the stream closes on its own — no grace abort.
        // The plan itself is unaffected: plan_ready fires from the tool_use (before this gate),
        // and the operator's REAL approval is Docket's own gate (approvePlan).
        if (toolName === 'ExitPlanMode' && isPlanDrive) {
          // Reviewer round (2026-08-24): the in-the-wild parenthetical is gone — it spent tokens
          // putting the exact artifact the agent must NOT investigate into its head (the incident
          // trail stays in WO-0039's order.md, where humans read it).
          return settle({
            behavior: 'deny',
            message:
              'Plan submitted. STOP: end your turn now with no further tool calls. Do not investigate approval status, do not resubmit — the operator reviews the plan in Docket.',
          });
        }
        const attempt = classifyAttempt(toolName, toolInput, cwd);
        const verdict = fenceDecision(scope, attempt);
        if (verdict === 'allow') return settle({ behavior: 'allow' });
        if (verdict === 'deny') {
          return settle({ behavior: 'deny', message: `fence: ${input.role} may not write there (ADR-0002)` });
        }
        // 'ask' — surface to the operator and hold until decide().
        const requestId = o.requestId;
        pending.set(requestId, settle);
        askDetails.set(requestId, { requestId, tool: toolName, input: toolInput, title: o.title, reason: o.decisionReason });
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
          if (msg.subtype === 'init' && msg.session_id) {
            lifecycleSupported = (msg.capabilities ?? []).includes('msg_lifecycle_v1');
            out.push({ kind: 'started', sessionId: msg.session_id, at: new Date().toISOString() });
          }
          break;
        case 'command_lifecycle': {
          // WO-0045 delivery: OUR uuid entering execution (state 'started') is the note's application
          // moment — notes never echo as user messages (probe raw/s2-midturn-note.log), this is the
          // only observability. 'completed' adds nothing (delivery fired at started); 'cancelled' is
          // the retract receipt — the steer_retracted event rides the retractSteer call instead.
          const note = msg.command_uuid !== undefined ? noteByUuid.get(msg.command_uuid) : undefined;
          if (note && msg.state === 'started') {
            noteByUuid.delete(msg.command_uuid!);
            noteUuid.delete(note.noteId); // reviewer finding 9: a late retract must find nothing
            out.push({ kind: 'steer_delivered', noteId: note.noteId, text: note.text, at: new Date().toISOString() });
          }
          break;
        }
        case 'assistant': {
          // WO-0046: content events carry the receive-stamp — the fold's liveness anchor.
          const at = new Date().toISOString();
          for (const b of msg.message?.content ?? []) {
            if (b.type === 'text' && b.text) out.push({ kind: 'assistant_text', text: b.text, at });
            if (b.type === 'tool_use') {
              if (b.name === 'ExitPlanMode') {
                planReadyEmitted = true;
                out.push({ kind: 'plan_ready', planText: planTextFromInput(b.input) });
              } else {
                out.push({ kind: 'tool_use', callId: b.id ?? '', tool: b.name ?? '', input: b.input ?? {}, at });
              }
            }
          }
          break;
        }
        case 'user': {
          const at = new Date().toISOString();
          for (const b of msg.message?.content ?? []) {
            if (b.type === 'tool_result') {
              out.push({
                kind: 'tool_result',
                callId: b.tool_use_id ?? '',
                summary: blockSummary(b.content),
                isError: !!b.is_error,
                at,
              });
            }
          }
          break;
        }
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
              ? { kind: 'turn_complete', stopReason: msg.stop_reason ?? 'unknown', cost: costOf(msg), result: msg.result, at: new Date().toISOString() }
              : { kind: 'turn_complete', stopReason: msg.stop_reason ?? 'unknown', cost: costOf(msg), at: new Date().toISOString() },
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

    // WO-0046 cost truth (probe raw/c2.log + raw/s2b-late-note.log, findings §C; review f2):
    // usd is cumulative within one query process and RESETS at resume (per-drive baseline from
    // zero every leg → the diff is the leg's delta; `< baseline → the figure itself` is the
    // per-command defense). usage tokens are PER-RESULT and sum plainly — the shared guard the
    // first cut applied to tokens under-counted cache-busting turns (s2b result#2 44/158).
    // Assistant messages carry all-zero usage; the result is the only cost source (every s-log).
    let costBaselineUsd = 0;
    let driveCost: CostSummary = { usd: 0, tokensIn: 0, tokensOut: 0 };
    let synthDelivered = false;
    // WO-0046 context feed. Fire-and-forget ALWAYS (probe c1: an inline await serialized ~2.3s
    // per read into the stream); one rejection disables the feed for the drive — the pane shows
    // no readout (absent), never a zero. `cost` rides along because D3 folds exactly one terminal
    // turn_complete per drive: this is the live costline's only mid-drive token source.
    let contextFeedLive = true;
    let lastContextEmitAt = 0;
    const emitContext = (throttleMs = 0) => {
      if (!contextFeedLive || !currentQuery) return;
      const now = Date.now();
      if (throttleMs && now - lastContextEmitAt < throttleMs) return;
      lastContextEmitAt = now;
      currentQuery
        .getContextUsage()
        .then((r) => {
          if (!contextFeedLive) return;
          queue.push({
            kind: 'context_usage',
            usedTokens: r.totalTokens,
            maxTokens: r.maxTokens,
            percentage: r.percentage,
            cost: { ...driveCost },
            at: new Date().toISOString(),
          });
        })
        .catch(() => {
          contextFeedLive = false;
        });
    };

    const q = query({ prompt: inputQueue, options });
    currentQuery = q;
    try {
      for await (const msg of q) {
        // WO-0046 liveness (probe raw/c1.log): thinking-token bursts stream while the model
        // produces NO transcript events for potentially minutes — a throttled context read here
        // both refreshes the gauge and proves the drive alive, so the staleness line never lies
        // during a long think.
        if ((msg as AnyMsg).type === 'system' && (msg as AnyMsg).subtype === 'thinking_tokens') emitContext(30_000);
        let sawToolEvent = false;
        for (const e of translate(msg as unknown as AnyMsg)) {
          // The prompt-channel delivery's receipt (D5): the note never entered the SDK queue, so no
          // lifecycle will fire for it — emit the synthetic delivery right after the session opened.
          if (e.kind === 'started' && input.deliveringNote && !synthDelivered) {
            synthDelivered = true;
            queue.push(e);
            queue.push({ kind: 'steer_delivered', noteId: input.deliveringNote.id, text: input.deliveringNote.text, at: new Date().toISOString() });
            continue;
          }
          if (e.kind === 'turn_complete') {
            const { baselineUsd, delta } = applyResultCost(costBaselineUsd, e.cost);
            costBaselineUsd = baselineUsd;
            driveCost = addCost(driveCost, delta);
            // The turn boundary is a refresh point for the gauge; on the TERMINAL boundary the
            // feed flag drops the reading (the drive is over) — this serves the held/intermediate
            // boundaries of a steered drive (D3) and the per-command boundaries of a long one.
            emitContext();
            // D3 (operator ruling 2026-08-26): a queued note extends the drive — its command's result
            // is INTERMEDIATE. One drive, one terminal event: hold this turn_complete while notes are
            // still queued/live; the final result (note queue empty) carries the accumulated cost and
            // its own text as the report, then closes the input channel so the generator ends promptly.
            if (noteByUuid.size > 0) continue;
            turnCompleteEmitted = true;
            contextFeedLive = false;
            queue.push({ ...e, cost: { ...driveCost } });
            inputClosed = true;
            inputQueue.close();
            continue;
          }
          // An error-shaped message after an interrupt request is the abort's echo (e.g. an
          // error_during_execution result), not a provider failure — never surface it (WO-0039
          // stabilization: Durdur must not render the fail card).
          if (interruptRequested && e.kind === 'error') continue;
          queue.push(e);
          if (e.kind === 'tool_use' || e.kind === 'tool_result') sawToolEvent = true;
        }
        // WO-0046 cadence (probe c1): one read per tool-bearing message, never a busy poll.
        if (sawToolEvent) emitContext();
      }
    } catch (e) {
      const err = e as { name?: string; message?: string };
      // An interrupt is intentional — end the stream without an error event. Post-interrupt
      // throws of ANY shape are the abort's echo (the subprocess kill surfaces as more than
      // AbortError), not a provider failure.
      if (err?.name !== 'AbortError' && !interruptRequested) {
        const raw = err?.message ?? String(e);
        queue.push({ kind: 'error', message: raw, ...(classifyProviderError(raw) ? { code: classifyProviderError(raw) } : {}) });
      }
    } finally {
      currentQueue = undefined;
      currentAbort = undefined;
      currentInput = undefined;
      currentQuery = undefined;
      contextFeedLive = false; // a read still in flight lands nowhere (push-after-close is a no-op)
      noteByUuid.clear();
      noteUuid.clear();
      inputQueue.close(); // no-op when the final result already closed it; ends the input side on aborts
      pending.clear();
      askDetails.clear();
      // If a plan-mode turn emitted plan_ready but the SDK ended the stream without a result (an
      // operator Durdur aborting mid-plan — the denied gate ends turns naturally now), synthesise
      // one so the session still closes and the main capture side-effects fire (WO-0021). Cost is
      // honest zeros: total_cost_usd rides the result message only, and an abort throws before it
      // (the honest no-claim, WO-0026/TD-030).
      if (shouldSynthesiseTurnComplete(planReadyEmitted, turnCompleteEmitted)) {
        queue.push({ kind: 'turn_complete', stopReason: PLAN_EXIT_WITHOUT_RESULT, cost: { usd: 0, tokensIn: 0, tokensOut: 0 }, at: new Date().toISOString() });
      } else if (interruptRequested && !turnCompleteEmitted) {
        // WO-0039 stabilization: an intentional interrupt that closed the stream with no
        // turn_complete ends CALM — the `interrupted` event folds to 'stopped' (Durduruldu +
        // ▶ Sürdür), never a stale-'running' fold or the fail card.
        queue.push({ kind: 'interrupted', at: new Date().toISOString() });
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
      askDetails.delete(requestId);
      settle(
        decision.allow
          ? { behavior: 'allow' }
          : { behavior: 'deny', message: decision.reason || 'denied by operator' },
      );
      // WO-0027 / Bulgu 10: with PARALLEL asks nothing else identifies which held ask was answered —
      // emit the explicit resolution so folds/UI remove exactly this one.
      currentQueue?.push({ kind: 'ask_resolved', requestId, at: new Date().toISOString() });
    },
    async pendingAsks(): Promise<PermissionAsk[]> {
      return [...askDetails.values()];
    },
    async interrupt(): Promise<void> {
      interruptRequested = true;
      currentAbort?.abort();
    },
    // WO-0045 — queue a note into the RUNNING drive (boundary-only; never an interrupt). The uuid is
    // stamped HERE (only uuid-stamped messages are individually cancellable and appear in receipts).
    // Refused when no drive runs, the input channel closed (final result already emitted), or the CLI
    // lacks msg_lifecycle_v1 (delivery would be unobservable — steering stays honest-off; TD-016
    // re-probes on SDK bumps). emit:false = the silent Sürdür re-queue (the fold seeded it already).
    async steer(note: string, opts?: { noteId: string; emit?: boolean }): Promise<boolean> {
      if (!currentInput || !currentQuery || inputClosed || !lifecycleSupported) return false;
      const noteId = opts?.noteId ?? `steer-${Date.now()}`;
      const uuid = randomUUID();
      noteByUuid.set(uuid, { noteId, text: note });
      noteUuid.set(noteId, uuid);
      currentInput.push({ type: 'user', message: { role: 'user', content: note }, parent_tool_use_id: null, uuid });
      if (opts?.emit !== false) {
        currentQueue?.push({ kind: 'steer_queued', noteId, note, at: new Date().toISOString() });
      }
      return true;
    },
    // WO-0045 — pull a queued note back (best-effort, probe raw/s5-cancel.log + raw/s5b-cancel-delayed.log:
    // an immediate cancel can race the enqueue and return false; false here means the note WILL run).
    async retractSteer(noteId: string): Promise<boolean> {
      const uuid = noteUuid.get(noteId);
      if (!currentQuery || uuid === undefined) return false;
      let cancelled = false;
      try {
        cancelled = await currentQuery.cancelAsyncMessage(uuid);
      } catch {
        return false;
      }
      if (!cancelled) return false;
      noteByUuid.delete(uuid);
      noteUuid.delete(noteId);
      currentQueue?.push({ kind: 'steer_retracted', noteId, at: new Date().toISOString() });
      return true;
    },
    // WO-0031c abort: no harder mechanism exists on the provider surface — the alias is honest
    // (the GUI's REAL force lives main-side: the pipeline generator's injected return).
    async abort(): Promise<void> {
      await this.interrupt();
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
