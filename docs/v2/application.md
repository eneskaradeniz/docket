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
  | 'project.attached' | 'repo.registered' | 'repo.unregistered'
  | 'capability.imported';
export type AuditSubject =
  | { readonly kind: 'work_order'; readonly id: WorkOrderId }
  | { readonly kind: 'run'; readonly id: RunId }
  | { readonly kind: 'proposal'; readonly id: ProposalId }
  | { readonly kind: 'account'; readonly id: AccountId }
  | { readonly kind: 'binding'; readonly role: RoleSlug }
  | { readonly kind: 'project'; readonly id: ProjectSlug }
  | { readonly kind: 'repo'; readonly id: RepoSlug }
  | { readonly kind: 'capability'; readonly id: CapabilitySlug };
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
  readonly definitionsRev?: string;       // definitionsDigest of the Docket layers the agent was given (stageBrief, then role.instructions); executeRun writes it at record creation; drives A-62's changed-note
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
   *  identity `Docket <checkpoints@docket.local>` — passed as `git -c user.name -c user.email`, so
   *  it outranks repo and global config alike — never a user. */
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

/** Evaluates every pending machine gate of the current stage (changes, command, secret_scan, agent_verdict). */
export function evaluateMachineGates(
  deps: Pick<AppDeps, 'clock' | 'workOrders' | 'definitions' | 'commands' | 'secretScanner' | 'worktrees' | 'runs' | 'checkpoints'>,
  input: { readonly id: WorkOrderId },
): Promise<Result<WorkOrderState, 'not_found' | 'not_gating' | 'definitions_invalid' | 'no_repo' | 'git_failed'>>;

/** The human answer to a changes gate the machine measured at zero (A-96). */
export type AttestError = 'not_found' | 'not_current_stage' | 'not_pending' | 'not_a_changes_gate' | 'agent_cannot_decide';
export function attestNoChanges(
  deps: Pick<AppDeps, 'clock' | 'ids' | 'log' | 'workOrders' | 'definitions'>,
  input: { readonly id: WorkOrderId; readonly gate: GateSlug; readonly noChangeNeeded: boolean; readonly actor: Actor },
): Promise<Result<WorkOrderState, AttestError>>;

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
export type PromptError = 'unknown_account' | 'definitions_invalid' | 'not_found';
export function composeRunPrompt(
  deps: Pick<AppDeps, 'definitions' | 'workOrders' | 'accounts' | 'capabilities' | 'instructionFiles'>,
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
  input: { readonly runId: RunId; readonly cwd: string; readonly candidates: readonly AccountRoute[] },
): Promise<Result<HandoffPlan, HandoffError>>;
```

`composeRunPrompt` is the single prompt entry point: the composition root's start callback stops
building `prompt: role.instructions` itself and calls this instead. The use case loads the work
order record itself: `flow` comes from the record's `record.flow` — the value the dispatcher and
the gates resolve against — and the title from the same record; the input shape does not change.
`buildHandoff` takes the failed run's worktree as `cwd`: the executor supplies it, the same way
`composeRunPrompt` and `commitCheckpoint` receive theirs — a handoff never recreates a worktree.
The checkpoint adapter fails flat (`CheckpointError` is a single `git_failed`), so `buildHandoff`
maps by where the failure happened: the stage base resolution (`RunRepo.stageBase`, falling back
to the worktree base ref through `base`) yielding no sha is `no_repo` — in a healthy Docket
worktree the base ref always resolves, so a base failure is the not-a-working-tree verdict —
while a `diffSince` failure stays `git_failed`. It loads the failed run and its events, the work
order and definitions, the rolling note, the stage base, the diff, and the candidates' context
windows (`null` where none is known); assembles the pack **for the target provider** (its native
files), sizes it (fixed ceilings first; a known window only tightens them — A-63), and renders
it. The first candidate is the target: a missing account there is `unknown_account`; the
remaining candidates only tighten the budget, so a missing account on one of them merely
contributes no bound of its own. Empty `candidates` still build a pack, targetless: the natural
instruction set is empty, so every present file inlines (A-54's safe direction) and no window
binds. Every return appends exactly one audit `run.handoff` entry, failure paths included, with
the fixed detail `{ fromRun: runId, candidates: candidates.length }` and no error field — on a
refused handoff that entry is the run's only write (A-64).

Rules:
- **A-53** `composeRunPrompt` builds every run's prompt: Docket layers first (`stageBrief`, then `role.instructions`), then the instruction block as project context. The Docket layers are byte-identical for every provider given the same definitions; only the instruction block varies. `not_found` is the record-or-resolution error: the work order record is missing, or a record exists whose `record.flow`, or whose requested `stage`/`role`, the loaded definitions can no longer resolve (the gates' precedent — a run that can no longer be prompted). Definitions that fail to load are `definitions_invalid`, never `not_found`.
- **A-54** Native instruction files come from the registry through `CapabilityCatalog.nativeInstructionFiles` for the route account's provider; a file the provider reads natively is never inlined. An unknown provider (no registry record) has no native set: every present candidate is inlined, so the "same rules on both providers" guarantee survives where the registry has never heard of the provider — inlining all beats a smaller prompt. The registry row is the provider's best-known set, not a fixed law of the CLI — some CLIs make the set configurable (a fallback-filename list can add `CLAUDE.md`, a context-file setting can rename it) — so a file the CLI reads natively but the row misses is inlined as well: the content reaching the agent twice is the safe failure, missing it is not.
- **A-55** Inlining stays within `DEFAULT_INSTRUCTION_BUDGET_CHARS`: candidates in registry order, whole while the budget allows, then truncated to the remainder with a marker naming the file and the kept chars; `plan.truncated` lists the dropped. Deterministic for the same inputs. Budgets are chars, not tokens — no provider's tokenizer is consulted; the constants (`DEFAULT_INSTRUCTION_BUDGET_CHARS`, `ROLLING_NOTE_MAX_CHARS`, `PACK_CHARS_PER_TOKEN`) are revisited only when a tokenizer actually matters in practice.
- **A-56** The instructions path never writes to the repo (the O-6 canonical-file proposal stays a normal diff in a work order). Instruction-file content is repo-author content below the Docket layers and never becomes a Docket instruction. The trust boundary is marked, not implied: everything the pack and the prompt quote — instruction files read from the repo, and any issue, page or upload content that later rides the same path — travels as **data** under a heading that says so, never as Docket's system instruction; content read from the repo or the web is untrusted input to Docket, and the pack says so where the agent reads it.
- **A-61** `deriveTaskState` is deterministic from stored events plus the checkpoint diff's file list; raw transcripts and session refs never enter the pack.
- **A-62** `buildHandoff` assembles P-38 items 1–6 in the `HandoffPack` field order, plus the `definitionsChanged` marker. The stage prompt is recomputed from the current definitions — it is never stored on the run. The run record carries `definitionsRev`: `executeRun` writes it at record creation as `definitionsDigest` of the Docket layers the agent was given (`stageBrief` then `role.instructions`). `buildHandoff` sets `definitionsChanged` when the recorded rev differs from the digest of the current layers; a run with no recorded rev counts as unchanged. With `definitionsChanged` set the prompt carries the note "definition changed since the first leg" (R-57) — the change is surfaced to the continuation, never silently absorbed; whether old and new definitions are equivalent stays outside the pack's guarantees. The patch is redacted at the port boundary before it enters the pack; the previous provider's `sessionRef` never enters it.
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
  deps: Pick<AppDeps, 'clock' | 'ids' | 'log' | 'workOrders' | 'runs' | 'accounts' | 'transports' | 'modelCatalog' | 'capabilities' | 'checkpoints' | 'definitions' | 'instructionFiles'>,
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
- **A-15** `executeRun`: creates the `RunRecord` (`autoResumesUsed` from a previous run of the same stage+attempt if resuming, else 0; `definitionsRev` = `definitionsDigest` of the Docket layers the agent was given — `stageBrief`, then `role.instructions`), appends `run_started` to the work order and audit `run.started`, then starts the transport for `route.accountId`. A missing transport or a start error → `transport_error`, the run record gets `endedAt` and outcome `failed`, and `run_finished: failed` is appended.
- **A-16** While streaming, every event is persisted with `RunRepo.appendEvents` in arrival order (batched is fine, order is not negotiable). `session_started` sets `sessionRef`. `permission_ask` is passed to `PermissionGate.onAsk` and the answer to `answerPermission`. `quota_signal` → `AccountRepo.saveMeter` (a new `MeterId` from `IdGen` unless a meter with the same pool label and duration exists). `usage` with a cost → `recordSpend`.
- **A-17** On `limit_hit`: build a `LimitHit` for the run's account, ask the domain `decideOnLimit` with the account's policy and `autoResumesUsed`, end the run with outcome `limit`, append `run_finished: limit`, and return `{ kind: 'limit', decision }`. Scheduling the resume is the caller's job.
- **A-17a** `applyLimitDecision`: `schedule_resume` → put a queue item for the run's work order and stage with the same route, `notBefore = decision.at`, and increment the run's `autoResumesUsed` on the record; `switch_pool` → a queue item routed to the same account (pool choice is re-evaluated at dispatch); `fallback` → a queue item with `route = decision.route`; `ask` → no queue item (the work order stays `limit_waiting` and shows in the cockpit).
- **A-18** On `finished`: set `endedAt`/`outcome` (mapping as in `foldRun`), append `run_finished`, audit `run.finished` with `detail: { outcome }`.
- Addendum 2026-10-07: the executor folds the whole streamed event list, not the single `finished` event, so the R-44 empty-run mapping applies. When the folded outcome differs from the event's own mapping, the `run.finished` audit detail is `{ outcome, reason: 'empty_run' }`; otherwise it stays `{ outcome }`.
- **A-19** `enqueueStage`: only when `nextAction` is `start_run`; the route is the first account of `resolveRoute`'s chain; one queue item per work order (an existing item for the same work order is replaced). The queue item carries `stageRouting(stage, binding)`'s `tier` and `thinking` (each absent when neither sets it). For a stage with `reviewOf`, the chain is ordered with `orderForReview`, where `reviewedProvider` is the provider of the account of the last `succeeded` run of the `reviewOf` stage in this work order (undefined when there is none); the route is the first entry of the ordered chain, and `sameProviderReview` is set when the result says so.
- **A-20** `dispatcherTick`: builds the `DispatchSnapshot` — `running` from `RunRepo.listActive` joined with `WorkOrderRepo` for the repo and project, `headroom` per item from `headroom(pools, meters, accountId, matchId, now, account.reserve)`, where `matchId` is the account catalog entry's `resolvedId` for the item's model when the catalog knows one (an alias such as `opus` checks as the id it stands for), else the model, else `''`, `spend` per item from `combinedSpendStatus` over the account's own caps (`account_day` = UTC day of `now`, `account_week` = the UTC ISO week of `now`, Monday 00:00 to the next Monday, `account_month` = UTC calendar month of `now`), the repo cap (`repo_month`) and the project ceiling (`project_month`, observed spend summed over all repos of the project — R-48; work-order caps arrive in Phase 5) — calls `decideDispatch`, removes started items from the queue, calls `start` for each started item, and returns the decisions unchanged.

### Checkpoints, rolling note, handoff wiring (#581)

`ExecuteOutcome`'s `refused` error union gains `'handoff_failed'` (A-64). Rules:

- **A-57** The executor commits a checkpoint at each `tool_result` boundary when `CHECKPOINT_MIN_INTERVAL_MS` (`30_000`, [domain.md](domain.md) §11) has elapsed since the last commit, and always at `limit_hit`, `finished` and stream end. The threshold is a clock comparison made inside the event flow at each boundary, not a scheduler: the cadence is event-boundary + terminal only — no background timer exists; the executor's stream is the only clock application may read. A clean tree is a no-op (`changed: false`), never an error. Commits are local-only and authored by the Docket checkpoint identity `Docket <checkpoints@docket.local>`, never a user; they never travel to the forge. (`AgentEvent.tool_result` carries only `{ id, ok }`, so "each tool-result boundary that changed files" is implemented as commit-at-each-boundary with git as the arbiter.)
- **A-58** Checkpoint commits touch only the work order's worktree (I-20's guarantee unchanged); the user's checkout, its branch and its index are never modified.
- **A-59** The first commit of a stage attempt records its sha via `RunRepo.saveStageBase`. The pack's code state is `diffSince(stageBase)`; with no checkpoint (a clean stage) it is `diffSince(worktree base ref)`.
- **A-60** The rolling note is extended with every persisted event batch (`extendRollingNote`) and saved through `RunRepo.saveHandoffNote` on the same cadence — so it exists the moment the account blocks. It is the tail of the text/thinking stream, capped at `ROLLING_NOTE_MAX_CHARS` with `capped: true`; no other content is derived into it (the model-written summary stays optional and unanswered, open decision O-8).
- **A-64** A run started for a queue item with `handoffOf` builds the pack before the transport starts, sends `renderHandoffPrompt`'s prompt (checks-first preamble per R-57), and never passes a `resume` reference — native resume and the pack are never mixed (P-38). A pack failure refuses the run (`refused: 'handoff_failed'`) with only the audit entry written — the `run.handoff` entry above, appended on every return, failure paths included. The `run.started` audit detail carries `handoff: true` and `handoffOf`.
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
  | { readonly type: 'roadmap.runPhase'; readonly project: string; readonly phase: string } // A-98
  | { readonly type: 'project.attach'; readonly path: string; readonly repos?: readonly { readonly repo: string; readonly path: string }[] }
  | { readonly type: 'repo.register'; readonly project: string; readonly repo: string; readonly path: string }
  | { readonly type: 'repo.unregister'; readonly project: string; readonly repo: string }
  | { readonly type: 'workOrder.block'; readonly id: string; readonly reason: string }
  | { readonly type: 'workOrder.unblock'; readonly id: string }
  | { readonly type: 'workOrder.close'; readonly id: string }
  | { readonly type: 'workOrder.enqueue'; readonly id: string }
  | { readonly type: 'gate.decide'; readonly workOrderId: string; readonly gate: string; readonly decision: 'approved' | 'rejected'; readonly note?: string }
  | { readonly type: 'gate.attest'; readonly workOrderId: string; readonly gate: string; readonly noChangeNeeded: boolean }
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

### Quota wiring, billing view, machine-login candidates (P-48 … P-53)

```ts
// services/quota-service.ts — owns P-49's schedule; the composition root starts it
export const QUOTA_POLL_INTERVAL_MS: number;   // 300_000
export interface QuotaService {
  start(): void;                                // first pass for every account, then the interval
  stop(): void;
  refresh(accountId?: AccountId): Promise<void>; // one account or all; resolves when the polls end
}
export function createQuotaService(
  deps: Pick<AppDeps, 'clock' | 'ids' | 'log' | 'accounts' | 'capabilities'>,
  probes: QuotaProbeResolver,
  timers: { setInterval(fn: () => void, ms: number): unknown; clearInterval(handle: unknown): void },
  onChanged: () => void,                        // the api emits `accounts.changed`
): QuotaService;

// api.ts — UiEvent gains
| { readonly type: 'accounts.changed' }
// commands.ts
| { type: 'quota.refresh'; id?: string }        // answers { ok: true } after the polls end
// queries.ts
| { type: 'accounts.candidateQuota'; sourcePath: string } → CandidateQuotaView
export type CandidateQuotaView =
  | { readonly ok: true; readonly pools: readonly SettingsPoolView[]; readonly meters: readonly SettingsMeterView[] }
  | { readonly ok: false; readonly code: QuotaProbeError | 'needs_account' | 'not_found' };
