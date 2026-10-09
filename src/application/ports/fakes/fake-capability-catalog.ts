// In-memory CapabilityCatalog — the route kinds a test scripts. `provider` drives the default
// resolution (`routeKindOf` with no explicit kind), `endpointHost` the A-43 host check,
// `defaultBilling` the route's unpinned-run billing, `instructionFiles` the native set (P-37).
import type { AuthMode, Billing, Tier } from '../../../domain/index';

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
  readonly quotaProbe?: 'sdk_usage' | 'rate_limit_events' | 'http_monitor' | 'provider_query' | 'none';
}

export const createFakeCapabilityCatalog = (routeKinds: readonly FakeRouteKind[] = []): CapabilityCatalog => ({
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
  // Registry order: the scripted kind order is the registry order, first appearance wins the union.
  nativeInstructionFiles: (providerId) =>
    routeKinds.filter((kind) => kind.provider === providerId).flatMap((kind) => kind.instructionFiles ?? []),
  instructionFileNames: () => [...new Set(routeKinds.flatMap((kind) => kind.instructionFiles ?? []))],
});
