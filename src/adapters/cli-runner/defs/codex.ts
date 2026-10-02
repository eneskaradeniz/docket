// src/adapters/cli-runner/defs/codex.ts — the Codex CLI vendor definition (WO-0106 / Faz C,
// issue #107). EVERY Codex vocabulary item lives here (ADR-0006's adapter carve-out); the
// engine (../index.ts) stays vendor-blind.
//
// Provenance, per line: the spawn grammar (`exec --json --skip-git-repo-check -C <cwd> -s
// <sandbox> -`, prompt on stdin; `exec resume --json [-m] <thread-id> -`) and the auth probe's
// logged-out arm are MEASURED (docs/probes/codex-cli/raw/exec-unauth.log, codex-cli 0.157.0);
// the event/item mapping follows the vendor's own SDK types (sdk/typescript/src/events.ts +
// items.ts — the union the binary itself emits). The authenticated arms (live usage numbers,
// real item payloads, the SIGINT close shape) were UNMEASURABLE on this machine (no codex
// login) — findings.md names them, probe.mjs measures them in one command.
//
// THE WIRING GATE: CODEX_PROBE_PASSED is the probe's verdict. false = the composition root
// does NOT register this vendor (a route naming it refuses with vendorRefusal; the settings
// surface lists it under «henüz değil»). Flip to true only with findings.md's PASS in hand.
import type { ProviderErrorCode, RunnerEvent } from '../../../core/runner';
import type { SessionRole } from '../../../core/types';
import type { CliParseState, CliRunnerDef } from '../def';
import { decodeJsonLine } from '../def';

/** The probe verdict — flip to true only after docs/probes/codex-cli/probe.mjs prints PASS. */
export const CODEX_PROBE_PASSED = false;

/** Cross-line state: the last agent message becomes the turn's result (the SDK's result rule). */
interface CodexState extends CliParseState {
  lastAgentMessage?: string;
}

// The fence-equivalent (findings.md's NAMED residual): exec mode has no approval callback, so
// the SANDBOX enforces the write scope — coarser than ADR-0002's per-role fence (a
// workspace-write sandbox cannot distinguish the decision store from the repo; the architect's
// row is exactly that residual, ruled acceptable pending the operator's probe-informed call).
const SANDBOX_FOR: Record<SessionRole, string> = {
  verifier: 'read-only',
  implementer: 'workspace-write',
  architect: 'workspace-write',
};

/** The turn's honest cost: codex reports TOKENS + the cache split on turn.completed — never a
 *  price. Tokens carry verbatim; usd stays 0-with-real-tokens (the ledger's hasUnknown arm;
 *  never an invented price, WO-0026/TD-030). */
interface CodexCost {
  cost: { usd: number; tokensIn: number; tokensOut: number };
  usage?: { cacheRead: number; cacheCreation: number };
}

function usageOf(u: Record<string, unknown>): CodexCost {
  const num = (v: unknown): number => (typeof v === 'number' && Number.isFinite(v) ? v : 0);
  const cacheRead = num(u.cached_input_tokens);
  const cacheCreation = num(u.cache_write_input_tokens);
  return {
    cost: { usd: 0, tokensIn: num(u.input_tokens), tokensOut: num(u.output_tokens) },
    ...(cacheRead > 0 || cacheCreation > 0 ? { usage: { cacheRead, cacheCreation } } : {}),
  };
}

function itemToEvents(item: Record<string, unknown>, state: CodexState): RunnerEvent[] {
  const id = typeof item.id === 'string' ? item.id : '';
  const status = typeof item.status === 'string' ? item.status : 'completed';
  switch (item.type) {
    case 'agent_message': {
      // the final agent message is also the turn's RESULT (remembered for turn.completed)
      const text = typeof item.text === 'string' ? item.text : '';
      if (text !== '') state.lastAgentMessage = text;
      return text !== '' ? [{ kind: 'assistant_text', text }] : [];
    }
    case 'command_execution': {
      // exec surfaces work POST-HOC — command + output arrive together (findings.md), so the
      // pair emits at once: the use names the call, the result carries what happened.
      const command = typeof item.command === 'string' ? item.command : '';
      const output = typeof item.aggregated_output === 'string' ? item.aggregated_output.slice(0, 200) : '';
      return [
        { kind: 'tool_use', callId: id, tool: 'command_execution', input: { command } },
        { kind: 'tool_result', callId: id, summary: output, isError: status === 'failed' },
      ];
    }
    case 'file_change': {
      const changes = Array.isArray(item.changes) ? item.changes : [];
      const summary = changes
        .map((c) => (c && typeof c === 'object' ? `${String((c as { kind?: unknown }).kind ?? '?')} ${String((c as { path?: unknown }).path ?? '')}` : ''))
        .join(', ')
        .slice(0, 200);
      return [
        { kind: 'tool_use', callId: id, tool: 'file_change', input: { changes } },
        { kind: 'tool_result', callId: id, summary, isError: status === 'failed' },
      ];
    }
    case 'mcp_tool_call': {
      const server = typeof item.server === 'string' ? item.server : 'mcp';
      const tool = typeof item.tool === 'string' ? item.tool : 'tool';
      const name = `${server}/${tool}`;
      const failed = status === 'failed' || (item.error && typeof (item.error as { message?: unknown }).message === 'string');
      const summary = failed
        ? String((item.error as { message?: unknown } | undefined)?.message ?? '')
        : typeof item.result === 'object' && item.result !== null
          ? JSON.stringify((item.result as { content?: unknown }).content ?? item.result).slice(0, 200)
          : '';
      return [
        { kind: 'tool_use', callId: id, tool: name, input: (item.arguments as Record<string, unknown>) ?? {} },
        { kind: 'tool_result', callId: id, summary, isError: status === 'failed' },
      ];
    }
    default:
      // reasoning / web_search / todo_list / the non-fatal error item: present in the stream,
      // deliberately unmapped in v1 (no product surface consumes them; nothing fabricated).
      return [];
  }
}

