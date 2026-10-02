// Model catalog (P-29) and the user-level → effort-level mapping (P-30). Family names arrive as
// pattern data — the domain itself never names a model family — so these tests pass their own
// patterns and the registry-side data is validated in infrastructure.
import { describe, expect, it } from 'vitest';

import { autoSelectable, catalogCacheKey, mergeCatalog, resolveTier, thinkingFor } from './catalog';
import type { CatalogModel, FamilyPattern, LiveModel } from './catalog';
import type { Billing, ModelRecord } from './capability';

const FAMILY_PATTERNS: readonly FamilyPattern[] = [
  { contains: 'opus', tier: 'strong' },
  { contains: 'sonnet', tier: 'balanced' },
  { contains: 'haiku', tier: 'fast' },
];

const OPUS_4_9: ModelRecord = {
  id: 'claude-opus-4-9',
  family: 'opus',
  tier: 'strong',
  thinking: { kind: 'levels', levels: ['low', 'high'] },
};
const SONNET_5_1: ModelRecord = {
  id: 'claude-sonnet-5-1',
  family: 'sonnet',
  tier: 'balanced',
  thinking: { kind: 'levels', levels: ['none', 'low', 'medium', 'high'] },
};
const HAIKU_4_5: ModelRecord = {
  id: 'claude-haiku-4-5',
  family: 'haiku',
  tier: 'fast',
  thinking: { kind: 'none' },
};
const OPUS_4_1_RETIRED: ModelRecord = {
  id: 'claude-opus-4-1',
  family: 'opus',
  tier: 'strong',
  thinking: { kind: 'levels', levels: ['low'] },
  retired: true,
};

