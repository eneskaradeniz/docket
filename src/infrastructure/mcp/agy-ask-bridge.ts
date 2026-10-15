// mcp/agy-ask-bridge.ts — the app side of the agy permission channel (P-63, I-109): the ask child
// of I-108 writes `agy_permission_ask` over mcp.sock, the handler wrap resolves its token to a run
// here, and the registered waiter — the stream-json transport of that run — turns the ask into a
// `permission_ask` on the run's stream. The bridge decides nothing: only the waiter's answer, which
// the executor's existing permission path produces, settles an ask; every other outcome is a deny.
import type { DocketToolRequest, DocketToolResponse, RunTokens } from '../../application/index';
import type { RunId } from '../../domain/index';

import { AGY_PERMISSION_ASK_TOOL } from './agy-ask';

/** The ask as the ask child sends it (I-108): the Docket tool name the child already mapped (the
 *  mapping lives there — the app side never maps a second time), the one identifying string when
 *  the mapping has one, and the CLI's conversation id. */
export interface AgyAskBridgeArgs {
  readonly tool: string;
  readonly target?: string;
  readonly conversationId?: string;
}

/** What one registered run answers asks with: the stream-json transport's channel. */
export type AgyAskWaiter = (ask: AgyAskBridgeArgs) => Promise<'allow' | 'deny'>;

export interface AgyAskBridge {
  /** The transport of `runId` holds the channel from here on; a second registration replaces the
   *  first, which only a restart of the same run id could attempt. */
  register(runId: RunId, waiter: AgyAskWaiter): void;
  /** The run ended: the bridge forgets it, so a late ask meets the fail-closed answer. */
  unregister(runId: RunId): void;
  /** The listener-facing ask. NEVER times out: the reply may follow a long human wait, and the
   *  caller — the ask child — owns the timeout. */
  ask(runId: RunId, args: unknown): Promise<DocketToolResponse>;
}

/** A run with no channel left: a deny answer, not an error — the hook child turns either into the
 *  same fail-closed deny, and the reason says which path was taken. */
const NO_CHANNEL: DocketToolResponse = {
  ok: true,
  result: { decision: 'deny', reason: 'no permission channel for this run' },
};

export function createAgyAskBridge(): AgyAskBridge {
  const waiters = new Map<RunId, AgyAskWaiter>();
  return {
    register: (runId, waiter) => {
      waiters.set(runId, waiter);
    },
    unregister: (runId) => {
      waiters.delete(runId);
    },
    ask: async (runId, args) => {
      const waiter = waiters.get(runId);
      if (waiter === undefined) return NO_CHANNEL;
      const record =
        typeof args === 'object' && args !== null && !Array.isArray(args) ? (args as Record<string, unknown>) : undefined;
      if (record === undefined || typeof record['tool'] !== 'string') {
        return { ok: false, code: 'bad_input' };
      }
      const ask: AgyAskBridgeArgs = {
        tool: record['tool'],
        ...(typeof record['target'] === 'string' ? { target: record['target'] } : {}),
        ...(typeof record['conversationId'] === 'string' ? { conversationId: record['conversationId'] } : {}),
      };
      // Only the waiter decides, and a waiter that crashes answers deny — never a silent hang.
      const decision = await waiter(ask).catch((): 'deny' => 'deny');
      return { ok: true, result: { decision } };
    },
  };
}

/** The composition root's one handler wrap (I-109): the ask pseudo-tool resolves its token to a
 *  RUN binding and goes to the bridge — a chat-kind, unknown or revoked token is refused — and
 *  every other tool name reaches the wrapped handler unchanged. */
export const wrapAgyAskBridge = (
  handler: (request: DocketToolRequest) => Promise<DocketToolResponse>,
  bridge: AgyAskBridge,
  runTokens: Pick<RunTokens, 'resolve'>,
): ((request: DocketToolRequest) => Promise<DocketToolResponse>) =>
  async (request) => {
    if (request.tool !== AGY_PERMISSION_ASK_TOOL) return handler(request);
    const binding = runTokens.resolve(request.token);
    if (binding === undefined || binding.kind !== 'run') return { ok: false, code: 'unauthorized' };
    return bridge.ask(binding.runId, request.args);
  };
