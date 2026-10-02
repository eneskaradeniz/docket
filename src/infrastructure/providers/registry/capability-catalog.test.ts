// The CapabilityCatalog port over the registry data (A-43/A-44): the default mapping for accounts
// that name no route kind, and the fixed surface saveAccount validates endpoints against.
import { describe, expect, it } from 'vitest';

import { createCapabilityCatalog } from './capability-catalog';
import { findRouteKind } from './capability-registry';

describe('createCapabilityCatalog', () => {
  it('A-44: an absent routeKind resolves to the provider defaults for the authMode', () => {
    const catalog = createCapabilityCatalog();

    expect(catalog.routeKindOf({ provider: 'claude-code', authMode: 'subscription' })).toBe('anthropic-subscription');
    expect(catalog.routeKindOf({ provider: 'claude-code', authMode: 'api_key' })).toBe('anthropic-api');
    expect(catalog.routeKindOf({ provider: 'codex', authMode: 'subscription' })).toBe('codex-subscription');
    expect(catalog.routeKindOf({ provider: 'copilot', authMode: 'subscription' })).toBe('copilot-subscription');
    expect(catalog.routeKindOf({ provider: 'cursor', authMode: 'subscription' })).toBe('cursor-subscription');
    expect(catalog.routeKindOf({ provider: 'opencode', authMode: 'subscription' })).toBe('opencode-subscription');
    expect(catalog.routeKindOf({ provider: 'hermes', authMode: 'subscription' })).toBe('hermes-subscription');
  });

  it('A-44: an explicit routeKind wins over the default; an unknown provider resolves no kind', () => {
    const catalog = createCapabilityCatalog();

    expect(catalog.routeKindOf({ provider: 'claude-code', authMode: 'subscription', routeKind: 'compatible' })).toBe('compatible');
    expect(catalog.routeKindOf({ provider: 'codex', authMode: 'api_key' })).toBeUndefined();
  });

  it('A-44: every default names a route kind the registry knows', () => {
    const catalog = createCapabilityCatalog();

    for (const authMode of ['subscription', 'api_key'] as const) {
      const id = catalog.routeKindOf({ provider: 'claude-code', authMode });
      expect(id).toBeDefined();
      expect(findRouteKind(id ?? '')).toBeDefined();
    }
  });

  it('routeKind returns the registry surface; an unknown id resolves to undefined', () => {
    const catalog = createCapabilityCatalog();

    expect(catalog.routeKind('anthropic-subscription')).toMatchObject({ id: 'anthropic-subscription', authMode: 'subscription' });
    expect(catalog.routeKind('anthropic-subscription')?.endpointHost).toBeUndefined();
    expect(catalog.routeKind('anthropic-api')).toMatchObject({ id: 'anthropic-api', authMode: 'api_key' });
    expect(catalog.routeKind('no-such-route-kind')).toBeUndefined();
  });
});
