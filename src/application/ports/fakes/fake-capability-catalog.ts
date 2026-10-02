// In-memory CapabilityCatalog — the route kinds a test scripts. `provider` drives the default
// resolution (`routeKindOf` with no explicit kind), `endpointHost` the A-43 host check,
// `defaultBilling` the route's unpinned-run billing.
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
        };
  },
});
