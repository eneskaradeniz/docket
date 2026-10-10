// Tests for the machine-aware concurrency rules R-69 … R-72. Contract: docs/v2/domain.md section 8.
import { describe, expect, it } from 'vitest';

import { effectiveGlobal, loadBand, suggestDispatchCap } from './machine';
import type { LoadBand, MachineSample } from './machine';

const GIB = 1024 ** 3;
const sample = (perCore: number, freeMemRatio?: number, cores = 10): MachineSample => ({
  cores,
  load1: perCore * cores,
  totalMemBytes: 16 * GIB,
  ...(freeMemRatio === undefined ? {} : { freeMemRatio }),
});

describe('loadBand', () => {
  it('R-69: from free, per-core load 0.6 enters reduced and 1.0 enters busy; below 0.6 stays free', () => {
    expect(loadBand(sample(0.59), 'free')).toBe('free');
    expect(loadBand(sample(0.6), 'free')).toBe('reduced');
    expect(loadBand(sample(0.99), 'free')).toBe('reduced');
    expect(loadBand(sample(1.0), 'free')).toBe('busy');
    expect(loadBand(sample(3), 'free')).toBe('busy');
  });

  it('R-69: free memory below 0.15 enters busy from any band; 0.15 exactly does not; unknown memory never forces a band', () => {
    for (const previous of ['free', 'reduced', 'busy'] as const) {
      expect(loadBand(sample(0.1, 0.149), previous)).toBe('busy');
    }
    expect(loadBand(sample(0.1, 0.15), 'free')).toBe('free');
    expect(loadBand(sample(0.1), 'free')).toBe('free');
    expect(loadBand(sample(0.1), 'reduced')).toBe('free');
  });

  it('R-69: per-core load divides by cores, and a zero core count is read as one core', () => {
    expect(loadBand({ cores: 4, load1: 2.4, totalMemBytes: GIB }, 'free')).toBe('reduced');
    expect(loadBand({ cores: 0, load1: 1, totalMemBytes: GIB }, 'free')).toBe('busy');
  });

  it('R-70: reduced leaves to free only below 0.5, so 0.55 stays reduced after crossing 0.6 and 0.45 returns to free', () => {
    let band: LoadBand = loadBand(sample(0.6), 'free');
    expect(band).toBe('reduced');
    band = loadBand(sample(0.55), band);
    expect(band).toBe('reduced');
    band = loadBand(sample(0.5), band);
    expect(band).toBe('reduced');
    band = loadBand(sample(0.45), band);
    expect(band).toBe('free');
  });

  it('R-70: busy leaves to reduced (one band per sample) only below 0.85 with memory unknown or at least 0.20', () => {
    expect(loadBand(sample(0.9), 'busy')).toBe('busy');
    expect(loadBand(sample(0.85), 'busy')).toBe('busy');
    expect(loadBand(sample(0.84), 'busy')).toBe('reduced');
    expect(loadBand(sample(0.2), 'busy')).toBe('reduced');
    expect(loadBand(sample(0.5, 0.19), 'busy')).toBe('busy');
    expect(loadBand(sample(0.5, 0.2), 'busy')).toBe('reduced');
    expect(loadBand(sample(0.5), 'busy')).toBe('reduced');
  });

  it('R-70: a reduced band re-enters busy at 1.0 and does not flap around the enter threshold', () => {
    expect(loadBand(sample(1.0), 'reduced')).toBe('busy');
    expect(loadBand(sample(0.95), 'reduced')).toBe('reduced');
    expect(loadBand(sample(0.7), 'busy')).toBe('reduced');
  });
});

describe('effectiveGlobal', () => {
  it('R-71: free answers the cap; reduced half of it, at least 1; busy the running count, at least 1', () => {
    expect(effectiveGlobal(4, 'free', 0)).toBe(4);
    expect(effectiveGlobal(4, 'free', 3)).toBe(4);
    expect(effectiveGlobal(4, 'reduced', 0)).toBe(2);
    expect(effectiveGlobal(1, 'reduced', 0)).toBe(1);
    expect(effectiveGlobal(3, 'reduced', 0)).toBe(1);
    expect(effectiveGlobal(4, 'busy', 0)).toBe(1);
    expect(effectiveGlobal(4, 'busy', 1)).toBe(1);
    expect(effectiveGlobal(4, 'busy', 3)).toBe(3);
  });

  it('R-71: the answer never exceeds the cap, even when more runs than the cap are running', () => {
    expect(effectiveGlobal(4, 'busy', 7)).toBe(4);
    expect(effectiveGlobal(1, 'busy', 0)).toBe(1);
  });
});

describe('suggestDispatchCap', () => {
  it('R-72: pins — 10 cores / 16 GB → 4, 4 / 8 → 2, 2 / 4 → 1, 32 / 128 → 16', () => {
    expect(suggestDispatchCap({ cores: 10, totalMemBytes: 16 * GIB })).toBe(4);
    expect(suggestDispatchCap({ cores: 4, totalMemBytes: 8 * GIB })).toBe(2);
    expect(suggestDispatchCap({ cores: 2, totalMemBytes: 4 * GIB })).toBe(1);
    expect(suggestDispatchCap({ cores: 32, totalMemBytes: 128 * GIB })).toBe(16);
  });

  it('R-72: floors each term, never goes below 1 and never above 16', () => {
    expect(suggestDispatchCap({ cores: 1, totalMemBytes: 2 * GIB })).toBe(1);
    expect(suggestDispatchCap({ cores: 0, totalMemBytes: 0 })).toBe(1);
    expect(suggestDispatchCap({ cores: 9, totalMemBytes: 15.9 * GIB })).toBe(3);
    expect(suggestDispatchCap({ cores: 128, totalMemBytes: 1024 * GIB })).toBe(16);
  });
});
