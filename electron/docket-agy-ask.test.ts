// docket-agy-ask.test.ts — the seam tests for the ask child's entry and delivery (I-108). The
// behaviour lives in src/infrastructure/mcp/agy-ask.test.ts; what only this file can pin is the
// agreement ACROSS modules: the delivery's launcher names the built ask child by the same spelling
// mcp/ask-script-path.ts owns (the providers module cannot import it — the module map allows
// system only), and the tree the delivery writes actually drives the ask script through the real
// listener. The entry source itself is pinned like the mcp child's (no run, only shape).
import { spawn } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import type { DocketToolRequest, DocketToolResponse } from '../src/application/index';
import { ASK_SCRIPT_NAME, runAgyAsk, startMcpListener, type McpListener } from '../src/infrastructure/mcp/index';
import { parseSlug } from '../src/domain/index';
import {
  prepareAgyDelivery,
  type AgyDeliveryCapability,
} from '../src/infrastructure/providers/transports/stream-json/agy-delivery';

let root: string;

beforeAll(() => {
  root = mkdtempSync(join(tmpdir(), 'docket-agy-ask-entry-'));
});

afterAll(() => {
  rmSync(root, { recursive: true, force: true });
});

const spawnHook = (
  command: string,
  args: readonly string[],
  options: { readonly env?: Readonly<Record<string, string>> },
) => spawn(command, [...args], { env: options.env, stdio: ['pipe', 'ignore', 'pipe'] });

const slugOf = <B extends string>(input: string) => {
  const parsed = parseSlug<B>(input);
  if (!parsed.ok) throw new Error('fixture slug must parse');
  return parsed.value;
};

describe('the ask child entry and delivery', () => {
  it('I-108: the delivery-written tree drives the ask child end to end', async () => {
    const dir = join(root, 'end-to-end');
    const configDir = join(dir, 'config');
    const socketPath = join(dir, 'mcp.sock');
    const capabilities: readonly AgyDeliveryCapability[] = [
      {
        kind: 'mcp',
        id: slugOf<'capability'>('docket-pages'),
        name: 'Docket pages',
        command: process.execPath,
        args: [join(dir, 'bundle', 'docket-mcp.cjs')],
        env: { DOCKET_MCP_SOCKET: socketPath, DOCKET_MCP_TOKEN: 'tok-e2e', ELECTRON_RUN_AS_NODE: '1' },
      },
      {
        kind: 'hook',
        id: slugOf<'capability'>('e2e-guard'),
        name: 'e2e guard',
        event: 'before_tool',
        command: 'exit 0',
      },
    ];

    const agentsDir = await prepareAgyDelivery(configDir, capabilities);

    // The launcher names the built ask child with the one spelling the mcp module owns — this is
    // the pin that keeps the delivery's own copy of the file name honest.
    const launcher = await readFile(join(agentsDir, 'hooks', 'docket-ask.sh'), 'utf8');
    expect(launcher).toBe(
      `#!/bin/sh\nexec env ELECTRON_RUN_AS_NODE=1 "${process.execPath}" "${join(
        dirname(join(dir, 'bundle', 'docket-mcp.cjs')),
        ASK_SCRIPT_NAME,
      )}" "${configDir}"\n`,
    );

    const requests: DocketToolRequest[] = [];
    const queue: DocketToolResponse[] = [{ ok: true, result: { decision: 'allow' } }];
    const started = await startMcpListener({
      socketPath,
      handler: async (request) => {
        requests.push(request);
        return queue.shift() ?? { ok: false, code: 'internal' };
      },
    });
    if (!started.ok) throw new Error(`listener failed: ${started.error}`);
    const listener: McpListener = started.value;
    try {
      // The .docket-ask.json the delivery wrote is exactly the file the ask child reads: the
      // writer's and the reader's field names agree, so the run answers end to end.
      const lines: string[] = [];
      await runAgyAsk({
        configDir,
        stdinText: JSON.stringify({
          conversationId: 'conv-e2e',
          toolCall: { name: 'run_command', args: { CommandLine: 'echo end to end' } },
        }),
        write: (line) => lines.push(line),
        spawnHook,
      });
      expect(lines).toEqual(['{"decision":"auto_approve"}\n']);
      expect(requests[0]).toMatchObject({
        token: 'tok-e2e',
        tool: 'agy_permission_ask',
        args: { tool: 'Bash', target: 'echo end to end', conversationId: 'conv-e2e' },
      });
    } finally {
      await listener.close();
    }
  });

  it('I-108: the entry wires argv, stdin and the registered spawn seam, and never the token', () => {
    const source = readSource('docket-agy-ask.ts');
    expect(source).toContain('process.argv[2]');
    expect(source).toContain('runAgyAsk');
    expect(source).toContain('registeredSpawn');
    // The token reaches the child only through the 0600 file the delivery wrote; the entry keeps
    // it out of argv and env by construction — it reads nothing else off the process.
    expect(source).not.toContain('DOCKET_MCP_TOKEN');
    expect(source).not.toContain('process.env');
  });
});

const readSource = (name: string): string => {
  const fileURL = new URL(`./${name}`, import.meta.url);
  return readFileSync(fileURLToPath(fileURL), 'utf8');
};
