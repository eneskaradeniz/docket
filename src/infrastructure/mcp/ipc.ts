// mcp/ipc.ts — the local channel between the app and the MCP child a run's CLI launches: a Unix
// domain socket (a named pipe on Windows) with newline-delimited JSON, one request per line
// `{ id, token, tool, args }` and one response line `{ id, ok: true, result } | { id, ok: false, code }`.
// No network port exists. Access is a matter of file permissions (a private directory) plus the
// per-run token; the listener executes nothing from a request itself — it hands `{ token, tool,
// args }` to the injected handler, which owns the three fixed tools.
import { createHash } from 'node:crypto';
import { chmod, lstat, mkdir, unlink } from 'node:fs/promises';
import { connect, createServer, type Server, type Socket } from 'node:net';
import { dirname, join } from 'node:path';

import type { DocketToolRequest, DocketToolResponse } from '../../application/index';
import type { Result } from '../../domain/index';
import { err, ok } from '../../domain/index';

import type { McpToolCall, McpToolOutcome } from './server';

/** A longer line closes the connection: nothing legitimate needs more, and an endless line must
 *  not grow the app's memory. */
export const MCP_MAX_LINE_BYTES = 8 * 1024 * 1024;
const MAX_UNAUTHORIZED = 3;
const MAX_CONNECTIONS = 64;
const DEFAULT_CALL_TIMEOUT_MS = 60_000;

/** `<dataDir>/run/mcp.sock`; on Windows a named pipe whose name is a hash of the data directory,
 *  so two data directories never share one and the name leaks no path. */
export function mcpSocketPath(dataDir: string, platform: string): string {
  if (platform === 'win32') {
    const hash = createHash('sha256').update(dataDir).digest('hex').slice(0, 16);
    return `\\\\.\\pipe\\docket-mcp-${hash}`;
  }
  return join(dataDir, 'run', 'mcp.sock');
}

export type McpListenerError = 'in_use' | 'not_a_socket' | 'listen_failed';

export interface McpListener {
  readonly socketPath: string;
  /** Stops listening, drops open connections and removes the socket file. */
  close(): Promise<void>;
}

export interface McpListenerOptions {
  readonly socketPath: string;
  readonly handler: (request: DocketToolRequest) => Promise<DocketToolResponse>;
}

const isPipe = (path: string): boolean => path.startsWith('\\\\.\\pipe\\');

/** Whether something answers on the socket: a live listener of another instance. */
const probeLive = (path: string): Promise<boolean> =>
  new Promise((resolve) => {
    const probe = connect(path);
    probe.once('connect', () => {
      probe.destroy();
      resolve(true);
    });
    probe.once('error', () => resolve(false));
  });

/** Prepares the file system side: a private directory, and no stale socket in the way. A regular
 *  file is never removed, and a socket another instance still answers on is never taken over. */
const prepare = async (socketPath: string): Promise<McpListenerError | undefined> => {
  const dir = dirname(socketPath);
  await mkdir(dir, { recursive: true, mode: 0o700 });
  await chmod(dir, 0o700);
  let existing;
  try {
    existing = await lstat(socketPath);
  } catch {
    return undefined; // nothing there
  }
  if (!existing.isSocket()) return 'not_a_socket';
  if (await probeLive(socketPath)) return 'in_use';
  await unlink(socketPath);
  return undefined;
};

/** The wire's answers also include `bad_request`, which is the listener's own and not a tool's. */
type Answer = McpToolOutcome;

const response = (id: string | number | null, outcome: Answer): string =>
  `${JSON.stringify(outcome.ok ? { id, ok: true, result: outcome.result } : { id, ok: false, code: outcome.code })}\n`;

