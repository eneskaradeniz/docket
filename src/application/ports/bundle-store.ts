import type {
  EpochMs,
  ProjectDef,
  ProjectSlug,
  RepoDef,
  Result,
  Roadmap,
  VersionRecord,
} from '../../domain/index';
import type { DefinitionKind } from './definition-store';

export type MemoryScope = 'global' | 'project' | 'repo';

export interface MemoryNote {
  readonly id: string;
  readonly scope: MemoryScope;
  readonly scopeId?: string;
  readonly text: string;
  readonly createdBy: 'user' | 'agent';
  readonly active: boolean;
}

export interface MemoryProposal {
  readonly id: string;
  readonly scope: MemoryScope;
  readonly scopeId?: string;
  readonly text: string;
  readonly sourceRun: string;
  readonly state: 'pending' | 'accepted' | 'rejected';
}

// Bundle format (I-89, I-91)
export interface DocketBundle {
  readonly format: 'docket-bundle';
  readonly version: 1;
  readonly createdAt: EpochMs;
  readonly projects: readonly unknown[];
  readonly repos: readonly unknown[];
  readonly library: unknown;
  readonly memory: unknown;
  readonly checksum: string; // SHA-256 over canonical JSON of everything else
}

// ports/bundle-store.ts (application.md → A-342) — the adapter contract (I-100)
export interface BundleStore {
  /** Writes the bundle under exports/ and returns its absolute path; never overwrites. */
  export(project: ProjectSlug, bundle: DocketBundle): Promise<Result<{ readonly path: string }, 'io_failed'>>;
  /** Reads and checks a bundle file; the checksum is verified against I-98's canonical form. */
  read(path: string): Promise<Result<DocketBundle, 'not_found' | 'wrong_format' | 'bad_checksum'>>;
}

// The element shapes inside DocketBundle's unknown fields (I-99)
export type BundleProjects = readonly { readonly project: ProjectDef; readonly roadmap?: Roadmap }[];
export type BundleRepos = readonly RepoDef[];
export type BundleLibrary = Readonly<Record<DefinitionKind, Readonly<Record<string, readonly VersionRecord<unknown>[]>>>>;
export type BundleMemory = readonly MemoryNote[];
