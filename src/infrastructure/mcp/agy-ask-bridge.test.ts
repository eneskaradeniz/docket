// agy-ask-bridge.test.ts — the app side of the agy permission channel (docs/v2/infrastructure.md →
// I-109, docs/v2/providers.md → P-63). Nothing here is stubbed: the real mcp.sock listener, the real
// handler wrap, the real bridge and the real run tokens, with the real createSocketCaller as the
// child side of the line protocol — exactly what the ask child of I-108 speaks. What stands in is
// the waiter: the transport's channel is a register/unregister contract this test invokes directly;
// the transport-side legs live in stream-json.test.ts.
import { mkdirSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import type { DocketToolRequest } from '../../application/index';
import { parseSlug, parseUlid } from '../../domain/index';
import { AGY_PERMISSION_ASK_TOOL } from './agy-ask';
import { createAgyAskBridge, wrapAgyAskBridge, type AgyAskBridgeArgs } from './agy-ask-bridge';
import { createSocketCaller, startMcpListener, type McpListener } from './ipc';
import { createNodeRunTokens } from './run-tokens';

let root: string;
let caseCount = 0;

beforeAll(() => {
  root = mkdtempSync(join(tmpdir(), 'docket-agy-ask-bridge-'));
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

const slugOf = <B extends string>(input: string) => {
  const parsed = parseSlug<B>(input);
  if (!parsed.ok) throw new Error('fixture slug must parse');
  return parsed.value;
};

const ulidOf = <B extends string>(input: string) => {
  const parsed = parseUlid<B>(input);
  if (!parsed.ok) throw new Error('fixture ulid must parse');
  return parsed.value;
};

const RUN_ID = ulidOf<'run'>('01ARZ3NDEKTSV4RRFFQ69G5FBV');
const OTHER_RUN_ID = ulidOf<'run'>('01ARZ3NDEKTSV4RRFFQ69G5FDV');
const TURN_ID = ulidOf<'run'>('01ARZ3NDEKTSV4RRFFQ69G5FHV');
const WORK_ORDER_ID = ulidOf<'work-order'>('01ARZ3NDEKTSV4RRFFQ69G5FJV');
const CONVERSATION_ID = ulidOf<'conversation'>('01ARZ3NDEKTSV4RRFFQ69G5FKV');
const ROLE = slugOf<'role'>('implementer');

describe('the agy permission bridge', () => {
  it('I-109: the listener accepts agy_permission_ask only with a run token', async () => {
    const dir = nextDir();
    const socketPath = join(dir, 'mcp.sock');
    const runTokens = createNodeRunTokens();
    const bridge = createAgyAskBridge();
    const seen: AgyAskBridgeArgs[] = [];
    // The waiter stands for the transport's channel: it takes the parsed ask and answers only after
    // a deliberate wait, proving the listener imposes no reply deadline of its own.
    bridge.register(RUN_ID, async (ask) => {
      seen.push(ask);
      await new Promise((resolve) => setTimeout(resolve, 150));
      return 'allow';
    });
    const through: DocketToolRequest[] = [];
    const handler = wrapAgyAskBridge(
      async (request) => {
        through.push(request);
        return { ok: true, result: { pinned: true } };
      },
      bridge,
      runTokens,
    );
    const started = await startMcpListener({ socketPath, handler });
    if (!started.ok) throw new Error(`listener failed: ${started.error}`);
    const listener: McpListener = started.value;

    const runToken = runTokens.mint({
      kind: 'run',
      runId: RUN_ID,
      workOrderId: WORK_ORDER_ID,
      role: ROLE,
    });
    const chatToken = runTokens.mint({
      kind: 'chat',
      turn: TURN_ID,
      conversation: CONVERSATION_ID,
      role: ROLE,
    });
    const otherToken = runTokens.mint({
      kind: 'run',
      runId: OTHER_RUN_ID,
      workOrderId: WORK_ORDER_ID,
      role: ROLE,
    });
    const askRun = createSocketCaller({ socketPath, token: runToken });
    const askChat = createSocketCaller({ socketPath, token: chatToken });
    const askOther = createSocketCaller({ socketPath, token: otherToken });
    const askUnknown = createSocketCaller({ socketPath, token: 'no-such-token' });

    try {
      // A run token with a registered waiter: the ask arrives parsed and the allow answers after
      // the waiter's wait — the reply is late by design and still written.
      expect(await askRun(AGY_PERMISSION_ASK_TOOL, { tool: 'Bash', target: 'echo hi', conversationId: 'conv-9' })).toEqual({
        ok: true,
        result: { decision: 'allow' },
      });
      expect(seen).toEqual([{ tool: 'Bash', target: 'echo hi', conversationId: 'conv-9' }]);

      // The verdict tool's arguments ride through to the waiter; a value that is not an object does not.
      const verdictInput = { verdict: 'approve', summary: 'Checked.', pointers: ['a.ts:1'] };
      await askRun(AGY_PERMISSION_ASK_TOOL, { tool: 'mcp__docket-pages__submit_verdict', verdictInput });
      await askRun(AGY_PERMISSION_ASK_TOOL, { tool: 'mcp__docket-pages__submit_verdict', verdictInput: 'approve' });
      expect(seen.slice(1)).toEqual([{ tool: 'mcp__docket-pages__submit_verdict', verdictInput }, { tool: 'mcp__docket-pages__submit_verdict' }]);

      // Any other tool name reaches the wrapped handler unchanged.
      expect(await askRun('docket_get', { q: 'open asks' })).toEqual({ ok: true, result: { pinned: true } });
      expect(through).toHaveLength(1);
      expect(through[0]).toMatchObject({ token: runToken, tool: 'docket_get', args: { q: 'open asks' } });

      // A chat-kind token is not a run token; an unknown one is nobody's.
      expect(await askChat(AGY_PERMISSION_ASK_TOOL, { tool: 'Bash' })).toEqual({ ok: false, code: 'unauthorized' });
      expect(await askUnknown(AGY_PERMISSION_ASK_TOOL, { tool: 'Bash' })).toEqual({ ok: false, code: 'unauthorized' });

      // A run the bridge never heard of gets the fail-closed deny answer, not an error.
      expect(await askOther(AGY_PERMISSION_ASK_TOOL, { tool: 'Bash' })).toEqual({
        ok: true,
        result: { decision: 'deny', reason: 'no permission channel for this run' },
      });

      // An ask without a tool name is bad_input — never an allow.
      expect(await askRun(AGY_PERMISSION_ASK_TOOL, { target: 'echo hi' })).toEqual({ ok: false, code: 'bad_input' });

      // A late hook after the run ended: the bridge forgot the run, then the revoked token refuses
      // outright — both deny.
      bridge.unregister(RUN_ID);
      expect(await askRun(AGY_PERMISSION_ASK_TOOL, { tool: 'Bash' })).toEqual({
        ok: true,
        result: { decision: 'deny', reason: 'no permission channel for this run' },
      });
      runTokens.revoke(RUN_ID);
      expect(await askRun(AGY_PERMISSION_ASK_TOOL, { tool: 'Bash' })).toEqual({ ok: false, code: 'unauthorized' });
    } finally {
      await listener.close();
    }
  });
});
