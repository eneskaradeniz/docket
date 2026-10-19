// The CapabilityCatalog over the registry data: the default mapping for accounts that name no
// route kind (A-44) and the route-kind surface saveAccount validates endpoints against (A-43).
// Vendor names live here and in the data file — nowhere else.
import type { CapabilityCatalog } from '../../../application/index';
import type { AuthMode, CostKind, RouteKindRecord } from '../../../domain/index';

import { BUILTIN_PROVIDER_DEFS, homeRootEnvOf } from '../defs/index';

import { CAPABILITY_REGISTRY, findRouteKind, MEASURED_VERSIONS, PERMISSION_CHANNELS, PROVIDER_INSTRUCTION_FILES, TRANSLATION_TABLE } from './capability-registry';

const steeringSupportOf = (providerId: string): boolean | 'unknown' => {
  const record = CAPABILITY_REGISTRY.providers.find((entry) => entry.providerId === providerId);
  if (record === undefined || record.steering === undefined) return 'unknown';
  return record.steering === 'steerable';
};

// Explicit ids, not a registry search: when later presets add more route kinds for the same
// provider, the default an account resolves to must not silently change with the data.
const DEFAULT_ROUTE_KINDS: Readonly<Record<string, Readonly<Partial<Record<AuthMode, string>>>>> = {
  'claude-code': { subscription: 'anthropic-subscription', api_key: 'anthropic-api' },
  codex: { subscription: 'codex-subscription' },
  copilot: { subscription: 'copilot-subscription' },
  agy: { subscription: 'agy-subscription' },
  cursor: { subscription: 'cursor-subscription' },
  opencode: { subscription: 'opencode-subscription' },
};

export const createCapabilityCatalog = (): CapabilityCatalog => ({
  routeKindOf: (account) => account.routeKind ?? DEFAULT_ROUTE_KINDS[account.provider]?.[account.authMode],
  routeKind: (id) => findRouteKind(id),
  translationTable: () => TRANSLATION_TABLE,
  permissionChannels: () => PERMISSION_CHANNELS,
  providerVersions: () => MEASURED_VERSIONS,
  mcpSupport: (providerId) => BUILTIN_PROVIDER_DEFS.find((def) => def.id === providerId)?.capabilities.mcp ?? 'unknown',
  steeringSupport: steeringSupportOf,
  // Registry order: the row's own order for a provider, first appearance for the union. A provider
  // without a row has no native set — every present candidate inlines (A-54).
  nativeInstructionFiles: (providerId) =>
    PROVIDER_INSTRUCTION_FILES.find((row) => row.providerId === providerId)?.instructionFiles ?? [],
  instructionFileNames: () => [
    ...new Set(PROVIDER_INSTRUCTION_FILES.flatMap((row) => row.instructionFiles)),
  ],
  // The home the launch would resolve for this account (P-67): a home-rooted CLI's whole tree —
  // descriptor cache included — sits under the identity directory; every other CLI under the
  // machine home. A non-absolute home resolves nothing, so the row never fires on it.
  mcpDefsDirOf: (account, machineHome) => {
    const def = BUILTIN_PROVIDER_DEFS.find((entry) => entry.id === account.provider);
    if (def === undefined || def.mcpDefsPath === undefined) return undefined;
    const home =
      homeRootEnvOf(def) !== undefined && account.identityDir !== undefined ? account.identityDir : machineHome;
    return home !== undefined && home.startsWith('/') ? `${home}/${def.mcpDefsPath}` : undefined;
  },
});

/** The registry route-level cost union admits `none` (no cost visibility); a usage event always
 *  carries a real kind, so a route kind without cost data falls back to the branch default. */
const eventCostKind = (kind: RouteKindRecord['costKind'] | undefined, fallback: CostKind): CostKind =>
  kind === undefined || kind === 'none' ? fallback : kind;

/** The cost kind an account's route stamps on its usage events (G4): the registry row's kind, or
 *  the auth-mode branch default when no route kind covers the account — the same fallbacks the SDK
 *  route environment applies, kept beside the default mapping they read. */
export const routeCostKindOf = (account: {
  readonly provider: string;
  readonly authMode: AuthMode;
  readonly routeKind?: string;
}): CostKind => {
  const routeKindId = account.routeKind ?? DEFAULT_ROUTE_KINDS[account.provider]?.[account.authMode];
  const routeKind = routeKindId === undefined ? undefined : findRouteKind(routeKindId);
  if (routeKind?.endpointHost !== undefined) return eventCostKind(routeKind.costKind, 'equivalent');
  if ((routeKind?.authMode ?? account.authMode) === 'api_key') {
    return eventCostKind(routeKind?.costKind, 'reported');
  }
  return eventCostKind(routeKind?.costKind, 'equivalent');
};
