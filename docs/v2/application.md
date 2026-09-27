# Application — contracts for Phase 2a

This is the authoritative contract for `src/application/` and `src/api/`. As with
[domain.md](domain.md): types and signatures are **exact**; implementers may add private helpers but
must not rename, reshape or drop anything below. If a contract cannot work as written, stop and
comment on the issue.

The application layer **orchestrates**: it loads data through ports, asks the domain for decisions,
and writes the results back through ports. Every rule of the business lives in the domain; if an
application function starts to decide something the domain does not cover, stop — that is a
missing domain rule.

General rules for `src/application/` and `src/api/`:

- Import the domain only through `src/domain/index.ts`. No npm packages, no Node builtins, no
  `Date`/`Math.random`/`crypto` (time and ids come from the `Clock` and `IdGen` ports).
- Use cases are plain `async` functions `(deps, input) => Promise<Result<…>>`. `deps` is a `Pick` of
  `AppDeps` naming only the ports the use case touches. No classes, no module-level state.
- Expected failures return `err(...)` with a typed code; only programming errors throw.
- Every state-changing use case appends one `AuditEntry` through `EventLog` with the acting `Actor`.
- Tests use the in-memory fakes from `src/application/ports/fakes/` (Phase 2a builds them). Rules
  are named **A-n**; each needs a test titled `A-n: …` in `src/application/**/*.test.ts`.

## Module map (`src/application/`)

| Folder | Content | May import |
| --- | --- | --- |
| `ports/` | Port interfaces (one file per port) + `index.ts` | domain |
| `ports/fakes/` | In-memory fakes of every port + `index.ts` | domain, `ports` |
| `use-cases/` | One file per use case group + `index.ts` | domain, `ports` |
| `services/` | Long-lived orchestration (dispatcher, run executor) + `index.ts` | domain, `ports`, `use-cases` |
| `index.ts` | Barrel: ports, use cases, services, `AppDeps` | all of the above |

Cross-layer scenario tests live in `src/api/scenarios/` (test files only), because only the API layer may import both the application and the API.

`src/api/` (contracts only in Phase 2a) may import domain and application.

---

## 1. Ports — `src/application/ports/`

