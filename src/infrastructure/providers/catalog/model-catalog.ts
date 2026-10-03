// The ModelCatalog port over the registry and the route's own live-list adapter (P-29 section 3):
// one cached merged list per account and route — never per provider, because a plan-dependent
// list must not leak between two accounts of the same provider. The live list itself comes from
// a map of adapters keyed by the route kind's declared model source; a source no adapter covers
// has no live fetch, and the registry is that route's whole answer.
import type { AccountRepo, CapabilityCatalog, Clock, ModelCatalog, SecretVault, TransportError } from '../../../application/index';
import type { AccountRecord } from '../../../application/index';
import type { CatalogModel, EpochMs, LiveModel, MergeOptions, Result, RouteKindRecord } from '../../../domain/index';
import { catalogCacheKey, mergeCatalog } from '../../../domain/index';
import { createCapabilityCatalog, FAMILY_PATTERNS, findRouteKind } from '../registry';
import type { AppServerSpawn } from '../transports/app-server/index';
import type { AcpSpawn } from '../transports/acp/index';
import { listAcpSessionModels } from './acp-session-catalog';
import { listApiKeyRouteModels } from './api-key-catalog';
import { listAppServerRouteModels } from './app-server-catalog';
import { listClaudeRouteModels } from './claude-catalog';
import { listCliCommandRouteModels } from './cli-command-catalog';
import type { CliModelSpawn } from './cli-command-catalog';
import { listCopilotRouteModels } from './copilot-catalog';
import { BUILTIN_PROVIDER_DEFS } from '../defs/builtin-provider-defs';
import type { LevelNames, ProviderDef } from '../defs/provider-def';
import type { QueryFn } from '../transports/sdk/transport';

/** A live-list adapter's failure: the transport error codes the adapters share, the HTTP leg's
 * endpoint errors, and the adapters' own timeout. The message never carries an environment
 * value, a token or a server crash text. */
export type CatalogError = {
  readonly code: TransportError['code'] | 'timeout' | 'endpoint_error' | 'malformed';
  readonly message: string;
};

/** Where a route kind's live list comes from, in the registry's own vocabulary. */
export type ModelSource = RouteKindRecord['modelSource'];

/** Everything a live-list adapter may draw on: the shared ports plus the adapters' own knobs,
 * with the capability catalog already resolved to the one this catalog answers from. */
export interface ModelAdapterDeps {
  readonly secrets: Pick<SecretVault, 'get'>;
  readonly baseEnv: Readonly<Record<string, string>>; // the same allowlist the SDK transport builds from
  readonly capabilities: Pick<CapabilityCatalog, 'routeKindOf'>;
  readonly query?: QueryFn; // the sdk-source adapter's transport; default: the SDK's query
  readonly fetch?: typeof globalThis.fetch; // the api-source adapter's transport; default: the global fetch
  readonly apiBaseUrl?: string; // base of the documented model-list endpoint; default: the provider's documented host
  readonly appServer?: { readonly command?: string; readonly spawn?: AppServerSpawn }; // the app-server adapter's connection, and the Copilot session's
  readonly acp?: { readonly command?: string; readonly args?: readonly string[]; readonly spawn?: AcpSpawn }; // the Cursor and OpenCode session adapter's connection
  readonly cli?: { readonly command?: string; readonly spawn?: CliModelSpawn; readonly needsLogin?: true }; // the cli-command adapter's process runner
  readonly timeoutMs?: number; // the adapters' per-call ceiling
  readonly levelNames?: Readonly<Record<string, LevelNames>>; // provider id → its own level names
  readonly loggedIn?: Readonly<Record<string, boolean | null>>; // provider id → the login probe's answer
}

/** One source's live list: the rows the route itself reports for this account. */
export type ModelSourceAdapter = (
  account: AccountRecord,
  route: RouteKindRecord,
  deps: ModelAdapterDeps,
) => Promise<Result<readonly LiveModel[], CatalogError>>;

export interface ModelCatalogConfig {
  readonly accounts: Pick<AccountRepo, 'get'>;
  readonly secrets: Pick<SecretVault, 'get'>;
  readonly baseEnv: Readonly<Record<string, string>>; // the same allowlist the SDK transport builds from
  readonly clock: Clock;
  readonly capabilities?: Pick<CapabilityCatalog, 'routeKindOf'>; // default: the registry's own catalog
  readonly query?: QueryFn; // default: the SDK's query
  readonly fetch?: typeof globalThis.fetch; // the api-source adapter's transport; default: the global fetch
  readonly apiBaseUrl?: string; // base of the documented model-list endpoint; default: the provider's documented host
  readonly appServer?: { readonly command?: string; readonly spawn?: AppServerSpawn }; // the app-server adapter's connection, and the Copilot session's
  readonly acp?: { readonly command?: string; readonly args?: readonly string[]; readonly spawn?: AcpSpawn }; // the Cursor and OpenCode session adapter's connection
  readonly cli?: { readonly command?: string; readonly spawn?: CliModelSpawn; readonly needsLogin?: true }; // the cli-command adapter's process runner
  readonly timeoutMs?: number; // the adapters' per-call ceiling
  readonly levelNames?: Readonly<Record<string, LevelNames>>; // provider id → its own level names; default: the built-in definitions'
  readonly loggedIn?: Readonly<Record<string, boolean | null>>; // provider id → the login probe's answer; absent = unknown
  /** Discovery's latest login answers, read at every listing; wins over `loggedIn` for a provider it has reported. */
  readonly loginStates?: { get(providerId: string): boolean | null | undefined };
  readonly ttlMs?: number; // cache lifetime; the default is six hours
  /** Live-list adapters per model source; default: the built-in map below. A source the chosen
   * map leaves uncovered answers from the bundled registry — the built-in map's own answer for
   * `static` today. */
  readonly adapters?: Readonly<Partial<Record<ModelSource, ModelSourceAdapter>>>;
}

