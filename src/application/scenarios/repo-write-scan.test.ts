// scenarios/repo-write-scan.test.ts — rule I-87: the application writes no file into a registered
// repo folder. Every write-shaped call on the file-touching ports is recorded while the repo-facing
// use cases run, and no recorded path may sit inside a registered folder outside `.git/`.
import { describe, expect, it } from 'vitest';

import type { Actor } from '../../domain/index';

import type { AppDeps } from '../ports/index';
import {
  createFakeDefinitionStore,
  createFakeDeps,
  createFakeGitProbe,
  createFakeRepoFolders,
  createFakeRepoRegistry,
} from '../ports/fakes/index';
import { attachProject, createProject, relinkRepo } from '../use-cases/index';

const ACTOR: Actor = { kind: 'user', id: 'u-1', label: 'Operator' };
const WRITE_SHAPED = /^(write|save|install|append|create|put|remove|delete|stage|commit|checkpoint|scaffold|seed)/;
const FILE_PORTS = [
  'definitions', 'pageFiles', 'attachmentFiles', 'runDirs', 'scratch', 'repoFolders', 'worktreeFiles', 'checkpoints', 'worktrees',
] as const;

/** Every string reachable from a call's arguments (plain values, arrays, `path`-bearing objects). */
const stringsOf = (value: unknown): readonly string[] => {
  if (typeof value === 'string') return [value];
  if (Array.isArray(value)) return value.flatMap(stringsOf);
  if (typeof value === 'object' && value !== null) return Object.values(value).flatMap(stringsOf);
  return [];
};

const insideOutsideGit = (path: string, folder: string): boolean =>
  (path === folder || path.startsWith(`${folder}/`)) && !path.slice(folder.length).startsWith('/.git/') && !path.endsWith('/.git');

/** Wraps the file-touching ports so each write-shaped call lands in `writes` before it runs. */
const recording = (deps: AppDeps, writes: string[]): AppDeps => {
  const wrapped: Record<string, unknown> = { ...deps };
  for (const name of FILE_PORTS) {
    const port = deps[name] as unknown as Record<string, unknown>;
    wrapped[name] = new Proxy(port, {
      get: (target, key) => {
        const member = target[key as string];
        if (typeof member !== 'function' || typeof key !== 'string' || !WRITE_SHAPED.test(key)) return member;
        return (...args: unknown[]) => {
          writes.push(...stringsOf(args));
          return (member as (...inner: unknown[]) => unknown).apply(target, args);
        };
      },
    });
  }
  return wrapped as unknown as AppDeps;
};

describe('I-87: no application write lands inside a registered repo folder outside .git/', () => {
  it('I-87: no application write lands inside a registered repo folder outside .git/', async () => {
    const writes: string[] = [];
    const git = createFakeGitProbe();
    const repos = createFakeRepoRegistry();
    const base = createFakeDeps({
      git,
      repos,
      definitions: createFakeDefinitionStore(),
      repoFolders: createFakeRepoFolders(),
    });
    const deps = recording(base, writes);
    git.markWorkTree('/checkouts/web');
    repos.markFingerprint('/checkouts/moved', { rootCommit: 'aaa' });

    // Attach registers a folder; relink runs against it.
    const attached = await attachProject(deps, { path: '/checkouts/web', actor: ACTOR });
    expect(attached.ok).toBe(true);
    if (!attached.ok) return;
    const { repoId } = attached.value;
    await relinkRepo(deps, { repoId, path: '/checkouts/moved', actor: ACTOR });
    // A blank project creates the user's own folder and installs the library under the data root.
    await createProject(deps, { source: { kind: 'blank', parent: '/work' }, name: 'Atölye', actor: ACTOR });

    const folders = (await deps.repos.list()).map((entry) => entry.path);
    expect(folders).toContain('/checkouts/moved');
    expect(writes.length).toBeGreaterThan(0);
    for (const written of writes) {
      for (const folder of folders) {
        expect(insideOutsideGit(written, folder), `${written} is inside ${folder}`).toBe(false);
      }
    }
  });

  it('I-87: the scan itself flags a write into a repo folder and allows one under .git/', () => {
    expect(insideOutsideGit('/checkouts/web/.docket/repo.yaml', '/checkouts/web')).toBe(true);
    expect(insideOutsideGit('/checkouts/web/src/a.ts', '/checkouts/web')).toBe(true);
    expect(insideOutsideGit('/checkouts/web/.git/refs/heads/docket/x', '/checkouts/web')).toBe(false);
    expect(insideOutsideGit('/checkouts/webster/a.ts', '/checkouts/web')).toBe(false);
  });
});
