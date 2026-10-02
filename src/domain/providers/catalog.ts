// The model catalog: merging a route's live model list with the bundled registry, resolving a
// tier to a concrete model, and mapping the user's Fast/Balanced/Deep to a provider effort level.
// Contract: docs/v2/provider-capabilities.md sections 3–4 and 14. The registry data and the
// family-id patterns are infrastructure — provider and family names may not appear in the domain —
// so every function here takes them as a parameter.
import type { Billing, EffortLevel, ModelRecord, Thinking, Tier } from './capability';

/** A model as a live route reported it; `efforts` is the list the route itself advertises. */
export interface LiveModel {
  readonly id: string;
  readonly displayName?: string;
  readonly efforts?: readonly EffortLevel[];
  /** The billing state the route itself reported; it wins over the registry's when present. */
  readonly billing?: Billing;
  /** The canonical id an alias row stands for, as the provider reports it. */
  readonly resolvedId?: string;
  /** The row the provider uses when no model is pinned. */
  readonly isDefault?: true;
}

/** One merged catalog entry: registry capabilities where known, unknown-but-selectable otherwise. */
export interface CatalogModel {
  readonly id: string;
  readonly displayName?: string;
  readonly source: 'live' | 'bundled';
  readonly tier?: Tier;
  readonly thinking: Thinking | 'unknown';
  /** Always explicit on a merged entry — `unknown` when neither the live row nor the registry knows. */
  readonly billing: Billing;
  /** Set when the tier came from a family-id pattern, not from the registry. */
  readonly autoClassified?: true;
  /** Set on every entry when a refresh failed and the last good list is being kept. */
  readonly stale?: true;
  /** The row the provider uses when no model is pinned. */
  readonly isDefault?: true;
}

/** Family recognition as data: an id containing `contains` belongs to `tier`. */
export interface FamilyPattern {
  readonly contains: string;
  readonly tier: Tier;
}

const bundledEntry = (record: ModelRecord): CatalogModel => ({
  id: record.id,
  source: 'bundled',
  tier: record.tier,
  thinking: record.thinking,
  billing: record.billing ?? 'unknown',
});

/** The id a registry record is compared by: one trailing bracketed variant (`[1m]`) and one
 * trailing `-YYYYMMDD` date are dropped, so an alias target, a variant and a dated snapshot all
 * meet the record that names the undated model. Case is kept. */
export function canonicalModelId(id: string): string {
  return id.replace(/\[[^\]]*\]$/, '').replace(/-\d{8}$/, '');
}

/** A route kind's billing for a whole model family: an id containing `contains` bills as `billing`. */
export interface FamilyBilling {
  readonly contains: string;
  readonly billing: Billing;
}

interface LiveContext {
  readonly familyPatterns: readonly FamilyPattern[];
  readonly familyBilling: readonly FamilyBilling[];
  readonly defaultBilling: Billing | undefined;
}

const liveEntry = (model: LiveModel, record: ModelRecord | undefined, context: LiveContext): CatalogModel => {
  const reported = model.resolvedId ?? model.id;
  const marker = model.isDefault === true ? { isDefault: true as const } : {};
  if (record !== undefined) {
    return {
      id: model.id,
      displayName: model.displayName,
      source: 'live',
      tier: record.tier,
      thinking: record.thinking,
      billing: model.billing ?? record.billing ?? 'unknown',
      ...marker,
    };
  }
  const thinking: Thinking | 'unknown' =
    model.efforts === undefined ? 'unknown' : { kind: 'levels', levels: model.efforts };
  // The route kind's family and default answers come only when the row itself is silent; the
  // registry's own answer (the matched-record branch above) is never overridden by them.
  const family = context.familyBilling.find((candidate) => reported.includes(candidate.contains));
  const billing: Billing = model.billing ?? family?.billing ?? context.defaultBilling ?? 'unknown';
  const pattern = context.familyPatterns.find((candidate) => reported.includes(candidate.contains));
  return pattern === undefined
    ? { id: model.id, displayName: model.displayName, source: 'live', thinking, billing, ...marker }
    : {
        id: model.id,
        displayName: model.displayName,
        source: 'live',
        tier: pattern.tier,
        thinking,
        autoClassified: true,
        billing,
        ...marker,
      };
};

/** Merge knobs: `authoritative` marks the live list plan-scoped — bundled models it does not
 * contain are hidden, not kept. `defaultBilling` fills live-only rows that report no billing
 * (P-40) with the route kind's verified answer; `familyBilling` does the same per model family and
 * answers first. A failed refresh never drops anything, flag or not. */
export interface MergeOptions {
  readonly authoritative?: true;
  readonly defaultBilling?: Billing;
  readonly familyBilling?: readonly FamilyBilling[];
}