export const codexDef: CliRunnerDef = {
  id: 'codex',
  displayName: 'Codex',
  bin: 'codex',
  // Resume carries --json and -m but NOT -C/-s (measured against the flag surface; the thread's
  // own cwd and sandbox stand).
  buildArgs: (input) => {
    if (input.resume !== undefined) {
      return ['exec', 'resume', '--json', ...(input.model !== undefined ? ['--model', input.model] : []), input.resume, '-'];
    }
    return [
      'exec',
      '--json',
      '--skip-git-repo-check',
      '-C',
      input.cwd,
      '-s',
      SANDBOX_FOR[input.role],
      ...(input.model !== undefined ? ['--model', input.model] : []),
      '-',
    ];
  },
  promptViaStdin: true,
  parseLine: (line: string, state: CliParseState): RunnerEvent[] => {
    const cs = state as CodexState;
    const m = decodeJsonLine(line);
    if (m === undefined) return [];
    switch (m.type) {
      case 'thread.started': {
        if (typeof m.thread_id !== 'string' || m.thread_id === '') return [];
        cs.sessionId = m.thread_id;
        return [{ kind: 'started', sessionId: m.thread_id }];
      }
      case 'item.completed':
        return m.item && typeof m.item === 'object' ? itemToEvents(m.item as Record<string, unknown>, cs) : [];
      case 'turn.completed': {
        const { cost, usage } = usageOf((m.usage as Record<string, unknown>) ?? {});
        return [
          {
            kind: 'turn_complete',
            stopReason: 'end',
            cost,
            ...(usage !== undefined ? { usage } : {}),
            ...(cs.lastAgentMessage !== undefined ? { result: cs.lastAgentMessage } : {}),
          },
        ];
      }
      case 'turn.failed': {
        const message =
          m.error && typeof (m.error as { message?: unknown }).message === 'string'
            ? (m.error as { message: string }).message
            : 'turn failed';
        return [{ kind: 'error', message }];
      }
      default:
        // `error` (the reconnect noise), `turn.started`, `item.started`: transient or
        // progress-only — the terminal turn.failed / turn.completed / the engine's exit rules
        // carry the truth; emitting the noise would flash the fail card on every retry.
        return [];
    }
  },
  classifyError: (raw: string): ProviderErrorCode | undefined => {
    const m = raw.toLowerCase();
    if (m.includes('not logged in')) return 'auth_missing';
    if (m.includes('401') || m.includes('unauthorized')) return 'auth_failed';
    if (m.includes('429') || m.includes('rate limit') || m.includes('usage limit') || m.includes('quota')) return 'rate_limited';
    if (m.includes('timed out') || m.includes('timeout')) return 'timeout';
    return undefined;
  },
  // No preset model ids claimed: none are verified on this machine — the picker shows Default
  // only until the authenticated probe (or the operator) names real ones. An honest empty.
  modelOptions: undefined,
  versionArgs: ['--version'],
  authProbe: {
    args: ['login', 'status'],
    parse: (stdout: string): ReturnType<NonNullable<CliRunnerDef['authProbe']>['parse']> => {
      if (/not logged in/i.test(stdout)) return { ok: false, code: 'auth_missing', message: 'codex: not logged in' };
      const mode = /logged in using\s+(\S+)/i.exec(stdout)?.[1];
      if (mode !== undefined) return { ok: true, source: mode };
      return undefined; // an unrecognized shape → the engine's honest "installed, unknown"
    },
  },
};