```ts
// clock.ts
export interface Clock { now(): EpochMs }

// id-gen.ts
export interface IdGen { next<B extends string>(): Ulid<B> }

// event-log.ts
export type AuditAction =
  | 'work_order.opened' | 'work_order.blocked' | 'work_order.unblocked' | 'work_order.closed'
  | 'run.started' | 'run.finished' | 'gate.decided' | 'permission.answered'
  | 'proposal.created' | 'proposal.decided' | 'account.saved' | 'account.removed' | 'binding.saved';
export type AuditSubject =
  | { readonly kind: 'work_order'; readonly id: WorkOrderId }
  | { readonly kind: 'run'; readonly id: RunId }
  | { readonly kind: 'proposal'; readonly id: ProposalId }
  | { readonly kind: 'account'; readonly id: AccountId }
  | { readonly kind: 'binding'; readonly role: RoleSlug };
export interface AuditEntry {
  readonly id: Ulid<'audit'>;
  readonly at: EpochMs;
  readonly actor: Actor;
  readonly action: AuditAction;
  readonly subject: AuditSubject;
  /** Targets only (paths, command names, gate ids). Never secrets or environment values. */
  readonly detail?: Readonly<Record<string, string | number | boolean>>;
}
export interface EventLog {
  append(entry: AuditEntry): Promise<void>;
  list(subject: AuditSubject, limit: number): Promise<readonly AuditEntry[]>;   // newest first
}

// work-order-repo.ts
export interface WorkOrderRecord {
  readonly id: WorkOrderId;
  readonly workspace: WorkspaceSlug;
  readonly flow: FlowSlug;
  readonly title: string;
  readonly task?: TaskSlug;
  readonly createdAt: EpochMs;
  readonly createdBy: Actor;
}
export interface WorkOrderRepo {
  create(record: WorkOrderRecord): Promise<void>;
  get(id: WorkOrderId): Promise<WorkOrderRecord | undefined>;
  list(filter: { readonly workspace?: WorkspaceSlug }): Promise<readonly WorkOrderRecord[]>;  // createdAt asc
  appendEvent(id: WorkOrderId, event: WorkOrderEvent): Promise<void>;
  events(id: WorkOrderId): Promise<readonly WorkOrderEvent[]>;                                 // append order
}

// run-repo.ts
export interface RunRecord {
  readonly id: RunId;
  readonly workOrderId: WorkOrderId;
  readonly stage: StageSlug;
  readonly attempt: number;
  readonly role: RoleSlug;
  readonly route: AccountRoute;
  readonly startedAt: EpochMs;
  readonly endedAt?: EpochMs;
  readonly outcome?: RunOutcome;
  readonly sessionRef?: string;
  readonly autoResumesUsed: number;
}
export type RunPatch = Partial<Pick<RunRecord, 'endedAt' | 'outcome' | 'sessionRef' | 'autoResumesUsed'>>;
export interface RunRepo {
  create(record: RunRecord): Promise<void>;
  update(id: RunId, patch: RunPatch): Promise<void>;
  get(id: RunId): Promise<RunRecord | undefined>;
  listForWorkOrder(id: WorkOrderId): Promise<readonly RunRecord[]>;   // startedAt asc
  listActive(): Promise<readonly RunRecord[]>;                         // no endedAt
  appendEvents(id: RunId, events: readonly AgentEvent[]): Promise<void>;
  events(id: RunId): Promise<readonly AgentEvent[]>;
}

// account-repo.ts
export interface AccountRecord {
  readonly id: AccountId;
  readonly provider: string;             // provider definition id (data)
  readonly label: string;                // user-given, verbatim
  readonly authMode: AuthMode;
  readonly plan?: string;
  readonly limitPolicy: LimitPolicy;
  readonly secretRef?: string;           // key into SecretVault; never the secret itself
  readonly caps: readonly { readonly scope: 'account_day' | 'account_month'; readonly cap: SpendCap }[];
}
export interface AccountRepo {
  save(record: AccountRecord): Promise<void>;           // upsert
  get(id: AccountId): Promise<AccountRecord | undefined>;
  list(): Promise<readonly AccountRecord[]>;
  remove(id: AccountId): Promise<void>;
  savePools(accountId: AccountId, pools: readonly Pool[]): Promise<void>;     // replaces the account's pools
  saveMeter(meter: Meter): Promise<void>;                                     // upsert by id
  pools(accountId?: AccountId): Promise<readonly Pool[]>;
  meters(accountId?: AccountId): Promise<readonly Meter[]>;
  recordSpend(entry: { readonly accountId: AccountId; readonly workspace: WorkspaceSlug; readonly workOrderId: WorkOrderId; readonly at: EpochMs; readonly usd: number }): Promise<void>;
  spend(filter: { readonly accountId?: AccountId; readonly workspace?: WorkspaceSlug; readonly workOrderId?: WorkOrderId; readonly from: EpochMs; readonly to: EpochMs }): Promise<number>;
}

// binding-repo.ts — machine-local role → account chain, per level
export type BindingScope =
  | { readonly level: 'global' }
  | { readonly level: 'workspace'; readonly workspace: WorkspaceSlug }
  | { readonly level: 'workOrder'; readonly workOrderId: WorkOrderId };
export interface BindingRepo {
  save(scope: BindingScope, binding: RoleBinding): Promise<void>;
  get(scope: BindingScope, role: RoleSlug): Promise<RoleBinding | undefined>;
  listAll(): Promise<readonly { readonly scope: BindingScope; readonly binding: RoleBinding }[]>;
}

// queue-repo.ts — the dispatcher's durable queue
export interface QueueRepo {
  put(item: QueueItem): Promise<void>;                  // upsert by id
  remove(id: QueueItemId): Promise<void>;
  list(): Promise<readonly QueueItem[]>;
}

// definition-store.ts
export type DefinitionScope = { readonly kind: 'global' } | { readonly kind: 'workspace'; readonly workspace: WorkspaceSlug };
export interface DefinitionFile { readonly content: string; readonly hash: string }
export interface DefinitionStore {
  /** Global definitions merged with the workspace's (workspace ids override global ids of the same kind). */
  load(workspace: WorkspaceSlug): Promise<Result<Definitions, readonly DefinitionIssue[]>>;
  loadRoadmap(workspace: WorkspaceSlug): Promise<Result<Roadmap, readonly RoadmapIssue[]> | undefined>;  // undefined = no roadmap
  readFile(scope: DefinitionScope, target: string): Promise<DefinitionFile | undefined>;
  /** Writes only if the current hash equals `expectedHash` ('' = file must not exist). */
  writeFile(scope: DefinitionScope, target: string, content: string, expectedHash: string): Promise<Result<{ readonly hash: string }, 'stale'>>;
  workspacePath(workspace: WorkspaceSlug): Promise<string | undefined>;   // repo checkout root on this machine
  /** Parses the candidate content and validates the definitions as they WOULD be with it; writes nothing. */
  validateCandidate(scope: DefinitionScope, target: string, content: string): Promise<Result<void, readonly DefinitionIssue[]>>;
}

// proposal-repo.ts
export interface ProposalRecord extends Proposal { readonly scope: DefinitionScope }
export interface ProposalRepo {
  save(record: ProposalRecord): Promise<void>;     // upsert
  get(id: ProposalId): Promise<ProposalRecord | undefined>;
  list(filter: { readonly status?: ProposalStatus }): Promise<readonly ProposalRecord[]>;
}

// secret-vault.ts — values never leave this port except to a transport's environment
export interface SecretVault {
  put(ref: string, value: string): Promise<void>;
  get(ref: string): Promise<string | undefined>;
  remove(ref: string): Promise<void>;
}

// agent-transport.ts
export interface RunRequest {
  readonly runId: RunId;
  readonly cwd: string;
  readonly role: RoleDef;
  readonly route: AccountRoute;
  readonly prompt: string;
  readonly resume?: { readonly sessionRef: string };
  readonly capabilities: readonly CapabilityDef[];
}
export interface RunHandle {
  readonly events: AsyncIterable<AgentEvent>;       // ends after a 'finished' event
  answerPermission(askId: string, decision: 'allow' | 'deny'): void;
  steer(note: string): void;
  stop(): Promise<void>;
}
export type TransportError = { readonly code: 'not_installed' | 'not_logged_in' | 'spawn_failed' | 'unsupported'; readonly message: string };
export interface AgentTransport { start(request: RunRequest): Promise<Result<RunHandle, TransportError>> }
export interface TransportResolver { forAccount(accountId: AccountId): Promise<AgentTransport | undefined> }

// workspace-tools.ts — what gates and runs need from the machine
export interface CommandResult { readonly exitCode: number; readonly durationMs: number; readonly outputTail: string }
export interface CommandRunner {
  /** `env` (Phase 2c) is added to the runner's base environment for this call only; its values are redacted from `outputTail`. */
  run(cwd: string, command: string, timeoutMs: number, env?: Readonly<Record<string, string>>): Promise<CommandResult>;
}
export interface SecretScanner { scan(cwd: string): Promise<{ readonly findings: number }> }
export interface EvidenceChecker {
  /** True when every `path:line` pointer names an existing file and line in `cwd`. */
  resolvePointers(cwd: string, pointers: readonly string[]): Promise<boolean>;
}
export interface Worktrees {
  ensure(workspace: WorkspaceSlug, workOrderId: WorkOrderId): Promise<Result<{ readonly path: string }, 'no_repo'>>;
}

// notifier.ts
export interface Notifier { notify(title: string, body: string): void }

// deps.ts
export interface AppDeps {
  readonly clock: Clock; readonly ids: IdGen; readonly log: EventLog;
  readonly workOrders: WorkOrderRepo; readonly runs: RunRepo; readonly accounts: AccountRepo;
  readonly bindings: BindingRepo; readonly queue: QueueRepo; readonly definitions: DefinitionStore;
  readonly proposals: ProposalRepo; readonly secrets: SecretVault; readonly transports: TransportResolver;
  readonly commands: CommandRunner; readonly secretScanner: SecretScanner; readonly worktrees: Worktrees;
  readonly evidence: EvidenceChecker;
  readonly notifier: Notifier;
}
```

