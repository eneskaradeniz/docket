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

  it('P-28: the devin record is planned with no definition, because no documented switch the launch can pass stops its import of the user\'s Claude Code configuration', () => {
    expect(findProvider('devin')).toMatchObject({ planned: true });
    expect(BUILTIN_PROVIDER_DEFS.some((def) => def.id === 'devin')).toBe(false);
    const record = findProvider('devin');
    expect(record === undefined ? undefined : supportLevel(record)).toBe('planned');
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
      'atomcode-login',
      'codex-subscription',
      'copilot-subscription',
      'cursor-subscription',
      'grok-build-login',
      'hermes-subscription',
      'kilo-login',
      'kimi-login',
      'kiro-login',
      'mimo-login',
      'opencode-subscription',
      'qoder-login',
      'qwen-login',
      'reasonix-login',
      'vibe-login',
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

  it('P-40: the API-key route kind defaults its live models to metered — the other kinds fix no default', () => {
    // Everything on an API-key route is billed per use, so a live row that reports no billing of
    // its own must never read as unknown-free. A subscription rides a plan the SDK reports per
    // model, and a compatible endpoint's costs read as plan equivalents — neither fixes a default.
    expect(findRouteKind('anthropic-api')?.defaultBilling).toBe('metered');
    expect(findRouteKind('anthropic-subscription')?.defaultBilling).toBeUndefined();
    expect(findRouteKind('zai-glm')?.defaultBilling).toBeUndefined();
  });

  it('P-42: the Claude subscription kind lists exactly the opus, sonnet and haiku families as included — no other route kind does', () => {
    expect(findRouteKind('anthropic-subscription')?.familyBilling).toEqual([
      { contains: 'opus', billing: 'included' },
      { contains: 'sonnet', billing: 'included' },
      { contains: 'haiku', billing: 'included' },
    ]);
    expect(findRouteKind('anthropic-api')?.familyBilling).toBeUndefined();
    expect(findRouteKind('zai-glm')?.familyBilling).toBeUndefined();
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
  it('P-44: every built-in record but codex, kilo, hermes, atomcode, grok-build, reasonix, vibe, mimo, qwen, qoder, kiro, kimi, amp and devin carries isolation evidence, and all fourteen stay capped at or below experimental', () => {
    // codex and hermes keep their login in their own home, which is left alone, and kilo's switches
    // are unverified; none can evidence isolation, so their records carry none and the cap applies.
    const records: readonly ProviderRecord[] = CAPABILITY_REGISTRY.providers;
    for (const provider of records) {
      if (['codex', 'kilo', 'hermes', 'atomcode', 'grok-build', 'reasonix', 'vibe', 'mimo', 'qwen', 'qoder', 'kiro', 'kimi', 'amp', 'devin'].includes(provider.providerId)) {
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
      hermes: 'experimental',
      kilo: 'experimental',
      'grok-build': 'experimental',
      atomcode: 'experimental',
      reasonix: 'experimental',
      vibe: 'experimental',
      mimo: 'experimental',
      qwen: 'experimental',
      qoder: 'experimental',
      kiro: 'experimental',
      kimi: 'experimental',
      amp: 'experimental',
      devin: 'planned',
    });
  });

  it('P-28: the amp record waives G5 for the unverified usage output, claims no login, permission or scenario gate, and stays experimental', () => {
    const gates = findProvider('amp')?.gates;
    expect(gates?.G5).toMatchObject({
      kind: 'waived',
      reason: 'provider reports no machine-readable quota; the usage command\'s output is unverified and its adapter is a separate issue; a limit error maps to limit_hit',
    });
    // The account-list probe's logged-in output is unverified, so G1 stays missing; the CLI asks
    // no tool approval, so G3 cannot be met at the source; the end-to-end scenario test covers
    // sdk, app-server and acp, not stream-json.
    expect(gates?.G1).toBeUndefined();
    expect(gates?.G3).toBeUndefined();
    expect(gates?.G6).toBeUndefined();
    expect(findProvider('amp')?.isolation).toBeUndefined();
    expect(supportLevel(findProvider('amp') ?? { providerId: 'amp', gates: {} })).toBe('experimental');
  });

  it('P-29: the amp route kind lists the four modes as its whole static catalog, every one billing-unknown, with no live list and no quota probe', () => {
    // Widened to the record type: the literal registry union drops the optional keys a kind
    // simply does not carry, and the assertions below are exactly about their absence.
    const kind: RouteKindRecord | undefined = findRouteKind('amp-login');
    expect(kind).toMatchObject({
      providerId: 'amp',
      authMode: 'subscription',
      identity: 'machine_login',
      costKind: 'none',
      quotaProbe: 'none',
      modelSource: 'static',
    });
    // The modes are the models (architect decision): a mode is a fixed model-plus-effort bundle,
    // so no separate thinking level exists on a row and no live list can be authoritative.
    expect(kind?.liveIsAuthoritative).toBeUndefined();
    expect(kind?.models.map((model) => model.id)).toEqual(['low', 'medium', 'high', 'ultra']);
    for (const model of kind?.models ?? []) {
      expect(model.thinking).toEqual({ kind: 'none' });
      expect(model.billing, model.id).toBeUndefined();
      expect(model.family).toBe('tier');
    }
    expect(kind?.tierModels).toBeUndefined();
  });

  it('P-28: the hermes record waives G5 with a written reason and its route kind lists live models with unknown billing', () => {
    expect(findProvider('hermes')?.gates.G5).toMatchObject({ kind: 'waived' });
    expect((findProvider('hermes')?.gates.G5 as { reason: string }).reason.length).toBeGreaterThan(20);
    expect(findRouteKind('hermes-subscription')).toMatchObject({
      providerId: 'hermes',
      modelSource: 'acp-session',
      liveIsAuthoritative: true,
      defaultBilling: 'unknown',
      quotaProbe: 'none',
    });
  });

  it('P-28: the grok-build record waives G5 with a written reason and its route kind lists live models with unknown billing', () => {
    expect(findProvider('grok-build')?.gates.G5).toMatchObject({ kind: 'waived' });
    expect((findProvider('grok-build')?.gates.G5 as { reason: string }).reason).toContain('limit_hit');
    expect(findRouteKind('grok-build-login')).toMatchObject({
      providerId: 'grok-build',
      modelSource: 'acp-session',
      liveIsAuthoritative: true,
      defaultBilling: 'unknown',
      quotaProbe: 'none',
    });
  });

  it('P-28: the atomcode record waives G5 with a written reason and its route kind lists session models with unknown billing', () => {
    expect(findProvider('atomcode')?.gates.G5).toMatchObject({ kind: 'waived' });
    expect((findProvider('atomcode')?.gates.G5 as { reason: string }).reason.length).toBeGreaterThan(20);
    expect(findRouteKind('atomcode-login')).toMatchObject({
      providerId: 'atomcode',
      modelSource: 'acp-session',
      liveIsAuthoritative: true,
      defaultBilling: 'unknown',
      quotaProbe: 'none',
    });
  });

  it('P-28: the vibe record waives G5 with the limit_hit reason, claims no login or permission gate, and its route kind lists session models with unknown billing', () => {
    const gates = findProvider('vibe')?.gates;
    expect(gates?.G5).toMatchObject({ kind: 'waived', reason: 'provider reports no machine-readable quota; a limit error maps to limit_hit' });
    expect(gates?.G1).toBeUndefined();
    expect(gates?.G3).toBeUndefined();
    expect(findRouteKind('vibe-login')).toMatchObject({
      providerId: 'vibe',
      modelSource: 'acp-session',
      liveIsAuthoritative: true,
      defaultBilling: 'unknown',
      quotaProbe: 'none',
    });
  });

  it('P-40: the reasonix route kind defaults its live models to metered, so each run needs spend consent, and its record waives G5 with a written reason', () => {
    expect(findProvider('reasonix')?.gates.G5).toMatchObject({ kind: 'waived' });
    expect((findProvider('reasonix')?.gates.G5 as { reason: string }).reason).toContain('limit_hit');
    expect(findRouteKind('reasonix-login')).toMatchObject({
      providerId: 'reasonix',
      modelSource: 'acp-session',
      liveIsAuthoritative: true,
      defaultBilling: 'metered',
      quotaProbe: 'none',
      costKind: 'none',
    });
  });

  it('P-28: the mimo record waives G5 with the limit_hit reason, claims no permission gate, and its route kind lists session models with unknown billing', () => {
    const gates = findProvider('mimo')?.gates;
    expect(gates?.G5).toMatchObject({ kind: 'waived', reason: 'provider reports no machine-readable quota; a limit error maps to limit_hit' });
    expect(gates?.G3).toBeUndefined();
    expect(findRouteKind('mimo-login')).toMatchObject({
      providerId: 'mimo',
      modelSource: 'acp-session',
      liveIsAuthoritative: true,
      defaultBilling: 'unknown',
      quotaProbe: 'none',
    });
  });

  it('P-28: the qwen record waives G5 with the limit_hit reason, claims no permission gate, and its route kind lists the user\'s own configured models with unknown billing', () => {
    const gates = findProvider('qwen')?.gates;
    expect(gates?.G5).toMatchObject({
      kind: 'waived',
      reason: 'provider reports no quota; a limit error maps to limit_hit (failed fast, not retried)',
    });
    expect(gates?.G3).toBeUndefined();
    expect(findRouteKind('qwen-login')).toMatchObject({
      providerId: 'qwen',
      modelSource: 'acp-session',
      liveIsAuthoritative: true,
      defaultBilling: 'unknown',
      quotaProbe: 'none',
    });
  });

  it('P-28: the qoder record waives G5 with the limit_hit reason, claims no permission gate, and its route kind bundles the four documented tier aliases with unknown billing', () => {
    const gates = findProvider('qoder')?.gates;
    expect(gates?.G5).toMatchObject({
      kind: 'waived',
      reason: 'provider reports no machine-readable quota; a limit error maps to limit_hit',
    });
    expect(gates?.G3).toBeUndefined();
    expect(findRouteKind('qoder-login')).toMatchObject({
      providerId: 'qoder',
      authMode: 'subscription',
      identity: 'machine_login',
      modelSource: 'acp-session',
      liveIsAuthoritative: true,
      defaultBilling: 'unknown',
      costKind: 'none',
      quotaProbe: 'none',
    });
    // The bundled fallback is exactly the four tier aliases the documentation names, each with
    // billing unknown: which models a plan covers is not visible to a machine (P-40).
    expect(findRouteKind('qoder-login')?.models.map((model) => [model.id, model.billing ?? 'unknown'])).toEqual([
      ['auto', 'unknown'],
      ['ultimate', 'unknown'],
      ['performance', 'unknown'],
      ['efficient', 'unknown'],
    ]);
  });

  it('P-28: the kimi record waives G5 with the local-server reason, claims no permission gate, and its route kind lists the login-gated session models with unknown billing and no bundled fallback', () => {
    const gates = findProvider('kimi')?.gates;
    expect(gates?.G5).toMatchObject({
      kind: 'waived',
      reason: 'the provider\'s quota channel is only a local REST server; a limit error maps to limit_hit (failed fast, not retried)',
    });
    expect(gates?.G3).toBeUndefined();
    expect(findRouteKind('kimi-login')).toMatchObject({
      providerId: 'kimi',
      authMode: 'subscription',
      identity: 'machine_login',
      modelSource: 'acp-session',
      liveIsAuthoritative: true,
      defaultBilling: 'unknown',
      costKind: 'none',
      quotaProbe: 'none',
    });
    // No model id is verified without a login (a logged-out session is refused), so the route
    // bundles nothing: the live list is the only source, each row unknown (P-40) — a hand pick
    // with spend consent.
    expect(findRouteKind('kimi-login')?.models).toEqual([]);
  });

  it('P-28: the kiro record waives G5 with the limit_hit reason, claims no permission gate, and its route kind lists the login-gated CLI models with unknown billing', () => {
    const gates = findProvider('kiro')?.gates;
    expect(gates?.G5).toMatchObject({
      kind: 'waived',
      reason: 'provider reports no machine-readable quota; a limit error maps to limit_hit',
    });
    // The ask-first default is documented but the permission wait is unproven until an operator
    // run, and no usage mapping is proven either.
    expect(gates?.G3).toBeUndefined();
    expect(gates?.G4).toBeUndefined();
    expect(findRouteKind('kiro-login')).toMatchObject({
      providerId: 'kiro',
      authMode: 'subscription',
      identity: 'machine_login',
      modelSource: 'cli-command',
      liveIsAuthoritative: true,
      defaultBilling: 'unknown',
      quotaProbe: 'none',
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
