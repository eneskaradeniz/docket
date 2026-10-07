// The Claude route catalog adapter (P-29 section 3): the SDK's own supported-models call, run on
// exactly the environment a run of the same account would see, without ever sending a prompt or
// starting a model turn. Fixtures follow the live probe shapes: a Pro-like answer with a `[1m]`
// suffixed value, and an override-shaped answer carrying only the tier override targets.
import { describe, expect, it } from 'vitest';
import type { ModelInfo, Options, Query, SDKMessage } from '@anthropic-ai/claude-agent-sdk';

import { listClaudeRouteModels } from './claude-catalog';
import { createSdkTransport, type QueryFn } from '../transports/sdk/transport';
import {
  createFakeAccountRepo,
  createFakeCapabilityCatalog,
  createFakeClock,
  createFakeSecretVault,
} from '../../../application/ports/fakes/index';
import type { AccountRecord } from '../../../application/index';
import { parseSlug, parseUlid, type AccountId, type RoleSlug, type RunId } from '../../../domain/index';

const ACCOUNT: AccountId = parseUlidOrThrow('account', '01ARZ3NDEKTSV4RRFFQ69G5FAV');
const RUN_ID: RunId = parseUlidOrThrow('run', '01ARZ3NDEKTSV4RRFFQ69G5FBV');
const ROLE: RoleSlug = parseSlugOrThrow('implementer');
const START_AT = 1770000000000;

// Credential-looking values are assembled at runtime, never written as one literal.
const ROUTE_TOKEN = 'zai-' + 'endpoint' + '-token';
const ZAI_ENDPOINT = 'https://api.z.ai/api/anthropic';
const CONFIG_DIR = '/Users/fixture/.claude-second-login';
const STRAY_BASE_URL = 'https://stray.example.invalid';

function parseUlidOrThrow<B extends string>(brand: B, input: string) {
  const parsed = parseUlid<B>(input);
  if (!parsed.ok) throw new Error(`fixture ${brand} ulid must parse`);
  return parsed.value;
}

function parseSlugOrThrow(input: string): RoleSlug {
  const parsed = parseSlug<'role'>(input);
  if (!parsed.ok) throw new Error('fixture slug must parse');
  return parsed.value;
}

function account(overrides?: Partial<AccountRecord>): AccountRecord {
  return {
    id: ACCOUNT,
    provider: 'agent-cli',
    label: 'main',
    authMode: 'subscription',
    limitPolicy: 'wait_resume',
    caps: [],
    ...(overrides === undefined ? {} : overrides),
  };
}

// The scripted catalog maps the fixture provider onto the registry's real kinds; the record data
// (endpoint host, tier aliases) comes from the real registry, exactly as in the transport tests.
const routeCatalog = createFakeCapabilityCatalog([
  { id: 'anthropic-subscription', authMode: 'subscription', provider: 'agent-cli' },
]);

const PRO_LIST: readonly ModelInfo[] = [
  {
    value: 'claude-fable-5-1[1m]',
    resolvedModel: 'claude-fable-5-1',
    displayName: 'Fable [1m]',
    description: '',
    supportsEffort: true,
    supportedEffortLevels: ['low', 'medium', 'high', 'xhigh', 'max'],
  },
  {
    value: 'claude-opus-5-5',
    resolvedModel: 'claude-opus-5-5',
    displayName: 'Opus 5.5',
    description: '',
    supportsEffort: true,
    supportedEffortLevels: ['low', 'medium', 'high'],
  },
  {
    value: 'claude-sonnet-5-5',
    resolvedModel: 'claude-sonnet-5-5',
    displayName: 'Sonnet 5.5',
    description: '',
    supportsEffort: true,
    supportedEffortLevels: ['low', 'medium', 'high', 'xhigh'],
  },
  {
    value: 'claude-haiku-4-5',
    resolvedModel: 'claude-haiku-4-5',
    displayName: 'Haiku 4.5',
    description: '',
    supportsEffort: false,
  },
];

const OVERRIDE_LIST: readonly ModelInfo[] = [
  {
    value: 'glm-5.3',
    resolvedModel: 'glm-5.3',
    displayName: 'GLM 5.3',
    description: '',
    supportsEffort: true,
    supportedEffortLevels: ['low', 'medium', 'high'],
  },
  {
    value: 'glm-5.3-flash[1m]',
    resolvedModel: 'glm-5.3-flash',
    displayName: 'GLM 5.3 Flash [1m]',
    description: '',
    supportsEffort: true,
    supportedEffortLevels: ['low', 'medium', 'high'],
  },
];

