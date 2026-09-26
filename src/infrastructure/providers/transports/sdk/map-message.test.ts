import { describe, expect, it } from 'vitest';
import { mapSdkMessage, toolTarget, type MapContext } from './map-message';
import type { AgentEvent, EpochMs } from '../../../../domain/index';
import type { SDKMessage } from '@anthropic-ai/claude-agent-sdk';

// Fixtures are built from objects typed as the SDK's own SDKMessage union; no fixture is copied
// from anywhere else — every shape here is read off the SDK's type declarations.

const AT: EpochMs = 1770000000000;
const SESSION_ID = 'sess-sdk-map';
const UUID_A = '00000000-0000-4000-8000-000000000000';
const UUID_B = '00000000-0000-4000-8000-000000000001';

type AssistantMessageBody = Extract<SDKMessage, { type: 'assistant' }>['message'];
type AssistantBlock = AssistantMessageBody['content'][number];
type AssistantError = Extract<SDKMessage, { type: 'assistant' }>['error'];
type UserContent = Extract<SDKMessage, { type: 'user' }>['message']['content'];
type ResultUsage = Extract<SDKMessage, { type: 'result' }>['usage'];
type RateLimitInfo = Extract<SDKMessage, { type: 'rate_limit_event' }>['rate_limit_info'];

function betaUsage(): AssistantMessageBody['usage'] {
  return {
    cache_creation: { ephemeral_1h_input_tokens: 0, ephemeral_5m_input_tokens: 0 },
    cache_creation_input_tokens: 0,
    cache_read_input_tokens: 0,
    fallback_credit: { status: { type: 'redeemed' } },
    inference_geo: null,
    input_tokens: 10,
    iterations: [],
    output_tokens: 5,
    output_tokens_details: { thinking_tokens: 0 },
    server_tool_use: { web_fetch_requests: 0, web_search_requests: 0 },
    service_tier: 'standard',
    speed: 'standard',
  };
}

function assistantBody(blocks: readonly AssistantBlock[]): AssistantMessageBody {
  return {
    id: 'msg_1',
    container: null,
    content: [...blocks],
    context_management: null,
    diagnostics: null,
    model: 'test-model',
    role: 'assistant',
    stop_details: null,
    stop_reason: null,
    stop_sequence: null,
    type: 'message',
    usage: betaUsage(),
  };
}

function assistantMessage(blocks: readonly AssistantBlock[], error?: AssistantError): SDKMessage {
  return {
    type: 'assistant',
    message: assistantBody(blocks),
    parent_tool_use_id: null,
    error,
    uuid: UUID_A,
    session_id: SESSION_ID,
  };
}

const textBlock = (text: string): AssistantBlock => ({ type: 'text', text, citations: null });
const thinkingBlock = (thinking: string): AssistantBlock => ({ type: 'thinking', thinking, signature: 'sig' });
const toolUseBlock = (id: string, name: string, input: unknown): AssistantBlock => ({ type: 'tool_use', id, name, input });

function userMessage(content: UserContent): SDKMessage {
  return {
    type: 'user',
    message: { role: 'user', content },
    parent_tool_use_id: null,
    uuid: UUID_B,
    session_id: SESSION_ID,
  };
}

const toolResultBlock = (toolUseId: string, isError?: boolean): Extract<UserContent, readonly unknown[]>[number] => ({
  type: 'tool_result',
  tool_use_id: toolUseId,
  ...(isError === undefined ? {} : { is_error: isError }),
});

function resultUsage(inputTokens: number, outputTokens: number, cachedRead: number): ResultUsage {
  return {
    cache_creation: { ephemeral_1h_input_tokens: 1, ephemeral_5m_input_tokens: 2 },
    cache_creation_input_tokens: 3,
    cache_read_input_tokens: cachedRead,
    fallback_credit: { status: { type: 'redeemed' } },
    inference_geo: 'eu',
    input_tokens: inputTokens,
    iterations: [],
    output_tokens: outputTokens,
    output_tokens_details: { thinking_tokens: 0 },
    server_tool_use: { web_fetch_requests: 0, web_search_requests: 0 },
    service_tier: 'standard',
    speed: 'standard',
  };
}

function successResult(totalCostUsd: number): SDKMessage {
  return {
    type: 'result',
    subtype: 'success',
    duration_ms: 1200,
    duration_api_ms: 900,
    is_error: false,
    num_turns: 3,
    result: 'done',
    stop_reason: null,
    total_cost_usd: totalCostUsd,
    usage: resultUsage(120, 45, 30),
    modelUsage: {},
    permission_denials: [],
    uuid: UUID_A,
    session_id: SESSION_ID,
  };
}

