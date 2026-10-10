// mcp/server.test.ts — rule I-56: the pure MCP server core over (line) => response lines.
import { PassThrough } from 'node:stream';
import { describe, expect, it } from 'vitest';

import {
  DOCKET_CHAT_TOOLS_INSTRUCTIONS,
  DOCKET_TOOL_DEFINITIONS,
  DOCKET_TOOL_DEFINITIONS_BY_KIND,
  DOCKET_TOOLS_INSTRUCTIONS,
} from '../../application/index';

import { createMcpServer, runStdioServer, type McpToolCall } from './server';

const echoCall: McpToolCall = async (tool, args) => ({ ok: true, result: { tool, args } });

const send = async (call: McpToolCall, message: unknown): Promise<unknown[]> => {
  const server = createMcpServer({ call });
  const lines = await server.handle(typeof message === 'string' ? message : JSON.stringify(message));
  return lines.map((line) => JSON.parse(line) as unknown);
};

describe('createMcpServer', () => {
  it('I-56: initialize echoes a supported protocol version, offers the tools capability and the trust instructions', async () => {
    const [reply] = await send(echoCall, { jsonrpc: '2.0', id: 1, method: 'initialize', params: { protocolVersion: '2025-03-26', capabilities: {}, clientInfo: { name: 'cli', version: '1' } } });
    expect(reply).toEqual({
      jsonrpc: '2.0',
      id: 1,
      result: {
        protocolVersion: '2025-03-26',
        capabilities: { tools: {} },
        serverInfo: { name: 'docket', version: expect.any(String) },
        instructions: DOCKET_TOOLS_INSTRUCTIONS,
      },
    });
  });

  it('I-56: an unsupported or missing protocol version is answered with the server\'s latest; string ids are echoed', async () => {
    const [future] = (await send(echoCall, { jsonrpc: '2.0', id: 'a-1', method: 'initialize', params: { protocolVersion: '2099-01-01' } })) as { id: string; result: { protocolVersion: string } }[];
    expect(future?.id).toBe('a-1');
    expect(future?.result.protocolVersion).toBe('2025-06-18');
    const [bare] = (await send(echoCall, { jsonrpc: '2.0', id: 2, method: 'initialize' })) as { result: { protocolVersion: string } }[];
    expect(bare?.result.protocolVersion).toBe('2025-06-18');
  });

  it('I-56: notifications get no response, known or not; blank lines are skipped', async () => {
    expect(await send(echoCall, { jsonrpc: '2.0', method: 'notifications/initialized' })).toEqual([]);
    expect(await send(echoCall, { jsonrpc: '2.0', method: 'notifications/whatever', params: {} })).toEqual([]);
    expect(await send(echoCall, { jsonrpc: '2.0', method: 'no/such/method' })).toEqual([]);
    expect(await send(echoCall, '')).toEqual([]);
    expect(await send(echoCall, '   ')).toEqual([]);
  });

  it('I-56: ping answers an empty result', async () => {
    expect(await send(echoCall, { jsonrpc: '2.0', id: 7, method: 'ping' })).toEqual([{ jsonrpc: '2.0', id: 7, result: {} }]);
  });

  it('I-56: tools/list answers the three tools with name, description and a JSON-schema object', async () => {
    const [reply] = (await send(echoCall, { jsonrpc: '2.0', id: 3, method: 'tools/list' })) as { result: { tools: { name: string }[] } }[];
    expect(reply?.result.tools.map((tool) => tool.name)).toEqual(['page_publish', 'page_update', 'page_comments']);
    expect(reply?.result.tools).toEqual(
      DOCKET_TOOL_DEFINITIONS.map((tool) => ({ name: tool.name, description: tool.description, inputSchema: tool.inputSchema })),
    );
  });

  it('I-56: tools/call hands name and arguments to the caller and wraps the result as one JSON text content', async () => {
    const [reply] = await send(echoCall, { jsonrpc: '2.0', id: 4, method: 'tools/call', params: { name: 'page_comments', arguments: { pageId: 'P' } } });
    expect(reply).toEqual({
      jsonrpc: '2.0',
      id: 4,
      result: { content: [{ type: 'text', text: JSON.stringify({ tool: 'page_comments', args: { pageId: 'P' } }) }] },
    });
  });

  it('I-56: a failed tool is an isError result carrying the stable code only', async () => {
    const failing: McpToolCall = async () => ({ ok: false, code: 'rate_limited' });
    const [reply] = await send(failing, { jsonrpc: '2.0', id: 5, method: 'tools/call', params: { name: 'page_publish', arguments: {} } });
    expect(reply).toEqual({
      jsonrpc: '2.0',
      id: 5,
      result: { isError: true, content: [{ type: 'text', text: JSON.stringify({ code: 'rate_limited' }) }] },
    });
  });

  it('I-56: a caller that throws or rejects becomes isError internal — the message never travels', async () => {
    const crashing: McpToolCall = async () => {
      throw new Error('connect ECONNREFUSED /secret/dir/mcp.sock');
    };
    const [reply] = await send(crashing, { jsonrpc: '2.0', id: 6, method: 'tools/call', params: { name: 'page_publish', arguments: {} } });
    expect(JSON.stringify(reply)).not.toContain('ECONNREFUSED');
    expect(reply).toMatchObject({ id: 6, result: { isError: true } });
    expect(JSON.stringify(reply)).toContain('internal');
  });

  it('I-56: tools/call without a string name is -32602; arguments default to an empty object', async () => {
    const [bad] = await send(echoCall, { jsonrpc: '2.0', id: 8, method: 'tools/call', params: { arguments: {} } });
    expect(bad).toMatchObject({ id: 8, error: { code: -32602 } });
    const [none] = (await send(echoCall, { jsonrpc: '2.0', id: 9, method: 'tools/call', params: { name: 'page_comments' } })) as { result: { content: { text: string }[] } }[];
    expect(JSON.parse(none?.result.content[0]?.text ?? '{}')).toEqual({ tool: 'page_comments', args: {} });
  });

  it('I-56: an unknown method with an id is -32601', async () => {
    expect(await send(echoCall, { jsonrpc: '2.0', id: 10, method: 'resources/list' })).toEqual([
      { jsonrpc: '2.0', id: 10, error: { code: -32601, message: 'Method not found' } },
    ]);
  });

  it('I-56: malformed JSON is -32700 with a null id; a non-request value is -32600', async () => {
    expect(await send(echoCall, '{"jsonrpc":')).toEqual([{ jsonrpc: '2.0', id: null, error: { code: -32700, message: 'Parse error' } }]);
    expect(await send(echoCall, '[1,2]')).toEqual([{ jsonrpc: '2.0', id: null, error: { code: -32600, message: 'Invalid Request' } }]);
    expect(await send(echoCall, '42')).toEqual([{ jsonrpc: '2.0', id: null, error: { code: -32600, message: 'Invalid Request' } }]);
    expect(await send(echoCall, { jsonrpc: '2.0', id: 11 })).toEqual([{ jsonrpc: '2.0', id: 11, error: { code: -32600, message: 'Invalid Request' } }]);
  });

  it('I-56: every response is one line', async () => {
    const server = createMcpServer({ call: async () => ({ ok: true, result: { text: 'a\nb\r\nc' } }) });
    const lines = await server.handle(JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'tools/call', params: { name: 'page_comments', arguments: {} } }));
    expect(lines).toHaveLength(1);
    expect(lines[0]).not.toMatch(/[\r\n]/);
  });
});

