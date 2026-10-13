// definitions/types.ts — exact contract from docs/v2/domain.md section 2.
import type { SpendCap } from '../budget';
import type { LimitPolicy } from '../quota';
import type { CapabilitySlug, EnvSlug, FlowSlug, GateSlug, ProjectSlug, RepoSlug, RoleSlug, StageSlug, ThinkingChoice, Tier } from '../shared';
import type { RepoFlow } from './repo-flow';

export type WriteScope =
  | { readonly kind: 'none' } // read-only role
  | { readonly kind: 'docs' } // the repo docs root only
  | { readonly kind: 'tests' } // test folders only (globs from repo)
  | { readonly kind: 'repo' } // the work order's worktree
  | { readonly kind: 'paths'; readonly globs: readonly string[] };

export interface RoleDef {
  readonly id: RoleSlug;
  readonly name: string; // display, verbatim user language
  readonly instructions: string; // the role prompt
  readonly writeScope: WriteScope;
  readonly capabilities: readonly CapabilitySlug[];
  readonly active: boolean;
  /** Whether the run is given Docket's own tools (page publishing); absent means yes. */
  readonly docketTools?: boolean;
}

export type GateDef =
  | { readonly kind: 'human'; readonly id: GateSlug; readonly label: string }
  | { readonly kind: 'command'; readonly id: GateSlug; readonly commandSet: string }
  | { readonly kind: 'changes'; readonly id: GateSlug } // the stage's run must have changed something
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
  readonly tier?: Tier; // overrides the binding's tier for this stage
  readonly thinking?: ThinkingChoice; // overrides the binding's thinking for this stage
  /** The earlier stage of the same flow whose output this stage reviews; its runs prefer another
   *  provider than the one that wrote it. */
  readonly reviewOf?: StageSlug;
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
  | { readonly kind: 'context'; readonly id: CapabilitySlug; readonly name: string; readonly path: string }
  | {
      readonly kind: 'plugin';
      readonly id: CapabilitySlug;
      readonly name: string;
      readonly source: PluginSource;
      readonly version?: string;
      readonly includes: readonly CapabilitySlug[];
    }
  | {
      readonly kind: 'command';
      readonly id: CapabilitySlug;
      readonly name: string;
      readonly template: string;
      readonly arguments: readonly { readonly name: string; readonly required: boolean }[];
    };

export type PluginSource =
  | { readonly kind: 'path'; readonly path: string }
  | { readonly kind: 'marketplace'; readonly marketplace: string; readonly name: string };
export type CapabilityKind = CapabilityDef['kind'];

/** A value is either literal (non-secret) or a reference to the keychain — never a secret literal. */
export type EnvValue = { readonly literal: string } | { readonly secretRef: string };
export type HookEvent = 'before_tool' | 'after_tool' | 'after_write' | 'run_end';

export interface RepoRef {
  readonly id: string;
  readonly remote: string;
  readonly defaultBranch: string;
}
// RepoRef is no longer declared in YAML: adapters build it from the repo checkout (git remote,
// default branch) when a forge or remote-checks operation needs it.

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

/** <repo>/.docket/workspace.yaml — one repository's configuration. */
export interface RepoDef {
  readonly id: RepoSlug;
  readonly name: string;
  // Phase 7 (D-1/D-4): the repo's own flow with its stage bindings. Optional while the live
  // shapes migrate onto it (#1012) — repos stored before Phase 7 carry none, and the legacy
  // `flows`/`defaultFlow`/`roleOverrides` below are then the truth (read, never written — R-134).
  readonly flow?: RepoFlow;
  // Absent means the doc's default 'wait_resume' until #1012 makes the field required.
  readonly defaultLimitPolicy?: LimitPolicy;
  readonly flows: readonly FlowSlug[]; // enabled flows
  readonly defaultFlow: FlowSlug;
  readonly commandSets: Readonly<Record<string, readonly string[]>>; // name → shell commands, run in order
  readonly roleOverrides: readonly RoleOverride[];
  readonly docsRoot: string; // default "docs"
  readonly testGlobs: readonly string[]; // used by WriteScope 'tests'
  readonly environments?: readonly EnvironmentDef[]; // default []
  readonly budget?: SpendCap; // repo spend limit (S5)
}

export type RoleOverride = { readonly id: RoleSlug } & Partial<Omit<RoleDef, 'id'>>;

/** One finding of the definitions validators. `path` is JSON-pointer-like; the UI maps `code`
 *  to its own copy, the message is for logs. */
export interface DefinitionIssue {
  readonly path: string; // JSON-pointer-like: "flows[0].stages[2].onFail.goto"
  readonly code: DefinitionIssueCode;
  readonly message: string; // English, for logs; the UI maps `code` to its own copy
}

export type DefinitionIssueCode =
  | 'invalid_slug' | 'duplicate_id' | 'unknown_role' | 'inactive_role' | 'unknown_stage'
  | 'forward_goto' | 'bad_attempts' | 'empty_flow' | 'unknown_capability' | 'unknown_flow'
  | 'default_flow_not_enabled' | 'unknown_command_set' | 'secret_literal' | 'missing_field' | 'wrong_type'
  | 'unknown_environment' | 'missing_promote_from' | 'promote_cycle'
  | 'env_command_set_missing' | 'duplicate_env_order'
  | 'empty_repos' | 'main_repo_not_listed' | 'bad_review_of'
  // R-140: raised by the plugin and command capability checks.
  | 'plugin_cycle' | 'unknown_argument'
  // Phase 7 addendum (docs/v2/domain.md §2): raised by the repo-flow contract — `pinFlow`
  // reports them at pin time, the `validate.ts` checks that raise them land with #1012.
  | 'binding_stage_mismatch' | 'unknown_role_version' | 'role_required' | 'role_forbidden' | 'duplicate_binding';

export interface Definitions {
  readonly roles: readonly RoleDef[];
  readonly flows: readonly FlowDef[];
  readonly capabilities: readonly CapabilityDef[];
  readonly project?: ProjectDef; // present in the project scope
  readonly repo?: RepoDef;
}