function failedResult(subtype: 'error_during_execution' | 'error_max_turns' | 'error_max_budget_usd' | 'error_max_structured_output_retries'): SDKMessage {
  return {
    type: 'result',
    subtype,
    duration_ms: 1200,
    duration_api_ms: 900,
    is_error: true,
    num_turns: 3,
    stop_reason: null,
    total_cost_usd: 0.02,
    usage: resultUsage(120, 45, 30),
    modelUsage: {},
    permission_denials: [],
    errors: [],
    uuid: UUID_A,
    session_id: SESSION_ID,
  };
}

function rateLimitEvent(info: RateLimitInfo): SDKMessage {
  return { type: 'rate_limit_event', rate_limit_info: info, uuid: UUID_B, session_id: SESSION_ID };
}

function systemInit(): SDKMessage {
  return {
    type: 'system',
    subtype: 'init',
    apiKeySource: 'user',
    claude_code_version: '2.0.0',
    cwd: '/tmp/docket-map-test',
    tools: [],
    mcp_servers: [],
    model: 'test-model',
    permissionMode: 'default',
    slash_commands: [],
    output_style: 'default',
    skills: [],
    plugins: [],
    uuid: UUID_A,
    session_id: SESSION_ID,
  };
}

function systemApiRetry(): SDKMessage {
  return {
    type: 'system',
    subtype: 'api_retry',
    attempt: 1,
    max_retries: 2,
    retry_delay_ms: 1000,
    error_status: 429,
    error: 'rate_limit',
    uuid: UUID_A,
    session_id: SESSION_ID,
  };
}

