// Support-level derivation (P-28) over fixture records. The registry data itself is
// infrastructure — provider names may not appear in the domain — so every branch here is proven
// on synthetic records and the real data is validated in its own module.
import { describe, expect, it } from 'vitest';

import { supportLevel, thinkingOptions } from './capability';
import type { Evidence, GateId, ModelRecord, ProviderRecord } from './capability';

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
