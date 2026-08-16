import { describe, expect, it } from 'vitest';
import { applyStepEdits, parsePlanSteps } from '../plan-steps';
import type { StepSpec } from '../types';

// WO-0031c — pre-approval plan EDITING: the operator reorders/edits steps on the cards; the edit
// rewrites the LAST ```steps fence body and leaves every other line of the plan alone. Approving the
// result is the same approvePlan call (an "düzenlenmiş onay").
const plan = [
  '# The plan',
  '',
  'Approach prose stays.',
  '',
  '```steps',
  '[',
  '  { "role": "implementer", "aim": "first", "scope": "all" },',
  '  { "role": "verifier", "aim": "check", "scope": "all" }',
  ']',
  '```',
  '',
  'After prose stays too.',
].join('\n');

describe('applyStepEdits (WO-0031c)', () => {
  it('round-trips: parse(apply(parse(md), steps)) deep-equals the edited steps', () => {
    const edited: StepSpec[] = [
      { idx: 1, role: 'implementer', aim: 'renamed', scope: { kind: 'all' } },
      { idx: 2, role: 'architect', aim: 'review it', scope: { kind: 'track', ref: 'app' } },
      { idx: 3, role: 'verifier', aim: 'added step', scope: { kind: 'all' } },
    ];
    const out = applyStepEdits(plan, edited);
    expect(parsePlanSteps(out)).toEqual(edited);
  });

  it('reorders (the ▲▼ outcome) without touching prose', () => {
    const [a, b] = parsePlanSteps(plan);
    const out = applyStepEdits(plan, [b!, a!]);
    expect(parsePlanSteps(out).map((s) => s.aim)).toEqual(['check', 'first']);
    expect(out).toContain('Approach prose stays.');
    expect(out).toContain('After prose stays too.');
  });

  it('removes a step (min-1 is the UI\'s rule; core obeys the list it is given)', () => {
    const out = applyStepEdits(plan, [parsePlanSteps(plan)[0]!]);
    expect(parsePlanSteps(out)).toHaveLength(1);
  });

  it('no fence → returned unchanged (the caller guards: editing needs a parsed plan)', () => {
    const noFence = '# Plan\n\nNo steps block.\n';
    expect(applyStepEdits(noFence, [])).toBe(noFence);
  });

  it('serializes compactly — one object per line, role/aim/scope key order', () => {
    const out = applyStepEdits(plan, [{ idx: 1, role: 'implementer', aim: 'x', scope: { kind: 'all' } }]);
    expect(out).toContain('{"role":"implementer","aim":"x","scope":"all"}');
  });
});
