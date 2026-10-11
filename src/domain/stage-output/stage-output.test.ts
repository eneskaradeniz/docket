import { describe, expect, it } from 'vitest';

import { stageOutputScopeRoot, stageOutputVerdict, type StageOutputInput } from './index';

const docs = (over: Partial<StageOutputInput> = {}): StageOutputInput => ({
  writeScope: { kind: 'docs' },
  changed: [],
  runOutcome: 'completed',
  ...over,
});

describe('stageOutputVerdict', () => {
  it('R-123: docs scope with a changed docs/… path is ok', () => {
    expect(stageOutputVerdict(docs({ changed: ['docs/plan.md'] }))).toBe('ok');
    expect(stageOutputVerdict(docs({ changed: ['src/a.ts', 'docs/plan.md'] }))).toBe('ok');
    expect(stageOutputVerdict(docs({ changed: ['docs'] }))).toBe('ok');
  });

  it('R-123: only a changed path outside the scope is no_output', () => {
    expect(stageOutputVerdict(docs({ changed: ['src/main.ts'] }))).toBe('no_output');
    expect(stageOutputVerdict(docs({ changed: ['docs-extra/plan.md'] }))).toBe('no_output');
  });

  it('R-123: no changed path is no_output', () => {
    expect(stageOutputVerdict(docs())).toBe('no_output');
  });

  it('R-123: no write scope is not_applicable', () => {
    expect(stageOutputVerdict(docs({ writeScope: { kind: 'none' }, changed: [] }))).toBe('not_applicable');
    expect(stageOutputVerdict(docs({ writeScope: { kind: 'none' }, changed: ['docs/plan.md'] }))).toBe('not_applicable');
  });

  it('R-123: a non-completed outcome is not_applicable', () => {
    for (const runOutcome of ['failed', 'cancelled', 'limit'] as const) {
      expect(stageOutputVerdict(docs({ runOutcome, changed: [] }))).toBe('not_applicable');
    }
  });

  it('R-123: tests and paths are judged; the whole-worktree repo scope is not', () => {
    expect(
      stageOutputVerdict({
        writeScope: { kind: 'tests' },
        changed: ['src/app.test.ts'],
        runOutcome: 'completed',
        testGlobs: ['src/**/*.test.ts'],
      }),
    ).toBe('ok');
    expect(
      stageOutputVerdict({
        writeScope: { kind: 'tests' },
        changed: ['docs/plan.md'],
        runOutcome: 'completed',
        testGlobs: ['src/**/*.test.ts'],
      }),
    ).toBe('no_output');
    expect(
      stageOutputVerdict({
        writeScope: { kind: 'paths', globs: ['src/**'] },
        changed: ['src/main.ts'],
        runOutcome: 'completed',
      }),
    ).toBe('ok');
    expect(
      stageOutputVerdict({
        writeScope: { kind: 'paths', globs: ['src/**'] },
        changed: ['docs/plan.md'],
        runOutcome: 'completed',
      }),
    ).toBe('no_output');
    expect(stageOutputVerdict(docs({ writeScope: { kind: 'repo' }, changed: [] }))).toBe('not_applicable');
  });

  it('R-123: the verdict is pure — the changed list is not mutated', () => {
    const changed = ['src/a.ts', 'docs/plan.md'];
    const snapshot = [...changed];
    expect(stageOutputVerdict(docs({ changed }))).toBe('ok');
    expect(changed).toEqual(snapshot);
  });

  it('R-124: the verdict never depends on path order', () => {
    const paths = ['src/a.ts', 'docs/plan.md', 'README.md'];
    const forward = stageOutputVerdict(docs({ changed: paths }));
    const backward = stageOutputVerdict(docs({ changed: [...paths].reverse() }));
    expect(forward).toBe('ok');
    expect(backward).toBe(forward);
  });

  it('R-124: docs/../src/x is outside the docs scope', () => {
    expect(stageOutputVerdict(docs({ changed: ['docs/../src/x'] }))).toBe('no_output');
    expect(stageOutputVerdict(docs({ changed: ['docs/../src/x', 'README.md'] }))).toBe('no_output');
    expect(stageOutputVerdict(docs({ changed: ['docs/plan.md', 'docs/../src/x'] }))).toBe('ok');
  });

  it('R-124: a custom docs root uses the same containment', () => {
    expect(stageOutputVerdict(docs({ docsRoot: 'documentation', changed: ['documentation/plan.md'] }))).toBe('ok');
    expect(stageOutputVerdict(docs({ docsRoot: 'documentation', changed: ['docs/plan.md'] }))).toBe('no_output');
    expect(stageOutputScopeRoot({ kind: 'docs' }, 'documentation', undefined)).toBe('documentation');
    expect(stageOutputScopeRoot({ kind: 'docs' }, undefined, undefined)).toBe('docs');
    expect(stageOutputScopeRoot({ kind: 'none' }, 'docs', undefined)).toBeUndefined();
  });
});