Rules for fakes (`ports/fakes/`):
- **A-1** Every port has an in-memory fake `createFake<Port>()` (e.g. `createFakeWorkOrderRepo()`), exported from `ports/fakes/index.ts`, plus `createFakeDeps(overrides?: Partial<AppDeps>): AppDeps`.
- **A-2** Fakes honour every ordering promise written in the port comments (e.g. `list` createdAt asc, `EventLog.list` newest first) and return copies, never internal arrays.
- **A-3** `FakeClock` has `advance(ms)`; `FakeIdGen` yields valid, strictly increasing ULIDs from a seed; `FakeTransport` is scripted: `createFakeTransport(script: readonly AgentEvent[])` emits the script, records `answerPermission`/`steer`/`stop` calls, and pauses on a `permission_ask` until it is answered.
- **A-4** `FakeDefinitionStore.writeFile` enforces `expectedHash` exactly like the contract ('' = must not exist) and returns `err('stale')` otherwise.

### Forge port (`ports/forge.ts`) — Phase 2c

```ts
export type ForgeKind = string;   // 'github' | 'bitbucket' | 'azure-devops' | 'gitlab' | … (data)
export interface ForgeCapabilities { readonly pullRequests: boolean; readonly checks: boolean; readonly issues: boolean }
export interface PullRequestRef { readonly number: number; readonly url: string }
export interface CheckRun {
  readonly name: string;
  readonly status: 'queued' | 'running' | 'passed' | 'failed' | 'cancelled' | 'skipped';
  readonly url?: string;
}
export type ForgeError = 'auth' | 'not_found' | 'network' | 'rate_limited' | 'unknown';

export interface Forge {
  readonly kind: ForgeKind;
  readonly capabilities: ForgeCapabilities;
  pushBranch(repo: RepoRef, branch: string): Promise<Result<void, ForgeError>>;
  openPullRequest(repo: RepoRef, input: {
    readonly head: string; readonly base: string;
    readonly title: string; readonly body: string;
  }): Promise<Result<PullRequestRef, ForgeError>>;
  pullRequest(repo: RepoRef, number: number): Promise<Result<{
    readonly state: 'open' | 'merged' | 'closed';
    readonly mergeable?: boolean;
  }, ForgeError>>;
  checks(repo: RepoRef, ref: string): Promise<Result<readonly CheckRun[], ForgeError>>;
  mergePullRequest(repo: RepoRef, number: number): Promise<Result<void, ForgeError>>;
}

/** Resolves the forge for a given repo (by remote URL host or explicit config). */
export interface ForgeResolver { forRepo(repo: RepoRef): Promise<Forge | undefined> }
```

Fake: `createFakeForge(opts?: { checks?: readonly CheckRun[] }): Forge & { readonly pushed: readonly string[]; readonly opened: readonly { head: string; base: string; title: string }[] }`.

### IssueTracker port (`ports/issue-tracker.ts`) — Phase 2c

