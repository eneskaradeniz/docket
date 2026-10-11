// Rules R-108 … R-113 of docs/v2/domain.md: the usage module.
import { describe, expect, it } from 'vitest';

import {
  PLANNING_STAGE_IDS,
  USAGE_THRESHOLDS,
  findWaste,
  summarizeUsage,
  type RunUsageInput,
  type StageUsage,
  type UsageSummary,
} from './index';

const run = (over: Partial<RunUsageInput> = {}): RunUsageInput => ({
  runId: '01RUN',
  stage: 'implement',
  attempt: 1,
  role: 'developer',
  inputTokens: 0,
  outputTokens: 0,
  cachedInputTokens: 0,
  ...over,
});

/** A summary built by hand for boundary-precise findWaste cases. */
const summary = (over: Partial<UsageSummary> = {}): UsageSummary => ({
  runs: 0,
  tokens: 0,
  inputTokens: 0,
  cachedInputTokens: 0,
  byStage: [],
  planningShare: 0,
  cacheRatio: 0,
  ...over,
});

const stage = (over: Partial<StageUsage> = {}): StageUsage => ({
  stage: 'implement',
  runs: 1,
  maxAttempt: 1,
  tokens: 0,
  inputTokens: 0,
  cachedInputTokens: 0,
  ...over,
});

const deepFreeze = (value: unknown): void => {
  if (value === null || typeof value !== 'object') return;
  Object.freeze(value);
  for (const child of Object.values(value as Record<string, unknown>)) deepFreeze(child);
};

