// mcp/ipc.test.ts — rules I-57 (socket location, permissions, stale files) and I-58 (the line
// protocol: shape, limits, unauthorized strikes), over real sockets in a temporary directory.
import { spawn } from 'node:child_process';
import { mkdtemp, rm, stat, writeFile, mkdir } from 'node:fs/promises';
import { connect, type Socket } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';

import type { DocketToolRequest, DocketToolResponse } from '../../application/index';

import {
  createSocketCaller,
  MCP_MAX_LINE_BYTES,
  mcpSocketPath,
  startMcpListener,
  type McpListener,
} from './ipc';

const posix = process.platform !== 'win32';
const maybe = posix ? describe : describe.skip;

const roots: string[] = [];
const listeners: McpListener[] = [];
const freshDir = async (): Promise<string> => {
  const dir = await mkdtemp(join(tmpdir(), 'dkt-'));
  roots.push(dir);
  return dir;
};

afterEach(async () => {
  for (const listener of listeners.splice(0)) await listener.close();
  for (const root of roots.splice(0)) await rm(root, { recursive: true, force: true });
});

const start = async (
  dataDir: string,
  handler: (request: DocketToolRequest) => Promise<DocketToolResponse>,
): Promise<McpListener> => {
  const started = await startMcpListener({ socketPath: mcpSocketPath(dataDir, process.platform), handler });
  if (!started.ok) throw new Error(`listener must start: ${started.error}`);
  listeners.push(started.value);
  return started.value;
};

/** A raw client: lines in, parsed lines out, and whether the server closed the connection. */
const rawClient = async (socketPath: string): Promise<{
  readonly socket: Socket;
  readonly lines: unknown[];
  readonly closed: Promise<void>;
  next(): Promise<unknown>;
}> => {
  const socket = connect(socketPath);
  await new Promise<void>((resolve, reject) => {
    socket.once('connect', resolve);
    socket.once('error', reject);
  });
  const lines: unknown[] = [];
  const waiters: ((value: unknown) => void)[] = [];
  let buffer = '';
  socket.on('data', (chunk: Buffer) => {
    buffer += chunk.toString('utf8');
    let newline = buffer.indexOf('\n');
    while (newline >= 0) {
      const parsed: unknown = JSON.parse(buffer.slice(0, newline));
      buffer = buffer.slice(newline + 1);
      const waiter = waiters.shift();
      if (waiter !== undefined) waiter(parsed);
      else lines.push(parsed);
      newline = buffer.indexOf('\n');
    }
  });
  const closed = new Promise<void>((resolve) => {
    socket.once('close', () => resolve());
    socket.on('error', () => undefined);
  });
  return {
    socket,
    lines,
    closed,
    next: () => (lines.length > 0 ? Promise.resolve(lines.shift()) : new Promise((resolve) => waiters.push(resolve))),
  };
};

const ok = (result: unknown): DocketToolResponse => ({ ok: true, result });

describe('mcpSocketPath', () => {
  it('I-57: the socket lives at <dataDir>/run/mcp.sock; on Windows a named pipe keyed by a hash of the data directory', () => {
    expect(mcpSocketPath('/home/u/.docket', 'linux')).toBe('/home/u/.docket/run/mcp.sock');
    expect(mcpSocketPath('/Users/u/.docket', 'darwin')).toBe('/Users/u/.docket/run/mcp.sock');
    const pipe = mcpSocketPath('C:\\Users\\u\\.docket', 'win32');
    expect(pipe).toMatch(/^\\\\\.\\pipe\\docket-mcp-[0-9a-f]{16}$/);
    expect(mcpSocketPath('C:\\Users\\u\\.docket', 'win32')).toBe(pipe);
    expect(mcpSocketPath('C:\\Users\\v\\.docket', 'win32')).not.toBe(pipe);
    expect(pipe).not.toContain('Users');
  });
});

