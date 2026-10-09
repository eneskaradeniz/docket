// Read/write port for definition files (global store merged with per-project and per-repo
// overrides — the repo's .docket wins over the project's, the project's over the global).
import type {
  CapabilityDef,
  Definitions,
  FlowDef,
  DefinitionIssue,
  ProjectDef,
  ProjectSlug,
  RepoDef,
  Result,
  Roadmap,
  RoadmapIssue,
  RepoSlug,
  RoleDef,
} from '../../domain/index';

export type DefinitionScope =
  | { readonly kind: 'global' }
  | { readonly kind: 'project'; readonly project: ProjectSlug }
  | { readonly kind: 'repo'; readonly repo: RepoSlug };

export interface DefinitionFile {
  readonly content: string;
  readonly hash: string;
}

export interface DefinitionStore {
  /** Global definitions merged with the repo's project defaults and the repo's own (repo ids win — S3). */
  load(repo: RepoSlug): Promise<Result<Definitions, readonly DefinitionIssue[]>>;
  /** Reads and validates `project.yaml` at an arbitrary checkout path (the attach flow). */
  readProjectAt(path: string): Promise<Result<ProjectDef, readonly DefinitionIssue[]>>;
  /** The project's roadmap, read from the main repo's `.docket/roadmap.yaml`; undefined = no roadmap. */
  loadRoadmap(project: ProjectSlug): Promise<Result<Roadmap, readonly RoadmapIssue[]> | undefined>;
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
  /** Writes each built-in role and flow as a global-root file unless a file with that id exists; never overwrites. */
  installBuiltins(library: {
    readonly roles: readonly RoleDef[];
    readonly flows: readonly FlowDef[];
  }): Promise<{ readonly written: readonly string[] }>;
  /** Writes each capability as <globalRoot>/capabilities/<id>.yaml unless a file with that id
   *  exists; never overwrites. `written`/`skipped` list the targets actually written / found. */
  installCapabilities(capabilities: readonly CapabilityDef[]): Promise<{
    readonly written: readonly string[];
    readonly skipped: readonly string[];
  }>;
  /** Writes <path>/.docket/project.yaml and <path>/.docket/repo.yaml; writes nothing when either exists. */
  scaffoldProject(
    path: string,
    project: ProjectDef,
    repo: RepoDef,
  ): Promise<Result<void, 'project_yaml_exists' | 'repo_yaml_exists' | 'io_failed'>>;
}
