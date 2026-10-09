// Registry validity (P-28): the data file stays honest. Waivers may exist only on G5, provider
// ids stay unique, route kinds name existing providers, and every built-in definition has a
// record. Gate evidence names real tests of this repository — cited by exact `it(...)` title;
// keeping that true is a review duty, so the validity check here is structural, not textual.
import { describe, expect, it } from 'vitest';

import { BUILTIN_PROVIDER_DEFS } from '../defs/index';
import type { CapabilityRegistry, Evidence, GateId, ProviderRecord, RouteKindRecord, Tier } from '../../../domain/index';
import { mergeCatalog, resolveTier, supportLevel } from '../../../domain/index';
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

describe('capability registry as data (P-27)', () => {
  it('P-27: the registry is plain data — it survives a JSON round trip unchanged and names providers and route kinds', () => {
    expect(JSON.parse(JSON.stringify(CAPABILITY_REGISTRY))).toEqual(CAPABILITY_REGISTRY);
    expect(CAPABILITY_REGISTRY.providers.length).toBeGreaterThan(0);
    expect(CAPABILITY_REGISTRY.routeKinds.length).toBeGreaterThan(0);
  });
});

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

  it('P-28: every built-in def id has a ProviderRecord, and a record without a def is planned', () => {
    const defIds = BUILTIN_PROVIDER_DEFS.map((def) => def.id).sort();
    const records: readonly ProviderRecord[] = CAPABILITY_REGISTRY.providers;
    const recordIds = records
      .filter((provider) => provider.planned !== true)
      .map((provider) => provider.providerId)
      .sort();
    expect(recordIds).toEqual(defIds);
    for (const provider of records) {
      if (!defIds.includes(provider.providerId)) expect(provider.planned, provider.providerId).toBe(true);
    }
  });

  it('P-47: the registry carries provider rows and route kinds for the launch set only', () => {
    // The registry is the single table of providers (P-27), so the launch set shows here first:
    // provider rows for exactly the six built-in ids, and every route kind naming one of them —
    // a removed provider leaves no row, no kind and no default behind.
    const launchSet = ['agy', 'claude-code', 'codex', 'copilot', 'cursor', 'opencode'];
    expect(CAPABILITY_REGISTRY.providers.map((provider) => provider.providerId).sort()).toEqual(launchSet);
    for (const kind of CAPABILITY_REGISTRY.routeKinds) {
      expect(launchSet, kind.id).toContain(kind.providerId);
    }
  });

  it('P-28: findProvider and findRouteKind resolve entries and stay undefined for the unknown', () => {
    expect(findProvider('claude-code')?.providerId).toBe('claude-code');
    expect(findProvider('no-such-provider')).toBeUndefined();
    expect(findRouteKind('anthropic-subscription')?.providerId).toBe('claude-code');
    expect(findRouteKind('no-such-route-kind')).toBeUndefined();
  });
});

