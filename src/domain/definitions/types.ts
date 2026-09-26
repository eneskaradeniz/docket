// definitions/types.ts — exact contract from docs/v2/domain.md section 2.
import type { CapabilitySlug, FlowSlug, GateSlug, RoleSlug, StageSlug, WorkspaceSlug } from '../shared';

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
  | { readonly kind: 'page_approval'; readonly id: GateSlug; readonly label: string };

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
}

export type RoleOverride = { readonly id: RoleSlug } & Partial<Omit<RoleDef, 'id'>>;

export interface Definitions {
  readonly roles: readonly RoleDef[];
  readonly flows: readonly FlowDef[];
  readonly capabilities: readonly CapabilityDef[];
  readonly workspace?: WorkspaceDef;
}