interface CapturedCall {
  readonly prompt: unknown;
  readonly options: Options;
}

/** What the scripted query observed: the calls it received, whether it was closed, and every user
 * message the input stream ever yielded (there must be none). */
interface ScriptedQuery {
  readonly query: QueryFn;
  readonly calls: readonly CapturedCall[];
  closed(): boolean;
  inputMessages(): readonly unknown[];
}

function scriptedQuery(answer: () => Promise<ModelInfo[]>): ScriptedQuery {
  const calls: CapturedCall[] = [];
  const inputMessages: unknown[] = [];
  let closed = false;
  const query: QueryFn = (params) => {
    calls.push({ prompt: params.prompt, options: params.options ?? {} });
    // Drain the input side in the background: proves no user message is ever pushed into the
    // stream the adapter handed the SDK, without holding the message generator hostage (a run's
    // channel stays open until the run finishes).
    if (typeof params.prompt !== 'string') {
      void (async () => {
        for await (const message of params.prompt) inputMessages.push(message);
      })().catch(() => undefined);
    }
    const generator = (async function* (): AsyncGenerator<SDKMessage, void> {
      // No SDK messages: a listing needs none, and a run driven by this fake ends its turn at once.
    })();
    const unsupported = (): Promise<never> => Promise.reject(new Error('fake query: not scripted'));
    const scripted: Query = Object.assign(generator, {
      interrupt: (): Promise<undefined> => Promise.resolve(undefined),
      setPermissionMode: (): Promise<void> => Promise.resolve(),
      setMcpPermissionModeOverride: (): Promise<{ warning?: string }> => Promise.resolve({}),
      setModel: (): Promise<void> => Promise.resolve(),
      setMaxThinkingTokens: (): Promise<void> => Promise.resolve(),
      applyFlagSettings: (): Promise<void> => Promise.resolve(),
      initializationResult: unsupported,
      reinitialize: unsupported,
      supportedCommands: unsupported,
      supportedModels: answer,
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
      // Required by a module augmentation active in this program, not by the SDK's own declarations.
      cancelAsyncMessage: (): Promise<boolean> => Promise.resolve(false),
      close: (): void => {
        closed = true;
      },
    });
    return scripted;
  };
  return { query, calls, closed: () => closed, inputMessages: () => inputMessages };
}

