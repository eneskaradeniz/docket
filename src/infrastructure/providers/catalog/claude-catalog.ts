// The Claude route live model list (P-29 section 3): one SDK query on the account's shared route
// environment whose input never yields a user message, so no model turn ever starts and no quota
// is spent — the query exists only to ask supportedModels(). The answer is per account and per
// environment, which is why the environment comes from the same build a run uses (route-env).
import { query as sdkQuery } from '@anthropic-ai/claude-agent-sdk';
import type { ModelInfo, Query, SDKUserMessage } from '@anthropic-ai/claude-agent-sdk';

import type { AccountRecord, CapabilityCatalog, SecretVault } from '../../../application/index';
import type { EffortLevel, LiveModel, Result } from '../../../domain/index';
import { err, ok } from '../../../domain/index';
import { buildRouteEnvironment } from '../transports/sdk/route-env';
import type { QueryFn } from '../transports/sdk/transport';
import type { CatalogError } from './model-catalog';

export interface ClaudeCatalogConfig {
  readonly secrets: Pick<SecretVault, 'get'>;
  readonly baseEnv: Readonly<Record<string, string>>; // the same allowlist the SDK transport builds from
  readonly query?: QueryFn; // default: the SDK's query
  readonly capabilities?: Pick<CapabilityCatalog, 'routeKindOf'>;
  /** Ceiling for the whole call; the default leaves a slow CLI an order of magnitude more than a
   * control round-trip needs. */
  readonly timeoutMs?: number;
}

const DEFAULT_TIMEOUT_MS = 15_000;

/** The SDK's value for the row a run uses when no model is pinned. */
const DEFAULT_ROW_VALUE = 'default';

/** The effort vocabulary a live row may advertise; anything else a server lists is not a level
 * Docket knows and is dropped rather than passed through. */
export const KNOWN_EFFORT_LEVELS: readonly EffortLevel[] = [
  'none',
  'minimal',
  'low',
  'medium',
  'high',
  'xhigh',
  'max',
  'ultra',
];

/** The input side of the listing query: an ended stream. The SDK never sees a user message, so no
 * model turn starts; the session lives only for the control request. */
async function* silentInput(): AsyncGenerator<SDKUserMessage, void> {
  // Yields nothing by design — an empty stream is the whole contract.
}

const knownEfforts = (levels: readonly string[] | undefined): readonly EffortLevel[] | undefined => {
  const kept = (levels ?? []).filter((level): level is EffortLevel =>
    (KNOWN_EFFORT_LEVELS as readonly string[]).includes(level),
  );
  return kept.length === 0 ? undefined : kept;
};

/** One row of the SDK answer to one live model: `value` is the id a run would send, kept verbatim
 * (a `[1m]` suffix is part of it, an alias stays an alias), `resolvedModel` is the canonical id an
 * alias stands for, and efforts exist only when the row supports effort at all. */
const toLiveModel = (row: ModelInfo): LiveModel => {
  const efforts = row.supportsEffort === false ? undefined : knownEfforts(row.supportedEffortLevels);
  const resolved = row.resolvedModel;
  return {
    id: row.value,
    ...(typeof resolved === 'string' && resolved !== '' ? { resolvedId: resolved } : {}),
    ...(row.value === DEFAULT_ROW_VALUE ? { isDefault: true as const } : {}),
    ...(row.displayName === undefined ? {} : { displayName: row.displayName }),
    ...(efforts === undefined ? {} : { efforts }),
  };
};

export async function listClaudeRouteModels(
  account: AccountRecord,
  config: ClaudeCatalogConfig,
): Promise<Result<readonly LiveModel[], CatalogError>> {
  const route = await buildRouteEnvironment(account, config);
  if (!route.ok) return err(route.error);

  const runQuery = config.query ?? sdkQuery;
  const controller = new AbortController();
  const timer: ReturnType<typeof setTimeout> = setTimeout(() => controller.abort(), config.timeoutMs ?? DEFAULT_TIMEOUT_MS);
  let session: Query | undefined;
  try {
    const started = runQuery({
      prompt: silentInput(),
      options: {
        settingSources: [], // the user's own settings files are never read or written
        persistSession: false, // a listing is ephemeral: nothing lands in any session store
        env: route.value.env,
        abortController: controller,
      },
    });
    session = started;
    const answer = await new Promise<readonly ModelInfo[]>((resolve, reject) => {
      controller.signal.addEventListener('abort', () => reject(new Error('timed out')), { once: true });
      void started.supportedModels().then(resolve, reject);
    });
    return ok(answer.map(toLiveModel));
  } catch {
    return err(
      controller.signal.aborted
        ? { code: 'timeout', message: 'the supported-models call did not answer in time' }
        : { code: 'spawn_failed', message: 'the supported-models call failed' },
    );
  } finally {
    clearTimeout(timer);
    session?.close();
  }
}
