// Claude-code SDK capability delivery matrix (issue #1160): red-first probes on query options only.
import { access, mkdtemp, readFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import type { Options, Query, SDKMessage } from '@anthropic-ai/claude-agent-sdk';
import {
  createFakeAccountRepo,
  createFakeCapabilityCatalog,
  createFakeClock,
  createFakeSecretVault,
} from '../../../../application/ports/fakes/index';
import type { AccountRecord, RunHandle, RunRequest, TransportError } from '../../../../application/index';
import type { Result } from '../../../../domain/index';
import {
  parseSlug,
  parseUlid,
  type AccountId,
  type CapabilityDef,
  type EpochMs,
  type RoleDef,
  type RoleSlug,
  type RunId,
} from '../../../../domain/index';
import { createSdkTransport, type QueryFn } from './transport';

const START_AT: EpochMs = 1770000000000;

function ulidOf<B extends string>(input: string) {
  const parsed = parseUlid<B>(input);
  if (!parsed.ok) throw new Error('fixture ulid must parse');
  return parsed.value;
}

const RUN_ID: RunId = ulidOf<'run'>('01ARZ3NDEKTSV4RRFFQ69G5FBV');
const ACCOUNT: AccountId = ulidOf<'account'>('01ARZ3NDEKTSV4RRFFQ69G5FAV');
const ZAI_ACCOUNT: AccountId = ulidOf<'account'>('01ARZ3NDEKTSV4RRFFQ69G5FB0');
const ROLE: RoleSlug = (() => {
  const parsed = parseSlug<'role'>('implementer');
  if (!parsed.ok) throw new Error('fixture slug must parse');
  return parsed.value;
})();

const API_KEY = 'AKIA' + 'X'.repeat(16);
const ROUTE_TOKEN = 'zai-' + 'endpoint' + '-token';
const ZAI_ENDPOINT = 'https://api.z.ai/api/anthropic';

const ROLE_DEF: RoleDef = {
  id: ROLE,
  name: 'Implementer',
  instructions: 'Follow the work order exactly.',
  writeScope: { kind: 'repo' },
  capabilities: [],
  active: true,
};

const slugOf = <B extends string>(input: string) => {
  const parsed = parseSlug<B>(input);
  if (!parsed.ok) throw new Error('fixture slug');
  return parsed.value;
};

function account(
  authMode: AccountRecord['authMode'],
  secretRef?: string,
  overrides?: Partial<AccountRecord>,
): AccountRecord {
  return {
    id: ACCOUNT,
    provider: 'agent-cli',
    label: 'main',
    authMode,
    limitPolicy: 'wait_resume',
    ...(secretRef === undefined ? {} : { secretRef }),
    caps: [],
    ...(overrides === undefined ? {} : overrides),
  };
}

interface CapturedCall {
  readonly prompt: unknown;
  readonly options: Options;
}

type Script = (call: CapturedCall) => AsyncGenerator<SDKMessage, void>;

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

function successResult(): SDKMessage {
  return {
    type: 'result',
    subtype: 'success',
    duration_ms: 1,
    duration_api_ms: 1,
    is_error: false,
    num_turns: 1,
    result: 'done',
    stop_reason: null,
    total_cost_usd: 0,
    usage: {
      cache_creation: { ephemeral_1h_input_tokens: 0, ephemeral_5m_input_tokens: 0 },
      cache_creation_input_tokens: 0,
      cache_read_input_tokens: 0,
      fallback_credit: { status: { type: 'redeemed' } },
      inference_geo: 'eu',
      input_tokens: 1,
      iterations: [],
      output_tokens: 1,
      output_tokens_details: { thinking_tokens: 0 },
      server_tool_use: { web_fetch_requests: 0, web_search_requests: 0 },
      service_tier: 'standard',
      speed: 'standard',
    },
    modelUsage: {},
    permission_denials: [],
    uuid: '00000000-0000-4000-8000-000000000000',
    session_id: 'sess-delivery',
  };
}

function unwrap(started: Result<RunHandle, TransportError>): RunHandle {
  if (!started.ok) throw new Error(`expected started run, got ${started.error.code}`);
  return started.value;
}

async function drain(handle: RunHandle): Promise<void> {
  for await (const _ of handle.events) {
    /* collect */
  }
}

function inlineSettings(options: Options): Record<string, unknown> | undefined {
  const settings = options.settings;
  if (settings === undefined || typeof settings === 'string') return undefined;
  return settings as Record<string, unknown>;
}

function systemAppend(options: Options): string | undefined {
  const prompt = options.systemPrompt;
  if (prompt === undefined || typeof prompt === 'string' || Array.isArray(prompt)) return undefined;
  if (prompt.type === 'preset' && 'append' in prompt) return prompt.append;
  return undefined;
}

async function runCaptured(
  run: RunRequest,
  accountRecord: AccountRecord,
  capabilitiesCatalog = createFakeCapabilityCatalog([
    { id: 'anthropic-subscription', authMode: 'subscription', provider: 'agent-cli' },
    { id: 'anthropic-api', authMode: 'api_key', provider: 'agent-cli' },
  ]),
): Promise<CapturedCall> {
  const accounts = createFakeAccountRepo();
  await accounts.save(accountRecord);
  const { query, calls } = scriptedQuery(async function* () {
    yield successResult();
  });
  const transport = createSdkTransport({
    clock: createFakeClock(START_AT),
    accounts,
    secrets: createFakeSecretVault(),
    capabilities: capabilitiesCatalog,
    baseEnv: {},
    query,
  });
  await drain(unwrap(await transport.start(run)));
  const call = calls[0];
  if (call === undefined) throw new Error('query was never called');
  return call;
}

const routeCatalog = createFakeCapabilityCatalog([
  { id: 'anthropic-api', authMode: 'api_key', provider: 'agent-cli' },
  { id: 'anthropic-subscription', authMode: 'subscription', provider: 'agent-cli' },
]);

describe('claude-code SDK capability delivery (CC-1 … CC-8)', () => {
  it('CC-1: run-scoped MCP is inline with strictMcpConfig on every run', async () => {
    const cwd = await mkdtemp(join(tmpdir(), 'docket-cc1-'));
    const base = (capabilities: readonly CapabilityDef[]): RunRequest => ({
      runId: RUN_ID,
      cwd,
      runDir: cwd,
      role: ROLE_DEF,
      route: { accountId: ACCOUNT },
      prompt: 'work',
      capabilities,
    });

    const accounts = createFakeAccountRepo();
    await accounts.save(account('subscription'));
    const { query, calls } = scriptedQuery(async function* () {
      yield successResult();
    });
    const transport = createSdkTransport({
      clock: createFakeClock(START_AT),
      accounts,
      secrets: createFakeSecretVault(),
      baseEnv: {},
      query,
    });

    await drain(unwrap(await transport.start(base([]))));
    expect(calls[0]?.options.mcpServers).toEqual({});
    expect(calls[0]?.options.strictMcpConfig).toBe(true);

    const mcp: CapabilityDef = {
      kind: 'mcp',
      id: slugOf<'capability'>('probe-mcp'),
      name: 'Probe MCP',
      command: 'echo',
      args: ['mcp'],
      env: {},
    };
    await drain(unwrap(await transport.start(base([mcp]))));
    expect(calls[1]?.options.mcpServers).toEqual({
      'probe-mcp': { command: 'echo', args: ['mcp'], env: {} },
    });
    expect(calls[1]?.options.strictMcpConfig).toBe(true);
  });

  it('CC-2: an MCP env secret the vault cannot resolve fails not_logged_in before query starts', async () => {
    const accounts = createFakeAccountRepo();
    await accounts.save(account('subscription'));
    const { query, calls } = scriptedQuery(async function* () {
      yield successResult();
    });
    const transport = createSdkTransport({
      clock: createFakeClock(START_AT),
      accounts,
      secrets: createFakeSecretVault(),
      baseEnv: {},
      query,
    });
    const capabilities: readonly CapabilityDef[] = [
      {
        kind: 'mcp',
        id: slugOf<'capability'>('needs-secret'),
        name: 'Needs secret',
        command: 'srv',
        args: [],
        env: { TOKEN: { secretRef: 'missing-ref' } },
      },
    ];
    const started = await transport.start({
      runId: RUN_ID,
      cwd: '/tmp/cc2',
      runDir: '/tmp/cc2',
      role: ROLE_DEF,
      route: { accountId: ACCOUNT },
      prompt: 'work',
      capabilities,
    });
    expect(started.ok).toBe(false);
    if (!started.ok) expect(started.error.code).toBe('not_logged_in');
    expect(calls.length).toBe(0);
  });

  it('CC-3: a role skill is materialized for the SDK project tree and user settings stay off', async () => {
    const cwd = await mkdtemp(join(tmpdir(), 'docket-cc3-'));
    const library = await mkdtemp(join(tmpdir(), 'docket-cc3-lib-'));
    const skillSource = join(library, 'role-skill.md');
    const skillBody = '# Role skill CC-3 marker\n';
    await writeFile(skillSource, skillBody, 'utf8');

    const accounts = createFakeAccountRepo();
    await accounts.save(account('subscription'));
    const { query, calls } = scriptedQuery(async function* (call) {
      expect(call.options.settingSources).toEqual([]);
      const pluginPath = call.options.plugins?.[0]?.path;
      if (pluginPath === undefined) throw new Error('expected a run-scoped plugin path');
      const runScopedSkill = join(pluginPath, 'skills', 'role-skill', 'SKILL.md');
      await expect(access(runScopedSkill)).resolves.toBeUndefined();
      expect(await readFile(runScopedSkill, 'utf8')).toBe(skillBody);
      expect(call.options.skills).toBe('all');
      yield successResult();
    });
    const transport = createSdkTransport({
      clock: createFakeClock(START_AT),
      accounts,
      secrets: createFakeSecretVault(),
      baseEnv: {},
      query,
    });
    await drain(
      unwrap(
        await transport.start({
          runId: RUN_ID,
          cwd,
          runDir: cwd,
          role: ROLE_DEF,
          route: { accountId: ACCOUNT },
          prompt: 'work',
          capabilities: [
            {
              kind: 'skill',
              id: slugOf<'capability'>('role-skill'),
              name: 'role-skill',
              path: skillSource,
            },
          ],
        }),
      ),
    );
    expect(calls.length).toBe(1);
  });

  it.todo(
    'CC-3 LIVE: with a distinct skill only under ~/.claude/skills, observe system init skills[] omits it while settingSources stays []',
  );

  it('CC-4: role hooks ride inline settings (not user files) including an exit-2 blocking command hook', async () => {
    const cwd = await mkdtemp(join(tmpdir(), 'docket-cc4-'));
    const call = await runCaptured(
      {
        runId: RUN_ID,
        cwd,
        runDir: cwd,
        role: ROLE_DEF,
        route: { accountId: ACCOUNT },
        prompt: 'work',
        capabilities: [
          {
            kind: 'hook',
            id: slugOf<'capability'>('block-writes'),
            name: 'Block writes',
            event: 'before_tool',
            command: '/bin/sh -c "exit 2"',
          },
        ],
      },
      account('subscription'),
    );

    expect(call.options.settingSources).toEqual([]);
    const settings = inlineSettings(call.options);
    expect(settings).toBeDefined();
    const hooks = settings?.hooks as Record<string, unknown> | undefined;
    expect(hooks?.PreToolUse).toEqual([
      {
        hooks: [{ type: 'command', command: '/bin/sh -c "exit 2"' }],
      },
    ]);
    expect(typeof call.options.settings).toBe('object');
  });

  it('CC-5: role context is delivered exactly once via systemPrompt append without writing CLAUDE.md', async () => {
    const cwd = await mkdtemp(join(tmpdir(), 'docket-cc5-'));
    const library = await mkdtemp(join(tmpdir(), 'docket-cc5-lib-'));
    const contextMarker = 'CC5_CONTEXT_MARKER_UNIQUE';
    const contextPath = join(library, 'context.md');
    await writeFile(contextPath, `# Context\n${contextMarker}\n`, 'utf8');

    const call = await runCaptured(
      {
        runId: RUN_ID,
        cwd,
        runDir: cwd,
        role: ROLE_DEF,
        route: { accountId: ACCOUNT },
        prompt: 'work',
        capabilities: [
          {
            kind: 'context',
            id: slugOf<'capability'>('repo-context'),
            name: 'Repo context',
            path: contextPath,
          },
        ],
      },
      account('subscription'),
    );

    const claudePath = join(cwd, 'CLAUDE.md');
    await expect(access(claudePath)).rejects.toThrow();
    const append = systemAppend(call.options) ?? '';
    expect((append.match(new RegExp(contextMarker, 'g')) ?? []).length).toBe(1);
    expect(append).toContain('Follow the work order exactly.');
  });

  it('CC-6: plugin bundles use plugins[{type:local,path,skipMcpDiscovery:true}] on every run', async () => {
    const cwd = await mkdtemp(join(tmpdir(), 'docket-cc6-'));
    const pluginRoot = await mkdtemp(join(tmpdir(), 'docket-cc6-plugin-'));
    await writeFile(join(pluginRoot, 'plugin.json'), '{}\n', 'utf8');

    const pluginCap: CapabilityDef = {
      kind: 'plugin',
      id: slugOf<'capability'>('bundle'),
      name: 'probe-plugin',
      source: { kind: 'path', path: pluginRoot },
      includes: [],
    };
    const mcpCap: CapabilityDef = {
      kind: 'mcp',
      id: slugOf<'capability'>('with-mcp'),
      name: 'With MCP',
      command: 'true',
      args: [],
      env: {},
    };

    const pluginOnly = await runCaptured(
      {
        runId: RUN_ID,
        cwd,
        runDir: cwd,
        role: ROLE_DEF,
        route: { accountId: ACCOUNT },
        prompt: 'work',
        capabilities: [pluginCap],
      },
      account('subscription'),
    );
    expect(pluginOnly.options.strictMcpConfig).toBe(true);
    expect(pluginOnly.options.plugins).toEqual([{ type: 'local', path: pluginRoot, skipMcpDiscovery: true }]);

    const pluginAndMcp = await runCaptured(
      {
        runId: RUN_ID,
        cwd,
        runDir: cwd,
        role: ROLE_DEF,
        route: { accountId: ACCOUNT },
        prompt: 'work',
        capabilities: [pluginCap, mcpCap],
      },
      account('subscription'),
    );
    expect(pluginAndMcp.options.strictMcpConfig).toBe(true);
    expect(pluginAndMcp.options.plugins).toEqual([{ type: 'local', path: pluginRoot, skipMcpDiscovery: true }]);
  });

  it('CC-7: child env carries no subscription API key; zai-glm gets the route token; secrets never appear in events', async () => {
    const subAccounts = createFakeAccountRepo();
    await subAccounts.save(account('subscription'));
    const { query: subQuery, calls: subCalls } = scriptedQuery(async function* () {
      yield successResult();
    });
    const subTransport = createSdkTransport({
      clock: createFakeClock(START_AT),
      accounts: subAccounts,
      secrets: createFakeSecretVault(),
      capabilities: routeCatalog,
      baseEnv: {
        ANTHROPIC_API_KEY: API_KEY,
        ANTHROPIC_AUTH_TOKEN: 'stale-token',
        SHELL: '/bin/zsh',
      },
      query: subQuery,
    });
    const subEvents: unknown[] = [];
    const subHandle = unwrap(
      await subTransport.start({
        runId: RUN_ID,
        cwd: '/tmp/cc7-sub',
        runDir: '/tmp/cc7-sub',
        role: ROLE_DEF,
        route: { accountId: ACCOUNT },
        prompt: 'work',
        capabilities: [],
      }),
    );
    for await (const event of subHandle.events) subEvents.push(event);
    expect(subCalls[0]?.options.env?.ANTHROPIC_API_KEY).toBeUndefined();
    expect(subCalls[0]?.options.env?.ANTHROPIC_AUTH_TOKEN).toBeUndefined();

    const secrets = createFakeSecretVault();
    await secrets.put('ref-zai', ROUTE_TOKEN);
    const zaiAccounts = createFakeAccountRepo();
    await zaiAccounts.save({
      ...account('api_key', 'ref-zai', { routeKind: 'zai-glm', endpoint: ZAI_ENDPOINT }),
      id: ZAI_ACCOUNT,
    });
    const { query: zaiQuery, calls: zaiCalls } = scriptedQuery(async function* () {
      yield successResult();
    });
    const zaiTransport = createSdkTransport({
      clock: createFakeClock(START_AT),
      accounts: zaiAccounts,
      secrets,
      capabilities: routeCatalog,
      baseEnv: {
        ANTHROPIC_API_KEY: API_KEY,
        ANTHROPIC_AUTH_TOKEN: 'stale-token',
        SHELL: '/bin/zsh',
      },
      query: zaiQuery,
    });
    const zaiHandle = unwrap(
      await zaiTransport.start({
        runId: RUN_ID,
        cwd: '/tmp/cc7-zai',
        runDir: '/tmp/cc7-zai',
        role: ROLE_DEF,
        route: { accountId: ZAI_ACCOUNT },
        prompt: 'work',
        capabilities: [],
      }),
    );
    for await (const event of zaiHandle.events) subEvents.push(event);
    expect(zaiCalls[0]?.options.env?.ANTHROPIC_API_KEY).toBeUndefined();
    expect(zaiCalls[0]?.options.env?.ANTHROPIC_AUTH_TOKEN).toBe(ROUTE_TOKEN);
    const dumped = JSON.stringify(subEvents);
    expect(dumped).not.toContain(API_KEY);
    expect(dumped).not.toContain(ROUTE_TOKEN);
  });

  it('CC-8: every run disables claude.ai connectors in settings with strictMcpConfig', async () => {
    const mcp: CapabilityDef = {
      kind: 'mcp',
      id: slugOf<'capability'>('iso-mcp'),
      name: 'Iso',
      command: 'true',
      args: [],
      env: {},
    };
    const cwd = await mkdtemp(join(tmpdir(), 'docket-cc8-'));

    const withMcp = await runCaptured(
      {
        runId: RUN_ID,
        cwd,
        runDir: cwd,
        role: ROLE_DEF,
        route: { accountId: ACCOUNT },
        prompt: 'work',
        capabilities: [mcp],
      },
      account('subscription'),
      routeCatalog,
    );
    expect(withMcp.options.strictMcpConfig).toBe(true);
    expect(inlineSettings(withMcp.options)?.disableClaudeAiConnectors).toBe(true);

    const subscriptionBare = await runCaptured(
      {
        runId: RUN_ID,
        cwd,
        runDir: cwd,
        role: ROLE_DEF,
        route: { accountId: ACCOUNT },
        prompt: 'work',
        capabilities: [],
      },
      account('subscription'),
      routeCatalog,
    );
    expect(subscriptionBare.options.strictMcpConfig).toBe(true);
    expect(inlineSettings(subscriptionBare.options)?.disableClaudeAiConnectors).toBe(true);

    const secrets = createFakeSecretVault();
    await secrets.put('ref-zai', ROUTE_TOKEN);
    const accounts = createFakeAccountRepo();
    await accounts.save({
      ...account('api_key', 'ref-zai', { routeKind: 'zai-glm', endpoint: ZAI_ENDPOINT }),
      id: ZAI_ACCOUNT,
    });
    const { query, calls } = scriptedQuery(async function* () {
      yield successResult();
    });
    const transport = createSdkTransport({
      clock: createFakeClock(START_AT),
      accounts,
      secrets,
      capabilities: routeCatalog,
      baseEnv: {},
      query,
    });
    await drain(
      unwrap(
        await transport.start({
          runId: RUN_ID,
          cwd,
          runDir: cwd,
          role: ROLE_DEF,
          route: { accountId: ZAI_ACCOUNT },
          prompt: 'work',
          capabilities: [],
        }),
      ),
    );
    expect(calls[0]?.options.strictMcpConfig).toBe(true);
    expect(inlineSettings(calls[0]?.options)?.disableClaudeAiConnectors).toBe(true);
  });

  it.todo(
    'CC-8 LIVE: on subscription without strict MCP, observe whether claude.ai cloud MCP connectors auto-attach in system init mcp_servers',
  );

  it('#1164: removes run-scoped plugin dir when query throws synchronously', async () => {
    const cwd = await mkdtemp(join(tmpdir(), 'docket-cc-clean-sync-'));
    const skillSource = join(cwd, 'skill.md');
    await writeFile(skillSource, '# skill\n', 'utf8');
    const accounts = createFakeAccountRepo();
    await accounts.save(account('subscription'));
    const throwingQuery: QueryFn = () => {
      throw new Error('query failed synchronously');
    };
    const transport = createSdkTransport({
      clock: createFakeClock(START_AT),
      accounts,
      secrets: createFakeSecretVault(),
      baseEnv: {},
      query: throwingQuery,
    });
    const started = await transport.start({
      runId: RUN_ID,
      cwd,
      runDir: cwd,
      role: ROLE_DEF,
      route: { accountId: ACCOUNT },
      prompt: 'work',
      capabilities: [{ kind: 'skill', id: slugOf<'capability'>('s'), name: 's', path: skillSource }],
    });
    expect(started.ok).toBe(true);
    if (!started.ok) return;
    await drain(started.value);
    const entries = await import('node:fs/promises').then((fs) => fs.readdir(cwd));
    expect(entries.some((name) => name.startsWith('cc-run-plugin-'))).toBe(false);
  });

  it('#1164: removes run-scoped plugin dir after a normal finish', async () => {
    const cwd = await mkdtemp(join(tmpdir(), 'docket-cc-clean-finish-'));
    const skillSource = join(cwd, 'skill.md');
    await writeFile(skillSource, '# skill\n', 'utf8');
    const accounts = createFakeAccountRepo();
    await accounts.save(account('subscription'));
    const { query, calls } = scriptedQuery(async function* () {
      yield successResult();
    });
    const transport = createSdkTransport({
      clock: createFakeClock(START_AT),
      accounts,
      secrets: createFakeSecretVault(),
      baseEnv: {},
      query,
    });
    await drain(
      unwrap(
        await transport.start({
          runId: RUN_ID,
          cwd,
          runDir: cwd,
          role: ROLE_DEF,
          route: { accountId: ACCOUNT },
          prompt: 'work',
          capabilities: [{ kind: 'skill', id: slugOf<'capability'>('s'), name: 's', path: skillSource }],
        }),
      ),
    );
    const pluginPath = calls[0]?.options.plugins?.[0]?.path;
    if (pluginPath === undefined) throw new Error('expected plugin path');
    await expect(access(pluginPath)).rejects.toThrow();
  });
});