// SettingsAccountView gains
readonly billing: 'included' | 'metered' | 'unknown';   // P-51 billing view
// ports/account-discovery.ts — AccountCandidate.kind gains 'machine_login'; the candidate gains
readonly provider: string;                               // the def id (A-67 resolved it from the route kind)
```

Rules:
- **A-80** `createQuotaService`: `start` polls every account once (in `AccountRepo.list` order, one at a time), then every `QUOTA_POLL_INTERVAL_MS`; an account whose route kind's `quotaProbe` is `none` is skipped. A poll for an account already in flight is not started twice (the second call awaits the first). After `account.adopt` and after an `account.save` that changes the route (the A-73 field set), the api calls `refresh(id)` without awaiting it. Each finished poll — ok or error — calls `onChanged` once. A probe error never throws out of the service.
- **A-80a** (amends A-80, 2026-10-04, review of #755) The schedule also skips a route kind whose `quotaProbe` is `rate_limit_events`: its quota arrives only as pushed run events, and polling it would read the machine's subscription login for an account that rides an API key. Such an account's meters still come from its runs (A-16).
- **A-81** `quota.refresh` maps to `refresh(id)` (unknown id → `not_found`); without `id` it refreshes every account. It audits nothing (a read, not a change).
- **A-82** `accounts.candidateQuota` finds the candidate by `sourcePath` (`not_found`); a `compatible_endpoint` candidate → `needs_account`; otherwise it polls the candidate's provider with `{ accountId: null, identityDir }` (`identityDir` = `sourcePath` for a Claude-style directory, `null` for `machine_login`) and returns pools and meters with synthetic ids, without saving anything. A result is cached per `sourcePath` for 60 s.
- **A-83** `settings.accounts` fills `billing` with the P-51 billing view; the presentation's pay-per-use and cap predicates (`isPayPerUse`, `mayHaveCap`) read `billing !== 'included'`, never `authMode`. `spend-consent.ts`'s `defaultBillingOf` returns `unknown` (not `metered`) for a non-subscription route kind without `defaultBilling`; `executeRun`'s and `testAccount`'s refusals are unchanged for `metered` and `unknown` alike.
- **A-83a** (amends A-83, 2026-10-04, review of #753) Each `accounts.candidates` row gains `billing: 'included' | 'metered' | 'unknown'`: the candidate's route kind's `defaultBilling` when it declares one, else P-51's fallback by the candidate's kind (`subscription` and `machine_login` → `included`, `compatible_endpoint` → `unknown`). The wizard's Bütçe grouping and gate read this field for a candidate not yet adopted, so a z.ai coding-plan candidate is grouped under Abonelikler before adoption too. No candidate is ever read for billing beyond its route kind.
- **A-84** `account.adopt` accepts a `machine_login` candidate (P-53): the record is `{ provider, label, authMode: 'subscription', routeKind, limitPolicy: 'wait_resume', caps: [] }` with no `identityDir`, `endpoint` or `secretRef`; `importToken` is ignored for it. `accounts.candidates` lists machine-login candidates after the directory candidates, provider order as `providers.discovered`.
- **A-85** (amends A-84; 2026-10-05, #782) `account.adopt` looks its candidate up in the discovery service's last scan when that scan is younger than 60 s and scans anew only when there is none or it is older, so adopting n accounts right after one scan runs no further scan. `accounts.candidates` carries an optional `fresh: true` that always scans anew and replaces the remembered scan ("Yeniden tara" sends it). A candidate absent from the remembered scan fails as before (not found) — it never triggers a hidden second scan in the same call.
- **A-86** (amends U-13 and P-51; 2026-10-05, #787) `settings.accounts` takes an optional `catalog: 'read' | 'skip'` (default `'read'`). With `'skip'` no model catalog is read and every row's `billing` is the route's own rule — what a failing catalog read already yields (P-51). With `'read'` the catalogs of all rows are read concurrently, not one after another. The wizard's finish sends `'skip'`: it reads the stored accounts only to apply caps and consents and needs no billing view, so setting up n new accounts starts no live model listing.
- **A-87** (amends U-51 and U-52; 2026-10-05, #790) The sidebar's accounts reader — the accounts frame, U-51 — sends `catalog: 'skip'` (A-86): its cards show the account's name, the status dot and the limit bar, never billing, so the `settings.accounts` read that `accounts.changed` triggers starts no live model listing and the first card after the wizard's finish does not wait behind the discovery chain. Settings → Hesaplar, which shows the billing tag, keeps `'read'` and shows U-52's scanning skeleton while the catalogs load.

### Create a project from the built-in library (#370)

A first run from an empty data dir reaches a working board without hand-written files. Operator
decision of 2026-10-03 (option A on #370): Docket writes the project's `.docket/project.yaml` and
`.docket/repo.yaml` into the chosen work tree — only when neither exists, and only on the user's
explicit "Oluştur" — so membership stays versioned truth in the repo (A-26), then attaches it
through the existing `attachProject`. Two sources, as the approved "Yeni proje" screen names them:
an existing folder ("Var olan klasör") and a new folder ("Boş proje"). Cloning and "Birlikte sıfırdan
başla" are not part of this contract.

```ts
// definition-store.ts — DefinitionStore gains
/** Writes each built-in role and flow as a global-root file unless a file with that id exists; never overwrites. */
installBuiltins(library: { readonly roles: readonly RoleDef[]; readonly flows: readonly FlowDef[] }): Promise<{ readonly written: readonly string[] }>;
/** Writes <path>/.docket/project.yaml and <path>/.docket/repo.yaml; writes nothing when either exists. */
scaffoldProject(path: string, project: ProjectDef, repo: RepoDef): Promise<Result<void, 'project_yaml_exists' | 'repo_yaml_exists' | 'io_failed'>>;

// repo-folders.ts — the one write the create flow needs outside .docket
export interface RepoFolders {
  /** Creates <parent>/<folder> and initialises a git repository in it with initial branch `main`. */
  createRepo(parent: string, folder: string): Promise<Result<{ readonly path: string }, 'not_a_folder' | 'folder_exists' | 'io_failed'>>;
}
// AppDeps gains
readonly repoFolders: RepoFolders;

// event-log.ts — AuditAction gains
| 'project.created'

// projects.ts
export type CreateProjectSource =
  | { readonly kind: 'existing'; readonly path: string }
  | { readonly kind: 'blank'; readonly parent: string };
export type CreateProjectError =
  | 'invalid_name' | 'not_a_repo' | 'project_exists' | 'docket_folder_exists'
  | 'not_a_folder' | 'folder_exists' | 'io_failed' | 'definitions_invalid' | AttachError;
export function createProject(
  deps: Pick<AppDeps, 'clock' | 'ids' | 'log' | 'projects' | 'repos' | 'definitions' | 'git' | 'repoFolders'>,
  input: { readonly source: CreateProjectSource; readonly name: string; readonly actor: Actor },
): Promise<Result<ProjectDef, CreateProjectError>>;

// commands.ts
| { type: 'project.create'; mode: 'existing'; path: string; name: string }
| { type: 'project.create'; mode: 'blank'; parent: string; name: string }   // ok → { ok: true, id: <project slug> }
```

Rules:
- **A-75** `createProject` validates before any write: the trimmed `name` is empty or longer than 80 characters → `invalid_name`; the slug is `slugFromName(name, taken)` (R-59) with `taken` = every `ProjectRepo.list()` id and every `RepoRegistry.list()` slug; source `existing` whose `path` is not a git work tree (`git.isWorkTree`) → `not_a_repo`. The definitions it will write are built and checked with `validateDefinitions({ roles: BUILTIN_ROLES, flows: BUILTIN_FLOWS, capabilities: [], project, repo })`; issues → `definitions_invalid` (a library bug, nothing written).
- **A-76** The written definitions: `project` = `{ id: slug, name, mainRepo: slug, repos: [slug] }` (project ≡ repo); `repo` = `{ id: slug, name, flows: <every BUILTIN_FLOWS id in library order>, defaultFlow: 'standard', commandSets: <every BUILTIN_COMMAND_SET_NAMES name → []>, roleOverrides: [], docsRoot: 'docs', testGlobs: [] }`. The command sets are empty on purpose: a `command` gate on an empty set reads `unknown` and never passes (R-13, R-16), so the work order waits at the tests gate until the user writes the commands into `repo.yaml`; Docket never guesses a test command.
- **A-77** Writes, in this order: source `blank` → `repoFolders.createRepo(parent, slug)` (its errors returned as they are; the path it returns is the project path); `definitions.installBuiltins({ roles: BUILTIN_ROLES, flows: BUILTIN_FLOWS })`; `definitions.scaffoldProject(path, project, repo)` — `project_yaml_exists` → `project_exists` (the folder is already a Docket project: attach it instead), `repo_yaml_exists` → `docket_folder_exists`, `io_failed` as is; then `attachProject({ path, actor })` and its result is returned. A failure after `createRepo` leaves the new folder in place (Docket never deletes a folder it showed the user); a failure after `installBuiltins` leaves the global files (they are idempotent library copies).
- **A-78** On success audit `project.created` with subject the project and `detail: { source: 'existing' | 'blank', builtinsWritten: <count> }`, before the `project.attached` entry `attachProject` writes. A refusal writes no audit entry.
- **A-79** `project.create` maps to `createProject` with the actor of the call; ok → `{ ok: true, id: <project slug> }`, an error → `{ ok: false, code }`. An unknown `mode` is rejected at the edge like an unknown `authMode`.

### Account test — "Test et" (#716)

An account whose login cannot be probed (`loggedIn: null`, "Doğrulanamadı") gets a **Test et**
action: one small real request on the account's route, with a classified result (R-58). It is not a
work-order run: no `RunRecord`, no queue item, no worktree, no events persisted. It is a real request,
so P-40 holds exactly as for a run and its spend counts against the account's caps.

```ts
// ports/account-test-repo.ts — machine-local state for the app's lifetime (in memory, I-35)
export interface AccountTestRecord {
  readonly accountId: AccountId;
  readonly model: string | null;            // the model tested; null = the route's default model
  readonly state: 'running' | 'ok' | 'failed';
  readonly class?: AccountTestClass;        // failed only
  readonly detail?: string;                 // failed only; redacted by the adapter (I-35)
  readonly startedAt: EpochMs;
  readonly endedAt?: EpochMs;
}
export interface AccountTestRepo {
  get(accountId: AccountId): Promise<AccountTestRecord | undefined>;
  save(record: AccountTestRecord): Promise<void>;   // upsert by accountId
  clear(accountId: AccountId): Promise<void>;
}

// ports/scratch-dirs.ts — an empty directory outside every repo, for runs that need a cwd but no checkout
export interface ScratchDir { readonly path: string; dispose(): Promise<void> }
export interface ScratchDirs { create(purpose: 'account-test'): Promise<ScratchDir> }

// AppDeps gains
readonly accountTests: AccountTestRepo; readonly scratch: ScratchDirs;

// account-repo.ts — recordSpend takes either entry
export type RunSpendEntry = { readonly accountId: AccountId; readonly project: ProjectSlug; readonly repo: RepoSlug; readonly workOrderId: WorkOrderId; readonly at: EpochMs; readonly usd: number };
export type AccountTestSpendEntry = { readonly kind: 'account_test'; readonly accountId: AccountId; readonly at: EpochMs; readonly usd: number };
recordSpend(entry: RunSpendEntry | AccountTestSpendEntry): Promise<void>;

// event-log.ts — AuditAction gains
| 'account.tested'

// services/spend-consent.ts — moved out of run-executor.ts unchanged, shared by executeRun and testAccount
export function spendConsentSatisfied(
  deps: Pick<AppDeps, 'accounts' | 'modelCatalog' | 'capabilities'>,
  accountId: AccountId,
  model: string | undefined,
): Promise<boolean>;

// use-cases/account-test.ts
export const ACCOUNT_TEST_TIMEOUT_MS: number;   // 90_000, from the transport start to the deadline
export const ACCOUNT_TEST_ROLE: RoleDef;        // id 'account-test', name 'Account test', instructions = ACCOUNT_TEST_PROMPT, writeScope { kind: 'none' }, capabilities [], active true
export type AccountTestError = 'not_found' | 'busy' | 'unsupported' | 'needs_spend_consent' | 'spend_cap_reached';
export function testAccount(
  deps: Pick<AppDeps, 'clock' | 'ids' | 'log' | 'accounts' | 'transports' | 'modelCatalog' | 'capabilities' | 'accountTests' | 'scratch'>,
  input: { readonly id: AccountId; readonly model?: string },
): Promise<Result<AccountTestView, AccountTestError>>;

// commands.ts
| { type: 'account.test'; id: string; model?: string }   // answers when the test has ended: { ok: true } or { ok: false, code: AccountTestError }

// queries.ts — SettingsAccountView gains
readonly test: AccountTestView | null;          // null = never tested since the app started or since the last reset (A-73)
export interface AccountTestView {
  readonly state: 'running' | 'ok' | 'failed';
  readonly class: AccountTestClass | null;      // failed only
  readonly model: string | null;                // null = the route's default model
  readonly at: EpochMs;                         // endedAt, or startedAt while running
  readonly detail: string | null;               // failed only; redacted, at most 300 code points
}
```

Rules:
- **A-68** `testAccount` checks, in this order, before anything is written: unknown account → `not_found`; a stored record in state `running` → `busy`; no transport for the account (`TransportResolver.forAccount` → `undefined`) → `unsupported`; `spendConsentSatisfied(account, model)` false → `needs_spend_consent` (P-40; the same helper as `executeRun`, whose behaviour and tests stay unchanged by the move); `combinedSpendStatus` over the account's own caps (the A-20 windows for `account_day`, `account_week`, `account_month`) blocked → `spend_cap_reached`. A refusal leaves every store unchanged and writes no audit entry.
- **A-69** Then: save a `running` record (`model` = `input.model ?? null`, `startedAt` = now); create a scratch dir; start the transport with `{ runId: ids.next<'run'>(), cwd: scratch.path, role: ACCOUNT_TEST_ROLE, route: { accountId, model: input.model }, prompt: ACCOUNT_TEST_PROMPT, capabilities: [] }` and no `effort`. Every `permission_ask` is answered `deny`. Events are collected in memory only (never `RunRepo`, never the work-order stream). At `ACCOUNT_TEST_TIMEOUT_MS` after the start the use case calls `stop()` and sets `timedOut`. The scratch dir is disposed on every path, including a start failure and a thrown error; a thrown error saves the record as `failed` with class `unknown` before it propagates.
- **A-70** The outcome is `classifyAccountTest` (R-58) over the start failure or the collected events. The record is saved as `ok` or `failed` (with `class`, `detail`) and `endedAt`; audit `account.tested` with subject the account and `detail: { model: model ?? '*', result: 'ok' | <class> }` — never the detail text. The returned view is the saved record's view.
- **A-70a** (amends A-70 and A-74, 2026-10-03, #735) `testAccount`'s input gains `actor: Actor`; `account.tested` is audited with that actor, and `account.test` passes the actor of the call (as `project.create` does, A-79). The signature becomes `testAccount(deps, input: { readonly id: AccountId; readonly model?: string; readonly actor: Actor })`.
- **A-71** Each `usage` event that carries a cost is recorded with `recordSpend({ kind: 'account_test', accountId, at, usd })`. `spend` with an `accountId` filter counts these entries; a filter by `project`, `repo` or `workOrderId` never matches them — a test spends from the account's caps, never from a repo or project budget.
- **A-72** `settings.accounts` fills each row's `test` from `AccountTestRepo.get` (`null` without a record); `class` and `detail` are `null` unless the state is `failed`.
- **A-73** A change that makes an old result meaningless clears it: `account.save` that changes `routeKind`, `endpoint`, `identityDir`, `tierModels` or the secret, and `account.remove`, call `AccountTestRepo.clear` for the account. The view carries `model`, so a surface whose selected model differs from it shows the account as untested; no stored state is needed for that.
- **A-74** `account.test` maps to `testAccount`: `{ ok: true }` on a finished test (whatever its outcome — the outcome is read from `settings.accounts`), `{ ok: false, code }` on a refusal. An absent or empty `model` means the route's default model.

### Stage files — what the approval decides on (#819)

The decision card asks a person to approve a plan it never shows: the planner writes its plan into
the worktree as a file, and the card offers the gate name and generic copy. This contract gives the
card the files the stage's runs changed in the work order's worktree, and a read-only preview of
one of them. No editing, no diff view, no Markdown rendering — the issue's out-of-scope list.

```ts
// ports/worktree-files.ts — read-only listing and preview inside one worktree; never writes
export interface WorktreeFileEntry {
  readonly path: string;                     // repo-relative, '/'-separated
  readonly sizeBytes: number;
}
export interface WorktreeFilePreview {
  readonly path: string;
  readonly lines: readonly string[];
  readonly truncated: boolean;
}
export type WorktreeFileError = 'outside_worktree' | 'not_found' | 'too_large' | 'not_text';
export interface WorktreeFiles {
  /** Changed vs HEAD plus untracked-but-not-ignored files, path order (I-39). */
  listChanged(worktreePath: string): Promise<readonly WorktreeFileEntry[]>;
  /** Guard order and error names are the contract (I-40): escape → 'outside_worktree', missing →
   *  'not_found', over 256 KiB → 'too_large', NUL byte or invalid UTF-8 → 'not_text'; else the
   *  first maxLines lines, truncated when the file had more. */
  readText(worktreePath: string, relativePath: string, maxLines: number): Promise<Result<WorktreeFilePreview, WorktreeFileError>>;
}