```ts
export interface ExternalItem {
  readonly source: string; readonly key: string;
  readonly title: string; readonly url: string;
  readonly status: string; readonly updatedAt: EpochMs;
}
export type TrackerError = 'auth' | 'not_found' | 'network' | 'rate_limited' | 'unknown';

export interface IssueTracker {
  readonly kind: string;   // 'jira' | 'azure-boards' | 'github-issues' | 'odoo-project' | … (data)
  search(query: string, limit: number): Promise<Result<readonly ExternalItem[], TrackerError>>;
  get(key: string): Promise<Result<ExternalItem | undefined, TrackerError>>;
  comment(key: string, text: string): Promise<Result<void, TrackerError>>;
  transition(key: string, status: string): Promise<Result<void, TrackerError>>;
}
```

Fake: `createFakeTracker(): IssueTracker & { readonly items: ExternalItem[]; readonly comments: readonly { key: string; text: string }[] }`.

---

## 2. Use cases — `src/application/use-cases/`

All inputs carry `actor: Actor` when they change state.

```ts
// work-orders.ts
export type OpenError = 'definitions_invalid' | 'unknown_flow' | 'flow_not_enabled' | 'unknown_task' | 'empty_title';
export function openWorkOrder(
  deps: Pick<AppDeps, 'clock' | 'ids' | 'log' | 'workOrders' | 'definitions'>,
  input: { readonly workspace: WorkspaceSlug; readonly title: string; readonly flow?: FlowSlug; readonly task?: TaskSlug; readonly actor: Actor },
): Promise<Result<WorkOrderId, OpenError>>;

export interface WorkOrderView {
  readonly record: WorkOrderRecord;
  readonly state: WorkOrderState;
  readonly next: FlowAction;
  readonly runs: readonly RunRecord[];
}
export type ViewError = 'not_found' | 'definitions_invalid' | 'unknown_flow';
export function getWorkOrder(
  deps: Pick<AppDeps, 'workOrders' | 'runs' | 'definitions'>, id: WorkOrderId,
): Promise<Result<WorkOrderView, ViewError>>;

export type ControlError = 'not_found' | 'already_done' | 'not_blocked';
export function blockWorkOrder(deps: Pick<AppDeps, 'clock' | 'ids' | 'log' | 'workOrders'>, input: { readonly id: WorkOrderId; readonly reason: string; readonly actor: Actor }): Promise<Result<void, ControlError>>;
export function unblockWorkOrder(deps: Pick<AppDeps, 'clock' | 'ids' | 'log' | 'workOrders' | 'definitions'>, input: { readonly id: WorkOrderId; readonly actor: Actor }): Promise<Result<void, ControlError>>;
export function closeWorkOrder(deps: Pick<AppDeps, 'clock' | 'ids' | 'log' | 'workOrders'>, input: { readonly id: WorkOrderId; readonly actor: Actor }): Promise<Result<void, ControlError>>;

// gates.ts
export type DecideGateError = 'not_found' | 'not_current_stage' | 'not_pending' | 'not_a_human_gate' | 'agent_cannot_decide';
export function decideHumanGate(
  deps: Pick<AppDeps, 'clock' | 'ids' | 'log' | 'workOrders' | 'definitions'>,
  input: { readonly id: WorkOrderId; readonly gate: GateSlug; readonly decision: 'approved' | 'rejected'; readonly note?: string; readonly actor: Actor },
): Promise<Result<WorkOrderState, DecideGateError>>;

/** Evaluates every pending machine gate of the current stage (command, secret_scan, agent_verdict). */
export function evaluateMachineGates(
  deps: Pick<AppDeps, 'clock' | 'workOrders' | 'definitions' | 'commands' | 'secretScanner' | 'worktrees' | 'runs'>,
  input: { readonly id: WorkOrderId },
): Promise<Result<WorkOrderState, 'not_found' | 'not_gating' | 'definitions_invalid' | 'no_repo'>>;

/** An agent_verdict gate's evidence: the reviewer role reports approve/reject with evidence pointers. */
export type VerdictError = 'not_found' | 'not_current_stage' | 'not_pending' | 'not_an_agent_gate' | 'wrong_role' | 'no_repo';
export function submitAgentVerdict(
  deps: Pick<AppDeps, 'clock' | 'ids' | 'log' | 'workOrders' | 'definitions' | 'worktrees' | 'evidence'>,
  input: { readonly id: WorkOrderId; readonly gate: GateSlug; readonly approve: boolean; readonly pointers: readonly string[]; readonly actor: Actor },
): Promise<Result<WorkOrderState, VerdictError>>;

// routing.ts
export type RouteError = 'unknown_role' | 'no_binding' | 'no_account';
/** Resolves the role definition (with overrides) and the account chain for a stage run. */
export function resolveRoute(
  deps: Pick<AppDeps, 'definitions' | 'bindings' | 'accounts'>,
  input: { readonly workspace: WorkspaceSlug; readonly workOrderId: WorkOrderId; readonly role: RoleSlug },
): Promise<Result<{ readonly role: RoleDef; readonly chain: readonly AccountRoute[] }, RouteError>>;

// proposals.ts
export type ProposeError = 'no_change';
export function createProposal(
  deps: Pick<AppDeps, 'clock' | 'ids' | 'log' | 'proposals' | 'definitions'>,
  input: { readonly scope: DefinitionScope; readonly target: string; readonly after: string; readonly summary: string; readonly author: Actor },
): Promise<Result<ProposalId, ProposeError>>;
export type ApplyError = 'not_found' | 'not_pending' | 'stale' | 'self_approval' | 'invalid_after';
export function decideProposalUseCase(
  deps: Pick<AppDeps, 'clock' | 'ids' | 'log' | 'proposals' | 'definitions'>,
  input: { readonly id: ProposalId; readonly decision: 'approved' | 'rejected'; readonly actor: Actor },
): Promise<Result<ProposalRecord, ApplyError>>;

// accounts.ts
export function saveAccount(deps: Pick<AppDeps, 'clock' | 'ids' | 'log' | 'accounts' | 'secrets'>, input: { readonly record: AccountRecord; readonly secret?: string; readonly actor: Actor }): Promise<Result<void, 'secret_without_ref'>>;
export function removeAccount(deps: Pick<AppDeps, 'clock' | 'ids' | 'log' | 'accounts' | 'secrets'>, input: { readonly id: AccountId; readonly actor: Actor }): Promise<Result<void, 'not_found'>>;
export function saveBinding(deps: Pick<AppDeps, 'clock' | 'ids' | 'log' | 'bindings'>, input: { readonly scope: BindingScope; readonly binding: RoleBinding; readonly actor: Actor }): Promise<Result<void, 'empty_chain'>>;
```