maybe('startMcpListener (socket file)', () => {
  it('I-57: the run directory is 0700 and the socket 0600; closing removes the socket file', async () => {
    const dir = await freshDir();
    const listener = await start(dir, async () => ok({}));
    expect((await stat(join(dir, 'run'))).mode & 0o777).toBe(0o700);
    expect((await stat(join(dir, 'run', 'mcp.sock'))).mode & 0o777).toBe(0o600);
    await listener.close();
    await expect(stat(join(dir, 'run', 'mcp.sock'))).rejects.toThrow();
  });

  it('I-57: a run directory left with loose permissions is tightened to 0700', async () => {
    const dir = await freshDir();
    await mkdir(join(dir, 'run'), { mode: 0o755 });
    await start(dir, async () => ok({}));
    expect((await stat(join(dir, 'run'))).mode & 0o777).toBe(0o700);
  });

  it('I-57: a stale socket file of a dead process is removed at startup and the listener takes over', async () => {
    const dir = await freshDir();
    await mkdir(join(dir, 'run'), { mode: 0o700 });
    const path = join(dir, 'run', 'mcp.sock');
    // A process that listens and is killed without cleaning up leaves exactly such a file.
    const dead = spawn(process.execPath, ['-e', `require('net').createServer().listen(${JSON.stringify(path)}, () => console.log('ready'))`], { stdio: ['ignore', 'pipe', 'inherit'] });
    await new Promise<void>((resolve) => dead.stdout.once('data', () => resolve()));
    dead.kill('SIGKILL');
    await new Promise<void>((resolve) => dead.once('exit', () => resolve()));
    expect((await stat(path)).isSocket()).toBe(true);

    await start(dir, async () => ok({ hello: true }));
    const caller = createSocketCaller({ socketPath: path, token: 'tok' });
    expect(await caller('page_comments', {})).toEqual({ ok: true, result: { hello: true } });
  });

  it('I-57: a socket that another live listener holds is not taken over', async () => {
    const dir = await freshDir();
    await start(dir, async () => ok({ owner: 'first' }));
    const second = await startMcpListener({ socketPath: mcpSocketPath(dir, process.platform), handler: async () => ok({ owner: 'second' }) });
    expect(second).toEqual({ ok: false, error: 'in_use' });
    const caller = createSocketCaller({ socketPath: mcpSocketPath(dir, process.platform), token: 'tok' });
    expect(await caller('x', {})).toEqual({ ok: true, result: { owner: 'first' } });
  });

  it('I-57: a regular file at the socket path is never deleted', async () => {
    const dir = await freshDir();
    await mkdir(join(dir, 'run'), { mode: 0o700 });
    const path = join(dir, 'run', 'mcp.sock');
    await writeFile(path, 'precious');
    const started = await startMcpListener({ socketPath: path, handler: async () => ok({}) });
    expect(started).toEqual({ ok: false, error: 'not_a_socket' });
    expect((await stat(path)).size).toBe(8);
  });
});