// deps.ts — AppDeps gains (fakes follow A-1 … A-3; the fake keeps the adapter's contract, I-41)
readonly worktreeFiles: WorktreeFiles;

// use-cases/stage-files.ts
export const PREVIEW_MAX_LINES = 200;        // fixed; line count is never caller-chosen
export const STAGE_FILES_MAX = 50;           // the list the card shows
export type StageFilesError = 'not_found';
export interface StageFilesView {
  readonly files: readonly WorktreeFileEntry[];   // at most STAGE_FILES_MAX, path order
  readonly truncated: boolean;                    // the port listed more than STAGE_FILES_MAX
}
export function stageFiles(
  deps: Pick<AppDeps, 'workOrders' | 'worktrees' | 'worktreeFiles'>,
  id: WorkOrderId,
): Promise<Result<StageFilesView, StageFilesError>>;
export function readStageFile(
  deps: Pick<AppDeps, 'workOrders' | 'worktrees' | 'worktreeFiles'>,
  input: { readonly id: WorkOrderId; readonly path: string },
): Promise<Result<WorktreeFilePreview, StageFilesError | WorktreeFileError>>;

// queries.ts
| { readonly type: 'workOrders.stageFiles'; readonly id: string }
| { readonly type: 'workOrders.readStageFile'; readonly id: string; readonly path: string }
```

Rules:
- **A-88** (added 2026-10-09, #819) The stage-file reads work only on the work order's own worktree, and only the use case says where that is: it loads the record (`not_found` before any port call) and resolves the path the way the gates do — `worktrees.ensure(record.repo, record.id)`; a `no_repo` resolution is `not_found` too (a record whose repo no longer registers has nothing to list). I-20's `ensure` creates a missing worktree as an empty one — it lists nothing; a read never fails on it. No query input carries a path root: `path` in `workOrders.readStageFile` is the repo-relative file name, passed to the port whose guards (I-40) decide. Both queries are reads — no `actor`, no audit entry (the A-81 stance).
- **A-89** (added 2026-10-09, #819) `readStageFile` calls the port with `maxLines: PREVIEW_MAX_LINES` (200, fixed) and returns the port's result verbatim, error names included, never re-mapped. `stageFiles` returns the port's list capped at `STAGE_FILES_MAX` (50) entries with `truncated: true` when there were more: a card showing fifty of eighty files says so, because the approval decides on what the list claims to be. A `readStageFile` for a path the capped list does not carry is not refused — the list is a convenience, the port's guards are the access rule.

### Capability discovery — candidates and import (#853)

Part 2 of the #715 split: a port that reads capability sources inside the config directory of
accounts the user adopted (read-only, path-confined), the query the Yetenekler surfaces will
render, and the command that copies selected candidates into Docket's own global definitions.
Docket copies; it never touches the user's files. The UI is part 3; `hook` stays deferred.

```ts
// ports/capability-discovery.ts — new port; reads only
export interface CapabilityScanAccount {
  readonly id: AccountId;
  readonly provider: string;  // provider def id (data); decides the scan map row
  readonly identityDir?: string; // absolute; absent = nothing to scan (machine login, endpoint)
}
export interface CapabilityDiscovery {
  /** Raw per-account finds — sources is exactly the one account each was found in; unmerged
   *  (the use case merges, R-63); identity carries the R-62 form of the find's own fields. */
  scan(accounts: readonly CapabilityScanAccount[]): Promise<readonly CapabilityCandidate[]>;
}

// deps.ts — AppDeps gains (ports.test.ts key set follows; fakes follow A-1 … A-3)
readonly capabilityDiscovery: CapabilityDiscovery;

// ports/definition-store.ts — gains the installBuiltins shape for capabilities
/** Writes each capability as <globalRoot>/capabilities/<id>.yaml unless a file with that id
 *  exists; never overwrites. written/skipped list the targets actually written / found. */
installCapabilities(capabilities: readonly CapabilityDef[]): Promise<{
  readonly written: readonly string[];
  readonly skipped: readonly string[];
}>;

// use-cases/capability-candidates.ts — the query side
export const CAPABILITY_CANDIDATES_MAX = 200;  // the merged list the query answers
export const CAPABILITY_DESCRIPTION_MAX = 300; // code points, the view's description cut
export interface CapabilityCandidateView {
  readonly identity: string;                 // mergeCandidates' canonical form (R-63)
  readonly kind: 'mcp' | 'skill' | 'context';
  readonly name: string;
  readonly sources: readonly string[];       // account ids, sorted, unique — plain strings on the wire
  readonly command?: string;                 // mcp only
  readonly path?: string;                    // skill / context; the source file's absolute path
  readonly description?: string;             // ≤ CAPABILITY_DESCRIPTION_MAX code points
  readonly imported: boolean;
}
export interface CapabilityCandidatesView {
  readonly candidates: readonly CapabilityCandidateView[]; // identity, code-point order
  readonly truncated: boolean;                              // the port found more than the cap
}
export function capabilityCandidates(
  deps: Pick<AppDeps, 'accounts' | 'capabilityDiscovery' | 'definitions'>,
): Promise<CapabilityCandidatesView>;

// use-cases/capability-import.ts — the command side
export type CapabilityImportError =
  | 'not_found' | 'invalid_name' | 'missing_command' | 'missing_path' | 'id_taken' | 'invalid_definition';
export type CapabilityImportResult =
  | { readonly identity: string; readonly status: 'imported'; readonly id: CapabilitySlug }
  | { readonly identity: string; readonly status: 'already_present'; readonly id: CapabilitySlug }
  | { readonly identity: string; readonly status: 'rejected'; readonly reason: CapabilityImportError };
export function importCapabilities(
  deps: Pick<AppDeps, 'accounts' | 'capabilityDiscovery' | 'definitions' | 'clock' | 'ids' | 'log'>,
  input: { readonly identities: readonly string[]; readonly actor: Actor },
): Promise<readonly CapabilityImportResult[]>;