describe('usage: summarizeUsage (R-108 … R-111)', () => {
  it('R-108: sums per stage and overall, tokens = input + output; empty input folds to zeros, never NaN', () => {
    const empty = summarizeUsage([]);
    expect(empty).toStrictEqual({
      runs: 0,
      tokens: 0,
      inputTokens: 0,
      cachedInputTokens: 0,
      byStage: [],
      planningShare: 0,
      cacheRatio: 0,
    });
    expect(Number.isNaN(empty.planningShare)).toBe(false);
    expect(Number.isNaN(empty.cacheRatio)).toBe(false);

    const plan1 = run({ runId: 'r1', stage: 'plan', attempt: 1, inputTokens: 100, outputTokens: 50, cachedInputTokens: 40 });
    const plan2 = run({ runId: 'r2', stage: 'plan', attempt: 2, inputTokens: 10, outputTokens: 5 });
    const impl = run({ runId: 'r3', inputTokens: 1000, outputTokens: 500, cachedInputTokens: 900 });
    const inputs = [plan1, plan2, impl];
    deepFreeze(inputs);
    const s = summarizeUsage(inputs);
    expect(s.runs).toBe(3);
    expect(s.tokens).toBe(1665);
    expect(s.inputTokens).toBe(1110);
    expect(s.cachedInputTokens).toBe(940);
    expect(s.byStage).toStrictEqual([
      { stage: 'plan', runs: 2, maxAttempt: 2, tokens: 165, inputTokens: 110, cachedInputTokens: 40 },
      { stage: 'implement', runs: 1, maxAttempt: 1, tokens: 1500, inputTokens: 1000, cachedInputTokens: 900 },
    ]);

    // A single run is its own stage row; the fold is deterministic and never mutates its input.
    const single = summarizeUsage([run({ inputTokens: 7, outputTokens: 3, cachedInputTokens: 7 })]);
    expect(single.byStage).toStrictEqual([
      { stage: 'implement', runs: 1, maxAttempt: 1, tokens: 10, inputTokens: 7, cachedInputTokens: 7 },
    ]);
    expect(single.cacheRatio).toBe(1);
    expect(summarizeUsage(inputs)).toStrictEqual(summarizeUsage(inputs));
    // Stage order follows first appearance, not the stage id alphabet.
    expect(summarizeUsage([impl, plan1, plan2]).byStage.map((row) => row.stage)).toStrictEqual(['implement', 'plan']);
  });

  it('R-109: planningShare is planning-stage tokens over all tokens; other and custom stages count as other', () => {
    expect(summarizeUsage([run({ stage: 'plan' })]).planningShare).toBe(0);
    expect(PLANNING_STAGE_IDS).toStrictEqual(['plan', 'research']);
    const s = summarizeUsage([
      run({ stage: 'research', inputTokens: 250, outputTokens: 150 }),
      run({ stage: 'plan', inputTokens: 100, outputTokens: 100 }),
      run({ stage: 'implement', inputTokens: 300, outputTokens: 100 }),
      run({ stage: 'verify', inputTokens: 100, outputTokens: 100 }),
    ]);
    expect(s.planningShare).toBe(0.5);
    expect(summarizeUsage([run({ stage: 'research', inputTokens: 60, outputTokens: 40 })]).planningShare).toBe(1);
    // Tokens present but none of them planning is a real zero share, not the no-tokens guard.
    expect(summarizeUsage([run({ inputTokens: 60, outputTokens: 40 })]).planningShare).toBe(0);
  });

  it('R-110: cacheRatio is cached input over input tokens, 0 when there is no input', () => {
    const outputOnly = summarizeUsage([run({ outputTokens: 500 }), run({ stage: 'plan', outputTokens: 100 })]);
    expect(outputOnly.inputTokens).toBe(0);
    expect(outputOnly.cacheRatio).toBe(0);
    expect(Number.isFinite(outputOnly.cacheRatio)).toBe(true);
    const s = summarizeUsage([
      run({ inputTokens: 1000, outputTokens: 10, cachedInputTokens: 250 }),
      run({ inputTokens: 1000, outputTokens: 10, cachedInputTokens: 750 }),
    ]);
    expect(s.cacheRatio).toBeCloseTo(0.5, 12);
  });

  it('R-111: costUsd sums only the inputs that carry it; absent everywhere stays absent, never 0', () => {
    const costless = summarizeUsage([run(), run({ stage: 'plan' }), run({ stage: 'review' })]);
    expect('costUsd' in costless).toBe(false);
    expect(costless.byStage.every((row) => !('costUsd' in row))).toBe(true);
    // A carried zero is a real zero, kept — an unknown cost is what stays absent.
    const zero = summarizeUsage([run({ costUsd: 0, costKind: 'reported' })]);
    expect('costUsd' in zero).toBe(true);
    expect(zero.costUsd).toBe(0);
    const mixed = summarizeUsage([
      run({ stage: 'plan', costUsd: 0.01, costKind: 'computed' }),
      run({ stage: 'plan' }),
      run({ stage: 'implement', costUsd: 0.02 }),
    ]);
    expect(mixed.costUsd).toBeCloseTo(0.03, 12);
    expect(mixed.byStage.find((row) => row.stage === 'plan')?.costUsd).toBeCloseTo(0.01, 12);
    expect(mixed.byStage.find((row) => row.stage === 'implement')?.costUsd).toBeCloseTo(0.02, 12);
  });
});