describe('listClaudeRouteModels (P-29)', () => {
  it('P-29: a Pro-like answer maps every row — value verbatim with its [1m] suffix, display name, efforts filtered to the known levels', async () => {
    const scripted = scriptedQuery(async () => [...PRO_LIST]);
    const result = await listClaudeRouteModels(account(), {
      secrets: createFakeSecretVault(),
      baseEnv: {},
      capabilities: routeCatalog,
      query: scripted.query,
    });

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value).toEqual([
        {
          id: 'claude-fable-5-1[1m]',
          resolvedId: 'claude-fable-5-1',
          displayName: 'Fable [1m]',
          efforts: ['low', 'medium', 'high', 'xhigh', 'max'],
        },
        { id: 'claude-opus-5-5', resolvedId: 'claude-opus-5-5', displayName: 'Opus 5.5', efforts: ['low', 'medium', 'high'] },
        { id: 'claude-sonnet-5-5', resolvedId: 'claude-sonnet-5-5', displayName: 'Sonnet 5.5', efforts: ['low', 'medium', 'high', 'xhigh'] },
        { id: 'claude-haiku-4-5', resolvedId: 'claude-haiku-4-5', displayName: 'Haiku 4.5' },
      ]);
    }
    expect(scripted.closed()).toBe(true);
  });

  it('P-29: an override-shaped answer carrying only the tier override targets maps the same way', async () => {
    const scripted = scriptedQuery(async () => [...OVERRIDE_LIST]);
    const secrets = createFakeSecretVault();
    await secrets.put('ref-zai', ROUTE_TOKEN);
    const result = await listClaudeRouteModels(
      account({ authMode: 'api_key', secretRef: 'ref-zai', routeKind: 'zai-glm', endpoint: ZAI_ENDPOINT }),
      {
        secrets,
        baseEnv: {},
        query: scripted.query,
      },
    );

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value).toEqual([
        { id: 'glm-5.3', resolvedId: 'glm-5.3', displayName: 'GLM 5.3', efforts: ['low', 'medium', 'high'] },
        { id: 'glm-5.3-flash[1m]', resolvedId: 'glm-5.3-flash', displayName: 'GLM 5.3 Flash [1m]', efforts: ['low', 'medium', 'high'] },
      ]);
    }
  });

  it('P-29: effort names outside the known levels are dropped; a row without effort support carries no efforts at all', async () => {
    // The widened name is deliberate: a newer SDK may add a level before the domain knows it, and
    // the adapter must drop it, not relay it.
    const futureLevels = ['low', 'turbo', 'medium'] as ModelInfo['supportedEffortLevels'];
    const scripted = scriptedQuery(async () => [
      { value: 'model-x', displayName: 'X', description: '', supportsEffort: true, supportedEffortLevels: futureLevels },
      { value: 'model-y', displayName: 'Y', description: '', supportsEffort: true },
    ]);
    const result = await listClaudeRouteModels(account(), {
      secrets: createFakeSecretVault(),
      baseEnv: {},
      capabilities: routeCatalog,
      query: scripted.query,
    });

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value).toEqual([
        { id: 'model-x', displayName: 'X', efforts: ['low', 'medium'] },
        { id: 'model-y', displayName: 'Y' },
      ]);
    }
  });

  it('P-42: an alias row keeps its own id, carries the resolved id, and the default row is marked', async () => {
    const scripted = scriptedQuery(async () => [
      { value: 'default', resolvedModel: 'claude-opus-5-5[1m]', displayName: 'Default', description: '' },
      { value: 'sonnet', resolvedModel: 'claude-sonnet-5-5', displayName: 'Sonnet', description: '' },
      { value: 'haiku', displayName: 'Haiku', description: '' },
      { value: 'opus', resolvedModel: '', displayName: 'Opus', description: '' },
    ]);
    const result = await listClaudeRouteModels(account(), {
      secrets: createFakeSecretVault(),
      baseEnv: {},
      capabilities: routeCatalog,
      query: scripted.query,
    });

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value).toEqual([
        { id: 'default', resolvedId: 'claude-opus-5-5[1m]', isDefault: true, displayName: 'Default' },
        { id: 'sonnet', resolvedId: 'claude-sonnet-5-5', displayName: 'Sonnet' },
        { id: 'haiku', displayName: 'Haiku' },
        { id: 'opus', displayName: 'Opus' },
      ]);
    }
  });

  it('P-29: the query is isolated — streaming input that never yields a user message, empty setting sources, no persistence, no model turn', async () => {
    const scripted = scriptedQuery(async () => []);
    await listClaudeRouteModels(account(), {
      secrets: createFakeSecretVault(),
      baseEnv: {},
      capabilities: routeCatalog,
      query: scripted.query,
    });

    const options = scripted.calls[0]?.options;
    expect(options.settingSources).toEqual([]);
    expect(options.persistSession).toBe(false);
    expect(options.model).toBeUndefined();
    expect(options.resume).toBeUndefined();
    expect(scripted.calls[0]?.prompt).toBeTypeOf('object'); // a stream, never a plain string
    expect(scripted.inputMessages()).toEqual([]);
    expect(scripted.closed()).toBe(true);
  });

  it('P-29: a supported-models rejection fails with a catalog error and the query is still closed', async () => {
    const scripted = scriptedQuery(() => Promise.reject(new Error(`boom ${ROUTE_TOKEN}`)));
    const result = await listClaudeRouteModels(account(), {
      secrets: createFakeSecretVault(),
      baseEnv: {},
      capabilities: routeCatalog,
      query: scripted.query,
    });

    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.code).toBe('spawn_failed');
    expect(scripted.closed()).toBe(true);
  });

  it('P-29: a silent supported-models call times out — timeout error, query closed, no value leaked into the message', async () => {
    const scripted = scriptedQuery(() => new Promise<ModelInfo[]>(() => undefined));
    const result = await listClaudeRouteModels(account(), {
      secrets: createFakeSecretVault(),
      baseEnv: {},
      capabilities: routeCatalog,
      query: scripted.query,
      timeoutMs: 10,
    });

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.code).toBe('timeout');
      expect(result.error.message).not.toContain(ROUTE_TOKEN);
    }
    expect(scripted.closed()).toBe(true);
  });

  it('P-29: a route whose environment cannot be built fails before any query runs — missing endpoint token', async () => {
    const scripted = scriptedQuery(async () => []);
    const result = await listClaudeRouteModels(
      account({ authMode: 'api_key', routeKind: 'zai-glm', endpoint: ZAI_ENDPOINT }),
      {
        secrets: createFakeSecretVault(),
        baseEnv: {},
        query: scripted.query,
      },
    );

    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.code).toBe('not_logged_in');
    expect(scripted.calls.length).toBe(0);
  });

  describe('environment parity with the transport (P-29)', () => {
    /** Runs one transport start and one catalog call for the same account and fakes; returns the
     * two captured environments so the test can demand they be equal. */
    const environmentsOf = async (
      accountFixture: AccountRecord,
      vaultValue?: string,
    ): Promise<{ readonly catalog: unknown; readonly transport: unknown }> => {
      const accounts = createFakeAccountRepo();
      await accounts.save(accountFixture);
      const secrets = createFakeSecretVault();
      if (vaultValue !== undefined) await secrets.put('ref-zai', vaultValue);
      const baseEnv = {
        SHELL: '/bin/zsh',
        ANTHROPIC_API_KEY: 'stale-not-the-real-key',
        ANTHROPIC_AUTH_TOKEN: 'stale-inherited-token',
        ANTHROPIC_BASE_URL: STRAY_BASE_URL,
        ANTHROPIC_DEFAULT_OPUS_MODEL: 'stale-opus',
        ANTHROPIC_DEFAULT_SONNET_MODEL: 'stale-sonnet',
        ANTHROPIC_DEFAULT_HAIKU_MODEL: 'stale-haiku',
      };
      const catalogScript = scriptedQuery(async () => []);
      const catalogResult = await listClaudeRouteModels(accountFixture, {
        secrets,
        baseEnv,
        capabilities: routeCatalog,
        query: catalogScript.query,
      });
      if (!catalogResult.ok) throw new Error(`catalog call failed: ${catalogResult.error.code}`);

      const transportScript = scriptedQuery(async () => []);
      const transport = createSdkTransport({
        clock: createFakeClock(START_AT),
        accounts,
        secrets,
        capabilities: routeCatalog,
        baseEnv,
        query: transportScript.query,
      });
      const started = await transport.start({
        runId: RUN_ID,
        cwd: '/tmp/docket-catalog-parity',
        role: {
          id: ROLE,
          name: 'Implementer',
          instructions: 'Follow the work order exactly.',
          writeScope: { kind: 'repo' },
          capabilities: [],
          active: true,
        },
        route: { accountId: ACCOUNT },
        prompt: 'do the work',
        capabilities: [],
      });
      if (!started.ok) throw new Error(`transport start failed: ${started.error.code}`);
      for await (const _event of started.value.events) void _event; // drain to settle the call

      return {
        catalog: catalogScript.calls[0]?.options.env,
        transport: transportScript.calls[0]?.options.env,
      };
    };

    it('P-29: a compatible-endpoint account — the catalog environment equals the run environment', async () => {
      const envs = await environmentsOf(
        account({ authMode: 'api_key', secretRef: 'ref-zai', routeKind: 'zai-glm', endpoint: ZAI_ENDPOINT }),
        ROUTE_TOKEN,
      );
      expect(envs.catalog).toEqual(envs.transport);
      expect(envs.catalog).toMatchObject({
        ANTHROPIC_BASE_URL: ZAI_ENDPOINT,
        ANTHROPIC_AUTH_TOKEN: ROUTE_TOKEN,
        ANTHROPIC_DEFAULT_OPUS_MODEL: 'glm-5.3[1m]',
      });
    });

    it('P-29: a subscription account with an identity directory — the catalog environment equals the run environment', async () => {
      const envs = await environmentsOf(account({ identityDir: CONFIG_DIR }));
      expect(envs.catalog).toEqual(envs.transport);
      expect(envs.catalog).toMatchObject({ CLAUDE_CONFIG_DIR: CONFIG_DIR });
      expect(envs.catalog).not.toHaveProperty('ANTHROPIC_BASE_URL');
    });
  });
});