Rules:
- **A-5** `openWorkOrder`: title is trimmed and must be non-empty; `flow` defaults to `workspace.defaultFlow`; the flow must exist and be listed in `workspace.flows`; if `task` is given, the workspace roadmap must contain it. On success: create the record, append one `created` event (`at = clock.now()`, `by = actor`), append audit `work_order.opened`.
- **A-6** `getWorkOrder` derives `state` with `deriveWorkOrderState` and `next` with `nextAction` from the **current** definitions; nothing derived is stored.
- **A-7** `blockWorkOrder`/`unblockWorkOrder`/`closeWorkOrder` append the matching event only when it changes something: closing a `done` work order → `already_done`; unblocking one that is not `blocked` → `not_blocked`. Each success appends one audit entry.
- **A-8** `decideHumanGate`: the gate must belong to the **current** stage and be in `pendingGates`; it must be `human` or `page_approval`; an `agent` actor → `agent_cannot_decide`. The verdict comes from the domain's `evaluateGate` with `approval`/`pageApproval` evidence, appended as one `gate_evaluated` event; audit `gate.decided` with `detail: { gate, decision }`.
- **A-9** `evaluateMachineGates`: only when status is `gating`. For each pending `command` and `secret_scan` gate of the current stage, in stage order: `command` → run every command of the set in order in the work order's worktree (timeout 10 min each) and pass all results as evidence; `secret_scan` → `SecretScanner.scan`. Append one `gate_evaluated` per evaluated gate, then return the re-derived state. `agent_verdict` gates are not touched here (see A-9a).
- **A-9a** `submitAgentVerdict`: the gate must be a pending `agent_verdict` gate of the current stage; the actor must be `kind: 'agent'` with `role` equal to the gate's `role` (`wrong_role` otherwise). `pointersResolved = pointers.length > 0 && EvidenceChecker.resolvePointers(worktree, pointers)`. The verdict comes from the domain `evaluateGate`; append one `gate_evaluated`; audit `gate.decided` with `detail: { gate, decision: approve ? 'approved' : 'rejected' }`.
- **A-10** `resolveRoute`: role = the definition with workspace overrides applied (`applyRoleOverrides`); must exist and be active. Binding layers are read for `workOrder`, `workspace`, `global` and resolved with `resolveBinding`; the chain keeps only accounts that exist in `AccountRepo`, in order. Empty after filtering → `no_account`; no binding at any level → `no_binding`.
- **A-11** `createProposal`: reads the target's current file (hash `''` if absent); `after === before` → `no_change`; stores a `pending` proposal with `baseHash`; audit `proposal.created`.
- **A-12** `decideProposalUseCase`, in this order: (1) load the proposal (`not_found`); (2) read the target's current hash (`''` if absent); (3) on `approved` only: `DefinitionStore.validateCandidate(scope, target, after)` — issues → `invalid_after`, proposal stays `pending`; (4) domain `decideProposal(p, decision, actor, currentHash, now)` — `stale` → save the proposal with status `stale` and return `stale`; `not_pending`/`self_approval` → return as is; (5) on `approved`: `writeFile(scope, target, after, baseHash)` — `err('stale')` → save as `stale`, return `stale`; (6) save the decided proposal; audit `proposal.decided` with `detail: { decision }`. Rejection never touches files.
- **A-13** `saveAccount`: a `secret` requires `record.secretRef` (`secret_without_ref` otherwise) and is stored only through `SecretVault.put`; the secret never appears in the record, the audit entry, or any return value. `removeAccount` removes the vault entry too.
- **A-14** `saveBinding`: an empty account chain → `empty_chain`; audit `binding.saved` naming the role.

---

## 3. Services — `src/application/services/`

