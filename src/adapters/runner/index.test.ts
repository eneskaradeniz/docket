// WO-0046 — the resume-cost pin. The accumulation rule (`applyResultCost`) encodes the
// semantics probe c2 measured (findings §C, docs/probes/cc-surface/raw/): result cost
// figures are cumulative within one SDK query process and RESET at the resume boundary.
// These tests pin the rule against the raw numbers so an SDK semantics change fails here
// first (TD-016's re-probe discipline).
import { describe, expect, it } from 'vitest';
import { addCost, applyResultCost } from './index';
import type { CostSummary } from '../../core/types';

const cost = (usd: number, tokensIn = 0, tokensOut = 0): CostSummary => ({ usd, tokensIn, tokensOut });
const ZERO = cost(0);

describe('applyResultCost — the measured cost semantics (WO-0046, probe c2/s2b)', () => {
  it('within one drive the figures are cumulative: the DELTA is the difference (raw/s2b: 0.1766 → 0.2059)', () => {
    const first = applyResultCost(ZERO, cost(0.17658, 27802, 50));
    expect(first.delta).toEqual(cost(0.17658, 27802, 50));
    const second = applyResultCost(first.baseline, cost(0.205902, 28_000, 208));
    expect(second.delta.usd).toBeCloseTo(0.029322, 6); // the note command's own spend
    expect(second.baseline.usd).toBeCloseTo(0.205902, 6);
  });

  it('a resumed leg starts from a FRESH baseline: the first figure is that leg own spend, never the session total (raw/c2: leg 1 ended 0.0948, leg 2 reported 0.0562)', () => {
    // The per-drive baseline is constructed at zero every leg — the reset is the contract.
    const leg1 = applyResultCost(ZERO, cost(0.094824, 9599, 53));
    const leg1Total = addCost(ZERO, leg1.delta);
    expect(leg1Total.usd).toBeCloseTo(0.094824, 6);
    const leg2 = applyResultCost(ZERO, cost(0.056219, 213, 194)); // smaller than leg 1's total
    expect(leg2.delta.usd).toBeCloseTo(0.056219, 6); // taken WHOLE — cumulative would have been ≥ 0.0948
    // The store's prior + input add-rule lands the true session total on the row:
    expect(addCost(leg1Total, leg2.delta).usd).toBeCloseTo(0.151043, 6);
  });

  it('a figure below the baseline is read as per-command and taken as the delta itself (the §S/s2 defensive branch)', () => {
    const r = applyResultCost(cost(0.2, 1000, 100), cost(0.05, 200, 20));
    expect(r.delta).toEqual(cost(0.05, 200, 20));
    expect(r.baseline).toEqual(cost(0.2, 1000, 100)); // ratchets, never down
  });

  it('the guard covers tokens as much as usd (reviewer finding 6 carried forward)', () => {
    const r = applyResultCost(cost(0.1, 80_000, 1_000), cost(0.15, 120_000, 2_000));
    expect(r.delta.tokensIn).toBe(40_000);
    expect(r.delta.tokensOut).toBe(1_000);
    expect(r.delta.usd).toBeCloseTo(0.05, 10);
  });
});

describe('addCost — the drive accumulator', () => {
  it('sums field-wise', () => {
    expect(addCost(cost(0.1, 10, 2), cost(0.2, 30, 4))).toEqual(cost(0.30000000000000004, 40, 6));
  });
});