// api/queries.ts + api/commands.ts
| { readonly type: 'capabilities.candidates' }   // no fresh: no cache in this issue (A-94)
| { readonly type: 'capabilities.import'; readonly identities: readonly string[] }
// commands.ts — the ok result gains the per-identity side channel (roles-style):
{ readonly ok: true; readonly id?: string; readonly results?: readonly CapabilityImportResultView[] }
```

Rules:
- **A-90** (added 2026-10-09, #853) `capabilityCandidates` scans the accounts the store holds: `deps.accounts.list()` mapped to `CapabilityScanAccount`; an account without `identityDir` (machine login, compatible endpoint) yields nothing — its capabilities are not on this disk in a Docket-known layout. The scan's failure is empty, never an error surface: a broken config directory produces no candidates and does not stop the rest (the account scan's stance). No query input can name a path — the port's own confinement is the only path authority (A-88's stance).
- **A-91** (added 2026-10-09, #853) The raw finds go through `mergeCandidates` (R-63 — same identity across accounts is one candidate with every source), the merged list is sorted by identity in Unicode code-point order, capped at `CAPABILITY_CANDIDATES_MAX` (200) with `truncated: true` when there were more, and each `description` is cut to `CAPABILITY_DESCRIPTION_MAX` (300) code points. The query is a read: no actor, no audit entry (the A-81 stance).
- **A-92** (added 2026-10-09, #853) `imported` is decided per candidate against the global store, target-wise: the id R-67 derives from the candidate's own name, `definitions.readFile({ kind: 'global' }, 'capabilities/<id>.yaml')`; a file that exists, parses and whose `identityOfDefinition` equals the candidate's identity → `true`. Missing, unparseable or a different identity → `false`. The stored file's parse reads only the identity fields (kind, name, command) — a stored env block is never touched. The check reads one target per candidate — it never enumerates the store and never rescans.
- **A-93** (added 2026-10-09, #853; amended by the architect's open-question decisions the same day — results are per identity, not all-or-nothing) `importCapabilities` answers one result per requested identity, in input order; one rejected identity never blocks the others. Order per identity: find it in the candidates of A-90's scan (`not_found`); derive the id — R-67 with its in-call collision suffix (`invalid_name`); at that id, a stored file with an equal identity → `already_present` (idempotent skip), a different identity → `rejected id_taken` (an existing target is never overwritten); map with `candidateToDefinition` (`missing_command`/`missing_path` verbatim, R-65); then the to-write target goes through `definitions.validateCandidate({ kind: 'global' }, target, content)` — the content is the definition's JSON form, which the real store parses as YAML flow syntax and the fake as JSON — issues → `rejected invalid_definition`; otherwise the definition joins the single `installCapabilities` call. A repeated identity echoes its first outcome. A no-op call (everything already imported) answers ok with no writes. Imports are not audited yet (decision 5): `AuditSubject` is unchanged this wave and the actor rides the input for the follow-up issue that adds the audit entry.
- Addendum 2026-10-09 (#858): decision 5's gap is closed — the `imported` arm of this command appends the audit entry A-95 defines, and the actor that rode the input for it is the command's actor.
- **A-94** (added 2026-10-09, #853) The boundary mapping: `capabilities.candidates` → `capabilityCandidates(deps)`; the query always answers, an empty account store answers `{ candidates: [], truncated: false }`. `capabilities.import` → `importCapabilities(deps, { identities, actor })` with the api layer's own actor; the answer is `{ ok: true, results }` with one row per identity in input order — `id` set for `imported`/`already_present`, `reason` for `rejected`, each `null` otherwise. There is no remembered-scan window in this issue (decision 2): every query scans — the query runs when a surface opens, not on a poll, and the account store is small; a cache follows the A-85 pattern only when a surface needs it.
- **A-95** (added 2026-10-09, #858) Only a result with `status: 'imported'` is audited: one `capability.imported` entry per imported capability, appended after the single `installCapabilities` call, actor the command's actor. The subject is `{ kind: 'capability', id }` with the stored slug — the id the import returned, so `EventLog.list` finds the entry from the definition. The detail is `{ kind, identity }`: the capability's kind and the identity's path/command target — targets only, never an env value (the AuditEntry detail law). `already_present` and `rejected` write nothing, and a repeated identity that echoes an `imported` outcome audits once. An audit append failure must not fail or roll back the import: the write it reports on is already durable, so the failure is swallowed and the results answer unchanged.
- **A-96** (added 2026-10-09, #855) The changes gate's evidence and its attestation. `evaluateMachineGates` also picks up pending `changes` gates of the current stage, in stage order with the other machine gates: `filesChanged = CheckpointCommitter.diffSince(CheckpointCommitter.base({ cwd: worktree, workOrderId })).files.length` — `> 0` → evidence `{ changes: { filesChanged } }` (R-61 passes it) and the pass continues; `=== 0` → **no event** — the gate stays pending and the whole machine pass (the command sets behind it and the remote polls after it) halts for the operator's attestation, so a zero-file run surfaces before the long test run (R-68 puts the gate first for exactly this). A `git_failed` base or diff also leaves the gate pending but surfaces as the call's `git_failed` error — a broken git state never folds into a count, and never counts as zero. The attestation itself is `attestNoChanges` (same deps shape as `decideHumanGate`, no port calls): the gate must be a pending `changes` gate of the current stage while the status is `gating` (`not_a_changes_gate` / `not_pending` otherwise, `not_current_stage` for another stage's gate, `agent_cannot_decide` for an agent actor); it evaluates `{ changes: { filesChanged: 0, noChangeNeeded } }` through R-61 and appends one `gate_evaluated` plus an audit `gate.decided` with `decision: noChangeNeeded ? 'approved' : 'rejected'`. The api command is `gate.attest`.

- **A-105** (added 2026-10-10, #873) The dispatcher's concurrency limits are the operator setting `dispatch.limits`, kept through the settings port `AppSettingsRepo { get(key): Promise<unknown | undefined>; set(key, value): Promise<void> }` (`AppDeps.settings`; fake and SQLite per I-46). `getDispatchLimits(deps)` returns the stored `DispatchLimits`, or the defaults `{ global: 4, perRepo: 3, perAccount: {} }` (`DEFAULT_DISPATCH_LIMITS`) when nothing is stored — and also when the stored value has the wrong shape or breaks A-106's bounds: a damaged value never stops the dispatcher. Only this key goes through the port in #873.
- **A-106** (added 2026-10-10, #873) `setDispatchLimits(deps, { limits, actor })` validates before it writes: `global` an integer 1–16; `perRepo` an integer 1–`global`; every `perAccount` entry an integer 1–`global`; otherwise `err('invalid_limits')`. Every `perAccount` key must be an account the repo knows, otherwise `err('unknown_account')` (checked after the numbers). A rejection writes nothing and appends no audit entry.
- **A-107** (added 2026-10-10, #873) A successful `setDispatchLimits` appends one audit entry after the write: `action: 'settings.dispatch_changed'`, `subject: { kind: 'settings', id: 'dispatch' }`, `detail` = the new numbers only (`global`, `perRepo`, and `account:<AccountId>` per entry) — no secrets, no old values.
- **A-108** (added 2026-10-10, #873) The boundary: query `settings.dispatch` (no input) answers `getDispatchLimits`; command `settings.setDispatch { global, perRepo, perAccount: Record<AccountId, number> }` answers `{ ok: true }` or `{ ok: false, code }` with `invalid_limits`, `unknown_account`, or `invalid_id` for a `perAccount` key that is not an account id. The composition root reads the limits again at the start of every dispatcher tick (`getDispatchLimits` → `dispatcherTick`), so a saved change applies to the next tick without re-creating the dispatcher; the `DISPATCH_LIMITS` constant in `electron/main.ts` is gone.

### Run phase — open and queue a phase's runnable tasks (#871)

`runPhase(deps, { project, phase, actor })` (`services/run-phase.ts`) composes `openTaskWorkOrders` (A-25)
and `enqueueStage` (A-19) over one roadmap phase. Result `{ opened: { task, workOrders }[], failed: { task, workOrder?, error }[] }`;
refusals `unknown_project | no_roadmap | definitions_invalid | unknown_phase | phase_not_runnable`.
API command `roadmap.runPhase { project, phase }` answers `{ ok: true, phaseRun }` (ids as strings) or `{ ok: false, code }`.
`AuditAction` gains `phase.run`.

- **A-97** (added 2026-10-10, #871) Gating. The roadmap loads as in A-25 (`no_roadmap` when absent, `definitions_invalid` when invalid), then an unknown phase is `unknown_phase`. The view is `deriveRoadmap` over the project's work orders that carry a `task` (one whose flow no longer loads has no derivable status and is left out, as on the roadmap page). A phase whose derived status is `waiting` or `done` answers `phase_not_runnable`. Every refusal writes nothing: no work order, no queue item, no audit entry.
- **A-98** (added 2026-10-10, #871) Opening and queueing. Candidates are the phase's tasks listed in the view's `runnable` (R-42), in roadmap order. For each, `openTaskWorkOrders` opens one work order per target repo (A-25, all-or-nothing per task), then `enqueueStage({ id })` runs for every returned id. A task listed in `opened` carries all the ids it opened, in the order A-25 returned them. A phase with no runnable task — empty, or every task already running or waiting — answers both arrays empty. The api command maps the result to strings without reshaping it.
- **A-99** (added 2026-10-10, #871) Failure and repeat. One task's failure never stops the others: a task that cannot open is collected as `{ task, error }` with the A-25 code; a work order that opened but whose `enqueueStage` failed stays (the operator sees it on the board), stays in `opened`, and is also collected as `{ task, workOrder, error }` with the enqueue code. Running the phase twice opens nothing the second time, because the first run made those tasks `running` (R-40) — the second call answers `ok` with both arrays empty.
- **A-100** (added 2026-10-10, #871) Audit. Every call that passes A-97's gates appends exactly one `phase.run` entry, subject `{ kind: 'project', id: project }`, actor the command's actor, detail `{ project, phase, opened: n, failed: n }` where the counts are the lengths of the two result arrays. No titles, no work-order ids, no values. A refused call appends nothing.

## 5. Phase 2a acceptance — headless end to end

`src/api/scenarios/standard-flow.test.ts` (test-only folder in the API layer, which may import the
application and the domain) drives the built-in `standard` flow with fakes: opening and human gate
decisions go through `createApi`; runs, machine gates and agent verdicts call the application
directly:

1. open → `plan`/`ready`; enqueue + tick → started; `executeRun` with a fake transport that
   finishes `completed` → `plan`/`awaiting_human`.
2. `gate.decide plan-approval approved` → `implement`/`ready`.
3. enqueue + tick + run (completed) → `gating`; `evaluateMachineGates` with a worktree diff that
   counts files (the changes gate passes, A-96), commands exiting 0 and 0 scan findings →
   `review`/`ready`. A second scenario drives the zero-file path the same way to `gating`, halts at
   the pending changes gate (no command runs), attests rerun (`gate.attest` `noChangeNeeded: false`
   → `implement` attempt 2), then attests no-change on the rerun and lets the next machine pass
   finish the stage.
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
   natively) and shares the flow and work-order spine of the Docket layers with leg 2's prompt
   (the review stage's own text differs). Script A:
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

## 8. Re-query before a scheduled resume (added 2026-10-10, #872)

- **A-101** `applyLimitDecision` writes the queue item of a `schedule_resume` decision with `requeryFirst: true` next to `notBefore` (the limit policy emits `requeryFirst: true` on every such decision). `switch_pool`, `fallback` and `ask` never set it; `autoResumesUsed` is incremented exactly as in A-17a, and the cap of 3 stays in `decideOnLimit`.
- **A-102** `dispatcherTick`, given `DispatcherConfig.probes`: an item with `requeryFirst === true` whose `notBefore <= now` is not started in that tick and takes no part in its `decideDispatch` call (no decision is reported for it). The tick calls `pollQuota` once per account for all such items of the account — never once per item — and on success clears `requeryFirst` on each stored item with `queue.put` (every other field unchanged, `notBefore` kept). Items without `requeryFirst`, and items whose `notBefore` is still in the future, are treated exactly as before. Without `probes` nothing is re-queried and a `requeryFirst` item starts like any other (the field is inert).
- **A-103** The tick after the re-query decides as A-20 says, on the meters the poll saved: still blocked → the item stays queued with the headroom rule's wait reason; free → it starts. The tick never polls an item whose flag is cleared.
- **A-104** A failing `pollQuota` (any error) clears nothing, starts nothing (the item waits one more tick) and does not count as an auto-resume. The dispatcher counts consecutive failed re-queries per queue item in memory; at the third the item's `requeryFirst` is cleared (still not started in that tick), so it is never stuck and the headroom rule alone protects the start. A successful poll clears the flag and the count.

## 9. Unattended phase advance (added 2026-10-10, #879)

A phase the operator started with `roadmap.runPhase` keeps advancing without another click. The
persisted record is `PhaseAutoRun { project, phase, state: 'running' | 'paused' | 'done', startedAt, attention }`
(domain `roadmap`, kept by the `PhaseAutoRunRepo` port, `AppDeps.phaseAutoRuns`); it is distinct from
`PhaseRunView`, the result of one `runPhase` call. Decisions: a failed or blocked work order does not stop the phase
(it is flagged as attention), and advancing never crosses into the next phase. `AuditAction` gains
`phase.paused` and `phase.resumed`.

- **A-109** (added 2026-10-10, #879) A `runPhase` call that passes A-97's gates upserts the phase's record as `running`: `startedAt = clock.now()` and `attention: []` for a new record or one that is `paused` or `done`; a record already `running` is left as it is (its `startedAt` and `attention` stay). One record per (project, phase). A refused call writes no record. A-97 … A-100 are unchanged.
- **A-110** (added 2026-10-10, #879) `pausePhase(deps, { project, phase, actor })` moves `running → paused`; no record, or any other state, answers `not_running` and writes nothing. `resumePhase` moves `paused → running`; otherwise `not_paused`. Both keep `startedAt` and `attention`. API commands `roadmap.pausePhase` / `roadmap.resumePhase { project, phase }` answer `{ ok: true }` or `{ ok: false, code }` (`not_running`, `not_paused`, `invalid_id`). The query `roadmap.byProject` gives each phase entry an optional `autoRun?: { state, attention: string[] }` (work-order ids as strings), absent while the phase has no record.
- **A-111** (added 2026-10-10, #879) `advancePhases(deps)` (`services/advance-phases.ts`; it imports use-cases and `run-phase`, never the reverse) visits every `running` record and, per record: loads the roadmap (project, roadmap or phase missing or invalid → the record is skipped, nothing is written), derives the view as `runPhase` does, and opens and queues the phase's tasks listed in the view's `runnable` through the same per-task function `runPhase` uses (`openAndQueueTask`: A-25 then A-19, actor `{ kind: 'system', component: 'phase-advance' }`). Tasks that are not runnable, and records that are `paused` or `done`, are left alone. A refusal of the queueing flow (spend consent, A-15) is not bypassed: the work order stays on the board as for `runPhase` (A-99).
- **A-112** (added 2026-10-10, #879) When the derived status of the record's phase is `done`, the record becomes `done` (`attention: []`) and nothing else happens for it; a `done` record is never advanced again. No other phase is started, opened or recorded: the operator starts each phase with `runPhase`.
- **A-113** (added 2026-10-10, #879) `attention` is the phase's task-linked work orders that the cockpit's attention rule (A-22) names: status `blocked` (a failed work order ends there), `awaiting_human` or `limit_waiting`, or one with an unanswered permission ask on an active run. It is refreshed on every advance, in work-order creation order, and a work order that leaves those states leaves the list. A flagged work order never stops the other tasks of the phase from opening.
- **A-114** (added 2026-10-10, #879) Idempotence: a second `advancePhases` call with nothing changed in between opens nothing (R-40: the first call made those tasks `running`), queues nothing, and writes no record and no audit entry.
- **A-115** (added 2026-10-10, #879) A paused record starts nothing new: `advancePhases` skips it, so no task opens while paused, even one that became runnable. Pausing never touches a running run, a queued item or an opened work order; after `resumePhase` the next advance opens what became runnable meanwhile.
- **A-116** (added 2026-10-10, #879) Audit: a successful pause appends one `phase.paused` and a successful resume one `phase.resumed` entry, subject `{ kind: 'project', id: project }`, actor the command's actor, detail `{ project, phase }` and nothing else. A refused call appends nothing. `advancePhases` itself appends no entry of its own: the work orders it opens are audited by A-25.

Trigger: the dispatcher tick in `electron/main.ts` calls `advancePhases` once, before `dispatcherTick`, inside the existing non-reentrant guard; a failure is logged and never blocks the tick. No new timer.

Addendum 2026-10-10 (#881) — machine-aware dispatch. New ports: `MachineProbe { read(): Promise<MachineSample> }` and `DispatchStatusHolder { get(); set() }` (with `DispatchStatus { mode, cap, effective, band, load1?, cores?, freeMemRatio? }`, in memory only), both in `AppDeps` as `machine` and `dispatchStatus`, each with a fake. The per-tick composition is `resolveDispatchLimits(deps, onProbeError?)` in `services/machine-dispatch.ts`; the dispatcher tick in `electron/main.ts` calls it in place of `getDispatchLimits`, after `advancePhases`, inside the same non-reentrant guard.

- **A-117** (added 2026-10-10, #881) The mode is the operator setting `dispatch.mode` (`'fixed' | 'auto'`) in the settings store, no new storage. `getDispatchMode` answers `auto` when nothing valid is stored, so a damaged value never stops the dispatcher.
- **A-118** (added 2026-10-10, #881) `setDispatchLimits` takes an optional `mode`. A value outside `fixed` / `auto` answers `invalid_limits` and writes nothing (no limits, no mode, no audit entry); a save without a mode leaves the stored mode as it was.
- **A-119** (added 2026-10-10, #881) The `settings.dispatch_changed` audit detail gains `mode`, the mode in force after the save (A-107's other fields are unchanged).
- **A-120** (added 2026-10-10, #881) `fixed` behaves exactly as A-105 … A-108: `resolveDispatchLimits` answers the stored limits untouched, does not read the machine, and records a status with `band: 'free'` and `effective` equal to the cap, without load figures.
- **A-121** (added 2026-10-10, #881) In `auto`, the global limit is `effectiveGlobal(cap, band, running)` (R-71) where `running` is the count of active runs: cap 4 gives 4 when free, 2 when reduced, and `max(1, running)` when busy. Throttling only decides whether NEW items start; it never ends or pauses a running run (A-20's path is unchanged).
- **A-122** (added 2026-10-10, #881) The previous band is the one in the last written status (`free` before the first tick, after a `fixed` tick or after a failed probe), so R-70's hysteresis holds across ticks.
- **A-123** (added 2026-10-10, #881) A probe failure behaves as `free` for that tick: the stored limits are answered unchanged, the failure goes to `onProbeError` (the main process logs it) and is never thrown, and the status records `band: 'free'`.
- **A-124** (added 2026-10-10, #881) In `auto`, `perRepo` and every `perAccount` limit are clamped to the effective global for the tick; the stored limits are never rewritten.
- **A-125** (added 2026-10-10, #881) Every tick writes the status holder: `mode`, `cap`, `effective`, `band` and, when a reading was taken, `load1`, `cores` and `freeMemRatio` (only when known).
- **A-126** (added 2026-10-10, #881) The boundary: query `settings.dispatch` answers the limits plus `mode`, `suggested` (`suggestDispatchCap` over a fresh reading), `machine { cores, totalMemGb }` (one decimal) and `status` (the last tick's status, absent until the first tick); `suggested` and `machine` are absent when the machine cannot be read. Command `settings.setDispatch` accepts an optional `mode` (A-118).

## 10. Blocked-by on the roadmap page (added 2026-10-10, #882)

- **A-127** (added 2026-10-10, #882) Each phase entry of `roadmap.byProject` carries `blockedBy: readonly string[]`: the ids of the roadmap's blocking phases for that phase whose derived status is not `done`, in the order the roadmap lists them; empty when nothing blocks it or every blocker is done. It is a read-only projection of `PhaseDef.blockedBy` and the derived phase statuses; no other field of the query or any command changes.

## 11. Proposal queries (added 2026-10-10, #890)

- **A-128** (added 2026-10-10, #890) Query `proposals.list { status? }` answers `ProposalListItem[]`. With a `status` filter only that status is listed, newest `createdAt` first; without one, pending proposals come first and then the rest, each group newest first. Equal times are ordered by id descending, so the order is total.
- **A-129** (added 2026-10-10, #890) A `ProposalListItem` is `{ id, summary, target, scopeKind: 'global' | 'project' | 'repo', scopeId?, status, author: { kind, label }, createdAt, decidedAt?, decidedBy? }`. `scopeId` is the project or repo slug and is absent for `global`; `decidedAt` and `decidedBy` are absent while undecided. A label is the user's `label` (else its `id`), the agent's role, or the system component. The list never carries `before` or `after`.
- **A-130** (added 2026-10-10, #890) Query `proposal.detail { id }` answers the list item plus `before`, `after`, `lines` and `truncated` (R-73's `diffLines` of `before` and `after`) and `currentlyStale`. `currentlyStale` is true only when the status is `pending` and the target's current hash, read through `definitions.readFile` (a missing file hashes as `''`), differs from `baseHash`. The query reads only: it never changes the stored status, decides, or writes an audit record, and the proposal text is returned unchanged.
- **A-131** (added 2026-10-10, #890) An unknown proposal id answers `{ ok: false, code: 'not_found' }` and a malformed id `{ ok: false, code: 'invalid_id' }`, the shapes the other detail queries use. Both queries return bare views; no command is added and `proposal.decide` is unchanged.

Addendum 2026-10-10 (#894) — pages core. The use cases live in `use-cases/pages.ts`; the ports are `PageRepo` (`save`, `get`, `list({ workOrder?, project? })`, `saveComment`, `comments(page, { undelivered?, version? })`, `markDelivered(ids, at)`) and `PageFiles` (`write(page, n, files)`, `read(page, n, path)`, `remove(page, n)`), both in `AppDeps` as `pages` and `pageFiles` with fakes (A-1 … A-4). Audit gains the actions `page.published`, `page.versioned`, `page.commented`, `page.approval_requested`, `page.approval_decided` and the subject `{ kind: 'page', id }`. There is no api command, query or UI in this slice.

- **A-132** (added 2026-10-10, #894) `publishPageUseCase` hashes each file (`sha256Hex`), validates through the domain, writes version 1's files, then saves the record, then appends `page.published` (actor = the publisher, detail `{ version: 1, files, bytes }`) and returns the page. Any domain refusal — a path-traversal file set above all — happens before anything is written: no files, no record, no audit entry. Each publish takes a fresh id from `IdGen`.
- **A-133** (added 2026-10-10, #894) `publishVersion` loads the page (`not_found` when absent), adds version `n + 1` through the domain, writes only that version's files and saves the record; earlier versions' files stay untouched. A refused file set changes nothing. It appends `page.versioned` with `{ version, files, bytes }`. An approval of an earlier version is reset (R-77).
- **A-134** (added 2026-10-10, #894) `commentOnPage` saves a user comment and appends `page.commented` with `{ version, comment: <id> }` — never the text or anchor; an agent comment, empty text, unknown version and unknown page are refused without a trace. `undeliveredComments` lists a page's comments with no delivery time, optionally of one version (`not_found` for an unknown page); `ackComments` marks the named comments of that page delivered at the clock's time (domain `markDelivered`), ignores ids of other pages and already delivered comments (their first time stays), returns the comments that changed, and is idempotent. Delivery to a running agent is the pull tool's business (6c), not this slice's.
- **A-135** (added 2026-10-10, #894) `requestPageApproval` moves the page to `pending` and appends `page.approval_requested` with `{ version }`; `decidePageApproval` applies R-78, saves the page and appends `page.approval_decided` with `{ version, decision }`. A refusal (agent actor, stale version, not pending, unknown page) changes nothing and appends nothing. A page with no work order, a missing work order, or a work order that waits on no `page_approval` gate only updates the page.
- **A-136** (added 2026-10-10, #894) When the page is linked to a work order whose current stage is `awaiting_human` on a `page_approval` gate, `decidePageApproval` — after the page is saved — calls the existing `decideHumanGate` with that gate, the same decision and the same actor, so the work order advances (approval passes the gate, rejection fails it) and `gate.decided` is audited by that path; the gate logic is not reimplemented. `gates.ts` exports `pendingPageApprovalGate` for the lookup. Once the gate is decided, a later page decision on the same work order only updates its page. When several pages are linked to one work order, the first decided page decides the gate.
- **A-137** (added 2026-10-10, #894) Write order: a version's files are written first and the record second. A failing record write removes the just-written version's files (the removal's own failure is swallowed so the original error surfaces), appends no audit entry and rejects with the original error; a failing file write leaves no record and no audit entry. The record is never left without its files, and a version never without its record. Earlier versions' files are never removed by a rollback.
- **A-138** (added 2026-10-10, #894) Audit entries of pages carry only ids, version numbers, byte and file counts and the decision word — never a title, comment text, anchor, path or file content. The page use cases log nothing else.
- **A-139** (added 2026-10-10, #894) `listPages` returns pages in creation (id) order, narrowed by `workOrder`, `project` or both; `pageDetail` answers `{ page, comments }` with all the page's comments in writing order, `not_found` for an unknown page.
- **A-140** (added 2026-10-10, #894) The headless scenario `scenarios/pages.test.ts`: a work order waits on a `page_approval` gate; a path-traversal file set is refused with nothing written; publish, comment (pulled and acknowledged), request approval, publish version 2 (approval reset), request again; an agent's approval is `self_approval`, version 1 is `stale_version`; the user approves version 2, the page is `approved` with `approvedVersion` 2 and the work order's gate passes; the audit trail names every step and carries no content.

### Docket's own MCP server — tokens, attachment, tool dispatch (added 2026-10-10, #898)

New ports: `RunTokens` (`mint(binding) → token`, `resolve(token) → binding | undefined`, `revoke(runId)`; binding is `{ runId, workOrderId, project?, role }`; in-memory only; fake `createFakeRunTokens` with `minted()` / `live()`) and `McpEndpoint` (`{ socketPath, command, args, env }`, how the app launches its own MCP child; absent in tests and headless shells). `AppDeps` gains `runTokens` and `mcpEndpoint: McpEndpoint | undefined`; `CapabilityCatalog` gains `mcpSupport(providerId): boolean | 'unknown'`. The dispatch behind the server is `services/docket-tools.ts` (`createDocketTools(deps).call({ token, tool, args })` → `{ ok: true, result } | { ok: false, code }`).

- **A-141** (added 2026-10-10, #898) `executeRun` mints one token per run when the run is given Docket's tools (below): after the run record exists and the transport has been resolved, immediately before `transports.start`, bound to `{ runId, workOrderId, project (the work order's), role (the run's role id) }`. The token reaches the child only as the literal env value `DOCKET_MCP_TOKEN` of the built-in capability, next to `DOCKET_MCP_SOCKET` (the endpoint's socket path) and the endpoint's own variables. Two runs active at the same time hold different tokens.
- **A-142** (added 2026-10-10, #898) The token is revoked when the run ends, on every path: finished (any outcome), limit, a transport that fails to start (including the resume restart), a stream that dries up, and an exception thrown while the run is driven — one `finally` around the whole execution. A run that never reached the transport (refused, no transport) minted nothing.
- **A-143** (added 2026-10-10, #898) The token appears nowhere a run leaves behind: not in the `RunRecord`, the stored events, the work order's events, any audit entry, the prompt, or any capability other than the built-in one; tests serialise all of these and assert the token string is absent. The token is not audited and not logged by the executor or the tool dispatch.
- **A-144** (added 2026-10-10, #898) The built-in capability `{ kind: 'mcp', id: 'docket-pages', name: 'Docket pages', command, args, env }` (command and args from the `McpEndpoint`, env = the endpoint's variables plus the socket and the token as literals) is appended LAST to the request's capabilities, as the last step before `transports.start`; a capability of the same id in the input is replaced, never duplicated, and the input array is not mutated. It is not stored and not persisted. It is not attached (and no token is minted) when the role has `docketTools: false`, when `deps.mcpEndpoint` is absent, or when the run's provider has `mcpSupport(provider) === false`; `'unknown'` attaches.
- **A-145** (added 2026-10-10, #898) Tool dispatch: a request carries `{ token, tool, args }` and acts as `{ kind: 'agent', runId, role }` of the token's binding. An unknown, empty or revoked token answers `unauthorized` and does nothing (and costs nobody's rate budget); a tool other than `page_publish` / `page_update` / `page_comments` is `unknown_tool`; `args` that are not an object, or fail validation (missing or mistyped fields, an unknown `kind`, a bad page id, a bad base64 payload), are `bad_input`; fields the tool does not know are ignored (a smuggled `workOrder` never re-targets a page); a thrown storage error answers `internal`. Every failure is a stable code only — no message, no stack, no echo of the input.
- **A-146** (added 2026-10-10, #898) `page_publish { title, kind, content?, files?, entry? }` creates a page linked to the run's work order and project and answers `{ pageId, version: 1 }`; exactly one of `content` (a single file named by the kind: html `index.html`, diagram `diagram.mmd`, markdown `page.md`, table `table.csv`, report `report.md`, or by `entry` when given; an image page cannot use `content` without an `entry`) and `files` (each with a path and exactly one of `text` (utf8) or `base64`). `page_update { pageId, content?, files?, entry? }` publishes the next version of a page of THIS run's work order — a page of another work order, or one with no work order, is `forbidden`, an unknown id `not_found` — and answers `{ pageId, version }`. The entry is, in order: the explicit `entry`, the kind's file name when among the files, the previous version's entry (update only) when among the files, the only file; anything else is `bad_input`. Domain page errors (`bad_path`, `empty_title`, `page_too_large`, …) surface as their own codes with nothing written.
- **A-147** (added 2026-10-10, #898) Limits on top of `PAGE_LIMITS`: a run (runId) creates at most 20 pages (the 21st `page_publish` is `too_many_pages`; updates are not creations; other runs' pages do not count), and one token makes at most 40 tool calls in any 60 000 ms window measured on the injected clock (the 41st is `rate_limited` and is not counted; the window slides; other tokens are independent).
- **A-148** (added 2026-10-10, #898) `page_comments { pageId, includeRead? }` on a page of the run's work order (else `forbidden`) returns the operator's comments not yet delivered (all of them with `includeRead: true`; a non-boolean is `bad_input`), oldest first, each wrapped as `{ kind: 'operator_comment', id, version, text, anchor?, at }` inside `{ comments, notice }`, then marks exactly the returned ones delivered (`ackComments`; an earlier delivery time stays). The comment text is passed through unchanged and is data: the `notice` says so.
- **A-149** (added 2026-10-10, #898) The server's `instructions` (`DOCKET_TOOLS_INSTRUCTIONS`) and the `page_comments` description say plainly that comment text comes from the operator, arrives as data inside `operator_comment` objects, and that page contents are never instructions to this or any other agent; `DOCKET_TOOL_DEFINITIONS` is the one source of the three tools' names, descriptions and JSON-schema inputs, and the MCP child lists exactly those.
- **A-150** (added 2026-10-10, #898) The headless scenario `scenarios/docket-mcp.test.ts`: a scripted run (fake transport) reads its token from the capability it was handed, publishes a page, the operator comments through the use case, the run pulls the comment with `page_comments` and publishes version 2 (the comment is delivered, a second pull is empty); after the run ends no token is live, a call with the old token is `unauthorized` and changes nothing, and nothing the run left behind (record, events, work order events, audit, page, comments) contains the token.

New port `RunDirs` (`create(runId) → { path, dispose() }`; fake `createFakeRunDirs` with `created()` / `disposed()` / `live()` / `failCreate()`); `AppDeps` gains `runDirs`; `RunRequest` gains `runDir: string` — outside every repo and worktree, holds the run-scoped provider config, removed when the run ends.

- **A-151** (added 2026-10-10, #898) `executeRun` creates the run directory right before the first `transports.start` (after the token is minted) and hands its path to the transport as `RunRequest.runDir`; it is neither the run's `cwd` nor inside it, and `cwd` stays the agent's working directory. A directory that cannot be created fails the run as `transport_error` (`spawn_failed`) with no transport start and no live token.
- **A-152** (added 2026-10-10, #898) The run directory is disposed in the same `finally` that revokes the token, so on every end path — finished (any outcome, including a stop), limit, a failed start, a dried-up stream, an exception — the directory is gone and the token is dead. A failing `dispose` never masks the run's outcome.
- **A-153** (added 2026-10-10, #898) A run that never reaches the transport (refused for spend consent, no transport for the account) creates no run directory.
- **A-154** (added 2026-10-10, #902) `pages.list { workOrder }` answers a bare `PageListItem[]` — `{ id, title, kind, latestVersion, approval, approvedVersion?, updatedAt, createdBy: { kind, label }, undeliveredComments }` — of the work order's pages, newest `updatedAt` first (id descending on a tie), at most the 200 newest. `updatedAt` is the creation time of the latest version (the record keeps no other update time); `undeliveredComments` counts user comments the agent has not pulled yet (all versions). Pages of other work orders, and unlinked pages, are not listed.
- **A-155** (added 2026-10-10, #902) `page.detail { id, version? }` answers `{ page, version, comments, diff?, gate? }`: `page` is the list item plus `versions: { n, createdAt, by, entry, files: { path, bytes }[] }[]` (no hashes, no bytes); `version` defaults to the latest; `comments` are the comments of ALL versions, oldest first, each `{ id, version, text, anchor?, at, delivered }` with `delivered` true once the agent pulled it.
- **A-156** (added 2026-10-10, #902) `diff` is present only for a page whose kind is not `image`, when the requested version is above 1 and the ENTRY files of that version and the one before can both be read as UTF-8 within `PAGE_LIMITS.fileMaxBytes` (a missing, oversize or non-UTF-8 file simply leaves `diff` out; the query never fails for it). It is `diffLines(entry(version − 1), entry(version))` as `{ against, lines, truncated?: true }`, `truncated` present only when the line diff collapsed.
- **A-157** (added 2026-10-10, #902) `gate` is present only for a page linked to a work order: `{ pending: true, gate }` while that work order is `awaiting_human` on a pending `page_approval` gate (`pendingPageApprovalGate`), `{ pending: false }` otherwise (including a work order that no longer loads).
- **A-158** (added 2026-10-10, #902) Commands `page.comment { page, version, text, anchor? }`, `page.requestApproval { page }` and `page.decide { page, decision, version }` call `commentOnPage`, `requestPageApproval` and `decidePageApproval` with the calling actor and answer `{ ok: true }` or `{ ok: false, code }` where `code` is the domain `PageError` code unchanged (`empty_comment`, `comment_too_long`, `unknown_version`, `not_found`, `not_pending`, `self_approval`, `stale_version`, …). The agent-actor and stale-version refusals come from the core; the api adds no rule. A headless scenario (`api/page-api.test.ts`) walks publish, new version, comment, diff, pull, stale decide, latest decide and the work order's gate.
- **A-159** (added 2026-10-10, #902) `page.decide` runs on the same per-command dependency view as the other commands, so `workOrders.changed` is emitted exactly when the decision appended to the linked work order's event log (the gate advanced). A refused decision, an unlinked page, or a work order not waiting on the gate emits nothing; `page.comment` and `page.requestApproval` never emit it.
- **A-160** (added 2026-10-10, #902) No query or command answer carries file bytes — page text appears only inside `diff.lines` — and the audit entries of these commands name ids, version numbers and counts only, never comment text. Ids are validated at the edge: a malformed work order or page id answers `{ ok: false, code: 'invalid_id' }`, an unknown page `not_found`, and a version that is not an integer in `1 … latest` `unknown_version`; `pages.list` of an unknown work order is an empty list.

Addendum 2026-10-10 (#913): conversations core — `ConversationRepo` and `AttachmentFiles` ports (fakes `createFakeConversationRepo`, `createFakeAttachmentFiles`; `AppDeps.conversations` and `AppDeps.attachmentFiles`), the use cases in `use-cases/conversations.ts`, the audit actions `conversation.started`, `conversation.deleted`, `conversation.pinned`, `conversation.draft_confirmed`, `conversation.draft_dropped` and the audit subject `{ kind: 'conversation', id }`. `AttachmentFiles` has one method beyond `write`, `read` and `removeAll`: `remove(conversation, id)`, which undoes one write without touching the conversation's other attachments. No API command, query, runner or tool uses these yet.

- **A-161** (added 2026-10-10, #913) `startConversationUseCase` takes ids from the id generator (conversation, message, one per attachment), stamps the clock time, stores each attachment's bytes under the conversation and attachment ids with `sha256Hex` recorded in the `AttachmentRef`, saves the record and appends `conversation.started` with `{ scope: <global|project|workOrder>, messages: 1, refs, attachments, bytes }`. A refused scope, message, reference or attachment stores, writes and audits nothing; an upload that the domain would refuse by size or count is not hashed.
- **A-162** (added 2026-10-10, #913) `appendUserMessage` loads the conversation (`not_found` otherwise), appends through the domain, writes the message's attachment bytes first and saves the record second, and appends no audit entry. Earlier messages and their attachments stay as they were.
- **A-163** (added 2026-10-10, #913) Nothing is left half-written. A domain refusal (bad name or type, size, count, empty text, the 400-message cap) writes no bytes and changes no record. When an attachment write or the record write fails, the bytes written for that message are removed one by one (earlier messages' attachments stay), the failure still surfaces, and no audit entry is appended. A failed start removes everything it wrote.
- **A-164** (added 2026-10-10, #913) `appendAssistantMessage` (called by the future runner) appends through the domain and saves; artifacts and sources are stored by reference, usage as given, and no file is written. `not_found`, a refused message or a failing save change nothing and append no audit entry.
- **A-165** (added 2026-10-10, #913) `listConversations` answers the repo's summaries (pinned first, then newest-updated first, optional scope, pinned, case-insensitive `query` over title and message text, and `limit`); `conversationDetail` answers the conversation with its drafts, or `not_found`.
- **A-166** (added 2026-10-10, #913) `pinConversation` saves the pinned flag through the domain (`updatedAt` unchanged) and appends `conversation.pinned` with `{ pinned }`; an unknown conversation is `not_found` and appends nothing.
- **A-167** (added 2026-10-10, #913) `deleteConversation` is idempotent: it removes the record and its drafts first, appends `conversation.deleted` with `{ messages, attachments, bytes, drafts }`, then removes the attachment directory. A conversation that is already gone appends nothing but still sweeps its attachment directory, so bytes left by a failed earlier removal do not stay. Other conversations are untouched.
- **A-168** (added 2026-10-10, #913) `createDraft` needs an existing conversation (`not_found`), builds the draft through the domain (R-90; refusals store nothing), takes its id from the generator and appends no audit entry. `dropDraftUseCase` marks it dropped and appends `conversation.draft_dropped` with `{ draft }`; an unknown draft is `not_found`, a finished one `not_draft`, and neither appends anything.
- **A-169** (added 2026-10-10, #913) `confirmDraftUseCase` refuses an unknown draft (`not_found`) and one that is not in status `draft` (`not_draft`) before anything else, then opens the work order through the existing `openWorkOrder` as the calling actor with the draft's project, repo, title and task. When opening fails the draft stays `draft`, nothing is audited and the answer is `{ code: 'open_failed', reason: <OpenError> }`; when it succeeds the draft is saved as `confirmed` with the new id and `conversation.draft_confirmed` is appended with `{ draft, workOrder }`.
- **A-170** (added 2026-10-10, #913) Audit entries of these use cases name ids, kinds, flags, counts and byte totals only — never a title, message text, file name, file content or draft title — and nothing in them logs. A test runs every audited step with distinctive content, serializes the entries and asserts none of it appears, and that nothing was written to the console.

- **A-166** addendum (added 2026-10-10, review of #914) `pinConversation`, `deleteConversation`, `dropDraftUseCase` (A-167, A-168) and `confirmDraftUseCase` (A-169) are the operator's alone: an actor whose kind is not `user` (the future chat runner runs as an agent or system actor) is refused with `not_user` before anything is read or written — no work order is opened, no record, draft or byte changes, no audit entry is appended. `createDraft` and `appendAssistantMessage` stay callable by agent and system actors (A-164, A-168). `deleteConversation` now answers a `Result` (`not_user` or ok).

Addendum 2026-10-10 (#915): actions and permissions core — `ActionRepo` and `GrantRepo` ports (`ports/action-repo.ts`; fakes `createFakeActionRepo`, `createFakeGrantRepo`; `AppDeps.actions` and `AppDeps.grants`), the use cases in `use-cases/actions.ts`, the audit actions `action.proposed`, `action.applied`, `action.rejected`, `action.failed`, `action.undone`, `grant.created` and `grant.revoked`, filed under the existing `conversation` audit subject. `ActionRepo` is `{ save, get, forConversation, pending, countFor }` (oldest proposal first, ties by id); `GrantRepo` is `{ save, get, forConversation }` and its only implementation holds grants in memory so they die with the app. The effect of an action is never in this layer: `proposeAction` and `decideActionUseCase` take an injected `ActionApplier` (`(action, authority) → Result<{ undo? }, { code }>`, authority `{ kind: 'user', id }` or `{ kind: 'grant', grant }`) and `undoAction` an injected `ActionUndoer`; the real ones arrive with a later slice. No API command, query, runner or tool uses these yet.

- **A-176** (added 2026-10-10, #915) `proposeAction(deps, { conversation, action, by }, apply)` refuses, in this order and with nothing stored, applied or audited: a `user` actor (`not_assistant` — the operator approves, they do not propose through this door), an action the domain refuses (R-95 … R-97: `bad_action`, `bad_setting_key`, `value_too_large`, so a hostile kind such as `gate_decide` or `merge` never reaches a record), an unknown conversation (`not_found`), and a conversation that already holds `actionsPerConversationMax` (500) records (`rate_limited`, whatever the grants).
- **A-177** (added 2026-10-10, #915) With no usable grant the use case saves a `pending` record (id from the generator, `proposedAt` from the clock), answers `{ record, decision: { kind: 'needs_approval' } }`, never calls the applier and appends `action.proposed` with `{ action, class, decision }`. The record is in `pending(conversation)`. A grant that does not cover the action's class changes nothing.
- **A-178** (added 2026-10-10, #915) With a usable grant (R-100) the record is saved pending, `action.proposed` is appended with `decision: 'apply'`, the applier is called once with `{ kind: 'grant', grant }`, and on success the record becomes `applied` (`decidedBy` the grant, the applier's `undo` carried), `action.applied` is appended with `{ action, class, authority: 'grant', grant }` and the grant is saved with one more application (read again just before, so a concurrent count is not overwritten). A grant for `open_work_order` and `roadmap_edit` leaves a `definition_edit` and a `setting_change` pending.
- **A-179** (added 2026-10-10, #915) An applier that answers an error or throws makes the record `failed` and keeps it visible: `failure` is the applier's code when it is already a stable code (`[a-z_]`, at most 64 characters), `apply_failed` when it is anything else, and `applier_error` when the applier threw — a message, title or target never reaches a record or an audit entry. `action.failed` is appended with `{ action, class, code }` and the grant's application count is not consumed (30 failures leave a grant able to apply). An undo that the domain refuses is dropped and the record is still `applied`, since the work happened, only not undoable.
- **A-180** (added 2026-10-10, #915) `decideActionUseCase(deps, { id, decision, by }, apply)` is the operator's: any non-`user` actor gets `not_user` before anything is read, written, applied or audited. An unknown id is `not_found`, a record that is not `pending` is `not_pending` (the applier is never called twice). `approved` re-validates the stored action, calls the applier with `{ kind: 'user', id }` and settles the record as in A-178/A-179 (a failing applier leaves a `failed` record and an ok answer); approving by hand never consumes a grant. `rejected` marks it `rejected`, does not call the applier and appends `action.rejected`.
- **A-181** (added 2026-10-10, #915) `grantPermission(deps, { conversation, classes, minutes, by })` is `grant_not_user` for an agent or system actor, `not_found` for an unknown conversation, then builds the grant through `newGrant` with `ms = minutes × 60 000` (60 minutes is allowed, 61 is `grant_too_long`, `0`, negative and `NaN` are refused, hostile or empty classes are `bad_class` or `grant_empty`); only a valid grant is saved to `GrantRepo` and audited as `grant.created` with `{ grant, classes: <comma-joined class names>, count, minutes }`. `revokePermission(deps, { grant, by })` is `not_user` for anyone but the operator, `not_found` for an unknown grant, stamps `revokedAt` and appends `grant.revoked` with `{ grant }` once — a second revocation answers the stored grant and appends nothing.
- **A-182** (added 2026-10-10, #915) The grant boundaries hold end to end: a grant of conversation A never makes a proposal in conversation B apply; after 25 grant-authorised applications the 26th proposal is `pending` with `needs_approval`; an exhausted grant is skipped for a second live grant of the same conversation; at the clock time `expiresAt` the next proposal pends (one millisecond earlier it applied); after `revokePermission` the next proposal pends; and a pending action can still be approved by the operator after its grant expired, the applier then seeing the user authority.
- **A-183** (added 2026-10-10, #915) `undoAction(deps, { id, by }, undo)` is the operator's (`not_user` otherwise, the undoer never called), `not_found` for an unknown id, then judges status and window through `markUndone` **before** calling the undoer, so a record that is not `applied` (`not_applied`), has no undo info or is past its window (`undo_expired`) causes no call. The undoer receives the stored record; when it answers an error or throws the result is `undo_failed` and the record stays `applied` so the operator can try again, with no message kept; on success the record is saved `undone` and `action.undone` is appended with `{ action, class }`.
- **A-184** (added 2026-10-10, #915) `listActions(deps, { conversation, pending? })` answers the repo's records for that conversation only, oldest proposal first, or only the pending ones; an unknown conversation is an empty list. `activeGrants(deps, { conversation })` answers that conversation's grants that are neither revoked nor expired at the clock's now (an exhausted grant is still listed so its count is visible).
- **A-185** (added 2026-10-10, #915) Audit entries of these use cases carry ids (`action`, `grant`), class names, the decision (`needs_approval` or `apply`), the authority kind (`user` or `grant`), counts, minutes and failure codes — never an action's value, setting value, target, title or any applier text — and nothing logs. A test runs every audited step with a distinctive setting value and definition target (and an applier whose error text contains them), serializes the entries and the records and asserts none of it appears, that every detail key is on the allowed list, and that nothing was written to the console.

Addendum 2026-10-10 (#917): action appliers and undoers — `createActionApplier(deps)` and `createActionUndoer(deps)` in `services/action-appliers.ts` (they import use cases and the domain, never the reverse; no new port). They are the injected `ActionApplier` and `ActionUndoer` of A-176 … A-185. Two signatures of that slice change; the text of A-176, A-178, A-180, A-181 and A-183 is not rewritten, this addendum replaces its types: `ActionApplier = (action, authority, ctx: { conversation, action: ActionId }) => Promise<Result<{ undo? }, { code }>>` — `proposeAction` and `decideActionUseCase` pass the context of the record they are settling (A-176, A-178, A-180) — and `ActionUndoer = (record, by: Actor) => …` — `undoAction` passes its `by`, which the operator-only rule (A-181, A-183) has already restricted to a user. Every failure below is a stable code (`[a-z_]{1,64}`), nothing is applied on any failure, and no value, title, target or file content is ever returned or logged.

- **A-186** (added 2026-10-10, #917) The applier receives the context of the record being settled on both paths (grant and approval): `{ conversation, action }` with the record's own ids. The undoer receives the stored record and the operator who asked. The #916 tests still pass; they only gained assertions for both.
- **A-187** (added 2026-10-10, #917) Authority becomes an acting user. Under `{ kind: 'user', id }` the underlying use case runs as `{ kind: 'user', id }`. Under `{ kind: 'grant', grant }` the grant is loaded again and must exist, belong to `ctx.conversation`, be user-created, cover the action's class and be neither revoked nor expired at the clock's now, else `grant_invalid`; the underlying use case then runs as the grant's creator (the operator pre-authorised the class, and those use cases refuse non-user approvals by design). The action record keeps `decidedBy` the grant and `action.applied` names `authority: 'grant'` and the grant id, so the trail still shows an assistant acting under a grant. Before anything else the context must name an existing record of the same conversation and the same action kind, else `action_mismatch` (an action cannot be borrowed into another conversation's context).
- **A-188** (added 2026-10-10, #917) `open_work_order { draft }`: the draft must exist (`draft_not_found`), belong to `ctx.conversation` (`draft_mismatch`) and still be `draft` (`draft_not_pending`); it is opened through `confirmDraftUseCase` as the acting user (a refusal there is `open_failed`, the draft stays a draft). Success returns the undo `{ kind: 'close_work_order', ref: <work order id>, expiresAt: now + 3 600 000 }`.
- **A-189** (added 2026-10-10, #917) `roadmap_edit { project, proposal }` and `definition_edit { scope, target, proposal }` bind to the proposal exactly: it must exist (`proposal_not_found`), be `pending` (`proposal_not_pending`), have a scope equal to the action's (`roadmap_edit`: that project's scope; `definition_edit`: same kind and same slug) and a target equal to the action's (`roadmap_edit`: exactly `roadmap.yaml`) — otherwise `proposal_mismatch`. A `definition_edit` whose target is `roadmap.yaml` is `proposal_mismatch` even if it reaches the applier unvalidated, so each class only ever applies its own kind of file. A proposal whose author is a user is `proposal_mismatch` under approval and under a grant: an assistant action never approves a proposal somebody else wrote; agent and system authors are allowed. No proposal is changed by a refusal.
- **A-190** (added 2026-10-10, #917) A bound proposal is applied with `decideProposalUseCase(approved)` as the acting user, so staleness and candidate validation are the existing ones: a file that moved is `stale` (the proposal is marked stale, nothing written), a candidate that no longer validates is `invalid_after` (nothing written, the proposal stays pending). Success returns the undo `{ kind: 'revert_proposal', ref: <proposal id>, expiresAt: now + 3 600 000 }`.
- **A-191** (added 2026-10-10, #917) `setting_change`: `dispatch.mode` accepts only `'fixed'` or `'auto'` (anything else is `invalid_value`) and is written through `setDispatchLimits` with the stored limits unchanged; `dispatch.limits` is validated by `setDispatchLimits` itself (`invalid_limits` becomes `invalid_value`, `unknown_account` stays `unknown_account`) and leaves the mode alone. The write is audited by the existing `settings.dispatch_changed` entry as the acting user. Success returns the undo `{ kind: 'restore_setting', ref: 'assistant.undo.<action id>', expiresAt: now + 3 600 000 }`.
- **A-192** (added 2026-10-10, #917) Before a setting is written its effective previous value (the stored one, or the default when none is stored) is saved under the settings key `assistant.undo.<action id>` as `{ key, previous }`. If saving it fails nothing is applied and the record fails with `undo_not_saved`. If the write itself is then refused, the saved value is cleared again. Leftover `assistant.undo.*` keys are not pruned beyond that: an applied action whose undo window passes leaves its (small) key behind.
- **A-193** (added 2026-10-10, #917) Undo is the operator's: the undoer answers `not_user` to any other actor, and a record without undo info, or whose undo kind does not belong to its action, is `undo_unavailable`. `close_work_order` closes the work order only if it is the one this action's own draft opened (`undo_unavailable` otherwise, whatever `ref` says), has no `run_started` event (`work_started`) and is not closed (`already_closed`); it closes as the operator through `closeWorkOrder`.
- **A-194** (added 2026-10-10, #917) `revert_proposal` requires `ref` to be the action's proposal, that proposal to be `approved` (`proposal_not_approved`) and the target file's current content to equal that proposal's `after` (`file_changed` — someone edited it since, and their edit is never overwritten). It then creates a reverse proposal (`after` = the original `before`, author `{ kind: 'system', component: 'assistant-undo' }`) and approves it as the operator; the reverse proposal's `baseHash` makes a concurrent edit `stale` (the edit survives). A reverse proposal that could not be applied is rejected, never left pending.
- **A-195** (added 2026-10-10, #917) `restore_setting` requires `ref` to be exactly `assistant.undo.<this record's id>` and the stored value to be `{ key, previous }` with the action's own key and a valid previous value, else `undo_unavailable` (so a cleared, foreign, forged or damaged value restores nothing); it restores through `setDispatchLimits` as the operator (`restore_failed` if that refuses) and then clears the key by storing `null` (the settings port has no delete), so a second undo finds nothing (`undo_unavailable`, and `not_applied` through `undoAction`).
- **A-196** (added 2026-10-10, #917) Codes only: every applier and undoer failure is a stable code, a dependency that throws is absorbed by the use case (`applier_error`, `undo_failed`), and a test with distinctive proposal, setting, account and draft content serializes every failure code, undo, authority and audit detail and asserts none of it appears and nothing was written to the console. The scenario `src/application/scenarios/action-appliers.test.ts` runs the approval and grant paths of all four kinds followed by undo, and a sweep in which every forbidden or mismatched combination ends `failed` or refused with the stores unchanged.

Addendum 2026-10-10 (#919): the artifact library — `use-cases/page-library.ts` (`pageLibrary`, `pinPage`, `workOrderCodeOf`, `PAGES_PINNED_KEY` = `pages.pinned`, `PAGES_PINNED_MAX` 200, `PAGE_LIBRARY_LIMIT` 500) and the API query `pages.library` and command `page.pin` (`PageLibraryItemView` in `api/page-views.ts`). No new storage: pages are read through `PageRepo.list`, pins live in the settings store. The work order code the library searches and shows is the Turkish one (`İE-` plus four digits, U-22); the `page.pin` success line reuses the existing neutral label `editor.saved`.

- **A-197** (added 2026-10-10, #919) `pageLibrary(deps, filter)` answers `{ page, projectName?, workOrderNumber?, pinned }` items. `kind`, `project` and `workOrder` keep only pages that match; `pinned: true` keeps only pinned pages and `pinned: false` only unpinned ones; `projectName` is the page's project's display name and `workOrderNumber` the work order's display number (both absent when the page has none or the record is gone). A pin whose page no longer exists never appears.
- **A-198** (added 2026-10-10, #919) The library is ordered newest-updated first, where a page's update time is its latest version's `createdAt` (a new version moves a page up), ties broken by page id descending, and holds at most `PAGE_LIBRARY_LIMIT` (500) items; the 501st-oldest page is cut, not the newest.
- **A-199** (added 2026-10-10, #919) `q` is matched with `matchesSearch` (R-104) against the page title, the kind's Turkish name (R-105), the project's display name and the work order's code text; an empty or whitespace `q` filters nothing. "taslak" finds "Giriş ekranı taslağı" and every html page (the kind name is part of the text), "giris ekrani" finds "Giriş Ekranı", "İSTEK" and "istek" find the same pages, "ie-0012" finds the page of work order 12, "kitap" finds "Kitabı". The match is honestly a substring one: "kal" finds "Kalem", and a second token that matches nothing excludes the page.
- **A-200** (added 2026-10-10, #919) `pinPage(deps, { page, pinned })` stores the pinned ids as a JSON array of page ids under the settings key `pages.pinned`, in pin order. An unknown page is `not_found` and writes nothing. At most `PAGES_PINNED_MAX` (200) pins: pinning a 201st page is `too_many_pinned`, while pinning an already pinned page at the cap still succeeds. Pins are an operator preference; the use case checks no actor beyond the API's command actor.
- **A-201** (added 2026-10-10, #919) Pinning and unpinning are idempotent (a second identical call changes nothing and keeps the order), and every write drops ids of pages that no longer exist as well as entries that are not strings; a stored value that is not an array counts as no pins, so a damaged setting never breaks the library.
- **A-202** (added 2026-10-10, #919) API boundary: `pages.library { q?, kind?, project?, workOrder?, pinned? }` answers a bare list of `{ id, title, kind, project?: { slug, name }, workOrder?: { id, code }, latestVersion, updatedAt, approval, approvedVersion?, pinned, provenance }`; `provenance` is `operator` for a user creator, `docket_ai` for an agent whose role is `asistan` and `agent_run` for any other agent or the system. A malformed project slug or work order id is `invalid_id`. `page.pin { page, pinned }` answers `{ ok: true }`, or `{ ok: false, code }` with `invalid_id`, `not_found` or `too_many_pinned`. No view carries file bytes, file paths or comment text. A scenario publishes an html page (agent run of a work order), a markdown page (the `asistan` role) and a diagram (the operator), pins one and queries by `q`, `kind`, `project`, `workOrder` and `pinned`, asserting order, provenance and the work order code.

Addendum 2026-10-11 (#920): the chat token kind and the read-only chat tools. `RunTokenBinding` is a discriminated union: `{ kind: 'run', runId, workOrderId, project?, role }` (the old shape plus the tag) or `{ kind: 'chat', turn: RunId, conversation: ConversationId, role }`, where `turn` is a fresh id per assistant turn (the agent actor's `runId`, not a RunRecord); `RunTokens.revoke(id)` voids by the run id or the turn id (`runTokenOwner`). New port `RepoFileReader` (`read(repo, path, { from, maxLines, maxBytes }) → Result<{ lines, truncated, nextFrom? }, 'not_found' | 'outside_repo' | 'too_large' | 'not_text' | 'repo_unknown'>`, fake `createFakeRepoFileReader` with `put` / `calls`, `AppDeps.repoFiles`) and the pure `isSecretRepoPath(path)` beside it. Services: `chat-read-scope.ts` (`chatReadScope`), `chat-tools.ts` (`createChatTools`, `CHAT_TOOL_DEFINITIONS`), `docket-tool-types.ts` (the shared request, response and code types), and `docket-tools.ts` gains `DOCKET_TOOL_DEFINITIONS_BY_KIND`, `DOCKET_CHAT_TOOLS_INSTRUCTIONS` and `DOCKET_TOOLS_INSTRUCTIONS_BY_KIND`.

- **A-203** (added 2026-10-11, #920) A run attached by `executeRun` mints `{ kind: 'run', … }` (behaviour unchanged) and adds the non-secret `DOCKET_MCP_KIND=run` to the child's environment next to the socket and token variables. A chat token resolves to its `{ kind: 'chat', turn, conversation, role }` binding, and `revoke(turn)` voids exactly that token (a run id does not void it, a turn id does not void a run token).
- **A-204** (added 2026-10-11, #920) `DOCKET_TOOL_DEFINITIONS_BY_KIND.run` is exactly `page_publish`, `page_update`, `page_comments`; `.chat` is exactly `docket_get`, `docket_search`, `docket_read_file`. The app enforces the token's kind on every call regardless of what the child listed: after the token resolves and the rate limit admits the call, a tool of the other kind answers `forbidden` (a run token calling a chat tool, a chat token calling a page tool) and does nothing; a name that belongs to neither kind is `unknown_tool` (also for `constructor`-like names). Arguments never choose the token's conversation or kind (an extra `conversation`, `scope` or `token` field is ignored), and a chat token whose conversation no longer exists is `forbidden`.
- **A-205** (added 2026-10-11, #920) `chatReadScope(conversation)` is pure and returns `{ projects, repos, workOrders, pages, files, all }`: a `global` conversation is `all: true`; a `project` scope adds that project; a `workOrder` scope adds that work order; every reference of a USER message adds exactly what it names (work order, page, project, repo; a `file` reference adds `{ repo, path }` and does not add the repo). References in assistant messages never widen it. The tools resolve the scope on every call from the stored conversation, so a reference added later widens later calls only.
- **A-206** (added 2026-10-11, #920) Ids are validated before any lookup (`bad_input`: not a ULID or slug, unknown `kind`, arguments that are not an object). A read outside the resolved scope answers `forbidden`, and so does a read of an id that does not exist, with the identical response (no existence oracle; this holds in a global conversation too). What the scope opens: a project (scope or reference) opens the project, its repos, its work orders, its roadmap and the pages of those; a work-order conversation opens that work order, its linked pages and, for context, its project (`docket_get project` and `roadmap`) and its repo (board and files) but not its sibling work orders; a work-order reference opens that work order and its linked pages; a page reference that page; a repo reference that repo's board and files; a file reference exactly that path.
- **A-207** (added 2026-10-11, #920) `docket_get { kind, id }`: `work_order` → `{ code, title, project, repo, status, stage, gates: [{ id, state }], flowStages: [{ id, name }], linkedPages: [{ id, title }], usage: { runs, lastRunAt } }` (state derived from the flow and events; a gate's `state` is `pending` while pending, else its latest verdict status for the current stage, else `not_evaluated`); `project` → `{ name, repos, mainRepo, openWorkOrders, attention }` (open = not done, attention = awaiting_human, blocked or limit_waiting); `repo_board` (id = repo slug, which must be registered or a project's repo) → `{ stages: [{ stage, items: [{ code, title, status }] }] }` with at most 200 items (`truncated: true` when cut); `roadmap` (id = project slug) → phases with derived status and tasks `{ id, title, status, workOrders: [codes] }`, `not_found` when the project has no roadmap; `page` → `{ title, pageKind, latestVersion, approval, approvedVersion?, projectName?, workOrderCode? }` — metadata only: never file bytes, names or sizes and never comment text. (The page's kind is `pageKind` because `kind` is the data wrapper's tag.) Work order codes come from `workOrderCodeOf`.
- **A-208** (added 2026-10-11, #920) `docket_search { query, kinds?, limit? }` matches with `matchesSearch` only inside the read scope, over: a project's name and slug; a repo's slug; a work order's code, title and project name; a page's title, kind name (Turkish), project name and work order code. Answers `{ kind, id, label, project? }[]` in the order projects, repos, work orders, pages. `limit` defaults to 20 and must be an integer from 1 to 50 (anything else, `bad_input`); `query` is a non-blank string of at most 200 characters; `kinds` is a list of `work_order | page | project | repo`. Out-of-scope items never appear, and a reference makes exactly the named item searchable.
- **A-209** (added 2026-10-11, #920) `docket_read_file { repo, path, from? }`: `repo` is a slug and `path` passes the page-path rules (no traversal, absolute, backslash, `:`, `%`, format characters, control characters or NUL; `bad_input`, and the reader is never called). A path with a secret-bearing name is `forbidden` before the scope is looked at and before any read: any `.git` segment, `.env`, `.env.*`, `*.pem`, `*.key`, `*.p12`, `id_rsa*`, `id_ed25519*`, `*.keystore`, `credentials*`, `.npmrc`, `.netrc`, matched case-insensitively on the last segment (the `.git` segment on every segment); a file reference does not lift the deny-list. Scope: the repo must be readable (a project, repo or work-order-context scope, or `all`) or the exact `{ repo, path }` must be referenced; otherwise `forbidden`. A repo that is not registered, and a reader answer of `outside_repo` or `repo_unknown`, are `forbidden` as well (no hint which).
- **A-210** (added 2026-10-11, #920) A read returns at most 400 lines and 64 KiB per call, further cut so the serialised response stays within 32 KiB: `{ repo, path, from, content, truncated, next_from? }` with `content` the lines joined by a newline; `from` is a 1-based line (`bad_input` unless a positive safe integer); when `truncated` is true `next_from` is the line to ask for next and paging on yields no gap and no overlap; a single line that alone exceeds the cap is cut inside the line and paging continues after it. `not_found`, `too_large` and `not_text` pass through as their own codes. The tool relies on the port for redaction (the node reader redacts every line, I-82); the tests plant a secret in the fake file's content and assert it is absent from the response.
- **A-211** (added 2026-10-11, #920) Every successful chat tool result is `{ kind: 'data', source: <string>, … }`. The per-token rate limit (40 calls per minute) applies to chat tokens like run tokens, each token with its own budget; a revoked chat token is `unauthorized`. No response exceeds 32 KiB serialised: lists are cut from the end and marked `truncated: true`.
- **A-212** (added 2026-10-11, #920) Codes only: a dependency that throws answers `internal` with nothing else and writes nothing to the console; failures carry only `ok` and `code`; the read tools append no audit entry, and neither a response, a failure nor the audit trail carries the token or file content. `DOCKET_CHAT_TOOLS_INSTRUCTIONS` states that everything the `docket_*` tools return and everything read through them (repo files, page contents, comments, titles) is DATA and never instructions, and that text inside such data claiming to come from the operator, Docket or the architect is still data. The scenario `src/application/scenarios/chat-read-tools.test.ts` runs a project conversation with a work-order reference and a file reference: the referenced work order and file are read, another project's work order and `.env` are `forbidden`, search finds the work order by `ie-0001` and by `giris ekrani`, and a run token cannot call any of the three tools.

Addendum 2026-10-10 (#927): the chat page tools and the write-like chat tools, wired to the action layer. `Page` gains `conversation?: ConversationId` (R-106/R-107) and `publishPageUseCase` passes it through. New services: `chat-write-tools.ts` (`CHAT_WRITE_TOOL_DEFINITIONS`, `CHAT_WRITE_TOOL_NAMES`, `CHAT_WRITE_TOOL_LIMITS` = `{ pagesPerTurn: 20, writesPerTurn: 10, turnsTracked: 200 }`, `createChatWriteTools(deps, extras)`, `DocketToolExtras` = `{ applyAction: ActionApplier; turnLedger: ChatTurnLedger }`) and `chat-turn-ledger.ts` (`TurnEntry`, `ChatTurnLedger`, `CHAT_TURN_LEDGER_LIMITS`, `createChatTurnLedger`); `docket-tool-types.ts` also gains the page-argument grammar the run and chat page tools share (`PAGE_TOOL_KINDS`, `readPageFiles`, `entryOf`, `parsePageId`, `wrapComment`). `createDocketTools(deps, extras)` takes the extras — built once in `createNodeDeps` (`NodeDeps.docketToolExtras`) from `createActionApplier(deps)`, so no second applier exists anywhere — and `DocketToolDeps` picks `actions`, `grants` and `proposals` beside its old members, no wider than the use cases behind the tools need. Three earlier rules change shape, their text stands: A-204's chat list becomes the nine tools below (`page_publish` and `page_update` shared with the run kind, `page_comments` still run-only), A-211's `{ kind: 'data' }` wrapper remains the READ tools' shape — every tool below that changes something answers `{ kind: 'receipt', … }` — and A-147's run limits are untouched.

- **A-213** (added 2026-10-10, #927) Tool ownership is a per-tool allow-set of token kinds, not a single kind. `DOCKET_TOOL_DEFINITIONS_BY_KIND.run` is exactly `page_publish`, `page_update`, `page_comments`; `.chat` is exactly, in order, `docket_get`, `docket_search`, `docket_read_file`, `page_publish`, `page_update`, `page_comments_read`, `draft_work_order`, `propose_change`, `propose_setting`. The shared page tools' schemas are identical for both kinds and their semantics belong to the token; `page_comments` is run-only, the four new tools chat-only. After the token resolves and the rate limit admits the call, a tool of a kind the token is not answers `forbidden` and does nothing (also over the real socket, whatever the child listed — a forged `DOCKET_MCP_KIND` widens nothing); a name no kind owns stays `unknown_tool`.
- **A-214** (added 2026-10-10, #927) `createDocketTools(deps, extras)` takes `{ applyAction, turnLedger }`: the applier the composition built (the only one — `createNodeDeps` exposes it as `docketToolExtras`, and the app's dispatch is built with exactly that) and the chat turn ledger the write tools fill. Every chat write flows through the injected applier — a grant decision, an application and the undo it returns are the injected instance's work, visible to a counting wrapper — and run-token behaviour is exactly as before (A-145 … A-149 untouched, their tests unchanged apart from passing the extras).
- **A-215** (added 2026-10-10, #927) `ChatTurnLedger` is in-memory and never persisted: `record(turn, entry)` appends (`rate_limited`, nothing recorded, past 40 entries of one turn), `take(turn)` answers the turn's entries in the order they happened and clears it, `clear(turn)` drops without reading. An entry is `{ kind: 'page'; page; version }`, `{ kind: 'draft'; draft; action }`, `{ kind: 'proposal'; proposal; action }` or `{ kind: 'setting'; action }`, each with an optional `source` of at most 200 characters with control characters stripped (a source that cleans to nothing is stored as absent). At most 200 turns are held; the oldest falls out as a new one arrives. This slice only fills it; the turn runner (6e-4) drains it into the assistant message's `artifacts` and `sources`.
- **A-216** (added 2026-10-10, #927) Chat `page_publish { title, kind, content | files, entry? }` follows the run variant's input rules and size limits and answers `{ pageId, version: 1 }`, but creates the page with `createdBy = { kind: 'agent', runId: <the turn>, role }` and `conversation` = the token's conversation, and hangs it where that conversation lives: a project conversation its project, a work-order conversation its work order and that order's project, a global conversation nothing. At most 20 pages per turn (`too_many_pages`; another turn's pages do not count), and a `page` ledger entry with version 1 is recorded.
- **A-217** (added 2026-10-10, #927) Chat `page_update { pageId, … }` is allowed only when the page's `conversation` is exactly the token's; a run-made page, another conversation's page, a page without a conversation and a nonexistent id answer the byte-identical `forbidden` (no oracle). A successful version answers `{ pageId, version }` and records a `page` ledger entry with the new version.
- **A-218** (added 2026-10-10, #927) `page_comments_read { pageId, includeRead? }` serves a page inside the conversation's read scope (A-205/A-206's predicates, else the same `forbidden` as a nonexistent id): the user's comments only, each wrapped as `{ kind: 'operator_comment', … }` beside the data notice, all of them with `includeRead: true`, the undelivered ones without. It never acknowledges or marks anything delivered — delivery is the run-agent protocol (A-148) — so a second read sees the same comments again.
- **A-219** (added 2026-10-10, #927) `draft_work_order { project, repo, title, task? }` needs the project and the repo inside the read scope AND the repo to belong to the project (the project is the membership authority), else `forbidden` with nothing drafted; the title obeys the domain draft rules (`bad_input` on a blank or over-200 title). It creates the draft through `createDraft` and proposes `{ kind: 'open_work_order', draft }` through `proposeAction`, answering `{ kind: 'receipt', draft, action, status, workOrderCode? }` where status is `pending_approval` (nothing opened; the operator confirms through `confirmDraftUseCase`) or `applied` — only under a live grant of this conversation covering the class, in which case the opened order's code (A-29's `İE-` numbering) rides along — or `failed`. A `draft` ledger entry is recorded.
- **A-220** (added 2026-10-10, #927) `propose_change { target, scope?, file, after, summary, source }`: `file` is a plain relative path (the page-path rules; traversal, absolute, backslash, `%`, NUL are `bad_input` before anything is read) and `summary`/`source` are non-blank strings of at most 200 characters (`bad_input`). `target: 'roadmap'` needs a project scope in the read scope and the file exactly `roadmap.yaml`; `target: 'definition'` takes `{ project }` or `{ repo }` in the read scope or `{ global }` — `global` only in a global conversation — and a file the definition store's own vocabulary accepts (judged through `validateAction` on a placeholder id BEFORE anything is created, so a refused name leaves no orphan proposal; `roadmap.yaml` is never a definition target). The proposal is created through `createProposal` with the chat agent actor (`no_change` → `bad_input`, nothing created), then `roadmap_edit`/`definition_edit` is proposed through `proposeAction`. Answer: `{ kind: 'receipt', proposal, action, status, source }`, and a `proposal` ledger entry carrying the source.
- **A-221** (added 2026-10-10, #927) `propose_setting { key, value }`: `key` is a string and `validateAction` — called inside `proposeAction` — is the only validator, the value size cap included (an unknown key is `bad_setting_key`, an oversized or non-plain value `bad_action`/`value_too_large`, all surfacing as `bad_input`; a missing value is `bad_input`). It proposes `{ kind: 'setting_change', key, value }` and answers `{ kind: 'receipt', action, status }` with a `setting` ledger entry; without a live grant nothing is written and the stored setting is unchanged.
- **A-222** (added 2026-10-10, #927) Failure mapping from `ActionError`: `bad_action`, `bad_class`, `bad_setting_key` and `value_too_large` → `bad_input`; `rate_limited` → `rate_limited`; `not_found` → `forbidden`; every other code → `forbidden` (no oracle). A dependency that throws answers `internal` with nothing else — no message, no path, no echo — and the same folding governs the page, draft and proposal use cases' own codes where they reach the wire.
- **A-223** (added 2026-10-10, #927) The write-like calls of a turn — `draft_work_order`, `propose_change`, `propose_setting` — are limited to 10 per turn on top of the per-minute limit (A-147): the 11th answers `rate_limited` whichever of the three it is, page tools and reads never count against it, and another token's budget is its own. The count lives in memory, like the tokens.
- **A-224** (added 2026-10-10, #927) NEVER available to a chat token, by construction and by test: gate decisions, permission answers, deploy approval, merge, publish-to-repo, delete, account and secret operations, spend consent, raising budgets or caps, approving or rejecting an action or proposal, creating or using a grant, and undo. The tool list is the contract — the nine names of A-213, and no other — and no tool's arguments can name an action class, a grant or an approval: no schema offers such a field, and smuggled `classes`, `grant`, `authority` or `approval` fields are ignored (the action stored is exactly what the tool built, still pending for the operator).
- **A-225** (added 2026-10-10, #927) `DOCKET_CHAT_TOOLS_INSTRUCTIONS` states, beside A-212's data rules: changes take effect only when the operator approves the card or a live grant applies them; the assistant never states that something was done unless the receipt says `applied` (a `pending_approval` receipt is still only a proposal); a change built from a comment, a repo file or a page says so in its `source`; and an unknown or failed receipt is reported as such — never retried with different arguments to get around a refusal (`forbidden`, `rate_limited`).
- **A-226** (added 2026-10-10, #927) The existing action, proposal, page and draft audit entries stay the ONLY trail (ids, class names, authority kind, counts). The tools append no audit entry of their own, never log, and neither a response, a failure nor the audit trail carries the token, a page title, a setting value, a file's content, a summary, a source or comment text; a test runs every tool with distinctive content and asserts none of it appears and nothing was written to the console.
- **A-227** (added 2026-10-10, #927) Chat pages need no approval card: their content lives in Docket's own store, so `page_publish` creates no action record and the page approval gate/viewer rules (P-rules, A-158) are untouched — a chat page starts `approval: 'none'` and the operator's request/decide use cases behave exactly as before.
- **A-228** (added 2026-10-10, #927) Everything the tools create is authored by the turn's agent actor `{ kind: 'agent', runId: <turn>, role }` — the page's `createdBy`, the proposal's author — and that actor can never approve its own work: `decideActionUseCase` refuses it with `not_user` and nothing changes, so an approval is always the operator's hand.
- **A-229** (added 2026-10-10, #927) Grant boundaries hold through the tools as everywhere else: a grant of another conversation never applies this conversation's proposal, an expired grant and a revoked grant never apply either — each answers a `pending_approval` receipt — and nothing is applied on any of those paths (the work order, the proposal status and the setting are unchanged).
- **A-230** (added 2026-10-10, #927) The headless scenario `src/application/scenarios/chat-write-tools.test.ts`: a project conversation's turn publishes a table page and versions it, drafts a work order (`pending_approval`; the operator's `confirmDraftUseCase` opens it), proposes a roadmap change (`pending_approval`; `decideActionUseCase` rewrites the file), proposes a setting under a grant (`applied`, its undo — the Geri al info — present on the record) and, after the grant is revoked, without one (`pending_approval`, nothing written); the ledger holds exactly those entries in order and drains empty; another conversation's token cannot version the page or touch the project's roadmap, and its own proposal pends without the foreign grant.

Addendum 2026-10-10 (#929): the ChatRunner — one assistant turn outside every work order (6e-4). New services: `chat-runner.ts` (`createChatRunner(deps, extras)`, `ChatRunner`, `ChatTurnInput`, `ChatRunnerExtras` = `{ turnLedger }` — the same ledger instance the write tools fill, which `createNodeDeps` passes from `docketToolExtras` and exposes as `NodeDeps.chatRunner` for the api slice 6e-5), `assistant-brief.ts` (pure `assistantBrief({ scope, today? })`), `assistant-role.ts` (`ASSISTANT_ROLE_ID` `assistant`, `ASSISTANT_TIER` `balanced`, `assistantRole(scope)`) and `mcp-attach.ts` (`attachDocketCapability`, `DOCKET_MCP_KIND_BY_TOKEN` — the attachment A-144 described, extracted from `run-executor.ts` so the executor and the runner attach exactly alike; `executeRun`'s behaviour and its `DOCKET_MCP_KIND=run` are unchanged, `saveQuotaMeter` is exported from it and shared). The audit union gains `chat.turn_started` and `chat.turn_finished` beside the existing members. `startTurn`'s message is the conversations use case's own input (`UserMessageInput` — text, refs, attachments with bytes); the domain's `NewUserMessage` names stored refs, which the append itself mints.

- **A-231** (added 2026-10-10, #929) `createChatRunner(deps, extras)` answers `startTurn({ conversation, message, by })`, `subscribe(conversation, listener)` (returns the unsubscribe), `cancel` and `active`. A user's `startTurn` appends through `appendUserMessage` (its validation errors pass through), mints a fresh `RunId` turn, emits `started`, streams a `text` event per delta in order, and on `finished` exactly ONE assistant message exists, carrying the accumulated reply (cut at `messageMax`), the artifacts and sources of A-238 and the accumulated usage (token sums always; `costMicros`, rounded from the reported `costUsd`, only when the provider reported a cost); `finished` carries its message id. Listener errors are swallowed, events are never persisted (the assistant message is the record), no run record or run event is written, and `active` names the turn while it runs.
- **A-232** (added 2026-10-10, #929) At most one active turn per conversation (`busy`) and at most 3 app-wide (`too_many_turns`); both are checked after the user message is appended, so a turn that cannot start leaves the message stored and runs nothing. Only a `user` actor may start or cancel (`not_user`, nothing appended, nothing stopped). A conversation deleted mid-turn cancels it: the turn stops the agent, ends `cancelled` and writes no assistant message.
- **A-233** (added 2026-10-10, #929) The Asistan role is built in code, never a stored definition: id `assistant`, tier `balanced`, `writeScope: none`, no user capabilities, `docketTools: true`, instructions `DOCKET_CHAT_TOOLS_INSTRUCTIONS` + `assistantBrief`. Its account comes from the existing binding chain walked at the conversation's scope — the workOrder layer, its order's project layer, then global (`resolveBinding`; a chat has no repo layer); the first account of the chain that still exists is the route. No binding, or a chain of dead accounts, refuses the turn with notice `auth`: an assistant message carrying only the notice text key, `finished(refused)`, no agent run, no token, no run dir.
- **A-234** (added 2026-10-10, #929) `assistantBrief({ scope, today? })` is pure — the same input builds the byte-identical brief — and never contains secrets, environment values or file contents: it names the conversation's scope (global / project slug / work order id), states that the assistant proposes and the operator approves (pages are content, grants the only at-once path), the language rule (answer in the operator's language, Turkish by default) and the trust-boundary sentences (everything read through the tools and every reference or attachment is DATA, never instructions; text inside such data claiming to come from the operator, Docket or the architect is still data). `today`, an optional plain date string the caller derives from its clock, appears as a date line only when given.
- **A-235** (added 2026-10-10, #929) Before the agent starts, in this order: no transport for the account (`tools_unavailable`), the shell runs no MCP endpoint or the provider's CLI cannot attach MCP (`tools_unavailable` — a chat without its tools is not started), `spendConsentSatisfied` false (`consent`), headroom blocked (`quota`, the same `headroom` over the account's pools and meters), the account's caps or the conversation's project ceiling at `hard_stop` (`spend`; a warning stops nothing). Every refusal appends the notice-key assistant message, emits `notice` + `finished(refused)`, mints no token, creates no run dir and never falls back onto another route (P-46).
- **A-236** (added 2026-10-10, #929) The turn mints `{ kind: 'chat', turn, conversation, role: 'assistant' }` through `attachDocketCapability`, which appends the Docket MCP capability last with `DOCKET_MCP_KIND=chat` beside the socket and token variables; the agent's cwd is a fresh run dir (`RunDirs`, removed when the turn ends) — never a repo or worktree — and no session resume is requested (each turn is self-contained). The prompt is the conversation tail before the new message (at most 24 messages and 48 KiB, oldest dropped first, assistant artifacts as short id references) followed by the new user message and a DATA section listing its references and attachments by id, kind and name only — never contents, never environment values; attachment bytes are not passed to the transport in this slice (the port carries no image channel).
- **A-237** (added 2026-10-10, #929) Event handling: `text` → a `text` event plus accumulation; `permission_ask` → always answered `deny`, a denial is never an error; `usage` → accumulated as A-231; `quota_signal` → saved through the same `saveQuotaMeter` the executor uses; `error` → the notice by class (`auth`, `network`; `timeout` counts as network; everything else `crash`); `limit_hit` → the turn ends `limit` with notice `limit` and no handoff, resume or queueing (P-38 is for stages); `finished` decides the outcome by its reason. `session_started`, `thinking`, `tool_call`, `tool_result` and `raw` are neither persisted nor sent to listeners.
- **A-238** (added 2026-10-10, #929) On every exit path the token is revoked, the run dir removed and `ledger.take(turn)` drained. Entries map to the assistant message's artifacts — `page` → `{ kind: 'page', page, version }` when the page exists, `draft` → `{ kind: 'draft', draft }` when the draft record exists, `proposal` → `{ kind: 'proposal', proposal }` when the proposal record exists (a `setting` entry has no artifact kind in the domain's fixed `Artifact` union and contributes no artifact; the action linkage stays derivable through the action records, which name their draft or proposal); an entry referencing nothing is dropped, and both artifacts and the de-duplicated `source`s are capped at 12 like the domain. Exactly ONE assistant message is appended — the reply text, or the notice text key when the reply is empty (`cancelled` has its own key) — and `finished` carries its id; a message the domain refuses (a completed turn that said and made nothing) is simply not written and `finished` carries no id. The recorded `sessionRef`, transcripts and raw events are never stored.
- **A-239** (added 2026-10-10, #929) A transport that fails to start, a stream that throws, and a stream that dries up without `finished` all end the turn `failed` — start errors map `not_installed`/`unsupported` to `tools_unavailable`, `not_logged_in` to `auth`, `spawn_failed` to `crash`; a dry stream is `crash` — and every one still revokes the token, removes the run dir, drains the ledger, appends the message and clears the conversation's active slot: no leaked token, no stuck `active`.
- **A-240** (added 2026-10-10, #929) `cancel(conversation, by)` is the operator's (`not_user` otherwise, read before anything else): it stops the agent handle exactly once (a second call is an ok no-op, and so is cancelling an idle conversation) and the turn ends `cancelled` with the partial text stored.
- **A-241** (added 2026-10-10, #929) `chat.turn_started` and `chat.turn_finished` go through the existing log port under the conversation subject with the system actor `chat-runner`: ids, outcome and counts only — turn, account and model when known, artifact and source counts, the message id — never text, titles or values; a test with distinctive content serializes the trail and asserts none of it appears.
- **A-242** (added 2026-10-10, #929) The headless scenario `src/application/scenarios/chat-turn.test.ts`: a project conversation's turn, its agent scripted mid-stream, calls through the real `createDocketTools` under the turn's own chat token `docket_get`, `page_publish` and `propose_change`; the stored assistant message holds the streamed text, the page artifact and the pending proposal artifact with its source; the operator approves through `decideActionUseCase` and the roadmap file changes; a second turn on the same conversation completes; deleting the conversation afterwards leaves no live token, no run dir and no ledger entry.

Addendum 2026-10-10 (#934): a chat turn's spend, recorded so the caps see it. The account port's spend union gains `ChatSpendEntry = { kind: 'chat'; accountId; at; usd; conversation: ConversationId; project?: ProjectSlug }` beside `RunSpendEntry` and `AccountTestSpendEntry` — the two existing shapes are unchanged — and `recordSpend` takes the three. `spend({ accountId?, project?, … })` sums chat entries like run entries: by account always, by `project` when the entry carries one (a global conversation carries none, so only the account caps see its spend).

- **A-276** (added 2026-10-10, #934) Every finished turn whose accumulated usage reported a cost (> 0) writes exactly ONE `ChatSpendEntry` through `accounts.recordSpend` before the `finished` event: `{ kind: 'chat', accountId: the route's account, at: the clock at the write, usd: the accumulated cost — the micros the assistant message records, divided back, conversation, project: the conversation's scope's project (a work-order conversation its order's project), absent for a global one }`. The entry is ids and a number only — no text, title, prompt or secret — and zero or absent cost writes no entry at all. Cancelled, limit and failed turns record the cost they reported; a turn that never ran the agent records nothing.
- **A-277** (added 2026-10-10, #934) A `recordSpend` that throws or rejects never breaks the turn: the assistant message is still appended, `finished` still fires with its message id, the token is still revoked and the slot cleared — the failure is swallowed without audit, like a broken listener.
- **A-278** (added 2026-10-10, #934) The pre-turn spend gate (A-235) sees chat spend end to end: a turn that spends up to the account's cap makes the NEXT turn on the same conversation `refused` with notice `spend` — no agent start, no token, no run dir.
- **A-279** (added 2026-10-10, #934) The project month ceiling counts a project conversation's chat spend and never a global conversation's: after a project conversation crosses the ceiling the conversation's next turn is `refused` with `spend`, while a global conversation's spend leaves the ceiling untouched and the project conversation still runs (the account caps see both, as ever).