describe('model catalog data (P-29)', () => {
  it('P-29: the Claude, compatible-endpoint, command-listed and session-listed kinds mark their live list authoritative', () => {
    // A plan-scoped list hides models the account cannot use: subscription directories answer per
    // plan, a compatible endpoint answers per env-overridden tiers, a CLI listing command answers
    // per login, and an ACP session answers per logged-in plan — so all of them must be able to
    // drop bundled entries the live list does not contain.
    const routeKinds: readonly RouteKindRecord[] = CAPABILITY_REGISTRY.routeKinds;
    const authoritative = routeKinds
      .filter((kind) => kind.liveIsAuthoritative === true)
      .map((kind) => kind.id)
      .sort();
    expect(authoritative).toEqual([
      'agy-subscription',
      'anthropic-api',
      'anthropic-subscription',
      'codex-subscription',
      'copilot-subscription',
      'cursor-subscription',
      'opencode-subscription',
      'zai-glm',
    ]);
  });

  it('P-29: the agy subscription kind lists its models from the CLI models command and leaves their billing unknown', () => {
    // The subscription login's models come from the CLI's own listing command, and the quota is
    // polled through the provider's own query (`/usage` in print mode). The plan documentation
    // covers the Gemini models on every plan but documents third-party model access as the top
    // plan's, so no single billing answer covers the listed set: every live row reads unknown —
    // hand-pick with consent — instead of a claim the documentation does not make.
    expect(findRouteKind('agy-subscription')).toMatchObject({
      providerId: 'agy',
      authMode: 'subscription',
      identity: 'machine_login',
      modelSource: 'cli-command',
      quotaProbe: 'provider_query',
      liveIsAuthoritative: true,
    });
    expect(findRouteKind('agy-subscription')?.defaultBilling).toBeUndefined();
  });

  it('P-29: the Copilot subscription kind lists its models from the session answer and meters its cost in credits', () => {
    // The login's model list is the plan-scoped ACP session answer, so it is authoritative; the
    // tiers name quality settings of the automatic choice, not model ids. The quota channel is
    // the provider SDK's quota call, which this repository does not depend on, so no probe
    // exists yet and the kind says so.
    expect(findRouteKind('copilot-subscription')).toMatchObject({
      providerId: 'copilot',
      authMode: 'subscription',
      identity: 'machine_login',
      costKind: 'credits',
      modelSource: 'acp-session',
      quotaProbe: 'none',
      liveIsAuthoritative: true,
      tierModels: { strong: 'intelligence', balanced: 'balance', fast: 'efficiency' },
    });
    expect(findRouteKind('copilot-subscription')?.models).toEqual([]);
    // No billing state is documented per model, so live rows stay unknown — never assumed free.
    expect(findRouteKind('copilot-subscription')?.defaultBilling).toBeUndefined();
  });

  it('P-29: the Copilot tiers resolve to the settings the session list exposes, and each names a listed entry', () => {
    // What the session adapter lists on a plan limited to the automatic choice: the route's
    // three settings, nothing else. Every tier must resolve into that list — a fixed tier
    // target the catalog does not carry would be a name a run cannot send.
    const kind = findRouteKind('copilot-subscription');
    expect(kind).toBeDefined();
    const merged = mergeCatalog(
      [{ id: 'intelligence' }, { id: 'balance' }, { id: 'efficiency' }],
      kind?.models ?? [],
      FAMILY_PATTERNS,
      undefined,
      { authoritative: true },
    );
    expect(merged.map((model) => model.id)).toEqual(['intelligence', 'balance', 'efficiency']);
    const tierModels = kind?.tierModels;
    expect(tierModels).toBeDefined();
    expect(resolveTier('strong', merged, tierModels)).toBe('intelligence');
    expect(resolveTier('balanced', merged, tierModels)).toBe('balance');
    expect(resolveTier('fast', merged, tierModels)).toBe('efficiency');
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

  it('P-40: the API-key route kind defaults its live models to metered — only the subscription kind fixes none', () => {
    // Everything on an API-key route is billed per use, so a live row that reports no billing of
    // its own must never read as unknown-free. A subscription rides a plan the SDK reports per
    // model, and a compatible endpoint's costs read as plan equivalents — neither fixes a default.
    expect(findRouteKind('anthropic-api')?.defaultBilling).toBe('metered');
    expect(findRouteKind('anthropic-subscription')?.defaultBilling).toBeUndefined();
    expect(findRouteKind('zai-glm')?.defaultBilling).toBe('included'); // P-52
  });

  it('P-42: the Claude subscription kind lists exactly the opus, sonnet and haiku families as included — the only other family list is the z.ai glm kind', () => {
    expect(findRouteKind('anthropic-subscription')?.familyBilling).toEqual([
      { contains: 'opus', billing: 'included' },
      { contains: 'sonnet', billing: 'included' },
      { contains: 'haiku', billing: 'included' },
    ]);
    expect(findRouteKind('anthropic-api')?.familyBilling).toBeUndefined();
    expect(findRouteKind('zai-glm')?.familyBilling).toEqual([{ contains: 'glm', billing: 'included' }]); // P-52
  });

  it('P-52: the z.ai route kind is included by default and lists exactly the glm family as included', () => {
    const kind = findRouteKind('zai-glm');
    expect(kind?.defaultBilling).toBe('included');
    expect(kind?.familyBilling).toEqual([{ contains: 'glm', billing: 'included' }]);
  });

  it('P-52: the z.ai tier models carry the CLI context tag, and every tier resolves to a tagged id', () => {
    // The endpoint serves its coding-plan models on the CLI's 1M-context route only: the `[1m]`
    // tag is the CLI's context-size spelling — stripped from the wire id, carried as the 1M beta
    // header — and the bare spelling the endpoint rejects comes back as the CLI's model-not-found
    // message. Both bundled spellings must stay tagged, or a tier run cannot do real work.
    const kind = findRouteKind('zai-glm');
    expect(kind?.tierModels).toEqual({
      strong: 'glm-5.3[1m]',
      balanced: 'glm-5.3-flash[1m]',
      fast: 'glm-5.3-flash[1m]',
    });
    const tierModels = kind?.tierModels;
    expect(resolveTier('strong', [], tierModels)).toBe('glm-5.3[1m]');
    expect(resolveTier('balanced', [], tierModels)).toBe('glm-5.3-flash[1m]');
    expect(resolveTier('fast', [], tierModels)).toBe('glm-5.3-flash[1m]');
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

describe('bundled model records (P-29, P-40)', () => {
  // `included` is a statement about a plan, so it can only ever sit on a subscription route
  // kind — every other kind bills per use or reads costs as equivalents.
  const includedOffSubscription = (registry: CapabilityRegistry): readonly string[] => {
    const violations: string[] = [];
    for (const kind of registry.routeKinds) {
      for (const model of kind.models) {
        if (model.billing === 'included' && kind.authMode !== 'subscription') {
          violations.push(`${kind.id} carries included model ${model.id}`);
        }
      }
    }
    return violations;
  };

  it('P-40: every included record sits on a subscription route kind', () => {
    expect(includedOffSubscription(CAPABILITY_REGISTRY)).toEqual([]);
  });

  it('P-40: an included record on a non-subscription kind is a violation', () => {
    const leaked = CAPABILITY_REGISTRY.routeKinds.map((kind) =>
      kind.id === 'anthropic-api'
        ? {
            ...kind,
            models: [
              ...kind.models,
              { id: 'claude-sonnet-5-5', family: 'sonnet', tier: 'balanced' as const, thinking: { kind: 'none' as const }, billing: 'included' as const },
            ],
          }
        : kind,
    );
    expect(includedOffSubscription({ ...CAPABILITY_REGISTRY, routeKinds: leaked })).not.toEqual([]);
  });

  it('P-40: a live list over the subscription registry merges a verified model as included and an unverified one as unknown', () => {
    const subscription = findRouteKind('anthropic-subscription');
    expect(subscription).toBeDefined();
    const merged = mergeCatalog(
      [
        { id: 'claude-sonnet-5-5', displayName: 'Sonnet 5.5' },
        { id: 'claude-fable-5-1', displayName: 'Fable 5.1' },
      ],
      subscription?.models ?? [],
      FAMILY_PATTERNS,
      undefined,
      { authoritative: true },
    );
    // A verified row takes the registry's tier, thinking and billing — no consent ask, no cap.
    const sonnet = merged.find((model) => model.id === 'claude-sonnet-5-5');
    expect(sonnet?.source).toBe('live');
    expect(sonnet?.tier).toBe('balanced');
    expect(sonnet?.thinking).toEqual({ kind: 'levels', levels: ['low', 'medium', 'high', 'xhigh', 'max'] });
    expect(sonnet?.billing).toBe('included');
    // A family the registry does not vouch for stays unknown even though the plan lists it, and
    // without a family pattern it never even gets an automatic tier.
    const fable = merged.find((model) => model.id === 'claude-fable-5-1');
    expect(fable?.billing).toBe('unknown');
    expect(fable?.tier).toBeUndefined();
    expect(fable?.autoClassified).toBeUndefined();
  });

  it('P-40: tier resolution picks the verified strong model and never an unverified one', () => {
    const subscription = findRouteKind('anthropic-subscription');
    const merged = mergeCatalog(
      // A higher-version strong id the registry does not vouch for must lose to the verified one.
      [
        { id: 'claude-opus-5-5' },
        { id: 'claude-sonnet-5-5' },
        { id: 'claude-haiku-4-5' },
        { id: 'claude-opus-6-0', efforts: ['low', 'high'] },
        { id: 'claude-fable-5-1' },
      ],
      subscription?.models ?? [],
      FAMILY_PATTERNS,
      undefined,
      { authoritative: true },
    );
    expect(resolveTier('strong', merged)).toBe('claude-opus-5-5');
    expect(resolveTier('balanced', merged)).toBe('claude-sonnet-5-5');
    expect(resolveTier('fast', merged)).toBe('claude-haiku-4-5');
  });

  it('P-40: with no live list yet the bundled included records still resolve every tier', () => {
    const subscription = findRouteKind('anthropic-subscription');
    const merged = mergeCatalog(undefined, subscription?.models ?? [], FAMILY_PATTERNS);
    expect(merged.length).toBeGreaterThan(0);
    expect(merged.every((model) => model.billing === 'included')).toBe(true);
    expect(resolveTier('strong', merged)).toBe('claude-opus-5-5');
    expect(resolveTier('balanced', merged)).toBe('claude-sonnet-5-5');
    expect(resolveTier('fast', merged)).toBe('claude-haiku-4-5');
  });
});

describe('isolation evidence (P-44)', () => {
  it('P-44: every built-in record but agy, copilot, cursor and codex carries isolation evidence, and the rest stay capped at experimental', () => {
    // codex keeps its login in its own home, which is left alone, and agy, copilot and cursor
    // document no home their login does not live in (copilot's COPILOT_HOME holds it); none can
    // evidence isolation, so their records carry none and the cap applies.
    const records: readonly ProviderRecord[] = CAPABILITY_REGISTRY.providers;
    for (const provider of records) {
      if (['agy', 'copilot', 'cursor', 'codex'].includes(provider.providerId)) {
        expect(provider.isolation, provider.providerId).toBeUndefined();
      } else {
        expect(provider.isolation, provider.providerId).toBeDefined();
      }
    }
    const levels = Object.fromEntries(CAPABILITY_REGISTRY.providers.map((p) => [p.providerId, supportLevel(p)]));
    expect(levels).toEqual({
      'claude-code': 'isolated',
      codex: 'experimental',
      agy: 'experimental',
      copilot: 'experimental',
      cursor: 'experimental',
      opencode: 'experimental',
    });
  });

  it('P-44: a provider whose record has no isolation evidence is capped at experimental', () => {
    const records: readonly ProviderRecord[] = CAPABILITY_REGISTRY.providers;
    for (const provider of records.filter((record) => record.planned !== true)) {
      const { isolation: _evidence, ...bare } = provider;
      expect(supportLevel(bare), provider.providerId).toBe('experimental');
    }
  });
});

describe('route-kind billing coverage (P-40)', () => {
  // An unpinned run reads the kind's `defaultBilling`; a kind that states none falls through to
  // the executor's implicit answer — `included` on a subscription, `metered` on an api key. The
  // included fall-through is true only for a flat plan, so the subscription kinds entitled to it
  // are named here with their reason, and every other kind must fix its own default or bill
  // every row it lists.
  const FLAT_SUBSCRIPTIONS: readonly { readonly id: string; readonly reason: string }[] = [
    {
      id: 'anthropic-subscription',
      reason: 'the bundled rows and families already carry the per-model answer; the CLI default is one of the plan\'s own models',
    },
    {
      id: 'codex-subscription',
      reason: 'the provider documents its agent as included across its plans, so the CLI default is plan-covered (the kind also states defaultBilling included)',
    },
    {
      id: 'copilot-subscription',
      reason: 'every listed row bills against the single membership in its own credit unit, and the unpinned default is the plan\'s automatic choice on that membership',
    },
    {
      id: 'agy-subscription',
      reason: 'the plan covers the provider\'s own models on every plan and the CLI default is one of them; third-party rows stay unknown on their own answer',
    },
    {
      id: 'cursor-subscription',
      reason: 'the session list is the plan\'s own surface and its default is the plan\'s automatic choice; per-model answers stay unknown on the rows themselves',
    },
    {
      id: 'opencode-subscription',
      reason: 'an unpinned run uses whatever the login\'s own plan serves by default — the plan\'s own default model — while rows answer unknown per model',
    },
  ];

  it('P-40: every route kind states a billing default or bills every listed row, and only the flat subscriptions ride the implicit included', () => {
    // Widened to the record type: the literal registry union drops the optional keys a kind
    // simply does not carry, and the checks below are exactly about their presence.
    const kinds: readonly RouteKindRecord[] = CAPABILITY_REGISTRY.routeKinds;
    const violations: string[] = [];
    for (const kind of kinds) {
      const unbilled = kind.models.filter((model) => model.billing === undefined).length;
      const flat = FLAT_SUBSCRIPTIONS.some((entry) => entry.id === kind.id);
      if (kind.defaultBilling === undefined && unbilled > 0 && !flat) {
        violations.push(`${kind.id} states no defaultBilling and leaves ${unbilled} of ${kind.models.length} listed rows unbilled`);
      }
      // A subscription kind with no default claims the implicit included for its unpinned runs;
      // only a flat plan may claim it. An api-key kind never falls through to included — its
      // implicit answer is metered — so the claim cannot even arise there.
      if (kind.defaultBilling === undefined && kind.authMode === 'subscription' && !flat) {
        violations.push(`${kind.id} is a subscription without a defaultBilling, so its unpinned runs read the implicit included without the flat-plan entitlement`);
      }
    }
    // A stale allow-list entry would keep vouching for a kind that no longer holds the reason.
    for (const entry of FLAT_SUBSCRIPTIONS) {
      const kind = findRouteKind(entry.id);
      if (kind === undefined) violations.push(`flat-subscription entry ${entry.id} names no registry kind`);
      else if (kind.authMode !== 'subscription') violations.push(`flat-subscription entry ${entry.id} is not a subscription kind`);
    }
    expect(violations).toEqual([]);
  });
});
