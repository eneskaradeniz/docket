import { describe, expect, it } from 'vitest';
import { createSdkTransport, type QueryFn } from './transport';
import {
  createFakeAccountRepo,
  createFakeClock,
  createFakeSecretVault,
} from '../../../../application/ports/fakes/index';
import type { AccountRecord, RunHandle, RunRequest, TransportError } from '../../../../application/index';
import type { Result } from '../../../../domain/index';
import {
  parseSlug,
  parseUlid,
  type AccountId,
  type AgentEvent,
  type CapabilityDef,
  type EpochMs,
  type RoleDef,
  type RoleSlug,
  type RunId,
} from '../../../../domain/index';
import type {
  CanUseTool,
  Options,
  PermissionResult,
  Query,
  SDKMessage,
  SDKUserMessage,
} from '@anthropic-ai/claude-agent-sdk';

// The fake query keeps every test off a real agent CLI: scripts are async generators built from the
// SDK's own type declarations, wrapped into the Query interface the transport consumes.

const SESSION_ID = 'sess-sdk-transport';
const UUID_A = '00000000-0000-4000-8000-000000000000';

function slugOf<B extends string>(input: string) {
  const parsed = parseSlug<B>(input);
  if (!parsed.ok) throw new Error('fixture slug must parse');
  return parsed.value;
}

function ulidOf<B extends string>(input: string) {
  const parsed = parseUlid<B>(input);
  if (!parsed.ok) throw new Error('fixture ulid must parse');
  return parsed.value;
}

const RUN_ID: RunId = ulidOf<'run'>('01ARZ3NDEKTSV4RRFFQ69G5FBV');
const ACCOUNT: AccountId = ulidOf<'account'>('01ARZ3NDEKTSV4RRFFQ69G5FAV');
const ROLE: RoleSlug = slugOf<'role'>('implementer');

// Credential-looking values are assembled at runtime, never written as one literal.
const API_KEY = 'AKIA' + 'X'.repeat(16);
const ENV_VALUE = 'docket-env' + '-' + 'never-in-events';
const START_AT: EpochMs = 1770000000000;

const ROLE_DEF: RoleDef = {
  id: ROLE,
  name: 'Implementer',
  instructions: 'Follow the work order exactly.',
  writeScope: { kind: 'repo' },
  capabilities: [],
  active: true,
};

function account(authMode: AccountRecord['authMode'], secretRef?: string): AccountRecord {
  return {
    id: ACCOUNT,
    provider: 'agent-cli',
    label: 'main',
    authMode,
    limitPolicy: 'wait_resume',
    ...(secretRef === undefined ? {} : { secretRef }),
    caps: [],
  };
}

function request(overrides?: Partial<RunRequest>): RunRequest {
  return {
    runId: RUN_ID,
    cwd: '/tmp/docket-sdk-transport',
    role: ROLE_DEF,
    route: { accountId: ACCOUNT },
    prompt: 'do the work',
    capabilities: [],
    ...overrides,
  };
}

function unwrap(started: Result<RunHandle, TransportError>): RunHandle {
  if (!started.ok) throw new Error(`expected a started run, got ${started.error.code}`);
  return started.value;
}

async function collect(events: AsyncIterable<AgentEvent>): Promise<readonly AgentEvent[]> {
  const collected: AgentEvent[] = [];
  for await (const event of events) collected.push(event);
  return collected;
}

const defer = (): { readonly promise: Promise<void>; readonly resolve: () => void } => {
  let resolve: (() => void) | undefined;
  const promise = new Promise<void>((res) => {
    resolve = res;
  });
  return { promise, resolve: () => resolve?.() };
};

// --- SDK message fixtures (shapes read off the SDK's own declarations) ---

type AssistantMessageBody = Extract<SDKMessage, { type: 'assistant' }>['message'];
type AssistantBlock = AssistantMessageBody['content'][number];
type ResultUsage = Extract<SDKMessage, { type: 'result' }>['usage'];

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

