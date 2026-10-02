// The ACP connection a control-only caller needs: the run transport's client reduced to spawn,
// line framing, pending requests and teardown. It speaks the same wire as the transport —
// newline-delimited JSON-RPC 2.0 over the agent's stdio, one client identity, the same initialize
// parameters — but runs no turn and sends no prompt, so it maps no session/update; an agent
// request is answered method-not-found exactly as the transport answers one, so no agent is ever
// left waiting. Contract: docs/v2/providers.md → "ACP transport (P-15 … P-17)".
import { spawn as nodeSpawn } from 'node:child_process';
import type { ChildProcess } from 'node:child_process';

import type { Result } from '../../../../domain/index';
import { err, ok } from '../../../../domain/index';

/** The protocol version and the client identity every ACP caller shares — the run transport
 * included, so an agent never sees two different Dockets. */
export const ACP_PROTOCOL_VERSION = 1;
export const ACP_CLIENT_INFO = { name: 'Docket', version: '2' } as const;

/** The initialize request every ACP connection opens its handshake with, in the protocol's own
 * shape. Docket implements none of the optional client methods (filesystem, terminals,
 * elicitation); omitted capabilities are the protocol's way of saying unsupported. */
export const ACP_INITIALIZE_PARAMS = {
  protocolVersion: ACP_PROTOCOL_VERSION,
  clientCapabilities: {},
  clientInfo: ACP_CLIENT_INFO,
} as const;

export type AcpConnectionError = {
  readonly code: 'not_installed' | 'timeout' | 'protocol' | 'closed';
  /** Never carries the agent's own text. */
  readonly message: string;
  /** A protocol error's JSON-RPC code and text, for a caller that must recognise one known
   * answer (a login refusal). It is matched, never displayed or logged. */
  readonly rpc?: { readonly code: number; readonly text: string };
};

/** The narrow spawn surface a connection needs; the real node spawn satisfies it directly. The
 * options carry no lifetime cap: the per-request ceiling and the caller's close bound the child. */
export type AcpSpawn = (
  command: string,
  args: readonly string[],
  options: { readonly env?: Readonly<Record<string, string>>; readonly timeoutMs?: number },
) => ChildProcess;

export interface AcpConnectionConfig {
  readonly command: string;
  readonly args: readonly string[];
  /** The child's environment; a caller that passes none lets the child inherit its own. */
  readonly env?: Readonly<Record<string, string>>;
  /** Ceiling per request; the default leaves a slow CLI an order of magnitude more than a
   * control round-trip needs. */
  readonly timeoutMs?: number;
  readonly spawn?: AcpSpawn;
}

export interface AcpConnection {
  /** One JSON-RPC request over the open connection; the answer is the raw `result` value. */
  request(method: string, params?: Readonly<Record<string, unknown>>): Promise<Result<unknown, AcpConnectionError>>;
  /** Tears the process down and settles every pending request; safe to call more than once. */
  close(): void;
}

const DEFAULT_TIMEOUT_MS = 15_000;
const METHOD_NOT_FOUND = -32601;

export const isRecord = (value: unknown): value is Readonly<Record<string, unknown>> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

/** The strings an RPC error carries: its message plus the string values of a `data` object, where
 * some agents put the human-readable detail. */
const rpcErrorText = (error: Readonly<Record<string, unknown>>): string => {
  const parts: string[] = [];
  if (typeof error['message'] === 'string') parts.push(error['message']);
  const data = error['data'];
  if (typeof data === 'string') parts.push(data);
  else if (isRecord(data)) {
    for (const value of Object.values(data)) if (typeof value === 'string') parts.push(value);
  }
  return parts.join('\n');
};

interface Pending {
  settle(result: Result<unknown, AcpConnectionError>): void;
  timer: ReturnType<typeof setTimeout>;
}