describe('mapSdkMessage', () => {
  const context = (costKind: MapContext['costKind']): MapContext => ({ costKind });

  it('I-27: system/init maps to session_started with the session id as sessionRef', () => {
    const expected: readonly AgentEvent[] = [{ type: 'session_started', at: AT, sessionRef: SESSION_ID }];
    expect(mapSdkMessage(systemInit(), AT, context('reported'))).toStrictEqual(expected);
  });

  it('I-27: assistant text block maps to text carrying the block text', () => {
    const expected: readonly AgentEvent[] = [{ type: 'text', at: AT, delta: 'hello operator' }];
    expect(mapSdkMessage(assistantMessage([textBlock('hello operator')]), AT, context('reported'))).toStrictEqual(
      expected,
    );
  });

  it('I-27: assistant thinking block maps to thinking carrying the block thinking', () => {
    const expected: readonly AgentEvent[] = [{ type: 'thinking', at: AT, delta: 'a quiet thought' }];
    expect(mapSdkMessage(assistantMessage([thinkingBlock('a quiet thought')]), AT, context('reported'))).toStrictEqual(
      expected,
    );
  });

  it('I-27: assistant tool_use block maps to tool_call with id, name and target from toolTarget', () => {
    const expected: readonly AgentEvent[] = [
      { type: 'tool_call', at: AT, id: 'tu_1', name: 'Bash', target: 'echo hi' },
    ];
    expect(
      mapSdkMessage(assistantMessage([toolUseBlock('tu_1', 'Bash', { command: 'echo hi' })]), AT, context('reported')),
    ).toStrictEqual(expected);
  });

  it('I-27: assistant tool_call whose input has no target key carries no target field', () => {
    const expected: readonly AgentEvent[] = [{ type: 'tool_call', at: AT, id: 'tu_2', name: 'Thinking' }];
    expect(
      mapSdkMessage(assistantMessage([toolUseBlock('tu_2', 'Thinking', { other: 1 })]), AT, context('reported')),
    ).toStrictEqual(expected);
  });

  it('I-27: assistant content blocks map in order', () => {
    const expected: readonly AgentEvent[] = [
      { type: 'thinking', at: AT, delta: 'plan' },
      { type: 'text', at: AT, delta: 'doing it' },
      { type: 'tool_call', at: AT, id: 'tu_3', name: 'Read', target: 'src/index.ts' },
    ];
    const message = assistantMessage([
      thinkingBlock('plan'),
      textBlock('doing it'),
      toolUseBlock('tu_3', 'Read', { file_path: 'src/index.ts' }),
    ]);
    expect(mapSdkMessage(message, AT, context('reported'))).toStrictEqual(expected);
  });

  it('I-27: assistant blocks other than text, thinking and tool_use produce nothing', () => {
    expect(
      mapSdkMessage(assistantMessage([{ type: 'redacted_thinking', data: 'opaque' }]), AT, context('reported')),
    ).toStrictEqual([]);
  });

  it('I-27: user tool_result block maps to tool_result with id = tool_use_id and ok = !is_error', () => {
    const okExpected: readonly AgentEvent[] = [{ type: 'tool_result', at: AT, id: 'tu_1', ok: true }];
    const errorExpected: readonly AgentEvent[] = [{ type: 'tool_result', at: AT, id: 'tu_1', ok: false }];
    expect(mapSdkMessage(userMessage([toolResultBlock('tu_1', false)]), AT, context('reported'))).toStrictEqual(okExpected);
    expect(mapSdkMessage(userMessage([toolResultBlock('tu_1', true)]), AT, context('reported'))).toStrictEqual(errorExpected);
  });

  it('I-27: user tool_result without is_error maps to ok true', () => {
    const expected: readonly AgentEvent[] = [{ type: 'tool_result', at: AT, id: 'tu_4', ok: true }];
    expect(mapSdkMessage(userMessage([toolResultBlock('tu_4')]), AT, context('reported'))).toStrictEqual(expected);
  });

  it('I-27: several user tool_result blocks map in order', () => {
    const expected: readonly AgentEvent[] = [
      { type: 'tool_result', at: AT, id: 'tu_5', ok: true },
      { type: 'tool_result', at: AT, id: 'tu_6', ok: false },
    ];
    expect(mapSdkMessage(userMessage([toolResultBlock('tu_5'), toolResultBlock('tu_6', true)]), AT, context('reported'))).toStrictEqual(
      expected,
    );
  });

  it('I-27: user message without tool_result blocks maps to nothing', () => {
    expect(mapSdkMessage(userMessage('a plain prompt'), AT, context('reported'))).toStrictEqual([]);
  });

  it('I-27: result maps to usage carrying the context costKind, then finished completed', () => {
    const expected: readonly AgentEvent[] = [
      {
        type: 'usage',
        at: AT,
        inputTokens: 120,
        outputTokens: 45,
        cachedInputTokens: 30,
        costUsd: 0.0123,
        costKind: 'reported',
      },
      { type: 'finished', at: AT, reason: 'completed' },
    ];
    expect(mapSdkMessage(successResult(0.0123), AT, context('reported'))).toStrictEqual(expected);
  });

  it('I-27: result error subtype maps to usage then finished failed', () => {
    const expected: readonly AgentEvent[] = [
      {
        type: 'usage',
        at: AT,
        inputTokens: 120,
        outputTokens: 45,
        cachedInputTokens: 30,
        costUsd: 0.02,
        costKind: 'equivalent',
      },
      { type: 'finished', at: AT, reason: 'failed' },
    ];
    expect(mapSdkMessage(failedResult('error_max_turns'), AT, context('equivalent'))).toStrictEqual(expected);
  });

  it('I-27: every result subtype other than success finishes as failed', () => {
    for (const subtype of ['error_during_execution', 'error_max_budget_usd', 'error_max_structured_output_retries'] as const) {
      const events = mapSdkMessage(failedResult(subtype), AT, context('computed'));
      expect(events.at(-1)).toStrictEqual({ type: 'finished', at: AT, reason: 'failed' });
    }
  });

  it('I-27: rate_limit_event maps to quota_signal with the documented meter fields', () => {
    const expected: readonly AgentEvent[] = [
      {
        type: 'quota_signal',
        at: AT,
        meter: {
          label: 'five_hour',
          poolLabel: 'five_hour',
          cadence: 'fixed',
          unit: 'fraction',
          used: 0.4,
          resetsAt: 1800000000000,
          resetPrecision: 'exact',
          observedAt: AT,
          source: 'pushed',
        },
      },
    ];
    const info: RateLimitInfo = { status: 'allowed', resetsAt: 1800000000, rateLimitType: 'five_hour', utilization: 0.4 };
    expect(mapSdkMessage(rateLimitEvent(info), AT, context('reported'))).toStrictEqual(expected);
  });

  it('I-27: rate_limit_event resetsAt is seconds on the wire and milliseconds in the event', () => {
    const info: RateLimitInfo = { status: 'allowed', resetsAt: 1800000000 };
    const events = mapSdkMessage(rateLimitEvent(info), AT, context('reported'));
    expect(events.length).toBe(1);
    if (events[0].type === 'quota_signal') {
      expect(events[0].meter.resetsAt).toBe(1800000000000);
    } else {
      expect.unreachable('a rate_limit_event with resetsAt must map to quota_signal');
    }
  });

  it('I-27: rate_limit_event fields absent in the message stay absent', () => {
    const expected: readonly AgentEvent[] = [
      {
        type: 'quota_signal',
        at: AT,
        meter: {
          cadence: 'fixed',
          unit: 'fraction',
          resetPrecision: 'exact',
          observedAt: AT,
          source: 'pushed',
        },
      },
    ];
    expect(mapSdkMessage(rateLimitEvent({ status: 'allowed_warning' }), AT, context('reported'))).toStrictEqual(
      expected,
    );
  });

  it('I-27: rate_limit_event with status rejected also maps to limit_hit', () => {
    const expected: readonly AgentEvent[] = [
      {
        type: 'quota_signal',
        at: AT,
        meter: {
          label: 'seven_day',
          poolLabel: 'seven_day',
          cadence: 'fixed',
          unit: 'fraction',
          used: 1,
          resetsAt: 1900000000000,
          resetPrecision: 'exact',
          observedAt: AT,
          source: 'pushed',
        },
      },
      {
        type: 'limit_hit',
        at: AT,
        hit: { class: 'window_exhausted', resetsAt: 1900000000000, remedies: ['wait'] },
      },
    ];
    const info: RateLimitInfo = { status: 'rejected', resetsAt: 1900000000, rateLimitType: 'seven_day', utilization: 1 };
    expect(mapSdkMessage(rateLimitEvent(info), AT, context('equivalent'))).toStrictEqual(expected);
  });

  it('I-27: rejected rate_limit_event without resetsAt hits the limit without a reset time', () => {
    const expected: readonly AgentEvent[] = [
      {
        type: 'quota_signal',
        at: AT,
        meter: { cadence: 'fixed', unit: 'fraction', resetPrecision: 'exact', observedAt: AT, source: 'pushed' },
      },
      { type: 'limit_hit', at: AT, hit: { class: 'window_exhausted', remedies: ['wait'] } },
    ];
    const events = mapSdkMessage(rateLimitEvent({ status: 'rejected' }), AT, context('reported'));
    expect(events).toEqual(expected);
    const hit = events[1];
    if (hit.type === 'limit_hit') expect('resetsAt' in hit.hit).toBe(false);
    else expect.unreachable('a rejected rate limit must also emit limit_hit');
  });

  it('I-27: assistant message with error authentication_failed maps to an auth error', () => {
    const expected: readonly AgentEvent[] = [
      { type: 'error', at: AT, class: 'auth', message: 'authentication_failed' },
    ];
    expect(mapSdkMessage(assistantMessage([], 'authentication_failed'), AT, context('reported'))).toStrictEqual(
      expected,
    );
  });

  it('I-27: every other message maps to an empty list', () => {
    expect(mapSdkMessage(systemApiRetry(), AT, context('reported'))).toStrictEqual([]);
  });
});

