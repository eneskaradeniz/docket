import { describe, expect, it } from 'vitest';
import { classifyStepScope, parsePlanSteps } from '../plan-steps';
import type { StepSpec } from '../types';

// Helper: wrap a JSON body in a ```steps fence (the last fence wins; here there is only one).
const fenced = (json: string): string => `# Plan\n\nSome prose.\n\n\`\`\`steps\n${json}\n\`\`\`\n`;

describe('parsePlanSteps — degradation (returns [])', () => {
  it('returns [] for an empty string', () => {
    expect(parsePlanSteps('')).toEqual([]);
  });

  it('returns [] when no ```steps fence is present', () => {
    expect(parsePlanSteps('# Plan\n\nJust prose, no fence.')).toEqual([]);
  });

  it('returns [] when the fence body is not valid JSON', () => {
    expect(parsePlanSteps(fenced('{ not json'))).toEqual([]);
  });

  it('returns [] when the body is valid JSON but not an array', () => {
    expect(parsePlanSteps(fenced('{"role":"implementer"}'))).toEqual([]);
  });

  it('returns [] when an element role is not in the enum', () => {
    expect(parsePlanSteps(fenced('[{"role":"tester","aim":"x","scope":"app"}]'))).toEqual([]);
  });

  it('returns [] when an element aim is empty', () => {
    expect(parsePlanSteps(fenced('[{"role":"implementer","aim":"","scope":"app"}]'))).toEqual([]);
  });

  it('returns [] when an element aim is missing', () => {
    expect(parsePlanSteps(fenced('[{"role":"implementer","scope":"app"}]'))).toEqual([]);
  });

  it('returns [] when an element scope is empty', () => {
    expect(parsePlanSteps(fenced('[{"role":"implementer","aim":"x","scope":""}]'))).toEqual([]);
  });

  it('returns [] when ANY single element is malformed (no partial list)', () => {
    const md = fenced('[{"role":"implementer","aim":"ok","scope":"app"},{"role":"bad","aim":"x","scope":"app"}]');
    expect(parsePlanSteps(md)).toEqual([]);
  });
});

describe('parsePlanSteps — happy path', () => {
  it('parses a single valid implementer step with idx=1', () => {
    const out = parsePlanSteps(fenced('[{"role":"implementer","aim":"core","scope":"app"}]'));
    expect(out).toEqual<StepSpec[]>([{ idx: 1, role: 'implementer', aim: 'core', scope: { kind: 'track', ref: 'app' } }]);
  });

  it('parses a multi-step plan preserving 1-based idx order', () => {
    const md = fenced(
      '[{"role":"implementer","aim":"backend","scope":"api"},{"role":"verifier","aim":"test","scope":"all"}]',
    );
    expect(parsePlanSteps(md)).toEqual<StepSpec[]>([
      { idx: 1, role: 'implementer', aim: 'backend', scope: { kind: 'track', ref: 'api' } },
      { idx: 2, role: 'verifier', aim: 'test', scope: { kind: 'all' } },
    ]);
  });

  it('selects the LAST fence when two ```steps blocks exist', () => {
    const md =
      '```steps\n[{"role":"implementer","aim":"draft","scope":"app"}]\n```\n\nProse.\n\n```steps\n' +
      '[{"role":"verifier","aim":"final","scope":"all"}]\n```\n';
    expect(parsePlanSteps(md)).toEqual<StepSpec[]>([
      { idx: 1, role: 'verifier', aim: 'final', scope: { kind: 'all' } },
    ]);
  });

  it('tolerates a fence with no language tag mismatch and trailing whitespace after the close', () => {
    // The regex requires the ```steps opener (with the tag); the closer is a bare ``` possibly followed by ws.
    const md = '# P\n\n```steps\n[{"role":"architect","aim":"plan","scope":"all"}]\n```   \n';
    expect(parsePlanSteps(md)).toHaveLength(1);
  });
});

describe('classifyStepScope', () => {
  it('classifies "all" to {kind:"all"}', () => {
    expect(classifyStepScope('all')).toEqual({ kind: 'all' });
  });

  it('classifies "hepsi" (the mock token) to {kind:"all"}', () => {
    expect(classifyStepScope('hepsi')).toEqual({ kind: 'all' });
  });

  it('classifies "*" to {kind:"all"}', () => {
    expect(classifyStepScope('*')).toEqual({ kind: 'all' });
  });

  it('classifies an empty string to {kind:"all"}', () => {
    expect(classifyStepScope('')).toEqual({ kind: 'all' });
  });

  it('treats uppercase ALL as {kind:"all"}', () => {
    expect(classifyStepScope('ALL')).toEqual({ kind: 'all' });
  });

  it('trims whitespace before classifying', () => {
    expect(classifyStepScope('  all  ')).toEqual({ kind: 'all' });
  });

  it('classifies any other string to {kind:"track", ref} preserving original case/spacing (trimmed)', () => {
    expect(classifyStepScope('backend-svc')).toEqual({ kind: 'track', ref: 'backend-svc' });
    expect(classifyStepScope('  App  ')).toEqual({ kind: 'track', ref: 'App' });
  });
});