describe('mergeCatalog (P-29)', () => {
  it('P-29: a live id present in bundled takes the bundled capabilities with source live', () => {
    const merged = mergeCatalog(
      [{ id: 'claude-sonnet-5-1', displayName: 'Sonnet 5.1' }],
      [SONNET_5_1, HAIKU_4_5],
      FAMILY_PATTERNS,
    );
    expect(merged).toEqual([
      {
        id: 'claude-sonnet-5-1',
        displayName: 'Sonnet 5.1',
        source: 'live',
        tier: 'balanced',
        thinking: { kind: 'levels', levels: ['none', 'low', 'medium', 'high'] },
        billing: 'unknown',
      },
      { id: 'claude-haiku-4-5', source: 'bundled', tier: 'fast', thinking: { kind: 'none' }, billing: 'unknown' },
    ]);
  });

  it('P-29: a live id absent from bundled is kept — its efforts become levels and the family pattern classifies its tier', () => {
    const merged = mergeCatalog([{ id: 'claude-opus-4-6', efforts: ['low', 'high'] }], [SONNET_5_1], FAMILY_PATTERNS);
    expect(merged).toEqual([
      {
        id: 'claude-opus-4-6',
        source: 'live',
        tier: 'strong',
        thinking: { kind: 'levels', levels: ['low', 'high'] },
        autoClassified: true,
        billing: 'unknown',
      },
      { id: 'claude-sonnet-5-1', source: 'bundled', tier: 'balanced', thinking: SONNET_5_1.thinking, billing: 'unknown' },
    ]);
  });

  it('P-29: an unknown model with no efforts has thinking unknown; an unmatched family gets no tier and no label', () => {
    const merged = mergeCatalog(
      [{ id: 'grok-4-fast' }, { id: 'grok-4-deep', efforts: ['low', 'high'] }],
      [],
      FAMILY_PATTERNS,
    );
    expect(merged).toEqual([
      { id: 'grok-4-fast', source: 'live', thinking: 'unknown', billing: 'unknown' },
      { id: 'grok-4-deep', source: 'live', thinking: { kind: 'levels', levels: ['low', 'high'] }, billing: 'unknown' },
    ]);
    expect(merged[0].tier).toBeUndefined();
    expect(merged[0].autoClassified).toBeUndefined();
    expect(merged[1].tier).toBeUndefined();
    expect(merged[1].autoClassified).toBeUndefined();
  });

  it('P-29: bundled models missing from a successful live list stay listed with source bundled', () => {
    const merged = mergeCatalog([{ id: 'claude-sonnet-5-1' }], [OPUS_4_9, SONNET_5_1, HAIKU_4_5], FAMILY_PATTERNS);
    expect(merged).toEqual([
      { id: 'claude-sonnet-5-1', source: 'live', tier: 'balanced', thinking: SONNET_5_1.thinking, billing: 'unknown' },
      { id: 'claude-opus-4-9', source: 'bundled', tier: 'strong', thinking: OPUS_4_9.thinking, billing: 'unknown' },
      { id: 'claude-haiku-4-5', source: 'bundled', tier: 'fast', thinking: HAIKU_4_5.thinking, billing: 'unknown' },
    ]);
    // An empty live array is a successful refresh, not a failed one — the registry stays listed.
    const emptyLive: readonly LiveModel[] = [];
    expect(mergeCatalog(emptyLive, [SONNET_5_1], FAMILY_PATTERNS)).toEqual([
      { id: 'claude-sonnet-5-1', source: 'bundled', tier: 'balanced', thinking: SONNET_5_1.thinking, billing: 'unknown' },
    ]);
  });

  it('P-29: an authoritative live list drops bundled models it does not contain', () => {
    const merged = mergeCatalog(
      [{ id: 'claude-sonnet-5-1' }],
      [OPUS_4_9, SONNET_5_1, HAIKU_4_5],
      FAMILY_PATTERNS,
      undefined,
      { authoritative: true },
    );
    expect(merged).toEqual([
      { id: 'claude-sonnet-5-1', source: 'live', tier: 'balanced', thinking: SONNET_5_1.thinking, billing: 'unknown' },
    ]);
  });

  it('P-29: an authoritative live list keeps retired bundled models live still offers — only the unconfirmed drop', () => {
    const merged = mergeCatalog(
      [{ id: 'claude-opus-4-1' }],
      [SONNET_5_1, OPUS_4_1_RETIRED],
      FAMILY_PATTERNS,
      undefined,
      { authoritative: true },
    );
    expect(merged).toEqual([
      { id: 'claude-opus-4-1', source: 'live', tier: 'strong', thinking: OPUS_4_1_RETIRED.thinking, billing: 'unknown' },
    ]);
  });

  it('P-29: a failed refresh ignores the authoritative flag — the previous list is kept, never dropped', () => {
    const previous: readonly CatalogModel[] = [
      { id: 'claude-sonnet-5-1', source: 'live', tier: 'balanced', thinking: SONNET_5_1.thinking, billing: 'unknown' },
      { id: 'claude-opus-4-9', source: 'bundled', tier: 'strong', thinking: OPUS_4_9.thinking, billing: 'unknown' },
    ];
    expect(mergeCatalog(undefined, [SONNET_5_1], FAMILY_PATTERNS, previous, { authoritative: true })).toEqual([
      { ...previous[0], stale: true },
      { ...previous[1], stale: true },
    ]);
  });

  it('P-29: retired bundled models are listed only when live also lists them', () => {
    const withoutLive = mergeCatalog([{ id: 'claude-sonnet-5-1' }], [SONNET_5_1, OPUS_4_1_RETIRED], FAMILY_PATTERNS);
    expect(withoutLive).toEqual([
      { id: 'claude-sonnet-5-1', source: 'live', tier: 'balanced', thinking: SONNET_5_1.thinking, billing: 'unknown' },
    ]);
    const withLive = mergeCatalog(
      [{ id: 'claude-opus-4-1' }, { id: 'claude-sonnet-5-1' }],
      [SONNET_5_1, OPUS_4_1_RETIRED],
      FAMILY_PATTERNS,
    );
    expect(withLive).toEqual([
      { id: 'claude-opus-4-1', source: 'live', tier: 'strong', thinking: OPUS_4_1_RETIRED.thinking, billing: 'unknown' },
      { id: 'claude-sonnet-5-1', source: 'live', tier: 'balanced', thinking: SONNET_5_1.thinking, billing: 'unknown' },
    ]);
  });

  it('P-29: a failed refresh keeps the previous list and marks every entry stale', () => {
    const previous: readonly CatalogModel[] = [
      { id: 'claude-sonnet-5-1', source: 'live', tier: 'balanced', thinking: SONNET_5_1.thinking, billing: 'unknown' },
      { id: 'claude-opus-4-9', source: 'bundled', tier: 'strong', thinking: OPUS_4_9.thinking, billing: 'unknown' },
    ];
    expect(mergeCatalog(undefined, [SONNET_5_1], FAMILY_PATTERNS, previous)).toEqual([
      { ...previous[0], stale: true },
      { ...previous[1], stale: true },
    ]);
  });

  it('P-29: a failed refresh without a previous list falls back to the non-retired bundled models', () => {
    expect(mergeCatalog(undefined, [OPUS_4_9, SONNET_5_1, OPUS_4_1_RETIRED], FAMILY_PATTERNS)).toEqual([
      { id: 'claude-opus-4-9', source: 'bundled', tier: 'strong', thinking: OPUS_4_9.thinking, billing: 'unknown' },
      { id: 'claude-sonnet-5-1', source: 'bundled', tier: 'balanced', thinking: SONNET_5_1.thinking, billing: 'unknown' },
    ]);
  });
});

