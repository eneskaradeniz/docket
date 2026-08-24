import { describe, expect, it } from 'vitest';
import { classifyStepScope, moveStep, parsePlanSteps, splitStepsFence } from '../plan-steps';
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

// WO-0031d tur-2 — the fence never renders raw: documents show the PROSE plus a card summary.
// splitStepsFence gives both halves; a malformed fence body still strips the block (the raw JSON is
// banned from the screen either way) and degrades to steps: [] like parsePlanSteps.
describe('splitStepsFence (WO-0031d tur-2)', () => {
  const PLAN = '# Hedef\n\nProse paragraph.\n\n```steps\n[{"role":"implementer","aim":"a","scope":"all"}]\n```\n\nSon söz.\n';

  it('splits prose from the fence; steps parse; the fence text is gone from the prose', () => {
    const { prose, steps } = splitStepsFence(PLAN);
    expect(prose).toContain('# Hedef');
    expect(prose).toContain('Son söz.');
    expect(prose).not.toContain('```steps');
    expect(prose).not.toContain('"role"');
    expect(steps).toHaveLength(1);
  });

  it('no fence → prose unchanged, steps []', () => {
    const { prose, steps } = splitStepsFence('# Sadece prose\n');
    expect(prose).toBe('# Sadece prose\n');
    expect(steps).toEqual([]);
  });

  it('a malformed fence body still strips the block and degrades to []', () => {
    const { prose, steps } = splitStepsFence('Önce.\n\n```steps\nnot-json\n```\n\nSonra.\n');
    expect(prose).toContain('Önce.');
    expect(prose).toContain('Sonra.');
    expect(prose).not.toContain('```steps');
    expect(steps).toEqual([]);
  });

  // 2026-08-23 (operator ruling, "boş başlığı da sök"): a trailing "## Steps" heading whose ONLY
  // content was the fence is a dangling stump in the document view — the steps render as the
  // PLAN HAZIR rows above, so the prose ends at its last real paragraph. A heading that still
  // carries text after the fence is a real section and stays.
  it('strips a trailing ## Steps heading whose only content was the fence', () => {
    const md = '# Hedef\n\nKapılar koşulur.\n\n## Steps\n\n```steps\n[{"role":"implementer","aim":"a","scope":"all"}]\n```\n';
    const { prose } = splitStepsFence(md);
    expect(prose.endsWith('Kapılar koşulur.')).toBe(true);
    expect(prose).not.toContain('Steps');
  });

  it('KEEPS the heading when text follows the fence — the section is not empty', () => {
    const md = '## Steps\n\n```steps\n[{"role":"implementer","aim":"a","scope":"all"}]\n```\n\nSon söz.\n';
    const { prose } = splitStepsFence(md);
    expect(prose).toContain('## Steps');
    expect(prose).toContain('Son söz.');
  });
});

// 2026-08-23 (operator: drag-and-drop reordering): the pure move the editor's drag end calls —
// the arrow-button onMove(dir) died with the arrows; this is order-based (from → to), renumbering
// the 1-based idx after every move.
describe('moveStep (drag-and-drop reorder)', () => {
  const spec = (idx: number, aim: string): StepSpec => ({ idx, role: 'implementer', aim, scope: { kind: 'all' } });
  const three = (): StepSpec[] => [spec(1, 'bir'), spec(2, 'iki'), spec(3, 'üç')];

  it('moves down and renumbers (1 → 3): iki bir üç', () => {
    const out = moveStep(three(), 0, 2);
    expect(out.map((s) => s.aim)).toEqual(['iki', 'üç', 'bir']);
    expect(out.map((s) => s.idx)).toEqual([1, 2, 3]);
  });

  it('moves up and renumbers (3 → 1): üç bir iki', () => {
    const out = moveStep(three(), 2, 0);
    expect(out.map((s) => s.aim)).toEqual(['üç', 'bir', 'iki']);
    expect(out.map((s) => s.idx)).toEqual([1, 2, 3]);
  });

  it('no-op on same index or out-of-bounds (the list object identity survives)', () => {
    const steps = three();
    expect(moveStep(steps, 1, 1)).toBe(steps);
    expect(moveStep(steps, -1, 0)).toBe(steps);
    expect(moveStep(steps, 0, 3)).toBe(steps);
    expect(moveStep(steps, 3, 0)).toBe(steps);
  });
});
