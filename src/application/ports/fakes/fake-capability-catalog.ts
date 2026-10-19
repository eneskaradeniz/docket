// In-memory CapabilityCatalog — the route kinds a test scripts. `provider` drives the default
// resolution (`routeKindOf` with no explicit kind), `endpointHost` the A-43 host check,
// `defaultBilling` the route's unpinned-run billing, `instructionFiles` the native set (P-37).
import type { AuthMode, Billing, ChannelRow, Tier, TranslationRow, VersionRow } from '../../../domain/index';

import type { CapabilityCatalog } from '../capability-catalog';

export interface FakeRouteKind {
  readonly id: string;
  readonly authMode: AuthMode;
  /** Names the provider whose accounts default to this kind when they carry no explicit `routeKind`. */
  readonly provider?: string;
  readonly endpointHost?: string;
  readonly defaultBilling?: Billing;
  readonly tierModels?: Readonly<Record<Tier, string>>;
  /** The instruction-file names this provider reads natively (P-37). */
  readonly instructionFiles?: readonly string[];
  /** The provider's `mcp` capability; absent reads as unknown. */
  readonly mcp?: boolean | 'unknown';
  /** Whether the provider's transport accepts a steering note; absent reads as unknown. */
  readonly steering?: boolean | 'unknown';
  readonly quotaProbe?:'sdk_usage' | 'rate_limit_events' | 'http_monitor' | 'provider_query' | 'none';
}

export const createFakeCapabilityCatalog = (
  routeKinds: readonly FakeRouteKind[] = [],
  translations: readonly TranslationRow[] = [],
  channels: readonly ChannelRow[] = [],
  versions: readonly VersionRow[] = [],
  mcpDefsDirs: Readonly<Record<string, string>> = {},
): CapabilityCatalog => ({
  translationTable: () => translations,
  permissionChannels: () => channels,
  providerVersions: () => versions,
  routeKindOf: (account) =>
    account.routeKind ??
    routeKinds.find((kind) => kind.provider === account.provider && kind.authMode === account.authMode)?.id,
  routeKind: (id) => {
    const kind = routeKinds.find((entry) => entry.id === id);
    return kind === undefined
      ? undefined
      : {
          id: kind.id,
          providerId: kind.provider ?? '',
          authMode: kind.authMode,
          ...(kind.endpointHost !== undefined ? { endpointHost: kind.endpointHost } : {}),
          ...(kind.defaultBilling !== undefined ? { defaultBilling: kind.defaultBilling } : {}),
          ...(kind.tierModels !== undefined ? { tierModels: kind.tierModels } : {}),
          ...(kind.quotaProbe !== undefined ? { quotaProbe: kind.quotaProbe } : {}),
        };
  },
  mcpSupport: (providerId) => routeKinds.find((kind) => kind.provider === providerId && kind.mcp !== undefined)?.mcp ?? 'unknown',
  steeringSupport: (providerId) =>
    routeKinds.find((kind) => kind.provider === providerId && kind.steering !== undefined)?.steering ?? 'unknown',
  // Registry order: the scripted kind order is the registry order, first appearance wins the union.
  nativeInstructionFiles: (providerId) =>
    routeKinds.filter((kind) => kind.provider === providerId).flatMap((kind) => kind.instructionFiles ?? []),
  instructionFileNames: () => [...new Set(routeKinds.flatMap((kind) => kind.instructionFiles ?? []))],
  // Scripted per provider as a home-relative path, resolved under the account's identity home
  // when it has one, else the machine home — the passthrough the executor test observes. The
  // home-rooted nuance is the real catalog's own rule, tested there.
  mcpDefsDirOf: (account, machineHome) => {
    const path = mcpDefsDirs[account.provider];
    if (path === undefined || machineHome === undefined) return undefined;
    return `${account.identityDir ?? machineHome}/${path}`;
  },
});