describe('createMcpServer by token kind', () => {
  const asKind = async (kind: 'run' | 'chat' | undefined, message: unknown): Promise<{ result: { tools?: { name: string }[]; instructions?: string } }> => {
    const server = createMcpServer({ call: echoCall, ...(kind === undefined ? {} : { kind }) });
    const [line] = await server.handle(JSON.stringify(message));
    return JSON.parse(line ?? '{}') as { result: { tools?: { name: string }[]; instructions?: string } };
  };

  it('I-80: a chat-kind server lists the three read tools with the chat instructions, a run-kind one the three page tools', async () => {
    const chat = await asKind('chat', { jsonrpc: '2.0', id: 1, method: 'tools/list' });
    expect(chat.result.tools?.map((tool) => tool.name)).toEqual(['docket_get', 'docket_search', 'docket_read_file']);
    expect(chat.result.tools).toEqual(
      DOCKET_TOOL_DEFINITIONS_BY_KIND.chat.map((tool) => ({ name: tool.name, description: tool.description, inputSchema: tool.inputSchema })),
    );
    const run = await asKind('run', { jsonrpc: '2.0', id: 1, method: 'tools/list' });
    expect(run.result.tools?.map((tool) => tool.name)).toEqual(['page_publish', 'page_update', 'page_comments']);
    expect((await asKind('chat', { jsonrpc: '2.0', id: 2, method: 'initialize' })).result.instructions).toBe(DOCKET_CHAT_TOOLS_INSTRUCTIONS);
    expect((await asKind('run', { jsonrpc: '2.0', id: 2, method: 'initialize' })).result.instructions).toBe(DOCKET_TOOLS_INSTRUCTIONS);
  });

  it('I-80: without a kind the server lists the run tools, as before', async () => {
    const plain = await asKind(undefined, { jsonrpc: '2.0', id: 1, method: 'tools/list' });
    expect(plain.result.tools?.map((tool) => tool.name)).toEqual(['page_publish', 'page_update', 'page_comments']);
  });

  it('I-80: the list is only a listing: tools/call hands any name to the app, which decides by the token', async () => {
    const seen: string[] = [];
    const server = createMcpServer({ kind: 'chat', call: async (tool) => { seen.push(tool); return { ok: false, code: 'forbidden' }; } });
    const [line] = await server.handle(JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'tools/call', params: { name: 'page_publish', arguments: {} } }));
    expect(seen).toEqual(['page_publish']);
    expect(JSON.parse(line ?? '{}')).toMatchObject({ result: { isError: true, content: [{ text: JSON.stringify({ code: 'forbidden' }) }] } });
  });
});