describe('toolTarget', () => {
  it('I-27: returns file_path when present', () => {
    expect(toolTarget({ file_path: 'src/main.ts' })).toBe('src/main.ts');
  });

  it('I-27: falls back through path, command, url and pattern in order', () => {
    expect(toolTarget({ path: 'notes.md' })).toBe('notes.md');
    expect(toolTarget({ command: 'npm test' })).toBe('npm test');
    expect(toolTarget({ url: 'https://example.test/x' })).toBe('https://example.test/x');
    expect(toolTarget({ pattern: 'src/**/*.ts' })).toBe('src/**/*.ts');
    expect(toolTarget({ file_path: 'f.ts', path: 'p.md', command: 'c', url: 'u', pattern: 'pat' })).toBe('f.ts');
    expect(toolTarget({ path: 'p.md', command: 'c', url: 'u', pattern: 'pat' })).toBe('p.md');
    expect(toolTarget({ command: 'c', url: 'u', pattern: 'pat' })).toBe('c');
    expect(toolTarget({ url: 'u', pattern: 'pat' })).toBe('u');
  });

  it('I-27: ignores values that are not strings', () => {
    expect(toolTarget({ file_path: 42, command: 'npm test' })).toBe('npm test');
    expect(toolTarget({ path: null, url: true, pattern: ['a'] })).toBeUndefined();
  });

  it('I-27: returns undefined when none of the target keys is present', () => {
    expect(toolTarget({})).toBeUndefined();
    expect(toolTarget({ other: 'x', count: 3 })).toBeUndefined();
  });
});
