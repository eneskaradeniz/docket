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
| `resolver` | `shared`, `definitions`, `quota` |
| `gates` | `shared`, `definitions` |
| `providers` | `shared`, `quota`, `definitions` |
| `library` | `shared`, `definitions` |
| `flow` | `shared`, `definitions`, `gates` |
| `dispatch` | `shared`, `quota`, `budget` |
| `roadmap` | `shared`, `flow`, `definitions` |
| `scenarios` | every module above — **test files only**, no production code, no `index.ts` |

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

// shared/actor.ts
export type Actor =
  | { readonly kind: 'user'; readonly id: string; readonly label?: string }
  | { readonly kind: 'agent'; readonly runId: RunId; readonly role: RoleSlug }
  | { readonly kind: 'system'; readonly component: string };
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

Rules:
- **R-3** All issues are collected; validation never stops at the first issue.
- **R-4** Ids are unique per kind (roles, flows, capabilities); stage ids unique within a flow; gate ids unique within a stage.
- **R-5** `stage.role` must exist and be `active`; `agent_verdict.role` must exist.
- **R-6** `onFail.goto` must name a stage at the same index or earlier (`forward_goto` otherwise); `maxAttempts` is an integer 1..10.
- **R-7** `command` gates must name a `commandSet` present in `repo.commandSets` when a repo definition is given.
- **R-8** A `CapabilityDef` env value that is a bare string (not `{literal}` / `{secretRef}`) is `wrong_type`; a `{literal}` whose key matches `/(KEY|TOKEN|SECRET|PASSWORD)/i` is `secret_literal`.
- **R-9** `repo.defaultFlow` must be listed in `repo.flows`, and every listed flow must exist.
- **R-51** `stage.reviewOf` must name a stage of the same flow with a lower index and a non-null role (`bad_review_of` otherwise; a stage cannot review itself or a human-only stage). `stage.tier` must be a `Tier` and `stage.thinking` a `ThinkingChoice` (`wrong_type` otherwise).
- **R-46** `ProjectDef`: `repos` is non-empty (`empty_repos`), has no duplicates (`duplicate_id`), and
  contains `mainRepo` (`main_repo_not_listed`); a `budget`, when present, must be a valid `SpendCap`
  (`wrong_type` otherwise). Validated whenever a project is validated (project scope load, attach).
- **E-1** `EnvSlug` follows the same `parseSlug` rules as other slugs.
- **E-2** Environment ids are unique within a repo; `order` values are unique within a repo (`duplicate_env_order`).
- **E-3** `EnvironmentDef.deploy` and `verify` (when present) must name a `commandSet` present in `repo.commandSets` (`env_command_set_missing`).
- **E-4** A `deploy` gate's `environment` must name an environment in `repo.environments` (`unknown_environment`).
- **E-5** A `protected` environment must have `promoteFrom` set (`missing_promote_from`). `promoteFrom` must name another environment with a lower `order` value; an equal- or higher-order target reports `promote_cycle` — with unique `order` values (E-2), a non-descending chain and a cyclic one are the same defect class. The `promoteFrom` chain must be acyclic (`promote_cycle`).

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
- **E-8** For a `protected` environment, `deployment.confirmedEnvironment` must equal the gate's `environment` (the user typed the environment id to confirm); absent or different → `pending`. (Docket is single-user: a rule requiring a *different* approver would make protected environments undeployable. A second-approver option arrives with team mode.)
- **E-9** `remote_checks`: `status === 'all_passed'` → `passed`; `status === 'has_failure'` → `failed` naming the first failed check; `status === 'timeout'` → `failed` with reason `timeout`; `status === 'pending'` → `pending`.
- **E-10** `deployment_attempted` event is appended exactly once per deploy-gate evaluation, carrying the redacted `outputTail` (same redaction as command gates: no env values, no secrets).

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
}
export type WaitReason = 'not_before' | 'work_order_busy' | 'global_limit' | 'repo_limit' | 'account_limit' | 'quota' | 'budget';
export type DispatchDecision =
  | { readonly item: QueueItemId; readonly kind: 'start' }
  | { readonly item: QueueItemId; readonly kind: 'wait'; readonly reason: WaitReason; readonly until?: EpochMs };
