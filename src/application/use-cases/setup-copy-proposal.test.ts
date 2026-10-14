import { describe, expect, it, vi } from 'vitest';

import type { Actor } from '../../domain/index';
import { parseSlug } from '../../domain/index';
import { createFakeDefinitionStore, createFakeDeps, createFakeGitProbe, createFakeRepoScanner } from '../ports/fakes';
import { defaultSetupAnswers } from './setup';
import { setupApply, setupCopyProposal } from './setup-copy-proposal';

const ACTOR: Actor = { kind: 'user', id: 'u-1' };
const project = parseSlug<'project'>('atolye');
const source = parseSlug<'repo'>('atolye');
const other = parseSlug<'repo'>('other');
if (!project.ok || !source.ok || !other.ok) throw new Error('slug');

const REPO_PATH = '/work/acme';

const readyApplyDeps = () => {
  const git = createFakeGitProbe();
  git.markWorkTree(REPO_PATH);
  const definitions = createFakeDefinitionStore();
  const scanner = createFakeRepoScanner();
  const detect = vi.fn(async () => ({ docsRoot: 'documentation', testGlobs: ['**/*.spec.ts'] }));
  const deps = createFakeDeps({
    git,
    definitions,
    readFingerprint: async (path) => (path === REPO_PATH ? { rootCommit: 'abc' } : undefined),
    repoScanner: { ...scanner, detect },
  });
  void deps.projects.save({ id: project.value, name: 'Atölye', repos: [] });
  return { deps, definitions, detect };
};

const validAnswers = (repoSlug: string) =>
  defaultSetupAnswers('Atölye', repoSlug);

describe('setupCopyProposal', () => {
  it('A-383: source_not_in_project when the source slug is not in the project', async () => {
    const git = createFakeGitProbe(['/tmp/new']);
    const deps = createFakeDeps({ git });
    await deps.projects.save({ id: project.value, name: 'Atölye', repos: [source.value] });
    const result = await setupCopyProposal(deps, { project: project.value, source: other.value, path: '/tmp/new' });
    expect(result).toEqual({ ok: false, error: 'source_not_in_project' });
  });

  it('A-383: not_a_git_repo when the target path is not a work tree', async () => {
    const deps = createFakeDeps();
    await deps.projects.save({ id: project.value, name: 'Atölye', repos: [source.value] });
    const result = await setupCopyProposal(deps, { project: project.value, source: source.value, path: '/tmp/nogit' });
    expect(result).toEqual({ ok: false, error: 'not_a_git_repo' });
  });
});

describe('setupApply', () => {
  it('A-387: not_found when the project does not exist', async () => {
    const git = createFakeGitProbe();
    git.markWorkTree(REPO_PATH);
    const deps = createFakeDeps({
      git,
      readFingerprint: async (path) => (path === REPO_PATH ? { rootCommit: 'abc' } : undefined),
      repoScanner: createFakeRepoScanner(),
    });
    const missing = await setupApply(deps, {
      project: project.value,
      path: REPO_PATH,
      answers: validAnswers('acme'),
      actor: ACTOR,
    });
    expect(missing).toEqual({ ok: false, error: 'not_found' });
  });

  it('A-387: folder_not_found when the path does not exist on disk', async () => {
    const { deps } = readyApplyDeps();
    const result = await setupApply(deps, {
      project: project.value,
      path: '/missing/acme',
      answers: validAnswers('acme'),
      actor: ACTOR,
    });
    expect(result).toEqual({ ok: false, error: 'folder_not_found' });
  });

  it('A-387: not_a_git_repo when the folder is not a work tree', async () => {
    const { deps } = readyApplyDeps();
    const path = '/work/plain';
    const result = await setupApply(deps, {
      project: project.value,
      path,
      answers: validAnswers('plain'),
      actor: ACTOR,
    });
    expect(result).toEqual({ ok: false, error: 'folder_not_found' });
    const git = createFakeGitProbe();
    const withFolder = createFakeDeps({
      git,
      readFingerprint: async (p) => (p === path ? { rootCommit: 'x' } : undefined),
      repoScanner: createFakeRepoScanner(),
    });
    await withFolder.projects.save({ id: project.value, name: 'Atölye', repos: [] });
    const nogit = await setupApply(withFolder, {
      project: project.value,
      path,
      answers: validAnswers('plain'),
      actor: ACTOR,
    });
    expect(nogit).toEqual({ ok: false, error: 'not_a_git_repo' });
  });

  it('A-387: rebuilds the proposal from the path and ignores a hand-crafted repo id and docs root', async () => {
    const { deps, definitions, detect } = readyApplyDeps();
    const base = validAnswers('evil-id') as {
      project: { name: string; repos: string[] };
      repo: Record<string, unknown>;
      warnings: unknown[];
      differsFromRecommended: string[];
    };
    const crafted = {
      ...base,
      repo: { ...base.repo, docsRoot: 'crafted', testGlobs: ['crafted'] },
    };
    const result = await setupApply(deps, {
      project: project.value,
      path: REPO_PATH,
      answers: crafted,
      actor: ACTOR,
    });
    expect(result).toEqual({ ok: true });
    expect(detect).toHaveBeenCalledWith(REPO_PATH);
    const repoFile = await definitions.readFile('repos/acme/repo.yaml');
    expect(repoFile?.content).toContain('"docsRoot": "documentation"');
    expect(repoFile?.content).not.toContain('evil-id');
  });

  it('A-387: applying the same path twice is ok and writes nothing the second time', async () => {
    const { deps, definitions } = readyApplyDeps();
    const writeSpy = vi.spyOn(definitions, 'writeFile');
    const saveSpy = vi.spyOn(deps.projects, 'save');
    const first = await setupApply(deps, {
      project: project.value,
      path: REPO_PATH,
      answers: validAnswers('acme'),
      actor: ACTOR,
    });
    expect(first).toEqual({ ok: true });
    const writesAfterFirst = writeSpy.mock.calls.length;
    const savesAfterFirst = saveSpy.mock.calls.length;
    const second = await setupApply(deps, {
      project: project.value,
      path: REPO_PATH,
      answers: validAnswers('wrong'),
      actor: ACTOR,
    });
    expect(second).toEqual({ ok: true });
    expect(writeSpy.mock.calls.length).toBe(writesAfterFirst);
    expect(saveSpy.mock.calls.length).toBe(savesAfterFirst);
  });

  it('A-387: writes nothing when a folder check fails', async () => {
    const { deps, definitions } = readyApplyDeps();
    const writeSpy = vi.spyOn(definitions, 'writeFile');
    const saveSpy = vi.spyOn(deps.projects, 'save');
    await setupApply(deps, {
      project: project.value,
      path: '/gone/acme',
      answers: validAnswers('acme'),
      actor: ACTOR,
    });
    expect(writeSpy).not.toHaveBeenCalled();
    expect(saveSpy).not.toHaveBeenCalled();
  });
});
