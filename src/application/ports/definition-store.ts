// Read/write port for definition files (global store merged with per-workspace overrides).
import type {
  Definitions,
  DefinitionIssue,
  Result,
  Roadmap,
  RoadmapIssue,
  WorkspaceSlug,
} from '../../domain/index';

export type DefinitionScope =
  | { readonly kind: 'global' }
  | { readonly kind: 'workspace'; readonly workspace: WorkspaceSlug };

export interface DefinitionFile {
  readonly content: string;
  readonly hash: string;
}

export interface DefinitionStore {
  /** Global definitions merged with the workspace's (workspace ids override global ids of the same kind). */
  load(workspace: WorkspaceSlug): Promise<Result<Definitions, readonly DefinitionIssue[]>>;
  loadRoadmap(workspace: WorkspaceSlug): Promise<Result<Roadmap, readonly RoadmapIssue[]> | undefined>; // undefined = no roadmap
  readFile(scope: DefinitionScope, target: string): Promise<DefinitionFile | undefined>;
  /** Writes only if the current hash equals `expectedHash` ('' = file must not exist). */
  writeFile(
    scope: DefinitionScope,
    target: string,
    content: string,
    expectedHash: string,
  ): Promise<Result<{ readonly hash: string }, 'stale'>>;
  workspacePath(workspace: WorkspaceSlug): Promise<string | undefined>; // repo checkout root on this machine
  /** Parses the candidate content and validates the definitions as they WOULD be with it; writes nothing. */
  validateCandidate(scope: DefinitionScope, target: string, content: string): Promise<Result<void, readonly DefinitionIssue[]>>;
}
