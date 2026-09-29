// definitions/types.ts — exact contract from docs/v2/domain.md section 2.
import type { SpendCap } from '../budget';
import type { CapabilitySlug, EnvSlug, FlowSlug, GateSlug, ProjectSlug, RepoSlug, RoleSlug, StageSlug, WorkspaceSlug } from '../shared';

export type WriteScope =
  | { readonly kind: 'none' } // read-only role
  | { readonly kind: 'docs' } // the workspace docs root only
  | { readonly kind: 'tests' } // test folders only (globs from workspace)
  | { readonly kind: 'repo' } // the work order's worktree
  | { readonly kind: 'paths'; readonly globs: readonly string[] };

export interface RoleDef {
  readonly id: RoleSlug;
  readonly name: string; // display, verbatim user language
  readonly instructions: string; // the role prompt
  readonly writeScope: WriteScope;
  readonly capabilities: readonly CapabilitySlug[];
  readonly active: boolean;
}

export type GateDef =
  | { readonly kind: 'human'; readonly id: GateSlug; readonly label: string }
  | { readonly kind: 'command'; readonly id: GateSlug; readonly commandSet: string }
  | { readonly kind: 'agent_verdict'; readonly id: GateSlug; readonly role: RoleSlug }
  | { readonly kind: 'secret_scan'; readonly id: GateSlug }
  | { readonly kind: 'page_approval'; readonly id: GateSlug; readonly label: string }
  | { readonly kind: 'deploy'; readonly id: GateSlug; readonly environment: EnvSlug }
  | { readonly kind: 'remote_checks'; readonly id: GateSlug; readonly required: readonly string[] | 'all'; readonly timeoutMinutes: number };

export interface StageDef {
  readonly id: StageSlug;
  readonly name: string;
  readonly role: RoleSlug | null; // null = a human-only stage (e.g. staging test)
  readonly exit: readonly GateDef[]; // all must pass to advance
  readonly onFail?: { readonly goto: StageSlug; readonly maxAttempts: number };
}

export interface FlowDef {
  readonly id: FlowSlug;
  readonly name: string;
  readonly stages: readonly StageDef[]; // linear order; onFail may jump back
}

export type CapabilityDef =
  | {
      readonly kind: 'mcp';
      readonly id: CapabilitySlug;
      readonly name: string;
      readonly command: string;
      readonly args: readonly string[];
      readonly env: Readonly<Record<string, EnvValue>>;
    }
  | { readonly kind: 'skill'; readonly id: CapabilitySlug; readonly name: string; readonly path: string }
  | { readonly kind: 'hook'; readonly id: CapabilitySlug; readonly name: string; readonly event: HookEvent; readonly command: string }
  | { readonly kind: 'context'; readonly id: CapabilitySlug; readonly name: string; readonly path: string };

/** A value is either literal (non-secret) or a reference to the keychain — never a secret literal. */
export type EnvValue = { readonly literal: string } | { readonly secretRef: string };
export type HookEvent = 'before_tool' | 'after_tool' | 'after_write' | 'run_end';

export interface RepoRef {
  readonly id: string;
  readonly remote: string;
  readonly defaultBranch: string;
}

/** <main-repo>/.docket/project.yaml — the project layer above repos (S1). */
export interface ProjectDef {
  readonly id: ProjectSlug;
  readonly name: string;
  readonly mainRepo: RepoSlug; // the roadmap and project.yaml live in this repo's .docket/
  readonly repos: readonly RepoSlug[]; // at least mainRepo; unique
  readonly budget?: SpendCap; // project spend ceiling (S5): the sum over all repos
}

export interface EnvironmentDef {
  readonly id: EnvSlug;
  readonly name: string;
  readonly order: number; // promotion order, ascending
  readonly deploy: string; // commandSet name
  readonly verify?: string; // commandSet name (post-deploy smoke)
  readonly env: Readonly<Record<string, EnvValue>>; // injected only during deploy/verify
  readonly protected: boolean; // stricter rules: separate approver, promoteFrom required
  readonly promoteFrom?: EnvSlug; // same commit must have a successful deploy there first
}

export interface WorkspaceDef {
  readonly id: WorkspaceSlug;
  readonly name: string;
  readonly repos: readonly RepoRef[];
  readonly flows: readonly FlowSlug[]; // enabled flows
  readonly defaultFlow: FlowSlug;
  readonly commandSets: Readonly<Record<string, readonly string[]>>; // name → shell commands, run in order
  readonly roleOverrides: readonly RoleOverride[];
  readonly docsRoot: string; // default "docs"
  readonly testGlobs: readonly string[]; // used by WriteScope 'tests'
  readonly environments?: readonly EnvironmentDef[]; // default []
}

export type RoleOverride = { readonly id: RoleSlug } & Partial<Omit<RoleDef, 'id'>>;

export interface Definitions {
  readonly roles: readonly RoleDef[];
  readonly flows: readonly FlowDef[];
  readonly capabilities: readonly CapabilityDef[];
  readonly project?: ProjectDef; // present in the project scope
  readonly workspace?: WorkspaceDef;
}
