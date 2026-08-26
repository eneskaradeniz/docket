// WO-0046 — the resume-cost pin. The accumulation rule (`applyResultCost`) encodes the
// semantics probe c2 measured (findings §C, docs/probes/cc-surface/raw/) with the review
// round's axis split: usd is cumulative within one SDK query process and resets at the
// resume boundary; usage tokens are PER-RESULT (s2b: result#1 27802/50, result#2 44/158).
// These tests pin the rule against the raw numbers so an SDK semantics change fails here
// first (TD-016's re-probe discipline).
import { describe, expect, it } from 'vitest';
import { addCost, applyResultCost } from './index';
import type { CostSummary } from '../../core/types';

const cost = (usd: number, tokensIn = 0, tokensOut = 0): CostSummary => ({ usd, tokensIn, tokensOut });

describe('applyResultCost — the measured cost semantics (WO-0046, probe c2/s2b + review f2)', () => {
  it('usd is cumulative within a drive (the DELTA is the difference) while usage tokens are PER-RESULT (summed plainly) — raw/s2b', () => {
    const first = applyResultCost(0, cost(0.17658, 27802, 50));
    expect(first.delta).toEqual(cost(0.17658, 27802, 50));
    // result#2's usage is 44/158 — a cache-hit call's own figures, NOT a process total; a shared
    // max-guard would have "delta'd" them to 0/108 (the review f2 under-count).
    const second = applyResultCost(first.baselineUsd, cost(0.205902, 44, 158));
    expect(second.delta.usd).toBeCloseTo(0.029322, 6); // the note command's own spend
    expect(second.delta.tokensIn).toBe(44);
    expect(second.delta.tokensOut).toBe(158);
    expect(second.baselineUsd).toBeCloseTo(0.205902, 6);
  });

  it('a resumed leg starts from a FRESH usd baseline: the first figure is that leg own spend, never the session total — raw/c2 (leg 1 ended 0.0948, leg 2 reported 0.0562)', () => {
    const leg1 = applyResultCost(0, cost(0.094824, 9599, 53));
    const leg1Total = addCost(cost(0), leg1.delta);
    expect(leg1Total.usd).toBeCloseTo(0.094824, 6);
    const leg2 = applyResultCost(0, cost(0.056219, 213, 194)); // smaller than leg 1's total — reset, not cumulative
    expect(leg2.delta.usd).toBeCloseTo(0.056219, 6); // taken WHOLE — cumulative would have been ≥ 0.0948
    // The store's prior + input add-rule lands the true session total on the row:
    expect(addCost(leg1Total, leg2.delta).usd).toBeCloseTo(0.151043, 6);
    expect(addCost(leg1Total, leg2.delta).tokensIn).toBe(9599 + 213);
  });

  it('a usd figure below the baseline is read as per-command and taken whole (the §S/s2 defensive branch); the baseline ratchets, never down', () => {
    const r = applyResultCost(0.2, cost(0.05, 200, 20));
    expect(r.delta).toEqual(cost(0.05, 200, 20));
    expect(r.baselineUsd).toBe(0.2);
  });
});

describe('addCost — the drive accumulator', () => {
  it('sums field-wise', () => {
    expect(addCost(cost(0.1, 10, 2), cost(0.2, 30, 4))).toEqual(cost(0.30000000000000004, 40, 6));
  });
});