export async function startMcpListener(options: McpListenerOptions): Promise<Result<McpListener, McpListenerError>> {
  const { socketPath, handler } = options;
  if (!isPipe(socketPath)) {
    const prepared = await prepare(socketPath).catch((): McpListenerError => 'listen_failed');
    if (prepared !== undefined) return err(prepared);
  }

  const sockets = new Set<Socket>();
  const server: Server = createServer();
  server.maxConnections = MAX_CONNECTIONS;

  server.on('connection', (socket) => {
    sockets.add(socket);
    socket.once('close', () => sockets.delete(socket));
    socket.on('error', () => socket.destroy());

    let chunks: Buffer[] = [];
    let length = 0;
    let unauthorized = 0;
    let closing = false;
    let queue: Promise<void> = Promise.resolve();

    const serve = async (line: string): Promise<void> => {
      let parsed: unknown;
      try {
        parsed = JSON.parse(line);
      } catch {
        socket.write(response(null, { ok: false, code: 'bad_request' }));
        return;
      }
      const message = typeof parsed === 'object' && parsed !== null && !Array.isArray(parsed) ? (parsed as Record<string, unknown>) : undefined;
      if (message === undefined) {
        socket.write(response(null, { ok: false, code: 'bad_request' }));
        return;
      }
      const id = typeof message['id'] === 'string' || typeof message['id'] === 'number' ? message['id'] : null;
      const { token, tool, args } = message;
      let outcome: Answer;
      if (typeof token !== 'string' || token === '') {
        outcome = { ok: false, code: 'unauthorized' };
      } else if (id === null || typeof tool !== 'string') {
        outcome = { ok: false, code: 'bad_request' };
      } else {
        try {
          outcome = await handler({ token, tool, args: args ?? {} });
        } catch {
          // What the handler threw may name paths or content; the peer learns the code only.
          outcome = { ok: false, code: 'internal' };
        }
      }
      if (!outcome.ok && outcome.code === 'unauthorized') unauthorized += 1;
      socket.write(response(id, outcome));
      if (unauthorized >= MAX_UNAUTHORIZED) {
        closing = true;
        socket.end();
      }
    };

    const refuse = (): void => {
      closing = true;
      chunks = [];
      socket.destroy();
    };

    socket.on('data', (data: Buffer) => {
      let rest = data;
      while (!closing && rest.length > 0) {
        const newline = rest.indexOf(0x0a);
        if (newline < 0) {
          chunks.push(rest);
          length += rest.length;
          if (length > MCP_MAX_LINE_BYTES) refuse();
          return;
        }
        const lineLength = length + newline;
        if (lineLength > MCP_MAX_LINE_BYTES) {
          refuse();
          return;
        }
        const line = Buffer.concat([...chunks, rest.subarray(0, newline)]).toString('utf8');
        chunks = [];
        length = 0;
        rest = rest.subarray(newline + 1);
        if (line.trim() !== '') queue = queue.then(() => (closing ? undefined : serve(line)));
      }
    });
  });

  const listening = await new Promise<McpListenerError | undefined>((resolve) => {
    server.once('error', (error: NodeJS.ErrnoException) => resolve(error.code === 'EADDRINUSE' ? 'in_use' : 'listen_failed'));
    server.listen(socketPath, () => resolve(undefined));
  });
  if (listening !== undefined) return err(listening);

  if (!isPipe(socketPath)) {
    // The directory is already private, so nobody could connect between listen and this chmod.
    try {
      await chmod(socketPath, 0o600);
    } catch {
      server.close();
      return err('listen_failed');
    }
  }

  return ok({
    socketPath,
    close: async (): Promise<void> => {
      for (const socket of sockets) socket.destroy();
      await new Promise<void>((resolve) => server.close(() => resolve()));
      if (!isPipe(socketPath)) await unlink(socketPath).catch(() => undefined);
    },
  });
}

export interface SocketCallerOptions {
  readonly socketPath: string;
  readonly token: string;
  readonly timeoutMs?: number;
}

/** The child's side: one short connection per tool call. Failures to reach or hear the app become
 *  codes (`app_unreachable`, `timeout`) — never the OS error text, which would name the path. */
export function createSocketCaller(options: SocketCallerOptions): McpToolCall {
  const timeoutMs = options.timeoutMs ?? DEFAULT_CALL_TIMEOUT_MS;
  let counter = 0;
  return (tool, args) =>
    new Promise<McpToolOutcome>((resolve) => {
      counter += 1;
      const id = counter;
      const socket = connect(options.socketPath);
      let settled = false;
      const finish = (outcome: McpToolOutcome): void => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        socket.destroy();
        resolve(outcome);
      };
      const timer = setTimeout(() => finish({ ok: false, code: 'timeout' }), timeoutMs);
      let chunks: Buffer[] = [];
      let length = 0;
      socket.once('connect', () => {
        socket.write(`${JSON.stringify({ id, token: options.token, tool, args })}\n`);
      });
      socket.on('error', () => finish({ ok: false, code: 'app_unreachable' }));
      socket.once('close', () => finish({ ok: false, code: 'app_unreachable' }));
      socket.on('data', (data: Buffer) => {
        const newline = data.indexOf(0x0a);
        chunks.push(newline < 0 ? data : data.subarray(0, newline));
        length += newline < 0 ? data.length : newline;
        if (length > MCP_MAX_LINE_BYTES) {
          chunks = [];
          finish({ ok: false, code: 'internal' });
          return;
        }
        if (newline < 0) return;
        try {
          const reply = JSON.parse(Buffer.concat(chunks).toString('utf8')) as Record<string, unknown>;
          if (reply['id'] !== id) finish({ ok: false, code: 'internal' });
          else if (reply['ok'] === true) finish({ ok: true, result: reply['result'] });
          else finish({ ok: false, code: typeof reply['code'] === 'string' ? reply['code'] : 'internal' });
        } catch {
          finish({ ok: false, code: 'internal' });
        }
      });
    });
}