export function decideDispatch(queue: readonly QueueItem[], snapshot: DispatchSnapshot): readonly DispatchDecision[];
```

Rules:
- **R-33** Items are considered by `priority` desc, then `enqueuedAt` asc, then `id` asc. Output has one decision per queue item, in that order.
- **R-34** Checks in this order, first failing wins: `notBefore > now` (`until` = notBefore) → a run for the same work order is running or already started in this decision → global limit → repo limit → account limit → spend `hard_stop` (`budget`; a project-ceiling stop waits every item of that project — R-48) → headroom `ok:false` (`quota`, `until` = earliestRelief) → headroom `'unknown'` is allowed (does **not** wait; the transport will learn) → `start`.
- **R-35** Starting an item counts toward the limits for the items after it in the same call.

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
export type AgentEvent =
  | { readonly type: 'session_started'; readonly at: EpochMs; readonly sessionRef: string }
  | { readonly type: 'text'; readonly at: EpochMs; readonly delta: string }
  | { readonly type: 'thinking'; readonly at: EpochMs; readonly delta: string }
  | { readonly type: 'tool_call'; readonly at: EpochMs; readonly id: string; readonly name: string; readonly target?: string }
  | { readonly type: 'tool_result'; readonly at: EpochMs; readonly id: string; readonly ok: boolean }
  | { readonly type: 'permission_ask'; readonly at: EpochMs; readonly id: string; readonly tool: string; readonly target?: string; readonly options: readonly string[] }
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
- **R-50** `effortForChoice`: absent choice → `{ level: 'balanced' }`; a `level` maps through `thinkingFor`; an `effort` is sent as is when the model lists it, otherwise clamped down to the highest listed level below it, and undefined when none is below; `thinking` `unknown` or `{ kind: 'none' }` → undefined for every choice. A level the model does not list is never returned.
- **R-53** `stageBrief`/`acceptanceCriteria` are pure functions of the definitions — the same inputs render the same bytes; no timestamps, no account data, no provider ids. The acceptance criteria are rendered from the stage's exit gates because `StageDef` carries no authored brief; a `brief` field is added only if the rendered criteria prove too thin.
- **R-54** `planInstructions`: native files never inline; a file both native and absent is not an error; truncation markers name the file and the kept char count; the plan is a pure function of (`native`, `present`, budget).
- **R-55** `deriveTaskState` reads only `tool_call`/`tool_result`/`permission_ask` events; `extendRollingNote` reads only `text`/`thinking` deltas; neither sees the raw transcript. P-38 item 3's plan/done/remaining lists are not derivable from today's events: the deterministic core ships first, a plan-like structure arrives later as registry data (plan-tool names per provider), and the model-written summary stays open decision O-8.
- **R-56** `sizeHandoffPack` never drops `stagePrompt`, `acceptance` or the Docket layers, and never empties the pack: a budget below the untouchable core is a caller bug, not a smaller pack.
- **R-57** `renderHandoffPrompt` places "first run the stage's checks, then continue" as the first line (P-38: the new agent first runs the stage's checks) and never embeds a session ref, an account id, or environment values. With `definitionsChanged` set, the note "definition changed since the first leg" sits directly after the preamble — the change is surfaced to the continuation, never silently absorbed. `definitionsDigest` is deterministic: the same text always yields the same 8 lower-case hex chars, and different text yields a different digest (A-62's rev marker stands on this).

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
- `standard` Standart: `plan` (planner; human gate `plan-approval`) → `implement` (developer; command
  gate `tests` on set `tests`, `secret_scan` gate `secrets`; `onFail: implement ×3`) → `review`
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

Rule:
- **R-45** `validateDefinitions({ roles: BUILTIN_ROLES, flows: BUILTIN_FLOWS, capabilities: [], repo: <fixture with commandSets.tests> })` is `ok`.

---

## 13. v1 parity (acceptance for the whole phase)

The `standard` flow must reproduce v1's work-order lifecycle. A scenario test
(`src/domain/scenarios/v1-parity.test.ts`) drives event sequences and asserts:

| Scenario | Expected state |
| --- | --- |
| created | `plan`, `ready` |
| plan run succeeded, plan-approval pending | `plan`, `awaiting_human` |
| plan approved | `implement`, `ready` |
| implement succeeded, tests pass, secrets 0 | `review`, `ready` |
| implement succeeded, tests fail (1st) | `implement`, attempt 2, `ready` |
| tests fail three times | `blocked` |
| review verdict approve but pointers unresolved | `blocked` (unknown) |
| review verdict + approval pass | `close`, `awaiting_human` |
| closure approved | `done` |
| run ended by limit | `limit_waiting` |
