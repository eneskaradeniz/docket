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
| `definitions` | `shared` |
| `quota` | `shared` |
| `budget` | `shared` |
| `proposal` | `shared` |
| `resolver` | `shared`, `definitions`, `quota` |
| `gates` | `shared`, `definitions` |
| `providers` | `shared`, `quota` |
| `library` | `shared`, `definitions` |
| `flow` | `shared`, `definitions`, `gates` |
| `dispatch` | `shared`, `quota`, `budget` |
| `roadmap` | `shared`, `flow` |

Each module folder has an `index.ts` that re-exports its public API; `src/domain/index.ts` re-exports
every module. Issues edit only their own module folder.

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
export type WorkspaceSlug = Slug<'workspace'>;
export type PhaseSlug = Slug<'phase'>;
export type TaskSlug = Slug<'task'>;

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

// shared/actor.ts
export type Actor =
  | { readonly kind: 'user'; readonly id: string; readonly label?: string }
  | { readonly kind: 'agent'; readonly runId: RunId; readonly role: RoleSlug }
  | { readonly kind: 'system'; readonly component: string };
```

Rules:
- **R-1** `parseSlug` accepts `^[a-z0-9][a-z0-9-]{0,62}$` only (lowercase, max 63 chars, no leading hyphen).
- **R-2** `parseUlid` accepts exactly 26 chars of Crockford base32, uppercase; rejects `I L O U` and lowercase.

---

## 2. `definitions/` — roles, flows, gates, capabilities, workspace

```ts
// definitions/types.ts
export type WriteScope =
  | { readonly kind: 'none' }                                   // read-only role
  | { readonly kind: 'docs' }                                    // the workspace docs root only
  | { readonly kind: 'tests' }                                   // test folders only (globs from workspace)
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
  | { readonly kind: 'page_approval'; readonly id: GateSlug; readonly label: string };

