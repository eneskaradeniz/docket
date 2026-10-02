// The CapabilityCatalog over the registry data: the default mapping for accounts that name no
// route kind (A-44) and the route-kind surface saveAccount validates endpoints against (A-43).
// Vendor names live here and in the data file — nowhere else.
import type { CapabilityCatalog } from '../../../application/index';
import type { AuthMode } from '../../../domain/index';

import { findRouteKind } from './capability-registry';

// Explicit ids, not a registry search: when later presets add more route kinds for the same
// provider, the default an account resolves to must not silently change with the data.
const DEFAULT_ROUTE_KINDS: Readonly<Record<string, Readonly<Partial<Record<AuthMode, string>>>>> = {
  'claude-code': { subscription: 'anthropic-subscription', api_key: 'anthropic-api' },
  codex: { subscription: 'codex-subscription' },
  copilot: { subscription: 'copilot-subscription' },
  agy: { subscription: 'agy-subscription' },
  cursor: { subscription: 'cursor-subscription' },
  opencode: { subscription: 'opencode-subscription' },
  hermes: { subscription: 'hermes-subscription' },
  kilo: { subscription: 'kilo-login' },
  'grok-build': { subscription: 'grok-build-login' },
  atomcode: { subscription: 'atomcode-login' },
};

export const createCapabilityCatalog = (): CapabilityCatalog => ({
  routeKindOf: (account) => account.routeKind ?? DEFAULT_ROUTE_KINDS[account.provider]?.[account.authMode],
  routeKind: (id) => findRouteKind(id),
});
