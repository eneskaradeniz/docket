# Domain — contracts for Phase 1

This is the authoritative contract for `src/domain/`. Types and signatures here are **exact**: an
implementing issue may add private helpers, but must not rename, reshape, or drop anything below.
If a contract cannot work as written, stop and report it on the issue — do not improvise.

General rules for all of `src/domain/`:

- Pure functions over plain data. No classes with behaviour, no mutation of inputs (treat all inputs
  as `readonly`), no exceptions for expected failures — return `Result`.
- No I/O, no npm packages, no Node builtins, no `Date`, no `Math.random`. Time is passed in as
  `EpochMs`.
- Named exports only. Every module is re-exported from `src/domain/index.ts`.
- Tests: Vitest, colocated (`x.ts` → `x.test.ts`), written first. Every rule marked **R-n** below needs
  at least one test named after it (e.g. `it('R-3: unknown verdict never passes', …)`).

## Module dependency map

A module may import only from the modules listed for it (always through that module's `index.ts`).
This keeps Phase 1 issues independent and conflict-free.

| Module | May import from |
| --- | --- |
| `shared` | — |
| `definitions` | `shared`, `budget` |
| `quota` | `shared` |
| `budget` | `shared` |
| `proposal` | `shared` |
| `pages` | `shared` |
| `conversations` | `shared`, `pages` |
| `actions` | `shared`, `conversations` |
| `autonomy` | `shared`, `actions` |
| `resolver` | `shared`, `definitions`, `quota` |
| `gates` | `shared`, `definitions` |
| `providers` | `shared`, `quota`, `definitions` |
| `library` | `shared`, `definitions` |
| `flow` | `shared`, `definitions`, `gates`, `redaction` |
| `dispatch` | `shared`, `quota`, `budget` |
| `roadmap` | `shared`, `flow`, `definitions` |
| `usage` | `shared`, `providers` |
| `stage-output` | `definitions`, `pages` |
| `changes` | — |
| `redaction` | — |
| `connector` | `shared` |
| `scenarios` | every module above — **test files only**, no production code, no `index.ts` |

Row amendment (added 2026-10-16, #1247): `connector` — the connector manifest and its validation
(the #1247 addendum below) — imports `shared` only; the `scripts/check-layers.mjs` entry lands
with its implementing issue (follow-up 1 of #1247's list).

Row amendment (added 2026-10-13, #1046): `definitions` may import from `shared`, `budget`, **and `quota`** — `RepoFlow`'s `StageBinding` (§2 addendum) references `AccountRoute` and `LimitPolicy`, and `quota → definitions` would be the cycle those types close. `LimitPolicy` and `AccountRoute` stay in `quota/`; the `scripts/check-layers.mjs` entry lands with #1011.

Each module folder has an `index.ts` that re-exports its public API; `src/domain/index.ts` re-exports
every module. Issues edit only their own module folder. Cross-module scenario tests (e.g. v1 parity)
live in `src/domain/scenarios/` so no production module needs an extra dependency for a test.

---

## 1. `shared/` — Result, ids, actor, time

```ts
// shared/result.ts
export type Result<T, E> = { readonly ok: true; readonly value: T } | { readonly ok: false; readonly error: E };
export const ok = <T>(value: T): Result<T, never> => ({ ok: true, value });
export const err = <E>(error: E): Result<never, E> => ({ ok: false, error });

// shared/time.ts
export type EpochMs = number;           // UTC milliseconds since epoch
export const MINUTE: number;            // 60_000
export const HOUR: number;              // 3_600_000

// shared/ids.ts
declare const brand: unique symbol;
export type Branded<T, B extends string> = T & { readonly [brand]: B };

/** User-authored identifiers inside definitions: ^[a-z0-9][a-z0-9-]{0,62}$ */
export type Slug<B extends string> = Branded<string, B>;
export type RoleSlug = Slug<'role'>;
export type FlowSlug = Slug<'flow'>;
export type StageSlug = Slug<'stage'>;
export type GateSlug = Slug<'gate'>;
export type CapabilitySlug = Slug<'capability'>;
export type RepoSlug = Slug<'repo'>;
export type ProjectSlug = Slug<'project'>;
export type PhaseSlug = Slug<'phase'>;
export type TaskSlug = Slug<'task'>;
export type EnvSlug = Slug<'env'>;
/** Names a deciding rule set (D-10): 'permission-rules', 'gate-auto' — never free-form. (added 2026-10-15, #1191) */
export type PolicyId = Slug<'policy'>;

/** Runtime identifiers: ULID, 26 chars Crockford base32 (0-9 A-H J K M N P-T V-Z), uppercase. */
export type Ulid<B extends string> = Branded<string, B>;
export type WorkOrderId = Ulid<'work-order'>;
export type RunId = Ulid<'run'>;
export type AccountId = Ulid<'account'>;
export type PoolId = Ulid<'pool'>;
export type MeterId = Ulid<'meter'>;
export type ProposalId = Ulid<'proposal'>;
export type PageId = Ulid<'page'>;
export type QueueItemId = Ulid<'queue-item'>;

export type IdError = { readonly code: 'invalid_slug' | 'invalid_ulid'; readonly input: string };
export function parseSlug<B extends string>(input: string): Result<Slug<B>, IdError>;
export function parseUlid<B extends string>(input: string): Result<Ulid<B>, IdError>;
export function isSlug(input: string): boolean;
export function isUlid(input: string): boolean;

// shared/run.ts
export type RunOutcome = 'succeeded' | 'failed' | 'limit' | 'cancelled';

// shared/billing.ts — how a model's use is paid for on a route; the spend-consent boundary
// the providers capability records and the quota limit policy both speak.
export type Billing = 'included' | 'metered' | 'unknown';   // included = the plan covers it (verified); metered = billed per use (verified); unknown = not verified and never assumed free

// shared/thinking.ts — the effort scale and the user's thinking choice (P-30), shared because the
// resolver (RoleBinding) and providers (capability records) both speak them; providers re-exports
// EffortLevel so existing imports keep working.
export type EffortLevel = 'none' | 'minimal' | 'low' | 'medium' | 'high' | 'xhigh' | 'max' | 'ultra';
/** One of the three user levels, or an exact effort from advanced settings (the only way to reach
 *  `max` and `ultra`). */
export type ThinkingChoice =
  | { readonly level: 'fast' | 'balanced' | 'deep' }
  | { readonly effort: EffortLevel };
/** A model class a route resolves to a concrete model (P-29); shared for the same reason. */
export type Tier = 'strong' | 'balanced' | 'fast';

// shared/autonomy.ts — the autonomy scale and the user-only carve-out (added 2026-10-15, #1191, D-10)
export const AUTONOMY_LEVELS = ['manual', 'balanced', 'auto'] as const;
export type AutonomyLevel = (typeof AUTONOMY_LEVELS)[number];
/** The closed carve-out (D-10 answers 1 and 3): the `deploy` and `page_approval` gate kinds, the
 *  merge action (a forge merge and a local merge alike) and the delete action — no `policy` actor
 *  decides any of them at any level. */
export const USER_ONLY_GATES = ['deploy', 'merge', 'delete', 'page_approval'] as const;
export type UserOnlyGate = (typeof USER_ONLY_GATES)[number];

// shared/actor.ts
export type Actor =
  | { readonly kind: 'user'; readonly id: string; readonly label?: string }
  | { readonly kind: 'agent'; readonly runId: RunId; readonly role: RoleSlug }
  | { readonly kind: 'system'; readonly component: string }
  // The autonomy arm (added 2026-10-15, #1191, D-10): a named rule set that decided on the user's
  // behalf under a resolved level. Nothing else about the actor is free-form — the policy id names
  // the deciding rule set, the level is the one in force when it decided. No code creates this
  // actor yet (the D-10 split issues implement it); every exhaustive switch over `Actor` gains the
  // case — the list of doc locations that enumerate actors sits in the autonomy addendum.
  | { readonly kind: 'policy'; readonly policy: PolicyId; readonly level: AutonomyLevel };
```

Rules:
- **R-1** `parseSlug` accepts `^[a-z0-9][a-z0-9-]{0,62}$` only (lowercase, max 63 chars, no leading hyphen).
- **R-2** `parseUlid` accepts exactly 26 chars of Crockford base32, uppercase; rejects `I L O U` and lowercase.
- **R-59** `slugFromName(name, taken)` (shared/ids, used when a project is created from a name): first the fixed Turkish map `İ I ı → i`, `Ğ ğ → g`, `Ü ü → u`, `Ş ş → s`, `Ö ö → o`, `Ç ç → c`; then Unicode NFKD with combining marks removed; then lower case; every run of characters outside `[a-z0-9]` becomes one `-`; leading and trailing `-` are trimmed; the result is cut to 63 characters and trimmed again; an empty result is `project`. When the result is in `taken`, the first of `<base>-2`, `<base>-3`, … not in `taken` is returned, with `<base>` cut so the whole stays within 63 characters. The result always passes `parseSlug` (R-1). Signature: `export function slugFromName<B extends string>(name: string, taken: ReadonlySet<string>): Slug<B>;`

---

## 2. `definitions/` — roles, flows, gates, capabilities, project, repo

```ts
// definitions/types.ts
export type WriteScope =
  | { readonly kind: 'none' }                                   // read-only role
  | { readonly kind: 'docs' }                                    // the repo's docs root only
  | { readonly kind: 'tests' }                                   // test folders only (globs from the repo)
  | { readonly kind: 'repo' }                                    // the work order's worktree
  | { readonly kind: 'paths'; readonly globs: readonly string[] };

export interface RoleDef {
  readonly id: RoleSlug;
  readonly name: string;                   // display, verbatim user language
  readonly instructions: string;           // the role prompt
  readonly writeScope: WriteScope;
  readonly capabilities: readonly CapabilitySlug[];
  readonly active: boolean;
}

export type GateDef =
  | { readonly kind: 'human'; readonly id: GateSlug; readonly label: string }
  | { readonly kind: 'command'; readonly id: GateSlug; readonly commandSet: string }
  | { readonly kind: 'changes'; readonly id: GateSlug }    // the stage's run must have changed something
  | { readonly kind: 'agent_verdict'; readonly id: GateSlug; readonly role: RoleSlug }
  | { readonly kind: 'secret_scan'; readonly id: GateSlug }
  | { readonly kind: 'page_approval'; readonly id: GateSlug; readonly label: string }
  | { readonly kind: 'deploy'; readonly id: GateSlug; readonly environment: EnvSlug }
  | { readonly kind: 'remote_checks'; readonly id: GateSlug;
      readonly required: readonly string[] | 'all';
      readonly timeoutMinutes: number };

export interface StageDef {
  readonly id: StageSlug;
  readonly name: string;
  readonly role: RoleSlug | null;          // null = a human-only stage (e.g. staging test)
  readonly exit: readonly GateDef[];       // all must pass to advance
  readonly onFail?: { readonly goto: StageSlug; readonly maxAttempts: number };
  readonly tier?: Tier;                    // overrides the binding's tier for this stage
  readonly thinking?: ThinkingChoice;      // overrides the binding's thinking for this stage
  /** The earlier stage of the same flow whose output this stage reviews; its runs prefer another
   *  provider than the one that wrote it (R-52). */
  readonly reviewOf?: StageSlug;
}

export interface FlowDef {
  readonly id: FlowSlug;
  readonly name: string;
  readonly stages: readonly StageDef[];    // linear order; onFail may jump back
}

export type CapabilityDef =
  | { readonly kind: 'mcp'; readonly id: CapabilitySlug; readonly name: string; readonly command: string;
      readonly args: readonly string[]; readonly env: Readonly<Record<string, EnvValue>> }
  | { readonly kind: 'skill'; readonly id: CapabilitySlug; readonly name: string; readonly path: string }
  | { readonly kind: 'hook'; readonly id: CapabilitySlug; readonly name: string; readonly event: HookEvent; readonly command: string }
  | { readonly kind: 'context'; readonly id: CapabilitySlug; readonly name: string; readonly path: string };

/** A value is either literal (non-secret) or a reference to the keychain — never a secret literal. */
export type EnvValue = { readonly literal: string } | { readonly secretRef: string };
export type HookEvent = 'before_tool' | 'after_tool' | 'after_write' | 'run_end';

export interface RepoRef { readonly id: string; readonly remote: string; readonly defaultBranch: string }
// RepoRef is no longer declared in YAML: adapters build it from the repo checkout (git remote,
// default branch) when a forge or remote-checks operation needs it.

/** <main-repo>/.docket/project.yaml — the project layer above repos (S1). */
export interface ProjectDef {
  readonly id: ProjectSlug;
  readonly name: string;
  readonly mainRepo: RepoSlug;            // the roadmap and project.yaml live in this repo's .docket/
  readonly repos: readonly RepoSlug[];    // at least mainRepo; unique
  readonly budget?: SpendCap;             // project spend ceiling (S5): the sum over all repos
}

/** <repo>/.docket/repo.yaml — one repository's configuration. */
export interface RepoDef {
  readonly id: RepoSlug;
  readonly name: string;
  readonly flows: readonly FlowSlug[];              // enabled flows
  readonly defaultFlow: FlowSlug;
  readonly commandSets: Readonly<Record<string, readonly string[]>>;  // name → shell commands, run in order
  readonly roleOverrides: readonly RoleOverride[];
  readonly docsRoot: string;                         // default "docs"
  readonly testGlobs: readonly string[];             // used by WriteScope 'tests'
  readonly environments?: readonly EnvironmentDef[]; // default []
  readonly budget?: SpendCap;                        // repo spend limit (S5)
}

export interface EnvironmentDef {
  readonly id: EnvSlug;
  readonly name: string;
  readonly order: number;                             // promotion order, ascending
  readonly deploy: string;                            // commandSet name
  readonly verify?: string;                           // commandSet name (post-deploy smoke)
  readonly env: Readonly<Record<string, EnvValue>>;   // injected only during deploy/verify
  readonly protected: boolean;                        // stricter rules: separate approver, promoteFrom required
  readonly promoteFrom?: EnvSlug;                     // same commit must have a successful deploy there first
}

export type RoleOverride = { readonly id: RoleSlug } & Partial<Omit<RoleDef, 'id'>>;

export interface Definitions {
  readonly roles: readonly RoleDef[];
  readonly flows: readonly FlowDef[];
  readonly capabilities: readonly CapabilityDef[];
  readonly project?: ProjectDef;   // present in the project scope
  readonly repo?: RepoDef;         // present in the repo scope
}

// definitions/validate.ts
export interface DefinitionIssue {
  readonly path: string;        // JSON-pointer-like: "flows[0].stages[2].onFail.goto"
  readonly code: DefinitionIssueCode;
  readonly message: string;     // English, for logs; the UI maps `code` to its own copy
}
export type DefinitionIssueCode =
  | 'invalid_slug' | 'duplicate_id' | 'unknown_role' | 'inactive_role' | 'unknown_stage'
  | 'forward_goto' | 'bad_attempts' | 'empty_flow' | 'unknown_capability' | 'unknown_flow'
  | 'default_flow_not_enabled' | 'unknown_command_set' | 'secret_literal' | 'missing_field' | 'wrong_type'
  | 'unknown_environment' | 'missing_promote_from' | 'promote_cycle'
  | 'env_command_set_missing' | 'duplicate_env_order'
  | 'empty_repos' | 'main_repo_not_listed' | 'bad_review_of';

/** Validates untyped input (parsed YAML/JSON). All-or-nothing: any issue → err with ALL issues. */
export function validateDefinitions(input: unknown): Result<Definitions, readonly DefinitionIssue[]>;
```

```ts
// definitions/candidates.ts (added 2026-10-09, #850) — capability candidates found in an account's
// config before the user imports them (#715 part 1). 'hook' is deferred (executable code).
export type CapabilityCandidateKind = 'mcp' | 'skill' | 'context';
export interface CapabilityCandidate {
  readonly identity: string;                      // see rule R-62
  readonly kind: CapabilityCandidateKind;
  readonly name: string;
  readonly sources: readonly AccountId[];         // sorted, unique
  readonly command?: string;                      // mcp
  readonly path?: string;                         // skill / context
  readonly description?: string;
}
export function mergeCandidates(found: readonly CapabilityCandidate[]): readonly CapabilityCandidate[];
export function candidateToDefinition(c: CapabilityCandidate, id: CapabilitySlug): Result<CapabilityDef, 'unsupported_kind' | 'missing_command' | 'missing_path'>;
```

Rules:
- **R-3** All issues are collected; validation never stops at the first issue.
- **R-4** Ids are unique per kind (roles, flows, capabilities); stage ids unique within a flow; gate ids unique within a stage.
- **R-5** `stage.role` must exist and be `active`; `agent_verdict.role` must exist.
- **R-6** `onFail.goto` must name a stage at the same index or earlier (`forward_goto` otherwise); `maxAttempts` is an integer 1..10.
- **R-7** `command` gates must name a `commandSet` present in `repo.commandSets` when a repo definition is given.
- **R-8** A `CapabilityDef` env value that is a bare string (not `{literal}` / `{secretRef}`) is `wrong_type`; a `{literal}` whose key matches `/(KEY|TOKEN|SECRET|PASSWORD)/i` is `secret_literal`.
- **R-9** `repo.defaultFlow` must be listed in `repo.flows`, and every listed flow must exist.
- **R-62** (added 2026-10-09, #850) `CapabilityCandidate.identity` = `kind + ':' + name` for skill/context (case-sensitive) and `'mcp:' + name + '|' + command` for mcp (a missing command joins as the empty string; the gap surfaces at import as `missing_command`, never as a merge error); two candidates with equal identity are one capability. `mergeCandidates` derives the merge key from the candidate's own fields by this formula — an input's `identity` string is not the key — and writes the canonical identity into its output, so a scanner cannot drift the merge.
- **R-63** (added 2026-10-09, #850) `mergeCandidates`: equal identity → one candidate whose `sources` is the sorted unique union; first-seen order of identities otherwise; never mutates inputs; a conflicting `command`/`path`/`description` keeps the lexicographically smallest account's value (every source of a candidate backs its values; a value with no backing account loses to any account-backed one, and a tie keeps the first-seen value, so merging a merged output changes nothing).
- **R-64** (added 2026-10-09, #850) a candidate never carries an env value or a secret: the type has no field for one, and `candidateToDefinition` for `mcp` copies only the command string, never environment (`args` and `env` start empty; `description` is dropped — a `CapabilityDef` has no field for it).
- **R-65** (added 2026-10-09, #850) `candidateToDefinition` output passes `validateDefinitions`; `mcp` without command → `missing_command`; skill/context without path → `missing_path`; a kind outside `CapabilityCandidateKind` (the deferred `hook`, or a plain-JS caller's stray value) → `unsupported_kind`.
- **R-66** (added 2026-10-09, #853) `identityOfDefinition(def)` is R-62's form read off a stored definition: `'mcp:' + name + '|' + command` for mcp (a stored def always has its command, so there is no empty-join case), `kind + ':' + name` for skill/context/hook. Import's idempotence and the candidates query's `imported` flag compare a candidate's identity with this function's answer, so "already imported" and the merge (R-63) can never disagree about what a capability is.
- **R-67** (added 2026-10-09, #853) `capabilitySlugOf(name)` maps a candidate name to the target id an import takes — a `CapabilitySlug`, `^[a-z0-9][a-z0-9-]{0,62}$`: runs of ASCII letters/digits keep, lower-cased; every other run collapses into one `'-'`; leading/trailing `'-'` trimmed; a result over 63 cuts at 63 then trims again; an empty result (the name was all punctuation) is the `Result` error `invalid_name`, never a thrown error. Collision arm (architect decision, 2026-10-09): inside one import call ids are assigned in the order the identities are carried — an identity whose derived slug is already assigned in the same call takes `-2`, `-3`, … (the base cut so the whole id stays within the law); the assignment happens at derivation, before any store read, so it is deterministic.
- Note (added 2026-10-11, #866): a hook-kind capability is not importable — a hook runs a command on the operator's machine on provider events, so importing one would be a standing trust grant nobody asked for; the operator adds hooks by hand in the provider's own settings.
- **R-51** `stage.reviewOf` must name a stage of the same flow with a lower index and a non-null role (`bad_review_of` otherwise; a stage cannot review itself or a human-only stage). `stage.tier` must be a `Tier` and `stage.thinking` a `ThinkingChoice` (`wrong_type` otherwise).
- **R-46** `ProjectDef`: `repos` is non-empty (`empty_repos`), has no duplicates (`duplicate_id`), and
  contains `mainRepo` (`main_repo_not_listed`); a `budget`, when present, must be a valid `SpendCap`
  (`wrong_type` otherwise). Validated whenever a project is validated (project scope load, attach).
- **E-1** `EnvSlug` follows the same `parseSlug` rules as other slugs.
- **E-2** Environment ids are unique within a repo; `order` values are unique within a repo (`duplicate_env_order`).
- **E-3** `EnvironmentDef.deploy` and `verify` (when present) must name a `commandSet` present in `repo.commandSets` (`env_command_set_missing`).
- **E-4** A `deploy` gate's `environment` must name an environment in `repo.environments` (`unknown_environment`).
- **E-5** A `protected` environment must have `promoteFrom` set (`missing_promote_from`). `promoteFrom` must name another environment with a lower `order` value; an equal- or higher-order target reports `promote_cycle` — with unique `order` values (E-2), a non-descending chain and a cyclic one are the same defect class. The `promoteFrom` chain must be acyclic (`promote_cycle`).

### Addendum: repo-owned flows, roles, and versioned definitions (added 2026-10-12, #1003)

Under **D-1**, **D-4**, and **D-6**, flows, roles, assistants, and limit policy belong to the repository; a project carries no roles or flows and no "main repo". Library definitions are versioned and immutable; a repository flow binds concrete library role versions with an optional overlay or detached copy; work orders pin effective flow and role definitions at creation.

```ts
// definitions/repo-flow.ts (added 2026-10-12, #1003)
/** Which version of a library role a stage uses. `latest` is never stored: a binding always names a concrete version. */
export interface RoleRef {
  readonly roleId: RoleSlug;
  readonly version: number;                    // >= 1, a version that exists in the library
  readonly overlay?: RoleOverlay;              // per-repo changes on top of that version
  readonly detached?: RoleDef;                 // set → the repo owns this copy; roleId/version are provenance only
}
export type RoleOverlay = Partial<Omit<RoleDef, 'id' | 'active'>>;
export interface StageBinding {
  readonly stage: StageSlug;
  readonly role?: RoleRef;                     // absent exactly when the flow's stage has role === null
  readonly accounts: readonly AccountRoute[];  // ordered chain, first preferred (what RoleBinding.accounts was)
  readonly limitPolicy?: LimitPolicy;          // absent → the repo's defaultLimitPolicy
}
export interface RepoFlow {
  readonly flowId: FlowSlug;
  readonly version: number;                    // version of the library flow this was copied from (provenance)
  readonly stages: readonly StageDef[];        // the repo's own copy: edits here never touch the library
  readonly bindings: readonly StageBinding[];  // exactly one per stage, same order
}
// RepoDef gains (supersedes `flows`, `defaultFlow`, `roleOverrides` — kept readable for import only, R-134):
//   readonly flow: RepoFlow;
//   readonly defaultLimitPolicy: LimitPolicy;  // default 'wait_resume'
// ProjectDef loses `mainRepo` and carries no roles/flows: { id, name, repos, budget? }.

export interface VersionRecord<T> {
  readonly definitionId: string;
  readonly version: number;                    // contiguous from 1
  readonly body: T;                            // immutable once recorded
  readonly recordedAt: EpochMs;                // passed in; the domain reads no clock
  readonly archived: boolean;
}
export function nextVersion<T>(history: readonly VersionRecord<T>[]): number;
export function effectiveRole(ref: RoleRef, library: readonly VersionRecord<RoleDef>[]): Result<RoleDef, 'unknown_role_version'>;
export interface RoleUpdateProposal { readonly stage: StageSlug; readonly from: number; readonly to: number; readonly overlayFieldsChangedUpstream: readonly (keyof RoleOverlay)[] }
export function roleUpdateProposals(flow: RepoFlow, library: readonly VersionRecord<RoleDef>[]): readonly RoleUpdateProposal[];

export interface FlowPin {                      // what a work order records at creation
  readonly flowId: FlowSlug; readonly flowVersion: number;
  readonly stages: readonly { readonly stage: StageDef; readonly role: RoleDef | null; readonly roleVersion: number | null;
                              readonly accounts: readonly AccountRoute[]; readonly limitPolicy: LimitPolicy }[];
}
export function pinFlow(flow: RepoFlow, library: readonly VersionRecord<RoleDef>[], defaultLimitPolicy: LimitPolicy): Result<FlowPin, DefinitionIssue>;

export type RemovalVerdict =
  | { readonly kind: 'delete' }
  | { readonly kind: 'archive' }
  | { readonly kind: 'blocked'; readonly reasons: readonly RemovalBlock[] };
export type RemovalBlock = { readonly kind: 'running_work'; readonly workOrders: readonly string[] } | { readonly kind: 'dependant'; readonly of: 'stage' | 'binding'; readonly repo: RepoSlug; readonly stage?: StageSlug };
export function roleRemoval(roleId: RoleSlug, repos: readonly RepoDef[], pins: readonly { workOrder: string; running: boolean; pin: FlowPin }[]): RemovalVerdict;
export function accountRemoval(accountId: AccountId, repos: readonly RepoDef[], pins: readonly { workOrder: string; running: boolean; pin: FlowPin }[]): RemovalVerdict;
export function dependantsOfRole(roleId: RoleSlug, repos: readonly RepoDef[]): readonly { repo: RepoSlug; stage: StageSlug }[];
export function dependantsOfAccount(accountId: AccountId, repos: readonly RepoDef[]): readonly { repo: RepoSlug; stage: StageSlug }[];

export function limitPolicyFor(flow: RepoFlow, stage: StageSlug, defaultLimitPolicy: LimitPolicy): LimitPolicy;
```

`DefinitionIssueCode` gains members: `'binding_stage_mismatch' | 'unknown_role_version' | 'role_required' | 'role_forbidden' | 'duplicate_binding'`.

Rules:
- **R-126** (added 2026-10-12, #1003, supersedes R-46's `main_repo_not_listed` arm) `ProjectDef` has no `mainRepo`: R-46's `main_repo_not_listed` arm no longer exists (`empty_repos` and `duplicate_id` stay); a roadmap task's empty `targets` means the project's only repo when the project lists exactly one repo, otherwise the validated roadmap reports `target_required` (supersedes the "empty → [project.mainRepo]" wording of section 10).
- **R-127** (added 2026-10-12, #1003) A `RepoFlow`'s `bindings` hold exactly one binding per stage, in stage order; a count or order mismatch is `binding_stage_mismatch`, two bindings for one stage `duplicate_binding`.
- **R-128** (added 2026-10-12, #1003) A stage with `role === null` has no `role` on its binding (`role_forbidden` otherwise); a stage with a role has one (`role_required` otherwise); a `RoleRef` without `detached` must name an existing library version (`unknown_role_version`).
- **R-129** (added 2026-10-12, #1003) Library definition versions are immutable and contiguous from 1: `nextVersion([])` is 1, otherwise last+1; an edit never changes a recorded body.
- **R-131** (added 2026-10-12, #1003) `roleUpdateProposals` lists, per non-detached stage binding whose `version` is below the library's latest version of that role, one proposal `{from, to: latest, overlayFieldsChangedUpstream}` where the list names the overlay fields whose upstream value differs between the two versions; it never applies anything, never lists a detached stage, and is empty when everything is current.
- **R-132** (added 2026-10-12, #1003) `pinFlow` copies every stage with its effective role body and role version, accounts and effective limit policy (`limitPolicyFor`); the pin is self-contained: later edits, archiving or deleting library items or repo bindings do not change it. A work order stores its `FlowPin` at creation (A-324); a stage run record carries `flowVersion` and the stage's `roleVersion`; resume and retry use the pin, never the live repo flow.
- **R-133** (added 2026-10-12, #1003) Planner stage-skip: a planner may only PROPOSE skipping stages; the proposal is a ledger event `stage_skip_proposed {stages, reason}` and the human decision a ledger event `stage_skip_decided {approved}`; an approved skip marks those stages `skipped` for this work order only — the pin never changes; a stage whose exit gates include a `deploy` gate or a `human` gate cannot be proposed for skipping (invariant 1).
- **R-134** (added 2026-10-12, #1003) Deletion and archive: `roleRemoval`/`accountRemoval` return `blocked` when any pin with `running: true` references it or any repo stage still binds it (`dependant`), `archive` when only finished work orders' pins reference it, `delete` when nothing references it; archived definitions stay resolvable for pins and history but cannot be chosen for new bindings; the legacy `flows`/`defaultFlow`/`roleOverrides` fields are read only by the one-time import (#1004) and are never written.

Conflicts and supersessions (added 2026-10-12, #1003, D-1, D-4, D-6):
- **D-1** supersedes the Phase 3.5 project main-repo model in `ProjectDef` and `RepoDef`: `ProjectDef` loses `mainRepo` and carries no roles or flows (`{ id, name, repos, budget? }`); `RepoDef` gains `flow: RepoFlow` and `defaultLimitPolicy: LimitPolicy` (default `'wait_resume'`), superseding `flows`, `defaultFlow`, and `roleOverrides`. R-126 supersedes R-46's `main_repo_not_listed` arm (`empty_repos` and `duplicate_id` remain).
- **D-4** replaces monolithic unversioned role definitions without overlay or detach: replaced by library role (versioned) + per-repo overlay + optional detach (R-128, R-130).
- **D-6** replaces unversioned definitions and unconstrained lifecycle: library versions are immutable and contiguous from 1 (R-129); work orders pin flow and role versions at creation (R-132, A-324); removals default to archive and are blocked by running work or repo dependants (R-134). The legacy `flows`, `defaultFlow`, and `roleOverrides` fields on `RepoDef` are read only by the one-time import (#1004) and are never written.

### Addendum 2026-10-12 (#1006, D-4, D-7): Agent capabilities addendum — library, memory, commands and plugins

```ts
// definitions/types.ts — CapabilityDef addendum (added 2026-10-12, #1006). The existing four members stay.
export type CapabilityDef =
  | /* existing mcp | skill | hook | context */
  | { readonly kind: 'plugin';  readonly id: CapabilitySlug; readonly name: string; readonly source: PluginSource; readonly version?: string;
      readonly includes: readonly CapabilitySlug[] }                      // a package: bundles other capabilities (skills, commands, mcp, hooks)
  | { readonly kind: 'command'; readonly id: CapabilitySlug; readonly name: string; readonly template: string;   // prompt template, Docket renders it
      readonly arguments: readonly { readonly name: string; readonly required: boolean }[] };
export type PluginSource = { readonly kind: 'path'; readonly path: string } | { readonly kind: 'marketplace'; readonly marketplace: string; readonly name: string };

export type MemoryScope = 'global' | 'project' | 'repo';
export interface MemoryNote { readonly id: string; readonly scope: MemoryScope; readonly scopeId?: string; readonly text: string; readonly createdBy: 'user' | 'agent'; readonly active: boolean }
export interface MemoryProposal { readonly id: string; readonly scope: MemoryScope; readonly scopeId?: string; readonly text: string; readonly sourceRun: string; readonly state: 'pending' | 'accepted' | 'rejected' }
export const MEMORY_INJECTION_CAP_CHARS: number;      // 4000 per run, total over all scopes
export function selectMemory(notes: readonly MemoryNote[], ctx: { project?: string; repo?: string }): { readonly text: string; readonly truncated: boolean; readonly used: readonly string[] };

// definitions/validate.ts — new issue codes
export type DefinitionIssueCode =
  | /* existing codes */
  | 'plugin_cycle' | 'unknown_argument';
```

- **R-140** (added 2026-10-12, #1006) `validateDefinitions` accepts `plugin` and `command`; a `plugin.includes` entry must name an existing capability (`unknown_capability`) and a plugin may not include itself or form a cycle (`plugin_cycle`); a `command.template`'s `{{name}}` placeholders must all be declared in `arguments` (`unknown_argument`); new `DefinitionIssueCode`s: `plugin_cycle`, `unknown_argument`. R-8's secret-literal rule applies to plugin/mcp env as before.
- **R-141** (added 2026-10-12, #1006) `command` is a prompt template rendered by Docket itself (placeholder substitution), never a provider-native slash command: a provider that lacks native commands is therefore never `unsupported` for `command` (it is at worst `degraded` to `prompt_text`).
- **R-141** addendum (added 2026-10-14, #1184) Commands are agent-filled: the template rides the effective prompt as instruction text with its `{{placeholders}}` for the agent to fill from the task. There is no argument input path yet, so substitution by Docket is not claimed — this supersedes "rendered by Docket itself (placeholder substitution)" for now. `renderCommand` is kept for a future explicit-arguments path and is not wired.
- **R-142** (added 2026-10-12, #1006) Memory is propose-and-approve: an agent can only create a `MemoryProposal` (state `pending`); only a user decision makes a `MemoryNote`; optional auto-accept is a per-scope setting (`global`, `project`, `repo`), default off, and an auto-accepted note records `createdBy: 'agent'`.
- **R-143** (added 2026-10-12, #1006) `selectMemory` takes active notes of the global scope, the run's project and the run's repo (in that order, newest last), and stops at `MEMORY_INJECTION_CAP_CHARS` without cutting a note in the middle (the first note that would exceed the cap and everything after it is dropped, `truncated: true`).

Conflicts and supersessions (added 2026-10-12, #1006, D-7): Glossary "Capability — MCP, skill, hook, context" grows by plugin and command; "capabilities attached to roles" now also arrive through plugins; Phase 3.5 account-scoped capability candidates (R-62…R-67, #850–#866) stay as the import mechanism.

### Addendum: corrections to the repo contract snippets above (added 2026-10-14, #1180)

The snippets printed earlier in this section predate the 2026-10-12 addenda and read as current contracts; two corrections, each dated here without rewriting the text above (added 2026-10-14, #1180):

- The `ProjectDef` and `RepoDef` snippets above are historical: the current contract is the D-1 shapes of the repo-owned-flows addendum above — `ProjectDef` is `{ id, name, repos, budget? }` with no `mainRepo` and no roles or flows, and `RepoDef` has `flow: RepoFlow` and `defaultLimitPolicy` in place of `flows`, `defaultFlow`, and `roleOverrides` (added 2026-10-14, #1180).
- The `RepoRef` note above is likewise stale: adapters build `RepoRef` from the registry fingerprint captured at register or relink, with `defaultBranch: ''`; the default branch is read from the forge host when an operation needs it (added 2026-10-14, #1180). Known limitation, recorded here and deliberately not designed away in this change: a remote rename on the same folder never triggers relink, so the stored fingerprint remote can go stale (added 2026-10-14, #1180).

---

## 3. `resolver/` — the precedence chain

```ts
export type Level = 'workOrder' | 'repo' | 'project' | 'global' | 'builtin';
export const LEVEL_ORDER: readonly Level[];   // ['workOrder', 'repo', 'project', 'global', 'builtin']
export interface Layer<T> { readonly level: Level; readonly value: T | undefined }
export interface Resolved<T> { readonly value: T; readonly from: Level }

/** Most specific defined value wins, regardless of the input array's order. */
export function resolve<T>(layers: readonly Layer<T>[]): Resolved<T> | undefined;

/** Field-wise merge: overrides are applied in order least-specific → most-specific. */
export function applyRoleOverrides(base: RoleDef, overrides: readonly RoleOverride[]): RoleDef;

/** Machine-local binding of a role to an ordered chain of accounts (first = preferred).
 *  AccountRoute comes from quota/types.ts. */
export interface RoleBinding {
  readonly role: RoleSlug;
  readonly accounts: readonly AccountRoute[];
  readonly thinking?: ThinkingChoice;   // absent → { level: 'balanced' }
  readonly tier?: Tier;                 // for unpinned routes of the chain; absent → the CLI's own default model
}
/** What a stage run asks for: the stage's own setting wins over the binding's. */
export interface StageRouting { readonly tier?: Tier; readonly thinking?: ThinkingChoice }
export function stageRouting(stage: StageDef, binding: RoleBinding): StageRouting;
/** One chain entry with the provider definition id of its account (data, never a vendor name in code). */
export interface ChainEntry { readonly route: AccountRoute; readonly provider: string }
/** Review ordering (R-52): accounts on another provider than `reviewedProvider` move to the front. */
export function orderForReview(
  chain: readonly ChainEntry[],
  reviewedProvider: string | undefined,
): { readonly chain: readonly ChainEntry[]; readonly sameProvider: boolean };
export function resolveBinding(layers: readonly Layer<RoleBinding>[]): Resolved<RoleBinding> | undefined;
```

Rules:
- **R-10** `resolve` ignores `undefined` layers and picks by `LEVEL_ORDER`, not array position.
- **R-11** `applyRoleOverrides` never changes `id`; an override with a different id is ignored.
- **R-52** `stageRouting`: each field is the stage's when set, else the binding's, else absent. `orderForReview`: with `reviewedProvider` undefined the chain is returned unchanged and `sameProvider` is false; otherwise entries whose `provider` differs keep their relative order and come first, followed by the same-provider entries in their order; `sameProvider` is true when the first entry of the result has the reviewed provider (no other provider is available). Inputs are never mutated.

Project defaults sit between global and repo (S3): a repo's `.docket/` overrides the project, the
project overrides `~/.docket`; the work-order level resolves above all three.

### Addendum: repo flow role resolution and level simplification (added 2026-10-12, #1003)

Under **D-1** and **D-4**, roles and flows belong to the repository. The precedence chain no longer resolves role, flow, or capability definitions through the `project` level.

Rules:
- **R-130** (added 2026-10-12, #1003, supersedes project-level definitions resolution) `effectiveRole`: detached → the detached body; otherwise the library body of `roleId`@`version` with `overlay` applied field-wise (same field rule as `applyRoleOverrides`, `id` and `active` never overlaid); an unknown version is `unknown_role_version`. The resolver's `project` level carries no role, flow or capability layers any more (section 3: the level stays in `Level` for settings that remain project-scoped; supersedes the "Project defaults sit between global and repo" paragraph for definitions).

Conflicts and supersessions (added 2026-10-12, #1003, D-1):
- Supersedes the "Project defaults sit between global and repo" paragraph above for definitions: the `project` level carries no role, flow, or capability layers; those definitions are repo-owned or library-owned. The `project` level is retained in `Level` solely for settings that remain project-scoped.

---

## 4. `gates/` — gate evaluation

```ts
export type GateVerdict =
  | { readonly status: 'passed' }
  | { readonly status: 'failed'; readonly reason: string }
  | { readonly status: 'pending' }                              // waiting for evidence or a human
  | { readonly status: 'unknown'; readonly reason: string };    // we could not look

export interface GateEvidence {
  readonly commands?: Readonly<Record<string, { readonly exitCode: number } | undefined>>; // per command in the set
  readonly changes?: { readonly filesChanged: number; readonly noChangeNeeded?: boolean };
  readonly secretScan?: { readonly findings: number };
  readonly agentVerdict?: { readonly approve: boolean; readonly pointersResolved: boolean };
  readonly approval?: { readonly decision: 'approved' | 'rejected'; readonly by: Actor; readonly note?: string };
  readonly pageApproval?: { readonly decision: 'approved' | 'rejected'; readonly by: Actor };
  readonly deployment?: { readonly environment: EnvSlug; readonly commit: string;
    readonly result: 'success' | 'failed'; readonly approvedBy: Actor;
    readonly confirmedEnvironment?: EnvSlug };   // the environment id the user typed to confirm
  readonly remoteChecks?: { readonly checks: readonly CheckRunResult[];
    readonly status: 'all_passed' | 'has_failure' | 'pending' | 'timeout' };
}

export interface CheckRunResult {
  readonly name: string;
  readonly status: 'queued' | 'running' | 'passed' | 'failed' | 'cancelled' | 'skipped';
}

export type GateEvaluator<K extends GateDef['kind']> =
  (gate: Extract<GateDef, { kind: K }>, evidence: GateEvidence, ctx: GateContext) => GateVerdict;
export interface GateContext {
  readonly commandSets: Readonly<Record<string, readonly string[]>>;
  readonly environments?: readonly EnvironmentDef[];   // required to evaluate `deploy` gates
}

export const GATE_EVALUATORS: { readonly [K in GateDef['kind']]: GateEvaluator<K> };
export function evaluateGate(gate: GateDef, evidence: GateEvidence, ctx: GateContext): GateVerdict;
```

Rules:
- **R-12** `human` / `page_approval`: no decision → `pending`; `approved` → `passed`; `rejected` → `failed` with the note (or `"rejected"`).
- **R-13** `command`: an empty or unknown set → `unknown`. Otherwise, independent of the order results arrive in: if any command that has a result exited non-zero → `failed`, naming the first such command in set order; else if any command has no result yet → `pending`; else → `passed`.
- **R-14** `secret_scan`: missing → `pending`; `findings > 0` → `failed`; `0` → `passed`.
- **R-15** `agent_verdict`: missing → `pending`; `approve && pointersResolved` → `passed`; `approve && !pointersResolved` → `unknown` ("evidence pointers did not resolve"); `!approve` → `failed`.
- **R-16** `unknown` never counts as passed anywhere in the domain.
- **E-6** `deploy`: the gate's environment missing from `ctx.environments` (or `environments` absent) → `unknown`. Missing evidence → `pending`. `deployment.result === 'success'` → `passed`. `deployment.result === 'failed'` → `failed` with the environment id in the reason.
- **E-7** A `deploy` gate always requires a user approval in the evidence (`deployment.approvedBy` must be `kind: 'user'`). Without it → `pending`. This enforces invariant 1.
- **E-7** (amended 2026-10-15, #1191, D-10) A `policy` actor is never an accepted `deployment.approvedBy`: the approval stays `user`-only at every autonomy level — `deploy` sits in `USER_ONLY_GATES` (R-168). The rule above is otherwise unchanged; invariant 1 stands.
- **E-8** For a `protected` environment, `deployment.confirmedEnvironment` must equal the gate's `environment` (the user typed the environment id to confirm); absent or different → `pending`. (Docket is single-user: a rule requiring a *different* approver would make protected environments undeployable. A second-approver option arrives with team mode.)
- **E-9** `remote_checks`: `status === 'all_passed'` → `passed`; `status === 'has_failure'` → `failed` naming the first failed check; `status === 'timeout'` → `failed` with reason `timeout`; `status === 'pending'` → `pending`.
- **E-10** `deployment_attempted` event is appended exactly once per deploy-gate evaluation, carrying the redacted `outputTail` (same redaction as command gates: no env values, no secrets).
- **R-61** (added 2026-10-09, #839) `changes`: evidence absent → `pending`; `filesChanged > 0` → `passed`; `filesChanged === 0 && noChangeNeeded === true` → `passed`; otherwise → `failed` with reason `no changes`. Rationale: a `command` gate reads only exit codes, so an implement stage that changed nothing passed while its tests stayed green (#839); this gate turns "the run changed something" into explicit evidence — or, with `noChangeNeeded`, an explicit attestation that nothing needed changing. The gate is opt-in per flow definition; the evidence itself (counting the run's changed files) is produced outside the domain. The built-in flows do not use this gate until the evidence source exists; wiring it into `standard` is a follow-up.
- **R-61a** (amends R-61, 2026-10-09, #855) The evidence source now exists (application rule A-96) and the built-in `standard` flow wires the gate (R-68), so R-61's closing sentence no longer describes reality: the follow-up it names has landed. The evaluator itself is unchanged.

---

## 5. `flow/` — the work-order state machine (event-sourced)

A work order's state is **derived** from its flow definition plus its event history. Nothing else is
stored.

```ts
// flow/events.ts   (RunOutcome comes from shared/run.ts)
export type WorkOrderEvent =
  | { readonly type: 'created'; readonly at: EpochMs; readonly by: Actor; readonly flow: FlowSlug }
  | { readonly type: 'run_started'; readonly at: EpochMs; readonly runId: RunId; readonly stage: StageSlug; readonly attempt: number }
  | { readonly type: 'run_finished'; readonly at: EpochMs; readonly runId: RunId; readonly outcome: RunOutcome }
  | { readonly type: 'gate_evaluated'; readonly at: EpochMs; readonly stage: StageSlug; readonly gate: GateSlug; readonly verdict: GateVerdict }
  | { readonly type: 'blocked'; readonly at: EpochMs; readonly by: Actor; readonly reason: string }
  | { readonly type: 'unblocked'; readonly at: EpochMs; readonly by: Actor }
  | { readonly type: 'deployment_attempted'; readonly at: EpochMs;
      readonly stage: StageSlug; readonly gate: GateSlug;
      readonly environment: EnvSlug; readonly commit: string;
      readonly approvedBy: Actor;
      readonly result: 'success' | 'failed';
      readonly outputTail?: string }   // redacted like command gates — no env values or secrets
  | { readonly type: 'closed'; readonly at: EpochMs; readonly by: Actor };

// flow/derive.ts
export type WorkOrderStatus =
  | 'ready'            // the current stage has a role and no run yet for this attempt
  | 'running'          // a run started and has not finished
  | 'gating'           // run succeeded; some non-human gates not yet evaluated/passed (pending)
  | 'awaiting_human'   // only human/page gates are pending, or the stage has no role
  | 'limit_waiting'    // last run ended with outcome 'limit'
  | 'blocked'          // explicit block, or attempts exhausted, or unknown verdict
  | 'done';            // passed the last stage's gates, or closed

export interface WorkOrderState {
  readonly status: WorkOrderStatus;
  readonly stage: StageSlug | null;          // null only when done
  readonly attempt: number;                  // 1-based attempt of the current stage
  readonly pendingGates: readonly GateSlug[];
  readonly blockedReason?: string;
}
export function deriveWorkOrderState(flow: FlowDef, events: readonly WorkOrderEvent[]): WorkOrderState;

// flow/next-action.ts
export type FlowAction =
  | { readonly kind: 'start_run'; readonly stage: StageSlug; readonly role: RoleSlug; readonly attempt: number }
  | { readonly kind: 'evaluate_gates'; readonly stage: StageSlug; readonly gates: readonly GateSlug[] }
  | { readonly kind: 'await_human'; readonly stage: StageSlug; readonly gates: readonly GateSlug[] }
  | { readonly kind: 'wait_limit' }
  | { readonly kind: 'none' };
export function nextAction(flow: FlowDef, state: WorkOrderState): FlowAction;
```

Rules (derive walks events in order; events are assumed sorted by `at`):
- **R-17** After `created`, the state is the first stage, attempt 1: `ready` if it has a role, else `awaiting_human` with all its gates pending.
- **R-18** `run_started` → `running`. `run_finished` with `limit` → `limit_waiting`; `cancelled` → `ready` (same attempt); `failed` → apply the fail rule (R-21).
- **R-19** `run_finished: succeeded` → the stage's gates become pending; status `gating` if any non-human gate is pending, else `awaiting_human`. A stage with zero gates advances immediately (after its run succeeds, or on entry if it has no role). Human gates = `human` and `page_approval`.
- **R-20** `gate_evaluated` updates that gate. When **all** gates of the stage are `passed`, advance to the next stage at attempt 1 (`ready` / `awaiting_human` per R-17), or to `done` after the last stage.
- **R-21** A gate `failed` (or a run `failed`): if the stage has `onFail`, compute `next = (number of times the goto stage has been entered so far) + 1`. If `next ≤ maxAttempts`, enter `onFail.goto` with `attempt = next` and status `ready` (or `awaiting_human` if it has no role); otherwise `blocked` with a reason naming the gate (or `"run failed"`). Without `onFail` → `blocked`.
- **R-21a** "Entering" a stage = becoming the current stage (initially, by advance, or by goto). The first entry is attempt 1.
- **R-22** A gate `unknown` → `blocked` with its reason (never advances; see R-16).
- **R-23** `blocked` event → `blocked`; `unblocked` → back to the state before the block (re-derive without the block); `closed` → `done`. Events after `done` are ignored.
- **R-23a** While `blocked`, only `unblocked` and `closed` have an effect; any other event is ignored (it belongs to the blocked period). An empty event history derives the same state as a lone `created`. Block reasons: a failed run → `"run failed"`; a failed gate → `gate "<gate>" failed: <reason>`; an unknown gate → its verdict reason.
- **R-24** `nextAction`: `ready` → `start_run`; `gating` → `evaluate_gates` for pending non-human gates; `awaiting_human` → `await_human`; `limit_waiting` → `wait_limit`; others → `none`.

### Addendum: planner stage-skip derivation (added 2026-10-13, #1047, supplements R-133)

R-133 (§2 addendum, #1003) defines stage skipping as a proposal–decision pair of ledger events but
leaves the derive step unwritten. This addendum adds that rule and the state it produces. Nothing
above is revised: R-17…R-24 and the `WorkOrderStatus` union keep their text exactly as written; the
skip marks are an addition to `WorkOrderState`, and the two R-133 events join `WorkOrderEvent`.

- **R-144** `deriveWorkOrderState` derives `skipped` from the R-133 ledger events: a
  `stage_skip_proposed {stages, reason}` followed by `stage_skip_decided {approved}` marks the
  proposed stages `skipped` for this work order only when `approved` is `true`. `approved: false`,
  or a proposal without a decision yet, changes nothing — the state derives exactly as the rules
  above say it does, and the pinned flow never changes. A stage whose exit gates include a `deploy`
  or `human` gate cannot be proposed at all (R-133, invariant 1); if such a proposal–decision pair
  arrives in the ledger anyway, this rule silently ignores it and marks nothing `skipped`.

```ts
// flow/events.ts (added 2026-10-13, #1047, supplements R-133) — WorkOrderEvent gains the R-133 pair:
//   | { readonly type: 'stage_skip_proposed'; readonly at: EpochMs; readonly stages: readonly StageSlug[]; readonly reason: string }
//   | { readonly type: 'stage_skip_decided'; readonly at: EpochMs; readonly approved: boolean }

// flow/derive.ts — WorkOrderState gains:
//   readonly skippedStages: readonly StageSlug[];  // stages an approved proposal (R-144) skips, this work order only
```

### Addendum: the git lifecycle fold (added 2026-10-14, #1145, GI-2)

The four operator git actions (#1145) append their own ledger events, and the work order's git
state derives from them exactly the way the skip marks derive from the R-133 pair: beside the
machine fold, never inside it. Nothing above is revised — R-17…R-24 keep their text and the four
events are no-ops in the machine fold; a log without them derives the state the rules above
describe, with none of the new fields present.

```ts
// flow/events.ts (added 2026-10-14, #1145) — WorkOrderEvent gains the git lifecycle quartet:
//   | { readonly type: 'branch_pushed';   readonly at: EpochMs; readonly branch: string; readonly head: string }
//   | { readonly type: 'pr_opened';       readonly at: EpochMs; readonly number: number; readonly url: string; readonly head: string; readonly base: string }
//   | { readonly type: 'pr_merged';       readonly at: EpochMs; readonly number: number }
//   | { readonly type: 'branch_released'; readonly at: EpochMs }

// flow/git-lifecycle.ts — the fold and the one naming rule:
export interface GitBranchState { readonly name: string; readonly head: string; readonly pushedAt: EpochMs }
export interface GitPrState { readonly number: number; readonly url: string; readonly head: string; readonly base: string; readonly merged: boolean }
export interface GitLifecycleState { readonly branch?: GitBranchState; readonly pr?: GitPrState; readonly released?: true }
export const workOrderBranch = (id: WorkOrderId): string;  // 'docket/wo-' + id, lower case
export function deriveGitLifecycle(events: readonly WorkOrderEvent[]): GitLifecycleState;

// flow/derive.ts — WorkOrderState gains the lifecycle as optional fields, present only once their
// event folded in:
//   readonly branch?: GitBranchState; readonly pr?: GitPrState; readonly released?: true;
```

Rules (an event in an order a rule forbids is silently ignored — the refusal belongs to the writer
that would have appended it, never to the fold):
- **R-160** (added 2026-10-14, #1145) `pr_opened` folds in only over a prior `branch_pushed` whose
  `branch` equals the event's `head`; with no pushed branch, or a pushed branch under another
  name, the event is ignored and no pull request appears.
- **R-161** (added 2026-10-14, #1145) A second `pr_opened` while a pull request is open (`merged`
  false) is ignored — the state holds the first pull request, never a replacement. Once the open
  pull request merged, a later `pr_opened` over the pushed branch opens the next cycle.
- **R-162** (added 2026-10-14, #1145) `pr_merged` folds in only when its `number` equals the open
  pull request's number; with no pull request, a different number, or an already-merged one, the
  event is ignored and `merged` stays as it was.
- **R-163** (added 2026-10-14, #1145) `branch_released` folds in only after a `pr_merged`; with no
  pull request or an unmerged one the event is ignored and nothing is released. The release keeps
  the branch and pull request it closed over — `released` is an added mark, not an erasure.
- **R-164** (added 2026-10-14, #1145) After a `branch_released` folded in, every later git
  lifecycle event — of all four kinds — is ignored: the release closed the lifecycle, and the
  state stays exactly as the release froze it.
- **R-165** (added 2026-10-14, #1145) `deriveWorkOrderState` merges `deriveGitLifecycle`'s fields
  beside the machine state the way R-144 merges the skip marks: the four events are no-ops in the
  R-17…R-24 fold, and a log without them carries none of the three fields. `workOrderBranch` is
  the one naming rule — the ledger's `branch_pushed` events, the push action and the worktree
  port all derive the branch name from it, never from their own spelling.

---

## 6. `quota/` — accounts, pools, meters, limits

```ts
// quota/types.ts
export type AuthMode = 'subscription' | 'api_key' | 'cloud' | 'byok';
/** Which account (and optionally which model) a run is routed to. */
export interface AccountRoute { readonly accountId: AccountId; readonly model?: string }
export interface QuotaSource {
  readonly accountId: AccountId;
  readonly provider: string;            // provider def id, data only
  readonly authMode: AuthMode;
  readonly plan?: string;               // verbatim from the provider
}
export type PoolKind = 'allowance' | 'balance' | 'spend_cap' | 'throughput';
export interface Pool {
  readonly id: PoolId;
  readonly accountId: AccountId;
  readonly label: string;               // server-supplied, verbatim
  readonly kind: PoolKind;
  readonly appliesTo: readonly ModelMatcher[] | 'all' | 'unknown';   // 'unknown' is shown for information only, takes no part in headroom and never blocks a run
}
export type ModelMatcher = { readonly exact: string } | { readonly prefix: string };
export type Cadence = 'rolling_from_first_use' | 'rolling_continuous' | 'fixed' | 'calendar' | 'billing_cycle' | 'none';
export type MeterUnit = 'percent' | 'fraction' | 'requests' | 'prompts' | 'tokens' | 'credits' | 'usd' | 'minutes';
export type ObservationSource = 'pushed' | 'polled' | 'header' | 'captured_from_error' | 'estimated' | 'documented_rule' | 'unknown';
export type ResetPrecision = 'exact' | 'clock_only' | 'relative' | 'rule' | 'unknown';
export interface Meter {
  readonly id: MeterId;
  readonly poolId: PoolId;
  readonly label?: string;
  readonly cadence: Cadence;
  readonly durationMs?: number;          // from the provider when given; never hard-coded
  readonly unit: MeterUnit;
  readonly used?: number;
  readonly limit?: number;
  readonly remaining?: number;
  readonly resetsAt?: EpochMs;
  readonly resetPrecision: ResetPrecision;
  readonly observedAt: EpochMs;
  readonly source: ObservationSource;
  readonly staleAfterMs?: number;
}
export type LimitClass = 'window_exhausted' | 'balance_exhausted' | 'spend_cap' | 'throughput' | 'fair_use' | 'entitlement' | 'plan_expired' | 'unknown';
export type Remedy = 'wait' | 'switch_model' | 'enable_overage' | 'top_up' | 'admin';
export interface LimitHit {
  readonly accountId: AccountId;
  readonly poolId?: PoolId;
  readonly meterId?: MeterId;
  readonly class: LimitClass;
  readonly resetsAt?: EpochMs;
  readonly retryAfterMs?: number;
  readonly remedies: readonly Remedy[];
  readonly at: EpochMs;
}

// quota/headroom.ts
export function matchesModel(pool: Pool, model: string): boolean;
export function poolsForModel(pools: readonly Pool[], accountId: AccountId, model: string): readonly Pool[];
/** 0..1, or undefined when the meter carries no usable numbers. */
export function normalizedRemaining(meter: Meter): number | undefined;
export function isStale(meter: Meter, now: EpochMs): boolean;
export type Headroom =
  | { readonly ok: true; readonly lowest?: number }                        // lowest normalized remaining seen
  | { readonly ok: false; readonly blockedBy: readonly MeterId[]; readonly earliestRelief?: EpochMs; readonly byReserve?: true }
  | { readonly ok: 'unknown'; readonly reason: 'no_data' | 'stale' };
/** The share of a window the user keeps back for their own use (0..0.95). `short` applies to
 *  windows shorter than one day (e.g. five hours), `long` to windows of a day or longer (weekly,
 *  monthly). Absent or 0 → no reserve. */
export interface QuotaReserve { readonly short?: number; readonly long?: number }
export const RESERVE_MAX: number;           // 0.95
/** The class R-49 puts a meter in; `larger` = no window length and no calendar cadence, so the
 *  larger of the two values governs it. */
export type ReserveClass = 'short' | 'long' | 'larger';
export function reserveClassOf(meter: Meter): ReserveClass;
/** The reserve share that governs this meter under R-49 (0 when none). */
export function reserveFor(meter: Meter, reserve: QuotaReserve): number;
export function headroom(pools: readonly Pool[], meters: readonly Meter[], accountId: AccountId, model: string, now: EpochMs, reserve?: QuotaReserve): Headroom;

// quota/limit-policy.ts
export type LimitPolicy = 'wait_resume' | 'switch_pool' | 'fallback_account' | 'ask';
export interface PoolCandidate {
  readonly poolId: PoolId;
  readonly billing: Billing;
  readonly consented: boolean;
}
export interface FallbackCandidate {
  readonly route: AccountRoute;
  readonly billing: Billing;
  readonly consented: boolean;
}
export interface LimitContext {
  readonly policy: LimitPolicy;
  readonly autoResumesUsed: number;
  readonly maxAutoResumes: number;           // default 3
  readonly alternativePools: readonly PoolCandidate[];      // same account, pools with headroom for another model
  readonly fallbackAccounts: readonly FallbackCandidate[];  // next in the role's chain, with headroom
  readonly now: EpochMs;
}
export type LimitDecision =
  | { readonly kind: 'schedule_resume'; readonly at: EpochMs; readonly requeryFirst: true }
  | { readonly kind: 'switch_pool'; readonly poolId: PoolId }
  | { readonly kind: 'fallback'; readonly route: AccountRoute }
  | { readonly kind: 'ask'; readonly reason: 'policy' | 'no_reset_time' | 'max_resumes' | 'not_resumable' | 'billing_boundary' };
export const RESUME_JITTER_MS: number;      // 60_000
export function decideOnLimit(hit: LimitHit, ctx: LimitContext): LimitDecision;
```

Fallback and pool-switch candidates carry the billing of the target and whether the user consented
to it; a candidate that is not included is eligible only with consent, otherwise the decision falls
back to asking or waiting and its reason is `billing_boundary`.

Rules:
- **R-25** `matchesModel`: `'all'` matches everything; `exact` compares case-insensitively; `prefix` is a case-insensitive prefix.
- **R-26** `normalizedRemaining`: `fraction` → `remaining`; `percent` → `remaining / 100`; other units → `remaining / limit` when both known, else `used`/`limit` → `1 - used/limit`; clamp to 0..1; otherwise `undefined`.
- **R-27** `isStale`: `staleAfterMs` given and `now - observedAt > staleAfterMs`.
- **R-28** `headroom` ANDs every meter of every pool matching the model: any meter with normalized remaining `0` (or `remaining <= 0`) and (`resetsAt` undefined or `> now`) blocks. A meter whose `resetsAt <= now` is treated as unknown-but-not-blocking. `throughput` pools never block (they are transient). No meters at all → `{ok:'unknown', reason:'no_data'}`; all relevant meters stale → `'stale'`.
- **R-29** `earliestRelief` = the minimum `resetsAt` among blocking meters, if any.
- **R-49** Reserve: with a `reserve`, a non-throughput meter whose normalized remaining is known and `<=` its class's reserve (and `> 0`) blocks like an exhausted one (same `earliestRelief` rule). Class: `durationMs < 86_400_000` → `short`; `durationMs >= 86_400_000` → `long`; no `durationMs` → `long` for cadence `calendar` or `billing_cycle`, otherwise the larger of the two values. A meter whose normalized remaining is unknown never blocks by reserve. `byReserve: true` only when every blocking meter blocks by reserve alone. A reserve of `0` or absent changes nothing (R-28 unchanged). `reserveClassOf` returns that class (`larger` for the no-length, non-calendar case) and `reserveFor` the governing share (the class's value, the larger of the two for `larger`, 0 when absent); `headroom` uses `reserveFor`.
- **R-30** `decideOnLimit`:
  - `class` `throughput` → `schedule_resume` at `now + (retryAfterMs ?? MINUTE)` (does not consume an auto-resume).
  - `fair_use`, `entitlement`, `plan_expired`, `balance_exhausted`, `spend_cap` → `ask` with `not_resumable`, unless policy is `fallback_account` and a fallback exists.
  - policy `ask` → `ask`/`policy`.
  - policy `switch_pool`: first alternative pool if any, else fall through to `wait_resume`.
  - policy `fallback_account`: first fallback route if any, else fall through to `wait_resume`.
  - `wait_resume`: if `autoResumesUsed >= maxAutoResumes` → `ask`/`max_resumes`; if `resetsAt` → at `resetsAt + RESUME_JITTER_MS`; else if `retryAfterMs` → at `now + retryAfterMs`; else `ask`/`no_reset_time`.

### Addendum: stage limit policy resolution (added 2026-10-12, #1003)

Under **D-1**, limit policies are configured per stage binding on the repo flow, falling back to the repository's `defaultLimitPolicy`.

```ts
// quota/limit-policy.ts (added 2026-10-12, #1003)
export function limitPolicyFor(flow: RepoFlow, stage: StageSlug, defaultLimitPolicy: LimitPolicy): LimitPolicy;
```

Rules:
- **R-135** (added 2026-10-12, #1003) `limitPolicyFor` returns the stage binding's `limitPolicy`, else the repo's `defaultLimitPolicy`.

Conflicts and supersessions (added 2026-10-12, #1003, D-1):
- `LimitPolicy` and `decideOnLimit` (R-30) are UNCHANGED: no new variant; the UI word "notify" is `ask`. What is new is only where the value comes from.
- Conflict with Phase 3.5 account settings (#372–#382, A-51): the account-level limit behaviour of the accounts/limit settings (`account.save` / `SettingsAccountView.limitPolicy`) becomes the fallback used when a run has no repo/stage context (chat, probes); inside a work-order stage run the stage value (`limitPolicyFor`) wins.

Placement note (added 2026-10-13, #1046): `limitPolicyFor`'s single home is `definitions/repo-flow.ts` — the `// quota/limit-policy.ts` comment line in the code block above is superseded as its location, and R-135's rule text is unchanged. `LimitPolicy` and `AccountRoute` themselves stay in `quota/`; the module map's `definitions` row now allows importing `quota` (row amendment above).

---

## 7. `budget/` — spend caps (API accounts)

```ts
export interface SpendCap { readonly amountUsd: number; readonly warnPercent: number }   // warnPercent 1..100, default 80
export type SpendStatus = 'ok' | 'warn' | 'hard_stop';
export type CapScope = 'account_day' | 'account_week' | 'account_month' | 'project_month' | 'repo_month' | 'work_order';
export interface ScopedSpend { readonly scope: CapScope; readonly observedUsd: number; readonly cap?: SpendCap }
export function spendStatus(observedUsd: number, cap: SpendCap | undefined): SpendStatus;
/** The most restrictive status across all scopes, with the scope that caused it. */
export function combinedSpendStatus(spends: readonly ScopedSpend[]): { readonly status: SpendStatus; readonly scope?: CapScope };
```

Rules:
- **R-31** No cap or `amountUsd <= 0` → `ok`. `observed >= amount` → `hard_stop`. `observed >= ceil(amount * warnPercent) / 100` (cent-exact, float-safe) → `warn`.
- **R-32** `combinedSpendStatus` ranks `hard_stop > warn > ok`; ties keep the first scope in input order.
- **R-48** Two-layer budget (S5): a run in repo `R` of project `P` is checked against the account's
  own caps (`account_day` / `account_week` / `account_month`), the repo cap (`repo_month`) and the
  project ceiling (`project_month` — observed spend is the sum over **all** repos of the project,
  so a repo with no spend of its own is still stopped when the ceiling is exhausted). Checks run
  in order repo limit → project ceiling; `combinedSpendStatus` decides (R-32). A `hard_stop` at
  `project_month` blocks new runs in every repo of the project; a `repo_month` stop blocks only
  that repo. Running runs are never killed (invariant 3). Work-order caps arrive in Phase 5.

---

## 8. `dispatch/` — the dispatcher's decision rule

```ts
export interface QueueItem {
  readonly id: QueueItemId;
  readonly workOrderId: WorkOrderId;
  readonly repo: RepoSlug;
  readonly stage: StageSlug;
  readonly route: AccountRoute;
  readonly priority: number;            // higher first
  readonly enqueuedAt: EpochMs;
  readonly notBefore?: EpochMs;         // e.g. a scheduled resume
  readonly thinking?: ThinkingChoice;   // from stageRouting (A-19); absent → balanced
  readonly tier?: Tier;                 // from stageRouting (A-19)
  readonly sameProviderReview?: true;   // a review stage found no other provider in the chain (R-52)
  readonly handoffOf?: RunId;           // the failed run this item continues from through the handoff pack (A-65)
}
export interface RunningRun { readonly workOrderId: WorkOrderId; readonly repo: RepoSlug; readonly accountId: AccountId }
export interface DispatchLimits {
  readonly global: number;                              // default 4
  readonly perRepo: number;                             // default 3
  readonly perAccount: Readonly<Record<string, number>>; // AccountId → max concurrent; absent = no extra limit
}
export interface DispatchSnapshot {
  readonly now: EpochMs;
  readonly running: readonly RunningRun[];
  readonly limits: DispatchLimits;
  readonly headroom: Readonly<Record<string, Headroom>>;          // QueueItemId → headroom for its route
  readonly spend: Readonly<Record<string, SpendStatus>>;          // QueueItemId → combined spend status
  readonly consent: Readonly<Record<string, ConsentReadiness>>;   // QueueItemId → spend-consent gate read (R-150)
}
export type ConsentReadiness = 'ok' | 'needed';                   // the queue-side spend-consent read (R-150)
export type WaitReason = 'not_before' | 'work_order_busy' | 'global_limit' | 'repo_limit' | 'account_limit' | 'consent' | 'quota' | 'budget';
export type DispatchDecision =
  | { readonly item: QueueItemId; readonly kind: 'start' }
  | { readonly item: QueueItemId; readonly kind: 'wait'; readonly reason: WaitReason; readonly until?: EpochMs };
export function decideDispatch(queue: readonly QueueItem[], snapshot: DispatchSnapshot): readonly DispatchDecision[];
```

Rules:
- **R-33** Items are considered by `priority` desc, then `enqueuedAt` asc, then `id` asc. Output has one decision per queue item, in that order.
- **R-34** Checks in this order, first failing wins: `notBefore > now` (`until` = notBefore) → a run for the same work order is running or already started in this decision → global limit → repo limit → account limit → spend `hard_stop` (`budget`; a project-ceiling stop waits every item of that project — R-48) → headroom `ok:false` (`quota`, `until` = earliestRelief) → headroom `'unknown'` is allowed (does **not** wait; the transport will learn) → `start`.
- **R-35** Starting an item counts toward the limits for the items after it in the same call.
- **R-150** (added 2026-10-14, #1187) An item whose snapshot consent readiness is `needed` — the executor's own spend-consent gate would refuse its route — waits with reason `consent` and is never started; an absent readiness never blocks. The check runs after the limit checks and before the budget and quota readings. Granting consent makes the next tick start the item.

---

## 9. `proposal/` — AI changes configuration only by proposal

```ts
export type ProposalStatus = 'pending' | 'approved' | 'rejected' | 'stale';
export interface Proposal {
  readonly id: ProposalId;
  readonly author: Actor;
  readonly createdAt: EpochMs;
  readonly target: string;              // definition file path relative to its root, e.g. "flows/odoo.yaml"
  readonly baseHash: string;            // hash of the file when proposed (computed outside the domain)
  readonly before: string;
  readonly after: string;
  readonly summary: string;
  readonly status: ProposalStatus;
  readonly decidedBy?: Actor;
  readonly decidedAt?: EpochMs;
}
export type ProposalError = { readonly code: 'not_pending' | 'stale' | 'self_approval' };
export function decideProposal(p: Proposal, decision: 'approved' | 'rejected', by: Actor, currentHash: string, now: EpochMs): Result<Proposal, ProposalError>;
```

Rules:
- **R-36** Only `pending` proposals can be decided.
- **R-37** Approving when `currentHash !== baseHash` → `err('stale')` (the caller then marks it `stale`); rejecting a stale proposal is allowed.
- **R-38** An `agent` actor can never approve (`self_approval`); only `user` actors approve.

---

## 10. `roadmap/` — phases, tasks, dependencies

The roadmap belongs to a **project** and is loaded from the main repo's `.docket/roadmap.yaml`;
changing the main repo moves where the roadmap is read from (it is never copied). Task completion
is unchanged (R-40): a task is done when all its linked work orders are done — which is how
"one work order per target repo" composes into a cross-repo task (S4).

```ts
export interface TaskDef {
  readonly id: TaskSlug;
  readonly title: string;
  readonly dependsOn: readonly TaskSlug[];     // any task in the roadmap
  readonly acceptance: readonly string[];
  readonly targets: readonly RepoSlug[];       // repos the task's work runs in; empty → [project.mainRepo] at load
}
export interface PhaseDef {
  readonly id: PhaseSlug;
  readonly name: string;
  readonly blockedBy: readonly PhaseSlug[];
  readonly tasks: readonly TaskDef[];
}
export interface Roadmap { readonly phases: readonly PhaseDef[] }
export type RoadmapIssueCode = 'invalid_slug' | 'duplicate_id' | 'unknown_task' | 'unknown_phase' | 'task_cycle' | 'phase_cycle' | 'cross_cycle' | 'missing_field' | 'wrong_type' | 'unknown_repo';
export interface RoadmapIssue { readonly path: string; readonly code: RoadmapIssueCode; readonly message: string }
export function validateRoadmap(input: unknown, project?: ProjectDef): Result<Roadmap, readonly RoadmapIssue[]>;

export type TaskStatus = 'planned' | 'waiting' | 'running' | 'done';
export type PhaseStatus = 'planned' | 'waiting' | 'running' | 'done';
export interface LinkedWorkOrder { readonly task: TaskSlug; readonly status: WorkOrderStatus }
export interface RoadmapView {
  readonly tasks: Readonly<Record<string, TaskStatus>>;    // TaskSlug → status
  readonly phases: Readonly<Record<string, PhaseStatus>>;  // PhaseSlug → status
  readonly runnable: readonly TaskSlug[];                   // in roadmap order
}
export function deriveRoadmap(roadmap: Roadmap, workOrders: readonly LinkedWorkOrder[]): RoadmapView;
```

Rules:
- **R-39** Task ids are unique across the whole roadmap; phase ids unique; all references resolve; cycles are reported with the ids involved in the message.
- **R-47** Every task's `targets` entries must be valid slugs; when a `ProjectDef` is passed to
  `validateRoadmap`, each target must be listed in `project.repos` (`unknown_repo`). Absent or empty
  `targets` default to `[project.mainRepo]` in the validated roadmap.
- **R-39a** Cross-graph deadlock → `cross_cycle`. Build a graph over tasks: an edge T → D for every `D` in `T.dependsOn`, and an edge T → X for every task X of every phase that T's phase is (transitively) `blockedBy`. A cycle in this graph that is not already reported as `task_cycle` is reported once as `cross_cycle`, naming its task ids. This check runs only when there is no `phase_cycle` (a phase cycle makes phases block themselves; it is the root cause and is reported on its own). (Example: task a in phase P1 depends on task b in phase P2, while P2 is blocked by P1.)
- **R-40** Task status: any linked work order not `done` → `running`; linked and all `done` → `done`; no linked work orders → `waiting` if any dependency is not `done` or the phase is blocked, else `planned`.
- **R-41** Phase status, first matching rule wins: (1) any task `running` → `running`; (2) at least one task and all tasks `done` → `done`; (3) blocked by a phase that is not `done` → `waiting` (this includes a blocked zero-task phase); (4) otherwise `planned` (including an unblocked zero-task phase). Finished work is never reported as waiting.
- **R-42** `runnable` = tasks with status `planned` (so dependencies done and phase not blocked).

### Addendum: roadmap task targets without main repo (added 2026-10-12, #1003)

Under **D-1**, projects no longer define a `mainRepo`. `RoadmapIssueCode` gains `'target_required'`.

Conflicts and supersessions (added 2026-10-12, #1003, D-1):
- Supersedes the `empty → [project.mainRepo] at load` wording of `TaskDef` and R-47's `Absent or empty targets default to [project.mainRepo] in the validated roadmap`: under R-126, a roadmap task's empty `targets` means the project's only repo when the project lists exactly one repo, otherwise the validated roadmap reports `target_required`.

### Phase 7 addendum: two-layer roadmap model (added 2026-10-12, #1005)

Under D-2 (see `docs/v2/decisions-phase7.md`), the roadmap becomes a two-layer model: repo roadmaps hold milestones and issues (tracked or local), while the project roadmap holds phases whose items link to repo milestones or issues, plus childless manual items. Progress derives from leaf items.

```ts
// roadmap/repo-roadmap.ts (added 2026-10-12, #1005)
export type IssueSource = { readonly kind: 'local' } | { readonly kind: 'tracker'; readonly tracker: string; readonly externalId: string; readonly url?: string };
export interface RepoMilestone { readonly id: string; readonly title: string; readonly dueAt?: EpochMs; readonly state: 'open' | 'closed'; readonly source: IssueSource }
export interface RepoIssue {
  readonly id: string;                           // ULID, Docket's own
  readonly title: string; readonly body?: string;
  readonly state: 'open' | 'closed';
  readonly milestone?: string;                   // RepoMilestone.id
  readonly labels: readonly string[];
  readonly parent?: string;                      // a local subtask has a parent RepoIssue.id
  readonly source: IssueSource;                  // a subtask is always { kind: 'local' }
}
export interface RepoRoadmap { readonly repo: RepoSlug; readonly milestones: readonly RepoMilestone[]; readonly issues: readonly RepoIssue[] }

export type RepoItemRef = { readonly repo: RepoSlug; readonly kind: 'milestone' | 'issue'; readonly id: string };
export type PhaseItem = { readonly kind: 'repo_item'; readonly ref: RepoItemRef } | { readonly kind: 'manual'; readonly id: string; readonly title: string; readonly done: boolean };
// PhaseDef gains: readonly items: readonly PhaseItem[]   (the project roadmap; TaskDef stays as the execution-planning unit)
export interface Progress { readonly done: number; readonly total: number }
export function deriveProgress(phase: PhaseDef, repoRoadmaps: readonly RepoRoadmap[]): Progress;
```

Rules:
- **R-136** (added 2026-10-12, #1005) A repo roadmap's ids are unique per kind; an issue's `milestone` and `parent` must resolve inside the same repo roadmap; a subtask (an issue with `parent`) has `source.kind === 'local'`; nesting is one level (a parent is never itself a subtask).
- **R-137** (added 2026-10-12, #1005) `deriveProgress` counts leaves: a `manual` item is one leaf (done when `done`); an `issue` ref is one leaf (done when `closed`; a subtask counts with its parent only as detail, not as extra leaf); a `milestone` ref expands to its non-subtask issues (one leaf each), and a milestone with no issues is one leaf done when `closed`; a ref that does not resolve counts as one not-done leaf; progress is never stored, only derived.
- **R-138** (added 2026-10-12, #1005) A phase's status derives from its Progress and its tasks: `total === 0` and no tasks → unchanged R-41; when items exist, `done === total` and all tasks done → `done`; any done leaf or running task → `running`; else per R-41 (supersedes R-41 only for phases that have items; phases without `items` keep R-41 byte for byte).
- **R-139** (added 2026-10-12, #1005) The project roadmap lives under `~/.docket/projects/<slug>/roadmap.yaml` (see #1004) and supersedes "loaded from the main repo's `.docket/roadmap.yaml`"; `PhaseItem` refs must name repos listed in `project.repos` (`unknown_repo`).

#### Conflicts and supersessions (added 2026-10-12, #1005)

- **Storage location:** The project roadmap is loaded from `~/.docket/projects/<slug>/roadmap.yaml` (D-2, D-5; see #1004), superseding the main-repo `.docket/roadmap.yaml` rule at the top of section 10.
- **Phase status derivation:** R-138 supersedes R-41 for phases containing `items`; phases without `items` keep R-41 byte for byte.
- **Execution units vs roadmap items:** `TaskDef` and roadmap tasks stay as the execution-planning unit for work orders and gain no tracker fields; tracker and issue links belong exclusively to `RepoRoadmap` (`RepoIssue`, `RepoMilestone`) and `PhaseDef.items` (`PhaseItem`).
- **Proposal model:** Imports into repo roadmaps are read-only mirrors (D-3) and do not create proposals, whereas modifications to the project roadmap's `PhaseItem` list remain proposals.

---

## 11. `providers/` — capabilities, tiers, the common event stream

```ts
// providers/capabilities.ts
export type Tri = boolean | 'unknown';
export interface ProviderCapabilities {
  readonly structuredStream: boolean;      // machine-readable events (SDK, JSON stream, ACP, app-server)
  readonly permissionAsk: Tri;             // can pause and wait for an approve/deny answer
  readonly resume: Tri;
  readonly mcp: Tri;
  readonly hooks: Tri;
  readonly skills: Tri;
  readonly images: Tri;
  readonly quotaReport: 'stream' | 'query' | 'error_only' | 'none';
  readonly costReport: 'reported' | 'computed' | 'equivalent' | 'credits' | 'none';
}

// providers/agent-event.ts
export type CostKind = 'reported' | 'computed' | 'equivalent' | 'credits';
// credits: the provider meters usage in its own credit unit; the amount is a number of credits
// in the provider's smallest unit.
export interface VerdictAskDetail {
  readonly verdict: 'approve' | 'reject';
  readonly summary: string;        // plain text, redacted, at most VERDICT_ASK_SUMMARY_MAX_CHARS (280)
  readonly pointerCount: number;   // how many evidence pointers the call names, never the pointers
}
export type AgentEvent =
  | { readonly type: 'session_started'; readonly at: EpochMs; readonly sessionRef: string }
  | { readonly type: 'text'; readonly at: EpochMs; readonly delta: string }
  | { readonly type: 'thinking'; readonly at: EpochMs; readonly delta: string }
  | { readonly type: 'tool_call'; readonly at: EpochMs; readonly id: string; readonly name: string; readonly target?: string }
  | { readonly type: 'tool_result'; readonly at: EpochMs; readonly id: string; readonly ok: boolean }
  | { readonly type: 'permission_ask'; readonly at: EpochMs; readonly id: string; readonly tool: string; readonly target?: string; readonly detail?: VerdictAskDetail; readonly options: readonly string[] }
  | { readonly type: 'usage'; readonly at: EpochMs; readonly inputTokens: number; readonly outputTokens: number; readonly cachedInputTokens?: number; readonly reasoningTokens?: number; readonly costUsd?: number; readonly costKind?: CostKind }
  | { readonly type: 'quota_signal'; readonly at: EpochMs; readonly meter: Omit<Meter, 'id' | 'poolId'> & { readonly poolLabel?: string } }
  | { readonly type: 'limit_hit'; readonly at: EpochMs; readonly hit: Omit<LimitHit, 'accountId' | 'at'> }
  | { readonly type: 'error'; readonly at: EpochMs; readonly class: 'auth' | 'network' | 'crash' | 'protocol' | 'timeout' | 'unknown'; readonly reason?: 'first_output_timeout' | 'inactivity_timeout'; readonly message: string }
  | { readonly type: 'finished'; readonly at: EpochMs; readonly reason: 'completed' | 'failed' | 'cancelled' | 'limit' }
  | { readonly type: 'raw'; readonly at: EpochMs; readonly line: string };

// providers/fold-run.ts
export interface RunSummary {
  readonly sessionRef?: string;
  readonly inputTokens: number;
  readonly outputTokens: number;
  readonly cachedInputTokens: number;
  readonly reasoningTokens: number;      // part of outputTokens, shown as its own line (P-30)
  readonly costUsd?: number;             // sum of events that carried a cost
  readonly costKind?: CostKind;          // the kind of the first costed event
  readonly toolCalls: number;
  readonly failedToolCalls: number;
  readonly openPermissionAsks: readonly string[];   // ask ids without a later tool_result of the same id
  readonly lastLimit?: Extract<AgentEvent, { readonly type: 'limit_hit' }>;
  readonly outcome?: RunOutcome;          // from 'finished': completed→succeeded, failed, cancelled, limit
}
export function foldRun(events: readonly AgentEvent[]): RunSummary;

// providers/catalog.ts — Thinking and EffortLevel as in provider-capabilities.md §1
/** The effort a run sends for a role's choice on one model; undefined → send nothing. */
export function effortForChoice(choice: ThinkingChoice | undefined, thinking: Thinking | 'unknown'): EffortLevel | undefined;

// providers/catalog.ts — the live row the catalog merge reads
/** A model as a live route reported it. The merge takes the row's own answers first; for the
 *  context window (P-29a): the live row's `contextWindow` when it is a positive integer,
 *  otherwise the matched registry record's `contextWindow` when it is a positive integer,
 *  otherwise `null`. Bundled-only entries use the registry record's value or `null`. */
export interface LiveModel {
  readonly id: string;
  readonly displayName?: string;
  readonly efforts?: readonly EffortLevel[];
  /** The billing state the route itself reported; it wins over the registry's when present. */
  readonly billing?: Billing;
  /** The canonical id an alias row stands for, as the provider reports it. */
  readonly resolvedId?: string;
  /** The row the provider uses when no model is pinned. */
  readonly isDefault?: true;
  /** The context window in tokens the route itself reported. A value that is not a positive
   *  integer is treated as absent. */
  readonly contextWindow?: number;
}

// providers/instructions.ts — the effective-instructions core (P-37); pure and provider-agnostic
/** The Docket layers: flow + stage + role. Deterministic; identical for every provider given the
 *  same definitions (P-37: behaviour does not depend on the provider). */
export function stageBrief(
  flow: FlowDef, stage: StageDef, role: RoleDef | null,
  workOrder: { readonly id: WorkOrderId; readonly title: string },
): string;

/** A stage's acceptance criteria rendered as checkable statements from its exit gates (command
 *  sets by name, secret_scan, agent_verdict role, human gates). StageDef carries no authored
 *  brief, so the gate rendering IS the criteria — an authored `brief` field is deliberately not
 *  added; it arrives only if the rendered criteria prove too thin. */
export function acceptanceCriteria(stage: StageDef, repo: RepoDef): readonly string[];

export interface RepoInstructionFile { readonly name: string; readonly content: string }
export interface InstructionBudget { readonly maxChars: number }
export const DEFAULT_INSTRUCTION_BUDGET_CHARS: number;   // 24_000
export interface InstructionPlan {
  readonly native: readonly string[];                 // names the provider reads itself; never inlined
  readonly inlined: readonly RepoInstructionFile[];   // truncated to the budget, candidate order
  readonly truncated: readonly string[];             // names that did not fit whole
}
/** `present` — the candidate files found in the worktree; `native` — the chosen provider's set.
 *  A file both native and present is never inlined. A non-native file is inlined whole while the
 *  budget allows, then truncated to the remainder with an end marker; later candidates are dropped. */
export function planInstructions(
  native: readonly string[],
  present: readonly RepoInstructionFile[],
  budget: InstructionBudget,
): InstructionPlan;
/** The prompt block: the inlined files under one "project context" heading that marks them as
 *  quoted repo data — never Docket instructions; files in plan order. */
export function renderInstructionBlock(plan: InstructionPlan): string;

// providers/handoff.ts — the handoff pack core (P-38)
export interface TaskState {
  readonly lastCommand?: { readonly name: string; readonly target?: string; readonly ok: boolean };
  readonly toolCalls: number;
  readonly failedToolCalls: number;
  readonly openPermissionAsks: readonly string[];
  readonly filesTouched: readonly string[];   // from the checkpoint diff — ground truth, not event targets
}
/** Deterministic extraction from run events (P-38 item 3). Raw transcripts never enter it. */
export function deriveTaskState(events: readonly AgentEvent[], filesTouched: readonly string[]): TaskState;

export interface RollingNote { readonly text: string; readonly capped: boolean }
export const ROLLING_NOTE_MAX_CHARS: number;            // 8_000
/** Pure fold: appends new text/thinking deltas and keeps the tail; `capped: true` once truncated. */
export function extendRollingNote(note: RollingNote | undefined, events: readonly AgentEvent[]): RollingNote;

export interface HandoffPack {
  readonly stagePrompt: string;                       // item 1 — stageBrief, recomputed (A-62)
  readonly acceptance: readonly string[];             // item 1
  readonly instructionPlan: InstructionPlan;          // item 2 — for the TARGET provider (P-37)
  readonly taskState: TaskState;                      // item 3
  readonly codeState: { readonly files: readonly string[]; readonly patch: string };   // item 4
  readonly summary: RollingNote;                      // item 5
  readonly definitionsChanged: boolean;               // the definitions changed since the first leg (A-62)
}
export interface PackBudget { readonly maxChars: number }
export const PACK_CHARS_PER_TOKEN: number;            // 4 — chars ↔ tokens estimate for sizing only
export const DEFAULT_CONTEXT_WINDOW_TOKENS: number;   // 32_768 — the stand-in for an unknown window; the fixed ceilings sit below it, so an unknown window sizes the pack to the ceilings alone (A-63)
/** Throttles checkpoint commits; no timer exists — the cadence is event-boundary + terminal (A-57). */
export const CHECKPOINT_MIN_INTERVAL_MS: number;      // 30_000
/** Deterministic truncation to the budget. Priority: stagePrompt and the Docket layers never
 *  truncate; then inlined files (reverse candidate order), then the patch body (file list kept,
 *  marker left in place of the cut), then the summary. */
export function sizeHandoffPack(pack: HandoffPack, budget: PackBudget): HandoffPack;
/** The continuation prompt: checks-first preamble, stage prompt, acceptance, effective
 *  instructions block, task state, code state, summary — fixed order, English. With
 *  `definitionsChanged` set, the note "definition changed since the first leg" follows the
 *  preamble; quoted repo material stays under its data heading (never Docket instructions). */
export function renderHandoffPrompt(pack: HandoffPack): string;
/** Pure 32-bit FNV-1a over the text, rendered as 8 lower-case hex chars. `executeRun` writes it
 *  as the run record's `definitionsRev` — the digest of the Docket layers the agent was given
 *  (`stageBrief`, then `role.instructions`); `buildHandoff` compares it to the current layers
 *  for `definitionsChanged` (A-62). */
export function definitionsDigest(text: string): string;
```

Rules:
- R-43 (retired): `supportTier` is replaced by `supportLevel` from the capability record (P-28); the function and its type are removed.
- **R-44** `foldRun` sums token counts across all `usage` events (`reasoningTokens` absent counts as 0); `sessionRef` is the last `session_started`; `outcome` maps from the last `finished` event.
- Addendum 2026-10-07: a `finished` event whose reason is `completed` maps to `failed` when at least one `usage` event was seen and the summed input and output tokens are both zero (an empty run). A stream with no `usage` event keeps the `completed` mapping. The decision never reads the text of any event.
- Addendum 2026-10-08: an `AgentEvent` `permission_answered { at, id, decision }` closes the open permission ask with the same `id`. `openPermissionAsks` lists asks in event order that have no later `permission_answered` of the same `id`; surfaces show the oldest open ask. The run executor persists the event as soon as the decision is known, next to the existing `permission.answered` audit entry, which stays.
- **R-50** `effortForChoice`: absent choice → `{ level: 'balanced' }`; a `level` maps through `thinkingFor`; an `effort` is sent as is when the model lists it, otherwise clamped down to the highest listed level below it, and undefined when none is below; `thinking` `unknown` or `{ kind: 'none' }` → undefined for every choice. A level the model does not list is never returned.
- **R-53** `stageBrief`/`acceptanceCriteria` are pure functions of the definitions — the same inputs render the same bytes; no timestamps, no account data, no provider ids. The acceptance criteria are rendered from the stage's exit gates because `StageDef` carries no authored brief; a `brief` field is added only if the rendered criteria prove too thin.
- **R-54** `planInstructions`: native files never inline; a file both native and absent is not an error; truncation markers name the file and the kept char count; the plan is a pure function of (`native`, `present`, budget).
- **R-55** `deriveTaskState` reads only `tool_call`/`tool_result`/`permission_ask` events; `extendRollingNote` reads only `text`/`thinking` deltas; neither sees the raw transcript. P-38 item 3's plan/done/remaining lists are not derivable from today's events: the deterministic core ships first, a plan-like structure arrives later as registry data (plan-tool names per provider), and the model-written summary stays open decision O-8.
- **R-56** `sizeHandoffPack` never drops `stagePrompt`, `acceptance` or the Docket layers, and never empties the pack: a budget below the untouchable core is a caller bug, not a smaller pack.
- **R-57** `renderHandoffPrompt` places "first run the stage's checks, then continue" as the first line (P-38: the new agent first runs the stage's checks) and never embeds a session ref, an account id, or environment values. With `definitionsChanged` set, the note "definition changed since the first leg" sits directly after the preamble — the change is surfaced to the continuation, never silently absorbed. `definitionsDigest` is deterministic: the same text always yields the same 8 lower-case hex chars, and different text yields a different digest (A-62's rev marker stands on this).
- **R-60** (added 2026-10-09) `foldRun` maps a `finished` event whose reason is `completed` to `failed` when the stream holds at least one `tool_call`, every counted tool result is a failure (`failedToolCalls === toolCalls`), and no `text` delta carried non-whitespace content — a run that tried only tools, all of which failed, and said nothing is not a success. Zero tool calls, a succeeded tool result, or a spoken answer in text keeps `succeeded`; the empty-run addendum under R-44 is unchanged. The run executor's `run.finished` audit names this flip `all_tool_calls_failed`, beside `empty_run` for the empty run.

### Account test classification (#716)

The account test ("Test et", [application.md](application.md) → "Account test") sends one small
real request and shows a classified result, never the model's output. The classification is pure.

```ts
// providers/account-test.ts
export type AccountTestClass = 'auth' | 'limit' | 'model' | 'network' | 'install' | 'unknown';
export type AccountTestStartFailure = 'not_installed' | 'not_logged_in' | 'spawn_failed' | 'unsupported';
export type AccountTestOutcome =
  | { readonly ok: true }
  | { readonly ok: false; readonly class: AccountTestClass; readonly detail: string };
export interface AccountTestInput {
  readonly startFailure?: { readonly code: AccountTestStartFailure; readonly message: string };
  readonly events: readonly AgentEvent[];   // the test run's events in arrival order; empty after a start failure
  readonly timedOut: boolean;               // the use case stopped the run at its deadline
}
/** The fixed request. English, no tools, one word back. */
export const ACCOUNT_TEST_PROMPT: string;          // 'Reply with the single word OK. Do not use any tools.'
export const ACCOUNT_TEST_DETAIL_MAX_CHARS: number; // 300
export function classifyAccountTest(input: AccountTestInput): AccountTestOutcome;
```

- **R-58** `classifyAccountTest` — the first matching line wins: (1) `startFailure` → `not_logged_in` is `auth`, `not_installed` and `spawn_failed` are `install`, `unsupported` is `unknown`, detail = its `message`; (2) any `limit_hit` event → `limit`, detail `''`; (3) `timedOut` → `network`, detail `'timeout'`; (4) the first `error` event: class `auth` → `auth`; `network` or `timeout` → `network`; `protocol`, `crash` or `unknown` → `model` when the message matches `/\bmodel\b[\s\S]*\b(not found|not available|unavailable|not supported|unsupported|invalid|does not exist|no access|not allowed)\b/i`, otherwise `unknown`; detail = that event's `message`; (5) a `finished` event with reason `completed` → `{ ok: true }`; reason `limit` → `limit`; any other reason, or no `finished` event → `unknown`, detail `''`. A detail is cut to `ACCOUNT_TEST_DETAIL_MAX_CHARS` code points. `text` and `thinking` deltas never reach a detail — the model's output is never shown. The function reads nothing but its input (same input → same outcome).
- **R-58a** (amends R-58, 2026-10-03, #735) `classifyAccountTest` returns the source message verbatim as `detail`, with no cut: cutting before redaction could split a token so its first part no longer matches a secret pattern. The 300-code-point cut belongs to the adapter, after redaction (I-35); `ACCOUNT_TEST_DETAIL_MAX_CHARS` stays exported from the domain as the shared bound.

---

## 12. `library/` — built-in roles and flows

Data only, validated by `validateDefinitions` in a test. Instructions are short English prompts the
user can edit; names are Turkish display names.

Roles (`RoleSlug` → name, write scope):
`planner` Planlayıcı (docs) · `analyst` Analist (docs) · `developer` Geliştirici (repo) ·
`test-writer` Test yazarı (tests) · `reviewer` Gözden geçirici (none) ·
`security-auditor` Güvenlik denetçisi (none) · `documenter` Belgeci (docs). All `active: true`,
`capabilities: []`.

Every built-in stage whose role is `reviewer` or `security-auditor` sets `tier: 'strong'` and `reviewOf` the flow's `implement` stage; no other built-in stage sets a tier or thinking.

Flows:
- `standard` Standart: `plan` (planner; human gate `plan-approval`) → `implement` (developer;
  `changes` gate `changes` first, then command gate `tests` on set `tests`, `secret_scan` gate
  `secrets`; `onFail: implement ×3`) → `review`
  (reviewer; `agent_verdict` gate `review-verdict` role reviewer, human gate `review-approval`;
  `onFail: implement ×3`) → `close` (role null; human gate `closure`).
- `quick-fix` Hızlı düzeltme: `implement` (developer; `tests`, `secrets`; onFail implement ×3) → `close`.
- `security-reviewed` Güvenlik incelemeli: standard, with a `security` stage (security-auditor;
  `agent_verdict` gate `security-verdict` role security-auditor + human gate `security-approval`;
  `onFail: implement ×3`) between `implement` and `review`.
- `research` Araştırma: `research` (analyst; `page_approval` gate `findings`).

```ts
export const BUILTIN_ROLES: readonly RoleDef[];
export const BUILTIN_FLOWS: readonly FlowDef[];
/** Command sets the built-in flows reference; a repo must define them to use those flows. */
export const BUILTIN_COMMAND_SET_NAMES: readonly string[];   // ['tests']
```

Rules:
- **R-45** `validateDefinitions({ roles: BUILTIN_ROLES, flows: BUILTIN_FLOWS, capabilities: [], repo: <fixture with commandSets.tests> })` is `ok`.
- **R-68** (added 2026-10-09, #855) The built-in `standard` flow's `implement` exit is
  `[changes, tests, secrets]` — the `changes` gate (R-61) sits first, so a run that changed
  nothing surfaces before the long test run (A-96 halts the machine pass at a measured zero).
  `quick-fix` and `security-reviewed` keep `[tests, secrets]`: the gate is opt-in per flow
  definition (R-61), and only `standard` — the flow whose empty-implement failure #839 exposed —
  wires it in this wave.

---

## 13. v1 parity (acceptance for the whole phase)

The `standard` flow must reproduce v1's work-order lifecycle. A scenario test
(`src/domain/scenarios/v1-parity.test.ts`) drives event sequences and asserts:

| Scenario | Expected state |
| --- | --- |
| created | `plan`, `ready` |
| plan run succeeded, plan-approval pending | `plan`, `awaiting_human` |
| plan approved | `implement`, `ready` |
| implement succeeded, changes > 0, tests pass, secrets 0 | `review`, `ready` |
| implement succeeded, changes 0, tests pass, secrets 0 | `implement`, `gating`, only `changes` pending |
| changes 0, attested no change needed | `review`, `ready` |
| changes 0, attested changes were needed | `implement`, attempt 2, `ready` |
| implement succeeded, tests fail (1st) | `implement`, attempt 2, `ready` |
| tests fail three times | `blocked` |
| review verdict approve but pointers unresolved | `blocked` (unknown) |
| review verdict + approval pass | `close`, `awaiting_human` |
| closure approved | `done` |
| run ended by limit | `limit_waiting` |

The changes rows (added 2026-10-09, #855) name the gate R-61 defines: a zero the machine
measures but cannot judge holds the stage in `gating` until a person attests one way or the
other (A-96); a `noChangeNeeded` attestation passes and its refusal sends the stage through
`onFail`.

Addendum 2026-10-10 (#872): `QueueItem` gains one optional field, `readonly requeryFirst?: true` — a
scheduled resume whose account quota is re-read before the item may start. The domain only carries
it: `decideDispatch` ignores it and its decisions are unchanged. The application owns the re-query
(A-101..A-104).

Addendum 2026-10-10 (#879): the `roadmap` module gains `PhaseAutoRun { project, phase, state:
'running' | 'paused' | 'done', startedAt, attention: readonly WorkOrderId[] }` and
`PhaseAutoRunState`. They are plain data the application persists (A-109 … A-116); the roadmap
derivation (R-40 … R-42) is unchanged and no new R-number is added.

Addendum 2026-10-10 (#881): the `dispatch` module gains `machine.ts` — `MachineSample { cores,
load1, freeMemRatio?, totalMemBytes }` (`freeMemRatio` absent = unknown), `LoadBand = 'free' |
'reduced' | 'busy'` and three pure functions. `decideDispatch` and R-33 … R-35 are unchanged.

- **R-69** (added 2026-10-10, #881) `loadBand(sample, previous)` enters a band on the per-core load `l = load1 / max(1, cores)`: `busy` when `l >= 1.0` or `freeMemRatio < 0.15`, from any previous band; otherwise `reduced` from `free` when `l >= 0.6`. Unknown free memory never forces a band.
- **R-70** (added 2026-10-10, #881) Hysteresis: the leave thresholds are lower than the enter ones and a band leaves one step per sample. From `reduced`, the band returns to `free` only when `l < 0.5`, so 0.55 after crossing 0.6 stays `reduced` and 0.45 returns to `free`. From `busy`, the band returns to `reduced` (never straight to `free`) only when `l < 0.85` and free memory is unknown or `>= 0.20`.
- **R-71** (added 2026-10-10, #881) `effectiveGlobal(cap, band, running)`: `free` answers `cap`; `reduced` answers `max(1, floor(cap / 2))`; `busy` answers `max(1, running)` — no new start while anything runs, but a machine with nothing running still makes progress. The answer is never above `cap`.
- **R-72** (added 2026-10-10, #881) `suggestDispatchCap({ cores, totalMemBytes })` is `min(floor(cores / 2), floor(totalMemGB / 4))` clamped to 1 … 16, with `totalMemGB = totalMemBytes / 2^30` and each term floored first: (10 cores, 16 GB) → 4, (4, 8) → 2, (2, 4) → 1, (32, 128) → 16.

Addendum 2026-10-10 (#890): the `proposal` module gains `diffLines(before, after): LineDiff` with `DiffLine { kind: 'same' | 'add' | 'remove', text }`, `LineDiff { lines, truncated }` and `DIFF_LINE_LIMIT = 5000`. `decideProposal` and R-36 and its neighbours are unchanged.

- **R-73** (added 2026-10-10, #890) `diffLines` splits each text into lines (one final newline ends the last line, it does not start an empty one, so `"a\n"` and `"a"` are the same lines; an empty text has no lines) and returns a longest-common-subsequence diff in document order: every common line is `same`, lines only in `before` are `remove`, lines only in `after` are `add`. When removing and adding are equally good the removal comes first, so the result is deterministic. Identical inputs give only `same`; two empty inputs give no lines. When either side has more than `DIFF_LINE_LIMIT` lines the result is one `remove` block (the whole `before`) and one `add` block (the whole `after`), each omitted when its side is empty, with `truncated: true`; otherwise `truncated` is false.

Addendum 2026-10-10 (#894): the `pages` module (imports `shared` only) holds the pure rules of agent-published pages: `PageKind`, `PageApproval`, `PageFileRef`, `PageVersion`, `PageComment`, `Page`, `PageError`, `PAGE_LIMITS`, `validatePagePath`, `pathsCollide`, `validatePageContent`, `publishPage`, `addVersion`, `addComment`, `requestApproval`, `decideApproval`, `markDelivered` and `sha256Hex` (a plain-TypeScript SHA-256, because the domain may not use a crypto library; the use case hashes each file with it so every `PageFileRef` carries a content hash). A page is untrusted content: the path rules exist to keep every file inside its version directory.

- **R-74** (added 2026-10-10, #894) A page file path is accepted only when it and its NFKC-normalised form are both plain: 1 … 200 characters; relative (no leading `/`); `/`-separated with no empty segment and no `.` or `..` segment; no backslash; no `:` anywhere (a Windows drive prefix such as `C:`, or an alternate data stream); no control character (NUL, newline, DEL included); no segment ending in `.` or a space (Windows drops them, so `..` followed by a space would open the parent). Judging the NFKC form too refuses look-alikes that fold into traversal: fullwidth full stops (U+FF0E), the two-dot leader (U+2025), fullwidth slash and backslash. A file set whose paths collide on disk — the same path, two names that fold together under NFKC plus lower-casing, or one path that is a file while another needs it as a directory (`a` and `a/b`) — is `bad_path`. `validatePagePath` answers a boolean; `validatePageContent` answers `bad_path` for the first violation.
- **R-75** (added 2026-10-10, #894) The entry must equal one of the file paths (`entry_missing`). The kind constrains the entry's extension, compared case-insensitively on its last dot: `html` → `.html`; `diagram` → `.mmd` or `.mermaid`; `markdown` → `.md`; `table` → `.csv` or `.json`; `image` → `.png`, `.jpg`, `.jpeg`, `.gif` or `.webp` only — never `.svg`, which can carry script; `report` → `.html` or `.md`. Anything else, and any kind outside the six, is `bad_kind`. A title is trimmed, non-empty (`empty_title`) and at most 120 characters (`title_too_long`).
- **R-76** (added 2026-10-10, #894) `PAGE_LIMITS` are `titleMax` 120, `filesMax` 64, `fileMaxBytes` 5 000 000, `pageMaxBytes` 20 000 000, `commentMax` 4 000. No files is `no_files`, more than 64 `too_many_files`; a file over 5 MB, or whose byte count is negative or not an integer, is `file_too_large`; a total over 20 MB is `page_too_large`. `validatePageContent` checks in this order: file count, paths and collisions, sizes, total, entry presence, kind. `sha256Hex` matches the FIPS 180-4 vectors (empty, `abc`, the 448-bit message, one million `a`) and never touches its input.
- **R-77** (added 2026-10-10, #894) `publishPage` makes version 1 with approval `none` and the creator and time recorded; the optional work-order and project links are present only when given. Versions are immutable and numbered 1 … n without gaps: `addVersion` appends `n + 1`, copies nothing earlier, never edits an earlier version or its input, and validates the new content against the page's kind. A new version resets `pending`, `approved` and `rejected` approval to `none` and drops `approvedVersion`: an approval is of one specific version.
- **R-78** (added 2026-10-10, #894) `requestApproval` moves `none` or `rejected` to `pending` (the latest version is the one asked about); from `pending` or `approved` it is refused with `not_pending` — the error set has no closer code. `decideApproval` checks in this order: the page is `pending` (`not_pending`); the actor is a user (an agent or system actor can neither approve nor reject: `self_approval`, the proposals' rule); `version` is the latest (`stale_version`). `approved` records `approvedVersion`; `rejected` records none.
- **R-79** (added 2026-10-10, #894) `addComment` accepts only a `user` actor in this slice — agents answer a comment by publishing a version — and refuses any other with `self_approval`, again the closest code. The text is trimmed, non-empty (`empty_comment`) and at most 4 000 characters (`comment_too_long`); the comment is pinned to an existing version (`unknown_version`, also for 0, negative and fractional numbers). `anchor` is kept as given when present; `deliveredAt` starts absent.
- **R-80** (added 2026-10-10, #894) `markDelivered` is pure and idempotent: it returns a new list in the same order with `deliveredAt = now` on each named comment that has none, leaves every other comment and an earlier delivery time untouched, ignores unknown and repeated ids, and never mutates its input.

- **R-74** addendum (added 2026-10-10, #894) A path is also refused (`bad_path`) when it contains a `%` (a URL decoder would turn `%2e%2e` into `..`) or any Unicode format character (category Cf: right-to-left override U+202E, zero-width space U+200B, isolates U+2066 … U+2069, BOM U+FEFF), which spoof file names in lists. Both are judged on the raw path and on its NFKC form, like the other path rules. A path such as `~/x` stays valid: it names an ordinary directory. The future viewer must resolve a requested file by exact match against the version's recorded paths, never by joining a decoded URL path.
- **R-81** (added 2026-10-10, #898) `RoleDef.docketTools?: boolean` — whether a run of the role is given Docket's own tools (default: yes). `validateDefinitions` accepts only a boolean there, in a role and in a `roleOverrides` entry (any other type is `wrong_type` at `roles[i].docketTools` / `repo.roleOverrides[i].docketTools`); an absent field stays absent in the parsed `RoleDef`. `applyRoleOverrides` carries the field through and an override replaces it; an unset one is not materialised as `true`.

Addendum 2026-10-10 (#913): the `conversations` module (imports `shared` and `pages` — for `validatePagePath` and nothing else) holds the pure rules of Docket AI conversations: `ConversationScope`, `ConversationRef`, `AttachmentRef`, `Artifact`, `TurnUsage`, `Message`, `Conversation`, `WorkOrderDraft`, `ConversationError`, `CONVERSATION_LIMITS`, `DRAFT_TITLE_MAX`, `startConversation`, `addUserMessage`, `addAssistantMessage`, `titleFrom`, `setPinned`, `validateAttachment`, `validateRef`, `newDraft`, `confirmDraft` and `dropDraft`. Message text, references and attachment names are untrusted data: the rules keep them small and plainly named, and attachments and artifacts travel by reference.

- **R-82** (added 2026-10-10, #913) A scope is `global`, `project` (a well-formed project slug) or `workOrder` (a well-formed ULID); anything else — a malformed slug or id, a missing field, an unknown or inherited kind such as `constructor`, a non-object — is `bad_scope` and makes no conversation. The stored scope is rebuilt from its known fields, so a `global` scope never carries a project.
- **R-83** (added 2026-10-10, #913) Message text is trimmed before anything else is judged and stored trimmed. A user message whose trimmed text is empty (spaces, tabs, newlines, NBSP) is `empty_message`, even when it carries references or attachments; more than `messageMax` (8 000) characters after trimming is `message_too_long`. An assistant message may have empty text only when it carries at least one artifact; otherwise `empty_message`.
- **R-84** (added 2026-10-10, #913) `titleFrom(text)` is the first line that has any content (lines end at CR, LF, CRLF, U+2028 or U+2029), each control character turned into a space, whitespace runs collapsed to one space and the ends trimmed; no such line gives `''`. At most `titleMax` (80) code points stay as they are; a longer line is cut to 79 code points (never inside a surrogate pair), trailing spaces dropped, and `…` appended. The function is deterministic. `startConversation` titles the conversation from its first message and sets `createdAt = updatedAt = now`.
- **R-85** (added 2026-10-10, #913) `validateRef` answers `bad_ref` unless the kind is one of `workOrder`, `page`, `file`, `project`, `repo` and the id fits it: a ULID (upper case, 26 characters) for `workOrder` and `page`, a slug for `project` and `repo`, and for `file` a repo slug in `repo` plus an id that passes the page-path rules of R-74 (relative, `/`-separated, no `..`, no backslash, no `:`, no NUL or control character, no `%`, no Unicode format character, no segment ending in `.` or a space, 200 characters at most, NFKC form judged too). A present `project` or `repo` field must be a slug. A message holds at most `refsMax` (12) references (`too_many_refs`, checked before any is judged); a stored reference keeps only its known fields.
- **R-86** (added 2026-10-10, #913) `validateAttachment` accepts a name only when it is one plain segment: it passes the R-74 path rules in raw and NFKC form, contains no `/` in either form, has no leading or trailing whitespace, no empty stem (`.png`) and an extension. The last extension, compared case-insensitively, must match the kind: `image` → `png`, `jpg`, `jpeg`, `webp` (never `svg`, which can carry script, and never `gif`); `text` → `md`, `txt`, `log`, `csv`, `json`; `pdf` → `pdf`. An active-content or executable extension anywhere before the last one (`svg`, `svgz`, `html`, `htm`, `xhtml`, `js`, `mjs`, `exe`, `bat`, `cmd`, `com`, `sh`, `ps1`, `jar`, `app`, `dll`, `scr`, `msi`, `vbs`, `php` — as in `a.exe.png`) is refused. Every violation is `bad_attachment`, as is an unknown kind or a byte count that is negative, fractional, `NaN` or infinite; more than `attachmentMaxBytes` (5 000 000) is `attachment_too_large`.
- **R-87** (added 2026-10-10, #913) A message holds at most `attachmentsMax` (5) attachments (`too_many_attachments`), each valid under R-86, together at most `attachmentsTotalMaxBytes` (15 000 000) bytes (`attachments_too_large`, judged after every attachment is individually valid). Each carries a ULID `id` not used by an earlier attachment of the same conversation or of the same message, and a lower-case 64-hex `sha256`; otherwise `bad_attachment`. One refused attachment refuses the whole message, and a stored attachment keeps only its five fields.
- **R-88** (added 2026-10-10, #913) Messages are append-only: `addUserMessage` and `addAssistantMessage` return a new conversation with the message last and `updatedAt` equal to the message time, never edit or reorder an earlier message, the title or `createdAt`, and never mutate their input. A conversation holds at most `messagesMax` (400) messages (`too_many_messages`, checked first, for both roles). A user message carries references and attachments and nothing else (artifacts, sources and usage in the input are dropped); an assistant message carries artifacts, sources and usage only — references or attachments in its input are refused (`bad_ref`, `bad_attachment`). An artifact is a reference by id: a `page` with a ULID and a version that is a positive integer, a `proposal` or `draft` with a ULID, or a `table` whose columns and every cell are strings and whose rows are as long as its columns; anything else is `bad_ref`, as are more than 12 artifacts, more than 12 sources, or a source that is empty or over 200 characters after trimming. `usage` keeps only the fields that are finite non-negative numbers and is absent when none remain.
- **R-89** (added 2026-10-10, #913) `setPinned` returns the conversation with only `pinned` changed. It does not touch `updatedAt` — that stays the time of the last message, so pinning never reorders the history — nor the messages; it is idempotent and never mutates its input. The `now` argument is accepted for callers that stamp it and ignored.
- **R-90** (added 2026-10-10, #913) `newDraft` makes a draft in status `draft` with a trimmed title (empty → `empty_message`; over `DRAFT_TITLE_MAX` (200) characters → `title_too_long`) and well-formed conversation id, draft id, project, repo and optional task (`bad_ref`). `confirmDraft(d, workOrder)` moves `draft` to `confirmed` and records the work order; `dropDraft` moves `draft` to `dropped`; both refuse any other status with `not_draft` — `confirmed` and `dropped` are terminal — and never mutate their input.

- **R-88** addendum (added 2026-10-10, review of #914) An assistant `table` artifact is bounded, because it is stored inside the conversation's one JSON row: at most `tableColumnsMax` (20) columns and `tableRowsMax` (200) rows (counts are judged before any cell is read), every cell and every column name at most `tableCellMax` (500) characters, and at most `tableTotalMax` (65 536) characters over all cells and column names together; any excess is `artifact_too_large`. A row that does not have exactly `columns.length` string cells stays `bad_ref` (malformed, not large). Exactly at a limit is accepted. The whole conversation is bounded too: when the JSON of the conversation with the new message appended would be longer than `conversationMaxBytes` (4 000 000) characters, `addUserMessage` and `addAssistantMessage` refuse with `conversation_too_large`. `ConversationError` gains `artifact_too_large`, `conversation_too_large` and `not_user`.

Addendum 2026-10-10 (#915): the `actions` module (imports `shared` and `conversations`) holds the pure rules of what Docket AI may do and under whose authority: `ActionClass`, `ACTION_CLASSES`, `SettingKey`, `SETTING_KEYS`, `ActionScope` (domain-local, never the application's `DefinitionScope`), `AssistantAction`, `ActionStatus`, `ActionAuthority`, `ActionRecord`, `UndoInfo`, `Grant`, `ActionError`, `ActionDecision`, `ACTION_LIMITS` (`grantMaxMs` 3 600 000, `grantMaxApplications` 25, `actionsPerConversationMax` 500, `valueMaxBytes` 4 096), `classOf`, `validateAction`, `newGrant`, `grantActive`, `revokeGrant`, `decideAction`, `recordApplied`, `newActionRecord`, `markApplied`, `markRejected`, `markFailed` and `markUndone`. `ActionClass` is a closed union and the only thing a grant can name: it is the never-list — a kind outside it (gate decisions, merges, deletions, account changes, spend consent, permission answers, deploy approvals, anything not yet imagined) is not an action at all. `ActionError` carries two codes beyond the issue's list, `not_user` and `not_assistant`, for the use cases' actor checks.

- **R-95** (added 2026-10-10, #915) `validateAction(input)` accepts exactly four kinds — `open_work_order { draft }`, `roadmap_edit { project, proposal }`, `definition_edit { scope, target, proposal }`, `setting_change { key, value }` — and rebuilds the action from its known own fields only (inherited properties are not input, extra fields are dropped, the input is never mutated). Any other kind (`gate_decide`, `merge`, `delete_work_order`, `account_save`, `spend_consent`, `permission_answer`, `deploy_approve`, `constructor`, `__proto__`, a different case), a non-object, an array, `null` or a missing or non-string `kind` is `bad_action`. A draft and a proposal must be ULIDs (upper case), a project and a repo slugs; a scope is `global` (rebuilt without any project), `project` or `repo`, otherwise `bad_action`. `classOf` is the action's kind.
- **R-96** (added 2026-10-10, #915) A `definition_edit` target is judged against the definition store's own vocabulary and nothing wider: `roles/<slug>.yaml`, `flows/<slug>.yaml` or `capabilities/<slug>.yaml` (slug `^[a-z0-9][a-z0-9-]{0,62}$`), `project.yaml` only in a project scope and `repo.yaml` only in a repo scope. Because every accepted shape is spelled out, `..` and `.` segments, absolute or drive paths, backslashes, `%`, control and Unicode format characters, look-alike characters, deeper folders, other extensions and upper case all fail with `bad_action`. `roadmap.yaml` is never a definition target in any scope — roadmap edits are the separate `roadmap_edit` class, which never carries a target (a target field in its input is dropped).
- **R-97** (added 2026-10-10, #915) A `setting_change` names a key from `SETTING_KEYS` (`dispatch.mode`, `dispatch.limits`; own property, exact match) or is `bad_setting_key`; a missing key is `bad_setting_key` too, a missing `value` `bad_action`. The value must be plain JSON — string, finite number, boolean, `null`, array or plain object of such values, at most 16 deep — otherwise `bad_action` (`undefined`, functions, symbols, bigint, `NaN`, infinities, `Date`, `Map`, class instances, cycles). Its JSON serialisation may be at most `valueMaxBytes` (4 096) UTF-8 bytes (exactly 4 096 is accepted), and a structure of more than 2 000 nodes is refused before it is serialised; both are `value_too_large`. Whether the value suits the key is the applier's judgement, not this module's.
- **R-98** (added 2026-10-10, #915) `newGrant` is `grant_not_user` unless `by` is a `user` actor (agent and system never create a grant). `classes` must be an array (`bad_class`), non-empty (`grant_empty`) and every member in `ACTION_CLASSES` (`bad_class`); duplicates are removed keeping the first-seen order. `ms` above `grantMaxMs` (one hour) is `grant_too_long` — refused, never clamped — and a value that is not a number, `NaN`, below 1 or fractional is `grant_expired` (the grant would never be active). The grant is `{ id, conversation, by: { kind: 'user', id }, classes, grantedAt: now, expiresAt: now + ms, applied: 0 }`, bound to its conversation.
- **R-99** (added 2026-10-10, #915) `grantActive(g, now)` is `grant_revoked` when `revokedAt` is set (checked first), `grant_expired` when `now ≥ expiresAt`, otherwise ok. `revokeGrant` stamps `revokedAt` once and returns the grant unchanged when it is already revoked (idempotent). `recordApplied` returns the grant with `applied + 1`. None of them mutates its input.
- **R-100** (added 2026-10-10, #915) `decideAction(a, grants, conversation, now)` first validates `a` (invalid → `refused` with that error, whatever the grants say), then answers `apply { grant }` for the first grant, in the given order, that belongs to `conversation`, was made by a `user`, names `classOf(a)`, is active (R-99) and has `applied` an integer in `0 … grantMaxApplications − 1`; otherwise `needs_approval`. So there is no cover for: no grant, an expired one (also exactly at `expiresAt`), a revoked one, one of another class (a grant of `open_work_order` never covers a `definition_edit`), one of another conversation, an exhausted one (the 25th application is the last), a grant whose creator is not a user, or a grant naming a class outside the closed list. It never mutates the grants.
- **R-101** (added 2026-10-10, #915) An `ActionRecord` moves only `pending → applied | rejected | failed` and `applied → undone`; every other transition is refused (`not_pending`, `not_applied`). `newActionRecord` makes a `pending` record without decision, failure or undo. `markApplied(r, by, undo, now)` needs an authority that is a user (non-empty id) or a grant (ULID) — otherwise `bad_action` — and stamps `decidedAt` and `decidedBy`; a carried `UndoInfo` is checked (`kind` one of `close_work_order`, `revert_proposal`, `restore_setting`; `ref` 1 … 200 characters without control characters; finite `expiresAt`) and rebuilt from those fields, otherwise `bad_action`. `markRejected` takes a user only (`not_user`). `markFailed` takes a stable code of 1 … 64 characters of `[a-z_]` (otherwise `bad_action`) and stores no other text. A record holds ids, codes and the action's own fields, never free text from a failure. No transition mutates its input.
- **R-102** (added 2026-10-10, #915) `markUndone(r, now)` needs status `applied` (`not_applied`) and then an undo window that is still open: a record without `undo`, or with `now ≥ undo.expiresAt`, is `undo_expired`. Inside the window the record becomes `undone` and keeps who applied it and the undo info; `undone` cannot be undone again.

Addendum 2026-10-10 (#919): `shared/search.ts` holds the one Turkish-aware search helper (`foldSearch`, `matchesSearch`) used by the artifact library and, later, the conversation history and the assistant's search tool; the `pages` module holds `PAGE_KIND_NAMES_TR` and `pageKindNameTr`, the single table of kind display names.

- **R-103** (added 2026-10-10, #919) `foldSearch(text)` is the canonical search form and never depends on the host's locale or ICU data: `İ` and `I` and `ı` and `i` all fold to `i` (the dotted and dotless capitals are replaced before lower-casing, so `İSTEK` and `istek` fold alike), the text is lower-cased, NFD-normalised with every combining mark dropped, `ğ ş ç ö ü` become `g s c o u`, every run of whitespace becomes one space and the ends are trimmed. A whitespace-only text folds to the empty string. It is idempotent: `foldSearch(foldSearch(x)) = foldSearch(x)`.
- **R-104** (added 2026-10-10, #919) `matchesSearch(haystack, query)` folds both sides; an empty or whitespace-only query matches everything, otherwise EVERY whitespace-separated token of the folded query must occur as a plain substring of the folded haystack (so `kal` honestly finds `kalem`; word starts are not required). A token also matches through its softened variant, which models Turkish consonant softening before a vowel suffix: only the LAST character `k`, `p` or `t` is replaced by `g`, `b` or `d`, and only for a token of at least 3 characters (`taslak` finds `taslağı`, `kitap` finds `kitabı`, `kanat` finds `kanadı`, `renk` finds `rengi`; `at` and `ap` get no variant, and `tapak` does not find `tabag` because two characters would have to change). There is no other fuzzy matching.
- **R-105** (added 2026-10-10, #919) `PAGE_KIND_NAMES_TR` names every `PageKind` in Turkish exactly once: `html` → `taslak`, `diagram` → `diyagram`, `markdown` → `metin markdown`, `table` → `tablo`, `image` → `resim`, `report` → `rapor`; `pageKindNameTr(kind)` reads it. Anything that shows or searches a kind's Turkish name uses this table.

Addendum 2026-10-10 (#927): a page may carry the conversation whose chat turn made it — `Page.conversation?: ConversationId`, set once at creation (`PublishInput.conversation`), the only ownership proof for chat page updates and the provenance the artifact library may later show. No other page behaviour changes.

- **R-106** (added 2026-10-10, #927) `publishPage` sets `conversation` exactly once, from the input's own field, when it is given; a page published without one has no `conversation` property at all. No other function of the module reads a conversation from any input: `addVersion`, `requestApproval`, `decideApproval` and `addComment` never set, change or drop it.
- **R-107** (added 2026-10-10, #927) The field is immutable for the page's life: every `addVersion` result carries the same `conversation` as the page it versioned (absent stays absent), and the approval round-trips keep it too. A page stored before the field existed — every run-made and operator page — reads as having none, so no conversation can claim an old page after the fact.

Addendum 2026-10-11 (#961): the `usage` module (imports `shared` and `providers` — for `CostKind`
and nothing else) folds per-run usage into a summary and names waste findings with their numbers:
`RunUsageInput`, `StageUsage`, `UsageSummary`, `WasteKind`, `WasteFinding`, `USAGE_THRESHOLDS`
(`planningShare` 0.4, `planningMinRuns` 5, `retryAttempts` 3, `cacheRatio` 0.2,
`cacheMinInputTokens` 50 000), `PLANNING_STAGE_IDS` (`plan`, `research`), `summarizeUsage`,
`findWaste`. Pure data rules: no clock, no randomness, inputs never mutated, the same input always
folds to the same summary; `byStage` follows the order in which a stage first appears. Chat turns
stop losing their cache number on the way: `TurnUsage` (conversations) gains `cachedInputTokens?`.

- **R-108** (added 2026-10-11, #961) `summarizeUsage(inputs)` folds the list into one `UsageSummary`: overall `runs` is the input count, `tokens = inputTokens + outputTokens` on the summary and on every `StageUsage`, and every input lands in exactly one stage row — `runs` counted, `maxAttempt` the highest attempt seen there, the token, cache and cost fields summed. An empty list folds to all-zero counters with `byStage: []` and `planningShare` and `cacheRatio` 0 — never `NaN` or `Infinity`. The function never mutates its input and the same list always folds to the same summary.
- **R-109** (added 2026-10-11, #961) `planningShare` is the token share (`input + output`) of the stages named in `PLANNING_STAGE_IDS` over all tokens. A stage outside the list — built-in like `implement` or a custom one like `verify` — counts as other. No tokens at all → 0.
- **R-110** (added 2026-10-11, #961) `cacheRatio` is summed `cachedInputTokens` over summed `inputTokens`; no input tokens (output-only runs) → 0. Both ratios are plain finite numbers for every input.
- **R-111** (added 2026-10-11, #961) `costUsd` is summed only over the inputs that carry it, on the summary and on each stage row. When no input of a scope carries it the field is absent there — an unknown cost is never reported as 0. A carried 0 is a real zero and stays.
- **R-112** (added 2026-10-11, #961) `findWaste(summary, thresholds?)` reports `planning_heavy` when `planningShare ≥ thresholds.planningShare` AND `runs ≥ thresholds.planningMinRuns` (both inclusive; the defaults are 0.4 and 5). The finding carries `{ share, runs }` — the summary's own numbers — and cites the rule id that fired. Omitting `thresholds` uses `USAGE_THRESHOLDS`.
- **R-113** (added 2026-10-11, #961) `retry_loop`: one finding per stage whose `maxAttempt ≥ retryAttempts` (3 by default, inclusive), carrying `{ attempts }` and the stage. `low_cache`: `cacheRatio < cacheRatio` threshold (0.2, strict) AND `inputTokens ≥ cacheMinInputTokens` (50 000, inclusive), carrying `{ ratio, inputTokens }`, no stage. Findings come in the fixed order planning, retry by stage id, cache; `findWaste` never mutates the summary.
- **R-114** (added 2026-10-11, #961) `TurnUsage` (conversations) gains `cachedInputTokens?` — a non-negative whole number when present, kept by the usage check like the other reported fields and dropped when it is not one. A value stored before the field existed — every stored turn — reads as having none.

Addendum 2026-10-11 (#968): cost by kind. A summary no longer carries one dollar total: `UsageSummary` and `StageUsage` replace `costUsd` with `costByKind`, and the module gains one pure display rule. This addendum amends R-111 — its text above stays as written; "carried cost is summed, absent stays absent" now holds per kind inside `costByKind`.

```ts
export type CostByKind = Readonly<Partial<Record<CostKind | 'unspecified', number>>>;
// RunUsageInput keeps costUsd?/costKind?. `credits` counts the provider's credit unit, not USD.
export type CostDisplay =
  | { readonly kind: 'money'; readonly usd: number; readonly estimate: boolean }
  | { readonly kind: 'tokens'; readonly equivalentUsd?: number }
  | { readonly kind: 'credits'; readonly credits: number }
  | { readonly kind: 'none' };
export function costDisplay(costByKind: CostByKind, billing: 'pay_per_use' | 'included' | 'unknown'): CostDisplay;
```

- **R-115** (added 2026-10-11, #968) `summarizeUsage` fills `costByKind` on the summary and on each stage row; every kind is summed separately over the inputs that carry a cost of that kind. A kind no input of the scope contributes to is absent, and `costByKind` itself is absent when no input carries a cost. A carried 0 is a real zero and stays. This replaces R-111's single total (R-111 is amended by this addendum, not deleted).
- **R-116** (added 2026-10-11, #968) An input with `costUsd` and no `costKind` is counted under `unspecified`.
- **R-117** (added 2026-10-11, #968) `costDisplay`. `pay_per_use` and `unknown` → `money` over `reported + computed + unspecified`, with `estimate` true when any `computed` or `unspecified` amount contributes; `equivalent` is never added to money. No money kind but `credits` → `credits`; nothing but `equivalent` → `tokens` with `equivalentUsd` (never shown as money). `included` → `tokens` with `equivalentUsd` when `equivalent` is present; with no equivalent, money kinds still show as `money` and credits-only as `credits`, so a real charge is never hidden. No cost at all → `none`.
- **R-118** (added 2026-10-11, #968) `summarizeUsage` and `costDisplay` are pure: the same input gives the same output and inputs are never mutated. An amount that is not a finite number is ignored by `costDisplay`, so no result carries `NaN`; an empty `costByKind` → `none`.

Addendum 2026-10-11: a completed stage must land a file inside its write scope. New module `stage-output` (imports `definitions` and `pages` only). `stageOutputVerdict` judges a run by the paths it changed; containment uses `validatePagePath`, the path rule that already refuses traversal, so a path is outside a scope when that rule rejects it. `stageOutputScopeRoot` is the directory or glob list the reminder names.

```ts
export type StageOutputVerdict = 'ok' | 'no_output' | 'not_applicable';
export type StageRunFinish = 'completed' | 'failed' | 'cancelled' | 'limit';
export interface StageOutputInput {
  readonly writeScope: WriteScope;
  readonly changed: readonly string[];
  readonly runOutcome: StageRunFinish;
  readonly docsRoot?: string;                 // absent → "docs"
  readonly testGlobs?: readonly string[];     // a `tests` scope
}
export function stageOutputVerdict(input: StageOutputInput): StageOutputVerdict;
export function stageOutputScopeRoot(
  writeScope: WriteScope,
  docsRoot: string | undefined,
  testGlobs: readonly string[] | undefined,
): string | undefined;
```

- **R-123** (added 2026-10-11, #979) `stageOutputVerdict`. A `docs` scope with a changed `docs/…` path (or a path under `docsRoot` when that field is set) → `ok`. Only a changed path outside the scope → `no_output`. No changed path → `no_output`. `none` → `not_applicable`. A finish other than `completed` → `not_applicable`. `tests` and `paths` are judged the same way against their globs (`*` in one segment, `**` across segments). `repo` is `not_applicable`: the scope is the whole worktree, and a zero-file tree stays the changes gate's measurement. The function is pure: the same input gives the same verdict and `changed` is never mutated.
- **R-124** (added 2026-10-11, #979) The verdict does not depend on path order. `docs/../src/x` is outside the docs scope, because the page-path rule rejects it before any prefix is considered. A path that fails that rule never counts as inside.
Addendum 2026-10-11 (#978): a rejected human gate retries the stage. R-21's "without `onFail` → `blocked`" stays for a failed run and for every non-human gate (`command`, `secret_scan`, `agent_verdict`, `page_approval`, and the rest). A rejected `human` gate on a stage that declares no `onFail` is the exception: it behaves as `onFail: { goto: <that stage>, maxAttempts: 3 }`. A stage that declares `onFail` keeps the goto and the limit it wrote. The shipped `plan` and `close` stages of `standard` and `security-reviewed`, and the `close` stage of `quick-fix`, now declare that same self-retry so a new data dir reads what runs; `research` is unchanged. The entry count is the same fold R-21a already keeps, so `cancelled` does not spend an attempt (R-18) and `unblocked` restores the pre-block entries (R-23).

- **R-120** (added 2026-10-11, #978) A rejected `human` gate on a stage without `onFail` re-enters that same stage at attempt + 1 (`ready` when it has a role, `awaiting_human` when it does not), with the stage's gates pending again. When the next entry would pass 3, the order is `blocked` at the current attempt and the reason is kept: `gate "<gate>" failed: <reason>`.
- **R-121** (added 2026-10-11, #978) A stage that declares `onFail` is unchanged by R-120: the goto target and `maxAttempts` are the ones written, including a limit of 1 and a goto to another stage. A failed `command`, `secret_scan`, `agent_verdict` or `page_approval` gate on a stage without `onFail` still blocks at the current attempt. A human reject on a mixed stage without `onFail` still retries.
- **R-122** (added 2026-10-11, #978) The retry count is pure: the same events fold to the same state and the inputs are not mutated. A `cancelled` run leaves the attempt where it was. An `unblocked` after the attempts are spent restores the state before the reject that blocked, and events that arrive while blocked (including another reject) do not change that restored count. Inserting a cancelled run, or a block that is then lifted, among the rejects does not change the attempt those rejects produced.

Addendum 2026-10-12 (#969): per-file counts from a unified patch. New module `changes` (no imports). `diffStatOf` reads a unified patch already redacted at the checkpoint boundary and returns one row per file. It does not return line text.

```ts
export interface DiffFileStat {
  readonly path: string;
  readonly added: number;
  readonly removed: number;
  readonly binary: boolean;
}
export function diffStatOf(patch: string): readonly DiffFileStat[];
```

- **R-119** (added 2026-10-12, #969) `diffStatOf` counts `+` and `-` lines per file. `+++` and `---` before the first hunk of that file are headers and are ignored; after a hunk the same characters are content and count as one line each. A rename is reported at the `rename to` path (the destination), including a quoted path. `Binary files … differ` and `GIT binary patch` mark the file binary and contribute no line counts — the binary body is not source. An empty patch yields no files. A deleted file keeps the source path and a new file the destination. The function is pure: the same patch yields the same rows and the patch text is not modified.

Addendum 2026-10-12 (#982): a work order may carry an optional description. `flow/description.ts` exports the pure check the application stores and the section a stage run quotes. The record stays valid when the field is absent. No migration.

```ts
export const WORK_ORDER_DESCRIPTION_MAX_CHARS: number; // 4_000
export function normalizeWorkOrderDescription(
  input: string | undefined,
): Result<string | undefined, 'description_too_long'>;
export function workOrderRequestSection(title: string, description: string | undefined): string | undefined;
```

- **R-145** (added 2026-10-12, #982) `normalizeWorkOrderDescription` trims first. `undefined`, `''` and whitespace-only become absent (`ok(undefined)`), not an error. A trimmed value longer than `WORK_ORDER_DESCRIPTION_MAX_CHARS` (4 000) is `description_too_long`; exactly 4 000 is kept. Token-shaped text is replaced with `[redacted]` and the surrounding text stays. The input is not mutated. `workOrderRequestSection` is a `## Request` section containing the title and the description when a description is present, with the same redaction; an absent or blank description returns `undefined`, so no empty section is produced.

Addendum 2026-10-12 (#993): one secret-shape rule. New module `redaction` (no imports). `flow` may import it. `redactSecretShapes` is the replacement both a work-order description and an operator note use. The shapes are unchanged.

```ts
export function redactSecretShapes(text: string): string;
```

- **R-125** (added 2026-10-12, #993) `redactSecretShapes` replaces each secret shape with `[redacted]` and leaves the surrounding text. Text that matches none of the shapes is returned unchanged. Applying it to its own output changes nothing. The same input yields the same output and the input is not modified.

Addendum 2026-10-13 (#1057): the one-time legacy import is removed.

- **R-134** (amended 2026-10-13, #1057) The clause "the legacy `flows`/`defaultFlow`/`roleOverrides` fields are read only by the one-time import (#1004) and are never written" is gone — nothing reads those fields anymore; the fields themselves are removed by #1012. The deletion-and-archive rules stand.

Addendum 2026-10-14 (#1104): re-linking a detached role. Domain and frontend only — the re-linked
binding enters the repo-settings draft and is saved by the existing repo save (`repo.saveFlow`);
no new command or query. `definitions/repo-flow.ts` gains the pure function.

```ts
// definitions/repo-flow.ts — exported through the definitions index (added 2026-10-14, #1104)
export type RelinkError = 'not_detached' | 'unknown_role_version';
export type RelinkKeep = 'overlay' | 'library';
export function relinkRole(
  ref: RoleRef,
  library: readonly VersionRecord<RoleDef>[],
  version: number,
  keep: RelinkKeep,
): Result<RoleRef, RelinkError>;
```

- **R-146** (added 2026-10-14, #1104) `relinkRole` is pure. A ref without `detached` is `not_detached`; a `version` absent from the role's library history is `unknown_role_version`. The result keeps `roleId`, sets `version`, has no `detached`. With `keep: 'library'` it has no overlay. With `keep: 'overlay'` its overlay holds exactly the `OVERLAY_FIELDS` whose value differs (by `sameValue`) between the detached body and the library body at `version`, and is omitted when none differ. For `keep: 'overlay'`, `effectiveRole(result)` equals the detached body in every field except `id` and `active`. Inputs are never mutated.
- **R-147** (added 2026-10-14, #1103) `copyFromRepo` copies exactly flow (bindings, roles by reference, overlays), default limit policy and command sets; docs root and test globs come from `detected`; no path of the source appears in the result; `copiedPaths` lists the copied top-level fields; inputs are never mutated.
- **R-148** (added 2026-10-14, #1103) `planImport` orders found repos alphabetically by name (case-insensitive, then path); non-git folders, paths already in the project and duplicate paths become skipped rows with their reason and never count toward `max`; the first `max` remaining rows are queued; `overflow` is the number of remaining rows beyond `max`; the function is pure and deterministic.
- **R-149** (added 2026-10-14, #1184) Capability support is looked up per (provider, kind, source kind) when a row declares `sourceKinds`: a `TranslationRow` may carry `sourceKinds?: readonly string[]` (absent = every source kind, behaviour unchanged); `supportFor(table, provider, kind, sourceKind?)` answers such a row `unsupported` — no `degradesTo`, the `how` naming the source kind — when the given source kind is not listed, and the row itself otherwise. `setupWarnings` and `translateCapabilities` pass a plugin capability's `source.kind`, so an undeliverable source kind fires the P-57 setup warning and lands in the P-59 omission record instead of being dropped silently.
- **R-166** (added 2026-10-14, #1146) A `gate_evaluated` event may carry `remoteChecks: { checks }` — the matched check list a `remote_checks` verdict was reduced from. The field is written only by a `remote_checks` verdict: `remoteChecksEvidence` builds it from at most the first `REMOTE_CHECKS_EVENT_MAX` (30) checks in forge order, each check name and one of the six `CheckRunStatus` words — no url, no environment value. Events without the field — every one recorded before it existed — fold exactly as before: the fold reads only the verdict.

### Addendum: autonomy levels and the policy actor (added 2026-10-15, #1191, D-10)

D-10 ([decisions-phase7.md](decisions-phase7.md)) adds three autonomy levels resolved down the
definition chain, and a `policy` actor that may decide some things on the user's behalf under them.
This addendum is the whole contract — no code exists for any of it yet; every rule names the D-10
split issue (2/5…5/5) that implements it. `manual` is the default and is exactly today's behaviour,
so until an implementing issue lands, everything behaves as `manual` whatever a definition carries.

```ts
// definitions/autonomy.ts (added 2026-10-15, #1191, D-10)
/** Starting or escalating to `auto` requires a spend cap governing the work order and an explicit
 *  onFail (with its maxAttempts) on every stage of the pinned flow; the refusal is typed, never silent. */
export type AutoLevelError = 'auto_requires_spend_cap' | 'auto_requires_max_attempts';
export function checkAutoLevel(
  input: { readonly cap: SpendCap | undefined; readonly flow: FlowDef },
): Result<void, AutoLevelError>;

// resolver/ — the chain read (D-10's resolution order is LEVEL_ORDER unchanged)
export interface ResolvedAutonomy { readonly level: AutonomyLevel; readonly source: Level }
export function resolveAutonomy(layers: readonly Layer<AutonomyLevel>[]): ResolvedAutonomy;

// definitions/types.ts — ProjectDef and RepoDef gain, beside `budget?: SpendCap`:
//   readonly autonomy?: AutonomyLevel;
```

Rules:
- **R-167** (added 2026-10-15, #1191, D-10) `resolveAutonomy(layers)` walks `LEVEL_ORDER` — work order > repo > project > global — and answers the first defined level with its `source` level for display; nothing defined anywhere → `{ level: 'manual', source: 'builtin' }`. Until the risk-rule table lands (D-10 issue 4/5), a defined `balanced` answers `{ level: 'manual', source: <the layer that set balanced> }` — the level is not offered and resolves as `manual`; a defined `auto` is returned as `auto`. The function is pure: the same layers always give the same answer and the inputs are never mutated. Implementing issue: D-10 2/5. Extended by R-151 (added 2026-10-16, #1225): only the order sentence above (work order > repo > project > global) is superseded — the widened `AUTONOMY_CHAIN_ORDER` governs; the `balanced`→`manual` clause, the fallback, purity and the `auto` pass-through stay as written.
- **R-168** (added 2026-10-15, #1191, D-10) `USER_ONLY_GATES` is the closed carve-out `deploy ∪ merge ∪ delete ∪ page_approval` (shared/autonomy.ts): the `deploy` and `page_approval` gate kinds, the merge action — a forge merge and a local merge alike (D-10 answer 1) — and the delete action. No `policy` actor decides any of them at any level, whatever the level-semantics table licenses elsewhere; they stay with the user (invariant 1; E-7, E-11, A-373). The constant is the single named contract: every check that must refuse a policy decision reads it, never its own copy of the list. Implementing issue: D-10 2/5.
- **R-169** (added 2026-10-15, #1191, D-10) `checkAutoLevel({ cap, flow })`, in this fixed order: `cap === undefined` → `err('auto_requires_spend_cap')`; else any stage of `flow` without `onFail` → `err('auto_requires_max_attempts')`; else `ok`. An `onFail`'s inner `maxAttempts` keeps R-6's law (integer 1..10) — what `auto` demands is that the bound is written, never implicit. The check runs wherever a level becomes or starts as `auto` (A-395), never for `manual` or `balanced`; it is pure and never mutates its input. Implementing issue: D-10 2/5.
- **R-170** (added 2026-10-15, #1191, D-10) A level change applies only to decisions made after it: gate verdicts already appended, stage skips already decided (the R-133/R-144 pair) and permission asks already answered keep their effect; the new level governs every decision from the moment it resolves (D-10 answer 5). The rule constrains every consumer of a resolved level — it adds no event, no field and no fold change; the ledger stays as it is. Implementing issue: D-10 2/5.
- **R-171** (added 2026-10-15, #1191, D-10) `ProjectDef` and `RepoDef` gain `autonomy?: AutonomyLevel` (absent on definitions stored before the field existed). A present value outside `AUTONOMY_LEVELS` is `wrong_type` — the typed validation error at the file the value came from (`projects/<slug>/project.yaml`, `repos/<slug>/repo.yaml`; I-107), never silently dropped and never read as `manual`. An absent value inherits down R-167's chain. Implementing issue: D-10 2/5.
- **R-172** (added 2026-10-15, #1191, D-10) What a level licenses is exactly the table below, and nothing else: a decision class the resolved level does not license stays human-decided, and an arm whose implementing D-10 issue has not landed behaves as `manual` until it does. No definition, field or actor widens the table. Implementing issue: D-10 4/5 (the table completes with the risk rules).

**Level semantics** (normative; one table — D-10):

| Level ↓ · decision class → | Tool-permission ask | Reversible `human` gate | Stage skip | `SpendCap` / `maxAttempts` |
| --- | --- | --- | --- | --- |
| `manual` (default; exactly today's behaviour) | Nothing is auto-decided — every ask waits for the user | The user decides | The R-133 proposal–decision pair, human-decided | Not required by the level |
| `balanced` | May be auto-allowed by deterministic rules only — the risk-rule table lands in D-10 issue 4/5; until it exists `balanced` is not offered and resolves as `manual` (R-167) | The user decides | The user decides (D-10 answer 4) | Not required by the level |
| `auto` | May be auto-allowed by the same deterministic rules (D-10 issue 2/5) | Decidable by a `policy` actor (`gate-auto`) for `human` gates outside `USER_ONLY_GATES` (the A-8 amendment; D-10 issue 3/5) | Decidable by a `policy` actor (`stage-skip-auto`) for proposals strictly ahead with no `USER_ONLY_GATES`/human gates, no earlier failed gates or rejected skips (R-189; D-10 issue 5/5) | Both mandatory — starting or escalating to `auto` without them is R-169/A-395's typed refusal |

**Why `project` participates in the chain.** D-1/D-4 removed the project level for roles, flows and
capabilities (R-130: "the level stays in `Level` for settings that remain project-scoped"). Autonomy
is exactly such a setting — a policy field resolved per work order, not a definition — so its chain
is the full `LEVEL_ORDER`: work order > repo > project > global > builtin. No role, flow or
capability layer returns; R-130's own sentence is what reserves the project level for this use.
The 2026-10-16 widening (#1225) adds flow and stage to this chain as *definition-origin* layers
(R-152/R-153), read from the pinned version — this restores no role, flow or capability layer of
`Level`: `Level` and `LEVEL_ORDER` do not change and R-10's `resolve` is not touched (R-130 stands).

**Where `Actor` is enumerated** — every exhaustive switch over `Actor` gains a `policy` case. The
existing doc locations that enumerate actors:

- `README.md` → Glossary "Actor" row (`user`, `agent`, or `system`) — architect file; gains `policy` with the first implementing D-10 issue.
- [architecture.md](architecture.md) → Team-ready rule 1 ("Every write carries an `Actor` (`user` / `agent` / `system`)") — architect file; same.
- §1 `shared/actor.ts` — the union itself (this addendum adds the arm).
- R-78 `decideApproval` ("an agent or system actor can neither approve nor reject") — a `policy` actor can neither (page approval sits in `USER_ONLY_GATES`, R-168); the arm is named when records first carry policy actors (D-10 issue 3/5).
- R-98 `newGrant`, E-11, and the application's "must be `user`" checks (A-166 addendum, A-180, A-181) — safe by construction: a `policy` actor is not a `user`, so every such check already refuses it; listed so the case is not forgotten.
- A-129 (labels by actor kind) and A-202 (provenance kinds) — gain a `policy` arm when records first carry policy actors (D-10 issue 3/5).

The application-side contracts of the same decision are A-394 … A-396
([application.md](application.md) → autonomy addendum); the storage homes and the serialization law
are the autonomy addendum of [infrastructure.md](infrastructure.md) (I-107).

### Addendum: the risk-rule table (added 2026-10-15, #1200, D-10 split 4/5)

D-10's balanced/auto tool-ask arm is licensed by exactly one deterministic table: `autonomy/risk.ts`
(new module; imports `shared` and `actions` — `actions` for `ACTION_CLASSES`, the single named list).
The executor wiring that consults it lands with D-10 2/5; until then the table is contract and
tests, consulted by no one, and every level behaves as `manual` (R-172).

```ts
// autonomy/risk.ts (added 2026-10-15, #1200, D-10 split 4/5)
export type RiskAsk =
  | { readonly kind: 'tool'; readonly tool: string; readonly arguments?: Readonly<Record<string, unknown>> }
  | { readonly kind: 'assistant_action'; readonly actionClass: ActionClass };
export interface RiskContext {
  readonly worktreeRoot?: string;
  readonly cwd?: string;
  readonly verificationCommands: readonly string[];
}
export type RiskVerdict =
  | { readonly verdict: 'low'; readonly rule: RiskRuleId }
  | { readonly verdict: 'needs_human' };
export interface RiskRule {
  readonly id: RiskRuleId;
  readonly verdict: 'low' | 'needs_human';
  readonly applies: (ask: RiskAsk, context: RiskContext) => boolean;
}
export const RISK_RULES: readonly RiskRule[];   // ordered: the deny floor first, allow rows after
export function classifyRisk(ask: RiskAsk, context: RiskContext): RiskVerdict;
```

- **R-173** (added 2026-10-15, #1200) `classifyRisk(ask, context)` walks `RISK_RULES` in order and answers the first match; **no match → `needs_human`** — default-deny is structural, not a branch. Unknown tool name, unknown action class, missing or malformed arguments, and absent `worktreeRoot`/`cwd`/`verificationCommands` where a row needs them reach no allow row. Pure: same inputs → same verdict, inputs never mutated, no `Date`, no randomness, no Node builtins; the function has no failure mode, so there is no `Result`. Path containment is lexical: `~` is never expanded, a relative path resolves against `cwd` only when `cwd` is absolute, `.`/`..` resolve lexically, and no symlink knowledge is claimed — the executor's sandbox owns the filesystem truth. A `'low'` carries the deciding row id (the evidence a policy actor records); `'needs_human'` carries nothing — the ask itself is the reason the user sees.
- **R-174** (added 2026-10-15, #1200) The read rows. `allow-own-read`: tool `docket_get` / `docket_search` — the bare names the SDK transport distills, Docket's own read-only MCP surface — is low unconditionally. `allow-read-search`: `Read` (`file_path`) and `Grep`/`Glob` (`path` optional, `pattern`/`glob`) are low exactly when every named path resolves lexically inside `worktreeRoot`; a search without `path` is low only when `cwd` is itself inside; a `pattern`/`glob` containing a `..` segment never matches.
- **R-175** (added 2026-10-15, #1200) `allow-git-read`: a `Bash` ask whose `command` is a plain single command — any of `` ; & | < > ( ) $ " ' ` `` or a line break disqualifies, because quoting and substitution are not parsed — is low for `git status`, `git log`, `git diff`, `git show`, `git blame`, `git rev-parse`, `git ls-files` with any arguments except one starting `--output` (diff and show can write their patch out) or
`--no-index` (a filesystem diff reads outside the worktree entirely); `git branch` only with flags from {`-v`, `-vv`, `-a`, `-r`, `-l`, `--list`, `--all`, `--no-color`} and no positional operand (`git branch <name>` creates, `-d` deletes); `git remote` bare or with `-v`/`--verbose` only (`git remote <verb>` writes config). Anything richer asks. Since #1327 the plain-command test also bans the expansion characters `\ * ? [ ] { } !`, `--contents` joins `--output` and `--no-index` (abbreviated spellings included), and a positional operand that is absolute, tilde-relative or has a `..` path segment asks (revision ranges like `main..feature`, `a...b`, `HEAD~3` stay low).
- **R-176** (added 2026-10-15, #1200) `allow-verify`: a `Bash` command equal to one entry of `context.verificationCommands` — after trim, nothing more; a mid-command whitespace difference is a different command — is low. Those are the strings Docket itself runs as the stage's command gates; the executor resolves them (stage command gates → repo commandSets) when it builds the context. The floor still wins: a declared command that is an install, a push or worse asks anyway.
- **R-177** (added 2026-10-15, #1200) The deny floor — absolute, evaluated first, no exceptions and no verify exemption. Never low: push and merge in every form (`git push` including force variants, `git merge`, `gh … merge`, hidden behind `&&` and `sudo` alike); destructive shell (`rm`, `rmdir` — `git rm` included — `git reset --hard`, `git clean`); network egress (the tools `WebFetch`/`WebSearch`; commands `curl`, `wget`, `nc`, `ncat`, `ssh`, `scp`, `sftp`, `rsync`, `ping`, `telnet` as the first token); secret and environment reads (a path named `.env`, `.env.*`, `*.pem`, `*.key`, `id_rsa*`, `credentials.json`, `.npmrc`, `.netrc` — read, written, or selected by a search pattern; the commands `env`, `printenv`, `history`); package installs (`npm`, `pnpm`, `yarn`, `bun`, `pip`, `pip3`, `uv`, `cargo`, `gem`, `composer`, `brew` followed by `install`, `i`, `add`, `ci`, `update`, `upgrade`; `npx` unconditionally — a fetch-and-run wrapper is an install by another name); writes outside the worktree, `~`-relative or unresolvable; and writes into git internals — a write whose resolved path has a `.git` segment, or whose basename is `.gitmodules`/`.gitattributes`, asks even inside the worktree, because it re-aims the repository rather than the change under review. This floor is the tool-level image of `USER_ONLY_GATES` (R-168): merge, deploy, delete and push stay human at every level. The floor scans whole token lists, so over-matching only ever costs the user one answer.
- **R-178** (added 2026-10-15, #1200) The assistant arm: `Record<ActionClass, RiskVerdict>` is exhaustive over `ACTION_CLASSES` at compile time — a new class without a row fails the build — and every class is `needs_human`: each has its own human-reviewed pipeline (§9 proposals, R-98 grants) and `open_work_order` commits real runs and spend. Widening is a deliberate docs change, never a drift; a runtime class outside the closed union has no row and asks.
- **R-179** (added 2026-10-15, #1200) `allow-write-inside` (the architect-approved addition to the issue's candidate list): `Edit`, `Write`, `NotebookEdit` with target lexically inside `worktreeRoot` is low — the worktree is the run's sandbox, checkpoint commits make the change reversible (A-57 … A-59), and the stage-output scope verdict reviews the diff. Outside, `~`-relative and unresolvable targets stay with the floor (R-177); secret-shaped basenames never match this row (R-177's secret clause covers writes too).

### Addendum: the gate-auto policy approval (added 2026-10-15, #1206, D-10 split 3/5)

D-10's `auto` level lets a `policy` actor approve a stage's human gates once its machine evidence
is concluded. The approval rides the same `gate_evaluated` event a user decision does, with its
own evidence field; the application contracts are A-8's amendment (the `policy_cannot_decide`
arm, coded by this split) and A-410/A-411.

```ts
// flow/events.ts — gate_evaluated gains (added 2026-10-15, #1206, D-10 split 3/5)
export interface PolicyGateApproval {
  readonly policy: PolicyId;                        // 'gate-auto' — the deciding rule set
  readonly level: AutonomyLevel;                    // the level in force at the decision
  readonly passedMachineGates: readonly GateSlug[]; // the current attempt's non-human exit gates, stage order
}
//   readonly approvedByPolicy?: PolicyGateApproval;

// flow/gate-auto.ts (added 2026-10-15, #1206, D-10 split 3/5)
export const GATE_AUTO_POLICY: PolicyId;
export interface GateAutoApproval {
  readonly gate: GateSlug;
  readonly policy: PolicyId;
  readonly level: AutonomyLevel;
  readonly passedMachineGates: readonly GateSlug[];
}
export const machineGateIds: (exit: readonly GateDef[]) => readonly GateSlug[];
export function decideGateAuto(
  flow: FlowDef, state: WorkOrderState, events: readonly WorkOrderEvent[], level: AutonomyLevel,
): readonly GateAutoApproval[];
```

- **R-180** (added 2026-10-15, #1206) A `gate_evaluated` event may carry `approvedByPolicy: { policy, level, passedMachineGates }` — written only by a `policy` actor's approval through `decideHumanGate` (A-8's amendment). `policy` names the deciding rule set (`gate-auto`), `level` the autonomy in force at the decision, `passedMachineGates` the current stage attempt's non-human exit gates in stage order (the machine evidence the approval relied on). Events without the field — every one recorded before it existed, and every human decision after — fold exactly as before: the fold reads only the verdict (R-166's law, verbatim).
- **R-181** (added 2026-10-15, #1206) `decideGateAuto(flow, state, events, level)` answers the pending `human` gates of the current stage a `gate-auto` policy may approve, in stage order, each as `{ gate, policy, level, passedMachineGates }`: only under status `awaiting_human`, only at level `auto`, only when the stage's exit holds at least one non-human gate and every one of them is out of `pendingGates` (the attempt's machine gates concluded passed — `pendingGates` refills on every stage entry, so absence is the conclusion), and never a gate with an earlier `failed` verdict anywhere in the work order's history (a human reject is standing doubt the policy never overrides). A stage whose human gate has no machine gate in its exit list — nothing passed, nothing to rely on — stays with the human at every level. No gate of a kind in `USER_ONLY_GATES` (R-168's named constant, never a copy) is ever answered: a pending `page_approval` or `deploy` gate keeps its decision with the user. The function is pure — the same inputs always give the same answer, the inputs are never mutated — and every doubt answers the empty list.

### Addendum 2026-10-16 (#1225, D-10): the chain widened

The operator's decision of 2026-10-16 ([decisions-phase7.md](decisions-phase7.md) → D-10) widens the
chain to **work order > stage > flow > repo > project > global > builtin**: flow and stage join as
*definition-origin* layers whose `autonomy` is part of a pinned flow version's content (D-6), and an
optional `maxLevel` ceiling caps the resolved level at repo and global. The widening is additive —
R-167 keeps its text and gains the "extended by R-151" pointer above; `Level`, `LEVEL_ORDER` and
R-10's `resolve` do not change (R-130 is untouched — no role, flow or capability layer of `Level`
returns), and nothing here licenses a decision class R-172's table does not (R-155). No code exists
for any of it yet; every rule names the chain step that implements it — (a) set-level commands and
UI, (b) the flow layer, (c) the stage layer and the ceiling.

```ts
// resolver/autonomy.ts — new (added 2026-10-16, #1225; Level / LEVEL_ORDER are NOT changed). The
// family sits in resolver/, not beside AUTONOMY_LEVELS in shared/autonomy.ts: AutonomySource builds
// on resolver's Level and definitionAutonomyLayers reads definitions' FlowDef — shared imports
// neither (module map).
export type AutonomySource = Level | 'stage' | 'flow';
export const AUTONOMY_CHAIN_ORDER: readonly AutonomySource[]; // ['workOrder','stage','flow','repo','project','global','builtin']
export interface AutonomyLayer { readonly source: AutonomySource; readonly value: AutonomyLevel | undefined }
export interface ResolvedAutonomy { readonly level: AutonomyLevel; readonly source: AutonomySource | 'ceiling' }
export function resolveAutonomy(layers: readonly AutonomyLayer[]): ResolvedAutonomy;           // R-151 (replaces the Layer<AutonomyLevel> signature)
export function definitionAutonomyLayers(input: { flow: FlowDef; stage: StageSlug }): { flow: AutonomyLevel | undefined; stage: AutonomyLevel | undefined; suggestsAuto: boolean };  // R-153
export const AUTONOMY_RANK: Readonly<Record<AutonomyLevel, number>>;                           // manual 0 < balanced 1 < auto 2
export function clampAutonomy(resolved: ResolvedAutonomy, ceilings: readonly (AutonomyLevel | undefined)[]): ResolvedAutonomy;  // R-154
// definitions/types.ts: StageDef and FlowDef gain  readonly autonomy?: AutonomyLevel;   RepoDef gains  readonly maxLevel?: AutonomyLevel;
```

Rules:
- **R-151** (added 2026-10-16, #1225, D-10) `resolveAutonomy(layers)` walks `AUTONOMY_CHAIN_ORDER` — by order, not array position, like R-10 — ignores `undefined` values, and answers the first defined level with its `source`; nothing defined anywhere → `{ level: 'manual', source: 'builtin' }`. R-167's `balanced`→`manual` clause is kept verbatim: a defined `balanced` answers `{ level: 'manual', source: <the layer that set balanced> }`, and a defined `auto` is returned as `auto`. The function is pure: the same layers always give the same answer and the inputs are never mutated. Resolution is **per stage at decision time** — the consumer passes the stage of the decision as the `stage` layer; a stage-less decision (a work-order-level setting read, for example) passes no `stage` layer. R-170 holds unchanged for a change at any layer. Implementing issue: D-10 chain (a) — the signature and the walk ship there; (b) feeds the flow layer and (c) the stage layer (A-404). Amended by #1232 (2026-10-16): the `auto` clause is narrowed to the user-set sources — R-157, clause 1; the correction addendum below.
- **R-152** (added 2026-10-16, #1225, D-10) `FlowDef` and `StageDef` gain `autonomy?: AutonomyLevel` (absent on definitions stored before the field existed). A present value outside `AUTONOMY_LEVELS` is `wrong_type` at the definition file (`library/flows/<id>/v<N>.yaml`, I-110) — never dropped, never read as `manual`. The field is part of the version's content: a change is a new flow version (D-6); an existing work order keeps its pin, so a later edit never changes a running order's chain. Implementing issue: D-10 chain (b) — the `FlowDef` field lands with the flow layer; (c) — the `StageDef` field with the stage layer.
- **R-153** (added 2026-10-16, #1225, D-10) Definition-origin layers (`flow`, `stage`) can **suggest `auto` but never resolve it**: `definitionAutonomyLayers` returns the stage's and the flow's values with every `auto` replaced by `undefined`, and `suggestsAuto = true` iff the flow's or any stage's `autonomy === 'auto'`. `manual`/`balanced` from a definition layer pass through — a definition may restrict; it can never loosen. So `auto` becomes effective only through a layer the *user* set: work order, repo, project or global (A-403 writes them, user actor only). A definition import therefore can never enable `auto`. Implementing issue: D-10 chain (b) — the function and the flow arm; (c) feeds it the stage arm. Amended by #1232 (2026-10-16): the signature is `{ flow: FlowPin; stage?: StageSlug }` — the correction addendum below.
- **R-154** (added 2026-10-16, #1225, D-10) Ceiling: `RepoDef.maxLevel?` (validated like R-171 — a present value outside `AUTONOMY_LEVELS` is the typed `wrong_type` at the file it came from, never dropped, never read as `manual`) and the global settings key (A-406) are ceilings. `clampAutonomy(resolved, ceilings)`: the effective ceiling is the **minimum by `AUTONOMY_RANK`** of the defined ones — a repo ceiling can tighten the global one, never loosen it; an undefined or empty list returns `resolved` unchanged. If `resolved.level` ranks above the ceiling → `{ level: <ceiling>, source: 'ceiling' }`; else unchanged. The clamp runs on every resolution, so lowering a ceiling immediately governs later decisions (R-170) and past decisions keep their effect. `balanced` is still unoffered until D-10 4/5 — R-167's clause applies after the clamp as before. Implementing issue: D-10 chain (c).
- **R-155** (added 2026-10-16, #1225, D-10) Nothing in this addendum widens R-172's table or touches `USER_ONLY_GATES` (R-168): no layer, ceiling, suggestion or import licenses a decision class the table does not. Restating this is the rule's whole point — every consumer keeps reading `USER_ONLY_GATES`, never a copy. Implementing issue: D-10 chain (a), (b) and (c) alike — the guard test lands with (a)'s commands and no later step may widen the table.
- **R-156** (added 2026-10-16, #1225, D-10) `checkAutoLevel` (R-169) runs **per flow** wherever `auto` is *confirmed* for an order whose pinned flow suggested it, with the pinned flow as input and the nearest `SpendCap` — a flow's suggestion alone runs nothing and writes nothing. A stage-level `auto` is a suggestion of the same kind: its flow is checked as a whole, because R-169 already requires `onFail` on every stage. Implementing issue: D-10 chain (a) — the one confirm's check (A-403's validation order, A-405's confirm); the suggestion surface itself is (b), U-335.

The application contracts of the same decision are A-403 … A-407
([application.md](application.md) → chain-widening addendum); the storage homes are I-110
([infrastructure.md](infrastructure.md) → chain-widening addendum); the screens are U-334 … U-336
([ui.md](ui.md)).

### Addendum 2026-10-16 (#1232, D-10): the chain-widening contracts corrected

Additive corrections to the #1225 addendum above, from the independent review of #1228; nothing
above is deleted or rewritten. New rules R-157 and R-158; amended pointers on R-151, R-153 and
R-154; the flow-level field's storage home is I-111 ([infrastructure.md](infrastructure.md) →
the same-titled addendum), the application halves are A-408 and the amended A-403/A-404/A-405
([application.md](application.md) → the same-titled addendum), the screen wording is U-335/U-336
amended ([ui.md](ui.md)).

- **R-157** (added 2026-10-16, #1232, D-10) Defence in depth, two clauses. (1) `resolveAutonomy` itself ignores an `auto` that arrives with source `flow` or `stage` — the layer reads as absent and the walk goes on — so a caller that bypasses `definitionAutonomyLayers` (R-153) still cannot resolve `auto` from a definition. (2) R-167's `balanced`→`manual` clause is applied **once, after `clampAutonomy`** (R-154), preserving the `source` — including `'ceiling'` — so a `balanced` layer clamped by a `manual` ceiling reads `{ level: 'manual', source: 'ceiling' }`. Implementing issue: D-10 chain (a) — with the resolver itself (R-151).
- **R-158** (added 2026-10-16, #1232, D-10) Fail closed on the read: wherever the effective level of an order resolves to `auto` — the `effectiveAutonomy` read (A-404) — R-169's `checkAutoLevel` runs against the order's nearest `SpendCap` and pinned flow; if it fails, the effective level is `manual` with the typed reason `auto_unavailable: auto_requires_spend_cap | auto_requires_max_attempts` carried in the read model — never a silent `auto`. Setting commands still refuse early with the same typed errors where a concrete order and flow are known (A-403's validation order, A-395); global/repo/project writes of `auto` have no single order to check and fail closed here, per order. Implementing issue: D-10 chain (a)/(b) — the read's law with (a), the flow arm's input with (b).
- **R-151** (amended 2026-10-16, #1232, D-10) The "a defined `auto` is returned as `auto`" clause holds for the user-set sources only (`workOrder`, `repo`, `project`, `global`); an `auto` arriving from `flow` or `stage` is ignored — R-157, clause 1.
- **R-153** (amended 2026-10-16, #1232, D-10) The signature is `definitionAutonomyLayers(input: { flow: FlowPin; stage?: StageSlug })` — the flow input is the work order's pin, whose flow-level field I-111 adds, never the live definition. `stage` is optional: a stage-less (work-order-level) read passes no stage and only the flow arm applies — the flow's value and the flow's share of `suggestsAuto`; with a stage, the rule above stands as written. The "a definition may restrict, never loosen" sentence is about the definition layers themselves — it never stops a user-confirmed work-order `auto` from governing a restrictive stage (A-405 amended).
- **R-154** (amended 2026-10-16, #1232, D-10) The closing sentence — "R-167's clause applies after the clamp as before" — means exactly R-157, clause 2: applied once, after the clamp, the `source` preserved.

### Addendum 2026-10-16 (#1235): the write-scope guard before the ask

A role's `writeScope` stops being instruction text only (checklist gap 3, C2 of the provider
conformance series): before an ask is presented or the risk table consulted, the executor asks the
domain whether the write tool's target is *certainly outside* the role's write scope, and denies it
itself when it is — provider-blind, because the claude-code `canUseTool` callback and the agy
bridge both deliver `permission_ask` to the executor's one decision path, and the agy write family
arrives already translated to `Write` (`mapAgyToolCall`). The guard lives in the `stage-output`
module: its concern is the role's write scope — judged after the run (`stageOutputVerdict`) and now
before the write. The containment helpers the two halves share (`trimSlashes`, `underRoot`, the
glob matcher) moved to the module-internal `scope-match.ts`, not re-exported through the index; the
module's map row (`definitions`, `pages`) is unchanged. The audit actor's policy id is exported
from `autonomy` — the module that owns ask-deciding policy ids — beside `PERMISSION_RULES_POLICY`.

```ts
// stage-output/write-scope.ts (added 2026-10-16, #1235)
export interface WriteScopeContext {
  readonly cwd?: string;                  // the run's working directory; a relative target resolves against it
  readonly worktreeRoot?: string;         // the work order's worktree — the repo boundary
  readonly docsRoot?: string;             // the repo's docs root, repo-relative
  readonly testGlobs?: readonly string[]; // the repo's listed test folders, repo-relative globs
}
export type WriteScopeDenyReason = 'read-only-role' | 'outside-docs-root' | 'outside-worktree' | 'outside-test-folders';
export type WriteScopeVerdict =
  | { readonly verdict: 'unchecked' }
  | { readonly verdict: 'deny'; readonly reason: WriteScopeDenyReason };
export function writeScopeVerdict(input: {
  readonly scope: WriteScope; readonly tool: string; readonly target: string | undefined;
  readonly context: WriteScopeContext;
}): WriteScopeVerdict;
// autonomy/decide.ts (added 2026-10-16, #1235)
export const WRITE_SCOPE_POLICY: PolicyId; // 'write-scope'
```

- **R-159** (added 2026-10-16, #1235) `writeScopeVerdict({ scope, tool, target, context })` is pure and two-valued: `deny` with a reason, or `unchecked` — it never allows, and an `unchecked` or in-scope write keeps going down the normal ask/risk path exactly as before. The write tools are `Write`, `Edit`, `MultiEdit`, `NotebookEdit`, in Docket-tool language (a provider's own spellings arrive already translated). `deny` is answered only when the target is **certainly outside** the scope: scope `none` denies every write target — no context fact needed, the target's location is beside the point; `docs` denies a target outside the repo docs root, located inside the worktree (both facts must be present; a missing docs root is never defaulted to a guess); `repo` denies a target outside the work order's worktree; `tests` denies a target outside the repo's listed test folders **when the repo lists them** — an absent or empty list is `unchecked`. Every other case is `unchecked`, never `deny`: a non-write tool (Bash and everything else that writes indirectly), a missing or empty target string, a `~`-relative target (never expanded — where a shell would take it is a fact the string does not carry), a `paths` scope (the four simple kinds are this guard's contract), a relative target with no `cwd`, or a missing context fact. Paths compare after lexical normalisation (`.` and `..` fold, duplicate separators collapse, `..` at the root stays at the root) — a symlink-free string compare in the same frame `risk.ts` gives its classifier, with no filesystem read. The executor-side wiring is A-409 ([application.md](application.md) → the same-titled addendum).

### Addendum 2026-10-16 (#1247): the connector module (Phase 9, step 0)

The connector contract ([integrations.md](integrations.md) → "Adding a connector"): every
integration is a self-contained **connector module** — a manifest, one registration path, its own
folder and a conformance suite — shipped inside the app and switched on/off in Settings; loading
connectors at run time is explicitly deferred (the Deferred note there). This addendum fixes the
pure domain half: the manifest type and its two laws. Nothing exists in code yet; every rule names
the follow-up of #1247's list that implements it. The application halves are A-415 … A-417
([application.md](application.md) → the same-titled addendum), the layout and conformance halves
I-113/I-114 ([infrastructure.md](infrastructure.md) → the same-titled addendum), the screens
U-356/U-357 ([ui.md](ui.md)).

```ts
// connector/index.ts (added 2026-10-16, #1247)
export type ConnectorId = Brand<string, 'ConnectorId'>;               // slug, ids.ts
export type PortFamily = 'forge' | 'tracker' | 'ci' | 'deploy';
export interface ConnectorSettingField { readonly key: string; readonly label: string; readonly kind: 'text' | 'url' | 'secret'; readonly required: boolean }
export interface ConnectorManifest {
  readonly id: ConnectorId; readonly name: string; readonly version: string;       // semver of the connector
  readonly apiVersion: number;                                                      // the connector API the module was written against
  readonly provides: readonly PortFamily[];                                         // non-empty, unique
  readonly hostMatch: readonly string[];                                            // remote-URL host patterns for 'forge' (data, e.g. 'github.com'); empty otherwise
  readonly network: readonly string[];                                              // the hosts the connector may reach (egress allowlist); '*' is invalid
  readonly settings: readonly ConnectorSettingField[];                              // account fields; 'secret' fields are keychain refs, never values
  readonly requiresCli?: string;                                                    // an external CLI the connector shells out to (e.g. the GitHub CLI), probed not assumed
}
export const CONNECTOR_API_VERSION: number;                                         // the version the core speaks
export type ConnectorManifestError = 'invalid_id' | 'empty_provides' | 'duplicate_family' | 'unknown_family' | 'bad_host_match' | 'wildcard_network' | 'duplicate_setting' | 'unsupported_api' | 'bad_version';
export function validateConnectorManifest(m: ConnectorManifest): Result<ConnectorManifest, ConnectorManifestError>;
export function matchConnectorHost(manifest: ConnectorManifest, remoteUrl: string): boolean;
```

- **R-182** (added 2026-10-16, #1247) `validateConnectorManifest` is pure and checks, in this order: id is a slug → `invalid_id`; `provides` non-empty → `empty_provides`; entries known and unique → `unknown_family` / `duplicate_family`; every `hostMatch` entry is a bare host or `*.host` (no scheme, path, port or `*` alone) → `bad_host_match`; `network` has no `*` and no entry with scheme/path → `wildcard_network`; setting keys unique → `duplicate_setting`; `apiVersion === CONNECTOR_API_VERSION` → `unsupported_api` (a newer or older module is refused, never loaded in a degraded mode); `version` is semver → `bad_version`. A `forge` module with an empty `hostMatch` is valid (it is selected only by an explicit per-repo `forge.kind`, integrations.md). No input is mutated. Implementing issue: #1247 follow-up 1.
- **R-183** (added 2026-10-16, #1247) `matchConnectorHost` extracts the host of a git remote (`https://`, `ssh://`, scp-like `git@host:path`), lower-cases it, and answers true iff it equals a `hostMatch` entry or matches a `*.host` suffix entry exactly on a label boundary (`evil-github.com` never matches `github.com`; `github.com.evil.io` never matches). Pure; an unparsable remote answers false. Implementing issue: #1247 follow-up 1.
- **R-184** (added 2026-10-19, #1298, D-15) The first row of `RISK_RULES` is `deny-run-config`, with the new verdict `{ verdict: 'deny', rule }`: any read, search or write of a path under `<dataDir>/runs/<run>/config/` (the ask-bridge and MCP tokens live there) is denied at every autonomy level and never reaches a human. `RiskContext` gains `dataDir?: string` (absolute); the row reads Read/Grep/Glob `path`, `pattern` and `glob`, the write tools' `file_path`/`notebook_path`, and every token of a Bash command (split on whitespace, quotes, redirect and pipe characters, `=`). Matching is lexical on the resolved segments (`..`, `//`, trailing `/` and a relative path against an absolute `cwd` all resolve), with no symlink knowledge. An absent or relative `dataDir` skips the row — no other row changes. `decidePermission` consults the table before the level check and answers `{ kind: 'deny-by-policy', policy, level, rule }` for a deny; the `~/.gemini/antigravity-cli/mcp/docket-pages/` schema dir is not covered and stays human-decided. Implementing issue: #1298.
- **R-185** (added 2026-10-19, #1295, D-16) The git lifecycle gains a forge-less merge. The ledger event `{ type: 'branch_merged_local'; at; branch; base }` is a no-op in the R-17…R-24 machine fold like the other git events, and `deriveGitLifecycle` folds it into `GitLifecycleState.mergedLocal?: { base; at }` — only while no pull request exists (a forge-backed lifecycle never also merges locally) and only the first one (a second never replaces it); ignored otherwise. `branch_released` (R-163) additionally folds in after a folded `branch_merged_local`, with the forge pull request path unchanged; R-164 freezes `mergedLocal` like the rest once the release folded in.
- **R-186** (added 2026-10-20, #1300, D-15) Hardens R-184's Bash arm: for a Bash ask the `deny-run-config` row denies any token that resolves to `<dataDir>/runs` or anything below it — the `config` segment requirement is dropped, because an ancestor of the tree (`find <data>/runs -exec cat {} \;`, `ls -R <data>/runs`, `tar cf x <data>/runs/<run>`) walks into it. The file tools keep R-184's exact match (a path under `runs/<run>/config/`); the data dir itself, its siblings and look-alike names (`runs-old`, `runsx`) are not matched. Known limits, left to the human card rather than denied: a variable (`$DATA/runs`), a partial glob (`runs/*/c*`), a case-insensitive volume spelling, a token naming the data dir itself (`ls -R <dataDir>`) and a leading `~` — `resolvePath` never expands `~` and the domain holds no HOME, so the expansion belongs to the caller. Implementing issue: #1300.
- **R-187** (added 2026-10-20, #1306, D-15) Closes grant-root and wildcard gaps in the run-config deny floor: `denyRunConfig` covers `fileChange` and `permissions` asks. For `fileChange`, the target (`commandOf(ask) ?? readPathOf(ask)`) is resolved: any target in `<dataDir>/runs` or any target that contains `<dataDir>/runs` (a grant at `/` or `<dataDir>` covers the run config tree) is denied. For `permissions`, `commandOf(ask)` is split on `RUN_CONFIG_TOKEN_SPLIT`: tokens with trailing `/*` or `/**` have those wildcard segments stripped (keeping `/` if bare `/*` or `/**`), resolved, and denied when in `<dataDir>/runs` or when containing `<dataDir>/runs`; non-wildcard tokens are denied when in `<dataDir>/runs`. Remaining known limits, left to the human card: arbitrary `$DATA` variables, mid-path globs (`runs/*/c*`), and case-insensitive volume spelling. Implementing issue: #1306.
- **R-188** (added 2026-10-19, #1308) `deriveWorkOrderState` bypasses approved skipped stages during the fold: `Acc` holds `pendingSkip: readonly StageSlug[] | null` and `skipped: readonly StageSlug[]`. `enterStage` immediately steps over any stage in `skipped` without incrementing its entry count. A `stage_skip_proposed` event sets `pendingSkip`; a subsequent `stage_skip_decided` with `approved: true` filters the proposal through `filterSkippableStageIds` and records `skipped`. If the work order is currently `ready` at a stage that was approved to be skipped, the fold advances past it immediately.
- **R-189** (added 2026-10-19, #1227, D-10 5/5) `decideStageSkipAuto(flow, state, events, level)` answers the pending planner stage-skip proposal a `stage-skip-auto` policy actor may approve, as `[{ stages, policy: 'stage-skip-auto', level: 'auto' }]`: only at level `auto`, only when a pending `stage_skip_proposed` exists, only under live statuses (neither `blocked` nor `done`), with no `gate_evaluated` with `status: 'failed'` anywhere in history, no earlier `stage_skip_decided` with `approved: false` anywhere in history, the current stage index is valid (`>= 0`), and every proposed stage exists in `flow.stages` strictly ahead of the current stage (`idx > currentIdx`), does not satisfy `stageExitBlocksSkip(stage)`, and has no exit gate whose `kind` is in `USER_ONLY_GATES`. Any failure refuses the whole proposal (`[]`, no partial approvals). The function is pure — the same inputs always give the same answer, the inputs are never mutated — and every doubt answers the empty list.
- **R-190** (added 2026-10-19, #1227, D-10 5/5) `stage_skip_decided` ledger events optionally carry `decidedByPolicy?: { readonly policy: PolicyId; readonly level: AutonomyLevel }` recording policy approval evidence (mirror of R-180); absent on every older event and on human decisions. The state machine fold reads only `approved` (R-144/R-188 unchanged), so absence changes nothing.

Addendum 2026-10-19 (#1324, dogfood walk 2): the run's own page publish arm. Publishing a page
is not approving it — the operator decision of 2026-10-19 opens the publish pair to the policy
actor and leaves D-10 answer 3 untouched (`page_approval` stays closed at every level, R-168).
Rule R-191; the application rule is A-437, the UI rule U-366.

- **R-191** (added 2026-10-19, #1324, dogfood walk 2) The run's own page publish arm. A new low row `allow-own-pages`: a tool ask named exactly `page_publish` / `page_update` — bare, or as Docket's own pages server spells it, `mcp__docket-pages__page_publish` / `mcp__docket-pages__page_update` — is low by name alone; arguments are never read, and matching is the whole string (a foreign server's `page_publish`, `page_publish_x` and every longer or shorter name matches nothing — R-173's default-deny). No deny row can match the ask: it is name-only, so it carries no path or command for the floor to read. `decidePermission` opens exactly this row to `balanced` as well as `auto` — every other low row keeps the `auto`-only gate, and `manual` asks the human as at every level. Publishing a page is not approving it: `page_approval` stays in `USER_ONLY_GATES` (R-168) and D-10 answer 3 is untouched. The resolver's `balanced`→`manual` demotion (R-157, clause 2) is unchanged — the row is licensed for the level for the day `balanced` is offered, and `auto`, today's only offered level above `manual`, allows it end to end. Implementing issue: #1324.

Addendum 2026-10-20 (#1327, dogfood walk 3): the read-only shell forms agents routinely use —
`ls -la`, `git -C <worktree> diff`, `&&`-joined chains — were stopping every auto run for a human
answer. The operator decision of 2026-10-19 widens the existing rows only: every deny row keeps its
place ahead of them, and every other compound (`;`, pipes, `||`, a lone `&`, redirection,
substitution) still asks. Rules R-192 and R-193.

- **R-192** (added 2026-10-20, #1327, dogfood walk 3) `allow-git-read` gains the `-C` spelling: `git -C <path> <verb> …` is low under exactly R-175's verb set, operand and flag bans, when the `-C` target is a contained operand — lexically inside `worktreeRoot` (a relative target resolves against `cwd`), with no `..` segment and no `~` prefix. Outside targets (`git -C /etc log`), walking targets (`git -C ../x status`, and `sub/../src` even though it resolves back inside) and tilde-relative targets ask; `-C` is parsed only in its leading position (`git --no-pager -C <path> …` matches nothing), and `git -C` without a target or without a verb after it asks. Implementing issue: #1327.
- **R-193** (added 2026-10-20, #1327, dogfood walk 3) A new low row `allow-readonly-shell`, placed after `allow-verify` so a whole declared verification string keeps answering that row: `ls` and `pwd` are low with any flags — both commands are read-only under every flag, so a `-`-prefixed token always passes — when every path operand of `ls` is a contained operand as R-192 defines it, and `pwd`, which names no file, takes flags only; a bare `ls` is low only when `cwd` is inside `worktreeRoot`. The same row licenses `&&`-joined chains whose every part is low standing alone: a git-read form (R-175/R-192), an `ls`/`pwd` form, or one entry of `verificationCommands` matched after trim — the licence `allow-verify` grants the whole string, read per part. `&&` is the only metacharacter parsed: `;`, `|` (pipes and `||` alike), `<`, `>`, `(`, `)`, `$`, quotes, backticks, line breaks, and every `&` that is not the separator (background `&`, `&&&`) disqualify, as does an empty part (`ls &&`, `&& ls`, `ls && && pwd`). The deny floor still runs first on the whole token list, so a pushing, destructive or installing part never rides a chain (`git status && rm -rf /` asks), and the row is auto-only like every low row save R-191's. The expansion characters `\ * ? [ ] { } !` disqualify a command and every chain part like the other metacharacters (`ls src/*` asks: a wildcard read is the operator's call, not the classifier's), because the shell would rewrite them into paths the lexical operand checks never see. Implementing issue: #1327.

Addendum 2026-10-20 (#1326, dogfood walk 3): at `auto`, an Antigravity run still stopped six
times in one work order to ask the human for Reads of Docket's own docket-pages descriptors —
`~/.gemini/antigravity-cli/mcp/docket-pages/page_publish.json` and `…/instructions.md` — the files
the agent reads to call Docket's own tools. They sit outside every worktree, so the read rows sent
each ask to the human, which defeats `auto` for this provider. The decision recorded in #1326
(architect option (a) of the C4 question raised there) licenses exactly those descriptor reads and
nothing else in the vendor tree; the anchor's path is provider data — it lives in the provider def
and reaches the table through the risk context, never as a path in domain code (the C4 vendor law).
Rule R-194.

- **R-194** (added 2026-10-20, #1326, dogfood walk 3) A new low row `allow-own-mcp-defs`, placed after `allow-own-pages`: a `Read` (`file_path`) of exactly one descriptor file directly under the run's MCP descriptor directory is low as an own-tool read. `RiskContext` gains `mcpDefsDir?: string` — absolute; absent, relative or `~`-spelled skips the row, so the ask stays with the human. The file's name is `instructions.md` or `<slug>.json` — alnum first, then only name characters (`A–Z a–z 0–9 . _ -`), so no glob spelling, no path separator and no bare `.json` (empty stem) matches. Full path only: the ask's spelling is absolute and canonical — no empty segment (a trailing slash names no file, `//` is not a name), no `.` and no `..` segment; every non-canonical spelling asks even when it resolves to the same file (the stance R-192 holds contained operands to). The dir is the file's immediate parent by equality of the resolved parent segments with the resolved `mcpDefsDir` segments — the dir value is executor data resolved lexically, so a trailing slash on it is the same dir, and a value that resolves to nothing (the root) licenses nothing. The dir itself, anything below it, every other directory, and everything else under the vendor tree stay human-decided as today. The value is resolved by the executor in `riskContextOf` through `CapabilityCatalog.mcpDefsDirOf(account, machineHome)`: the provider def's home-relative `mcpDefsPath` (provider data, living only under `src/infrastructure/providers/` — the vendor path appears in no domain or application code; the def guard holds it non-empty, home-relative and free of `..` segments) under the home the launch itself resolves — the account's `identityDir` for a home-rooted CLI (P-67), else the machine home (`deps.homeDir`); a provider whose def names no such dir, an unreadable account or a non-absolute home leaves the field absent. The ask-side home expansion (`~`/`$HOME`, A-430) runs before the table, so a tilde-spelled ask meets the expanded dir. The row is Read-only (a `Grep`/`Glob` over the dir and a `Bash` read of a descriptor ask) and licenses no write; the deny floor still runs first, so a secret-shaped basename (`credentials.json`, `.env.json`, `id_rsa.json`) asks. Lexical like every row (R-173): a symlink planted at an allowed name is invisible to the classifier — the executor's sandbox owns the filesystem truth. Auto-only like every low row save R-191's. Implementing issue: #1326.