export function openAcpConnection(config: AcpConnectionConfig): Result<AcpConnection, AcpConnectionError> {
  const runSpawn = config.spawn ?? nodeSpawn;
  let child: ChildProcess;
  try {
    child = runSpawn(config.command, [...config.args], {
      ...(config.env === undefined ? {} : { env: { ...config.env } }),
    });
  } catch {
    return err({ code: 'not_installed', message: 'the agent process could not be started' });
  }
  if (child.stdin === null || child.stdout === null) {
    child.kill();
    return err({ code: 'not_installed', message: 'the agent process could not be started with pipes' });
  }
  const stdin = child.stdin;
  const stdout = child.stdout;
  // Drained and discarded: stderr is agent logging and may quote environment values.
  child.stderr?.resume();
  // Writing to a dead agent's stdin (a late answer, a concurrent close) must not crash the caller.
  stdin.on('error', () => settleAll({ code: 'closed', message: 'the agent connection closed' }));

  const pending = new Map<number, Pending>();
  let remainder = '';
  let closed = false;
  let nextRequestId = 0;

  const settleAll = (error: AcpConnectionError): void => {
    if (closed) return;
    closed = true;
    for (const entry of pending.values()) {
      clearTimeout(entry.timer);
      entry.settle(err(error));
    }
    pending.clear();
  };

  // The transport spawns its own detached child, so its group kill suffices there; an injected
  // spawn may not be detached, in which case the group address does not exist and the child
  // itself takes the signal.
  const killGroup = (): void => {
    if (child.pid === undefined || process.platform === 'win32') {
      child.kill('SIGTERM');
      return;
    }
    try {
      process.kill(-child.pid, 'SIGTERM');
    } catch {
      child.kill('SIGTERM');
    }
  };

  const writeMessage = (message: unknown): void => {
    if (closed) return;
    stdin.write(`${JSON.stringify(message)}\n`);
  };

  const handleLine = (line: string): void => {
    if (closed || line === '') return;
    let parsed: unknown;
    try {
      parsed = JSON.parse(line);
    } catch {
      // The wire is JSON lines; a malformed line cannot be attributed to any request and is
      // dropped rather than fatal.
      return;
    }
    if (!isRecord(parsed)) return;
    const method = parsed['method'];
    if (typeof method === 'string') {
      // The protocol lets the agent call further client methods; this client advertises none of
      // them, so the honest answer is method-not-found — the agent is never left waiting.
      if (typeof parsed['id'] === 'number') {
        writeMessage({ jsonrpc: '2.0', id: parsed['id'], error: { code: METHOD_NOT_FOUND, message: `method "${method}" is not available` } });
      }
      return; // notifications (session/update among them) are ignored: no turn ever runs here
    }
    const id = parsed['id'];
    if (typeof id !== 'number') return; // responses carry this client's numeric ids
    const entry = pending.get(id);
    if (entry === undefined) return; // unknown or already settled: ignored
    pending.delete(id);
    clearTimeout(entry.timer);
    const rpcError = parsed['error'];
    if (isRecord(rpcError)) {
      // The agent's own error text is not relayed: it may quote environment values.
      const code = rpcError['code'];
      entry.settle(
        err({
          code: 'protocol',
          message: 'the agent answered with an RPC error',
          ...(typeof code === 'number' ? { rpc: { code, text: rpcErrorText(rpcError) } } : {}),
        }),
      );
      return;
    }
    entry.settle(ok(parsed['result']));
  };

  stdout.setEncoding('utf8');
  stdout.on('data', (chunk: string) => {
    const lines = (remainder + chunk).split('\n');
    remainder = lines.pop() ?? '';
    for (const line of lines) handleLine(line.endsWith('\r') ? line.slice(0, -1) : line);
  });

  child.on('error', () => settleAll({ code: 'not_installed', message: 'the agent process could not be started' }));
  child.on('close', () => settleAll({ code: 'closed', message: 'the agent connection closed' }));

  return ok({
    request: (method, params) =>
      new Promise<Result<unknown, AcpConnectionError>>((resolve) => {
        if (closed) {
          resolve(err({ code: 'closed', message: 'the agent connection is closed' }));
          return;
        }
        nextRequestId += 1;
        const id = nextRequestId;
        const timer = setTimeout(() => {
          pending.delete(id);
          resolve(err({ code: 'timeout', message: 'the agent request did not answer in time' }));
        }, config.timeoutMs ?? DEFAULT_TIMEOUT_MS);
        pending.set(id, { settle: resolve, timer });
        writeMessage({ jsonrpc: '2.0', id, method, ...(params === undefined ? {} : { params }) });
      }),
    close: (): void => {
      settleAll({ code: 'closed', message: 'the agent connection is closed' });
      killGroup();
    },
  });
}
