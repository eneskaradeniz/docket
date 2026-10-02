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
  | 'proposal.created' | 'proposal.decided' | 'account.saved' | 'account.removed' | 'account.adopted' | 'binding.saved'
  | 'project.attached' | 'repo.registered' | 'repo.unregistered';
export type AuditSubject =
  | { readonly kind: 'work_order'; readonly id: WorkOrderId }
  | { readonly kind: 'run'; readonly id: RunId }
  | { readonly kind: 'proposal'; readonly id: ProposalId }
  | { readonly kind: 'account'; readonly id: AccountId }
  | { readonly kind: 'binding'; readonly role: RoleSlug }
  | { readonly kind: 'project'; readonly id: ProjectSlug }
  | { readonly kind: 'repo'; readonly id: RepoSlug };
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
  readonly project: ProjectSlug;
  readonly repo: RepoSlug;
  readonly flow: FlowSlug;
  readonly title: string;
  readonly task?: TaskSlug;
  readonly createdAt: EpochMs;
  readonly createdBy: Actor;
}
export interface WorkOrderRepo {
  create(record: WorkOrderRecord): Promise<void>;
  get(id: WorkOrderId): Promise<WorkOrderRecord | undefined>;
  /** Display number (A-29): 1-based rank of `id` by (createdAt asc, id asc) on this machine; undefined for an unknown id. */
  number(id: WorkOrderId): Promise<number | undefined>;
  list(filter: { readonly project?: ProjectSlug; readonly repo?: RepoSlug }): Promise<readonly WorkOrderRecord[]>;  // createdAt asc
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
  readonly definitionsRev?: string;       // revision marker of the definitions the stage prompt was computed from; drives A-62's changed-note
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
  readonly routeKind?: string;           // route kind id from the capability registry (data); absent → derived from provider + authMode
  readonly endpoint?: string;            // https URL of a compatible endpoint; not a secret; its host must match the route kind's preset host
  readonly identityDir?: string;         // absolute path of the user's own config directory; subscription route kinds only
  readonly tierModels?: Readonly<Record<'strong' | 'balanced' | 'fast', string>>; // model ids per tier; overrides the route kind defaults
  readonly consentedModels?: readonly string[]; // model ids the user allowed for metered or unverified use; the asterisk means the route's default model
  readonly caps: readonly { readonly scope: 'account_day' | 'account_week' | 'account_month'; readonly cap: SpendCap }[];
  readonly reserve?: QuotaReserve;       // share of each window kept back for the user's own use (R-49); no money involved
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
  recordSpend(entry: { readonly accountId: AccountId; readonly project: ProjectSlug; readonly repo: RepoSlug; readonly workOrderId: WorkOrderId; readonly at: EpochMs; readonly usd: number }): Promise<void>;
  spend(filter: { readonly accountId?: AccountId; readonly project?: ProjectSlug; readonly repo?: RepoSlug; readonly workOrderId?: WorkOrderId; readonly from: EpochMs; readonly to: EpochMs }): Promise<number>;
}

// project-repo.ts — the persisted mirror of every attached project's project.yaml (query joins)
export interface ProjectRepo {
  save(def: ProjectDef): Promise<void>;                       // upsert (attach / project.yaml change)
  get(project: ProjectSlug): Promise<ProjectDef | undefined>;
  list(): Promise<readonly ProjectDef[]>;                     // id asc
  projectOfRepo(repo: RepoSlug): Promise<ProjectDef | undefined>;
  remove(project: ProjectSlug): Promise<void>;
}

// binding-repo.ts — machine-local role → account chain, per level
export type BindingScope =
  | { readonly level: 'global' }
  | { readonly level: 'project'; readonly project: ProjectSlug }
  | { readonly level: 'repo'; readonly repo: RepoSlug }
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
export type DefinitionScope =
  | { readonly kind: 'global' }
  | { readonly kind: 'project'; readonly project: ProjectSlug }
  | { readonly kind: 'repo'; readonly repo: RepoSlug };
export interface DefinitionFile { readonly content: string; readonly hash: string }
export interface DefinitionStore {
  /** Global definitions merged with the repo's project defaults and the repo's own (repo ids win — S3). */
  load(repo: RepoSlug): Promise<Result<Definitions, readonly DefinitionIssue[]>>;
  /** Reads and validates `project.yaml` at an arbitrary checkout path (the attach flow). */
  readProjectAt(path: string): Promise<Result<ProjectDef, readonly DefinitionIssue[]>>;
  /** The project's roadmap, read from the main repo's `.docket/roadmap.yaml`; undefined = no roadmap. */
  loadRoadmap(project: ProjectSlug): Promise<Result<Roadmap, readonly RoadmapIssue[]> | undefined>;
  readFile(scope: DefinitionScope, target: string): Promise<DefinitionFile | undefined>;
  /** Writes only if the current hash equals `expectedHash` ('' = file must not exist). */
  writeFile(scope: DefinitionScope, target: string, content: string, expectedHash: string): Promise<Result<{ readonly hash: string }, 'stale'>>;
  repoPath(repo: RepoSlug): Promise<string | undefined>;   // repo checkout root on this machine
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
  readonly effort?: EffortLevel;         // resolved by executeRun (A-46); absent → the CLI's own default
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

// repo-tools.ts — what gates and runs need from the machine
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
  ensure(repo: RepoSlug, workOrderId: WorkOrderId): Promise<Result<{ readonly path: string }, 'no_repo'>>;
}

// git-probe.ts — the one git question the attach flow asks (A-24); kept apart from Worktrees so a
// use case can ask it without gaining worktree powers
export interface GitProbe {
  isWorkTree(path: string): Promise<boolean>;   // an existing checkout, not a bare repository
}

// repo-registry.ts — machine-local pointers only (S1): where each repo is cloned on this machine
export interface RepoRegistry {
  path(slug: RepoSlug): Promise<string | undefined>;
  register(slug: RepoSlug, path: string): Promise<void>;          // upsert; `path` absolute
  list(): Promise<readonly { readonly slug: RepoSlug; readonly path: string }[]>;   // slug asc
  remove(slug: RepoSlug): Promise<void>;
}

// notifier.ts
export interface Notifier { notify(title: string, body: string): void }