describe('mergeCatalog billing (P-40)', () => {
  const SONNET_INCLUDED: ModelRecord = { ...SONNET_5_1, billing: 'included' };

  it('P-40: a live row matching a bundled record takes the record billing — the live row own report wins', () => {
    const fromRecord = mergeCatalog([{ id: 'claude-sonnet-5-1' }], [SONNET_INCLUDED], FAMILY_PATTERNS);
    expect(fromRecord[0].billing).toBe('included');
    const fromLive = mergeCatalog(
      [{ id: 'claude-sonnet-5-1', billing: 'metered' }],
      [SONNET_INCLUDED],
      FAMILY_PATTERNS,
    );
    expect(fromLive[0].billing).toBe('metered');
  });

  it('P-40: a matched record without billing, and a live-only row without billing, merge as unknown', () => {
    const matched = mergeCatalog([{ id: 'claude-sonnet-5-1' }], [SONNET_5_1], FAMILY_PATTERNS);
    expect(matched[0].billing).toBe('unknown');
    const liveOnly = mergeCatalog(
      [{ id: 'grok-4-fast' }, { id: 'grok-4-deep', billing: 'metered' }],
      [],
      FAMILY_PATTERNS,
    );
    expect(liveOnly[0].billing).toBe('unknown');
    expect(liveOnly[1].billing).toBe('metered');
  });

  it('P-40: a bundled model missing from the live list keeps the record billing', () => {
    const opusMetered: ModelRecord = { ...OPUS_4_9, billing: 'metered' };
    const merged = mergeCatalog([{ id: 'claude-sonnet-5-1' }], [opusMetered, SONNET_5_1], FAMILY_PATTERNS);
    expect(merged.find((model) => model.id === 'claude-opus-4-9')?.billing).toBe('metered');
  });

  it('P-40: a route default fills live-only rows that report no billing — a row or record that knows its own keeps it', () => {
    const merged = mergeCatalog(
      [
        { id: 'claude-sonnet-5-1' },
        { id: 'grok-4-fast' },
        { id: 'grok-4-deep', billing: 'unknown' as const },
      ],
      [SONNET_INCLUDED],
      FAMILY_PATTERNS,
      undefined,
      { defaultBilling: 'metered' },
    );
    // A matched record keeps its verified billing; the route default never rewrites it.
    expect(merged.find((model) => model.id === 'claude-sonnet-5-1')?.billing).toBe('included');
    // A live-only row with no report of its own takes the route kind's default.
    expect(merged.find((model) => model.id === 'grok-4-fast')?.billing).toBe('metered');
    // An explicit live report — even unknown — is the row's own answer and wins over the default.
    expect(merged.find((model) => model.id === 'grok-4-deep')?.billing).toBe('unknown');
  });

  it('P-40: without a route default nothing changes — live-only rows stay unknown, matched records keep theirs', () => {
    const matched = mergeCatalog([{ id: 'claude-sonnet-5-1' }], [SONNET_5_1], FAMILY_PATTERNS, undefined, {
      defaultBilling: 'metered',
    });
    expect(matched[0].billing).toBe('unknown');
    const withoutOption = mergeCatalog([{ id: 'grok-4-fast' }], [], FAMILY_PATTERNS, undefined, {
      authoritative: true,
    });
    expect(withoutOption[0].billing).toBe('unknown');
  });

  it('P-40: the route default never reaches bundled rows — the registry carries its own billing', () => {
    const opusMetered: ModelRecord = { ...OPUS_4_9, billing: 'metered' };
    const merged = mergeCatalog([{ id: 'claude-sonnet-5-1' }], [opusMetered, SONNET_5_1], FAMILY_PATTERNS, undefined, {
      defaultBilling: 'included',
    });
    expect(merged.find((model) => model.id === 'claude-opus-4-9')?.billing).toBe('metered');
    expect(merged.find((model) => model.id === 'claude-sonnet-5-1')?.billing).toBe('unknown');
  });

  it('P-40: billing survives a failed refresh — the stale previous entries keep theirs', () => {
    const previous: readonly CatalogModel[] = [
      { id: 'claude-sonnet-5-1', source: 'live', tier: 'balanced', thinking: SONNET_5_1.thinking, billing: 'included' },
      { id: 'grok-4-fast', source: 'live', thinking: 'unknown', billing: 'unknown' },
    ];
    expect(mergeCatalog(undefined, [SONNET_5_1], FAMILY_PATTERNS, previous)).toEqual([
      { ...previous[0], stale: true },
      { ...previous[1], stale: true },
    ]);
  });
});

