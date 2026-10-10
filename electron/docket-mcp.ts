// docket-mcp.ts — the MCP child a run's CLI launches (built to dist-electron/docket-mcp.cjs and
// started as plain Node through ELECTRON_RUN_AS_NODE). It speaks MCP on stdio and forwards each
// tool call to the app over the local socket with the run's token. stdout carries protocol lines
// only; diagnostics go to stderr and never name the token or any page content. Everything with
// behaviour lives in src/infrastructure/mcp/, which imports no Electron.
import { createSocketCaller, runStdioServer, type McpToolCall } from '../src/infrastructure/mcp/index';

const socketPath = process.env.DOCKET_MCP_SOCKET;
const token = process.env.DOCKET_MCP_TOKEN;

const unconfigured: McpToolCall = async () => ({ ok: false, code: 'unauthorized' });

const call: McpToolCall =
  socketPath === undefined || socketPath === '' || token === undefined || token === ''
    ? unconfigured
    : createSocketCaller({ socketPath, token });

if (call === unconfigured) process.stderr.write('docket-mcp: not launched by a Docket run (no socket or token)\n');

// No process.exit on the way out: stdout may still hold unflushed lines, and the process ends by
// itself once stdin has closed and nothing is pending.
runStdioServer({ input: process.stdin, output: process.stdout, diagnostics: process.stderr, call }).catch(() => {
  process.exitCode = 1;
});
