// forge/repo-forge-resolver.test.ts — rules A-368 and I-104: the per-repo Forge resolver answers
// only for github.com remotes with an authenticated gh CLI, probes once, and stays silent
// (undefined) everywhere else. The last two tests hold the read-only line as the git-actions
// issue (GI-2) left it: the git-actions use case is the one production module licensed to call a
// forge write member, mergePullRequest from it alone, and every other file under src/ or
// electron/ still calls none.
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

import { parseSlug, type RepoSlug } from '../../domain/index';
import type { RepoRegistry } from '../../application/index';
import { createFakeCommandRunner } from '../../application/ports/fakes/index';

import { createRepoForgeResolver } from './repo-forge-resolver';

const slug = (input: string): RepoSlug => {
  const parsed = parseSlug<'repo'>(input);
  if (!parsed.ok) throw new Error('fixture slug');
  return parsed.value;
};

const GH_REPO = slug('demo');

/** The registry stub the resolver reads: one row whose fingerprint remote the test varies. */
const reposWithRemote = (remote: string | undefined): RepoRegistry => ({
  list: async () => [{ repoId: '1', slug: GH_REPO, path: '/repo/demo', fingerprint: { rootCommit: '', ...(remote === undefined ? {} : { remote }) } }],
  register: async () => undefined,
  byRepoId: async () => undefined,
  relink: async () => ({ ok: false, error: 'folder_not_found' as const }),
});

const scriptGhReady = (runner: ReturnType<typeof createFakeCommandRunner>): void => {
  runner.script('gh --version', { exitCode: 0, durationMs: 1, outputTail: 'gh version 2' });
  runner.script('gh auth status', { exitCode: 0, durationMs: 1, outputTail: '' });
};

describe('createRepoForgeResolver', () => {
  it('A-368: returns a github forge for a github.com remote when gh is authenticated', async () => {
    const runner = createFakeCommandRunner();
    scriptGhReady(runner);
    scriptGhReady(runner); // createGhForge probes capabilities at creation, through the same runner
    const resolver = createRepoForgeResolver({ repos: reposWithRemote('https://github.com/octo/demo.git'), commands: runner });

    const forge = await resolver.forRepo({ id: GH_REPO, remote: 'https://github.com/octo/demo.git', defaultBranch: 'main' });
    expect(forge?.kind).toBe('github');
    expect(forge?.capabilities.checks).toBe(true);
  });

  it('A-368: a remote on another host resolves undefined and runs no command', async () => {
    const runner = createFakeCommandRunner();
    const resolver = createRepoForgeResolver({ repos: reposWithRemote('https://gitlab.example/octo/demo'), commands: runner });

    const forge = await resolver.forRepo({ id: GH_REPO, remote: 'https://gitlab.example/octo/demo', defaultBranch: 'main' });
    expect(forge).toBeUndefined();
    expect(runner.calls()).toHaveLength(0);
  });

  it('A-368: a missing gh CLI resolves undefined', async () => {
    const runner = createFakeCommandRunner();
    runner.script('gh --version', { exitCode: 127, durationMs: 1, outputTail: 'command not found' });
    const resolver = createRepoForgeResolver({ repos: reposWithRemote('git@github.com:octo/demo.git'), commands: runner });

    const forge = await resolver.forRepo({ id: GH_REPO, remote: 'git@github.com:octo/demo.git', defaultBranch: 'main' });
    expect(forge).toBeUndefined();
  });

  it('A-368: the gh probe is cached — a second forRepo adds no probe command of the resolver', async () => {
    const runner = createFakeCommandRunner();
    scriptGhReady(runner);
    scriptGhReady(runner);
    scriptGhReady(runner); // the forge creation probe of the second resolution
    const resolver = createRepoForgeResolver({ repos: reposWithRemote('https://github.com/octo/demo'), commands: runner });
    const repoRef = { id: GH_REPO, remote: 'https://github.com/octo/demo', defaultBranch: 'main' } as const;

    await resolver.forRepo(repoRef);
    // One resolver probe + one creation probe so far.
    expect(runner.calls().filter((call) => call.command === 'gh --version')).toHaveLength(2);

    await resolver.forRepo(repoRef);
    // Only the forge's own creation probe ran again; the resolver's probe answer was cached.
    expect(runner.calls().filter((call) => call.command === 'gh --version')).toHaveLength(3);
  });
});

// --- the read-only line (acceptance 4, held until GI-2 gave it its one caller) ---------------------

/** Every non-test TypeScript file under src/ and electron/, the trees a production path lives in. */
const productionFiles = (root: string, acc: string[] = []): string[] => {
  for (const name of readdirSync(root)) {
    const at = join(root, name);
    if (statSync(at).isDirectory()) productionFiles(at, acc);
    else if (/\.tsx?$/.test(name) && !/\.test\.tsx?$/.test(name)) acc.push(at);
  }
  return acc;
};

const WRITE_MEMBERS = /\.pushBranch\(|\.openPullRequest\(|\.mergePullRequest\(/;

/** The one production module the git-actions issue (GI-2) licensed to call a forge write member. */
const GIT_ACTIONS = join(process.cwd(), 'src', 'application', 'use-cases', 'git-actions.ts');

describe('forge write members stay uncalled in production', () => {
  it('I-104: no production file under src/ or electron/ but the git-actions use case calls a forge write member', () => {
    const offenders = productionFiles(join(process.cwd(), 'src'))
      .concat(productionFiles(join(process.cwd(), 'electron')))
      .filter((file) => file !== GIT_ACTIONS)
      .filter((file) => WRITE_MEMBERS.test(readFileSync(file, 'utf8')));
    expect(offenders).toEqual([]);
  });

  it('holds the merge invariant (A-373): mergePullRequest is called from exactly one place', () => {
    // Whichever production file dares call forge.mergePullRequest besides the git-actions use
    // case breaks the explicit-approval pin — nothing else may merge on any path.
    const callers = productionFiles(join(process.cwd(), 'src'))
      .concat(productionFiles(join(process.cwd(), 'electron')))
      .filter((file) => /\.mergePullRequest\(/.test(readFileSync(file, 'utf8')));
    expect(callers).toEqual([GIT_ACTIONS]);
  });
});
