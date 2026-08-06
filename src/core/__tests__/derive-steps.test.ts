import { describe, expect, it } from 'vitest';
import { deriveSteps } from '../derive';
import type { ObservedStep } from '../derive';
import type { StepSpec, StepView } from '../types';

const allSpec: StepSpec = { idx: 1, role: 'implementer', aim: 'core', scope: { kind: 'all' } };
const trackSpec: StepSpec = { idx: 2, role: 'verifier', aim: 'test', scope: { kind: 'track', ref: 'app' } };

describe('deriveSteps', () => {
  it('a spec with no observed row is pending (all scope)', () => {
    const out = deriveSteps([allSpec], new Map<number, ObservedStep>());
    expect(out).toEqual<StepView[]>([{ idx: 1, role: 'implementer', aim: 'core', scope: { kind: 'all' }, status: 'pending' }]);
  });

  it('an all-scope step with a run row is done and carries its reportPath', () => {
    const observed = new Map<number, ObservedStep>([[1, { status: 'done', reportPath: 'reports/step-01-implementer.md' }]]);
    const out = deriveSteps([allSpec], observed);
    expect(out[0]!.status).toBe('done');
    expect(out[0]!.reportPath).toBe('reports/step-01-implementer.md');
    // 'all' scope never sets scopeTrackId.
    expect(out[0]!.scopeTrackId).toBeUndefined();
  });

  it('a track-scoped step whose ref matched no track is blocked', () => {
    const observed = new Map<number, ObservedStep>([[2, { scopeTrackId: undefined }]]);
    const out = deriveSteps([trackSpec], observed);
    expect(out[0]!.status).toBe('blocked');
    expect(out[0]!.scopeTrackId).toBeUndefined();
  });

  it('a track-scoped step with no resolution entry is also blocked (conservative default)', () => {
    const out = deriveSteps([trackSpec], new Map<number, ObservedStep>());
    expect(out[0]!.status).toBe('blocked');
  });

  it('an all-scope step is never blocked even with no entry', () => {
    const out = deriveSteps([allSpec], new Map<number, ObservedStep>());
    expect(out[0]!.status).not.toBe('blocked');
  });

  it('preserves 1-based idx order across a multi-step plan', () => {
    const out = deriveSteps([allSpec, trackSpec], new Map<number, ObservedStep>());
    expect(out.map((s) => s.idx)).toEqual([1, 2]);
    expect(out.map((s) => s.role)).toEqual(['implementer', 'verifier']);
  });

  it('is pure pass-through — it does not construct a TrackId (scopeTrackId stays undefined when not given)', () => {
    // Core never brands; the resolved scopeTrackId is provided by the adapter. Passing undefined through
    // unchanged is the contract this asserts (a constructed id here would be an ADR-0003 violation).
    const out = deriveSteps([allSpec], new Map<number, ObservedStep>([[1, { status: 'done' }]]));
    expect(out[0]!.scopeTrackId).toBeUndefined();
  });
});
