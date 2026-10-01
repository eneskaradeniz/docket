// Route-kind lookups over the capability registry. The registry data is infrastructure, so the
// application sees only two questions: which route kind an account rides, and what that route kind
// fixes. Contract: docs/v2/application.md (A-43, A-44); data: src/infrastructure/providers/registry/.
import type { AuthMode } from '../../domain/index';

export interface CapabilityCatalog {
  /** The account's route kind: the explicit `routeKind`, else the provider's default for its authMode. */
  routeKindOf(account: { readonly provider: string; readonly authMode: AuthMode; readonly routeKind?: string }): string | undefined;
  /** The route kind's fixed surface; `undefined` when the registry knows no such kind. */
  routeKind(id: string): { readonly id: string; readonly authMode: AuthMode; readonly endpointHost?: string } | undefined;
}
