import { describe, expect, it } from 'vitest';
import type { ProviderCapabilities, Tri } from './capabilities';
import { supportTier } from './capabilities';

const capsOf = (over: Partial<ProviderCapabilities>): ProviderCapabilities => ({
  structuredStream: false,
  permissionAsk: 'unknown',
  resume: 'unknown',
  mcp: 'unknown',
  hooks: 'unknown',
  skills: 'unknown',
  images: 'unknown',
  quotaReport: 'none',
  costReport: 'none',
  ...over,
});

describe('supportTier', () => {
  it('R-43: structured stream plus a real permission ask is full', () => {
    const caps = capsOf({ structuredStream: true, permissionAsk: true });
    expect(supportTier(caps)).toBe('full');
  });

  it("R-43: structured stream with permissionAsk 'unknown' is isolated (acceptance)", () => {
    const caps = capsOf({ structuredStream: true, permissionAsk: 'unknown' });
    expect(supportTier(caps)).toBe('isolated');
  });

  it('R-43: structured stream with permissionAsk false is isolated', () => {
    const caps = capsOf({ structuredStream: true, permissionAsk: false });
    expect(supportTier(caps)).toBe('isolated');
  });

  it('R-43: no structured stream is experimental for every permission ask value', () => {
    const asks: readonly Tri[] = [true, false, 'unknown'];
    for (const permissionAsk of asks) {
      expect(supportTier(capsOf({ structuredStream: false, permissionAsk }))).toBe('experimental');
    }
  });

  it('R-43: only stream and permission ask decide the tier — every other field is ignored', () => {
    const tiers: readonly SupportTierInput[] = [
      { structuredStream: true, permissionAsk: true },
      { structuredStream: true, permissionAsk: false },
      { structuredStream: true, permissionAsk: 'unknown' },
      { structuredStream: false, permissionAsk: true },
      { structuredStream: false, permissionAsk: false },
      { structuredStream: false, permissionAsk: 'unknown' },
    ];
    const tris: readonly Tri[] = [true, false, 'unknown'];
    for (const base of tiers) {
      const expected = supportTier(capsOf(base));
      for (const resume of tris) {
        for (const mcp of tris) {
          for (const hooks of tris) {
            for (const skills of tris) {
              for (const images of tris) {
                for (const quotaReport of ['stream', 'query', 'error_only', 'none'] as const) {
                  for (const costReport of ['reported', 'computed', 'equivalent', 'none'] as const) {
                    const caps = capsOf({ ...base, resume, mcp, hooks, skills, images, quotaReport, costReport });
                    expect(supportTier(caps)).toBe(expected);
                  }
                }
              }
            }
          }
        }
      }
    }
  });

  it('does not mutate its input', () => {
    const caps = capsOf({ structuredStream: true, permissionAsk: true });
    const snapshot = structuredClone(caps);
    supportTier(caps);
    expect(caps).toEqual(snapshot);
  });

  it('works on a deeply frozen input', () => {
    const caps: ProviderCapabilities = Object.freeze(
      capsOf({ structuredStream: true, permissionAsk: true }),
    );
    expect(supportTier(caps)).toBe('full');
  });
});

type SupportTierInput = Pick<ProviderCapabilities, 'structuredStream' | 'permissionAsk'>;
