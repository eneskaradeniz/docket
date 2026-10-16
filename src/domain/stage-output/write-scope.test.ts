// write-scope — R-159 of docs/v2/domain.md (#1235 addendum): the before-the-ask guard.
import { describe, expect, it } from 'vitest';

import type { WriteScope } from '../definitions/index';

import { writeScopeVerdict, type WriteScopeContext } from './write-scope';

// The run facts a real executor hands over: the work order's worktree, the run's working
// directory, and the repo's docs root and test folders.
const CONTEXT: WriteScopeContext = {
  cwd: '/wt/repo/wo-1',
  worktreeRoot: '/wt/repo/wo-1',
  docsRoot: 'docs',
  testGlobs: ['src/**/*.test.ts', 'test/**'],
};

const scopeOf = (kind: WriteScope['kind']): WriteScope =>
  kind === 'paths' ? { kind, globs: ['plans/**'] } : { kind };

const verdict = (scope: WriteScope['kind'], tool: string, target: string | undefined, context: WriteScopeContext = CONTEXT) =>
  writeScopeVerdict({ scope: scopeOf(scope), tool, target, context });

describe('writeScopeVerdict', () => {
  describe('scope none', () => {
    it('R-159: scope none denies every write tool target — no context fact is needed', () => {
      expect(verdict('none', 'Write', 'docs/note.md', {})).toEqual({ verdict: 'deny', reason: 'read-only-role' });
      expect(verdict('none', 'Edit', '/etc/passwd', {})).toEqual({ verdict: 'deny', reason: 'read-only-role' });
      // The target's location is irrelevant to a read-only role, so a ~-relative name denies too.
      expect(verdict('none', 'NotebookEdit', '~/notes.ipynb', {})).toEqual({ verdict: 'deny', reason: 'read-only-role' });
    });

    it('R-159: scope none with no target string is unchecked — it goes to the normal ask path', () => {
      expect(verdict('none', 'Write', undefined, {})).toEqual({ verdict: 'unchecked' });
    });

    it('R-159: a non-write tool is unchecked even under scope none — Bash writes indirectly', () => {
      expect(verdict('none', 'Bash', 'echo x > /etc/passwd', {})).toEqual({ verdict: 'unchecked' });
      expect(verdict('none', 'Read', '/etc/passwd', {})).toEqual({ verdict: 'unchecked' });
    });
  });

  describe('scope docs', () => {
    it('R-159: a target inside the repo docs root is unchecked — the normal path decides', () => {
      expect(verdict('docs', 'Write', 'docs/plan.md')).toEqual({ verdict: 'unchecked' });
      expect(verdict('docs', 'Edit', '/wt/repo/wo-1/docs/sub/plan.md')).toEqual({ verdict: 'unchecked' });
      expect(verdict('docs', 'Write', 'documentation/plan.md', { ...CONTEXT, docsRoot: 'documentation' })).toEqual({
        verdict: 'unchecked',
      });
      // A trailing separator on either side changes nothing.
      expect(verdict('docs', 'Write', 'docs/plan.md', { ...CONTEXT, docsRoot: 'docs/' })).toEqual({ verdict: 'unchecked' });
    });

    it('R-159: a target outside the repo docs root is denied', () => {
      expect(verdict('docs', 'Write', 'src/a.ts')).toEqual({ verdict: 'deny', reason: 'outside-docs-root' });
      expect(verdict('docs', 'Edit', '/wt/repo/wo-1/src/a.ts')).toEqual({ verdict: 'deny', reason: 'outside-docs-root' });
      // The default root never substitutes for a configured one.
      expect(verdict('docs', 'Write', 'docs/plan.md', { ...CONTEXT, docsRoot: 'documentation' })).toEqual({
        verdict: 'deny',
        reason: 'outside-docs-root',
      });
      // Outside the worktree is outside the docs root a fortiori.
      expect(verdict('docs', 'Write', '/etc/passwd')).toEqual({ verdict: 'deny', reason: 'outside-docs-root' });
      // Traversal folds before the compare, so docs/../src cannot pose as a docs write.
      expect(verdict('docs', 'Write', 'docs/../src/a.ts')).toEqual({ verdict: 'deny', reason: 'outside-docs-root' });
    });

    it('R-159: docs is undecidable without the docs root, the worktree, the target or the cwd', () => {
      const { docsRoot: _docsRoot, ...withoutDocsRoot } = CONTEXT;
      expect(verdict('docs', 'Write', 'docs/plan.md', withoutDocsRoot)).toEqual({ verdict: 'unchecked' });
      const { worktreeRoot: _worktreeRoot, ...withoutWorktree } = CONTEXT;
      expect(verdict('docs', 'Write', 'docs/plan.md', withoutWorktree)).toEqual({ verdict: 'unchecked' });
      expect(verdict('docs', 'Write', undefined)).toEqual({ verdict: 'unchecked' });
      // A relative target with no cwd to resolve against cannot be located.
      const { cwd: _cwd, ...withoutCwd } = CONTEXT;
      expect(verdict('docs', 'Write', 'docs/plan.md', withoutCwd)).toEqual({ verdict: 'unchecked' });
    });
  });

  describe('scope repo', () => {
    it('R-159: a target inside the work order worktree is unchecked', () => {
      expect(verdict('repo', 'Write', '/wt/repo/wo-1/src/a.ts')).toEqual({ verdict: 'unchecked' });
      expect(verdict('repo', 'Edit', 'src/a.ts')).toEqual({ verdict: 'unchecked' });
      expect(verdict('repo', 'Write', '/wt/repo/wo-1')).toEqual({ verdict: 'unchecked' });
      expect(verdict('repo', 'Write', 'src/a.ts', { ...CONTEXT, worktreeRoot: '/wt/repo/wo-1/' })).toEqual({
        verdict: 'unchecked',
      });
    });

    it('R-159: a target outside the worktree is denied', () => {
      expect(verdict('repo', 'Write', '/etc/passwd')).toEqual({ verdict: 'deny', reason: 'outside-worktree' });
      expect(verdict('repo', 'Edit', '/wt/repo/other/x.ts')).toEqual({ verdict: 'deny', reason: 'outside-worktree' });
      // ..-escape folds away the worktree prefix.
      expect(verdict('repo', 'Write', '../outside/x.ts')).toEqual({ verdict: 'deny', reason: 'outside-worktree' });
      expect(verdict('repo', 'Write', 'src/../../outside/x.ts')).toEqual({ verdict: 'deny', reason: 'outside-worktree' });
    });

    it('R-159: repo is undecidable without the worktree fact, a cwd for relative targets, or on ~', () => {
      // Even an absolute-looking outside target cannot be judged without the boundary.
      const { worktreeRoot: _worktreeRoot, ...withoutWorktree } = CONTEXT;
      expect(verdict('repo', 'Write', '/etc/passwd', withoutWorktree)).toEqual({ verdict: 'unchecked' });
      const { cwd: _cwd, ...withoutCwd } = CONTEXT;
      expect(verdict('repo', 'Write', 'src/a.ts', withoutCwd)).toEqual({ verdict: 'unchecked' });
      // ~ is never expanded; where the shell would take it is a fact the string does not carry.
      expect(verdict('repo', 'Write', '~/x.ts')).toEqual({ verdict: 'unchecked' });
    });
  });

  describe('scope tests', () => {
    it('R-159: the repo listed test folders decide — inside is unchecked, outside is denied', () => {
      expect(verdict('tests', 'Write', 'src/a.test.ts')).toEqual({ verdict: 'unchecked' });
      expect(verdict('tests', 'Edit', '/wt/repo/wo-1/test/helper.ts')).toEqual({ verdict: 'unchecked' });
      expect(verdict('tests', 'Write', 'src/a.ts')).toEqual({ verdict: 'deny', reason: 'outside-test-folders' });
      expect(verdict('tests', 'Write', '/etc/passwd')).toEqual({ verdict: 'deny', reason: 'outside-test-folders' });
    });

    it('R-159: a repo that lists no test folders is unchecked — absent and empty alike', () => {
      const { testGlobs: _testGlobs, ...withoutGlobs } = CONTEXT;
      expect(verdict('tests', 'Write', 'src/a.ts', withoutGlobs)).toEqual({ verdict: 'unchecked' });
      expect(verdict('tests', 'Write', 'src/a.ts', { ...CONTEXT, testGlobs: [] })).toEqual({ verdict: 'unchecked' });
    });

    it('R-159: tests is undecidable without the worktree fact or a cwd for relative targets', () => {
      const { worktreeRoot: _worktreeRoot, ...withoutWorktree } = CONTEXT;
      expect(verdict('tests', 'Write', 'src/a.test.ts', withoutWorktree)).toEqual({ verdict: 'unchecked' });
      const { cwd: _cwd, ...withoutCwd } = CONTEXT;
      expect(verdict('tests', 'Write', 'src/a.test.ts', withoutCwd)).toEqual({ verdict: 'unchecked' });
    });
  });

  it('R-159: MultiEdit and NotebookEdit are judged like the other write tools', () => {
    expect(verdict('repo', 'MultiEdit', '/etc/passwd')).toEqual({ verdict: 'deny', reason: 'outside-worktree' });
    expect(verdict('none', 'MultiEdit', 'src/a.ts', {})).toEqual({ verdict: 'deny', reason: 'read-only-role' });
    expect(verdict('docs', 'NotebookEdit', 'src/nb.ipynb')).toEqual({ verdict: 'deny', reason: 'outside-docs-root' });
    expect(verdict('repo', 'MultiEdit', 'src/a.ts')).toEqual({ verdict: 'unchecked' });
  });

  it('R-159: a paths scope is unchecked — the guard judges the four contracted kinds only', () => {
    expect(verdict('paths', 'Write', '/etc/passwd')).toEqual({ verdict: 'unchecked' });
    expect(verdict('paths', 'Write', 'plans/plan.md')).toEqual({ verdict: 'unchecked' });
  });
});
