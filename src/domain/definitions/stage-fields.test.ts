// definitions/stage-fields.test.ts — R-51: a stage's tier, thinking and reviewOf.
import { describe, expect, it } from 'vitest';
import { validateDefinitions, type DefinitionIssue, type Definitions } from './index';

type Obj = Record<string, unknown>;

const role = (id: string, over: Obj = {}): Obj => ({
  id,
  name: id,
  instructions: 'Do the work.',
  writeScope: { kind: 'repo' },
  capabilities: [],
  active: true,
  ...over,
});

const stage = (id: string, over: Obj = {}): Obj => ({ id, name: id, role: 'dev', exit: [], ...over });

const doc = (stages: Obj[]): Obj => ({
  roles: [role('dev'), role('reviewer')],
  flows: [{ id: 'main', name: 'Main', stages }],
  capabilities: [],
});

const issuesOf = (input: Obj): readonly DefinitionIssue[] => {
  const result = validateDefinitions(input);
  if (result.ok) throw new Error('expected issues');
  return result.error;
};

const valueOf = (input: Obj): Definitions => {
  const result = validateDefinitions(input);
  if (!result.ok) throw new Error(`expected ok: ${JSON.stringify(result.error)}`);
  return result.value;
};

describe('R-51 stage tier, thinking and reviewOf', () => {
  it('R-51: valid tier, thinking and reviewOf land on the StageDef', () => {
    const defs = valueOf(
      doc([
        stage('implement'),
        stage('review', { role: 'reviewer', tier: 'strong', thinking: { level: 'deep' }, reviewOf: 'implement' }),
        stage('audit', { role: 'reviewer', thinking: { effort: 'xhigh' } }),
      ]),
    );
    const stages = defs.flows[0]?.stages ?? [];
    expect(stages[1]).toMatchObject({ tier: 'strong', thinking: { level: 'deep' }, reviewOf: 'implement' });
    expect(stages[2]?.thinking).toEqual({ effort: 'xhigh' });
    expect(stages[0]).not.toHaveProperty('tier');
    expect(stages[0]).not.toHaveProperty('reviewOf');
  });

  it('R-51: reviewOf naming an unknown stage is bad_review_of', () => {
    const issues = issuesOf(doc([stage('implement'), stage('review', { reviewOf: 'ghost' })]));
    expect(issues).toEqual([{ path: 'flows[0].stages[1].reviewOf', code: 'bad_review_of', message: expect.any(String) }]);
  });

  it('R-51: reviewOf itself or a later stage is bad_review_of', () => {
    const self = issuesOf(doc([stage('implement'), stage('review', { reviewOf: 'review' })]));
    expect(self.map((i) => i.code)).toEqual(['bad_review_of']);
    const later = issuesOf(doc([stage('review', { reviewOf: 'implement' }), stage('implement')]));
    expect(later.map((i) => i.code)).toEqual(['bad_review_of']);
  });

  it('R-51: reviewOf a human-only stage (null role) is bad_review_of', () => {
    const issues = issuesOf(doc([stage('staging', { role: null }), stage('review', { reviewOf: 'staging' })]));
    expect(issues.map((i) => i.code)).toEqual(['bad_review_of']);
  });

  it('R-51: an invalid reviewOf slug is invalid_slug, a non-string is wrong_type', () => {
    expect(issuesOf(doc([stage('a'), stage('b', { reviewOf: 'Bad Slug' })])).map((i) => i.code)).toEqual(['invalid_slug']);
    expect(issuesOf(doc([stage('a'), stage('b', { reviewOf: 3 })])).map((i) => i.code)).toEqual(['wrong_type']);
  });

  it('R-51: a tier outside strong/balanced/fast is wrong_type', () => {
    for (const tier of ['huge', 3, null]) {
      const issues = issuesOf(doc([stage('a', { tier })]));
      expect(issues).toEqual([{ path: 'flows[0].stages[0].tier', code: 'wrong_type', message: expect.any(String) }]);
    }
  });

  it('R-51: thinking must be a level or an effort, nothing else', () => {
    for (const thinking of ['deep', { level: 'ultra' }, { effort: 'huge' }, {}, { level: 'deep', effort: 'low' }, 4]) {
      const issues = issuesOf(doc([stage('a', { thinking })]));
      expect(issues).toEqual([{ path: 'flows[0].stages[0].thinking', code: 'wrong_type', message: expect.any(String) }]);
    }
    for (const effort of ['none', 'minimal', 'low', 'medium', 'high', 'xhigh', 'max', 'ultra']) {
      expect(validateDefinitions(doc([stage('a', { thinking: { effort } })])).ok).toBe(true);
    }
  });
});