export interface StageDef {
  readonly id: StageSlug;
  readonly name: string;
  readonly role: RoleSlug | null;          // null = a human-only stage (e.g. staging test)
  readonly exit: readonly GateDef[];       // all must pass to advance
  readonly onFail?: { readonly goto: StageSlug; readonly maxAttempts: number };
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

export interface WorkspaceDef {
  readonly id: WorkspaceSlug;
  readonly name: string;
  readonly repos: readonly RepoRef[];
  readonly flows: readonly FlowSlug[];              // enabled flows
  readonly defaultFlow: FlowSlug;
  readonly commandSets: Readonly<Record<string, readonly string[]>>;  // name → shell commands, run in order
  readonly roleOverrides: readonly RoleOverride[];
  readonly docsRoot: string;                         // default "docs"
  readonly testGlobs: readonly string[];             // used by WriteScope 'tests'
}

export type RoleOverride = { readonly id: RoleSlug } & Partial<Omit<RoleDef, 'id'>>;

export interface Definitions {
  readonly roles: readonly RoleDef[];
  readonly flows: readonly FlowDef[];
  readonly capabilities: readonly CapabilityDef[];
  readonly workspace?: WorkspaceDef;
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
  | 'default_flow_not_enabled' | 'unknown_command_set' | 'secret_literal' | 'missing_field' | 'wrong_type';

/** Validates untyped input (parsed YAML/JSON). All-or-nothing: any issue → err with ALL issues. */
export function validateDefinitions(input: unknown): Result<Definitions, readonly DefinitionIssue[]>;
```

Rules:
- **R-3** All issues are collected; validation never stops at the first issue.
- **R-4** Ids are unique per kind (roles, flows, capabilities); stage ids unique within a flow; gate ids unique within a stage.
- **R-5** `stage.role` must exist and be `active`; `agent_verdict.role` must exist.
- **R-6** `onFail.goto` must name a stage at the same index or earlier (`forward_goto` otherwise); `maxAttempts` is an integer 1..10.
- **R-7** `command` gates must name a `commandSet` present in `workspace.commandSets` when a workspace is given.
- **R-8** A `CapabilityDef` env value that is a bare string (not `{literal}` / `{secretRef}`) is `wrong_type`; a `{literal}` whose key matches `/(KEY|TOKEN|SECRET|PASSWORD)/i` is `secret_literal`.
- **R-9** `workspace.defaultFlow` must be listed in `workspace.flows`, and every listed flow must exist.

---

## 3. `resolver/` — the precedence chain

```ts
export type Level = 'workOrder' | 'workspace' | 'global' | 'builtin';
export const LEVEL_ORDER: readonly Level[];   // ['workOrder', 'workspace', 'global', 'builtin']
export interface Layer<T> { readonly level: Level; readonly value: T | undefined }
export interface Resolved<T> { readonly value: T; readonly from: Level }

/** Most specific defined value wins, regardless of the input array's order. */
export function resolve<T>(layers: readonly Layer<T>[]): Resolved<T> | undefined;

/** Field-wise merge: overrides are applied in order least-specific → most-specific. */
export function applyRoleOverrides(base: RoleDef, overrides: readonly RoleOverride[]): RoleDef;

/** Machine-local binding of a role to an ordered chain of accounts (first = preferred).
 *  AccountRoute comes from quota/types.ts. */
export interface RoleBinding { readonly role: RoleSlug; readonly accounts: readonly AccountRoute[] }
export function resolveBinding(layers: readonly Layer<RoleBinding>[]): Resolved<RoleBinding> | undefined;
```

Rules:
- **R-10** `resolve` ignores `undefined` layers and picks by `LEVEL_ORDER`, not array position.
- **R-11** `applyRoleOverrides` never changes `id`; an override with a different id is ignored.

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
}

export type GateEvaluator<K extends GateDef['kind']> =
  (gate: Extract<GateDef, { kind: K }>, evidence: GateEvidence, ctx: GateContext) => GateVerdict;
export interface GateContext { readonly commandSets: Readonly<Record<string, readonly string[]>> }

export const GATE_EVALUATORS: { readonly [K in GateDef['kind']]: GateEvaluator<K> };
export function evaluateGate(gate: GateDef, evidence: GateEvidence, ctx: GateContext): GateVerdict;
```

Rules:
- **R-12** `human` / `page_approval`: no decision → `pending`; `approved` → `passed`; `rejected` → `failed` with the note (or `"rejected"`).
- **R-13** `command`: every command of the set must have a result; any missing → `pending`; any non-zero exit → `failed` naming the first failing command; all zero → `passed`. An empty or unknown set → `unknown`.
- **R-14** `secret_scan`: missing → `pending`; `findings > 0` → `failed`; `0` → `passed`.
- **R-15** `agent_verdict`: missing → `pending`; `approve && pointersResolved` → `passed`; `approve && !pointersResolved` → `unknown` ("evidence pointers did not resolve"); `!approve` → `failed`.
- **R-16** `unknown` never counts as passed anywhere in the domain.

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
  readonly appliesTo: readonly ModelMatcher[] | 'all';
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
  | { readonly ok: false; readonly blockedBy: readonly MeterId[]; readonly earliestRelief?: EpochMs }
  | { readonly ok: 'unknown'; readonly reason: 'no_data' | 'stale' };
export function headroom(pools: readonly Pool[], meters: readonly Meter[], accountId: AccountId, model: string, now: EpochMs): Headroom;

// quota/limit-policy.ts
export type LimitPolicy = 'wait_resume' | 'switch_pool' | 'fallback_account' | 'ask';
export interface LimitContext {
  readonly policy: LimitPolicy;
  readonly autoResumesUsed: number;
  readonly maxAutoResumes: number;           // default 3
  readonly alternativePools: readonly PoolId[];   // same account, pools with headroom for another model
  readonly fallbackAccounts: readonly AccountRoute[]; // next in the role's chain, with headroom
  readonly now: EpochMs;
}
export type LimitDecision =
  | { readonly kind: 'schedule_resume'; readonly at: EpochMs; readonly requeryFirst: true }
  | { readonly kind: 'switch_pool'; readonly poolId: PoolId }
  | { readonly kind: 'fallback'; readonly route: AccountRoute }
  | { readonly kind: 'ask'; readonly reason: 'policy' | 'no_reset_time' | 'max_resumes' | 'not_resumable' | 'no_alternative' };
export const RESUME_JITTER_MS: number;      // 60_000
export function decideOnLimit(hit: LimitHit, ctx: LimitContext): LimitDecision;
```

Rules:
- **R-25** `matchesModel`: `'all'` matches everything; `exact` compares case-insensitively; `prefix` is a case-insensitive prefix.
- **R-26** `normalizedRemaining`: `fraction` → `remaining`; `percent` → `remaining / 100`; other units → `remaining / limit` when both known, else `used`/`limit` → `1 - used/limit`; clamp to 0..1; otherwise `undefined`.
- **R-27** `isStale`: `staleAfterMs` given and `now - observedAt > staleAfterMs`.
- **R-28** `headroom` ANDs every meter of every pool matching the model: any meter with normalized remaining `0` (or `remaining <= 0`) and (`resetsAt` undefined or `> now`) blocks. A meter whose `resetsAt <= now` is treated as unknown-but-not-blocking. `throughput` pools never block (they are transient). No meters at all → `{ok:'unknown', reason:'no_data'}`; all relevant meters stale → `'stale'`.
- **R-29** `earliestRelief` = the minimum `resetsAt` among blocking meters, if any.
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
export type CapScope = 'account_day' | 'account_month' | 'workspace_month' | 'work_order';
export interface ScopedSpend { readonly scope: CapScope; readonly observedUsd: number; readonly cap?: SpendCap }
export function spendStatus(observedUsd: number, cap: SpendCap | undefined): SpendStatus;
/** The most restrictive status across all scopes, with the scope that caused it. */
export function combinedSpendStatus(spends: readonly ScopedSpend[]): { readonly status: SpendStatus; readonly scope?: CapScope };
```

Rules:
- **R-31** No cap or `amountUsd <= 0` → `ok`. `observed >= amount` → `hard_stop`. `observed >= ceil(amount * warnPercent) / 100` (cent-exact, float-safe) → `warn`.
- **R-32** `combinedSpendStatus` ranks `hard_stop > warn > ok`; ties keep the first scope in input order.

---

## 8. `dispatch/` — the dispatcher's decision rule

```ts
export interface QueueItem {
  readonly id: QueueItemId;
  readonly workOrderId: WorkOrderId;
  readonly workspace: WorkspaceSlug;
  readonly stage: StageSlug;
  readonly route: AccountRoute;
  readonly priority: number;            // higher first
  readonly enqueuedAt: EpochMs;
  readonly notBefore?: EpochMs;         // e.g. a scheduled resume
}
export interface RunningRun { readonly workOrderId: WorkOrderId; readonly workspace: WorkspaceSlug; readonly accountId: AccountId }
export interface DispatchLimits {
  readonly global: number;                              // default 4
  readonly perWorkspace: number;                        // default 3
  readonly perAccount: Readonly<Record<string, number>>; // AccountId → max concurrent; absent = no extra limit
}
export interface DispatchSnapshot {
  readonly now: EpochMs;
  readonly running: readonly RunningRun[];
  readonly limits: DispatchLimits;
  readonly headroom: Readonly<Record<string, Headroom>>;          // QueueItemId → headroom for its route
  readonly spend: Readonly<Record<string, SpendStatus>>;          // QueueItemId → combined spend status
}
export type WaitReason = 'not_before' | 'work_order_busy' | 'global_limit' | 'workspace_limit' | 'account_limit' | 'quota' | 'quota_unknown' | 'budget';
export type DispatchDecision =
  | { readonly item: QueueItemId; readonly kind: 'start' }
  | { readonly item: QueueItemId; readonly kind: 'wait'; readonly reason: WaitReason; readonly until?: EpochMs };
export function decideDispatch(queue: readonly QueueItem[], snapshot: DispatchSnapshot): readonly DispatchDecision[];
```

Rules:
- **R-33** Items are considered by `priority` desc, then `enqueuedAt` asc, then `id` asc. Output has one decision per queue item, in that order.
- **R-34** Checks in this order, first failing wins: `notBefore > now` (`until` = notBefore) → a run for the same work order is running or already started in this decision → global limit → workspace limit → account limit → spend `hard_stop` (`budget`) → headroom `ok:false` (`quota`, `until` = earliestRelief) → headroom `'unknown'` is allowed (does **not** wait; the transport will learn) → `start`.
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

```ts
export interface TaskDef {
  readonly id: TaskSlug;
  readonly title: string;
  readonly dependsOn: readonly TaskSlug[];     // any task in the roadmap
  readonly acceptance: readonly string[];
  readonly repo?: string;
}
export interface PhaseDef {
  readonly id: PhaseSlug;
  readonly name: string;
  readonly blockedBy: readonly PhaseSlug[];
  readonly tasks: readonly TaskDef[];
}
export interface Roadmap { readonly phases: readonly PhaseDef[] }
export type RoadmapIssueCode = 'invalid_slug' | 'duplicate_id' | 'unknown_task' | 'unknown_phase' | 'task_cycle' | 'phase_cycle' | 'missing_field' | 'wrong_type';
export interface RoadmapIssue { readonly path: string; readonly code: RoadmapIssueCode; readonly message: string }
export function validateRoadmap(input: unknown): Result<Roadmap, readonly RoadmapIssue[]>;

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
- **R-40** Task status: any linked work order not `done` → `running`; linked and all `done` → `done`; no linked work orders → `waiting` if any dependency is not `done` or the phase is blocked, else `planned`.
- **R-41** Phase status: blocked by a phase that is not `done` → `waiting` (unless it already has a running task, then `running`); any task `running` → `running`; all tasks `done` and at least one task → `done`; otherwise `planned`. A phase with zero tasks is `planned`.
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
  readonly costReport: 'reported' | 'computed' | 'equivalent' | 'none';
}
export type SupportTier = 'full' | 'isolated' | 'experimental';
export function supportTier(c: ProviderCapabilities): SupportTier;

// providers/agent-event.ts
export type CostKind = 'reported' | 'computed' | 'equivalent';
export type AgentEvent =
  | { readonly type: 'session_started'; readonly at: EpochMs; readonly sessionRef: string }
  | { readonly type: 'text'; readonly at: EpochMs; readonly delta: string }
  | { readonly type: 'thinking'; readonly at: EpochMs; readonly delta: string }
  | { readonly type: 'tool_call'; readonly at: EpochMs; readonly id: string; readonly name: string; readonly target?: string }
  | { readonly type: 'tool_result'; readonly at: EpochMs; readonly id: string; readonly ok: boolean }
  | { readonly type: 'permission_ask'; readonly at: EpochMs; readonly id: string; readonly tool: string; readonly target?: string; readonly options: readonly string[] }
  | { readonly type: 'usage'; readonly at: EpochMs; readonly inputTokens: number; readonly outputTokens: number; readonly cachedInputTokens?: number; readonly costUsd?: number; readonly costKind?: CostKind }
  | { readonly type: 'quota_signal'; readonly at: EpochMs; readonly meter: Omit<Meter, 'id' | 'poolId'> & { readonly poolLabel?: string } }
  | { readonly type: 'limit_hit'; readonly at: EpochMs; readonly hit: Omit<LimitHit, 'accountId' | 'at'> }
  | { readonly type: 'error'; readonly at: EpochMs; readonly class: 'auth' | 'network' | 'crash' | 'protocol' | 'unknown'; readonly message: string }
  | { readonly type: 'finished'; readonly at: EpochMs; readonly reason: 'completed' | 'failed' | 'cancelled' | 'limit' }
  | { readonly type: 'raw'; readonly at: EpochMs; readonly line: string };

// providers/fold-run.ts
export interface RunSummary {
  readonly sessionRef?: string;
  readonly inputTokens: number;
  readonly outputTokens: number;
  readonly cachedInputTokens: number;
  readonly costUsd?: number;             // sum of events that carried a cost
  readonly costKind?: CostKind;          // the kind of the first costed event
  readonly toolCalls: number;
  readonly failedToolCalls: number;
  readonly openPermissionAsks: readonly string[];   // ask ids without a later tool_result of the same id
  readonly lastLimit?: Extract<AgentEvent, { readonly type: 'limit_hit' }>;
  readonly outcome?: RunOutcome;          // from 'finished': completed→succeeded, failed, cancelled, limit
}
export function foldRun(events: readonly AgentEvent[]): RunSummary;
```

Rules:
- **R-43** `supportTier`: `structuredStream && permissionAsk === true` → `full`; `structuredStream` → `isolated`; else `experimental`.
- **R-44** `foldRun` sums token counts across all `usage` events; `sessionRef` is the last `session_started`; `outcome` maps from the last `finished` event.

---

## 12. `library/` — built-in roles and flows

Data only, validated by `validateDefinitions` in a test. Instructions are short English prompts the
user can edit; names are Turkish display names.

Roles (`RoleSlug` → name, write scope):
`planner` Planlayıcı (docs) · `analyst` Analist (docs) · `developer` Geliştirici (repo) ·
`test-writer` Test yazarı (tests) · `reviewer` Gözden geçirici (none) ·
`security-auditor` Güvenlik denetçisi (none) · `documenter` Belgeci (docs). All `active: true`,
`capabilities: []`.

Flows:
- `standard` Standart: `plan` (planner; human gate `plan-approval`) → `implement` (developer; command
  gate `tests` on set `tests`, `secret_scan` gate `secrets`; `onFail: implement ×3`) → `review`
  (reviewer; `agent_verdict` gate `review-verdict` role reviewer, human gate `review-approval`;
  `onFail: implement ×3`) → `close` (role null; human gate `closure`).
- `quick-fix` Hızlı düzeltme: `implement` (developer; `tests`, `secrets`; onFail implement ×3) → `close`.
- `security-reviewed` Güvenlik incelemeli: standard, with a `security` stage (security-auditor;
  `agent_verdict` role security-auditor + human `security-approval`) between `implement` and `review`.
- `research` Araştırma: `research` (analyst; `page_approval` gate `findings`).

```ts
export const BUILTIN_ROLES: readonly RoleDef[];
export const BUILTIN_FLOWS: readonly FlowDef[];
/** Command sets the built-in flows reference; a workspace must define them to use those flows. */
export const BUILTIN_COMMAND_SET_NAMES: readonly string[];   // ['tests']
```

Rule:
- **R-45** `validateDefinitions({ roles: BUILTIN_ROLES, flows: BUILTIN_FLOWS, capabilities: [], workspace: <fixture with commandSets.tests> })` is `ok`.

---

## 13. v1 parity (acceptance for the whole phase)

The `standard` flow must reproduce v1's work-order lifecycle. A scenario test
(`src/domain/flow/v1-parity.test.ts`) drives event sequences and asserts:

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