const DEFAULT_TTL_MS = 6 * 60 * 60 * 1000;

interface CacheEntry {
  readonly models: readonly CatalogModel[];
  readonly at: EpochMs;
  readonly loggedIn: boolean; // whether the login was confirmed when the entry was made
}

/** The SDK leg's adapter: one supported-models query on the account's shared route environment.
 * It serves the kinds that declare the SDK as their source — a compatible endpoint included,
 * because the endpoint answers the same call through the shared route environment and the tier
 * overrides the environment carries are exactly what the list reflects. */
const sdkAdapter: ModelSourceAdapter = (account, _route, deps) =>
  listClaudeRouteModels(account, {
    secrets: deps.secrets,
    baseEnv: deps.baseEnv,
    capabilities: deps.capabilities,
    ...(deps.query === undefined ? {} : { query: deps.query }),
    ...(deps.timeoutMs === undefined ? {} : { timeoutMs: deps.timeoutMs }),
  });

/** The documented-endpoint leg's adapter: the provider's model-list API, which an API-key route
 * rides — every model such a route lists is metered (P-40), which is exactly why it needs its
 * own live list. */
const apiAdapter: ModelSourceAdapter = (account, _route, deps) =>
  listApiKeyRouteModels(account, {
    secrets: deps.secrets,
    ...(deps.fetch === undefined ? {} : { fetch: deps.fetch }),
    ...(deps.apiBaseUrl === undefined ? {} : { baseUrl: deps.apiBaseUrl }),
    ...(deps.timeoutMs === undefined ? {} : { timeoutMs: deps.timeoutMs }),
  });

/** The app-server leg's adapter: the provider's own control surface — initialize, then
 * model/list paged; no thread, no turn, no prompt. */
const appServerAdapter: ModelSourceAdapter = (account, _route, deps) =>
  listAppServerRouteModels(account, {
    ...(deps.appServer === undefined ? {} : deps.appServer),
    ...(deps.timeoutMs === undefined ? {} : { timeoutMs: deps.timeoutMs }),
  });

/** The ACP session leg's adapter: initialize, then session/new — the plan-scoped answer a
 * session carries; no prompt turn, so a listing spends no quota. Copilot's answer needs its own
 * reading (the automatic choice expands to quality settings); the other providers' sessions
 * share one reader. */
const acpSessionAdapter: ModelSourceAdapter = (account, route, deps) =>
  account.provider === 'copilot'
    ? listCopilotRouteModels(account, route, {
        ...(deps.appServer === undefined ? {} : deps.appServer),
        ...(deps.timeoutMs === undefined ? {} : { timeoutMs: deps.timeoutMs }),
      })
    : listAcpSessionModels(account, {
        baseEnv: deps.baseEnv,
        ...(deps.levelNames?.[account.provider] === undefined ? {} : { levelNames: deps.levelNames[account.provider] }),
        ...(deps.acp === undefined ? {} : deps.acp),
        ...(deps.timeoutMs === undefined ? {} : { timeoutMs: deps.timeoutMs }),
      });

/** The cli-command leg's adapter: the provider's own model-listing subcommand — a plain command
 * run, no print-mode prompt, so no agent turn ever starts. */
const cliCommandAdapter: ModelSourceAdapter = (account, _route, deps) =>
  listCliCommandRouteModels(account, {
    ...(deps.levelNames?.[account.provider] === undefined ? {} : { levelNames: deps.levelNames[account.provider] }),
    ...(deps.loggedIn?.[account.provider] === undefined ? {} : { loggedIn: deps.loggedIn[account.provider] }),
    ...(deps.cli === undefined ? {} : deps.cli),
    ...(deps.timeoutMs === undefined ? {} : { timeoutMs: deps.timeoutMs }),
  });

/** The live-list adapters the catalog ships with, keyed by the model source a route kind
 * declares. A source no entry covers (`static` today) has no live fetch: the registry is that
 * route's whole answer. */
