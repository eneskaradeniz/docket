// mcp/agy-ask.ts — the permission-ask child the agy PreToolUse launcher execs (I-108, P-64). It
// reads the run's `.agents/.docket-ask.json`, runs the user's before_tool hook commands one by
// one with the SDK delivery's stdin shape (`tool_name`, `tool_input`, the CLI's tool names
// mapped), and only then asks the app over the mcp.sock line protocol — the one place a tool
// call may turn into auto_approve. Every failure fails closed to a deny; without a permission
// channel the script is neutral (`allow`), never auto_approve. The process side is a thin entry
// in electron/; everything with behaviour lives here, which imports no Electron.
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import type { Readable, Writable } from 'node:stream';

import { createSocketCaller } from './ipc';
import type { McpToolOutcome } from './server';

/** Where the delivery puts the run's ask configuration, inside the run's `.agents/` tree. */
export const AGY_ASK_FILE = '.docket-ask.json';

/** The pseudo-tool the listener's handler answers; the app-side bridge is a later issue. */
export const AGY_PERMISSION_ASK_TOOL = 'agy_permission_ask';

/** `<configDir>/.agents/.docket-ask.json` — written 0600 by the delivery, read here. */
export interface AgyAskFile {
  readonly socketPath: string;
  readonly token: string;
  readonly timeoutSeconds: number;
  readonly beforeTool: readonly string[];
  readonly bridge: boolean;
}

/** The decision line the script prints: exactly the keys agy's PreToolUse reads. */
export type AgyAskDecision =
  | { readonly decision: 'auto_approve' }
  | { readonly decision: 'allow' }
  | { readonly decision: 'deny'; readonly reason: string };

/** The one decision every unreachable/broken channel collapses to (fail closed). */
export const UNREACHABLE: AgyAskDecision = { decision: 'deny', reason: 'docket unreachable' };

/** What a hook child must expose; node's ChildProcess satisfies this structurally. */
export interface AgyHookChild {
  readonly stdin: Writable | null;
  readonly stderr: Readable | null;
  once(event: 'close', listener: (code: number | null, signal: NodeJS.Signals | null) => void): unknown;
  once(event: 'error', listener: (error: Error) => void): unknown;
}

/** The spawn seam for the user's hook commands (the entry registers it; tests may stub it). */
export type AgyHookSpawn = (
  command: string,
  args: readonly string[],
  options: { readonly env?: Readonly<Record<string, string>> },
) => AgyHookChild;

/** agy's own tool call as its hook stdin carries it (probe #1015, spike-agy3): the keys the
 * mapping reads; everything else on the line is ignored. */
export interface AgyToolCallStdin {
  readonly conversationId?: unknown;
  readonly toolCall?: { readonly name?: unknown; readonly args?: unknown };
}

const WRITE_TOOLS: ReadonlySet<string> = new Set([
  'write_to_file',
  'replace_file_content',
  'multi_replace_file_content',
  'sed_file',
  'notebook_edit',
]);

/** The verdict tool as the MCP server prefix spells it in the name this mapping builds — the same
 *  name the SDK route's ask carries, so one reading serves both. */
const DOCKET_VERDICT_TOOL = 'mcp__docket-pages__submit_verdict';

const rawArgsOf = (args: unknown): Readonly<Record<string, unknown>> =>
  typeof args === 'object' && args !== null && !Array.isArray(args) ? (args as Record<string, unknown>) : {};

/** The hook stdin and the ask args as Docket's tool language sees the call: the mapped name plus
 * the one identifying string when the mapping has one, else the raw name and args (P-64). */
