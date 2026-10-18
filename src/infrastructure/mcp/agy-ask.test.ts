// agy-ask.test.ts — the permission-ask child's behaviour tests (docs/v2/infrastructure.md → I-108,
// docs/v2/providers.md → P-64). The hook commands run as REAL child processes through /bin/sh (the
// production form), and the app side of the channel is the REAL mcp.sock listener from ipc.ts with
// a scripted handler — no socket layer is stubbed, because the one-line protocol is the contract
// being pinned. The entry that wires this into electron/ is pinned in electron/docket-agy-ask.test.ts.
import { spawn } from 'node:child_process';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import type { DocketToolRequest, DocketToolResponse } from '../../application/index';
import {
  AGY_ASK_FILE,
  AGY_PERMISSION_ASK_TOOL,
  mapAgyToolCall,
  runAgyAsk,
  verdictInputOf,
  type AgyAskFile,
} from './agy-ask';
import { startMcpListener, type McpListener } from './ipc';

let root: string;
let caseCount = 0;

beforeAll(() => {
  root = mkdtempSync(join(tmpdir(), 'docket-agy-ask-'));
});

afterAll(() => {
  rmSync(root, { recursive: true, force: true });
});

const nextDir = (): string => {
  caseCount += 1;
  const dir = join(root, `case-${caseCount}`);
  mkdirSync(dir, { recursive: true });
  return dir;
};

/** The production spawn form (the entry registers it; the test may use node's own — I-103 excludes
 * tests), with stderr piped because a denying hook's stderr becomes the deny reason. */
const spawnHook = (
  command: string,
  args: readonly string[],
  options: { readonly env?: Readonly<Record<string, string>> },
) => spawn(command, [...args], { env: options.env, stdio: ['pipe', 'ignore', 'pipe'] });

const writeAskTree = (dir: string, file: Partial<AgyAskFile>): string => {
  const configDir = join(dir, 'config');
  mkdirSync(join(configDir, '.agents'), { recursive: true });
  const full = {
    socketPath: '',
    token: '',
    timeoutSeconds: 5,
    beforeTool: [] as readonly string[],
    bridge: false,
    ...file,
  };
  writeFileSync(join(configDir, '.agents', AGY_ASK_FILE), `${JSON.stringify(full)}\n`);
  return configDir;
};

/** agy's PreToolUse stdin as the probe measured it (spike-agy3): the toolCall shape plus the
 * fields around it; the mapping reads only what it needs. */
const stdinOf = (name: string, args: Readonly<Record<string, unknown>>, conversationId = 'conv-7'): string =>
  JSON.stringify({ conversationId, modelName: 'probe-model', stepIdx: 2, toolCall: { name, args } });

const runScript = async (configDir: string, stdinText: string): Promise<Record<string, unknown>> => {
  const lines: string[] = [];
  await runAgyAsk({ configDir, stdinText, write: (line) => lines.push(line), spawnHook });
  expect(lines).toHaveLength(1);
  return JSON.parse(lines[0] ?? '{}') as Record<string, unknown>;
};

/** The app side of the channel: the real listener with a scripted handler. */
const fakeApp = async (
  socketPath: string,
  replies: readonly DocketToolResponse[],
  requests: DocketToolRequest[],
): Promise<McpListener> => {
  const queue = [...replies];
  const started = await startMcpListener({
    socketPath,
    handler: async (request) => {
      requests.push(request);
      return queue.shift() ?? { ok: false, code: 'internal' };
    },
  });
  if (!started.ok) throw new Error(`fake app listener failed: ${started.error}`);
  return started.value;
};

