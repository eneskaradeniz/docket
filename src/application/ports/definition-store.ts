// Read/write port for definition files (global store merged with per-repo overrides).
import type {
  Definitions,
  DefinitionIssue,
  Result,
  Roadmap,
  RoadmapIssue,
  RepoSlug,
} from '../../domain/index';

export type DefinitionScope =
  | { readonly kind: 'global' }
  | { readonly kind: 'repo'; readonly repo: RepoSlug };

export interface DefinitionFile {
  readonly content: string;
  readonly hash: string;
}

export interface DefinitionStore {
  /** Global definitions merged with the repo's (repo ids override global ids of the same kind). */
  load(repo: RepoSlug): Promise<Result<Definitions, readonly DefinitionIssue[]>>;
  loadRoadmap(repo: RepoSlug): Promise<Result<Roadmap, readonly RoadmapIssue[]> | undefined>; // undefined = no roadmap
  readFile(scope: DefinitionScope, target: string): Promise<DefinitionFile | undefined>;
  /** Writes only if the current hash equals `expectedHash` ('' = file must not exist). */
  writeFile(
    scope: DefinitionScope,
    target: string,
    content: string,
    expectedHash: string,
  ): Promise<Result<{ readonly hash: string }, 'stale'>>;
  repoPath(repo: RepoSlug): Promise<string | undefined>; // repo checkout root on this machine
  /** Parses the candidate content and validates the definitions as they WOULD be with it; writes nothing. */
  validateCandidate(scope: DefinitionScope, target: string, content: string): Promise<Result<void, readonly DefinitionIssue[]>>;
}
