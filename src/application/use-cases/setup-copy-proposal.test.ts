import { describe, expect, it, vi } from 'vitest';

import type { Actor, RepoDef, RepoFlow } from '../../domain/index';
import { BUILTIN_FLOWS, BUILTIN_ROLES, parseSlug, validateDefinitions } from '../../domain/index';
import { createFakeCapabilityCatalog, createFakeDefinitionStore, createFakeDeps, createFakeGitProbe, createFakeRepoScanner } from '../ports/fakes';
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

  it('P-66: a bridge-channel account with a binding whose role opts out of the Docket tools warns in the proposal', async () => {
    const git = createFakeGitProbe();
    git.markWorkTree(REPO_PATH);
    const definitions = createFakeDefinitionStore();
    await definitions.installBuiltins({ roles: BUILTIN_ROLES, flows: BUILTIN_FLOWS });
    const standard = BUILTIN_FLOWS[0];
    if (standard === undefined) throw new Error('builtin flow missing');
    // One stage's role opts out of the Docket tools through an overlay; the rest keep them, so
    // exactly the bridge-without-tools stage warns.
    const sourceRepo: RepoDef = {
      id: source.value,
      name: 'Atölye',
      defaultLimitPolicy: 'wait_resume',
      commandSets: { tests: ['npm test'] },
      docsRoot: 'docs',
      testGlobs: ['**/*.test.ts'],
      flow: {
        flowId: standard.id,
        version: 1,
        stages: standard.stages,
        bindings: standard.stages.map((stage) => ({
          stage: stage.id,
          ...(stage.role === null
            ? {}
            : {
                role: {
                  roleId: stage.role,
                  version: 1,
                  ...(stage.id === 'implement' ? { overlay: { docketTools: false } } : {}),
                },
              }),
          accounts: [],
        })),
      },
    };
    definitions.setRepoDef(source.value, sourceRepo);
    const deps = createFakeDeps({
      git,
      definitions,
      capabilities: createFakeCapabilityCatalog([], [], [
        {
          provider: 'fixture-bridge',
          channel: 'bridge',
          how: 'headless fixture-bridge cannot ask: command, MCP and write calls are denied without a prompt',
        },
      ]),
      repoScanner: { ...createFakeRepoScanner(), detect: async () => ({ docsRoot: 'docs', testGlobs: ['**/*.test.ts'] }) },
    });
    await deps.projects.save({ id: project.value, name: 'Atölye', repos: [source.value] });
    await deps.repos.register({ repoId: 'r-1', slug: source.value, path: '/work/atolye', fingerprint: { rootCommit: 'abc' } });
    const accountId = parseSlug<'account'>('a-1');
    if (!accountId.ok) throw new Error('accountId');
    await deps.accounts.save({
      id: accountId.value,
      provider: 'fixture-bridge',
      label: 'Köprü',
      authMode: 'subscription',
      limitPolicy: 'wait_resume',
      caps: [],
    });
    const result = await setupCopyProposal(deps, { project: project.value, source: source.value, path: REPO_PATH });
    if (!result.ok) throw new Error(`setup failed: ${JSON.stringify(result)}`);
    expect(result.ok).toBe(true);
    expect(result.value.warnings).toEqual([
      {
        stage: 'implement',
        provider: 'fixture-bridge',
        kind: 'no_permission_channel',
        how: 'headless fixture-bridge cannot ask: command, MCP and write calls are denied without a prompt',
      },
    ]);
  });

  it('P-68: an account provider whose installed CLI drifted past the measured version warns per stage, informationally', async () => {
    const git = createFakeGitProbe();
    git.markWorkTree(REPO_PATH);
    const definitions = createFakeDefinitionStore();
    await definitions.installBuiltins({ roles: BUILTIN_ROLES, flows: BUILTIN_FLOWS });
    const standard = BUILTIN_FLOWS[0];
    if (standard === undefined) throw new Error('builtin flow missing');
    const sourceRepo: RepoDef = {
      id: source.value,
      name: 'Atölye',
      defaultLimitPolicy: 'wait_resume',
      commandSets: { tests: ['npm test'] },
      docsRoot: 'docs',
      testGlobs: ['**/*.test.ts'] as readonly string[],
      flow: {
        flowId: standard.id,
        version: 1,
        stages: standard.stages,
        bindings: standard.stages.map((stage) => ({
          stage: stage.id,
          ...(stage.role === null ? {} : { role: { roleId: stage.role, version: 1 } }),
          accounts: [],
        })),
      },
    };
    definitions.setRepoDef(source.value, sourceRepo);
    const deps = createFakeDeps({
      git,
      definitions,
      capabilities: createFakeCapabilityCatalog([], [], [], [
        // The installed CLI is a minor past the measured version, so every stage of the flow warns;
        // a provider whose measured side is unknown (installed alone) never does.
        { provider: 'fixture-drift', installed: '1.4.0', measured: '1.3.6' },
        { provider: 'fixture-drift-unknown', installed: '9.9.9' },
      ]),
      repoScanner: { ...createFakeRepoScanner(), detect: async () => ({ docsRoot: 'docs', testGlobs: ['**/*.test.ts'] }) },
    });
    await deps.projects.save({ id: project.value, name: 'Atölye', repos: [source.value] });
    await deps.repos.register({ repoId: 'r-1', slug: source.value, path: '/work/atolye', fingerprint: { rootCommit: 'abc' } });
    const accountId = parseSlug<'account'>('a-2');
    if (!accountId.ok) throw new Error('accountId');
    await deps.accounts.save({
      id: accountId.value,
      provider: 'fixture-drift',
      label: 'Sürükmeli',
      authMode: 'subscription',
      limitPolicy: 'wait_resume',
      caps: [],
    });
    const result = await setupCopyProposal(deps, { project: project.value, source: source.value, path: REPO_PATH });
    if (!result.ok) throw new Error(`setup failed: ${JSON.stringify(result)}`);
    // One informational warning per stage — the drift never blocks the proposal.
    expect(result.value.warnings.every((warning) => 'kind' in warning && warning.kind === 'version_drift')).toBe(true);
    expect(result.value.warnings).toHaveLength(standard.stages.length);
    expect(result.value.warnings[0]).toEqual({
      stage: standard.stages[0]?.id,
      provider: 'fixture-drift',
      kind: 'version_drift',
      installed: '1.4.0',
      measured: '1.3.6',
    });
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
    expect(result.ok).toBe(true);
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
    expect(first).toEqual({ ok: true, value: { wroteRepoYaml: true } });
    const writesAfterFirst = writeSpy.mock.calls.length;
    const savesAfterFirst = saveSpy.mock.calls.length;
    const second = await setupApply(deps, {
      project: project.value,
      path: REPO_PATH,
      answers: validAnswers('wrong'),
      actor: ACTOR,
    });
    expect(second).toEqual({ ok: true, value: { wroteRepoYaml: false } });
    expect(writeSpy.mock.calls.length).toBe(writesAfterFirst);
    expect(saveSpy.mock.calls.length).toBe(savesAfterFirst);
  });

  const registeredDeps = async (slug: string) => {
    const ready = readyApplyDeps();
    const parsed = parseSlug<'repo'>(slug);
    if (!parsed.ok) throw new Error('slug');
    await ready.deps.projects.save({ id: project.value, name: 'Atölye', repos: [parsed.value] });
    await ready.deps.repos.register({ repoId: '01ARZ3NDEKTSV4RRFFQ69G5FB1', slug: parsed.value, path: REPO_PATH, fingerprint: { rootCommit: 'abc' } });
    return ready;
  };

  it('A-76: a path that project.create already registered still gets its repo.yaml, under the registered slug', async () => {
    const { deps, definitions } = await registeredDeps('acme');
    const result = await setupApply(deps, { project: project.value, path: REPO_PATH, answers: validAnswers('acme'), actor: ACTOR });
    expect(result).toEqual({ ok: true, value: { wroteRepoYaml: true } });
    expect(await definitions.readFile('repos/acme-2/repo.yaml')).toBeUndefined();
    const file = await definitions.readFile('repos/acme/repo.yaml');
    expect(file).toBeDefined();
    const body = JSON.parse(file?.content ?? '{}') as RepoDef;
    expect(body.commandSets).toEqual({ tests: [] });
    const checked = validateDefinitions({
      roles: BUILTIN_ROLES,
      flows: BUILTIN_FLOWS,
      capabilities: [],
      project: { id: project.value, name: 'Atölye', repos: [source.value] },
      repo: body,
    });
    expect(checked.ok).toBe(true);
    expect((await deps.projects.get(project.value))?.repos).toEqual(['acme']);
  });

  it('A-387: a registered path whose repo.yaml exists is a no-op', async () => {
    const { deps, definitions } = await registeredDeps('acme');
    await definitions.writeFile('repos/acme/repo.yaml', '{"id":"acme"}\n', '');
    const writeSpy = vi.spyOn(definitions, 'writeFile');
    const result = await setupApply(deps, { project: project.value, path: REPO_PATH, answers: validAnswers('acme'), actor: ACTOR });
    expect(result).toEqual({ ok: true, value: { wroteRepoYaml: false } });
    expect(writeSpy).not.toHaveBeenCalled();
  });

  it('A-76: an AI-shaped proposal with empty commandSets is written with the built-in set empty', async () => {
    const { deps, definitions } = readyApplyDeps();
    const base = validAnswers('acme') as { repo: Record<string, unknown> };
    const result = await setupApply(deps, {
      project: project.value,
      path: REPO_PATH,
      answers: { ...base, repo: { ...base.repo, commandSets: {} } },
      actor: ACTOR,
    });
    expect(result.ok).toBe(true);
    const body = JSON.parse((await definitions.readFile('repos/acme/repo.yaml'))?.content ?? '{}') as RepoDef;
    expect(body.commandSets).toEqual({ tests: [] });
  });

  it('A-419: setupApply writes tests: [] and no command gate for an empty test command, and keeps the gate for a filled one', async () => {
    const commandGates = (body: { readonly flow: RepoFlow }) => body.flow.stages.flatMap((stage) => stage.exit.filter((gate) => gate.kind === 'command'));
    const base = validAnswers('acme') as { repo: Record<string, unknown> };
    const run = async (commandSets: unknown) => {
      const { deps, definitions } = readyApplyDeps();
      const result = await setupApply(deps, {
        project: project.value,
        path: REPO_PATH,
        answers: { ...base, repo: { ...base.repo, commandSets } },
        actor: ACTOR,
      });
      expect(result.ok).toBe(true);
      const body = JSON.parse((await definitions.readFile('repos/acme/repo.yaml'))?.content ?? '{}') as RepoDef;
      const checked = validateDefinitions({ roles: BUILTIN_ROLES, flows: BUILTIN_FLOWS, capabilities: [], repo: body });
      expect(checked.ok).toBe(true);
      return body;
    };
    const empty = await run({ tests: [] });
    expect(empty.commandSets).toEqual({ tests: [] });
    expect(commandGates(empty)).toEqual([]);
    expect(empty.flow.stages.some((stage) => stage.exit.some((gate) => gate.kind === 'secret_scan'))).toBe(true);
    const aiShaped = await run({});
    expect(commandGates(aiShaped)).toEqual([]);
    const filled = await run({ tests: ['npm test'] });
    expect(filled.commandSets).toEqual({ tests: ['npm test'] });
    expect(commandGates(filled)).not.toEqual([]);
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
