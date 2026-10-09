// Transport factory tests (docs/v2/providers.md → "Discovery" closing paragraph): the factory maps
// an account's provider definition to a transport — the sdk kind to the real SDK transport bound to
// the discovered binary, the stream-json kind to the framing transport bound to its dialect and
// binary (a fake node bin here), and the remaining kinds to an `unsupported` report until their
// issues land.
import { chmodSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { Options, Query, SDKMessage, SDKUserMessage } from '@anthropic-ai/claude-agent-sdk';

import { createFakeAccountRepo, createFakeClock, createFakeSecretVault } from '../../../application/ports/fakes/index';
import type { AccountRecord, RunHandle, RunRequest, TransportError } from '../../../application/index';
import type { Result, RoleDef, RunId } from '../../../domain/index';
import { parseSlug, parseUlid, type AccountId, type AgentEvent } from '../../../domain/index';
import type { ProviderDef } from '../defs/index';
import type { StreamDialect } from '../transports/stream-json/index';
import type { QueryFn } from '../transports/sdk/transport';
import { createProviderTransportFactory } from './transport-factory';

let root: string;

beforeAll(() => {
  root = mkdtempSync(join(tmpdir(), 'docket-transport-factory-'));
});

afterAll(() => {
  rmSync(root, { recursive: true, force: true });
});

const RUN_ID: RunId = ulidOf<'run'>('01ARZ3NDEKTSV4RRFFQ69G5FBV');
const ACCOUNT_SDK: AccountId = ulidOf<'account'>('01ARZ3NDEKTSV4RRFFQ69G5FAV');
const ACCOUNT_APP_SERVER: AccountId = ulidOf<'account'>('01ARZ3NDEKTSV4RRFFQ69G5FCV');
const ACCOUNT_ACP: AccountId = ulidOf<'account'>('01ARZ3NDEKTSV4RRFFQ69G5FDV');
const ACCOUNT_STREAM_JSON: AccountId = ulidOf<'account'>('01ARZ3NDEKTSV4RRFFQ69G5FEV');
const ACCOUNT_UNKNOWN: AccountId = ulidOf<'account'>('01ARZ3NDEKTSV4RRFFQ69G5FFV');

const ROLE: RoleDef = {
  id: slugOf<'role'>('implementer'),
  name: 'Implementer',
  instructions: 'Follow the work order exactly.',
  writeScope: { kind: 'repo' },
  capabilities: [],
  active: true,
};

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

function accountOf(id: AccountId, provider: string): AccountRecord {
  return {
    id,
    provider,
    label: 'main',
    authMode: 'subscription',
    limitPolicy: 'wait_resume',
    caps: [],
  };
}

function request(accountId: AccountId, cwd: string = '/tmp/docket-transport-factory'): RunRequest {
  return {
    runId: RUN_ID,
    cwd,
    role: ROLE,
    route: { accountId },
    prompt: 'do the work',
    capabilities: [],
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

const defOf = (overrides: Pick<ProviderDef, 'id' | 'transport'> & { readonly streamDialect?: string }): ProviderDef => ({
  displayName: 'Fake CLI',
  bins: ['fake-cli'],
  versionArgs: ['--version'],
  helpArgs: ['--help'],
  transport: overrides.transport,
  config: { mechanism: 'env-var', name: 'FAKE_CLI_HOME' },
  buildLaunch: () => ({ args: [], env: {}, stdin: 'prompt' }),
  resume: 'none',
  capabilities: {
    structuredStream: true,
    permissionAsk: false,
    resume: false,
    mcp: false,
    hooks: 'unknown',
    skills: 'unknown',
    images: 'unknown',
    quotaReport: 'none',
    costReport: 'none',
  },
  installHint: { url: 'https://example.invalid/fake-cli' },
  mark: null,
  id: overrides.id,
  ...(overrides.streamDialect === undefined ? {} : { streamDialect: overrides.streamDialect }),
});

/** Recognises {say} → text and {end} → finished; a minimal dialect for wiring tests. */
const fakeDialect: StreamDialect = {
  id: 'fake',
  parse: (line) => {
    if (typeof line !== 'object' || line === null || Array.isArray(line)) return null;
    const record = line as Record<string, unknown>;
    if (typeof record['say'] === 'string') return [{ type: 'text', at: 1, delta: record['say'] }];
    if (record['end'] === 'completed' || record['end'] === 'failed') {
      return [{ type: 'finished', at: 1, reason: record['end'] }];
    }
    return null;
  },
};

/** An executable node script emitting its own path and a completed finish, as a fake CLI. */
const writeFakeStreamBin = (): string => {
  const path = join(root, 'factory-fake-stream-bin.cjs');
  writeFileSync(
    path,
    '#!/usr/bin/env node\nprocess.stdout.write(JSON.stringify({ say: process.argv[1] }) + \'\\n{"end":"completed"}\\n\');\n',
  );
  chmodSync(path, 0o755);
  return path;
};

/**
 * An executable node script speaking a minimal Agent Client Protocol handshake as a fake agent:
 * initialize → session/new → session/prompt, echoing the config-dir variable it was spawned
 * with so the test can see the run-scoped config reached the child environment.
 */
const writeFakeAcpBin = (): string => {
  const path = join(root, 'factory-fake-acp-bin.cjs');
  writeFileSync(
    path,
    [
      '#!/usr/bin/env node',
      "const readline = require('node:readline');",
      'let sessionId = null;',
      "const send = (message) => process.stdout.write(JSON.stringify(message) + '\\n');",
      "const rl = readline.createInterface({ input: process.stdin });",
      "rl.on('line', (line) => {",
      '  const message = JSON.parse(line);',
      "  if (message.method === 'initialize') {",
      "    send({ jsonrpc: '2.0', id: message.id, result: { protocolVersion: 1, agentCapabilities: {}, agentInfo: { name: 'fake', version: '1' }, authMethods: [] } });",
      '    return;',
      '  }',
      "  if (message.method === 'session/new') {",
      "    sessionId = 'sess_factory';",
      "    send({ jsonrpc: '2.0', id: message.id, result: { sessionId } });",
      '    return;',
      '  }',
      "  if (message.method === 'session/prompt') {",
      "    send({ jsonrpc: '2.0', method: 'session/update', params: { sessionId, update: { sessionUpdate: 'agent_message_chunk', messageId: 'msg_1', content: { type: 'text', text: process.env.FAKE_CLI_HOME ?? 'no-config' } } } });",
      "    send({ jsonrpc: '2.0', id: message.id, result: { stopReason: 'end_turn' } });",
      '    return;',
      '  }',
      '});',
    ].join('\n') + '\n',
  );
  chmodSync(path, 0o755);
  return path;
};

// --- fake query (the transport must never reach a real agent CLI here) ---

interface CapturedCall {
  readonly prompt: string | AsyncIterable<SDKUserMessage>;
  readonly options: Options;
}

type Script = (call: CapturedCall) => AsyncGenerator<SDKMessage, void>;

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

// --- tests ---

describe('provider transport factory', () => {
  it('maps an sdk account to the SDK transport bound to its discovered binary', async () => {
    const accounts = createFakeAccountRepo();
    await accounts.save(accountOf(ACCOUNT_SDK, 'fake-sdk'));
    const { query, calls } = scriptedQuery(() =>
      (async function* generate(): AsyncGenerator<SDKMessage, void> {
        // An empty script: the stream ends, the transport synthesises the finished event.
      })(),
    );
    const factory = createProviderTransportFactory({
      defs: [defOf({ id: 'fake-sdk', transport: 'sdk' })],
      accounts,
      secrets: createFakeSecretVault(),
      clock: createFakeClock(),
      baseEnv: { PATH: '/usr/bin:/bin' },
      binPaths: { 'fake-sdk': '/toolchain/bin/fake-sdk' },
      query,
    });

    const transport = await factory.forAccount(ACCOUNT_SDK);
    if (transport === undefined) throw new Error('expected a transport for the sdk provider');
    const handle = unwrap(await transport.start(request(ACCOUNT_SDK)));
    const events = await collect(handle.events);

    expect(events.filter((event) => event.type === 'finished')).toHaveLength(1);
    expect(calls).toHaveLength(1);
    expect(calls[0]?.options.pathToClaudeCodeExecutable).toBe('/toolchain/bin/fake-sdk');
  });

  it('wraps every started run in the watchdog, with the definition\'s timeouts or the defaults', async () => {
    const accounts = createFakeAccountRepo();
    await accounts.save(accountOf(ACCOUNT_SDK, 'fake-sdk'));
    // A run that never produces output: only the watchdog can end it.
    const { query } = scriptedQuery(() =>
      (async function* generate(): AsyncGenerator<SDKMessage, void> {
        await new Promise<never>(() => undefined);
      })(),
    );
    const scheduled: { readonly ms: number; readonly fn: () => void }[] = [];
    const build = (extra: Partial<ProviderDef>) =>
      createProviderTransportFactory({
        defs: [{ ...defOf({ id: 'fake-sdk', transport: 'sdk' }), ...extra }],
        accounts,
        secrets: createFakeSecretVault(),
        clock: createFakeClock(),
        baseEnv: { PATH: '/usr/bin:/bin' },
        binPaths: { 'fake-sdk': '/toolchain/bin/fake-sdk' },
        query,
        watchdogTimers: {
          set: (fn, ms) => {
            scheduled.push({ ms, fn });
            return () => undefined;
          },
        },
      });

    const defaults = await build({}).forAccount(ACCOUNT_SDK);
    if (defaults === undefined) throw new Error('expected a transport');
    const handle = unwrap(await defaults.start(request(ACCOUNT_SDK)));
    expect(scheduled.map((entry) => entry.ms)).toEqual([120_000]);
    scheduled[0]?.fn();
    const events = await collect(handle.events);
    expect(events.map((event) => event.type)).toEqual(['error', 'finished']);
    expect(events[0]).toMatchObject({ class: 'timeout', reason: 'first_output_timeout' });

    scheduled.length = 0;
    const custom = await build({ firstOutputTimeoutMs: 7_000 }).forAccount(ACCOUNT_SDK);
    if (custom === undefined) throw new Error('expected a transport');
    unwrap(await custom.start(request(ACCOUNT_SDK)));
    expect(scheduled.map((entry) => entry.ms)).toEqual([7_000]);
  });

  it('resolves to undefined when the account is unknown or names no known provider definition', async () => {
    const accounts = createFakeAccountRepo();
    await accounts.save(accountOf(ACCOUNT_SDK, 'no-such-def'));
    const factory = createProviderTransportFactory({
      defs: [defOf({ id: 'fake-sdk', transport: 'sdk' })],
      accounts,
      secrets: createFakeSecretVault(),
      clock: createFakeClock(),
      baseEnv: {},
      binPaths: {},
    });

    expect(await factory.forAccount(ACCOUNT_SDK)).toBeUndefined(); // provider definition missing
    expect(await factory.forAccount(ACCOUNT_UNKNOWN)).toBeUndefined(); // account missing
  });

  it('reports unsupported for a stream-json def whose dialect id has no implementation', async () => {
    const accounts = createFakeAccountRepo();
    await accounts.save(accountOf(ACCOUNT_STREAM_JSON, 'fake-stream-json'));
    const factory = createProviderTransportFactory({
      defs: [
        defOf({ id: 'fake-stream-json', transport: 'stream-json', streamDialect: 'fake' }),
      ],
      accounts,
      secrets: createFakeSecretVault(),
      clock: createFakeClock(),
      baseEnv: {},
      // Even a discovered binary does not make an unimplemented dialect available.
      binPaths: {
        'fake-stream-json': '/toolchain/bin/fake-stream-json',
      },
    });

    // An unimplemented dialect id is reported by name, never a crash.
    const transport = await factory.forAccount(ACCOUNT_STREAM_JSON);
    if (transport === undefined) throw new Error('expected a transport that reports unsupported');
    const started = await transport.start(request(ACCOUNT_STREAM_JSON));
    expect(started.ok).toBe(false);
    if (!started.ok) expect(started.error.message).toContain('"fake"');
  });

  it('maps an app-server account to the app-server transport bound to its discovered binary', async () => {
    // The shared scripted fake server from the transport's own tests: node is the binary, the
    // fixture rides as the first launch argument (a checked-in script has no portable exec bit).
    const fixture = join(
      dirname(fileURLToPath(import.meta.url)),
      '..',
      'transports',
      'app-server',
      'fixtures',
      'fake-app-server.cjs',
    );
    const cwd = join(root, 'app-server-run');
    const logPath = join(cwd, 'rpc.log');
    const accounts = createFakeAccountRepo();
    await accounts.save(accountOf(ACCOUNT_APP_SERVER, 'fake-app-server'));
    const factory = createProviderTransportFactory({
      defs: [
        {
          ...defOf({ id: 'fake-app-server', transport: 'app-server' }),
          buildLaunch: () => ({ args: [fixture, 'happy', logPath], env: {}, stdin: 'none' }),
        },
      ],
      accounts,
      secrets: createFakeSecretVault(),
      clock: createFakeClock(),
      baseEnv: {},
      binPaths: { 'fake-app-server': process.execPath },
    });

    const transport = await factory.forAccount(ACCOUNT_APP_SERVER);
    if (transport === undefined) throw new Error('expected a transport for the app-server provider');
    const handle = unwrap(await transport.start(request(ACCOUNT_APP_SERVER, cwd)));
    const events = await collect(handle.events);

    // The wire log proves the spawned binary spoke the app-server protocol end to end.
    expect(events.map((event) => event.type)).toEqual(['session_started', 'text', 'usage', 'finished']);
    const requests = readFileSync(logPath, 'utf8')
      .split('\n')
      .filter((line) => line !== '')
      .map((line) => JSON.parse(line) as { readonly dir: string; readonly msg: Record<string, unknown> })
      .filter((entry) => entry.dir === 'in' && entry.msg['method'] !== undefined)
      .map((entry) => entry.msg['method']);
    expect(requests.slice(0, 4)).toEqual(['initialize', 'account/rateLimits/read', 'thread/start', 'turn/start']);
  });

  it('maps a stream-json account to the stream-json transport bound to its dialect and discovered binary', async () => {
    const bin = writeFakeStreamBin();
    const accounts = createFakeAccountRepo();
    await accounts.save(accountOf(ACCOUNT_STREAM_JSON, 'fake-stream-json'));
    const factory = createProviderTransportFactory({
      defs: [defOf({ id: 'fake-stream-json', transport: 'stream-json', streamDialect: 'fake' })],
      accounts,
      secrets: createFakeSecretVault(),
      clock: createFakeClock(),
      baseEnv: {},
      binPaths: { 'fake-stream-json': bin },
      streamDialects: { fake: fakeDialect },
    });

    const transport = await factory.forAccount(ACCOUNT_STREAM_JSON);
    if (transport === undefined) throw new Error('expected a transport for the stream-json provider');
    const cwd = join(root, 'stream-json-run');
    const handle = unwrap(await transport.start(request(ACCOUNT_STREAM_JSON, cwd)));
    const events = await collect(handle.events);

    // The bin announces its own path: exactly the discovered binary was spawned.
    expect(events.map((event) => event.type)).toEqual(['text', 'finished']);
    expect(events[0]).toMatchObject({ delta: bin });
    expect(events.filter((event) => event.type === 'finished')).toHaveLength(1);
  });

  it('reports not_installed for a stream-json provider discovery found no binary for', async () => {
    const accounts = createFakeAccountRepo();
    await accounts.save(accountOf(ACCOUNT_STREAM_JSON, 'fake-stream-json'));
    const factory = createProviderTransportFactory({
      defs: [defOf({ id: 'fake-stream-json', transport: 'stream-json', streamDialect: 'fake' })],
      accounts,
      secrets: createFakeSecretVault(),
      clock: createFakeClock(),
      baseEnv: {},
      binPaths: { 'fake-stream-json': null },
      streamDialects: { fake: fakeDialect },
    });

    const transport = await factory.forAccount(ACCOUNT_STREAM_JSON);
    if (transport === undefined) throw new Error('expected a transport that reports not_installed');
    const started = await transport.start(request(ACCOUNT_STREAM_JSON, join(root, 'stream-json-missing')));
    expect(started.ok).toBe(false);
    if (!started.ok) expect(started.error.code).toBe('not_installed');
  });

  it('maps an acp account to the ACP transport bound to its discovered binary', async () => {
    const bin = writeFakeAcpBin();
    const accounts = createFakeAccountRepo();
    await accounts.save(accountOf(ACCOUNT_ACP, 'fake-acp'));
    const factory = createProviderTransportFactory({
      defs: [defOf({ id: 'fake-acp', transport: 'acp' })],
      accounts,
      secrets: createFakeSecretVault(),
      clock: createFakeClock(),
      baseEnv: {},
      binPaths: { 'fake-acp': bin },
    });

    const transport = await factory.forAccount(ACCOUNT_ACP);
    if (transport === undefined) throw new Error('expected a transport for the acp provider');
    const cwd = join(root, 'acp-run');
    const handle = unwrap(await transport.start(request(ACCOUNT_ACP, cwd)));
    const events = await collect(handle.events);

    // The handshake ran through the fake agent; its message echoes the run-scoped config dir,
    // proving the spawned child is exactly the discovered binary with the isolated config.
    expect(events.map((event) => event.type)).toEqual(['session_started', 'text', 'finished']);
    expect(events[0]).toMatchObject({ sessionRef: 'sess_factory' });
    expect(events[1]).toMatchObject({ delta: join(cwd, 'config') });
    expect(events.filter((event) => event.type === 'finished')).toHaveLength(1);
  });

  it('creates the SDK transport with the SDK default when discovery found no binary', async () => {
    const accounts = createFakeAccountRepo();
    await accounts.save(accountOf(ACCOUNT_SDK, 'fake-sdk'));
    const { query, calls } = scriptedQuery(() =>
      (async function* generate(): AsyncGenerator<SDKMessage, void> {})(),
    );
    const factory = createProviderTransportFactory({
      defs: [defOf({ id: 'fake-sdk', transport: 'sdk' })],
      accounts,
      secrets: createFakeSecretVault(),
      clock: createFakeClock(),
      baseEnv: {},
      binPaths: { 'fake-sdk': null },
      query,
    });

    const transport = await factory.forAccount(ACCOUNT_SDK);
    if (transport === undefined) throw new Error('expected a transport for the sdk provider');
    const handle = unwrap(await transport.start(request(ACCOUNT_SDK)));
    await collect(handle.events);
    expect(calls[0]?.options.pathToClaudeCodeExecutable).toBeUndefined();
  });
});
