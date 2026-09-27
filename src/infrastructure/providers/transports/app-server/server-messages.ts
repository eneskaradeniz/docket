// Pure translation of app-server notifications into domain AgentEvents. Method names and payload
// shapes follow the protocol's own notification set; a method the client does not know maps to
// no event (it is ignored, never fatal). Contract: docs/v2/providers.md → P-12.
import type { AgentEvent, EpochMs } from '../../../../domain/index';
import { isRecord } from './rate-limits';

const stringField = (holder: unknown, key: string): string | undefined => {
  if (!isRecord(holder)) return undefined;
  const value = holder[key];
  return typeof value === 'string' ? value : undefined;
};

const numberField = (holder: unknown, key: string): number | undefined => {
  if (!isRecord(holder)) return undefined;
  const value = holder[key];
  return typeof value === 'number' && Number.isFinite(value) ? value : undefined;
};

/** Item types that count as tool activity; the protocol's own type name is the tool name and the
 * most identifying string the item carries is the target. */
function toolCallOf(item: unknown, at: EpochMs): AgentEvent | undefined {
  if (!isRecord(item)) return undefined;
  const id = stringField(item, 'id');
  if (id === undefined) return undefined;
  const type = stringField(item, 'type');
  switch (type) {
    case 'commandExecution':
    case 'fileChange':
    case 'dynamicToolCall': {
      const targetKey = type === 'commandExecution' ? 'command' : type === 'dynamicToolCall' ? 'tool' : undefined;
      const target = targetKey === undefined ? undefined : stringField(item, targetKey);
      return target === undefined
        ? { type: 'tool_call', at, id, name: type }
        : { type: 'tool_call', at, id, name: type, target };
    }
    case 'mcpToolCall': {
      const server = stringField(item, 'server');
      const tool = stringField(item, 'tool');
      const target = server !== undefined && tool !== undefined ? `${server}.${tool}` : undefined;
      return target === undefined
        ? { type: 'tool_call', at, id, name: type }
        : { type: 'tool_call', at, id, name: type, target };
    }
    default:
      return undefined;
  }
}

function itemCompleted(item: unknown, at: EpochMs): readonly AgentEvent[] {
  if (!isRecord(item)) return [];
  const id = stringField(item, 'id');
  if (id === undefined) return [];
  switch (stringField(item, 'type')) {
    case 'commandExecution':
    case 'fileChange':
    case 'mcpToolCall':
    case 'dynamicToolCall':
      // "completed" is the protocol's success status; declined and failed both count as not-ok.
      return [{ type: 'tool_result', at, id, ok: stringField(item, 'status') === 'completed' }];
    default:
      return [];
  }
}

function tokenUsage(params: unknown, at: EpochMs): readonly AgentEvent[] {
  if (!isRecord(params)) return [];
  const usage = isRecord(params['tokenUsage']) ? params['tokenUsage'] : undefined;
  const last = usage !== undefined && isRecord(usage['last']) ? usage['last'] : undefined;
  if (last === undefined) return [];
  const cached = numberField(last, 'cachedInputTokens');
  return [
    {
      type: 'usage',
      at,
      inputTokens: numberField(last, 'inputTokens') ?? 0,
      outputTokens: numberField(last, 'outputTokens') ?? 0,
      ...(cached === undefined ? {} : { cachedInputTokens: cached }),
    },
  ];
}

/** Turn end states → finish reasons. A turn still in progress (or an unknown state) produces no
 * finish; only a completed turn settles the run. */
function turnCompleted(turn: unknown, at: EpochMs): readonly AgentEvent[] {
  if (!isRecord(turn)) return [];
  const status = stringField(turn, 'status');
  const reason =
    status === 'completed' ? 'completed' : status === 'failed' ? 'failed' : status === 'interrupted' ? 'cancelled' : undefined;
  if (reason === undefined) return [];
  const message = isRecord(turn['error']) ? stringField(turn['error'], 'message') : undefined;
  return [
    ...(message === undefined || status !== 'failed' ? [] : [{ type: 'error' as const, at, class: 'unknown' as const, message }]),
    { type: 'finished' as const, at, reason },
  ];
}

/** Pure: one server notification → zero or more AgentEvents, all stamped `at`. */
export function mapServerNotification(method: string, params: unknown, at: EpochMs): readonly AgentEvent[] {
  if (method === 'item/agentMessage/delta') {
    const delta = stringField(params, 'delta');
    return delta === undefined ? [] : [{ type: 'text', at, delta }];
  }
  if (method === 'item/reasoning/summaryTextDelta' || method === 'item/reasoning/textDelta') {
    const delta = stringField(params, 'delta');
    return delta === undefined ? [] : [{ type: 'thinking', at, delta }];
  }
  if (method === 'item/started') {
    const call = isRecord(params) ? toolCallOf(params['item'], at) : undefined;
    return call === undefined ? [] : [call];
  }
  if (method === 'item/completed') {
    return isRecord(params) ? itemCompleted(params['item'], at) : [];
  }
  if (method === 'thread/tokenUsage/updated') return tokenUsage(params, at);
  if (method === 'turn/completed') {
    return isRecord(params) ? turnCompleted(params['turn'], at) : [];
  }
  if (method === 'error') {
    const message = isRecord(params) && isRecord(params['error']) ? stringField(params['error'], 'message') : undefined;
    return message === undefined ? [] : [{ type: 'error', at, class: 'unknown', message }];
  }
  return [];
}
