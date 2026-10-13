// Support-level derivation (P-28) over fixture records. The registry data itself is
// infrastructure — provider names may not appear in the domain — so every branch here is proven
// on synthetic records and the real data is validated in its own module.
import { describe, expect, it } from 'vitest';

import { setupWarnings, supportFor, supportLevel, thinkingOptions, translateCapabilities } from './capability';
import type { Evidence, GateId, ModelRecord, ProviderRecord, TranslationRow } from './capability';
import type { CapabilityDef } from '../definitions/index';
import type { CapabilitySlug } from '../shared/index';

const scenarioEvidence = (name = 'fixture scenario'): Evidence => ({ kind: 'test', name });

const allGates = (): Readonly<Partial<Record<GateId, Evidence>>> => ({
  G1: scenarioEvidence('fixture discovery'),
  G2: scenarioEvidence('fixture mapping'),
  G3: scenarioEvidence('fixture permission'),
  G4: scenarioEvidence('fixture usage'),
  G5: scenarioEvidence('fixture probe'),
  G6: scenarioEvidence('fixture end-to-end'),
});

const recordOf = (
  gates: Readonly<Partial<Record<GateId, Evidence>>>,
  extra?: Partial<ProviderRecord>,
): ProviderRecord => ({
  providerId: 'fixture-cli',
  gates,
  isolation: scenarioEvidence('fixture isolation'),
  ...extra,
});

describe('supportLevel (P-28)', () => {
  it('P-28: the planned flag alone sets the level — gate evidence never overrides it', () => {
    expect(supportLevel(recordOf({}, { planned: true }))).toBe('planned');
    expect(supportLevel(recordOf(allGates(), { planned: true, operatorRuns: ['fixture-run'] }))).toBe('planned');
  });

  it('P-28: G1–G6 with a scripted-scenario G6 and a recorded operator run derive full', () => {
    expect(supportLevel(recordOf(allGates(), { operatorRuns: ['fixture-run'] }))).toBe('full');
  });

  it('P-28: a waived G5 still reaches full — the waiver is valid only on that gate', () => {
    const gates = { ...allGates(), G5: { kind: 'waived', reason: 'fixture waiver' } as Evidence };
    expect(supportLevel(recordOf(gates, { operatorRuns: ['fixture-run'] }))).toBe('full');
  });

  it('P-28: without a recorded operator run the full gate set tops out at isolated', () => {
    expect(supportLevel(recordOf(allGates()))).toBe('isolated');
    expect(supportLevel(recordOf(allGates(), { operatorRuns: [] }))).toBe('isolated');
  });

  it('P-28: full needs a scripted-scenario test as G6 evidence — an operator_run entry does not carry it', () => {
    const gates = { ...allGates(), G6: { kind: 'operator_run', id: 'fixture-run' } as Evidence };
    expect(supportLevel(recordOf(gates, { operatorRuns: ['fixture-run'] }))).toBe('isolated');
  });

  it('P-28: G1, G2, G4 and G6 without G3 or G5 derive isolated', () => {
    const gates: Readonly<Partial<Record<GateId, Evidence>>> = {
      G1: scenarioEvidence('fixture discovery'),
      G2: scenarioEvidence('fixture mapping'),
      G4: scenarioEvidence('fixture usage'),
      G6: scenarioEvidence('fixture end-to-end'),
    };
    expect(supportLevel(recordOf(gates))).toBe('isolated');
  });

  it('P-28: a missing gate among G1, G2, G4 or G6 leaves experimental', () => {
    for (const missing of ['G1', 'G2', 'G4', 'G6'] as const) {
      const gates = { ...allGates() };
      delete gates[missing];
      expect(supportLevel(recordOf(gates))).toBe('experimental');
    }
  });
});

describe('supportLevel isolation cap (P-28)', () => {
  it('P-28: a record without isolation evidence stays experimental whatever its gates and operator runs say', () => {
    const { isolation: _evidence, ...bare } = recordOf(allGates(), { operatorRuns: ['fixture-run'] });
    expect(supportLevel(bare)).toBe('experimental');
    expect(supportLevel({ ...bare, planned: true })).toBe('planned');
  });
});