describe('autoSelectable (P-40)', () => {
  it('P-40: only an included model is auto-selectable — metered and unknown never are', () => {
    const entry = (billing: Billing): CatalogModel => ({
      id: 'claude-opus-5-1',
      source: 'live',
      thinking: 'unknown',
      billing,
    });
    expect(autoSelectable(entry('included'))).toBe(true);
    expect(autoSelectable(entry('metered'))).toBe(false);
    expect(autoSelectable(entry('unknown'))).toBe(false);
  });
});

describe('resolveTier (P-29)', () => {
  // Billing is orthogonal to version comparison; `included` keeps these models selectable so the
  // assertions below keep their pre-billing meaning.
  const model = (id: string): CatalogModel => ({
    id,
    source: 'live',
    tier: 'strong',
    thinking: 'unknown',
    autoClassified: true,
    billing: 'included',
  });

  it('P-29: a non-empty tierModels entry for the tier wins; an empty one falls through to the catalog', () => {
    const catalog: readonly CatalogModel[] = [model('claude-opus-5-10')];
    expect(resolveTier('strong', catalog, { strong: 'claude-opus-4-1', balanced: '', fast: '' })).toBe('claude-opus-4-1');
    expect(resolveTier('strong', catalog, { strong: '', balanced: '', fast: '' })).toBe('claude-opus-5-10');
  });

  it('P-29: tier resolution compares the numeric segments of the id left to right — 4-9 < 5-1 < 5-10', () => {
    expect(resolveTier('strong', [model('claude-opus-4-9'), model('claude-opus-5-1'), model('claude-opus-5-10')])).toBe(
      'claude-opus-5-10',
    );
    expect(resolveTier('strong', [model('claude-opus-4-9'), model('claude-opus-5-1')])).toBe('claude-opus-5-1');
    expect(resolveTier('strong', [model('claude-opus-4-9')])).toBe('claude-opus-4-9');
    // A longer numeric tail wins a prefix tie: 5-1 is a higher version than plain 5.
    expect(resolveTier('strong', [model('claude-opus-5'), model('claude-opus-5-1')])).toBe('claude-opus-5-1');
  });

  it('P-29: a tier with no catalog model resolves to undefined', () => {
    const catalog: readonly CatalogModel[] = [
      { id: 'claude-haiku-4-5', source: 'bundled', tier: 'fast', thinking: { kind: 'none' }, billing: 'unknown' },
    ];
    expect(resolveTier('strong', catalog)).toBeUndefined();
  });
});