maybe('the line protocol', () => {
  it('I-58: a request line {id, token, tool, args} reaches the handler and its outcome comes back as one line with the same id', async () => {
    const dir = await freshDir();
    const seen: DocketToolRequest[] = [];
    await start(dir, async (request) => {
      seen.push(request);
      return request.tool === 'page_update' ? { ok: false, code: 'forbidden' } : ok({ echoed: request.args });
    });
    const client = await rawClient(mcpSocketPath(dir, process.platform));
    client.socket.write(`${JSON.stringify({ id: 1, token: 'T', tool: 'page_comments', args: { pageId: 'P' } })}\n`);
    expect(await client.next()).toEqual({ id: 1, ok: true, result: { echoed: { pageId: 'P' } } });
    client.socket.write(`${JSON.stringify({ id: 'two', token: 'T', tool: 'page_update', args: {} })}\n`);
    expect(await client.next()).toEqual({ id: 'two', ok: false, code: 'forbidden' });
    expect(seen).toEqual([
      { token: 'T', tool: 'page_comments', args: { pageId: 'P' } },
      { token: 'T', tool: 'page_update', args: {} },
    ]);
    client.socket.destroy();
  });

  it('I-58: requests on one connection are answered in order, also when written back to back in one chunk', async () => {
    const dir = await freshDir();
    await start(dir, async (request) => {
      if (request.tool === 'slow') await new Promise((resolve) => setTimeout(resolve, 30));
      return ok({ tool: request.tool });
    });
    const client = await rawClient(mcpSocketPath(dir, process.platform));
    client.socket.write(
      ['slow', 'fast', 'last'].map((tool, index) => JSON.stringify({ id: index, token: 'T', tool, args: {} })).join('\n') + '\n',
    );
    expect([await client.next(), await client.next(), await client.next()]).toEqual([
      { id: 0, ok: true, result: { tool: 'slow' } },
      { id: 1, ok: true, result: { tool: 'fast' } },
      { id: 2, ok: true, result: { tool: 'last' } },
    ]);
    client.socket.destroy();
  });

  it('I-58: a request without a token, or with a malformed shape, never reaches the handler', async () => {
    const dir = await freshDir();
    let calls = 0;
    await start(dir, async () => {
      calls += 1;
      return ok({});
    });
    const client = await rawClient(mcpSocketPath(dir, process.platform));
    client.socket.write(`${JSON.stringify({ id: 1, tool: 'page_publish', args: {} })}\n`);
    expect(await client.next()).toEqual({ id: 1, ok: false, code: 'unauthorized' });
    client.socket.write(`${JSON.stringify({ id: 2, token: 42, tool: 'page_publish', args: {} })}\n`);
    expect(await client.next()).toEqual({ id: 2, ok: false, code: 'unauthorized' });
    client.socket.write('{not json\n');
    expect(await client.next()).toEqual({ id: null, ok: false, code: 'bad_request' });
    client.socket.write(`${JSON.stringify({ id: 3, token: 'T', args: {} })}\n`);
    expect(await client.next()).toEqual({ id: 3, ok: false, code: 'bad_request' });
    expect(calls).toBe(0);
    client.socket.destroy();
  });

  it('I-58: the connection is closed after the third unauthorized answer, not before', async () => {
    const dir = await freshDir();
    await start(dir, async () => ({ ok: false, code: 'unauthorized' }));
    const client = await rawClient(mcpSocketPath(dir, process.platform));
    for (const id of [1, 2]) {
      client.socket.write(`${JSON.stringify({ id, token: 'guess', tool: 'page_publish', args: {} })}\n`);
      expect(await client.next()).toEqual({ id, ok: false, code: 'unauthorized' });
    }
    expect(client.socket.destroyed).toBe(false);
    client.socket.write(`${JSON.stringify({ id: 3, token: 'guess', tool: 'page_publish', args: {} })}\n`);
    expect(await client.next()).toEqual({ id: 3, ok: false, code: 'unauthorized' });
    await client.closed;
    expect(client.socket.destroyed).toBe(true);
  });

  it('I-58: a valid answer in between does not reset the strikes of one connection', async () => {
    const dir = await freshDir();
    await start(dir, async (request) => (request.token === 'good' ? ok({}) : { ok: false, code: 'unauthorized' }));
    const client = await rawClient(mcpSocketPath(dir, process.platform));
    const send = (id: number, token: string): void => {
      client.socket.write(`${JSON.stringify({ id, token, tool: 't', args: {} })}\n`);
    };
    send(1, 'bad');
    await client.next();
    send(2, 'good');
    await client.next();
    send(3, 'bad');
    await client.next();
    send(4, 'bad');
    await client.next();
    await client.closed;
  });

  it('I-58: a line longer than the limit closes the connection without a call', async () => {
    const dir = await freshDir();
    let calls = 0;
    await start(dir, async () => {
      calls += 1;
      return ok({});
    });
    expect(MCP_MAX_LINE_BYTES).toBe(8 * 1024 * 1024);
    // Without any newline, so the listener must give up while the line is still arriving.
    const endless = await rawClient(mcpSocketPath(dir, process.platform));
    endless.socket.write(Buffer.alloc(MCP_MAX_LINE_BYTES + 1024, 0x61));
    await endless.closed;
    expect(endless.socket.destroyed).toBe(true);

    // A complete but oversized line is refused too.
    const complete = await rawClient(mcpSocketPath(dir, process.platform));
    const big = JSON.stringify({ id: 1, token: 'T', tool: 'page_publish', args: { content: 'a'.repeat(MCP_MAX_LINE_BYTES) } });
    complete.socket.write(`${big}\n`);
    await complete.closed;
    expect(calls).toBe(0);
  });

  it('I-58: a line just under the limit is served', async () => {
    const dir = await freshDir();
    await start(dir, async (request) => ok({ size: JSON.stringify(request.args).length }));
    const client = await rawClient(mcpSocketPath(dir, process.platform));
    const args = { content: 'a'.repeat(MCP_MAX_LINE_BYTES - 200) };
    client.socket.write(`${JSON.stringify({ id: 1, token: 'T', tool: 'page_publish', args })}\n`);
    expect(await client.next()).toEqual({ id: 1, ok: true, result: { size: JSON.stringify(args).length } });
    client.socket.destroy();
  });

  it('I-58: a handler that throws answers internal — nothing of the error crosses the socket', async () => {
    const dir = await freshDir();
    await start(dir, async () => {
      throw new Error('boom at /secret/place');
    });
    const client = await rawClient(mcpSocketPath(dir, process.platform));
    client.socket.write(`${JSON.stringify({ id: 1, token: 'T', tool: 'page_publish', args: {} })}\n`);
    expect(await client.next()).toEqual({ id: 1, ok: false, code: 'internal' });
    client.socket.destroy();
  });

  it('I-58: the socket caller answers app_unreachable when nobody listens, without leaking the path', async () => {
    const dir = await freshDir();
    const caller = createSocketCaller({ socketPath: mcpSocketPath(dir, process.platform), token: 'secret-token' });
    const outcome = await caller('page_publish', {});
    expect(outcome).toEqual({ ok: false, code: 'app_unreachable' });
  });

  it('I-58: the socket caller sends the token and the tool, one connection per call', async () => {
    const dir = await freshDir();
    const seen: DocketToolRequest[] = [];
    await start(dir, async (request) => {
      seen.push(request);
      return ok({ n: seen.length });
    });
    const caller = createSocketCaller({ socketPath: mcpSocketPath(dir, process.platform), token: 'the-token' });
    expect(await caller('page_publish', { a: 1 })).toEqual({ ok: true, result: { n: 1 } });
    expect(await caller('page_update', { b: 2 })).toEqual({ ok: true, result: { n: 2 } });
    expect(seen).toEqual([
      { token: 'the-token', tool: 'page_publish', args: { a: 1 } },
      { token: 'the-token', tool: 'page_update', args: { b: 2 } },
    ]);
  });

  it('I-58: a caller whose peer never answers gives up with timeout', async () => {
    const dir = await freshDir();
    await start(dir, () => new Promise<DocketToolResponse>(() => undefined));
    const caller = createSocketCaller({ socketPath: mcpSocketPath(dir, process.platform), token: 't', timeoutMs: 100 });
    expect(await caller('page_comments', {})).toEqual({ ok: false, code: 'timeout' });
  });
});