export const MODEL_SOURCE_ADAPTERS: Readonly<Partial<Record<ModelSource, ModelSourceAdapter>>> = {
  sdk: sdkAdapter,
  api: apiAdapter,
  'app-server': appServerAdapter,
  'acp-session': acpSessionAdapter,
  'cli-command': cliCommandAdapter,
};

/** The merge knobs a route kind fixes: an authoritative live list, and the billing its live-only
 * rows take when they report none of their own. */
const mergeOptionsOf = (kind: RouteKindRecord): MergeOptions | undefined => {
  const options: MergeOptions = {
    ...(kind.liveIsAuthoritative === true ? { authoritative: true } : {}),
    ...(kind.defaultBilling !== undefined ? { defaultBilling: kind.defaultBilling } : {}),
    ...(kind.familyBilling !== undefined ? { familyBilling: kind.familyBilling } : {}),
  };
  return Object.keys(options).length === 0 ? undefined : options;
};

const levelNamesOf = (defs: readonly ProviderDef[]): Readonly<Record<string, LevelNames>> => {
  const byProvider: Record<string, LevelNames> = {};
  for (const def of defs) {
    if (def.levelNames !== undefined) byProvider[def.id] = def.levelNames;
  }
  return byProvider;
};

export function createModelCatalog(config: ModelCatalogConfig): ModelCatalog {
  const capabilities = config.capabilities ?? createCapabilityCatalog();
  const adapters = config.adapters ?? MODEL_SOURCE_ADAPTERS;
  const ttl = config.ttlMs ?? DEFAULT_TTL_MS;
  const cache = new Map<string, CacheEntry>();
  const adapterDeps: ModelAdapterDeps = {
    secrets: config.secrets,
    baseEnv: config.baseEnv,
    capabilities,
    ...(config.query === undefined ? {} : { query: config.query }),
    ...(config.fetch === undefined ? {} : { fetch: config.fetch }),
    ...(config.apiBaseUrl === undefined ? {} : { apiBaseUrl: config.apiBaseUrl }),
    ...(config.appServer === undefined ? {} : { appServer: config.appServer }),
    ...(config.acp === undefined ? {} : { acp: config.acp }),
    ...(config.cli === undefined ? {} : { cli: config.cli }),
    ...(config.timeoutMs === undefined ? {} : { timeoutMs: config.timeoutMs }),
    levelNames: config.levelNames ?? levelNamesOf(BUILTIN_PROVIDER_DEFS),
  };

  // Only a confirmed login lets a `needsLogin` command run: false, null and unknown all skip it.
  const loginOf = (provider: string): boolean | null | undefined =>
    config.loginStates?.get(provider) ?? config.loggedIn?.[provider];

  return {
    list: async (accountId, options) => {
      const account = await config.accounts.get(accountId);
      if (account === undefined) return [];
      const routeKindId = capabilities.routeKindOf({
        provider: account.provider,
        authMode: account.authMode,
        routeKind: account.routeKind,
      });
      const routeKind = routeKindId === undefined ? undefined : findRouteKind(routeKindId);
      if (routeKind === undefined) return [];

      const key = catalogCacheKey(accountId, routeKind.id);
      const login = loginOf(account.provider);
      const loggedIn = login === true;
      const cached = cache.get(key);
      // A login state that changed since the entry was made voids it: a list built while logged
      // out must not hide the live one for the rest of the cache lifetime.
      if (
        cached !== undefined &&
        options?.refresh !== true &&
        cached.loggedIn === loggedIn &&
        config.clock.now() - cached.at < ttl
      ) {
        return cached.models;
      }

      const adapter = adapters[routeKind.modelSource];
      if (adapter === undefined) {
        // No live fetch exists for this source: the registry is the answer, and a later
        // refresh of the same data changes nothing, so staleness never applies.
        const merged = mergeCatalog(undefined, routeKind.models, FAMILY_PATTERNS);
        cache.set(key, { models: merged, at: config.clock.now(), loggedIn });
        return merged;
      }
      const live = await adapter(account, routeKind, {
        ...adapterDeps,
        ...(login === undefined ? {} : { loggedIn: { [account.provider]: login } }),
      });
      if (live.ok) {
        const merged = mergeCatalog(
          live.value,
          routeKind.models,
          FAMILY_PATTERNS,
          cached?.models,
          mergeOptionsOf(routeKind),
        );
        cache.set(key, { models: merged, at: config.clock.now(), loggedIn });
        return merged;
      }
      // A failed refresh keeps the last good list marked stale. The kept entry keeps its original
      // timestamp, so the cache does not award the failed answer another TTL of silence — the next
      // call after expiry retries the live call.
      const kept = mergeCatalog(undefined, routeKind.models, FAMILY_PATTERNS, cached?.models);
      if (cached === undefined || cached.loggedIn !== loggedIn) {
        cache.set(key, { models: kept, at: config.clock.now(), loggedIn });
      }
      return kept;
    },
  };
}