describe('runStdioServer', () => {
  const run = async (input: string, call: McpToolCall = echoCall): Promise<{ out: string[]; err: string }> => {
    const stdin = new PassThrough();
    const stdout = new PassThrough();
    const stderr = new PassThrough();
    const outChunks: Buffer[] = [];
    const errChunks: Buffer[] = [];
    stdout.on('data', (chunk: Buffer) => outChunks.push(chunk));
    stderr.on('data', (chunk: Buffer) => errChunks.push(chunk));
    const done = runStdioServer({ input: stdin, output: stdout, diagnostics: stderr, call });
    stdin.end(input);
    await done;
    return {
      out: Buffer.concat(outChunks).toString('utf8').split('\n').filter((line) => line !== ''),
      err: Buffer.concat(errChunks).toString('utf8'),
    };
  };

  it('I-56: lines in, protocol lines out — stdout carries nothing but JSON-RPC, in order, across CRLF', async () => {
    const input =
      [
        JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'initialize', params: { protocolVersion: '2025-06-18' } }),
        JSON.stringify({ jsonrpc: '2.0', method: 'notifications/initialized' }),
        JSON.stringify({ jsonrpc: '2.0', id: 2, method: 'ping' }),
        'not json',
      ].join('\r\n') + '\n';
    const { out, err } = await run(input);
    expect(out.map((line) => (JSON.parse(line) as { id: unknown }).id)).toEqual([1, 2, null]);
    for (const line of out) expect(JSON.parse(line)).toMatchObject({ jsonrpc: '2.0' });
    expect(err).toBe('');
  });

  it('I-56: an input that ends without a final newline still answers its last line', async () => {
    const { out } = await run(JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'ping' }));
    expect(out).toHaveLength(1);
  });

  it('I-56: a tool call that fails writes a diagnostic with the code only — never the arguments', async () => {
    const failing: McpToolCall = async () => ({ ok: false, code: 'unauthorized' });
    const { err } = await run(
      JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'tools/call', params: { name: 'page_publish', arguments: { title: 'TOP SECRET TITLE' } } }) + '\n',
      failing,
    );
    expect(err).toContain('unauthorized');
    expect(err).not.toContain('TOP SECRET');
  });
});
