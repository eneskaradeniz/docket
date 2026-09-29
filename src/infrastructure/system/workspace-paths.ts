// The one thing path-based adapters need from the repo registry: where a repo checks out.
import type { RepoSlug } from '../../domain/index';

export interface RepoPaths {
  path(slug: RepoSlug): Promise<string | undefined>;
}
