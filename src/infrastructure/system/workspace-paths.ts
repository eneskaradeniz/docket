// The one thing path-based adapters need from the workspace registry: where a workspace checks out.
import type { WorkspaceSlug } from '../../domain/index';

export interface WorkspacePaths {
  path(slug: WorkspaceSlug): Promise<string | undefined>;
}
