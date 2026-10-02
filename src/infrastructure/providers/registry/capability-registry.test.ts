// Registry validity (P-28): the data file stays honest. Waivers may exist only on G5, provider
// ids stay unique, route kinds name existing providers, and every built-in definition has a
// record. Gate evidence names real tests of this repository — cited by exact `it(...)` title;
// keeping that true is a review duty, so the validity check here is structural, not textual.
import { describe, expect, it } from 'vitest';

import { BUILTIN_PROVIDER_DEFS } from '../defs/index';
import type { CapabilityRegistry, Evidence, GateId, ProviderRecord, Tier } from '../../../domain/index';
import { CAPABILITY_REGISTRY, FAMILY_PATTERNS, findProvider, findRouteKind } from './capability-registry';

const ALL_GATES: readonly GateId[] = ['G1', 'G2', 'G3', 'G4', 'G5', 'G6'];

const violationsOf = (registry: CapabilityRegistry): readonly string[] => {
  const found: string[] = [];
  const known = new Set<string>();
  for (const provider of registry.providers) {
    if (known.has(provider.providerId)) found.push(`duplicate provider id ${provider.providerId}`);
    known.add(provider.providerId);
    for (const gate of ALL_GATES) {
      const evidence: Evidence | undefined = provider.gates[gate];
      if (evidence?.kind === 'waived' && gate !== 'G5') {
        found.push(`${provider.providerId} waives ${gate} — waiver is valid on G5 only`);
      }
    }
  }
  for (const routeKind of registry.routeKinds) {
    if (!known.has(routeKind.providerId)) {
      found.push(`route kind ${routeKind.id} names unknown provider ${routeKind.providerId}`);
    }
  }
  return found;
};

describe('capability registry validity (P-28)', () => {
  it('P-28: the registry is valid — waivers only on G5, provider ids unique, route kinds name known providers', () => {
    expect(violationsOf(CAPABILITY_REGISTRY)).toEqual([]);
  });

  it('P-28: a waiver outside G5 is rejected', () => {
    const providers: readonly ProviderRecord[] = CAPABILITY_REGISTRY.providers.map((provider, index) =>
      index === 0
        ? { ...provider, gates: { ...provider.gates, G2: { kind: 'waived', reason: 'fixture waiver' } } }
        : provider,
    );
    expect(violationsOf({ ...CAPABILITY_REGISTRY, providers })).not.toEqual([]);
  });

  it('P-28: every built-in def id has a ProviderRecord', () => {
    const defIds = BUILTIN_PROVIDER_DEFS.map((def) => def.id).sort();
    const recordIds = CAPABILITY_REGISTRY.providers.map((provider) => provider.providerId).sort();
    expect(recordIds).toEqual(defIds);
  });

  it('P-28: findProvider and findRouteKind resolve entries and stay undefined for the unknown', () => {
    expect(findProvider('claude-code')?.providerId).toBe('claude-code');
    expect(findProvider('no-such-provider')).toBeUndefined();
    expect(findRouteKind('anthropic-subscription')?.providerId).toBe('claude-code');
    expect(findRouteKind('no-such-route-kind')).toBeUndefined();
  });
});

describe('model catalog data (P-29)', () => {
  it('P-29: the two Claude route kinds and the compatible-endpoint kind mark their live list authoritative', () => {
    // A plan-scoped list hides models the account cannot use: subscription directories answer per
    // plan, and a compatible endpoint answers per env-overridden tiers, so both must be able to
    // drop bundled entries the live list does not contain.
    const authoritative = CAPABILITY_REGISTRY.routeKinds
      .filter((kind) => kind.liveIsAuthoritative === true)
      .map((kind) => kind.id)
      .sort();
    expect(authoritative).toEqual(['anthropic-api', 'anthropic-subscription', 'codex-subscription', 'zai-glm']);
  });

  it('P-29: the Codex subscription kind lists its models from the app-server and reads its quota through a provider query', () => {
    // The subscription login's models come from the CLI's own app-server control surface, and the
    // same surface answers the rate-limit poll — a provider query, not an SDK usage call.
    expect(findRouteKind('codex-subscription')).toMatchObject({
      providerId: 'codex',
      authMode: 'subscription',
      identity: 'machine_login',
      modelSource: 'app-server',
      quotaProbe: 'provider_query',
      liveIsAuthoritative: true,
    });
  });

  it('P-40: the API-key route kind defaults its live models to metered — the other kinds fix no default', () => {
    // Everything on an API-key route is billed per use, so a live row that reports no billing of
    // its own must never read as unknown-free. A subscription rides a plan the SDK reports per
    // model, and a compatible endpoint's costs read as plan equivalents — neither fixes a default.
    expect(findRouteKind('anthropic-api')?.defaultBilling).toBe('metered');
    expect(findRouteKind('anthropic-subscription')?.defaultBilling).toBeUndefined();
    expect(findRouteKind('zai-glm')?.defaultBilling).toBeUndefined();
  });

  it('P-40: the Codex subscription kind defaults its live models to included — the plan coverage is documented', () => {
    // The provider documents that Codex is included across ChatGPT plans, usage limits varying
    // by plan, so a listed model the row itself says nothing about reads as covered by the plan.
    expect(findRouteKind('codex-subscription')?.defaultBilling).toBe('included');
  });

  it('P-29: family patterns classify exactly the three tiers and name no further family', () => {
    expect(FAMILY_PATTERNS).toEqual([
      { contains: 'opus', tier: 'strong' },
      { contains: 'sonnet', tier: 'balanced' },
      { contains: 'haiku', tier: 'fast' },
    ]);
    const tiers: readonly Tier[] = FAMILY_PATTERNS.map((pattern) => pattern.tier);
    expect(new Set(tiers).size).toBe(FAMILY_PATTERNS.length);
  });
});
