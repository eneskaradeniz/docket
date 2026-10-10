// mcp/server.ts — Docket's MCP server over stdio, written from the Model Context Protocol
// specification: JSON-RPC 2.0, one message per line. The core is a pure function from one input
// line to its response lines; the stdio runner only frames bytes into lines around it. Neither
// knows Electron, the socket or the app: the tool call is injected.
import { StringDecoder } from 'node:string_decoder';

import { DOCKET_TOOL_DEFINITIONS, DOCKET_TOOLS_INSTRUCTIONS } from '../../application/index';

export type McpToolOutcome =
  | { readonly ok: true; readonly result: unknown }
  | { readonly ok: false; readonly code: string };

/** Runs one tool call somewhere else (the app over the socket) and answers its outcome. */
export type McpToolCall = (tool: string, args: unknown) => Promise<McpToolOutcome>;

export interface McpServer {
  /** The response lines of one input line: none for a notification or a blank line. */
  handle(line: string): Promise<readonly string[]>;
}

const SERVER_NAME = 'docket';
const SERVER_VERSION = '0.1.0';
/** Newest first: a client asking for anything else is answered with the first entry. */
const PROTOCOL_VERSIONS: readonly string[] = ['2025-06-18', '2025-03-26', '2024-11-05'];

const MAX_LINE_BYTES = 8 * 1024 * 1024;

type Id = string | number | null;

const reply = (id: Id, result: unknown): string => JSON.stringify({ jsonrpc: '2.0', id, result });
const replyError = (id: Id, code: number, message: string): string =>
  JSON.stringify({ jsonrpc: '2.0', id, error: { code, message } });

const asRecord = (value: unknown): Readonly<Record<string, unknown>> | undefined =>
  typeof value === 'object' && value !== null && !Array.isArray(value) ? (value as Record<string, unknown>) : undefined;

const toolResult = (outcome: McpToolOutcome): unknown =>
  outcome.ok
    ? { content: [{ type: 'text', text: JSON.stringify(outcome.result) }] }
    : { isError: true, content: [{ type: 'text', text: JSON.stringify({ code: outcome.code }) }] };

export function createMcpServer(options: { readonly call: McpToolCall }): McpServer {
  const callTool = async (id: Id, params: Readonly<Record<string, unknown>> | undefined): Promise<string> => {
    const name = params?.['name'];
    if (typeof name !== 'string') return replyError(id, -32602, 'Invalid params');
    try {
      return reply(id, toolResult(await options.call(name, params?.['arguments'] ?? {})));
    } catch {
      // A failure's message can name paths or the socket; the agent sees a code and nothing else.
      return reply(id, toolResult({ ok: false, code: 'internal' }));
    }
  };

  return {
    handle: async (line) => {
      if (line.trim() === '') return [];
      let message: unknown;
      try {
        message = JSON.parse(line);
      } catch {
        return [replyError(null, -32700, 'Parse error')];
      }
      const request = asRecord(message);
      if (request === undefined) return [replyError(null, -32600, 'Invalid Request')];
      const { id, method, params } = request;
      const hasId = typeof id === 'string' || typeof id === 'number';
      if (typeof method !== 'string') return [replyError(hasId ? id : null, -32600, 'Invalid Request')];
      // No id: a notification, which is never answered — not even when the method is unknown.
      if (!hasId) return [];

      switch (method) {
        case 'initialize': {
          const asked = asRecord(params)?.['protocolVersion'];
          const protocolVersion = typeof asked === 'string' && PROTOCOL_VERSIONS.includes(asked) ? asked : PROTOCOL_VERSIONS[0];
          return [
            reply(id, {
              protocolVersion,
              capabilities: { tools: {} },
              serverInfo: { name: SERVER_NAME, version: SERVER_VERSION },
              instructions: DOCKET_TOOLS_INSTRUCTIONS,
            }),
          ];
        }
        case 'ping':
          return [reply(id, {})];
        case 'tools/list':
          return [
            reply(id, {
              tools: DOCKET_TOOL_DEFINITIONS.map((tool) => ({
                name: tool.name,
                description: tool.description,
                inputSchema: tool.inputSchema,
              })),
            }),
          ];
        case 'tools/call':
          return [await callTool(id, asRecord(params))];
        default:
          return [replyError(id, -32601, 'Method not found')];
      }
    },
  };
}

export interface StdioServerOptions {
  readonly input: AsyncIterable<Uint8Array | string>;
  readonly output: { write(chunk: string): unknown };
  /** Where diagnostics go (the child's stderr): codes only, never arguments, results or the token. */
  readonly diagnostics: { write(chunk: string): unknown };
  readonly call: McpToolCall;
}

/** Frames `input` into lines, answers each in order on `output`, resolves when the input ends.
 *  stdout carries protocol lines and nothing else. */
export async function runStdioServer(options: StdioServerOptions): Promise<void> {
  const server = createMcpServer({
    call: async (tool, args) => {
      const outcome = await options.call(tool, args);
      if (!outcome.ok) options.diagnostics.write(`docket-mcp: ${tool} failed (${outcome.code})\n`);
      return outcome;
    },
  });
  const answer = async (line: string): Promise<void> => {
    for (const out of await server.handle(line.endsWith('\r') ? line.slice(0, -1) : line)) options.output.write(`${out}\n`);
  };

  const decoder = new StringDecoder('utf8');
  let pending = '';
  let discarding = false;
  for await (const chunk of options.input) {
    pending += typeof chunk === 'string' ? chunk : decoder.write(Buffer.from(chunk));
    let newline = pending.indexOf('\n');
    while (newline >= 0) {
      const line = pending.slice(0, newline);
      pending = pending.slice(newline + 1);
      if (discarding) discarding = false;
      else await answer(line);
      newline = pending.indexOf('\n');
    }
    if (pending.length > MAX_LINE_BYTES) {
      // An endless line would grow without bound; drop it up to its newline and say so once.
      pending = '';
      if (!discarding) options.output.write(`${replyError(null, -32600, 'Invalid Request')}\n`);
      discarding = true;
    }
  }
  const rest = pending + decoder.end();
  if (rest.trim() !== '' && !discarding) await answer(rest);
}