```ts
// run-executor.ts — drives one run from start to finish
export interface ExecuteRunInput { readonly item: QueueItem; readonly role: RoleDef; readonly prompt: string; readonly cwd: string; readonly capabilities: readonly CapabilityDef[] }
export type ExecuteOutcome =
  | { readonly kind: 'finished'; readonly outcome: RunOutcome }
  | { readonly kind: 'transport_error'; readonly error: TransportError }
  | { readonly kind: 'limit'; readonly decision: LimitDecision };
export interface PermissionGate { onAsk(runId: RunId, ask: Extract<AgentEvent, { readonly type: 'permission_ask' }>): Promise<'allow' | 'deny'> }
export function executeRun(
  deps: Pick<AppDeps, 'clock' | 'ids' | 'log' | 'workOrders' | 'runs' | 'accounts' | 'transports'>,
  permissions: PermissionGate,
  input: ExecuteRunInput,
): Promise<ExecuteOutcome>;

// dispatcher.ts — one tick of the dispatcher
export interface DispatcherConfig { readonly limits: DispatchLimits }
export interface TickResult { readonly decisions: readonly DispatchDecision[]; readonly started: readonly QueueItemId[] }
export function dispatcherTick(
  deps: Pick<AppDeps, 'clock' | 'queue' | 'runs' | 'accounts' | 'workOrders'>,
  config: DispatcherConfig,
  start: (item: QueueItem) => void,        // fire-and-forget: the caller runs executeRun
): Promise<TickResult>;
/** Turns a limit decision into queue state. */
export function applyLimitDecision(
  deps: Pick<AppDeps, 'clock' | 'ids' | 'queue' | 'runs' | 'workOrders'>,
  input: { readonly runId: RunId; readonly decision: LimitDecision },
): Promise<Result<{ readonly queued?: QueueItemId }, 'not_found'>>;
export function enqueueStage(
  deps: Pick<AppDeps, 'clock' | 'ids' | 'queue' | 'workOrders' | 'definitions' | 'bindings' | 'accounts'>,
  input: { readonly id: WorkOrderId; readonly priority?: number },
): Promise<Result<QueueItemId, 'not_found' | 'not_ready' | RouteError | 'definitions_invalid'>>;
```

Rules:
- **A-15** `executeRun`: creates the `RunRecord` (`autoResumesUsed` from a previous run of the same stage+attempt if resuming, else 0), appends `run_started` to the work order and audit `run.started`, then starts the transport for `route.accountId`. A missing transport or a start error → `transport_error`, the run record gets `endedAt` and outcome `failed`, and `run_finished: failed` is appended.
- **A-16** While streaming, every event is persisted with `RunRepo.appendEvents` in arrival order (batched is fine, order is not negotiable). `session_started` sets `sessionRef`. `permission_ask` is passed to `PermissionGate.onAsk` and the answer to `answerPermission`. `quota_signal` → `AccountRepo.saveMeter` (a new `MeterId` from `IdGen` unless a meter with the same pool label and duration exists). `usage` with a cost → `recordSpend`.
- **A-17** On `limit_hit`: build a `LimitHit` for the run's account, ask the domain `decideOnLimit` with the account's policy and `autoResumesUsed`, end the run with outcome `limit`, append `run_finished: limit`, and return `{ kind: 'limit', decision }`. Scheduling the resume is the caller's job.
- **A-17a** `applyLimitDecision`: `schedule_resume` → put a queue item for the run's work order and stage with the same route, `notBefore = decision.at`, and increment the run's `autoResumesUsed` on the record; `switch_pool` → a queue item routed to the same account (pool choice is re-evaluated at dispatch); `fallback` → a queue item with `route = decision.route`; `ask` → no queue item (the work order stays `limit_waiting` and shows in the cockpit).
- **A-18** On `finished`: set `endedAt`/`outcome` (mapping as in `foldRun`), append `run_finished`, audit `run.finished` with `detail: { outcome }`.
- **A-19** `enqueueStage`: only when `nextAction` is `start_run`; the route is the first account of `resolveRoute`'s chain; one queue item per work order (an existing item for the same work order is replaced).
- **A-20** `dispatcherTick`: builds the `DispatchSnapshot` — `running` from `RunRepo.listActive` joined with `WorkOrderRepo` for the workspace, `headroom` per item from `headroom(pools, meters, accountId, model ?? '', now)`, `spend` per item from `combinedSpendStatus` over the account's own caps (`account_day` = UTC day of `now`, `account_month` = UTC calendar month of `now`; workspace and work-order caps arrive in Phase 5) — calls `decideDispatch`, removes started items from the queue, calls `start` for each started item, and returns the decisions unchanged.

---

## 4. API contracts — `src/api/`

Plain JSON-serialisable types only (no functions, no class instances, no `undefined`-only fields).
Phase 2a defines the contracts and a transport-free `createApi(deps)` that maps each command/query
to use cases; Phase 4 binds it to Electron IPC.