// deps.ts
export interface AppDeps {
  readonly clock: Clock; readonly ids: IdGen; readonly log: EventLog;
  readonly workOrders: WorkOrderRepo; readonly runs: RunRepo; readonly accounts: AccountRepo;
  readonly projects: ProjectRepo; readonly repos: RepoRegistry; readonly git: GitProbe;
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

### Update checker port (`ports/update-checker.ts`)

The app's own newer version — machine-local state with no repo data and no fitting `AuditAction`
(the permission board's answers are unlogged the same way), so the port sits **beside `AppDeps`**
(the forge, tracker and discovery precedent) and the composition root hands it to the api. The
real updater (release feed check, download, install, signing) is a later contract.

```ts
export type UpdateState =
  | { readonly kind: 'none'; readonly current: string }
  | { readonly kind: 'available'; readonly current: string; readonly next: string }
  | { readonly kind: 'downloading'; readonly current: string; readonly next: string; readonly percent: number }
  | { readonly kind: 'ready'; readonly current: string; readonly next: string }
  | { readonly kind: 'error'; readonly current: string; readonly reason: 'offline' | 'failed' };

export interface UpdateChecker {
  state(): Promise<UpdateState>;
  check(): Promise<UpdateState>;                                              // re-checks; the answer is the new state
  apply(): Promise<Result<void, 'not_available'>>;   // starts the install; only from available or ready
}
```

Implementations (infrastructure, `system/`):
- **No-op checker** `createNoopUpdateChecker(current)` — the default: `state`/`check` always answer
  `{ kind: 'none', current }`, `apply` always refuses, and no network call is ever made.
- **Design checker** `createDesignUpdateChecker(current, next, stepMs?)` — answers `available` with
  `next`, and `apply` walks `downloading` → `ready` over a few seconds; a re-check never undoes
  progress. The composition root installs it only when `DOCKET_UPDATE_FAKE` holds a version string,
  and that one line is production's only read of the variable.

Fake: `createFakeUpdateChecker(initial?)` — `queueCheck(state)` scripts the next `check` answer
(adopted once), `apply` honours the port guard and moves to `downloading` at percent 0, and
`applyCalls()` counts apply calls (refused included).

### Instructions, checkpoints, handoff (#581)

Ports for [providers.md](providers.md) **P-37**/**P-38**: the effective instructions of a run
(P-37), checkpoint commits in the work order's worktree, and the handoff pack a continuation run
starts from (P-38). The pure functions live in [domain.md](domain.md) §11 (`R-53 … R-57`) and
`QueueItem` gains `handoffOf` ([domain.md](domain.md) §8); the use cases are in §2, the executor
rules in §3, the acceptance scenario in §7. Fakes follow A-1 … A-3.

```ts
// ports/instruction-files.ts
export interface InstructionFiles {
  /** Reads the named files at the worktree root. Absent names are skipped; files over 1 MiB or
   *  with a NUL byte in the first 8 KiB are skipped (the scanner's limits). Never writes. */
  read(cwd: string, names: readonly string[]): Promise<readonly RepoInstructionFile[]>;
}

// ports/checkpoints.ts — kept narrow (the GitProbe precedent: no worktree powers leak)
export interface CheckpointRef { readonly sha: string; readonly changed: boolean }
export interface CheckpointDiff { readonly files: readonly string[]; readonly patch: string }
export type CheckpointError = 'git_failed';
export interface CheckpointCommitter {
  /** `git add -A` + commit in the worktree. A clean tree → { changed: false }, no commit. Commits
   *  are local-only (push stays with the forge flow); author/committer is the Docket checkpoint
   *  identity, never a user. */
  commit(input: { readonly cwd: string; readonly runId: RunId; readonly seq: number }): Promise<Result<CheckpointRef, CheckpointError>>;
  /** The diff since `since`. The patch is redacted through the secret patterns (the scanner's
   *  `redactSecrets`) at this boundary — application and domain never see unredacted patch text. */
  diffSince(input: { readonly cwd: string; readonly since: string }): Promise<Result<CheckpointDiff, CheckpointError>>;
  /** The commit the work order's worktree started from (refs/docket/bases/<id>). */
  base(input: { readonly cwd: string; readonly workOrderId: WorkOrderId }): Promise<Result<string, CheckpointError>>;
}

// capability-catalog.ts — CapabilityCatalog gains
/** The instruction-file names one provider reads natively, registry order (P-37). */
nativeInstructionFiles(providerId: string): readonly string[];
/** The union of known instruction-file names across providers — the candidate list to look for. */
instructionFileNames(): readonly string[];

// run-repo.ts — RunRepo gains
saveHandoffNote(id: RunId, note: RollingNote): Promise<void>;
handoffNote(id: RunId): Promise<RollingNote | undefined>;
/** The first checkpoint sha of the run's stage attempt; set by the executor (A-59). */
saveStageBase(id: RunId, sha: string): Promise<void>;
stageBase(id: RunId): Promise<string | undefined>;

// event-log.ts — AuditAction gains
| 'run.handoff'

// deps.ts — AppDeps gains two members (fakes follow A-1 … A-3)
readonly instructionFiles: InstructionFiles;
readonly checkpoints: CheckpointCommitter;
```

Two more type changes ride the same contract: `CatalogModel` (the `ModelCatalog` port's entry)
gains `readonly contextWindow: number | null` (`null` — no window is known for the model), so pack
sizing reads what the P-29 merge already carries per model instead of a second registry lookup.
`null` is the common case, not an exception: most providers report no window through any channel
today and no registry row carries a value, so the handoff is specified to work with the data
absent (A-63).

---

## 2. Use cases — `src/application/use-cases/`

All inputs carry `actor: Actor` when they change state.

```ts
// work-orders.ts
export type OpenError = 'definitions_invalid' | 'unknown_project' | 'unknown_repo' | 'unknown_flow' | 'flow_not_enabled' | 'unknown_task' | 'empty_title';
export function openWorkOrder(
  deps: Pick<AppDeps, 'clock' | 'ids' | 'log' | 'workOrders' | 'definitions' | 'projects'>,
  input: { readonly project: ProjectSlug; readonly repo: RepoSlug; readonly title: string; readonly flow?: FlowSlug; readonly task?: TaskSlug; readonly actor: Actor },
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
  deps: Pick<AppDeps, 'definitions' | 'bindings' | 'accounts' | 'projects'>,
  input: { readonly repo: RepoSlug; readonly workOrderId: WorkOrderId; readonly role: RoleSlug },
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
export function saveAccount(deps: Pick<AppDeps, 'clock' | 'ids' | 'log' | 'accounts' | 'secrets' | 'capabilities'>, input: { readonly record: AccountRecord; readonly secret?: string; readonly actor: Actor }): Promise<Result<void, 'secret_without_ref' | 'invalid_endpoint' | 'endpoint_mismatch' | 'identity_dir_not_allowed' | 'invalid_reserve'>>;
export function removeAccount(deps: Pick<AppDeps, 'clock' | 'ids' | 'log' | 'accounts' | 'secrets' | 'bindings'>, input: { readonly id: AccountId; readonly actor: Actor }): Promise<Result<void, 'not_found'>>;
export function saveBinding(deps: Pick<AppDeps, 'clock' | 'ids' | 'log' | 'bindings'>, input: { readonly scope: BindingScope; readonly binding: RoleBinding; readonly actor: Actor }): Promise<Result<void, 'empty_chain'>>;

// spend-consent.ts
type AccountCap = AccountRecord['caps'][number];
export function grantSpendConsent(deps: Pick<AppDeps, 'clock' | 'ids' | 'log' | 'accounts'>, input: { readonly accountId: AccountId; readonly model: string; readonly cap?: AccountCap; readonly actor: Actor }): Promise<Result<void, 'not_found' | 'invalid_model' | 'invalid_cap'>>;
export function revokeSpendConsent(deps: Pick<AppDeps, 'clock' | 'ids' | 'log' | 'accounts'>, input: { readonly accountId: AccountId; readonly model: string; readonly actor: Actor }): Promise<Result<void, 'not_found' | 'invalid_model'>>;

// projects.ts — the Project & Repo layer (Phase 3.5, S1/S3/S4)
export type AttachError = 'not_a_repo' | 'no_project_yaml' | 'definitions_invalid' | 'repo_not_in_project';
export function attachProject(
  deps: Pick<AppDeps, 'clock' | 'ids' | 'log' | 'projects' | 'repos' | 'definitions' | 'git'>,
  input: { readonly path: string; readonly actor: Actor; readonly repos?: readonly { readonly repo: RepoSlug; readonly path: string }[] },
): Promise<Result<ProjectDef, AttachError>>;

export type RepoRegistrationError = 'unknown_project' | 'repo_not_in_project' | 'repo_in_use';
export function registerRepo(
  deps: Pick<AppDeps, 'clock' | 'ids' | 'log' | 'projects' | 'repos' | 'workOrders'>,
  input: { readonly project: ProjectSlug; readonly repo: RepoSlug; readonly path: string; readonly actor: Actor },
): Promise<Result<void, RepoRegistrationError>>;
export function unregisterRepo(
  deps: Pick<AppDeps, 'clock' | 'ids' | 'log' | 'projects' | 'repos' | 'workOrders'>,
  input: { readonly project: ProjectSlug; readonly repo: RepoSlug; readonly actor: Actor },
): Promise<Result<void, RepoRegistrationError>>;

/** S4: one work order per target repo of a task; the task completes when all of them close (R-40). */
export type TaskOpenError = OpenError | 'unknown_task';
export function openTaskWorkOrders(
  deps: Pick<AppDeps, 'clock' | 'ids' | 'log' | 'workOrders' | 'definitions' | 'projects'>,
  input: { readonly project: ProjectSlug; readonly task: TaskSlug; readonly actor: Actor },
): Promise<Result<readonly WorkOrderId[], TaskOpenError>>;
```

Rules:
- **A-5** `openWorkOrder`: title is trimmed and must be non-empty; the project must exist and list `repo` in its `repos` (`unknown_project` / `unknown_repo`); `flow` defaults to `repo.defaultFlow`; the flow must exist and be listed in `repo.flows`; if `task` is given, the project's roadmap must contain it. On success: create the record, append one `created` event (`at = clock.now()`, `by = actor`), append audit `work_order.opened`.
- **A-6** `getWorkOrder` derives `state` with `deriveWorkOrderState` and `next` with `nextAction` from the **current** definitions; nothing derived is stored.
- **A-7** `blockWorkOrder`/`unblockWorkOrder`/`closeWorkOrder` append the matching event only when it changes something: closing a `done` work order → `already_done`; unblocking one that is not `blocked` → `not_blocked`. Each success appends one audit entry.
- **A-8** `decideHumanGate`: the gate must belong to the **current** stage and be in `pendingGates`; it must be `human` or `page_approval`; an `agent` actor → `agent_cannot_decide`. The verdict comes from the domain's `evaluateGate` with `approval`/`pageApproval` evidence, appended as one `gate_evaluated` event; audit `gate.decided` with `detail: { gate, decision }`.
- **A-9** `evaluateMachineGates`: only when status is `gating`. For each pending `command` and `secret_scan` gate of the current stage, in stage order: `command` → run every command of the set in order in the work order's worktree (timeout 10 min each) and pass all results as evidence; `secret_scan` → `SecretScanner.scan`. Append one `gate_evaluated` per evaluated gate, then return the re-derived state. `agent_verdict` gates are not touched here (see A-9a).
- **A-9a** `submitAgentVerdict`: the gate must be a pending `agent_verdict` gate of the current stage; the actor must be `kind: 'agent'` with `role` equal to the gate's `role` (`wrong_role` otherwise). `pointersResolved = pointers.length > 0 && EvidenceChecker.resolvePointers(worktree, pointers)`. The verdict comes from the domain `evaluateGate`; append one `gate_evaluated`; audit `gate.decided` with `detail: { gate, decision: approve ? 'approved' : 'rejected' }`.
- **A-10** `resolveRoute`: role = the definition with repo overrides applied (`applyRoleOverrides`); must exist and be active. Binding layers are read for `workOrder`, `repo`, `project` (via `projectOfRepo`) and `global`, and resolved with `resolveBinding`; the chain keeps only accounts that exist in `AccountRepo`, in order. Empty after filtering → `no_account`; no binding at any level → `no_binding`.
- **A-11** `createProposal`: reads the target's current file (hash `''` if absent); `after === before` → `no_change`; stores a `pending` proposal with `baseHash`; audit `proposal.created`.
- **A-12** `decideProposalUseCase`, in this order: (1) load the proposal (`not_found`); (2) read the target's current hash (`''` if absent); (3) on `approved` only: `DefinitionStore.validateCandidate(scope, target, after)` — issues → `invalid_after`, proposal stays `pending`; (4) domain `decideProposal(p, decision, actor, currentHash, now)` — `stale` → save the proposal with status `stale` and return `stale`; `not_pending`/`self_approval` → return as is; (5) on `approved`: `writeFile(scope, target, after, baseHash)` — `err('stale')` → save as `stale`, return `stale`; (6) save the decided proposal; audit `proposal.decided` with `detail: { decision }`. Rejection never touches files.
- **A-13** `saveAccount`: a `secret` requires `record.secretRef` (`secret_without_ref` otherwise) and is stored only through `SecretVault.put`; the secret never appears in the record, the audit entry, or any return value. `removeAccount` removes the vault entry too.
- **A-14** `saveBinding`: an empty account chain → `empty_chain`; audit `binding.saved` naming the role.
- **A-24** `attachProject`: `path` must be an existing git work tree per `git.isWorkTree` (`not_a_repo`, nothing written); `readProjectAt` yields the project — `no_project_yaml` when `<path>/.docket/project.yaml` is absent, `definitions_invalid` with the R-46 issues otherwise. On success: save the `ProjectDef`, register `mainRepo → path`, and register every entry of `repos` whose slug the project lists (a slug not listed → `repo_not_in_project`, nothing written). Audit `project.attached`.
- **A-25** `openTaskWorkOrders`: loads the project (`unknown_project`) and its roadmap (`unknown_task`); targets = `task.targets` or `[mainRepo]`; opens one work order per target with `title = task.title` and `task` set — all-or-nothing: every opening is validated first, and any error opens none. Each success follows A-5 (one `created` event, one audit entry).
- **A-26** `registerRepo` upserts the registry pointer after the project exists and lists the repo (`unknown_project` / `repo_not_in_project`). `unregisterRepo` fails `repo_in_use` while non-done work orders reference the repo, else removes the pointer — the project's `repos` list in `project.yaml` is untouched (membership is versioned truth, edited in the file or through a proposal). Audit `repo.registered` / `repo.unregistered`.

### Instructions, checkpoints, handoff — use cases (#581)

```ts
// use-cases/instructions.ts — the effective-instructions service (P-37)
export interface RunPrompt { readonly prompt: string; readonly plan: InstructionPlan }
export type PromptError = 'unknown_account' | 'definitions_invalid';
export function composeRunPrompt(
  deps: Pick<AppDeps, 'definitions' | 'accounts' | 'capabilities' | 'instructionFiles'>,
  input: { readonly repo: RepoSlug; readonly workOrderId: WorkOrderId; readonly cwd: string;
           readonly stage: StageSlug; readonly role: RoleSlug; readonly route: AccountRoute },
): Promise<Result<RunPrompt, PromptError>>;

// use-cases/checkpoints.ts — the checkpoint commit service (P-38 item 4)
export function commitCheckpoint(
  deps: Pick<AppDeps, 'checkpoints'>,
  input: { readonly cwd: string; readonly runId: RunId; readonly seq: number },
): Promise<Result<CheckpointRef, CheckpointError>>;

// use-cases/handoff.ts — the handoff pack builder (P-38)
export interface HandoffPlan { readonly pack: HandoffPack; readonly prompt: string }
export type HandoffError = 'not_found' | 'no_repo' | 'git_failed' | 'definitions_invalid' | 'unknown_account';
export function buildHandoff(
  deps: Pick<AppDeps, 'clock' | 'ids' | 'log' | 'definitions' | 'workOrders' | 'runs' | 'accounts'
                   | 'capabilities' | 'instructionFiles' | 'checkpoints' | 'modelCatalog'>,
  input: { readonly runId: RunId; readonly candidates: readonly AccountRoute[] },
): Promise<Result<HandoffPlan, HandoffError>>;
```

`composeRunPrompt` is the single prompt entry point: the composition root's start callback stops
building `prompt: role.instructions` itself and calls this instead. `buildHandoff` loads the failed
run and its events, the work order and definitions, the rolling note, the stage base (falling back
to the worktree base ref), the diff, and the candidates' context windows (`null` where none is
known); assembles the pack **for the target provider** (its native files), sizes it (fixed
ceilings first; a known window only tightens them — A-63), renders it, and appends audit
`run.handoff` with `detail: { fromRun: runId, candidates: candidates.length }`.

Rules:
- **A-53** `composeRunPrompt` builds every run's prompt: Docket layers first (`stageBrief`, then `role.instructions`), then the instruction block as project context. The Docket layers are byte-identical for every provider given the same definitions; only the instruction block varies.
- **A-54** Native instruction files come from the registry through `CapabilityCatalog.nativeInstructionFiles` for the route account's provider; a file the provider reads natively is never inlined. An unknown provider (no registry record) has no native set: every present candidate is inlined, so the "same rules on both providers" guarantee survives where the registry has never heard of the provider — inlining all beats a smaller prompt. The registry row is the provider's best-known set, not a fixed law of the CLI — some CLIs make the set configurable (a fallback-filename list can add `CLAUDE.md`, a context-file setting can rename it) — so a file the CLI reads natively but the row misses is inlined as well: the content reaching the agent twice is the safe failure, missing it is not.
- **A-55** Inlining stays within `DEFAULT_INSTRUCTION_BUDGET_CHARS`: candidates in registry order, whole while the budget allows, then truncated to the remainder with a marker naming the file and the kept chars; `plan.truncated` lists the dropped. Deterministic for the same inputs. Budgets are chars, not tokens — no provider's tokenizer is consulted; the constants (`DEFAULT_INSTRUCTION_BUDGET_CHARS`, `ROLLING_NOTE_MAX_CHARS`, `PACK_CHARS_PER_TOKEN`) are revisited only when a tokenizer actually matters in practice.
- **A-56** The instructions path never writes to the repo (the O-6 canonical-file proposal stays a normal diff in a work order). Instruction-file content is repo-author content below the Docket layers and never becomes a Docket instruction. The trust boundary is marked, not implied: everything the pack and the prompt quote — instruction files read from the repo, and any issue, page or upload content that later rides the same path — travels as **data** under a heading that says so, never as Docket's system instruction; content read from the repo or the web is untrusted input to Docket, and the pack says so where the agent reads it.
- **A-61** `deriveTaskState` is deterministic from stored events plus the checkpoint diff's file list; raw transcripts and session refs never enter the pack.
- **A-62** `buildHandoff` assembles P-38 items 1–6 in the `HandoffPack` field order, plus the `definitionsChanged` marker. The stage prompt is recomputed from the current definitions — it is never stored on the run; the run record carries `definitionsRev`, the revision marker of the definitions its stage prompt was computed from, and when the continuation sees a different revision the pack sets `definitionsChanged` and the prompt carries the note "definition changed since the first leg" (R-57) — the change is surfaced to the continuation, never silently absorbed; whether old and new definitions are equivalent stays outside the pack's guarantees. The patch is redacted at the port boundary before it enters the pack; the previous provider's `sessionRef` never enters it.
- **A-63** The pack's budget starts from the fixed ceilings (`DEFAULT_INSTRUCTION_BUDGET_CHARS` for the instruction block, `ROLLING_NOTE_MAX_CHARS` for the summary); a known window only tightens it — `min` over the candidate routes' known windows × `PACK_CHARS_PER_TOKEN` (`ModelCatalog` entries; `contextWindow` rides the P-29 merge on `CatalogModel`, `null` = no window known). A `null` window contributes no bound: the ceilings alone size the pack, with `DEFAULT_CONTEXT_WINDOW_TOKENS` as the stand-in for the unknown window — it sits above the ceilings, so the no-data path is the rule rather than the exception (ten of nineteen surveyed providers report no window through any channel and no registry row carries a value; the handoff works without the data, and filling windows per adapter is follow-up issues). Truncation priority is fixed (R-56): stage prompt and Docket layers never truncate.

---

## 3. Services — `src/application/services/`

```ts
// run-executor.ts — drives one run from start to finish
export interface ExecuteRunInput { readonly item: QueueItem; readonly role: RoleDef; readonly prompt: string; readonly cwd: string; readonly capabilities: readonly CapabilityDef[] }
export type ExecuteOutcome =
  | { readonly kind: 'finished'; readonly outcome: RunOutcome }
  | { readonly kind: 'transport_error'; readonly error: TransportError }
  | { readonly kind: 'limit'; readonly decision: LimitDecision }
  | { readonly kind: 'refused'; readonly error: 'needs_spend_consent' };
export interface PermissionGate { onAsk(runId: RunId, ask: Extract<AgentEvent, { readonly type: 'permission_ask' }>): Promise<'allow' | 'deny'> }
export function executeRun(
  deps: Pick<AppDeps, 'clock' | 'ids' | 'log' | 'workOrders' | 'runs' | 'accounts' | 'transports' | 'modelCatalog' | 'capabilities'>,
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
  deps: Pick<AppDeps, 'clock' | 'ids' | 'queue' | 'workOrders' | 'definitions' | 'bindings' | 'accounts' | 'projects'>,
  input: { readonly id: WorkOrderId; readonly priority?: number },
): Promise<Result<QueueItemId, 'not_found' | 'not_ready' | RouteError | 'definitions_invalid'>>;
```

A run whose model billing is not `included` is refused with `needs_spend_consent` unless the model
is in the account's `consentedModels` and the account has at least one spend cap; an unpinned model
takes the route kind's default billing, else `included` for a subscription account and `metered`
for every other auth mode. Billing comes from the `ModelCatalog` port. The refusal happens before
any write, so a refused run leaves every store unchanged.

Rules:
- **A-15** `executeRun`: creates the `RunRecord` (`autoResumesUsed` from a previous run of the same stage+attempt if resuming, else 0), appends `run_started` to the work order and audit `run.started`, then starts the transport for `route.accountId`. A missing transport or a start error → `transport_error`, the run record gets `endedAt` and outcome `failed`, and `run_finished: failed` is appended.
- **A-16** While streaming, every event is persisted with `RunRepo.appendEvents` in arrival order (batched is fine, order is not negotiable). `session_started` sets `sessionRef`. `permission_ask` is passed to `PermissionGate.onAsk` and the answer to `answerPermission`. `quota_signal` → `AccountRepo.saveMeter` (a new `MeterId` from `IdGen` unless a meter with the same pool label and duration exists). `usage` with a cost → `recordSpend`.
- **A-17** On `limit_hit`: build a `LimitHit` for the run's account, ask the domain `decideOnLimit` with the account's policy and `autoResumesUsed`, end the run with outcome `limit`, append `run_finished: limit`, and return `{ kind: 'limit', decision }`. Scheduling the resume is the caller's job.
- **A-17a** `applyLimitDecision`: `schedule_resume` → put a queue item for the run's work order and stage with the same route, `notBefore = decision.at`, and increment the run's `autoResumesUsed` on the record; `switch_pool` → a queue item routed to the same account (pool choice is re-evaluated at dispatch); `fallback` → a queue item with `route = decision.route`; `ask` → no queue item (the work order stays `limit_waiting` and shows in the cockpit).
- **A-18** On `finished`: set `endedAt`/`outcome` (mapping as in `foldRun`), append `run_finished`, audit `run.finished` with `detail: { outcome }`.
- **A-19** `enqueueStage`: only when `nextAction` is `start_run`; the route is the first account of `resolveRoute`'s chain; one queue item per work order (an existing item for the same work order is replaced). The queue item carries `stageRouting(stage, binding)`'s `tier` and `thinking` (each absent when neither sets it). For a stage with `reviewOf`, the chain is ordered with `orderForReview`, where `reviewedProvider` is the provider of the account of the last `succeeded` run of the `reviewOf` stage in this work order (undefined when there is none); the route is the first entry of the ordered chain, and `sameProviderReview` is set when the result says so.
- **A-20** `dispatcherTick`: builds the `DispatchSnapshot` — `running` from `RunRepo.listActive` joined with `WorkOrderRepo` for the repo and project, `headroom` per item from `headroom(pools, meters, accountId, matchId, now, account.reserve)`, where `matchId` is the account catalog entry's `resolvedId` for the item's model when the catalog knows one (an alias such as `opus` checks as the id it stands for), else the model, else `''`, `spend` per item from `combinedSpendStatus` over the account's own caps (`account_day` = UTC day of `now`, `account_week` = the UTC ISO week of `now`, Monday 00:00 to the next Monday, `account_month` = UTC calendar month of `now`), the repo cap (`repo_month`) and the project ceiling (`project_month`, observed spend summed over all repos of the project — R-48; work-order caps arrive in Phase 5) — calls `decideDispatch`, removes started items from the queue, calls `start` for each started item, and returns the decisions unchanged.

### Checkpoints, rolling note, handoff wiring (#581)

`ExecuteOutcome`'s `refused` error union gains `'handoff_failed'` (A-64). Rules:

- **A-57** The executor commits a checkpoint at each `tool_result` boundary when `CHECKPOINT_MIN_INTERVAL_MS` has elapsed since the last commit, and always at `limit_hit`, `finished` and stream end. A clean tree is a no-op (`changed: false`), never an error. Commits are local-only and authored by the Docket checkpoint identity, never a user; they never travel to the forge. The cadence is event-boundary + terminal only — no background timer exists; the executor's stream is the only clock application may read. (`AgentEvent.tool_result` carries only `{ id, ok }`, so "each tool-result boundary that changed files" is implemented as commit-at-each-boundary with git as the arbiter.)
- **A-58** Checkpoint commits touch only the work order's worktree (I-20's guarantee unchanged); the user's checkout, its branch and its index are never modified.
- **A-59** The first commit of a stage attempt records its sha via `RunRepo.saveStageBase`. The pack's code state is `diffSince(stageBase)`; with no checkpoint (a clean stage) it is `diffSince(worktree base ref)`.
- **A-60** The rolling note is extended with every persisted event batch (`extendRollingNote`) and saved through `RunRepo.saveHandoffNote` on the same cadence — so it exists the moment the account blocks. It is the tail of the text/thinking stream, capped at `ROLLING_NOTE_MAX_CHARS` with `capped: true`; no other content is derived into it (the model-written summary stays optional and unanswered, open decision O-8).
- **A-64** A run started for a queue item with `handoffOf` builds the pack before the transport starts, sends `renderHandoffPrompt`'s prompt (checks-first preamble per R-57), and never passes a `resume` reference — native resume and the pack are never mixed (P-38). A pack failure refuses the run (`refused: 'handoff_failed'`) with only the audit entry written. The `run.started` audit detail carries `handoff: true` and `handoffOf`.
- **A-65** `applyLimitDecision` with a `fallback` route sets `handoffOf = runId` on the queue item whenever the target **account** differs from the failed run's account — including a second account of the same provider, because whether one CLI login sees another's sessions is not knowable, so the pack is the one continuation mechanism. The evidence sides with the default: the one provider whose documentation covers the question pairs its session history with the login's own identity directory — a different account is a different directory, so native resume cannot see the earlier history (a documented negative) — while the other eighteen providers carry no evidence either way, so the pack rule stands and remains open to a revisit with evidence from an operator run. The billing boundary is unchanged: candidate eligibility still comes from `decideOnLimit`'s `FallbackCandidate` (P-40 — an automatic switch never crosses to `metered`/`unknown`), and the continuation itself passes the same spend preflight as any run (P-46). Autonomy and approvals travel as policy: the continuation run wires the same `PermissionGate` as any run.

---

## 4. API contracts — `src/api/`

Plain JSON-serialisable types only (no functions, no class instances, no `undefined`-only fields).
Phase 2a defines the contracts and a transport-free `createApi(deps)` that maps each command/query
to use cases; Phase 4 binds it to Electron IPC.

```ts
// commands.ts
export type Command =
  | { readonly type: 'workOrder.open'; readonly project: string; readonly repo: string; readonly title: string; readonly flow?: string; readonly task?: string }
  | { readonly type: 'task.open'; readonly project: string; readonly task: string }
  | { readonly type: 'project.attach'; readonly path: string; readonly repos?: readonly { readonly repo: string; readonly path: string }[] }
  | { readonly type: 'repo.register'; readonly project: string; readonly repo: string; readonly path: string }
  | { readonly type: 'repo.unregister'; readonly project: string; readonly repo: string }
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
  | { readonly type: 'project.tree' }
  | { readonly type: 'roadmap.byProject'; readonly project: string }
  | { readonly type: 'repo.board'; readonly repo: string }
  | { readonly type: 'cockpit'; readonly project?: string }
  | { readonly type: 'account.detail'; readonly id: string }
  | { readonly type: 'project.spend'; readonly project: string };
export interface AttentionItem { readonly workOrderId: string; readonly project: string; readonly repo: string; readonly title: string; readonly kind: 'awaiting_human' | 'permission_ask' | 'limit_waiting' | 'blocked'; readonly stage: string | null; readonly since: number }
export interface CockpitView {
  readonly attention: readonly AttentionItem[];
  // The optional fields below (A-35 … A-37, A-40) are optional in the type only so consumers
  // written before they existed keep compiling; the cockpit query itself always fills them.
  readonly running: readonly {
    readonly workOrderId: string;
    readonly stage: string;
    readonly accountId: string;
    readonly provider?: string;
    readonly startedAt: number;
    readonly title?: string;
    readonly stageIndex?: number;
    readonly stageCount?: number;
    readonly queued?: boolean;
    readonly queuedReason?: 'limit' | 'queue';
    readonly limitResetsAt?: number | null;
  }[];
  /** K-4:B — cockpit cards; one per attached project, always the full list (A-28). */
  readonly projects: readonly { readonly project: string; readonly name: string; readonly mainRepo: string; readonly repoCount: number; readonly active: number; readonly waiting: number; readonly lastActivityAt?: number | null }[];
  readonly recentlyClosed: readonly { readonly workOrderId: string; readonly title: string; readonly project: string; readonly repo: string; readonly closedAt: number; readonly outcome?: 'merged' | 'cancelled' }[];   // closedAt desc, max 5
}
export interface RepoNode { readonly repo: string; readonly name: string; readonly main: boolean; readonly active: number; readonly running: number; readonly waiting: number; readonly status: 'running' | 'waiting' | 'idle' }
export interface ProjectTreeItem { readonly project: string; readonly name: string; readonly mainRepo: string; readonly repos: readonly RepoNode[]; readonly active: number; readonly running: number; readonly waiting: number; readonly status: 'running' | 'waiting' | 'idle' }
export type ProjectTree = readonly ProjectTreeItem[];
export interface RoadmapPageView {
  readonly phases: readonly { readonly id: string; readonly name: string; readonly status: string; readonly tasks: readonly { readonly id: string; readonly title: string; readonly status: string; readonly targets: readonly string[]; readonly workOrders: readonly { readonly repo: string; readonly id: string; readonly number: number; readonly title: string; readonly status: string }[] }[] }[];
  readonly runnable: readonly string[];
}
export interface AccountDetailView {
  readonly account: { readonly id: string; readonly provider: string; readonly label: string; readonly authMode: string; readonly plan?: string; readonly limitPolicy: string };
  readonly windows: readonly { readonly label?: string; readonly unit: string; readonly used?: number; readonly limit?: number; readonly remaining?: number; readonly resetsAt?: number; readonly resetPrecision: string; readonly source: string }[];
  readonly activeWork: readonly { readonly workOrderId: string; readonly title: string; readonly stage: string | null; readonly status: string }[];   // non-done work orders with a run on this account, oldest active first
}
export interface ProjectSpendView { readonly totalUsd: number; readonly perRepo: readonly { readonly repo: string; readonly usd: number }[]; readonly cap?: { readonly amountUsd: number; readonly warnPercent: number } }
export interface BoardColumn {
  readonly stage: string;
  readonly name: string;
  // account (A-30): the run's account label, null when there never was one; since (A-31): the
  // ISO-8601 UTC instant of the last status change. The done entries below carry neither.
  readonly workOrders: readonly { readonly id: string; readonly number: number; readonly title: string; readonly status: string; readonly account: string | null; readonly since: string }[];
}
export interface BoardView { readonly repo: string; readonly flow: string; readonly columns: readonly BoardColumn[]; readonly done: readonly { readonly id: string; readonly number: number; readonly title: string }[] }

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
- **A-23** `repo.board` has one column per stage of the repo's default flow, in flow order; each work order sits in the column of its current stage; `done` work orders go to `done`.
- **A-27** `project.tree`: one item per attached project (id asc), repos in `project.repos` order. Per repo: `active` = non-done work orders, `waiting` = attention items of kinds `permission_ask` / `awaiting_human` / `blocked`, `running` = runs without `endedAt`; status precedence `waiting > running > idle`; the project aggregates its repos' counts and takes its status the same way. One call serves the whole sidebar (K-7).
- **A-28** `cockpit`: the `project` filter narrows `attention`, `running` and `recentlyClosed` to that project; `projects` always lists every project (K-4:B). `recentlyClosed` = the five most recent `done` work orders, `closedAt` desc. `account.detail` returns the account with its windows (from pools/meters) and `activeWork` = non-done work orders with a run on the account.
- **A-29** Work-order display number: `WorkOrderRepo.number(id)` is the 1-based position of the work order in (`createdAt` asc, `id` asc) order over every work order on this machine. Work orders are never deleted, so a number, once shown, never changes and is never reused; a converted old database numbers its work orders the same way. The ULID stays the identity; the number is display only (machine-local; team sync revisits it). Every query view item that names a work order (`workOrderId` or `id` of a work order) also carries `number: number` — attention, running and recentlyClosed items, board cards and done strip, the detail, `account.detail.activeWork`, and the per-repo work orders of a roadmap task.
- **A-30** Each card in `BoardColumn.workOrders[]` carries `account`: the display label of the account bound to the work order's current or most recent run — the newest run by `startedAt`, active or finished; `null` when the work order never had a run, or the run's account no longer loads. The `done` entries carry neither `account` nor `since`.
- **A-31** Each card in `BoardColumn.workOrders[]` carries `since`: the ISO-8601 UTC instant (`YYYY-MM-DDTHH:MM:SS.sssZ`) the work order entered its current status — the `at` of the last event that changed the derived status, the work order's `createdAt` while no event has. Stored event timestamps only, never a clock read.
- **A-35** Each `cockpit.running[]` row carries `title` (the work order's title) and the stage position for the progress strip: `stageIndex` is the 1-based position of the row's stage in the work order's flow and `stageCount` the flow's stage count. When the stage is no longer in the flow — or the flow no longer loads — both are `0` and the UI hides the strip. A queued row positions its queue item's stage the same way.
- **A-36** Queued work stays in `running` (U-21): the queue's items ride the same list after the actually-running rows, which keep today's order; queued rows follow ordered by `enqueuedAt` asc, then id asc. A queued row carries the queue item's `stage` and route `accountId`, and its `startedAt` is the instant it was queued (`enqueuedAt`), never a run start. The A-28 project filter narrows queued rows together with the rest.
- **A-37** A queued row carries `queued: true` and a `queuedReason`: `'limit'` when the route's headroom is currently blocked — the same domain call the dispatcher's tick makes, evaluated at query time — with `limitResetsAt` the blocking meters' earliest `resetsAt` (`null` when no relief instant is known); every other wait (concurrency limits, a scheduled `notBefore`, a busy work order) reads `'queue'` with `limitResetsAt: null`. Running rows carry `queued: false` and `limitResetsAt: null` and no `queuedReason`.
- **A-38** Each `cockpit.projects[]` card carries `lastActivityAt`: the stamp of the latest status change among the project's work orders, on A-31's `since` basis (a work order whose flow no longer loads contributes its creation time); `null` when the project has no work orders.
- **A-39** Each `cockpit.recentlyClosed[]` entry carries `outcome`: `'merged'` when the work order finished its flow — past the last stage's gates — and `'cancelled'` when a `closed` event ended it. The domain has no finer terminal status, and a `closed` event appended after a flow completion still reads `'cancelled'`: the closing act is the operator's terminal word even where the fold ignores it (R-23).
- **A-40** Each `cockpit.running[]` row carries `provider`: the def id of the row's route account — the account record's `provider` field, resolved once per account (the board's A-30 label-cache stance), for running and queued rows alike. `''` when the account record no longer loads: the row resolves no mark and the UI's neutral glyph covers it. The account views that already carried `provider` keep theirs (`settings.accounts` rows, `AccountDetailView.account`). Optional in the type only so consumers written before it keep compiling (A-35's stance); the cockpit query itself always fills it.

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

- **E-11** `approveAndDeploy`: gate must be a pending `deploy` gate of the current stage; `approver.kind` must be `'user'` (`no_approval`). For `protected` environments, `input.confirmedEnvironment` must equal the gate's environment (`confirmation_mismatch`). The environment must exist in the repo definition (`unknown_environment`); the worktree comes from `Worktrees.ensure` (`no_repo`). When `promoteFrom` is set, a `deployment_attempted` with `result: 'success'` for the same `commit` on the prerequisite environment must exist in the event history (`promote_prerequisite_missing`).
- **E-12** Deploy execution: run `deploy` commandSet in the work order's worktree with the environment's `env` values passed as `CommandRunner.run`'s `env` argument (literal + `SecretVault`-resolved `secretRef`; an unresolvable ref → `result: 'failed'` without running). If deploy exits 0 and `verify` exists, run `verify` the same way. Both exit 0 → `result: 'success'`; otherwise → `result: 'failed'`.
- **E-13** After deploy execution, append one `deployment_attempted` event and one `gate_evaluated` event (using E-6). Environment values and secrets never appear in the event or the output tail. The event's output tail comes from the first failing command; when every command (including `verify`) succeeded, from the last one.
- **E-14** `pollRemoteChecks`: gate must be a pending `remote_checks` gate of the current stage. Resolve the forge via `ForgeResolver.forRepo`; if unavailable → `forge_unavailable`. Call `forge.checks(repo, branchRef)`.
- **E-15** Match returned checks against `required`: if `required === 'all'`, use all returned checks; otherwise filter to those whose `name` is in the `required` array. A `required` name the forge did not return counts as not-passed (the gate stays pending; it never passes vacuously). Determine status: all `passed` → `all_passed`; any `failed`/`cancelled` → `has_failure`; otherwise → `pending`.
- **E-16** If elapsed time since the gate entered `pending` exceeds `timeoutMinutes` → `timeout`.
- **E-17** Append one `gate_evaluated` event with the `remoteChecks` evidence. `pending` → do not append (gate stays pending, re-polled by the dispatcher later).
- **E-18** `evaluateMachineGates` (updated A-9): after processing existing `command`/`secret_scan` gates, also process pending `remote_checks` gates by calling `pollRemoteChecks` — only when the input carries `remote: { readonly forges: ForgeResolver; readonly repo: RepoRef; readonly branchRef: string }` (a new optional field of `evaluateMachineGates`' input); without it they are left pending. Every `GateContext` built by a use case includes `environments` from the repo definition. `deploy` gates are **not** evaluated by `evaluateMachineGates` — they require explicit human approval via `approveAndDeploy`.
- **E-19** The Phase 2c headless acceptance scenario extends the standard flow with an environment stage: `deploy-stg` → `deploy-prd` (protected, `promoteFrom: stg`), with the fake forge returning all-green checks for a `remote_checks` gate.

### App update — query, intents, event

The app bar's update story — the contract and plumbing only; the Update button itself is later UI
work. One query, two intents and one event over the
[Update checker port](#update-checker-port-portsupdate-checkerts); the checker is composed beside
`AppDeps` and passed to `createApi` as its fifth argument (`updates?: UpdateChecker`), the
board/discovery/registry pattern.

```ts
// use-cases/app-update.ts — the port is the whole state, so the use cases take it directly
export function getUpdateState(updates: UpdateChecker): Promise<UpdateState>;
export function checkForUpdates(updates: UpdateChecker): Promise<UpdateState>;
export function applyUpdate(updates: UpdateChecker): Promise<Result<void, 'not_available'>>;

// commands (commands.ts)
| { type: 'app.update.check' }
| { type: 'app.update.apply' }
// queries (queries.ts)
| { type: 'app.update' }               → UpdateState
// UiEvent (api.ts)
| { type: 'update.changed' }
```

Rules:
- **A-32** `app.update` answers the composed checker's `state()` verbatim — no derivation, no
  stored copy. With no checker composed the query answers `{ ok: false, code: 'not_found' }` (the
  registry-less `repos.list` precedent): absence is never invented into "you are current".
- **A-33** `app.update.check` maps onto `checkForUpdates`: the checker re-checks, the command
  answers `{ ok: true }`, and the api emits one `update.changed` after it — `CommandResult` carries
  no payload, so the new state travels out-of-band, through the event and the re-query it triggers
  (the `workOrders.changed` pattern). No audit entry: the update state is machine-local and no
  `AuditAction` names it.
- **A-34** `app.update.apply` maps onto `applyUpdate`: the guard reads the state and allows the
  call only from `available` or `ready` — every other state answers `not_available`, emits nothing
  and leaves the state untouched. An allowed apply starts the download (the state's next read shows
  it), answers `{ ok: true }` and emits one `update.changed`.

### Provider marks — query

The UI's provider marks are static def data, so they travel through one query instead of riding
every view: each account view carries only the account's `provider` def id (A-40 above), and the
mark itself is looked up once. The source is the [ProviderMarks
port](#provider-marks-p-25) defined in [providers.md](providers.md) → "Provider marks", passed to
`createApi` as its sixth argument (`marks?: ProviderMarks`), the board/discovery/registry/updates
pattern.

```ts
// queries (queries.ts)
| { type: 'providers.marks' }          → Record<string, ProviderMark | null>
```

Rules:
- **A-41** `providers.marks` answers the composed marks source verbatim — def id →
  `{ viewBox, path, fillRule }`, `null` when the provider has none. No derivation, no stored
  copy. With no source composed the query answers `{ ok: false, code: 'not_found' }` (the
  registry-less `repos.list` precedent): absence is never invented into an empty record.
- **A-42** A mark travels with its fill rule: the query answers a source mark's `fillRule`
  byte-identical and never assumes `nonzero` — the same `d` renders differently under the two
  rules, so the rule is the mark's data, not the renderer's guess.
- **A-43** `saveAccount` validates the route fields (see [provider-capabilities.md](provider-capabilities.md), P-31, P-32): an `endpoint` that is not an `https` URL → `invalid_endpoint`; an `endpoint` whose host differs from the host fixed by the account's route kind (looked up through the same port) → `endpoint_mismatch`; an `identityDir` that is not an absolute path, or is set on an account whose `authMode` is not `subscription` → `identity_dir_not_allowed`. None of these fields is a secret; the token stays behind `secretRef` (A-13).
- **A-44** Records saved before these fields existed read back unchanged: accounts are stored as JSON, so there is no migration. An absent `routeKind` resolves to `anthropic-subscription` for a `claude-code` account with `authMode: 'subscription'` and to `anthropic-api` for `authMode: 'api_key'`. The mapping lives behind the `CapabilityCatalog` application port, implemented in `src/infrastructure/providers/registry/`.
- **A-45** `saveAccount`: every present `reserve` value is a finite number in `0..RESERVE_MAX`; otherwise `invalid_reserve`, and nothing is written.
- **A-46** `executeRun` resolves `RunRequest.effort` with `effortForChoice(item.thinking, thinking)`, where `thinking` is the catalog entry's for the route's model, or, for an unpinned route, the entry the route's default resolves to (`isDefault`, P-42); no entry → `unknown` → no effort is sent. The resolved effort is recorded as `detail: { effort }` on the run's `run.started` audit entry (omitted when no effort resolves), so the record shows what was asked.
- **A-47** `executeRun`, before A-46: when the route has no `model` and the queue item has a `tier`, the model is `resolveTier(tier, catalog, account.tierModels ?? routeKind.tierModels)` over the account's `ModelCatalog` entries; the chosen id becomes the run's model for the spend-consent check, the effort (A-46) and the transport. `undefined` (no auto-selectable model of that tier: P-40 allows only `included`) leaves the route unpinned. The resolved model and its tier are recorded as `detail: { model, tier }` on the `run.started` audit entry, next to the effort.

### Settings surface — account settings, roles, caps

What the Settings window and the setup wizard ([ui.md](ui.md) → "Settings and setup", U-27 …
U-37) read and write. Every field below already lives in `AccountRecord` or `RoleBinding`; these
additions only expose them and give the two missing write paths (limit policy, spend caps).
Nothing here reads or returns a secret value.

```ts
// queries.ts — SettingsMeterView gains
readonly reserveClass: 'short' | 'long' | 'larger'; // reserveClassOf (R-49)
readonly reserveShare: number;                    // reserveFor with the account's reserve; 0 = none
// queries.ts — SettingsAccountView gains
readonly limitPolicy: 'wait_resume' | 'switch_pool' | 'fallback_account' | 'ask';
readonly reserve: { readonly short: number | null; readonly long: number | null };
readonly caps: readonly { readonly scope: 'account_day' | 'account_week' | 'account_month'; readonly amountUsd: number; readonly warnPercent: number }[];
readonly consentedModels: readonly string[];      // '*' = the route's default model (P-40)
readonly routeKind: string | null;
readonly identityDir: string | null;              // the stored path verbatim
readonly endpointHost: string | null;             // host of `endpoint`, never the URL's path or query
readonly hasSecret: boolean;                      // `secretRef` present; never the value
// queries.ts — SettingsBindingView gains
readonly thinking: { readonly level: 'fast' | 'balanced' | 'deep' } | { readonly effort: string } | null;
readonly tier: 'strong' | 'balanced' | 'fast' | null;

// queries.ts
| { type: 'roles.list' }               → RoleListItem[]
export interface RoleListItem {
  readonly id: string;
  readonly name: string;
  readonly stages: readonly {
    readonly flow: string; readonly flowName: string;
    readonly stage: string; readonly stageName: string;
    readonly tier: 'strong' | 'balanced' | 'fast' | null;
    readonly thinking: { readonly level: string } | { readonly effort: string } | null;
    readonly reviewOf: string | null;
    readonly sameProviderReview: boolean;
  }[];
}

// commands.ts — account.save gains `limitPolicy?: string`
| { type: 'account.cap.save'; id: string; scope: string; amountUsd: number; warnPercent: number }
| { type: 'account.cap.remove'; id: string; scope: string }
// providers.discovered rows gain `name: string; installUrl: string | null`;
// accounts.candidates rows gain `provider: string | null` (A-67)
```

Rules:
- **A-48** `settings.accounts` fills the new account fields from the stored record: `reserve`
  values are the record's or `null`; `caps` in `account_day`, `account_week`, `account_month`
  order; `consentedModels` verbatim; `endpointHost` is the host of `endpoint` (`null` without one);
  `hasSecret` is `secretRef !== undefined`. No field carries a secret value or an environment
  value. Each meter's `reserveClass` is `reserveClassOf(meter)` and its `reserveShare` is
  `reserveFor(meter, reserve)` — the same domain calls the headroom check makes — so the surface
  never re-derives the rule.
- **A-49** `settings.accounts` bindings carry the stored `thinking` and `tier` (`null` when the
  binding has none). `binding.save` replaces the whole binding at its scope — a field the command
  leaves out is cleared, never kept — so a surface that changes one field sends the binding's
  other fields with it.
- **A-50** `roles.list` lists every role of the built-in library and of every registered repo's
  definitions that load (a repo whose definitions fail is skipped, never a query failure): role id
  ascending; a role seen in several sources takes its name from the first source in the order
  library, then repos by id. `stages` lists every stage of those flows whose `role` is the role,
  deduplicated by `(flow, stage)` (first source wins), with the stage's own `tier`, `thinking` and
  `reviewOf`. `sameProviderReview` is computed only for a stage with `reviewOf`: the reviewed
  provider is the provider of the first account of the global binding of the reviewed stage's role,
  and the flag is `orderForReview(chain, reviewedProvider).sameProvider` over the review role's
  global chain (R-52); `false` when either role has no global binding.
- **A-51** `account.save` accepts `limitPolicy`: absent keeps the stored policy (the `reserve`
  stance); a value outside the `LimitPolicy` set is rejected at the edge like an unknown
  `authMode` and writes nothing.
- **A-52** `account.cap.save` upserts the account's cap of that scope (a scope outside the
  `account_*` set is rejected at the edge; an amount that is not a positive finite number or a warn
  percent outside `1..100` → `invalid_cap`); `account.cap.remove` deletes it. Removing the last cap
  while `consentedModels` is non-empty → `cap_required` (P-40: consent without a cap refuses
  every run). Unknown account → `not_found`. Both audit as `account.saved`.
- **A-67** Discovery rows name their provider from the def's own data: each `providers.discovered`
  row gains `name` (the def's display name) and `installUrl` (the def's `installHint.url`, `null`
  when the def has none), and each `accounts.candidates` row gains `provider` — the def id its
  route kind belongs to (`CapabilityCatalog.routeKind(id).providerId`, the same lookup adoption
  makes; `null` when the route kind is unknown). No login or install command is invented: the defs
  carry none.

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
  readonly pool: { readonly label: string; readonly kind: PoolKind; readonly appliesTo: readonly ModelMatcher[] | 'all' | 'unknown' };
  readonly meter: Omit<Meter, 'id' | 'poolId'>;
}
export interface QuotaProbe {
  poll(defId: string, binPath: string | null): Promise<Result<readonly MeterReading[], QuotaProbeError>>;
}
export interface QuotaProbeResolver { forProvider(defId: string): QuotaProbe | undefined }

// use-cases/quota-poll.ts
export function pollQuota(
  deps: Pick<AppDeps, 'clock' | 'ids' | 'log' | 'accounts' | 'capabilities'>,
  probes: QuotaProbeResolver,
  input: { readonly accountId: AccountId },
): Promise<Result<readonly Meter[], QuotaProbeError>>;
```

The resume-fallback behaviour (**P-22**, providers.md) changes no signature: it lives inside the run
executor's existing start path.

---

## 7. Limit handoff — acceptance (#581)

`src/api/scenarios/handoff-three-legs.test.ts` (test-only folder in the API layer, the §5/P-24
style): it must pass with fakes before any provider wiring is believed (**A-66**).

Fixtures: repo with `CLAUDE.md`; provider X (account A) reads `CLAUDE.md` natively; provider Y
(account B) reads `AGENTS.md` natively **and does not read `CLAUDE.md`** — Y is drawn from the
AGENTS.md-only providers (several CLIs read both files, and a both-files B would make leg 2's
inline assertion vacuous); the test asserts Y's registry native set lists no `CLAUDE.md`, so the
choice is checked, not assumed. Role chain for `developer`: [A, B]. Policy: `fallback_account`.
Flow: `standard`.

1. **Leg 1 — A hits the limit mid-stage.** Work order reaches `implement`; enqueue + tick starts
   the run on A. Fake transport script: `session_started`, `text`, `tool_call` (Edit) +
   `tool_result`, `usage`, `limit_hit` (`window_exhausted`, `resetsAt` far future), `finished`
   (reason `limit`). Assert: run outcome `limit`; ≥ 1 checkpoint commit exists and `stageBase` is
   recorded; the rolling note is saved; `applyLimitDecision` produced a queue item with
   `route = B` and `handoffOf = run₁`; work order state `limit_waiting`.
2. **Leg 2 — B continues from the pack.** Tick starts the item; `executeRun` builds the pack.
   Assert on the captured `RunRequest.prompt`: the checks-first preamble leads; the stage brief and
   acceptance criteria are present; `CLAUDE.md`'s content is inlined (B does not read it natively)
   while `AGENTS.md` is not (absent anyway); the inlined block sits under its quoted-data heading
   (A-56); `taskState.lastCommand` names leg 1's tool pair; the
   patch names the edited file and contains no unredacted secret (fixture plants a token-shaped
   string in the diff); **no `resume` field is set**. Script B: `text`, `tool_call` +
   `tool_result`, `usage`, `finished` (completed). Machine gates: tests exit 0, scan 0 findings →
   `review/ready`.
3. **Leg 3 — back to A at review.** `orderForReview` (R-52) puts A first for the review stage (B
   wrote the stage). Assert the review run's prompt inlines **nothing** (A reads `CLAUDE.md`
   natively) and carries the same Docket layers byte-for-byte as leg 2's prompt prefix. Script A:
   completed. `submitAgentVerdict` approve → `close/awaiting_human`; audit trail ends with the
   expected actions in order, including one `run.handoff`.

Companion infrastructure test: the real `CheckpointCommitter` over `runGit` on a temp repo — commit
creates a sha, second commit with no changes returns `changed: false`, `diffSince` redacts, `base`
resolves the worktree base ref.

### Implementation issues

The contract splits into six implementation issues (each issue's Interfaces section is copied from
this document, CLAUDE.md rule 3; `docs/v2/**` edits stay with the architect):

| Issue | Content | Touches | Depends on | Test rules |
| --- | --- | --- | --- | --- |
| 1. domain core | `providers/instructions.ts` + `providers/handoff.ts` + domain barrel | `src/domain/providers/**`, `src/domain/index.ts` | — | R-53 … R-57 red → green, one test per rule |
| 2. ports & types | `InstructionFiles`, `CheckpointCommitter` ports + fakes; `CapabilityCatalog` extension; `RunRepo` note/stage-base + sqlite adapter; `QueueItem.handoffOf`; `CatalogModel.contextWindow`; `RunRecord.definitionsRev`; `AuditAction` | `src/application/ports/**`, `src/domain` (types only), `src/infrastructure/storage/sqlite/**` | 1 | A-1 … A-4 extended to the new ports; `ports.test.ts` |
| 3. effective instructions | `composeRunPrompt` + registry data (`instructionFiles` per provider) + composition-root wiring (start callback stops building the prompt itself) | `src/application/use-cases/**`, `src/infrastructure/providers/registry/**`, `electron/main.ts` | 1, 2 | A-53 … A-56 |
| 4. checkpoints | `commitCheckpoint` + infra `CheckpointCommitter` (runGit) + executor triggers + stage base | `src/application/use-cases/**`, `src/application/services/run-executor.ts`, `src/infrastructure/vcs/**` | 2 | A-57 … A-59 + the git-boundary infra test |
| 5. handoff wiring | `buildHandoff` + `executeRun`/`applyLimitDecision` changes + rolling note in the executor | `src/application/use-cases/**`, `src/application/services/**` | 1–4 | A-60 … A-65 + P-46 |
| 6. acceptance | the three-leg scenario + audit assertions | `src/api/scenarios/**` | 1–5 | A-66 |

Issues 3 and 4 both touch `run-executor.ts` — sequence them (3, then 4, then 5) so stacked merges
never conflict.

Provider context-window data (per adapter, optional) is deliberately outside the six issues: which
providers can actually fill `CatalogModel.contextWindow`, and from which channel, is follow-up
issue work per adapter; the contract is specified to work with `null` everywhere (A-63).
