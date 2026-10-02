// Pure translation of SDK stream messages into domain AgentEvents; keeps the fold logic vendor-free.
import type { SDKMessage } from '@anthropic-ai/claude-agent-sdk';
import type { AgentEvent, CostKind, EpochMs } from '../../../../domain/index';

export interface MapContext {
  readonly costKind: CostKind;
}

/** Target keys in lookup order; the first one whose value is a string wins. */
const TARGET_KEYS: readonly string[] = ['file_path', 'path', 'command', 'url', 'pattern'];

function isRecord(value: unknown): value is Readonly<Record<string, unknown>> {
  return typeof value === 'object' && value !== null;
}

/** Pure: one SDK message -> zero or more AgentEvents, all stamped `at`. */
export function mapSdkMessage(message: SDKMessage, at: EpochMs, context: MapContext): readonly AgentEvent[] {
  if (message.type === 'system') {
    return message.subtype === 'init' ? [{ type: 'session_started', at, sessionRef: message.session_id }] : [];
  }
  if (message.type === 'assistant') {
    if (message.error === 'authentication_failed') {
      return [{ type: 'error', at, class: 'auth', message: message.error }];
    }
    const events: AgentEvent[] = [];
    for (const block of message.message.content) {
      if (block.type === 'text') {
        events.push({ type: 'text', at, delta: block.text });
      } else if (block.type === 'thinking') {
        events.push({ type: 'thinking', at, delta: block.thinking });
      } else if (block.type === 'tool_use') {
        const target = toolTarget(isRecord(block.input) ? block.input : {});
        events.push(
          target === undefined
            ? { type: 'tool_call', at, id: block.id, name: block.name }
            : { type: 'tool_call', at, id: block.id, name: block.name, target },
        );
      }
    }
    return events;
  }
  if (message.type === 'user') {
    const content = message.message.content;
    if (typeof content === 'string') return [];
    const events: AgentEvent[] = [];
    for (const block of content) {
      if (block.type === 'tool_result') {
        events.push({ type: 'tool_result', at, id: block.tool_use_id, ok: !block.is_error });
      }
    }
    return events;
  }
  if (message.type === 'result') {
    const thinking = message.usage.output_tokens_details?.thinking_tokens;
    return [
      {
        type: 'usage',
        at,
        inputTokens: message.usage.input_tokens,
        outputTokens: message.usage.output_tokens,
        cachedInputTokens: message.usage.cache_read_input_tokens,
        ...(typeof thinking === 'number' ? { reasoningTokens: thinking } : {}),
        costUsd: message.total_cost_usd,
        costKind: context.costKind,
      },
      { type: 'finished', at, reason: message.subtype === 'success' ? 'completed' : 'failed' },
    ];
  }
  if (message.type === 'rate_limit_event') {
    return mapRateLimitEvent(message.rate_limit_info, at);
  }
  return [];
}

/** The SDK reports resetsAt in epoch seconds; domain times are epoch milliseconds. */
function mapRateLimitEvent(info: Extract<SDKMessage, { type: 'rate_limit_event' }>['rate_limit_info'], at: EpochMs): readonly AgentEvent[] {
  const resetsAtMs: EpochMs | undefined = info.resetsAt === undefined ? undefined : info.resetsAt * 1000;
  const events: AgentEvent[] = [
    {
      type: 'quota_signal',
      at,
      meter: {
        ...(info.rateLimitType === undefined ? {} : { label: info.rateLimitType, poolLabel: info.rateLimitType }),
        cadence: 'fixed',
        unit: 'fraction',
        ...(info.utilization === undefined ? {} : { used: info.utilization }),
        ...(resetsAtMs === undefined ? {} : { resetsAt: resetsAtMs }),
        resetPrecision: 'exact',
        observedAt: at,
        source: 'pushed',
      },
    },
  ];
  if (info.status === 'rejected') {
    events.push({
      type: 'limit_hit',
      at,
      hit: {
        class: 'window_exhausted',
        ...(resetsAtMs === undefined ? {} : { resetsAt: resetsAtMs }),
        remedies: ['wait'],
      },
    });
  }
  return events;
}

export function toolTarget(input: Readonly<Record<string, unknown>>): string | undefined {
  for (const key of TARGET_KEYS) {
    const value = input[key];
    if (typeof value === 'string') return value;
  }
  return undefined;
}
