// The route environment of an SDK run (I-34): one function the transport and the model catalog
// share, so a catalog call never sees a different environment than a run would — the SDK answers
// supported-models per account, and an ambient credential of another account would make the list
// wrong for this one.
import type {
  AccountRecord,
  CapabilityCatalog,
  SecretVault,
  TransportError,
} from '../../../../application/index';
import type { CostKind, Result, RouteKindRecord, Tier } from '../../../../domain/index';
import { err, ok } from '../../../../domain/index';
import { createCapabilityCatalog, findRouteKind } from '../../registry';

/** Route-owned variables never pass through from the allowlist: the account's route kind is their
 * only source, so an ambient value of another account can never steer the run. */
const ROUTE_ENV_KEYS: readonly string[] = [
  'ANTHROPIC_API_KEY',
  'ANTHROPIC_AUTH_TOKEN',
  'ANTHROPIC_BASE_URL',
  'ANTHROPIC_DEFAULT_OPUS_MODEL',
  'ANTHROPIC_DEFAULT_SONNET_MODEL',
  'ANTHROPIC_DEFAULT_HAIKU_MODEL',
];

/** Set on every run: a run must never edit the user's personal memory files. */
const AUTO_MEMORY_OFF = 'CLAUDE_CODE_DISABLE_AUTO_MEMORY';

/** The registry's tier aliases ride the variables the CLI reads for its Opus/Sonnet/Haiku slots. */
const TIER_ENV_VARS: readonly { readonly tier: Tier; readonly name: string }[] = [
  { tier: 'strong', name: 'ANTHROPIC_DEFAULT_OPUS_MODEL' },
  { tier: 'balanced', name: 'ANTHROPIC_DEFAULT_SONNET_MODEL' },
  { tier: 'fast', name: 'ANTHROPIC_DEFAULT_HAIKU_MODEL' },
];

/** The registry's route-level cost union admits 'none' (no cost visibility); a usage event always
 * carries a real kind, so a route kind without cost data falls back to the branch default. */
const eventCostKind = (kind: RouteKindRecord['costKind'] | undefined, fallback: CostKind): CostKind =>
  kind === undefined || kind === 'none' ? fallback : kind;

export interface RouteEnvConfig {
  readonly secrets: Pick<SecretVault, 'get'>;
  readonly baseEnv: Readonly<Record<string, string>>; // allowlisted environment from the composition root
  /** Route-kind resolution; default: the capability registry's own catalog. */
  readonly capabilities?: Pick<CapabilityCatalog, 'routeKindOf'>;
}

export interface RouteEnvironment {
  readonly env: Record<string, string>;
  readonly costKind: CostKind;
}

export async function buildRouteEnvironment(
  account: AccountRecord,
  config: RouteEnvConfig,
): Promise<Result<RouteEnvironment, TransportError>> {
  const catalog = config.capabilities ?? createCapabilityCatalog();

  // Environment: the allowlist minus the route-owned variables; the vault and the route kind
  // are their only sources. Auto memory is off on every run, whatever the allowlist carried.
  const env: Record<string, string> = {};
  for (const [name, value] of Object.entries(config.baseEnv)) {
    if (ROUTE_ENV_KEYS.includes(name)) continue;
    env[name] = value;
  }
  env[AUTO_MEMORY_OFF] = '1';

  // Route kind: which kind the account rides is resolved through the catalog port; the kind's
  // fixed surface (cost kind, tier aliases) is registry data. An account the catalog cannot
  // place — no explicit kind, provider without a default — keeps the I-28 auth-mode recipe:
  // such accounts exist only for provider definitions outside the registry's knowledge.
  const routeKindId = catalog.routeKindOf({
    provider: account.provider,
    authMode: account.authMode,
    routeKind: account.routeKind,
  });
  const routeKind: RouteKindRecord | undefined =
    routeKindId === undefined ? undefined : findRouteKind(routeKindId);
  if (routeKindId !== undefined && routeKind === undefined) {
    return err({ code: 'unsupported', message: `unknown route kind ${routeKindId} for account ${account.id}` });
  }

  let costKind: CostKind;
  if (routeKind?.endpointHost !== undefined) {
    // Compatible endpoint: the kind fixes the host and tier aliases; the account names the
    // exact URL and owns the token behind its secretRef. The endpoint is not a secret; the
    // token reaches only the child, never a record or an event.
    if (account.endpoint === undefined) {
      return err({
        code: 'unsupported',
        message: `account ${account.id} rides a compatible-endpoint route kind but names no endpoint`,
      });
    }
    const tokenRef = account.secretRef;
    const token = tokenRef === undefined ? undefined : await config.secrets.get(tokenRef);
    if (token === undefined) {
      return err({ code: 'not_logged_in', message: 'the account has no endpoint token in the vault' });
    }
    env.ANTHROPIC_BASE_URL = account.endpoint;
    env.ANTHROPIC_AUTH_TOKEN = token;
    const tierModels = { ...routeKind.tierModels, ...account.tierModels };
    for (const { tier, name } of TIER_ENV_VARS) {
      const model = tierModels[tier];
      if (model !== undefined) env[name] = model;
    }
    costKind = eventCostKind(routeKind.costKind, 'equivalent');
  } else if ((routeKind?.authMode ?? account.authMode) === 'api_key') {
    const secretRef = account.secretRef;
    const apiKey = secretRef === undefined ? undefined : await config.secrets.get(secretRef);
    if (apiKey === undefined) {
      return err({ code: 'not_logged_in', message: 'the account has no api key in the vault' });
    }
    env.ANTHROPIC_API_KEY = apiKey;
    costKind = eventCostKind(routeKind?.costKind, 'reported');
  } else if ((routeKind?.authMode ?? account.authMode) === 'subscription') {
    // The user's own config directory selects the login; Docket never writes into it and never
    // reads credential values from it — it only names the path to the child. The machine login
    // (no identityDir) reads the CLI's own directory, so the variable is left unset whatever the
    // allowlist carried: an ambient value would point the run at a stranger's config tree, and on
    // macOS the login is keyed to the directory's path, so any other directory means logged out.
    if (account.identityDir !== undefined) env.CLAUDE_CONFIG_DIR = account.identityDir;
    else delete env.CLAUDE_CONFIG_DIR;
    costKind = eventCostKind(routeKind?.costKind, 'equivalent');
  } else {
    return err({ code: 'unsupported', message: `auth mode ${account.authMode} is not supported by this transport` });
  }

  return ok({ env, costKind });
}
