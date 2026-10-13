// Read/write port for definition files — every definition lives under the store's single global
// root; targets are the store's own grammar (library version files, project, repo, roadmap).
import type {
  CapabilityDef,
  Definitions,
  EpochMs,
  FlowDef,
  DefinitionIssue,
  ProjectSlug,
  Result,
  Roadmap,
  RoadmapIssue,
  RepoSlug,
  RoleDef,
  VersionRecord,
} from '../../domain/index';

/** A-343: the library kinds the store versions. */
export type DefinitionKind = 'roles' | 'flows' | 'capabilities' | 'memory';

/** Where a proposal or an action sits in the project/repo tree — persisted beside a proposal's
 *  target, which itself carries the full grammar path. */
export type DefinitionScope =
  | { readonly kind: 'global' }
  | { readonly kind: 'project'; readonly project: ProjectSlug }
  | { readonly kind: 'repo'; readonly repo: RepoSlug };

export interface DefinitionFile {
  readonly content: string;
  readonly hash: string;
}

export interface DefinitionStore {
  /** The library's current versions merged with the repo's own repo.yaml (no project layer —
   *  a project carries no roles or flows). */
  load(repo: RepoSlug): Promise<Result<Definitions, readonly DefinitionIssue[]>>;
  /** The project's roadmap at projects/<project>/roadmap.yaml; undefined = no roadmap. */
  loadRoadmap(project: ProjectSlug): Promise<Result<Roadmap, readonly RoadmapIssue[]> | undefined>;
  readFile(scope: DefinitionScope, target: string): Promise<DefinitionFile | undefined>;
  readFile(target: string): Promise<DefinitionFile | undefined>;
  /** Writes only if the current hash equals `expectedHash` ('' = file must not exist); a library
   *  version file is create-only — never overwritten, never renamed over. */
  writeFile(
    scope: DefinitionScope,
    target: string,
    content: string,
    expectedHash: string,
  ): Promise<Result<{ readonly hash: string }, 'stale'>>;
  writeFile(
    target: string,
    content: string,
    expectedHash: string,
  ): Promise<Result<{ readonly hash: string }, 'stale'>>;
  /** Parses the candidate content and validates the definitions as they WOULD be with it; writes
   *  nothing. A library version candidate validates as that definition's next version. */
  validateCandidate(scope: DefinitionScope, target: string, content: string): Promise<Result<void, readonly DefinitionIssue[]>>;
  validateCandidate(target: string, content: string): Promise<Result<void, readonly DefinitionIssue[]>>;
  /** Writes each built-in role and flow as library/<kind>/<id>/v1.yaml unless a file with that id
   *  exists; never overwrites. */
  installBuiltins(library: {
    readonly roles: readonly RoleDef[];
    readonly flows: readonly FlowDef[];
  }): Promise<{ readonly written: readonly string[] }>;
  /** Writes each capability as library/capabilities/<id>/v1.yaml unless a file with that id
   *  exists; never overwrites. `written`/`skipped` list the targets actually written / found. */
  installCapabilities(capabilities: readonly CapabilityDef[]): Promise<{
    readonly written: readonly string[];
    readonly skipped: readonly string[];
  }>;
  /** Every library definition id of a kind that has at least one version file, in id order. */
  listIds(kind: DefinitionKind): Promise<readonly string[]>;
  /** A-343: a definition's version history in version order; empty for an unknown id. */
  listVersions(kind: DefinitionKind, id: string): Promise<readonly VersionRecord<unknown>[]>;
  /** A-343: the only library write — appends the next version and answers `stale` when a
   *  concurrent writer appended the same next version first (the adapter's write race). */
  appendVersion(
    kind: DefinitionKind,
    id: string,
    body: unknown,
    at: EpochMs,
  ): Promise<Result<VersionRecord<unknown>, 'stale'>>;
}