describe('runAgyAsk', () => {
  it('I-108: ask script writes one socket line and maps the answer to a decision', async () => {
    const dir = nextDir();
    const socketPath = join(dir, 'mcp.sock');
    const requests: DocketToolRequest[] = [];
    const listener = await fakeApp(socketPath, [
      { ok: true, result: { decision: 'allow' } },
      { ok: true, result: { decision: 'deny', reason: 'not on the allowlist' } },
    ], requests);
    const configDir = writeAskTree(dir, { socketPath, token: 'tok-1', bridge: true });

    try {
      // allow → auto_approve; the line the listener saw carries the mapped tool, its one
      // identifying string and the conversation id.
      expect(await runScript(configDir, stdinOf('run_command', { CommandLine: 'echo hi', Cwd: '/tmp' }))).toEqual({
        decision: 'auto_approve',
      });
      expect(requests[0]).toMatchObject({
        token: 'tok-1',
        tool: AGY_PERMISSION_ASK_TOOL,
        args: { tool: 'Bash', target: 'echo hi', conversationId: 'conv-7' },
      });
      // A read maps through its own key; a deny answer becomes a deny with its reason.
      expect(await runScript(configDir, stdinOf('view_file', { AbsolutePath: '/a/b.txt' }))).toEqual({
        decision: 'deny',
        reason: 'not on the allowlist',
      });
      expect(requests[1]).toMatchObject({ args: { tool: 'Read', target: '/a/b.txt' } });
    } finally {
      await listener.close();
    }
  });

  it('P-63: agy tool names map to Docket tool names', async () => {
    // The child owns the one mapping (the app-side bridge receives the mapped name and never maps
    // again): each CLI tool becomes the Docket tool the risk table reads, with its one
    // identifying string as the target when the mapping has one.
    expect(mapAgyToolCall('run_command', { CommandLine: 'npm test', Cwd: '/tmp' })).toEqual({
      toolName: 'Bash',
      toolInput: { command: 'npm test' },
      target: 'npm test',
    });
    expect(mapAgyToolCall('write_to_file', { TargetFile: '/w/new.txt' })).toEqual({
      toolName: 'Write',
      toolInput: { file_path: '/w/new.txt' },
      target: '/w/new.txt',
    });
    expect(mapAgyToolCall('view_file', { AbsolutePath: '/a/b.txt' })).toEqual({
      toolName: 'Read',
      toolInput: { file_path: '/a/b.txt' },
      target: '/a/b.txt',
    });
    // An MCP call spells the server and tool out in the name and carries NO target — without one
    // the risk table cannot rate it, so the ask stays with the human.
    expect(mapAgyToolCall('call_mcp_tool', { ServerName: 'probe', ToolName: 'fetch' })).toEqual({
      toolName: 'mcp__probe__fetch',
      toolInput: { ServerName: 'probe', ToolName: 'fetch' },
    });
    // A call the mapping cannot read keeps the CLI's own name, still unmapped for risk.
    expect(mapAgyToolCall('call_mcp_tool', {})).toEqual({ toolName: 'call_mcp_tool', toolInput: {} });

    // The mapped name is what the channel carries: the line the app receives names the MCP tool
    // with no target key at all.
    const dir = nextDir();
    const socketPath = join(dir, 'mcp.sock');
    const requests: DocketToolRequest[] = [];
    const listener = await fakeApp(socketPath, [{ ok: true, result: { decision: 'deny', reason: 'ask the human' } }], requests);
    const configDir = writeAskTree(dir, { socketPath, token: 'tok-1', bridge: true });
    try {
      expect(
        await runScript(configDir, stdinOf('call_mcp_tool', { ServerName: 'probe', ToolName: 'fetch' })),
      ).toEqual({ decision: 'deny', reason: 'ask the human' });
      expect(requests[0]).toMatchObject({
        tool: AGY_PERMISSION_ASK_TOOL,
        args: { tool: 'mcp__probe__fetch', conversationId: 'conv-7' },
      });
      expect(requests[0]?.args).not.toHaveProperty('target');
    } finally {
      await listener.close();
    }
  });

  it('the verdict tool call carries its verdict, summary and pointers to the app; no other call does', async () => {
    const dir = nextDir();
    const socketPath = join(dir, 'mcp.sock');
    const requests: DocketToolRequest[] = [];
    const reply: DocketToolResponse = { ok: true, result: { decision: 'deny', reason: 'ask the human' } };
    const listener = await fakeApp(socketPath, [reply, reply, reply, reply], requests);
    const configDir = writeAskTree(dir, { socketPath, token: 'tok-1', bridge: true });
    const verdict = { verdict: 'approve', summary: 'Checked the diff.', pointers: ['src/a.ts:1', 'src/b.ts:2-4'] };
    try {
      // The arguments nested as an object under whichever key the CLI uses, then as JSON text.
      await runScript(
        configDir,
        stdinOf('call_mcp_tool', { ServerName: 'docket-pages', ToolName: 'submit_verdict', Arguments: { ...verdict, extra: 'dropped' } }),
      );
      await runScript(
        configDir,
        stdinOf('call_mcp_tool', { ServerName: 'docket-pages', ToolName: 'submit_verdict', ToolArguments: JSON.stringify(verdict) }),
      );
      // Another server's tool of the same name, and another tool of Docket's server.
      await runScript(configDir, stdinOf('call_mcp_tool', { ServerName: 'other', ToolName: 'submit_verdict', Arguments: verdict }));
      await runScript(configDir, stdinOf('call_mcp_tool', { ServerName: 'docket-pages', ToolName: 'docket_get', Arguments: verdict }));

      expect(requests[0]?.args).toMatchObject({ tool: 'mcp__docket-pages__submit_verdict', verdictInput: verdict });
      expect(requests[0]?.args).not.toHaveProperty('verdictInput.extra');
      expect(requests[1]?.args).toMatchObject({ tool: 'mcp__docket-pages__submit_verdict', verdictInput: verdict });
      expect(requests[2]?.args).not.toHaveProperty('verdictInput');
      expect(requests[3]?.args).not.toHaveProperty('verdictInput');
    } finally {
      await listener.close();
    }
  });

  it('a verdict tool call whose arguments cannot be found is asked without them', () => {
    expect(verdictInputOf({ ServerName: 'docket-pages', ToolName: 'submit_verdict' })).toBeUndefined();
    expect(verdictInputOf({ Arguments: 'not json', Other: [1] })).toBeUndefined();
    expect(verdictInputOf({ Arguments: { summary: 'no verdict' } })).toBeUndefined();
  });

  it('I-108: a missing socket denies (fail closed)', async () => {
    const dir = nextDir();
    const gone = writeAskTree(dir, { socketPath: join(dir, 'gone.sock'), token: 'tok-1', bridge: true });

    expect(await runScript(gone, stdinOf('run_command', { CommandLine: 'echo hi' }))).toEqual({
      decision: 'deny',
      reason: 'docket unreachable',
    });

    // A token the app rejects is the same fail-closed answer, not a silent pass.
    const socketPath = join(dir, 'mcp.sock');
    const requests: DocketToolRequest[] = [];
    const listener = await fakeApp(socketPath, [{ ok: false, code: 'unauthorized' }], requests);
    const rejected = writeAskTree(dir, { socketPath, token: 'tok-wrong', bridge: true });
    try {
      expect(await runScript(rejected, stdinOf('run_command', { CommandLine: 'echo hi' }))).toEqual({
        decision: 'deny',
        reason: 'docket unreachable',
      });
    } finally {
      await listener.close();
    }
  });

  it('P-64: exit code 2 of a user before_tool hook denies', async () => {
    const dir = nextDir();
    const socketPath = join(dir, 'mcp.sock');
    const requests: DocketToolRequest[] = [];
    const listener = await fakeApp(socketPath, [{ ok: true, result: { decision: 'allow' } }], requests);
    const captured = join(dir, 'hook-stdin.json');
    const configDir = writeAskTree(dir, {
      socketPath,
      token: 'tok-1',
      bridge: true,
      beforeTool: [`printf 'nope from hook' >&2; exit 2`],
    });

    try {
      // Exit code 2 denies with the hook's stderr as the reason — and the denial happens before
      // any socket write, so an unreachable app cannot change the outcome.
      expect(await runScript(configDir, stdinOf('run_command', { CommandLine: 'rm -rf /' }))).toEqual({
        decision: 'deny',
        reason: 'nope from hook',
      });
      expect(requests).toHaveLength(0);

      // Any other exit code does not block: the hook that only looked (and captured the stdin it
      // was fed — the translated tool_name/tool_input shape) lets the channel decide.
      const passing = writeAskTree(dir, {
        socketPath,
        token: 'tok-1',
        bridge: true,
        beforeTool: [`cat > ${JSON.stringify(captured)}`, 'exit 1'],
      });
      expect(await runScript(passing, stdinOf('run_command', { CommandLine: 'echo hi' }))).toEqual({
        decision: 'auto_approve',
      });
      expect(JSON.parse(await readFile(captured, 'utf8'))).toEqual({
        tool_name: 'Bash',
        tool_input: { command: 'echo hi' },
      });
    } finally {
      await listener.close();
    }
  });

  it('P-64: without a permission channel the script never prints auto_approve', async () => {
    const dir = nextDir();
    const configDir = writeAskTree(dir, { beforeTool: ['exit 0', 'exit 1'] });

    // Neutral allow: every hook passed, but with no channel there is no human or policy decision,
    // so the CLI's own policy applies (headless auto-deny). auto_approve is never printed.
    const lines: string[] = [];
    await runAgyAsk({
      configDir,
      stdinText: stdinOf('write_to_file', { TargetFile: '/w/new.txt' }),
      write: (line) => lines.push(line),
      spawnHook,
    });
    expect(lines).toEqual(['{"decision":"allow"}\n']);
    expect(lines[0]).not.toContain('auto_approve');
  });
});