describe('thinkingOptions (P-28)', () => {
  it('P-28: thinkingOptions of a none model is empty; a levels model yields exactly its levels', () => {
    const noneModel: ModelRecord = {
      id: 'fixture-none',
      family: 'fixture',
      tier: 'balanced',
      thinking: { kind: 'none' },
    };
    const levelsModel: ModelRecord = {
      id: 'fixture-levels',
      family: 'fixture',
      tier: 'strong',
      thinking: { kind: 'levels', levels: ['low', 'high'] },
    };
    expect(thinkingOptions(noneModel)).toEqual([]);
    expect(thinkingOptions(levelsModel)).toEqual(['low', 'high']);
  });

  it('P-28: thinkingOptions returns the widened effort unions verbatim — none…max and low…ultra', () => {
    const noneToMax: ModelRecord = {
      id: 'fixture-none-to-max',
      family: 'fixture',
      tier: 'strong',
      thinking: { kind: 'levels', levels: ['none', 'minimal', 'low', 'medium', 'high', 'xhigh', 'max'] },
    };
    const lowToUltra: ModelRecord = {
      id: 'fixture-low-to-ultra',
      family: 'fixture',
      tier: 'fast',
      thinking: { kind: 'levels', levels: ['low', 'medium', 'high', 'xhigh', 'max', 'ultra'] },
    };
    expect(thinkingOptions(noneToMax)).toEqual(['none', 'minimal', 'low', 'medium', 'high', 'xhigh', 'max']);
    expect(thinkingOptions(lowToUltra)).toEqual(['low', 'medium', 'high', 'xhigh', 'max', 'ultra']);
  });
});

const slug = (id: string): CapabilitySlug => id as CapabilitySlug;
const mcpCap = (id: string): CapabilityDef => ({ kind: 'mcp', id: slug(id), name: id, command: 'srv', args: [], env: {} });
const skillCap = (id: string): CapabilityDef => ({ kind: 'skill', id: slug(id), name: id, path: `skills/${id}.md` });
const hookCap = (id: string): CapabilityDef => ({ kind: 'hook', id: slug(id), name: id, event: 'run_end', command: 'true' });
const commandCap = (id: string): CapabilityDef => ({
  kind: 'command',
  id: slug(id),
  name: id,
  template: 'Review {{target}}',
  arguments: [{ name: 'target', required: true }],
});

const TABLE: readonly TranslationRow[] = [
  { provider: 'alpha', kind: 'mcp', support: 'native', how: 'run-scoped config' },
  { provider: 'alpha', kind: 'skill', support: 'degraded', how: 'inlined', degradesTo: 'context' },
  { provider: 'alpha', kind: 'hook', support: 'unsupported', how: 'no hook protocol' },
  { provider: 'alpha', kind: 'command', support: 'degraded', how: 'rendered by Docket', degradesTo: 'prompt_text' },
];

describe('translation support table', () => {
  it('P-57: supportFor answers from the table and a missing row is unverified, never native', () => {
    expect(supportFor(TABLE, 'alpha', 'mcp')).toBe(TABLE[0]);
    const missing = supportFor(TABLE, 'alpha', 'plugin');
    expect(missing.support).toBe('unverified');
    expect(missing).toMatchObject({ provider: 'alpha', kind: 'plugin' });
    expect(supportFor(TABLE, 'beta', 'mcp').support).toBe('unverified');
  });

  it('P-57: setupWarnings lists one warning per non-native (stage, capability) in stage order', () => {
    const warnings = setupWarnings(
      [
        { stage: 'plan', provider: 'alpha', capabilities: [mcpCap('m1'), hookCap('h1')] },
        { stage: 'work', provider: 'alpha', capabilities: [skillCap('s1'), mcpCap('m2')] },
        { stage: 'review', provider: 'beta', capabilities: [mcpCap('m1')] },
      ],
      TABLE,
    );
    expect(warnings).toEqual([
      { stage: 'plan', capability: 'h1', provider: 'alpha', support: 'unsupported', how: 'no hook protocol' },
      { stage: 'work', capability: 's1', provider: 'alpha', support: 'degraded', how: 'inlined' },
      { stage: 'review', capability: 'm1', provider: 'beta', support: 'unverified', how: expect.any(String) },
    ]);
  });
});

describe('per-run capability translation', () => {
  it('P-59: native capabilities go to the run, unsupported ones are omitted and recorded', () => {
    const result = translateCapabilities('alpha', [mcpCap('m1'), hookCap('h1')], TABLE);
    expect(result.run.map((c) => c.id)).toEqual(['m1']);
    expect(result.omitted).toEqual([{ capability: 'h1', provider: 'alpha', reason: 'unsupported' }]);
    expect(result.inline).toBe('');
  });

  it('P-59: degraded capabilities are inlined as instruction text, not passed to the run', () => {
    const result = translateCapabilities('alpha', [skillCap('s1'), commandCap('c1')], TABLE);
    expect(result.run).toEqual([]);
    expect(result.omitted).toEqual([]);
    expect(result.inline).toContain('skills/s1.md');
    expect(result.inline).toContain('Review {{target}}');
  });

  it('P-59 edge: unverified capabilities are attempted natively and a command is never passed to the run', () => {
    const result = translateCapabilities('beta', [mcpCap('m1'), commandCap('c1')], []);
    expect(result.run.map((c) => c.id)).toEqual(['m1']);
    expect(result.inline).toContain('Review {{target}}');
  });
});