function systemInit(): SDKMessage {
  return {
    type: 'system',
    subtype: 'init',
    apiKeySource: 'user',
    claude_code_version: '2.0.0',
    cwd: '/tmp/docket-sdk-transport',
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

function assistantToolUse(id: string, name: string, input: unknown): SDKMessage {
  const block: AssistantBlock = { type: 'tool_use', id, name, input };
  return {
    type: 'assistant',
    message: {
      id: 'msg_1',
      container: null,
      content: [block],
      context_management: null,
      diagnostics: null,
      model: 'test-model',
      role: 'assistant',
      stop_details: null,
      stop_reason: null,
      stop_sequence: null,
      type: 'message',
      usage: betaUsage(),
    },
    parent_tool_use_id: null,
    uuid: UUID_A,
    session_id: SESSION_ID,
  };
}

function resultUsage(inputTokens: number, outputTokens: number): ResultUsage {
  return {
    cache_creation: { ephemeral_1h_input_tokens: 1, ephemeral_5m_input_tokens: 2 },
    cache_creation_input_tokens: 3,
    cache_read_input_tokens: 4,
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
    usage: resultUsage(120, 45),
    modelUsage: {},
    permission_denials: [],
    uuid: UUID_A,
    session_id: SESSION_ID,
  };
}

// --- fake query ---

interface CapturedCall {
  readonly prompt: string | AsyncIterable<SDKUserMessage>;
  readonly options: Options;
}

type Script = (call: CapturedCall) => AsyncGenerator<SDKMessage, void>;

/** The transport must always stream its prompt; a plain string here breaks that contract. */
function promptStreamOf(call: CapturedCall): AsyncIterable<SDKUserMessage> {
  if (typeof call.prompt === 'string') throw new Error('the transport must pass a streaming prompt');
  return call.prompt;
}

/** Minimal Query: the generator drives the messages, every control request is explicitly unsupported. */
function asQuery(generator: AsyncGenerator<SDKMessage, void>): Query {
  const unsupported = (): Promise<never> => Promise.reject(new Error('fake query: control request not scripted'));
  const query: Query = Object.assign(generator, {
    interrupt: (): Promise<undefined> => Promise.resolve(undefined),
    setPermissionMode: (): Promise<void> => Promise.resolve(),
    setMcpPermissionModeOverride: (): Promise<{ warning?: string }> => Promise.resolve({}),
    setModel: (): Promise<void> => Promise.resolve(),
    setMaxThinkingTokens: (): Promise<void> => Promise.resolve(),
    applyFlagSettings: (): Promise<void> => Promise.resolve(),
    initializationResult: unsupported,
    reinitialize: unsupported,
    supportedCommands: unsupported,
    supportedModels: unsupported,
    supportedAgents: unsupported,
    mcpServerStatus: unsupported,
    getContextUsage: unsupported,
    usage_EXPERIMENTAL_MAY_CHANGE_DO_NOT_RELY_ON_THIS_API_YET: unsupported,
    readFile: unsupported,
    reloadPlugins: unsupported,
    reloadSkills: unsupported,
    accountInfo: unsupported,
    rewindFiles: unsupported,
    seedReadState: (): Promise<void> => Promise.resolve(),
    reconnectMcpServer: (): Promise<void> => Promise.resolve(),
    toggleMcpServer: (): Promise<void> => Promise.resolve(),
    setMcpServers: unsupported,
    streamInput: (): Promise<void> => Promise.resolve(),
    stopTask: (): Promise<void> => Promise.resolve(),
    backgroundTasks: (): Promise<boolean> => Promise.resolve(false),
    // Required by a module augmentation active in this program, not by the SDK's own declarations;
    // an extra member is harmless here because Object.assign's intersection is never fresh.
    cancelAsyncMessage: (): Promise<boolean> => Promise.resolve(false),
    close: (): void => {},
  });
  return query;
}

function scriptedQuery(script: Script): { readonly query: QueryFn; readonly calls: readonly CapturedCall[] } {
  const calls: CapturedCall[] = [];
  const query: QueryFn = (params) => {
    const call: CapturedCall = { prompt: params.prompt, options: params.options ?? {} };
    calls.push(call);
    return asQuery(script(call));
  };
  return { query, calls };
}

/** What the SDK-side caller observed for one permission ask. */
interface ToolAsk {
  readonly toolName: string;
  readonly input: Record<string, unknown>;
  readonly result: PermissionResult | null | undefined;
}

/** Calls the transport's canUseTool and records what the SDK-side caller got back. */
async function askTool(
  call: CapturedCall,
  toolName: string,
  input: Record<string, unknown>,
  toolUseId: string,
  requestId: string,
): Promise<ToolAsk> {
  const result = await canUseToolOf(call)?.(toolName, input, {
    signal: new AbortController().signal,
    toolUseID: toolUseId,
    requestId,
  });
  return { toolName, input, result };
}

function canUseToolOf(call: CapturedCall): CanUseTool | undefined {
  return call.options.canUseTool;
}

/** Ends only when the transport aborts the run — proves stop() really aborted the query. */
async function* waitForAbort(call: CapturedCall): AsyncGenerator<SDKMessage, void> {
  await new Promise<void>((_, reject) => {
    call.options.abortController?.signal.addEventListener(
      'abort',
      () => reject(new Error('query aborted by stop()')),
      { once: true },
    );
  });
}

function contentOf(message: SDKUserMessage | undefined): unknown {
  if (message === undefined) throw new Error('expected a streamed user message');
  return message.message.content;
}

/** Collects all events of a run, allowing every permission ask as it appears. */
async function collectAsks(
  transport: ReturnType<typeof createSdkTransport>,
  run: RunRequest,
): Promise<readonly Extract<AgentEvent, { type: 'permission_ask' }>[]> {
  const handle = unwrap(await transport.start(run));
  const asks: Extract<AgentEvent, { type: 'permission_ask' }>[] = [];
  for await (const event of handle.events) {
    if (event.type === 'permission_ask') {
      asks.push(event);
      handle.answerPermission(event.id, 'allow');
    }
  }
  return asks;
}

describe('createSdkTransport', () => {
  describe('start', () => {
    it('I-28: an unknown account fails with unsupported before any query runs', async () => {
      const { query, calls } = scriptedQuery(async function* () {
        yield systemInit();
      });
      const transport = createSdkTransport({
        clock: createFakeClock(START_AT),
        accounts: createFakeAccountRepo(),
        secrets: createFakeSecretVault(),
        baseEnv: {},
        query,
      });

      const started = await transport.start(request());

      expect(started.ok).toBe(false);
      if (!started.ok) expect(started.error.code).toBe('unsupported');
      expect(calls.length).toBe(0);
    });

    it('I-28: a cloud account is unsupported', async () => {
      const accounts = createFakeAccountRepo();
      await accounts.save(account('cloud'));
      const { query, calls } = scriptedQuery(async function* () {
        yield systemInit();
      });
      const transport = createSdkTransport({
        clock: createFakeClock(START_AT),
        accounts,
        secrets: createFakeSecretVault(),
        baseEnv: {},
        query,
      });

      const started = await transport.start(request());

      expect(started.ok).toBe(false);
      if (!started.ok) expect(started.error.code).toBe('unsupported');
      expect(calls.length).toBe(0);
    });

    it('I-28: a byok account is unsupported', async () => {
      const accounts = createFakeAccountRepo();
      await accounts.save(account('byok', 'ref-byok'));
      const { query, calls } = scriptedQuery(async function* () {
        yield systemInit();
      });
      const transport = createSdkTransport({
        clock: createFakeClock(START_AT),
        accounts,
        secrets: createFakeSecretVault(),
        baseEnv: {},
        query,
      });

      const started = await transport.start(request());

      expect(started.ok).toBe(false);
      if (!started.ok) expect(started.error.code).toBe('unsupported');
      expect(calls.length).toBe(0);
    });

    it('I-28: an api_key account whose vault entry is missing fails with not_logged_in', async () => {
      const accounts = createFakeAccountRepo();
      await accounts.save(account('api_key', 'ref-absent'));
      const { query, calls } = scriptedQuery(async function* () {
        yield systemInit();
      });
      const transport = createSdkTransport({
        clock: createFakeClock(START_AT),
        accounts,
        secrets: createFakeSecretVault(),
        baseEnv: {},
        query,
      });

      const started = await transport.start(request());

      expect(started.ok).toBe(false);
      if (!started.ok) expect(started.error.code).toBe('not_logged_in');
      expect(calls.length).toBe(0);
    });

    it('I-28: an api_key account without a secret reference fails with not_logged_in', async () => {
      const accounts = createFakeAccountRepo();
      await accounts.save(account('api_key'));
      const { query } = scriptedQuery(async function* () {
        yield systemInit();
      });
      const transport = createSdkTransport({
        clock: createFakeClock(START_AT),
        accounts,
        secrets: createFakeSecretVault(),
        baseEnv: {},
        query,
      });

      const started = await transport.start(request());

      expect(started.ok).toBe(false);
      if (!started.ok) expect(started.error.code).toBe('not_logged_in');
    });

    it('I-28: the environment is the allowlist without the vendor credential variables, plus the vault api key', async () => {
      const accounts = createFakeAccountRepo();
      await accounts.save(account('api_key', 'ref-key'));
      const secrets = createFakeSecretVault();
      await secrets.put('ref-key', API_KEY);
      const { query, calls } = scriptedQuery(async function* () {
        yield successResult(0.01);
      });
      const transport = createSdkTransport({
        clock: createFakeClock(START_AT),
        accounts,
        secrets,
        baseEnv: {
          DOCKET_HOME: '/tmp/docket-home',
          ANTHROPIC_API_KEY: 'stale-not-the-real-key',
          ANTHROPIC_AUTH_TOKEN: 'stale-token',
          SHELL: '/bin/zsh',
        },
        query,
      });

      const events = await collect(unwrap(await transport.start(request())).events);

      expect(events.map((event) => event.type)).toEqual(['usage', 'finished']);
      expect(calls[0]?.options.env).toEqual({
        DOCKET_HOME: '/tmp/docket-home',
        SHELL: '/bin/zsh',
        ANTHROPIC_API_KEY: API_KEY,
      });
    });

    it('I-28: an api_key run reports usage with costKind reported', async () => {
      const accounts = createFakeAccountRepo();
      await accounts.save(account('api_key', 'ref-key'));
      const secrets = createFakeSecretVault();
      await secrets.put('ref-key', API_KEY);
      const { query } = scriptedQuery(async function* () {
        yield successResult(0.02);
      });
      const transport = createSdkTransport({
        clock: createFakeClock(START_AT),
        accounts,
        secrets,
        baseEnv: {},
        query,
      });

      const events = await collect(unwrap(await transport.start(request())).events);
      const usage = events.find((event) => event.type === 'usage');

      expect(usage).toBeDefined();
      if (usage?.type === 'usage') expect(usage.costKind).toBe('reported');
    });

    it('I-28: a subscription run reports usage with costKind equivalent', async () => {
      const accounts = createFakeAccountRepo();
      await accounts.save(account('subscription'));
      const { query } = scriptedQuery(async function* () {
        yield successResult(0.03);
      });
      const transport = createSdkTransport({
        clock: createFakeClock(START_AT),
        accounts,
        secrets: createFakeSecretVault(),
        baseEnv: {},
        query,
      });

      const events = await collect(unwrap(await transport.start(request())).events);
      const usage = events.find((event) => event.type === 'usage');

      expect(usage).toBeDefined();
      if (usage?.type === 'usage') expect(usage.costKind).toBe('equivalent');
    });

    it('I-28: options carry cwd, model, resume, empty setting sources, the preset system prompt and the executable path', async () => {
      const accounts = createFakeAccountRepo();
      await accounts.save(account('subscription'));
      const { query, calls } = scriptedQuery(async function* () {
        yield successResult(0);
      });
      const transport = createSdkTransport({
        clock: createFakeClock(START_AT),
        accounts,
        secrets: createFakeSecretVault(),
        baseEnv: {},
        executablePath: '/opt/agent/bin/agent',
        query,
      });

      const handle = unwrap(
        await transport.start(
          request({ route: { accountId: ACCOUNT, model: 'model-x' }, resume: { sessionRef: 'sess-42' } }),
        ),
      );
      await collect(handle.events);

      const options = calls[0]?.options;
      expect(options?.cwd).toBe('/tmp/docket-sdk-transport');
      expect(options?.model).toBe('model-x');
      expect(options?.resume).toBe('sess-42');
      expect(options?.settingSources).toEqual([]);
      expect(options?.systemPrompt).toStrictEqual({
        type: 'preset',
        preset: 'claude_code',
        append: 'Follow the work order exactly.',
      });
      expect(options?.pathToClaudeCodeExecutable).toBe('/opt/agent/bin/agent');
    });

    it('I-28: without a model, resume or executable path the SDK defaults stay in place', async () => {
      const accounts = createFakeAccountRepo();
      await accounts.save(account('subscription'));
      const { query, calls } = scriptedQuery(async function* () {
        yield successResult(0);
      });
      const transport = createSdkTransport({
        clock: createFakeClock(START_AT),
        accounts,
        secrets: createFakeSecretVault(),
        baseEnv: {},
        query,
      });

      const handle = unwrap(await transport.start(request()));
      await collect(handle.events);

      const options = calls[0]?.options;
      expect(options?.model).toBeUndefined();
      expect(options?.resume).toBeUndefined();
      expect(options?.pathToClaudeCodeExecutable).toBeUndefined();
      expect(options?.mcpServers).toEqual({});
    });

    it('I-28: mcp capabilities become stdio servers with literal and vault-resolved env values', async () => {
      const accounts = createFakeAccountRepo();
      await accounts.save(account('subscription'));
      const secrets = createFakeSecretVault();
      await secrets.put('ref-mcp', 'mcp-' + 'token' + '-value');
      const capabilities: readonly CapabilityDef[] = [
        {
          kind: 'mcp',
          id: slugOf<'capability'>('fs-search'),
          name: 'FS Search',
          command: 'npx',
          args: ['-y', 'fs-search-server'],
          env: { LITERAL_FLAG: { literal: 'on' }, SEARCH_TOKEN: { secretRef: 'ref-mcp' } },
        },
        { kind: 'context', id: slugOf<'capability'>('docs'), name: 'Docs', path: 'docs' },
      ];
      const { query, calls } = scriptedQuery(async function* () {
        yield successResult(0);
      });
      const transport = createSdkTransport({
        clock: createFakeClock(START_AT),
        accounts,
        secrets,
        baseEnv: {},
        query,
      });

      const handle = unwrap(await transport.start(request({ capabilities })));
      await collect(handle.events);

      expect(calls[0]?.options.mcpServers).toEqual({
        'fs-search': {
          command: 'npx',
          args: ['-y', 'fs-search-server'],
          env: { LITERAL_FLAG: 'on', SEARCH_TOKEN: 'mcp-token-value' },
        },
      });
    });

    it('I-28: an mcp env secret reference the vault cannot resolve fails with not_logged_in', async () => {
      const accounts = createFakeAccountRepo();
      await accounts.save(account('subscription'));
      const capabilities: readonly CapabilityDef[] = [
        {
          kind: 'mcp',
          id: slugOf<'capability'>('fs-search'),
          name: 'FS Search',
          command: 'npx',
          args: [],
          env: { SEARCH_TOKEN: { secretRef: 'ref-mcp-absent' } },
        },
      ];
      const { query, calls } = scriptedQuery(async function* () {
        yield successResult(0);
      });
      const transport = createSdkTransport({
        clock: createFakeClock(START_AT),
        accounts,
        secrets: createFakeSecretVault(),
        baseEnv: {},
        query,
      });

      const started = await transport.start(request({ capabilities }));

      expect(started.ok).toBe(false);
      if (!started.ok) expect(started.error.code).toBe('not_logged_in');
      expect(calls.length).toBe(0);
    });
  });

  describe('answerPermission', () => {
    it('I-29: a scripted session yields session_started, tool_call, permission_ask, usage and finished in order once answered', async () => {
      const accounts = createFakeAccountRepo();
      await accounts.save(account('subscription'));
      const asks: ToolAsk[] = [];
      const { query } = scriptedQuery(async function* (call) {
        yield systemInit();
        yield assistantToolUse('toolu_1', 'Write', { file_path: '/tmp/docket-run/a.ts' });
        asks.push(await askTool(call, 'Write', { file_path: '/tmp/docket-run/a.ts' }, 'toolu_1', 'req-1'));
        yield successResult(0.12);
      });
      const transport = createSdkTransport({
        clock: createFakeClock(START_AT),
        accounts,
        secrets: createFakeSecretVault(),
        baseEnv: {},
        query,
      });

      const handle = unwrap(await transport.start(request()));
      const collected: AgentEvent[] = [];
      for await (const event of handle.events) {
        collected.push(event);
        if (event.type === 'permission_ask') handle.answerPermission(event.id, 'allow');
      }

      expect(collected.map((event) => event.type)).toEqual([
        'session_started',
        'tool_call',
        'permission_ask',
        'usage',
        'finished',
      ]);
      expect(collected[0]).toStrictEqual({ type: 'session_started', at: START_AT, sessionRef: SESSION_ID });
      expect(collected[1]).toStrictEqual({
        type: 'tool_call',
        at: START_AT,
        id: 'toolu_1',
        name: 'Write',
        target: '/tmp/docket-run/a.ts',
      });
      expect(collected[2]).toStrictEqual({
        type: 'permission_ask',
        at: START_AT,
        id: 'ask-1',
        tool: 'Write',
        target: '/tmp/docket-run/a.ts',
        options: ['allow', 'deny'],
      });
      expect(collected[4]).toStrictEqual({ type: 'finished', at: START_AT, reason: 'completed' });
      expect(asks[0]?.result).toStrictEqual({
        behavior: 'allow',
        updatedInput: { file_path: '/tmp/docket-run/a.ts' },
      });
    });

    it('I-29: asks are numbered per run and carry the tool name and target', async () => {
      const accounts = createFakeAccountRepo();
      await accounts.save(account('subscription'));
      const { query } = scriptedQuery(async function* (call) {
        yield assistantToolUse('t1', 'Write', { file_path: '/tmp/one' });
        await askTool(call, 'Write', { file_path: '/tmp/one' }, 't1', 'r1');
        yield assistantToolUse('t2', 'Bash', { command: 'npm test' });
        await askTool(call, 'Bash', { command: 'npm test' }, 't2', 'r2');
        yield successResult(0);
      });
      const transport = createSdkTransport({
        clock: createFakeClock(START_AT),
        accounts,
        secrets: createFakeSecretVault(),
        baseEnv: {},
        query,
      });

      const first = await collectAsks(transport, request());
      const second = await collectAsks(transport, request({ prompt: 'again' }));

      expect(first.map((event) => event.id)).toEqual(['ask-1', 'ask-2']);
      expect(first[0]).toMatchObject({ tool: 'Write', target: '/tmp/one' });
      expect(first[1]).toMatchObject({ tool: 'Bash', target: 'npm test' });
      expect(second.map((event) => event.id)).toEqual(['ask-1', 'ask-2']);
    });

    it('I-29: allow passes the input through untouched, deny answers with the operator denial message', async () => {
      const accounts = createFakeAccountRepo();
      await accounts.save(account('subscription'));
      const asks: ToolAsk[] = [];
      const { query } = scriptedQuery(async function* (call) {
        asks.push(await askTool(call, 'Write', { file_path: '/tmp/one' }, 't1', 'r1'));
        asks.push(await askTool(call, 'Bash', { command: 'npm test' }, 't2', 'r2'));
        yield successResult(0);
      });
      const transport = createSdkTransport({
        clock: createFakeClock(START_AT),
        accounts,
        secrets: createFakeSecretVault(),
        baseEnv: {},
        query,
      });

      const handle = unwrap(await transport.start(request()));
      let index = 0;
      for await (const event of handle.events) {
        if (event.type === 'permission_ask') {
          handle.answerPermission(event.id, index === 0 ? 'allow' : 'deny');
          index += 1;
        }
      }

      expect(asks[0]?.result).toStrictEqual({ behavior: 'allow', updatedInput: { file_path: '/tmp/one' } });
      expect(asks[1]?.result).toStrictEqual({ behavior: 'deny', message: 'Denied by the operator' });
    });

    it('I-29: an unknown or repeated askId is ignored', async () => {
      const accounts = createFakeAccountRepo();
      await accounts.save(account('subscription'));
      const asks: ToolAsk[] = [];
      const { query } = scriptedQuery(async function* (call) {
        asks.push(await askTool(call, 'Write', { file_path: '/tmp/one' }, 't1', 'r1'));
        yield successResult(0);
      });
      const transport = createSdkTransport({
        clock: createFakeClock(START_AT),
        accounts,
        secrets: createFakeSecretVault(),
        baseEnv: {},
        query,
      });

      const handle = unwrap(await transport.start(request()));
      const collected: AgentEvent[] = [];
      for await (const event of handle.events) {
        collected.push(event);
        if (event.type === 'permission_ask') {
          handle.answerPermission('ask-99', 'deny'); // unknown id: must not settle the real ask
          expect(asks.length).toBe(0);
          handle.answerPermission(event.id, 'allow');
          handle.answerPermission(event.id, 'deny'); // repeated id: the allow stands
        }
      }

      expect(asks[0]?.result).toStrictEqual({ behavior: 'allow', updatedInput: { file_path: '/tmp/one' } });
      expect(collected.filter((event) => event.type === 'permission_ask')).toHaveLength(1);
    });

    it('I-29: aborting the ask signal denies the tool', async () => {
      const accounts = createFakeAccountRepo();
      await accounts.save(account('subscription'));
      const asks: ToolAsk[] = [];
      const { query } = scriptedQuery(async function* (call) {
        const controller = new AbortController();
        const pending = canUseToolOf(call)?.('Write', { file_path: '/tmp/one' }, {
          signal: controller.signal,
          toolUseID: 't1',
          requestId: 'r1',
        });
        controller.abort();
        asks.push({
          toolName: 'Write',
          input: { file_path: '/tmp/one' },
          result: await pending,
        });
        yield successResult(0);
      });
      const transport = createSdkTransport({
        clock: createFakeClock(START_AT),
        accounts,
        secrets: createFakeSecretVault(),
        baseEnv: {},
        query,
      });

      const events = await collect(unwrap(await transport.start(request())).events);

      expect(asks[0]?.result).toStrictEqual({ behavior: 'deny', message: 'Denied by the operator' });
      expect(events.some((event) => event.type === 'permission_ask')).toBe(true);
    });
  });

  describe('steer', () => {
    it('I-28: the first streamed message is the request prompt and steer sends the note as a further user message', async () => {
      const accounts = createFakeAccountRepo();
      await accounts.save(account('subscription'));
      const seen: unknown[] = [];
      const { query } = scriptedQuery(async function* (call) {
        const reader = promptStreamOf(call)[Symbol.asyncIterator]();
        const first = await reader.next();
        yield systemInit();
        const second = await reader.next();
        seen.push(contentOf(first.value), contentOf(second.value));
        yield successResult(0);
      });
      const transport = createSdkTransport({
        clock: createFakeClock(START_AT),
        accounts,
        secrets: createFakeSecretVault(),
        baseEnv: {},
        query,
      });

      const handle = unwrap(await transport.start(request({ prompt: 'do the work' })));
      const collecting = collect(handle.events);
      await new Promise((resolve) => setTimeout(resolve, 0));
      handle.steer('new direction from the operator');
      const events = await collecting;

      expect(seen).toEqual(['do the work', 'new direction from the operator']);
      expect(events.map((event) => event.type)).toEqual(['session_started', 'usage', 'finished']);
    });
  });

  describe('stop', () => {
    it('I-30: stop mid-stream aborts the query and ends the events with exactly one finished cancelled', async () => {
      const accounts = createFakeAccountRepo();
      await accounts.save(account('subscription'));
      const afterInit = defer();
      const { query, calls } = scriptedQuery(async function* (call) {
        yield systemInit();
        afterInit.resolve();
        yield* waitForAbort(call);
      });
      const transport = createSdkTransport({
        clock: createFakeClock(START_AT),
        accounts,
        secrets: createFakeSecretVault(),
        baseEnv: {},
        query,
      });

      const handle = unwrap(await transport.start(request()));
      const collecting = collect(handle.events);
      await afterInit.promise;
      await handle.stop();
      const events = await collecting;

      expect(calls[0]?.options.abortController?.signal.aborted).toBe(true);
      expect(events.map((event) => event.type)).toEqual(['session_started', 'finished']);
      expect(events[events.length - 1]).toStrictEqual({ type: 'finished', at: START_AT, reason: 'cancelled' });
      expect(events.filter((event) => event.type === 'finished')).toHaveLength(1);
    });

    it('I-30: stop after the run already finished leaves the single finished in place', async () => {
      const accounts = createFakeAccountRepo();
      await accounts.save(account('subscription'));
      const { query } = scriptedQuery(async function* () {
        yield successResult(0);
      });
      const transport = createSdkTransport({
        clock: createFakeClock(START_AT),
        accounts,
        secrets: createFakeSecretVault(),
        baseEnv: {},
        query,
      });

      const handle = unwrap(await transport.start(request()));
      const events = await collect(handle.events);
      await handle.stop();

      expect(events.filter((event) => event.type === 'finished')).toHaveLength(1);
      const last = events[events.length - 1];
      if (last?.type === 'finished') expect(last.reason).toBe('completed');
    });
  });

  describe('events', () => {
    it('I-30: a successful result ends the stream with exactly one finished after the usage event', async () => {
      const accounts = createFakeAccountRepo();
      await accounts.save(account('subscription'));
      const { query } = scriptedQuery(async function* () {
        yield systemInit();
        yield successResult(0.05);
      });
      const transport = createSdkTransport({
        clock: createFakeClock(START_AT),
        accounts,
        secrets: createFakeSecretVault(),
        baseEnv: {},
        query,
      });

      const events = await collect(unwrap(await transport.start(request())).events);

      expect(events.map((event) => event.type)).toEqual(['session_started', 'usage', 'finished']);
      expect(events.filter((event) => event.type === 'finished')).toHaveLength(1);
      expect(events[events.length - 1]?.type).toBe('finished');
    });

    it('I-30: a thrown SDK error emits an error crash event and then finished failed', async () => {
      const accounts = createFakeAccountRepo();
      await accounts.save(account('subscription'));
      const { query } = scriptedQuery(async function* () {
        yield systemInit();
        throw new Error('the agent process exploded');
      });
      const transport = createSdkTransport({
        clock: createFakeClock(START_AT),
        accounts,
        secrets: createFakeSecretVault(),
        baseEnv: {},
        query,
      });

      const events = await collect(unwrap(await transport.start(request())).events);

      expect(events.map((event) => event.type)).toEqual(['session_started', 'error', 'finished']);
      expect(events[1]).toMatchObject({ class: 'crash' });
      expect(JSON.stringify(events)).not.toContain('exploded');
      expect(events.filter((event) => event.type === 'finished')).toHaveLength(1);
      const last = events[events.length - 1];
      if (last?.type === 'finished') expect(last.reason).toBe('failed');
    });

    it('I-30: a stream that ends without a result still ends with exactly one finished', async () => {
      const accounts = createFakeAccountRepo();
      await accounts.save(account('subscription'));
      const { query } = scriptedQuery(async function* () {
        yield systemInit();
      });
      const transport = createSdkTransport({
        clock: createFakeClock(START_AT),
        accounts,
        secrets: createFakeSecretVault(),
        baseEnv: {},
        query,
      });

      const events = await collect(unwrap(await transport.start(request())).events);

      expect(events.filter((event) => event.type === 'finished')).toHaveLength(1);
      expect(events[events.length - 1]?.type).toBe('finished');
    });

    it('I-30: no event ever contains the api key or an environment value', async () => {
      const accounts = createFakeAccountRepo();
      await accounts.save(account('api_key', 'ref-key'));
      const secrets = createFakeSecretVault();
      await secrets.put('ref-key', API_KEY);
      const { query } = scriptedQuery(async function* () {
        yield systemInit();
        throw new Error(`crash context ${API_KEY} ${ENV_VALUE}`);
      });
      const transport = createSdkTransport({
        clock: createFakeClock(START_AT),
        accounts,
        secrets,
        baseEnv: { DOCKET_TOKEN: ENV_VALUE },
        query,
      });

      const events = await collect(unwrap(await transport.start(request())).events);
      const dumped = JSON.stringify(events);

      expect(dumped).not.toContain(API_KEY);
      expect(dumped).not.toContain(ENV_VALUE);
    });
  });
});