export function mapAgyToolCall(name: unknown, args: unknown): { readonly toolName: string; readonly toolInput: Readonly<Record<string, unknown>>; readonly target?: string } {
  if (typeof name !== 'string') return { toolName: '', toolInput: {} };
  const raw = rawArgsOf(args);
  if (name === 'run_command' && typeof raw['CommandLine'] === 'string') {
    return { toolName: 'Bash', toolInput: { command: raw['CommandLine'] }, target: raw['CommandLine'] };
  }
  if (WRITE_TOOLS.has(name) && typeof raw['TargetFile'] === 'string') {
    return { toolName: 'Write', toolInput: { file_path: raw['TargetFile'] }, target: raw['TargetFile'] };
  }
  if (name === 'view_file' && typeof raw['AbsolutePath'] === 'string') {
    return { toolName: 'Read', toolInput: { file_path: raw['AbsolutePath'] }, target: raw['AbsolutePath'] };
  }
  // An MCP call keeps the spelled-out server and tool in the name Docket's risk table reads, with
  // NO target: the table has no argument key for it, so the ask stays with the human.
  if (name === 'call_mcp_tool' && typeof raw['ServerName'] === 'string' && typeof raw['ToolName'] === 'string') {
    return { toolName: `mcp__${raw['ServerName']}__${raw['ToolName']}`, toolInput: raw };
  }
  return { toolName: name, toolInput: raw };
}

const asRecord = (value: unknown): Readonly<Record<string, unknown>> | undefined => {
  if (typeof value === 'string') {
    try {
      return asRecord(JSON.parse(value));
    } catch {
      return undefined;
    }
  }
  return typeof value === 'object' && value !== null && !Array.isArray(value) ? (value as Record<string, unknown>) : undefined;
};

/** The verdict tool's own arguments inside agy's MCP call: the CLI nests them under a key of the
 *  call's args (as an object or as JSON text), and the mapping does not hard-code which one — it
 *  takes the first value, or the args themselves, that carries a `verdict`. Only the three fields
 *  the card reads travel on; anything else in the call stays here. Nothing found → undefined, and
 *  the ask is sent without it. */
export function verdictInputOf(toolInput: Readonly<Record<string, unknown>>): Readonly<Record<string, unknown>> | undefined {
  for (const candidate of [toolInput, ...Object.values(toolInput).map(asRecord)]) {
    if (candidate !== undefined && typeof candidate['verdict'] === 'string') {
      return { verdict: candidate['verdict'], summary: candidate['summary'], pointers: candidate['pointers'] };
    }
  }
  return undefined;
}

const readAgyAskFile = async (configDir: string): Promise<AgyAskFile | undefined> => {
  let text: string;
  try {
    text = await readFile(join(configDir, '.agents', AGY_ASK_FILE), 'utf8');
  } catch {
    return undefined;
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    return undefined;
  }
  if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) return undefined;
  const record = parsed as Record<string, unknown>;
  if (
    typeof record['socketPath'] !== 'string' ||
    typeof record['token'] !== 'string' ||
    typeof record['timeoutSeconds'] !== 'number' ||
    !Number.isFinite(record['timeoutSeconds']) ||
    record['timeoutSeconds'] <= 0 ||
    typeof record['bridge'] !== 'boolean' ||
    !Array.isArray(record['beforeTool']) ||
    record['beforeTool'].some((command) => typeof command !== 'string')
  ) {
    return undefined;
  }
  return {
    socketPath: record['socketPath'],
    token: record['token'],
    timeoutSeconds: record['timeoutSeconds'],
    beforeTool: record['beforeTool'] as readonly string[],
    bridge: record['bridge'],
  };
};

/** One user hook command through a shell, fed the translated stdin; exit code 2 is the only
 * blocker (Docket's hook convention), and a child that could not run at all does not block. */
const runHook = (spawnHook: AgyHookSpawn, command: string, stdinText: string): Promise<{ code: number | null; stderr: string }> =>
  new Promise((resolve) => {
    let child: AgyHookChild;
    try {
      child = spawnHook('/bin/sh', ['-c', command], {});
    } catch {
      resolve({ code: null, stderr: '' });
      return;
    }
    const chunks: Buffer[] = [];
    if (child.stderr !== null) {
      child.stderr.on('data', (chunk: Buffer) => chunks.push(Buffer.from(chunk)));
      child.stderr.on('error', () => undefined);
    }
    if (child.stdin !== null) {
      child.stdin.on('error', () => undefined);
      child.stdin.end(`${stdinText}\n`);
    }
    child.once('error', () => resolve({ code: null, stderr: Buffer.concat(chunks).toString('utf8') }));
    child.once('close', (code) => resolve({ code, stderr: Buffer.concat(chunks).toString('utf8') }));
  });

