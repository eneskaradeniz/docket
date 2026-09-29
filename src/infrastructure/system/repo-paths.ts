// The narrow path views other adapters need from the registries.
import type { ProjectSlug, RepoSlug } from '../../domain/index';

export interface RepoPaths {
  path(slug: RepoSlug): Promise<string | undefined>;
}

export interface ProjectPaths {
  mainRepoPath(project: ProjectSlug): Promise<string | undefined>;
  /** The project a repo belongs to; the project arm of a definitions load resolves through it. */
  projectOf(repo: RepoSlug): Promise<ProjectSlug | undefined>;
}
