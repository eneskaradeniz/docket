// The narrow path view other adapters need from the registry.
import type { RepoRegistry } from '../../application/index';
import type { ProjectSlug, RepoSlug } from '../../domain/index';

export interface RepoPaths {
  path(slug: RepoSlug): Promise<string | undefined>;
}

export interface ProjectPaths {
  mainRepoPath(project: ProjectSlug): Promise<string | undefined>;
  /** The project a repo belongs to; the project arm of a definitions load resolves through it. */
  projectOf(repo: RepoSlug): Promise<ProjectSlug | undefined>;
}

/** The slug→folder view over the repoId-keyed registry: the reader the worktrees and the repo
 *  file reads keep — the definition store no longer resolves checkouts at all. */
export function repoPathsOf(repos: RepoRegistry): RepoPaths {
  return {
    path: async (slug: RepoSlug): Promise<string | undefined> =>
      (await repos.list()).find((entry) => entry.slug === slug)?.path,
  };
}
