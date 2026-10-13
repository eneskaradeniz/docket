// The narrow path views other adapters need from the registries.
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

/** The slug→folder view over the repoId-keyed registry: the transitional reader the YAML store and
 *  the worktrees keep until the store re-roots under the global root alone. */
export function repoPathsOf(repos: RepoRegistry): RepoPaths {
  return {
    path: async (slug: RepoSlug): Promise<string | undefined> =>
      (await repos.list()).find((entry) => entry.slug === slug)?.path,
  };
}