describe('resolveTier billing (P-40)', () => {
  const entry = (id: string, billing: Billing): CatalogModel => ({
    id,
    source: 'live',
    tier: 'strong',
    thinking: 'unknown',
    autoClassified: true,
    billing,
  });

  it('P-40: a tier whose only model is metered — or unknown — resolves to undefined without tierModels', () => {
    expect(resolveTier('strong', [entry('claude-opus-5-10', 'metered')])).toBeUndefined();
    expect(resolveTier('strong', [entry('claude-opus-5-10', 'unknown')])).toBeUndefined();
  });

  it('P-40: an explicit non-empty tierModels entry still wins for a model that is not auto-selectable', () => {
    const tierModels = { strong: 'claude-opus-5-10', balanced: '', fast: '' };
    expect(resolveTier('strong', [entry('claude-opus-5-10', 'metered')], tierModels)).toBe('claude-opus-5-10');
  });

  it('P-40: the automatic pick takes the highest-version included model and skips metered and unknown ones', () => {
    const catalog: readonly CatalogModel[] = [
      entry('claude-opus-5-10', 'metered'),
      entry('claude-opus-4-1', 'unknown'),
      entry('claude-opus-4-9', 'included'),
    ];
    expect(resolveTier('strong', catalog)).toBe('claude-opus-4-9');
  });
});

describe('catalogCacheKey (P-29)', () => {
  it('P-29: two accounts of one provider get different cache keys — a catalog is never keyed by provider alone', () => {
    expect(catalogCacheKey('acct-a', 'subscription')).not.toBe(catalogCacheKey('acct-b', 'subscription'));
    expect(catalogCacheKey('acct-a', 'subscription')).not.toBe(catalogCacheKey('acct-a', 'api'));
  });
});

describe('thinkingFor (P-30)', () => {
  it('P-30: a model without thinking control — none or unknown — maps every user level to undefined', () => {
    expect(thinkingFor('fast', { kind: 'none' })).toBeUndefined();
    expect(thinkingFor('balanced', { kind: 'none' })).toBeUndefined();
    expect(thinkingFor('deep', { kind: 'none' })).toBeUndefined();
    expect(thinkingFor('fast', 'unknown')).toBeUndefined();
    expect(thinkingFor('balanced', 'unknown')).toBeUndefined();
    expect(thinkingFor('deep', 'unknown')).toBeUndefined();
  });

  it('P-30: a provider listing none…max — fast takes the lowest non-none, balanced medium, deep tops out at xhigh', () => {
    const thinking = { kind: 'levels', levels: ['none', 'minimal', 'low', 'medium', 'high', 'xhigh', 'max'] } as const;
    expect(thinkingFor('fast', thinking)).toBe('minimal');
    expect(thinkingFor('balanced', thinking)).toBe('medium');
    expect(thinkingFor('deep', thinking)).toBe('xhigh');
  });

  it('P-30: a provider listing low…ultra — deep still stops at xhigh and never returns ultra', () => {
    const thinking = { kind: 'levels', levels: ['low', 'medium', 'high', 'xhigh', 'max', 'ultra'] } as const;
    expect(thinkingFor('fast', thinking)).toBe('low');
    expect(thinkingFor('balanced', thinking)).toBe('medium');
    expect(thinkingFor('deep', thinking)).toBe('xhigh');
  });

  it('P-30: balanced without medium takes the nearest lower level, else the lowest available', () => {
    const noMedium = { kind: 'levels', levels: ['low', 'high', 'xhigh'] } as const;
    expect(thinkingFor('balanced', noMedium)).toBe('low');
    const onlyAbove = { kind: 'levels', levels: ['high', 'xhigh'] } as const;
    expect(thinkingFor('balanced', onlyAbove)).toBe('high');
  });

  it('P-30: only none available — or nothing but max/ultra beyond the user range — yields undefined', () => {
    const onlyNone = { kind: 'levels', levels: ['none'] } as const;
    expect(thinkingFor('fast', onlyNone)).toBeUndefined();
    expect(thinkingFor('balanced', onlyNone)).toBeUndefined();
    expect(thinkingFor('deep', onlyNone)).toBeUndefined();
    const maxBeyond = { kind: 'levels', levels: ['none', 'max'] } as const;
    expect(thinkingFor('fast', maxBeyond)).toBeUndefined();
    expect(thinkingFor('balanced', maxBeyond)).toBeUndefined();
    expect(thinkingFor('deep', maxBeyond)).toBeUndefined();
  });

  it('P-30: levels are compared in canonical effort order, not in the order the provider lists them', () => {
    const shuffled = { kind: 'levels', levels: ['xhigh', 'low', 'none', 'high'] } as const;
    expect(thinkingFor('fast', shuffled)).toBe('low');
    expect(thinkingFor('deep', shuffled)).toBe('xhigh');
  });
});