/** A stderr text as the deny reason: trimmed, and bounded so a noisy hook cannot flood the stream. */
const reasonOf = (stderr: string): string => {
  const trimmed = stderr.trim();
  if (trimmed.length === 0) return 'denied by a before_tool hook';
  return trimmed.length > 2000 ? `${trimmed.slice(0, 2000)}…` : trimmed;
};

/** The reply the app must send for an allow: `{decision: 'allow'}` (a deny carries a reason). */
const asDecision = (result: unknown): 'allow' | { decision: 'deny'; reason: string } | undefined => {
  if (typeof result !== 'object' || result === null || Array.isArray(result)) return undefined;
  const record = result as Record<string, unknown>;
  if (record['decision'] === 'allow') return 'allow';
  if (record['decision'] === 'deny') {
    const reason = typeof record['reason'] === 'string' && record['reason'].length > 0 ? record['reason'] : 'denied by Docket';
    return { decision: 'deny', reason };
  }
  return undefined;
};

export interface AgyAskRunInput {
  /** The run's config directory (the launcher's second argument). */
  readonly configDir: string;
  /** The whole PreToolUse stdin, read to EOF by the caller. */
  readonly stdinText: string;
  /** Prints the one decision line (the child's stdout). */
  readonly write: (line: string) => void;
  readonly spawnHook: AgyHookSpawn;
}

/** Runs the ask child for one tool call and prints exactly one decision line. Never throws: every
 * failure is a deny, so the caller cannot fall back to a neutral silence. */
export async function runAgyAsk(input: AgyAskRunInput): Promise<void> {
  const decision = await decide(input).catch(() => UNREACHABLE);
  input.write(`${JSON.stringify(decision)}\n`);
}

const decide = async (input: AgyAskRunInput): Promise<AgyAskDecision> => {
  const file = await readAgyAskFile(input.configDir);
  if (file === undefined) return { decision: 'deny', reason: 'docket ask configuration unreadable' };

  let parsed: unknown;
  try {
    parsed = JSON.parse(input.stdinText);
  } catch {
    parsed = undefined;
  }
  const call = typeof parsed === 'object' && parsed !== null ? (parsed as AgyToolCallStdin) : undefined;
  const mapped = mapAgyToolCall(call?.toolCall?.name, call?.toolCall?.args);
  const conversationId = typeof call?.conversationId === 'string' ? call.conversationId : undefined;
  // The user hooks see the SDK delivery's stdin shape — translated only here (P-64): agy's own
  // hooks keep agy's shape, and an untranslatable line reaches the hooks raw.
  const hookStdin =
    mapped.toolName !== ''
      ? JSON.stringify({ tool_name: mapped.toolName, tool_input: mapped.toolInput })
      : input.stdinText;

  for (const command of file.beforeTool) {
    const outcome = await runHook(input.spawnHook, command, hookStdin);
    if (outcome.code === 2) return { decision: 'deny', reason: reasonOf(outcome.stderr) };
  }
  if (mapped.toolName === '') return { decision: 'deny', reason: 'agy tool call unreadable' };

  if (!file.bridge) return { decision: 'allow' };

  const ask = createSocketCaller({ socketPath: file.socketPath, token: file.token, timeoutMs: file.timeoutSeconds * 1000 });
  const verdictInput = mapped.toolName === DOCKET_VERDICT_TOOL ? verdictInputOf(mapped.toolInput) : undefined;
  const outcome: McpToolOutcome = await ask(AGY_PERMISSION_ASK_TOOL, {
    tool: mapped.toolName,
    ...(mapped.target === undefined ? {} : { target: mapped.target }),
    ...(verdictInput === undefined ? {} : { verdictInput }),
    ...(conversationId === undefined ? {} : { conversationId }),
  });
  if (!outcome.ok) return UNREACHABLE;
  const decision = asDecision(outcome.result);
  if (decision === 'allow') return { decision: 'auto_approve' };
  if (decision !== undefined) return decision;
  return UNREACHABLE;
};