export function mergeCatalog(
  live: readonly LiveModel[] | undefined,
  bundled: readonly ModelRecord[],
  familyPatterns: readonly FamilyPattern[],
  previous?: readonly CatalogModel[],
  options?: MergeOptions,
): readonly CatalogModel[] {
  // A failed refresh keeps the last good list, marked stale; with nothing to keep, the non-retired
  // registry is the fallback.
  if (live === undefined) {
    if (previous !== undefined) return previous.map((model): CatalogModel => ({ ...model, stale: true }));
    return bundled.filter((record) => record.retired !== true).map(bundledEntry);
  }
  const bundledByCanonical = new Map<string, ModelRecord>();
  for (const record of bundled) {
    const key = canonicalModelId(record.id);
    if (!bundledByCanonical.has(key)) bundledByCanonical.set(key, record);
  }
  const context: LiveContext = {
    familyPatterns,
    familyBilling: options?.familyBilling ?? [],
    defaultBilling: options?.defaultBilling,
  };
  const confirmed = new Set<string>();
  const liveEntries = live.map((model) => {
    const key = canonicalModelId(model.resolvedId ?? model.id);
    const record = bundledByCanonical.get(key);
    if (record !== undefined) confirmed.add(record.id);
    return liveEntry(model, record, context);
  });
  // Registry models the live list did not confirm stay selectable; retired ones drop out unless
  // live still offers them. An authoritative list is plan-scoped: what it does not contain the
  // account cannot use, so the unconfirmed bundled models drop out too.
  if (options?.authoritative === true) return liveEntries;
  const unconfirmed = bundled.filter((record) => !confirmed.has(record.id) && record.retired !== true).map(bundledEntry);
  return [...liveEntries, ...unconfirmed];
}

const numericSegments = (id: string): readonly number[] => (id.match(/\d+/g) ?? []).map(Number);

// Left-to-right numeric comparison (`5-1` beats `4-9` and `5-10` beats `5-1`); a longer tail wins a
// prefix tie, and a full tie keeps the first listed model so the result stays deterministic.
const isHigherVersion = (candidate: readonly number[], best: readonly number[]): boolean => {
  const shared = Math.min(candidate.length, best.length);
  for (let i = 0; i < shared; i += 1) {
    if (candidate[i] !== best[i]) return candidate[i] > best[i];
  }
  return candidate.length > best.length;
};

// The automatic pick must never select a model that may spend real money without consent — only a
// verified-included model qualifies; `unknown` is never assumed to be free.
export function autoSelectable(model: CatalogModel): boolean {
  return model.billing === 'included';
}

export function resolveTier(
  tier: Tier,
  catalog: readonly CatalogModel[],
  tierModels?: Readonly<Record<Tier, string>>,
): string | undefined {
  const fixed = tierModels?.[tier];
  if (fixed !== undefined && fixed !== '') return fixed;
  let best: { id: string; version: readonly number[] } | undefined;
  for (const model of catalog) {
    if (model.tier !== tier) continue;
    // An explicit tierModels entry above is the user's own configuration and may name any model;
    // this scan may not.
    if (!autoSelectable(model)) continue;
    const version = numericSegments(model.id);
    if (best === undefined || isHigherVersion(version, best.version)) best = { id: model.id, version };
  }
  return best?.id;
}

const EFFORT_ORDER: readonly EffortLevel[] = ['none', 'minimal', 'low', 'medium', 'high', 'xhigh', 'max', 'ultra'];
// `none` is the provider's thinking-off setting, not a user choice; `max` and `ultra` are reachable
// from advanced settings only, so the three user levels never return them.
const USER_REACHABLE: readonly EffortLevel[] = ['minimal', 'low', 'medium', 'high', 'xhigh'];

const rank = (level: EffortLevel): number => EFFORT_ORDER.indexOf(level);

export function thinkingFor(
  level: 'fast' | 'balanced' | 'deep',
  thinking: Thinking | 'unknown',
): EffortLevel | undefined {
  if (thinking === 'unknown' || thinking.kind === 'none') return undefined;
  const reachable = thinking.levels
    .filter((candidate) => USER_REACHABLE.includes(candidate))
    .sort((a, b) => rank(a) - rank(b));
  if (reachable.length === 0) return undefined;
  if (level === 'fast') return reachable[0];
  if (level === 'deep') return reachable[reachable.length - 1];
  const medium = reachable.indexOf('medium');
  if (medium !== -1) return 'medium';
  const belowMedium = reachable.filter((candidate) => rank(candidate) < rank('medium'));
  return belowMedium.length > 0 ? belowMedium[belowMedium.length - 1] : reachable[0];
}

export function catalogCacheKey(accountId: string, routeKind: string): string {
  // Keyed by account and route, never by provider alone: a plan-dependent list must not leak
  // between two accounts of the same provider.
  return `catalog:${accountId}:${routeKind}`;
}