```ts
// commands.ts
export type Command =
  | { readonly type: 'workOrder.open'; readonly workspace: string; readonly title: string; readonly flow?: string; readonly task?: string }
  | { readonly type: 'workOrder.block'; readonly id: string; readonly reason: string }
  | { readonly type: 'workOrder.unblock'; readonly id: string }
  | { readonly type: 'workOrder.close'; readonly id: string }
  | { readonly type: 'workOrder.enqueue'; readonly id: string }
  | { readonly type: 'gate.decide'; readonly workOrderId: string; readonly gate: string; readonly decision: 'approved' | 'rejected'; readonly note?: string }
  | { readonly type: 'proposal.decide'; readonly id: string; readonly decision: 'approved' | 'rejected' };
export type CommandResult = { readonly ok: true; readonly id?: string } | { readonly ok: false; readonly code: string };

// queries.ts
export type Query =
  | { readonly type: 'workOrder.detail'; readonly id: string }
  | { readonly type: 'workspace.board'; readonly workspace: string }
  | { readonly type: 'cockpit' };
export interface AttentionItem { readonly workOrderId: string; readonly workspace: string; readonly title: string; readonly kind: 'awaiting_human' | 'permission_ask' | 'limit_waiting' | 'blocked'; readonly stage: string | null; readonly since: number }
export interface CockpitView { readonly attention: readonly AttentionItem[]; readonly running: readonly { readonly workOrderId: string; readonly stage: string; readonly accountId: string; readonly startedAt: number }[] }
export interface BoardColumn { readonly stage: string; readonly name: string; readonly workOrders: readonly { readonly id: string; readonly title: string; readonly status: string }[] }
export interface BoardView { readonly workspace: string; readonly flow: string; readonly columns: readonly BoardColumn[]; readonly done: readonly { readonly id: string; readonly title: string }[] }

// api.ts
export interface Api {
  command(actor: Actor, command: Command): Promise<CommandResult>;
  query(query: Query): Promise<unknown>;          // narrowed per query type by the caller helpers below
}
export function createApi(deps: AppDeps): Api;
```

Rules:
- **A-21** Every string id in a command is parsed with `parseSlug`/`parseUlid` before reaching a use case; a parse failure returns `{ ok: false, code: 'invalid_id' }` without calling any port.
- **A-22** `cockpit.attention` is ordered by kind (`permission_ask`, `awaiting_human`, `blocked`, `limit_waiting`), then `since` ascending.
- **A-23** `workspace.board` has one column per stage of the workspace's default flow, in flow order; each work order sits in the column of its current stage; `done` work orders go to `done`.

### Phase 4 API additions (shapes here; rules U-11 … U-14 in ui.md)