describe('usage: findWaste (R-112 … R-113)', () => {
  it('R-112: planning_heavy needs share ≥ 0.4 AND runs ≥ 5, both inclusive, and carries { share, runs }', () => {
    expect(USAGE_THRESHOLDS).toStrictEqual({
      planningShare: 0.4,
      planningMinRuns: 5,
      retryAttempts: 3,
      cacheRatio: 0.2,
      cacheMinInputTokens: 50000,
    });
    const at = summarizeUsage([
      run({ stage: 'plan', inputTokens: 400 }),
      run({ inputTokens: 150 }),
      run({ inputTokens: 150 }),
      run({ inputTokens: 150 }),
      run({ inputTokens: 150 }),
    ]);
    expect(at.runs).toBe(5);
    expect(at.planningShare).toBe(0.4);
    expect(findWaste(at)).toStrictEqual([{ rule: 'R-112', kind: 'planning_heavy', values: { share: 0.4, runs: 5 } }]);

    // Exactly at the share but one run short.
    const short = summarizeUsage([
      run({ stage: 'plan', inputTokens: 400 }),
      run({ inputTokens: 200 }),
      run({ inputTokens: 200 }),
      run({ inputTokens: 200 }),
    ]);
    expect(short.planningShare).toBe(0.4);
    expect(findWaste(short)).toStrictEqual([]);

    // Well past the share, still one run short.
    const heavyButShort = summarizeUsage([
      run({ stage: 'plan', inputTokens: 500 }),
      run({ inputTokens: 100 }),
      run({ inputTokens: 100 }),
      run({ inputTokens: 100 }),
    ]);
    expect(heavyButShort.planningShare).toBe(0.625);
    expect(findWaste(heavyButShort)).toStrictEqual([]);

    // Enough runs but a hair under the share: 399 of 1000.
    const under = summarizeUsage([
      run({ stage: 'plan', inputTokens: 399 }),
      run({ inputTokens: 150 }),
      run({ inputTokens: 150 }),
      run({ inputTokens: 150 }),
      run({ inputTokens: 151 }),
    ]);
    expect(under.planningShare).toBeLessThan(0.4);
    expect(findWaste(under)).toStrictEqual([]);
  });

  it('R-113: retry_loop fires per stage at maxAttempt ≥ 3 (inclusive) carrying { attempts } and the stage', () => {
    const two = summarizeUsage([run({ stage: 'implement', attempt: 1 }), run({ stage: 'implement', attempt: 2 })]);
    expect(findWaste(two)).toStrictEqual([]);
    const thirdTry = summarizeUsage([
      run({ stage: 'implement', attempt: 1 }),
      run({ stage: 'implement', attempt: 2 }),
      run({ stage: 'implement', attempt: 3 }),
    ]);
    expect(findWaste(thirdTry)).toStrictEqual([
      { rule: 'R-113', kind: 'retry_loop', stage: 'implement', values: { attempts: 3 } },
    ]);
    expect(
      findWaste(summary({ byStage: [stage({ stage: 'verify', runs: 4, maxAttempt: 4 })] })),
    ).toStrictEqual([{ rule: 'R-113', kind: 'retry_loop', stage: 'verify', values: { attempts: 4 } }]);
    expect(findWaste(summary({ byStage: [stage({ stage: 'verify', runs: 2, maxAttempt: 2 })] }))).toStrictEqual([]);
  });

  it('R-113: low_cache needs ratio < 0.2 (strict) and input ≥ 50000 (inclusive), carrying { ratio, inputTokens }', () => {
    // Exactly 0.2 is not low cache, even above the token floor.
    expect(findWaste(summary({ inputTokens: 50000, cachedInputTokens: 10000, cacheRatio: 0.2 }))).toStrictEqual([]);
    expect(
      findWaste(summary({ inputTokens: 50000, cachedInputTokens: 9999, cacheRatio: 9999 / 50000 })),
    ).toStrictEqual([{ rule: 'R-113', kind: 'low_cache', values: { ratio: 9999 / 50000, inputTokens: 50000 } }]);
    // A low ratio under the token floor says nothing.
    expect(findWaste(summary({ inputTokens: 49999, cachedInputTokens: 0, cacheRatio: 0 }))).toStrictEqual([]);
    expect(findWaste(summary({ inputTokens: 100000, cachedInputTokens: 0, cacheRatio: 0 }))).toStrictEqual([
      { rule: 'R-113', kind: 'low_cache', values: { ratio: 0, inputTokens: 100000 } },
    ]);
  });

  it('R-113: findings keep the fixed order planning, retry by stage id, cache, and the summary is never mutated', () => {
    const s = summary({
      runs: 6,
      tokens: 1000,
      inputTokens: 100000,
      planningShare: 0.5,
      cacheRatio: 0.1,
      byStage: [stage({ stage: 'zeta', runs: 3, maxAttempt: 3 }), stage({ stage: 'alpha', runs: 5, maxAttempt: 5 })],
    });
    deepFreeze(s);
    expect(findWaste(s)).toStrictEqual([
      { rule: 'R-112', kind: 'planning_heavy', values: { share: 0.5, runs: 6 } },
      { rule: 'R-113', kind: 'retry_loop', stage: 'alpha', values: { attempts: 5 } },
      { rule: 'R-113', kind: 'retry_loop', stage: 'zeta', values: { attempts: 3 } },
      { rule: 'R-113', kind: 'low_cache', values: { ratio: 0.1, inputTokens: 100000 } },
    ]);
    // Passing the defaults explicitly behaves the same as omitting them.
    expect(findWaste(s, USAGE_THRESHOLDS)).toStrictEqual(findWaste(s));
  });
});
