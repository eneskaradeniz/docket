// The app-server connection a control-only caller needs: the run transport's JSON-RPC 2.0
// client reduced to spawn, line framing, pending requests and teardown. It speaks the same wire
// as the transport — newline-delimited JSON-RPC over the child's stdio, the same client info,
// the same initialize parameters — but, like the quota probe, it runs no thread and no turn, so
// it answers no server request and maps no notification. Contract: docs/v2/providers.md →
// "Codex app-server transport (P-12 … P-14)".
import { spawn as nodeSpawn } from 'node:child_process';
import type { ChildProcess } from 'node:child_process';

import type { Result } from '../../../../domain/index';
import { err, ok } from '../../../../domain/index';
import { isRecord } from './rate-limits';

/** What this client tells the server about itself — one identity shared by every app-server
 * caller, run transport and control connections alike. */
export const CLIENT_INFO = { name: 'docket', title: 'Docket', version: '0.0.0' } as const;

/** The initialize parameters every app-server connection opens its handshake with, in the
 * protocol's own shape; the flags state the client's own capabilities, both off. */
export const INITIALIZE_PARAMS = {
  clientInfo: CLIENT_INFO,
  capabilities: { experimentalApi: false, requestAttestation: false },
} as const;

export type AppServerConnectionError = {
  readonly code: 'not_installed' | 'timeout' | 'protocol' | 'closed';
  readonly message: string;
};

/** The narrow spawn surface a connection needs; the real node spawn satisfies it directly. The
 * options carry no lifetime cap: the per-request ceiling and the caller's close bound the child. */
export type AppServerSpawn = (
  command: string,
  args: readonly string[],
  options: { readonly timeoutMs?: number },
) => ChildProcess;

export interface AppServerConnectionConfig {
  readonly command: string;
  readonly args: readonly string[];
  /** Ceiling per request; the default leaves a slow CLI an order of magnitude more than a
   * control round-trip needs. */
  readonly timeoutMs?: number;
  readonly spawn?: AppServerSpawn;
}

export interface AppServerConnection {
  /** One JSON-RPC request over the open connection; the answer is the raw `result` value. */
  request(method: string, params?: Readonly<Record<string, unknown>>): Promise<Result<unknown, AppServerConnectionError>>;
  /** Tears the process down and settles every pending request; safe to call more than once. */
  close(): void;
}

const DEFAULT_TIMEOUT_MS = 15_000;

interface Pending {
  settle(result: Result<unknown, AppServerConnectionError>): void;
  timer: ReturnType<typeof setTimeout>;
}

export function openAppServerConnection(config: AppServerConnectionConfig): Result<AppServerConnection, AppServerConnectionError> {
  const runSpawn = config.spawn ?? nodeSpawn;
  let child: ChildProcess;
  try {
    child = runSpawn(config.command, [...config.args], {});
  } catch {
    return err({ code: 'not_installed', message: 'the app-server process could not be started' });
  }
  if (child.stdin === null || child.stdout === null) {
    child.kill();
    return err({ code: 'not_installed', message: 'the app-server process could not be started with pipes' });
  }
  const stdin = child.stdin;
  const stdout = child.stdout;
  // Drained and discarded: stderr may quote environment values and never enters a result.
  child.stderr?.resume();

  const pending = new Map<number, Pending>();
  let remainder = '';
  let closed = false;
  let nextRequestId = 1;

  const settleAll = (error: AppServerConnectionError): void => {
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
    if (typeof parsed['method'] === 'string') return; // this connection runs no turn and answers nothing
    const id = parsed['id'];
    if (typeof id !== 'number') return; // responses carry this client's numeric ids
    const entry = pending.get(id);
    if (entry === undefined) return; // unknown or already settled: ignored
    pending.delete(id);
    clearTimeout(entry.timer);
    if (isRecord(parsed['error'])) {
      // The server's own text is never relayed: it could quote values the child saw.
      entry.settle(err({ code: 'protocol', message: 'the app-server refused the request' }));
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

  // A child that dies mid-write (or a full pipe) must not crash the caller through an unhandled
  // stream error.
  stdin.on('error', () => settleAll({ code: 'closed', message: 'the app-server connection closed' }));

  child.on('error', () => settleAll({ code: 'not_installed', message: 'the app-server process could not be started' }));
  child.on('close', () => settleAll({ code: 'closed', message: 'the app-server connection closed' }));

  return ok({
    request: (method, params) =>
      new Promise<Result<unknown, AppServerConnectionError>>((resolve) => {
        if (closed) {
          resolve(err({ code: 'closed', message: 'the app-server connection is closed' }));
          return;
        }
        const id = nextRequestId;
        nextRequestId += 1;
        const timer = setTimeout(() => {
          pending.delete(id);
          resolve(err({ code: 'timeout', message: 'the app-server request did not answer in time' }));
        }, config.timeoutMs ?? DEFAULT_TIMEOUT_MS);
        pending.set(id, {
          settle: resolve,
          timer,
        });
        stdin.write(`${JSON.stringify({ jsonrpc: '2.0', id, method, ...(params === undefined ? {} : { params }) })}\n`);
      }),
    close: (): void => {
      settleAll({ code: 'closed', message: 'the app-server connection is closed' });
      killGroup();
    },
  });
}