The Phase 4 commands, queries and the `subscribe` member are specified in
[ui.md](ui.md) → "API additions", with their rules (**U-11 … U-14**) — the U prefix, like the
providers' P prefix, keeps the rule-coverage gate green until the coverage-extension issue
(the batch's last wave) wires it up. Signatures, for reference:

```ts
// commands
| { type: 'permission.answer'; runId: string; askId: string; decision: 'allow' | 'deny' }
| { type: 'deploy.approve'; workOrderId: string; gate: string; commit: string; confirmedEnvironment?: string }
| { type: 'account.save'; id?: string; provider: string; label: string; authMode: string; plan?: string }
| { type: 'account.remove'; id: string }
| { type: 'binding.save'; role: string; accounts: { accountId: string; model?: string }[] }
// queries
| { type: 'settings.accounts' }        → accounts with pools/meters and per-role bindings
| { type: 'providers.discovered' }     → DiscoveredProvider[]
// Api member
subscribe(listener: (e: UiEvent) => void): () => void;
type UiEvent = { type: 'workOrders.changed' } | { type: 'run.updated'; runId: string };
```

### Deploy and remote-checks use cases — Phase 2c

```ts
// use-cases/deploy-gate.ts
export type DeployGateError =
  | 'not_found' | 'not_current_stage' | 'not_pending' | 'not_a_deploy_gate'
  | 'no_approval' | 'confirmation_mismatch' | 'promote_prerequisite_missing'
  | 'definitions_invalid' | 'unknown_environment' | 'no_repo';

export function approveAndDeploy(
  deps: Pick<AppDeps, 'clock' | 'ids' | 'log' | 'workOrders' | 'definitions' | 'worktrees' | 'commands' | 'secrets'>,
  input: {
    readonly id: WorkOrderId; readonly gate: GateSlug;
    readonly approver: Actor;    // must be user
    readonly commit: string;
    readonly confirmedEnvironment?: EnvSlug;   // required for protected environments
  },
): Promise<Result<WorkOrderState, DeployGateError>>;

// use-cases/remote-checks-gate.ts
export type RemoteChecksError =
  | 'not_found' | 'not_current_stage' | 'not_pending' | 'not_a_remote_checks_gate'
  | 'forge_unavailable' | 'forge_error';

/** `forges` is passed separately (like `PermissionGate` in executeRun); it is not part of AppDeps. */
export function pollRemoteChecks(
  deps: Pick<AppDeps, 'clock' | 'workOrders' | 'definitions'>,
  forges: ForgeResolver,
  input: {
    readonly id: WorkOrderId; readonly gate: GateSlug;
    readonly branchRef: string;
    readonly repo: RepoRef;
  },
): Promise<Result<WorkOrderState, RemoteChecksError>>;
```

- **E-11** `approveAndDeploy`: gate must be a pending `deploy` gate of the current stage; `approver.kind` must be `'user'` (`no_approval`). For `protected` environments, `input.confirmedEnvironment` must equal the gate's environment (`confirmation_mismatch`). The environment must exist in the workspace definition (`unknown_environment`); the worktree comes from `Worktrees.ensure` (`no_repo`). When `promoteFrom` is set, a `deployment_attempted` with `result: 'success'` for the same `commit` on the prerequisite environment must exist in the event history (`promote_prerequisite_missing`).
- **E-12** Deploy execution: run `deploy` commandSet in the work order's worktree with the environment's `env` values passed as `CommandRunner.run`'s `env` argument (literal + `SecretVault`-resolved `secretRef`; an unresolvable ref → `result: 'failed'` without running). If deploy exits 0 and `verify` exists, run `verify` the same way. Both exit 0 → `result: 'success'`; otherwise → `result: 'failed'`.
- **E-13** After deploy execution, append one `deployment_attempted` event and one `gate_evaluated` event (using E-6). Environment values and secrets never appear in the event or the output tail. The event's output tail comes from the first failing command; when every command (including `verify`) succeeded, from the last one.
- **E-14** `pollRemoteChecks`: gate must be a pending `remote_checks` gate of the current stage. Resolve the forge via `ForgeResolver.forRepo`; if unavailable → `forge_unavailable`. Call `forge.checks(repo, branchRef)`.
- **E-15** Match returned checks against `required`: if `required === 'all'`, use all returned checks; otherwise filter to those whose `name` is in the `required` array. A `required` name the forge did not return counts as not-passed (the gate stays pending; it never passes vacuously). Determine status: all `passed` → `all_passed`; any `failed`/`cancelled` → `has_failure`; otherwise → `pending`.
- **E-16** If elapsed time since the gate entered `pending` exceeds `timeoutMinutes` → `timeout`.
- **E-17** Append one `gate_evaluated` event with the `remoteChecks` evidence. `pending` → do not append (gate stays pending, re-polled by the dispatcher later).
- **E-18** `evaluateMachineGates` (updated A-9): after processing existing `command`/`secret_scan` gates, also process pending `remote_checks` gates by calling `pollRemoteChecks` — only when the input carries `remote: { readonly forges: ForgeResolver; readonly repo: RepoRef; readonly branchRef: string }` (a new optional field of `evaluateMachineGates`' input); without it they are left pending. Every `GateContext` built by a use case includes `environments` from the workspace definition. `deploy` gates are **not** evaluated by `evaluateMachineGates` — they require explicit human approval via `approveAndDeploy`.
- **E-19** The Phase 2c headless acceptance scenario extends the standard flow with an environment stage: `deploy-stg` → `deploy-prd` (protected, `promoteFrom: stg`), with the fake forge returning all-green checks for a `remote_checks` gate.

---

## 5. Phase 2a acceptance — headless end to end

`src/api/scenarios/standard-flow.test.ts` (test-only folder in the API layer, which may import the
application and the domain) drives the built-in `standard` flow with fakes: opening and human gate
decisions go through `createApi`; runs, machine gates and agent verdicts call the application
directly:

1. open → `plan`/`ready`; enqueue + tick → started; `executeRun` with a fake transport that
   finishes `completed` → `plan`/`awaiting_human`.
2. `gate.decide plan-approval approved` → `implement`/`ready`.
3. enqueue + tick + run (completed) → `gating`; `evaluateMachineGates` with commands exiting 0 and
   0 scan findings → `review`/`ready`.
4. run the reviewer (completed) → `gating`; `submitAgentVerdict` (reviewer actor, approve,
   pointers resolve) → `awaiting_human`; `gate.decide review-approval approved` → `close`.
5. `gate.decide closure approved` → `done`.

Asserts the state after every step, the queue is empty at the end, every run has an outcome, and
the audit trail lists the expected actions in order. A second test: the implement run hits a
limit with policy `wait_resume` → `limit_waiting` and a queue item with `notBefore = resetsAt +
60 s` exists after the caller schedules it.

---

## 6. Quota polling — Phase 3

Ports and use cases for Phase 3 are specified with their rules in
[providers.md](providers.md) → "Phase 3 contracts" (**P-18 … P-21**). Signatures, for reference:

```ts
// ports/quota-probe.ts
export type QuotaProbeError = 'not_installed' | 'not_logged_in' | 'probe_failed' | 'unknown_provider';
export interface MeterReading {
  readonly pool: { readonly label: string; readonly kind: PoolKind; readonly appliesTo: readonly ModelMatcher[] | 'all' };
  readonly meter: Omit<Meter, 'id' | 'poolId'>;
}
export interface QuotaProbe {
  poll(defId: string, binPath: string | null): Promise<Result<readonly MeterReading[], QuotaProbeError>>;
}
export interface QuotaProbeResolver { forProvider(defId: string): QuotaProbe | undefined }

// use-cases/quota-poll.ts
export function pollQuota(
  deps: Pick<AppDeps, 'clock' | 'ids' | 'log' | 'accounts'>,
  probes: QuotaProbeResolver,
  input: { readonly accountId: AccountId },
): Promise<Result<readonly Meter[], QuotaProbeError>>;
```

The resume-fallback behaviour (**P-22**, providers.md) changes no signature: it lives inside the run
executor's existing start path.
