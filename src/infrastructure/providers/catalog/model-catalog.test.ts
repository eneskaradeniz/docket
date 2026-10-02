// The ModelCatalog port implementation (P-29 section 3, layer 3): one cached merged list per
// account and route, refreshed through the Claude catalog adapter or — on an API-key route — the
// documented model-list endpoint adapter, keeping the last good list marked stale when a refresh
// fails. The merge rules themselves live in the domain tests; these tests pin the caching, the
// fetcher choice per route kind, and the failure behaviour.
import { spawn as nodeSpawn } from 'node:child_process';
import { chmodSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { ModelInfo } from '@anthropic-ai/claude-agent-sdk';

import { createModelCatalog, MODEL_SOURCE_ADAPTERS } from './model-catalog';
import type { QueryFn } from '../transports/sdk/transport';
import {
  createFakeModelListPool,
  FAKE_MODEL_LIST_KEY,
  type FakeModelListPool,
} from './fixtures/fake-model-list-server-harness';
import {
  createFakeAccountRepo,
  createFakeCapabilityCatalog,
  createFakeClock,
  createFakeSecretVault,
} from '../../../application/ports/fakes/index';
import type { AccountRecord } from '../../../application/index';
import { parseUlid, type AccountId } from '../../../domain/index';

const START_AT = 1770000000000;
const ROUTE_TOKEN = 'zai-' + 'endpoint' + '-token';
const ZAI_ENDPOINT = 'https://api.z.ai/api/anthropic';

function ulidOf(suffix: string): AccountId {
  const parsed = parseUlid<'account'>(`01ARZ3NDEKTSV4RRFFQ69G5F${suffix}`);
  if (!parsed.ok) throw new Error('fixture ulid must parse');
  return parsed.value;
}

const ACCOUNT_A: AccountId = ulidOf('AV');
const ACCOUNT_B: AccountId = ulidOf('BV');

function account(id: AccountId, overrides?: Partial<AccountRecord>): AccountRecord {
  return {
    id,
    provider: 'agent-cli',
    label: 'main',
    authMode: 'subscription',
    limitPolicy: 'wait_resume',
    caps: [],
    ...(overrides === undefined ? {} : overrides),
  };
}

const PRO_ROW: ModelInfo = {
  value: 'claude-fable-5-1[1m]',
  resolvedModel: 'claude-fable-5-1',
  displayName: 'Fable [1m]',
  description: '',
  supportsEffort: true,
  supportedEffortLevels: ['low', 'medium', 'high', 'xhigh', 'max'],
};

/** A query double whose supported-models answer is scripted per call; counts calls and can fail. */
function scriptedQuery(answers: readonly (readonly ModelInfo[] | Error)[]): { readonly query: QueryFn } {
  let index = 0;
  const query: QueryFn = () => {
    const answer = answers[Math.min(index, answers.length - 1)] ?? [];
    index += 1;
    const fail = answer instanceof Error;
    const generator = (async function* (): AsyncGenerator<never, void> {
      // No SDK messages: the listing query needs none.
    })();
    const unsupported = (): Promise<never> => Promise.reject(new Error('fake query: not scripted'));
    return Object.assign(generator, {
      interrupt: (): Promise<undefined> => Promise.resolve(undefined),
      setPermissionMode: (): Promise<void> => Promise.resolve(),
      setMcpPermissionModeOverride: (): Promise<{ warning?: string }> => Promise.resolve({}),
      setModel: (): Promise<void> => Promise.resolve(),
      setMaxThinkingTokens: (): Promise<void> => Promise.resolve(),
      applyFlagSettings: (): Promise<void> => Promise.resolve(),
      initializationResult: unsupported,
      reinitialize: unsupported,
      supportedCommands: unsupported,
      supportedModels: (): Promise<ModelInfo[]> =>
        fail ? Promise.reject(answer) : Promise.resolve([...(answer as readonly ModelInfo[])]),
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
      cancelAsyncMessage: (): Promise<boolean> => Promise.resolve(false),
      close: (): void => undefined,
    });
  };
  return { query };
}

const baseConfig = (query: QueryFn) => ({
  secrets: createFakeSecretVault(),
  baseEnv: {},
  clock: createFakeClock(START_AT),
  capabilities: createFakeCapabilityCatalog([
    { id: 'anthropic-subscription', authMode: 'subscription', provider: 'agent-cli' },
    { id: 'anthropic-api', authMode: 'api_key', provider: 'agent-cli' },
    { id: 'codex-subscription', authMode: 'subscription', provider: 'codex' },
    { id: 'copilot-subscription', authMode: 'subscription', provider: 'copilot' },
    { id: 'agy-subscription', authMode: 'subscription', provider: 'agy' },
    { id: 'opencode-subscription', authMode: 'subscription', provider: 'opencode' },
  ]),
  query,
  ttlMs: 6 * 60 * 60 * 1000,
});

/** One documented row of the model-list endpoint answer, the shape the adapter parses. */
const endpointRow = (id: string): Record<string, unknown> => ({ type: 'model', id, display_name: `${id} display` });
const endpointPage = (rows: readonly Record<string, unknown>[]): string => JSON.stringify({ data: rows, has_more: false, last_id: null });

let pool: FakeModelListPool;

beforeAll(() => {
  pool = createFakeModelListPool();
});

afterAll(() => {
  pool.dispose();
});

describe('createModelCatalog (P-29)', () => {
  it('P-29: a subscription account lists the live answer — the [1m] value verbatim, family-classified tiers from the pattern data', async () => {
    const accounts = createFakeAccountRepo();
    await accounts.save(account(ACCOUNT_A));
    const catalog = createModelCatalog({ ...baseConfig(scriptedQuery([[PRO_ROW]]).query), accounts });

    const listed = await catalog.list(ACCOUNT_A);

    expect(listed).toEqual([
      {
        id: 'claude-fable-5-1[1m]',
        displayName: 'Fable [1m]',
        source: 'live',
        thinking: { kind: 'levels', levels: ['low', 'medium', 'high', 'xhigh', 'max'] },
        billing: 'unknown',
      },
    ]);
    // The newest family carries no pattern: selectable, but no automatic tier and no label.
    expect(listed[0]?.tier).toBeUndefined();
    expect(listed[0]?.autoClassified).toBeUndefined();
  });

  it('P-29: the cache is keyed by account and route — a second call within the TTL runs no query, another account runs its own', async () => {
    const accounts = createFakeAccountRepo();
    await accounts.save(account(ACCOUNT_A));
    await accounts.save(account(ACCOUNT_B));
    const { query } = scriptedQuery([[PRO_ROW]]);
    let calls = 0;
    const counting: QueryFn = (params) => {
      calls += 1;
      return query(params);
    };
    const catalog = createModelCatalog({ ...baseConfig(counting), accounts });

    await catalog.list(ACCOUNT_A);
    await catalog.list(ACCOUNT_A); // cached: no second query for the same account and route
    await catalog.list(ACCOUNT_B); // another account: its own key, its own query

    expect(calls).toBe(2);
  });

  it('P-29: refresh bypasses the cache, and an expired entry is fetched again', async () => {
    const accounts = createFakeAccountRepo();
    await accounts.save(account(ACCOUNT_A));
    const { query } = scriptedQuery([[PRO_ROW]]);
    let calls = 0;
    const counting: QueryFn = (params) => {
      calls += 1;
      return query(params);
    };
    const clock = createFakeClock(START_AT);
    const catalog = createModelCatalog({ ...baseConfig(counting), accounts, clock, ttlMs: 100 });

    await catalog.list(ACCOUNT_A);
    await catalog.list(ACCOUNT_A, { refresh: true }); // explicit bypass
    expect(calls).toBe(2);
    await catalog.list(ACCOUNT_A); // still cached
    expect(calls).toBe(2);
    clock.advance(101); // past the TTL: the entry is gone
    await catalog.list(ACCOUNT_A);
    expect(calls).toBe(3);
  });

  it('P-29: a failed refresh keeps the previous list and marks every entry stale', async () => {
    const accounts = createFakeAccountRepo();
    await accounts.save(account(ACCOUNT_A));
    const catalog = createModelCatalog({
      ...baseConfig(scriptedQuery([[PRO_ROW], new Error('listing failed')]).query),
      accounts,
    });

    const first = await catalog.list(ACCOUNT_A);
    const refreshed = await catalog.list(ACCOUNT_A, { refresh: true });

    expect(refreshed).toEqual(first.map((model) => ({ ...model, stale: true })));
  });

  it('P-29: a first refresh that fails falls back to the non-retired bundled models, unmarked', async () => {
    const accounts = createFakeAccountRepo();
    await accounts.save(account(ACCOUNT_A));
    const catalog = createModelCatalog({
      ...baseConfig(scriptedQuery([new Error('listing failed')]).query),
      accounts,
    });

    // A failure-shaped fallback, not an error: the subscription kind's bundled models answer,
    // and nothing is marked stale because nothing was ever successfully refreshed.
    expect(await catalog.list(ACCOUNT_A)).toEqual([
      {
        id: 'claude-opus-5-5',
        source: 'bundled',
        tier: 'strong',
        thinking: { kind: 'levels', levels: ['low', 'medium', 'high', 'xhigh', 'max'] },
        billing: 'included',
      },
      {
        id: 'claude-sonnet-5-5',
        source: 'bundled',
        tier: 'balanced',
        thinking: { kind: 'levels', levels: ['low', 'medium', 'high', 'xhigh', 'max'] },
        billing: 'included',
      },
      {
        id: 'claude-haiku-4-5',
        source: 'bundled',
        tier: 'fast',
        thinking: { kind: 'none' },
        billing: 'included',
      },
    ]);
  });

  it('P-29: an API-key account lists from the documented model-list endpoint, never the SDK query', async () => {
    const server = await pool.start([{ status: 200, body: endpointPage([endpointRow('claude-fable-5-1[1m]'), endpointRow('claude-opus-5-5')]) }]);
    const accounts = createFakeAccountRepo();
    await accounts.save(account(ACCOUNT_A, { authMode: 'api_key', secretRef: 'ref-key' }));
    const { query } = scriptedQuery([[PRO_ROW]]);
    let calls = 0;
    const counting: QueryFn = (params) => {
      calls += 1;
      return query(params);
    };
    const secrets = createFakeSecretVault();
    await secrets.put('ref-key', FAKE_MODEL_LIST_KEY);
    // The api-key default kind declares its live list on the documented endpoint, not the SDK call.
    const catalog = createModelCatalog({ ...baseConfig(counting), accounts, secrets, apiBaseUrl: server.endpoint });

    expect(await catalog.list(ACCOUNT_A)).toEqual([
      {
        id: 'claude-fable-5-1[1m]',
        displayName: 'claude-fable-5-1[1m] display',
        source: 'live',
        thinking: 'unknown',
        billing: 'metered',
      },
      {
        id: 'claude-opus-5-5',
        displayName: 'claude-opus-5-5 display',
        source: 'live',
        tier: 'strong',
        thinking: 'unknown',
        autoClassified: true,
        billing: 'metered',
      },
    ]);
    // The family pattern classifies opus from the id; the endpoint reports no thinking levels,
    // and the route kind's default meters every row the endpoint left silent about.
    expect(calls).toBe(0);
  });

  it('P-40: every model an API-key route lists is metered — the route kind default, not an endpoint report', async () => {
    const server = await pool.start([{ status: 200, body: endpointPage([endpointRow('claude-sonnet-5-5')]) }]);
    const accounts = createFakeAccountRepo();
    await accounts.save(account(ACCOUNT_A, { authMode: 'api_key', secretRef: 'ref-key' }));
    const secrets = createFakeSecretVault();
    await secrets.put('ref-key', FAKE_MODEL_LIST_KEY);
    const catalog = createModelCatalog({ ...baseConfig(scriptedQuery([[]]).query), accounts, secrets, apiBaseUrl: server.endpoint });

    const listed = await catalog.list(ACCOUNT_A);

    expect(listed.length).toBe(1);
    expect(listed.every((model) => model.billing === 'metered')).toBe(true);
  });

  it('P-29: a failed endpoint refresh keeps the previous list and marks every entry stale', async () => {
    const server = await pool.start([{ status: 200, body: endpointPage([endpointRow('claude-sonnet-5-5')]) }]);
    const accounts = createFakeAccountRepo();
    await accounts.save(account(ACCOUNT_A, { authMode: 'api_key', secretRef: 'ref-key' }));
    const secrets = createFakeSecretVault();
    await secrets.put('ref-key', FAKE_MODEL_LIST_KEY);
    const catalog = createModelCatalog({ ...baseConfig(scriptedQuery([[]]).query), accounts, secrets, apiBaseUrl: server.endpoint });

    const first = await catalog.list(ACCOUNT_A);
    server.setPayload([{ status: 500, body: 'overloaded' }]);
    const refreshed = await catalog.list(ACCOUNT_A, { refresh: true });

    expect(refreshed).toEqual(first.map((model) => ({ ...model, stale: true })));
  });

  it('P-29: a compatible-endpoint account lists through the SDK call with its route environment', async () => {
    const accounts = createFakeAccountRepo();
    await accounts.save(
      account(ACCOUNT_A, { authMode: 'api_key', secretRef: 'ref-zai', routeKind: 'zai-glm', endpoint: ZAI_ENDPOINT }),
    );
    const secrets = createFakeSecretVault();
    await secrets.put('ref-zai', ROUTE_TOKEN);
    const glmRow: ModelInfo = {
      value: 'glm-5.3',
      resolvedModel: 'glm-5.3',
      displayName: 'GLM 5.3',
      description: '',
      supportsEffort: true,
      supportedEffortLevels: ['low', 'medium', 'high'],
    };
    const catalog = createModelCatalog({ ...baseConfig(scriptedQuery([[glmRow]]).query), accounts, secrets });

    expect(await catalog.list(ACCOUNT_A)).toEqual([
      {
        id: 'glm-5.3',
        displayName: 'GLM 5.3',
        source: 'live',
        thinking: { kind: 'levels', levels: ['low', 'medium', 'high'] },
        billing: 'unknown',
      },
    ]);
  });

  it('P-29: an app-server route kind dispatches to the app-server adapter — a plan-authoritative list with the kind billing', async () => {
    // The fake app-server rides on the node binary; the listing's model/list answer is scripted.
    const fixture = join(dirname(fileURLToPath(import.meta.url)), '..', 'transports', 'app-server', 'fixtures', 'fake-app-server.cjs');
    const dir = mkdtempSync(join(tmpdir(), 'docket-model-catalog-app-server-'));
    const spawn = (_command: string, _args: readonly string[], _options: { readonly timeoutMs?: number }) =>
      nodeSpawn(process.execPath, [fixture, 'model-list', join(dir, 'rpc.log')]);
    const accounts = createFakeAccountRepo();
    await accounts.save(account(ACCOUNT_A, { provider: 'codex' }));
    const catalog = createModelCatalog({ ...baseConfig(scriptedQuery([[]]).query), accounts, appServer: { spawn } });

    expect(await catalog.list(ACCOUNT_A)).toEqual([
      {
        id: 'gpt-5.3-codex',
        displayName: 'GPT-5.3 Codex',
        source: 'live',
        thinking: { kind: 'levels', levels: ['low', 'medium', 'high', 'xhigh', 'max', 'ultra'] },
        billing: 'included',
      },
      {
        id: 'gpt-5.3-mini',
        displayName: 'GPT-5.3 mini',
        source: 'live',
        thinking: { kind: 'levels', levels: ['minimal', 'low', 'medium', 'high', 'xhigh'] },
        billing: 'included',
      },
      {
        id: 'gpt-5.3-nano',
        displayName: 'GPT-5.3 nano',
        source: 'live',
        thinking: { kind: 'levels', levels: ['low', 'high'] },
        billing: 'included',
      },
      { id: 'gpt-5.3', displayName: 'GPT-5.3', source: 'live', thinking: 'unknown', billing: 'included' },
    ]);
  });

<<<<<<< HEAD
  it('P-29: an acp-session route kind dispatches to the ACP adapter — a plan-authoritative list whose rows bill unknown without a verified default', async () => {
    // The fake ACP agent rides on the node binary; its session/new answer is scripted.
    const fixture = join(dirname(fileURLToPath(import.meta.url)), '..', 'transports', 'acp', 'fake-agent.cjs');
    const dir = mkdtempSync(join(tmpdir(), 'docket-model-catalog-acp-'));
    const spawn = (_command: string, _args: readonly string[], _options: { readonly env?: Readonly<Record<string, string>>; readonly timeoutMs?: number }) =>
      nodeSpawn(process.execPath, [fixture, 'models-opencode', join(dir, 'agent-log.jsonl')]);
    const accounts = createFakeAccountRepo();
    await accounts.save(account(ACCOUNT_A, { provider: 'opencode' }));
    const catalog = createModelCatalog({ ...baseConfig(scriptedQuery([[]]).query), accounts, acp: { spawn } });

    // No bundled records and no verified default billing: the live rows are the whole list and
    // each reads unknown — never assumed free (P-40), because the provider's documentation ties
    // no listed model to a covered plan.
    expect(await catalog.list(ACCOUNT_A)).toEqual([
      {
        id: 'opencode/big-pickle',
        displayName: 'opencode/Big Pickle',
        source: 'live',
        thinking: { kind: 'levels', levels: ['low', 'high', 'max'] },
        billing: 'unknown',
      },
      {
        id: 'opencode/fledge-alpha-free',
        displayName: 'opencode/Fledge Alpha Free',
        source: 'live',
        thinking: { kind: 'levels', levels: ['low', 'high', 'max'] },
        billing: 'unknown',
      },
      {
        id: 'opencode/space-bunny-free',
        displayName: 'opencode/Space Bunny Free',
        source: 'live',
        thinking: { kind: 'levels', levels: ['low', 'high', 'max'] },
        billing: 'unknown',
      },
=======
  it('P-29: an acp-session route kind dispatches to the session adapter — the plan-limited answer lists the settings, billing unknown', async () => {
    // The fake agent rides on the node binary; the scenario answers the recorded shape of a
    // plan limited to the automatic choice, which the adapter expands to the route's settings.
    const fixture = join(dirname(fileURLToPath(import.meta.url)), 'fixtures', 'fake-acp-session.cjs');
    const dir = mkdtempSync(join(tmpdir(), 'docket-model-catalog-acp-'));
    const spawn = (_command: string, _args: readonly string[], _options: { readonly timeoutMs?: number }) =>
      nodeSpawn(process.execPath, [fixture, 'auto-only', join(dir, 'rpc.log')]);
    const accounts = createFakeAccountRepo();
    await accounts.save(account(ACCOUNT_A, { provider: 'copilot' }));
    const catalog = createModelCatalog({ ...baseConfig(scriptedQuery([[]]).query), accounts, appServer: { spawn } });

    // The kind fixes no billing default, so every setting reads unknown — hand-pick with
    // consent, never assumed free; the tiers resolve to these ids through the kind's data.
    expect(await catalog.list(ACCOUNT_A)).toEqual([
      { id: 'intelligence', source: 'live', thinking: 'unknown', billing: 'unknown' },
      { id: 'balance', source: 'live', thinking: 'unknown', billing: 'unknown' },
      { id: 'efficiency', source: 'live', thinking: 'unknown', billing: 'unknown' },
>>>>>>> origin/v2
    ]);
  });

  it('P-29: a source no adapter covers answers from the bundled registry alone', async () => {
    const accounts = createFakeAccountRepo();
    await accounts.save(account(ACCOUNT_A));
    const { query } = scriptedQuery([[PRO_ROW]]);
    let calls = 0;
    const counting: QueryFn = (params) => {
      calls += 1;
      return query(params);
    };
    // No adapter registered: the route kind's source has no live leg, so the SDK query never runs
    // and the bundled records are the whole answer — the subscription kind's bundled flagships.
    const catalog = createModelCatalog({ ...baseConfig(counting), accounts, adapters: {} });

    const listed = await catalog.list(ACCOUNT_A);
    expect(listed).toEqual([
      {
        id: 'claude-opus-5-5',
        source: 'bundled',
        tier: 'strong',
        thinking: { kind: 'levels', levels: ['low', 'medium', 'high', 'xhigh', 'max'] },
        billing: 'included',
      },
      {
        id: 'claude-sonnet-5-5',
        source: 'bundled',
        tier: 'balanced',
        thinking: { kind: 'levels', levels: ['low', 'medium', 'high', 'xhigh', 'max'] },
        billing: 'included',
      },
      { id: 'claude-haiku-4-5', source: 'bundled', tier: 'fast', thinking: { kind: 'none' }, billing: 'included' },
    ]);
    expect(calls).toBe(0);
  });

  it('P-29: a cli-command route kind dispatches to the CLI adapter — a live list with no billing claim', async () => {
    // The fake binary prints the recorded shape of the CLI's own models table; the spawn rides
    // the real node machinery, so the dispatch itself is what is under test here.
    const dir = mkdtempSync(join(tmpdir(), 'docket-model-catalog-cli-'));
    const binPath = join(dir, 'agy');
    const table = [
      'gemini-3.8-flash-high\tGemini 3.8 Flash (High)',
      'claude-opus-4-6-thinking\tClaude Opus 4.6 (Thinking)',
      'claude-sonnet-4-6\tClaude Sonnet 4.6 (Thinking)',
    ].join('\n');
    writeFileSync(binPath, `#!/bin/sh\ncat <<'DOCKET_MODELS'\n${table}\nDOCKET_MODELS\n`);
    chmodSync(binPath, 0o755);
    const accounts = createFakeAccountRepo();
    await accounts.save(account(ACCOUNT_A, { provider: 'agy' }));
    const catalog = createModelCatalog({
      ...baseConfig(scriptedQuery([[]]).query),
      accounts,
      cli: { command: binPath, spawn: nodeSpawn },
    });

    const listed = await catalog.list(ACCOUNT_A);

    expect(listed).toHaveLength(3);
    expect(listed.find((model) => model.id === 'gemini-3.8-flash-high')).toEqual({
      id: 'gemini-3.8-flash-high',
      displayName: 'Gemini 3.8 Flash (High)',
      source: 'live',
      thinking: { kind: 'levels', levels: ['high'] },
      billing: 'unknown',
    });
    // The Claude rows are unknown ids the family patterns classify (P-29 section 4), and their
    // billing stays unknown — the route kind fixes no default, so picking one asks for consent.
    expect(listed.find((model) => model.id === 'claude-opus-4-6-thinking')).toMatchObject({
      tier: 'strong',
      autoClassified: true,
      billing: 'unknown',
    });
    expect(listed.find((model) => model.id === 'claude-sonnet-4-6')).toMatchObject({
      tier: 'balanced',
      autoClassified: true,
      billing: 'unknown',
    });
  });

  it('P-29: the built-in adapter map covers exactly the sources with a live leg today', () => {
    expect(Object.keys(MODEL_SOURCE_ADAPTERS).sort()).toEqual(['acp-session', 'api', 'app-server', 'cli-command', 'sdk']);
  });

  it('P-29: an unknown account, or one whose provider resolves no route kind, answers an empty list', async () => {
    const accounts = createFakeAccountRepo();
    await accounts.save(account(ACCOUNT_A, { provider: 'some-other-cli' }));
    const { query } = scriptedQuery([[PRO_ROW]]);
    let calls = 0;
    const counting: QueryFn = (params) => {
      calls += 1;
      return query(params);
    };
    const catalog = createModelCatalog({ ...baseConfig(counting), accounts });

    expect(await catalog.list(ulidOf('CV'))).toEqual([]); // no account record at all
    expect(await catalog.list(ACCOUNT_A)).toEqual([]); // no registry route kind for the provider
    expect(calls).toBe(0);
  });
});
