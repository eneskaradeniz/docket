// The ModelCatalog port over the registry and the route's own live-list adapter (P-29 section 3):
// one cached merged list per account and route — never per provider, because a plan-dependent
// list must not leak between two accounts of the same provider.
import type { AccountRepo, CapabilityCatalog, Clock, ModelCatalog, SecretVault } from '../../../application/index';
import type { CatalogModel, EpochMs, MergeOptions, RouteKindRecord } from '../../../domain/index';
import { catalogCacheKey, mergeCatalog } from '../../../domain/index';
import { createCapabilityCatalog, FAMILY_PATTERNS, findRouteKind } from '../registry';
import { listApiKeyRouteModels } from './api-key-catalog';
import { listClaudeRouteModels } from './claude-catalog';
import type { QueryFn } from '../transports/sdk/transport';

export interface ModelCatalogConfig {
  readonly accounts: Pick<AccountRepo, 'get'>;
  readonly secrets: Pick<SecretVault, 'get'>;
  readonly baseEnv: Readonly<Record<string, string>>; // the same allowlist the SDK transport builds from
  readonly clock: Clock;
  readonly capabilities?: Pick<CapabilityCatalog, 'routeKindOf'>; // default: the registry's own catalog
  readonly query?: QueryFn; // default: the SDK's query
  readonly fetch?: typeof globalThis.fetch; // the api-source adapter's transport; default: the global fetch
  readonly apiBaseUrl?: string; // base of the documented model-list endpoint; default: the provider's documented host
  readonly timeoutMs?: number; // the adapters' per-call ceiling
  readonly ttlMs?: number; // cache lifetime; the default is six hours
}

const DEFAULT_TTL_MS = 6 * 60 * 60 * 1000;

interface CacheEntry {
  readonly models: readonly CatalogModel[];
  readonly at: EpochMs;
}

/** A route kind's live list rides the SDK leg when the kind declares the SDK as its source, or
 * when it is a compatible endpoint: the endpoint answers the same supported-models call through
 * the shared route environment (the tier overrides the environment carries are exactly what the
 * list reflects). */
const listsThroughSdk = (kind: { readonly modelSource: string; readonly endpointHost?: string }): boolean =>
  kind.modelSource === 'sdk' || kind.endpointHost !== undefined;

/** A route kind's live list rides the documented-endpoint leg when the kind declares the
 * provider's model-list API as its source and the account pays per key — every model such a
 * route lists is metered (P-40), which is exactly why it needs its own live list. */
const listsThroughApi = (kind: { readonly modelSource: string; readonly authMode: string }): boolean =>
  kind.modelSource === 'api' && kind.authMode === 'api_key';

/** The merge knobs a route kind fixes: an authoritative live list, and the billing its live-only
 * rows take when they report none of their own. */
const mergeOptionsOf = (kind: RouteKindRecord): MergeOptions | undefined => {
  const options: MergeOptions = {
    ...(kind.liveIsAuthoritative === true ? { authoritative: true } : {}),
    ...(kind.defaultBilling !== undefined ? { defaultBilling: kind.defaultBilling } : {}),
  };
  return Object.keys(options).length === 0 ? undefined : options;
};

export function createModelCatalog(config: ModelCatalogConfig): ModelCatalog {
  const capabilities = config.capabilities ?? createCapabilityCatalog();
  const ttl = config.ttlMs ?? DEFAULT_TTL_MS;
  const cache = new Map<string, CacheEntry>();

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
      const cached = cache.get(key);
      if (cached !== undefined && options?.refresh !== true && config.clock.now() - cached.at < ttl) {
        return cached.models;
      }

      if (!listsThroughSdk(routeKind) && !listsThroughApi(routeKind)) {
        // No live fetch exists for this source yet: the registry is the answer, and a later
        // refresh of the same data changes nothing, so staleness never applies.
        const merged = mergeCatalog(undefined, routeKind.models, FAMILY_PATTERNS);
        cache.set(key, { models: merged, at: config.clock.now() });
        return merged;
      }

      // Both legs answer the same shape: the live rows of this account's route.
      const live = listsThroughSdk(routeKind)
        ? await listClaudeRouteModels(account, {
            secrets: config.secrets,
            baseEnv: config.baseEnv,
            capabilities,
            query: config.query,
            ...(config.timeoutMs === undefined ? {} : { timeoutMs: config.timeoutMs }),
          })
        : await listApiKeyRouteModels(account, {
            secrets: config.secrets,
            ...(config.fetch === undefined ? {} : { fetch: config.fetch }),
            ...(config.apiBaseUrl === undefined ? {} : { baseUrl: config.apiBaseUrl }),
            ...(config.timeoutMs === undefined ? {} : { timeoutMs: config.timeoutMs }),
          });
      if (live.ok) {
        const merged = mergeCatalog(
          live.value,
          routeKind.models,
          FAMILY_PATTERNS,
          cached?.models,
          mergeOptionsOf(routeKind),
        );
        cache.set(key, { models: merged, at: config.clock.now() });
        return merged;
      }
      // A failed refresh keeps the last good list marked stale. The kept entry keeps its original
      // timestamp, so the cache does not award the failed answer another TTL of silence — the next
      // call after expiry retries the live call.
      const kept = mergeCatalog(undefined, routeKind.models, FAMILY_PATTERNS, cached?.models);
      if (cached === undefined) cache.set(key, { models: kept, at: config.clock.now() });
      return kept;
    },
  };
}
