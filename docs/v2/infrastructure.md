# Infrastructure — contracts for Phase 2b

This is the authoritative contract for `src/infrastructure/`. As with [domain.md](domain.md) and
[application.md](application.md): types and signatures are **exact**; implementers may add private
helpers but must not rename, reshape or drop anything below. If a contract cannot work as written,
stop and comment on the issue.

Infrastructure **implements the ports** of [application.md §1](application.md#1-ports--srcapplicationports)
against the real machine: SQLite, files, git, processes, the OS keychain, an agent SDK. It decides
nothing about the business; if an adapter starts to decide something, that is a missing domain or
application rule.

General rules for `src/infrastructure/`:

- May import the domain (only through `src/domain/index.ts`), the application (`src/application/index.ts`;
  tests may also import `src/application/ports/fakes/index.ts`), npm packages and Node builtins.
  Never `electron`: Electron objects (safeStorage, Notification) are **injected** by `electron/main.ts`,
  so every adapter runs under plain Node and vitest.
- Only these npm packages: `yaml` (definition store) and `@anthropic-ai/claude-agent-sdk` (SDK transport).
  SQLite is the built-in `node:sqlite` (Node ≥ 22.5; Electron 43 ships Node 24.18, verified).
- Agent-vendor names only under `src/infrastructure/providers/`.
- Expected failures return `Result` where the port says so; a broken environment or a programming
  error throws an `Error` whose message never contains a secret or an environment value.
- Adapters are created by `create…(config)` factory functions returning the port object. No module-level
  mutable state; per-instance state lives in the factory's closure.
- Tests sit next to the code and use real resources in temporary places: `':memory:'` or a file under
  `os.tmpdir()` for SQLite, `fs.mkdtemp` folders, throw-away git repos made with `git init`. No test
  touches the user's home, the network, or a real agent CLI. Rules are named **I-n**; each needs a
  test titled `I-n: …` in `src/infrastructure/**/*.test.ts`.
- Test fixtures that look like credentials are **assembled at runtime** (`'AKIA' + 'X'.repeat(16)`), never
  written as one literal — GitHub push protection rejects literal tokens.

## Module map (`src/infrastructure/`)

Each module has an `index.ts`; other modules import it only through that file.

| Module | Files | May import (infrastructure modules) |
| --- | --- | --- |
| `system/` | `clock.ts` · `ulid.ts` · `workspace-paths.ts` | — |
| `storage/sqlite/` | `database.ts` · `schema.ts` · one file per repository · `workspace-registry.ts` | `system` |
| `storage/keychain/` | `vault.ts` | `system`, `storage/sqlite` |
| `storage/definitions-yaml/` | `targets.ts` · `store.ts` | `system` |
| `vcs/` | `git.ts` · `worktrees.ts` · `evidence.ts` | `system` |
| `gates/` | `secret-patterns.ts` · `secret-scanner.ts` · `command-runner.ts` | `system`, `vcs` |
| `providers/` | `transports/sdk/{map-message.ts, transport.ts}` | `system` |
| `compose/` | `create-node-deps.ts` | every module above |
| `scenarios/` | `*.test.ts` only | every module above |

`src/infrastructure/index.ts` is the layer barrel: it re-exports every module's `index.ts`
(`scenarios/` excluded). `electron/main.ts` (Phase 4) imports only this barrel.

---

## 1. System — `system/`

```ts
// clock.ts
export function createSystemClock(): Clock;                 // now() = Date.now()

// ulid.ts
export type RandomBytes = (length: number) => Uint8Array;
/** `random` defaults to node:crypto randomBytes. */
export function createUlidGen(clock: Clock, random?: RandomBytes): IdGen;
/** 48-bit time + 80-bit randomness → 26 Crockford base32 chars. */
export function encodeUlid(timeMs: number, random: Uint8Array): string;

// workspace-paths.ts — the one thing path-based adapters need from the workspace registry
export interface WorkspacePaths { path(slug: WorkspaceSlug): Promise<string | undefined> }
```

Rules:
- **I-1** `encodeUlid`: 10 time chars (big-endian, Crockford alphabet `0123456789ABCDEFGHJKMNPQRSTVWXYZ`) then 16 randomness chars from exactly 10 bytes; the output passes the domain's `isUlid`. `encodeUlid(0, 10 zero bytes)` = `'0'.repeat(26)`; `encodeUlid(2 ** 48 - 1, 10 × 0xFF)` = `'7' + 'Z'.repeat(25)`. A time outside `0 … 2^48 − 1`, a non-integer time, or `random.length !== 10` throws.
- **I-2** `createUlidGen` is monotonic: when `clock.now()` is greater than the last used time, it draws 10 fresh bytes from `random`; otherwise (same millisecond or the clock went backwards) it keeps the last time and increments the 80-bit randomness by one. Ids are strictly increasing as strings (10 000 calls with a frozen clock; a clock that steps back). Overflow of the 80-bit part throws.

---

## 2. SQLite storage — `storage/sqlite/`

One database file, `<dataDir>/docket.db`. Every repository stores the full record as JSON in a
`data` column and keeps a few **index columns** derived from the record on every write.

```ts
// database.ts
import type { DatabaseSync } from 'node:sqlite';
export interface DocketDb {
  readonly raw: DatabaseSync;
  /** BEGIN IMMEDIATE … COMMIT; on a throw: ROLLBACK and rethrow. A nested call joins the outer transaction. */
  transaction<T>(fn: () => T): T;
  close(): void;
}
export type OpenDbError = { readonly code: 'too_new'; readonly found: number; readonly supported: number };
export function openDatabase(path: string): Result<DocketDb, OpenDbError>;   // ':memory:' allowed

// schema.ts
export interface Migration { readonly version: number; readonly sql: string }
export const MIGRATIONS: readonly Migration[];

// one factory per repository (each in its own file: work-order-repo.ts, run-repo.ts, …)
export function createSqliteWorkOrderRepo(db: DocketDb): WorkOrderRepo;
export function createSqliteRunRepo(db: DocketDb): RunRepo;
export function createSqliteEventLog(db: DocketDb): EventLog;
export function createSqliteAccountRepo(db: DocketDb): AccountRepo;
export function createSqliteBindingRepo(db: DocketDb): BindingRepo;
export function createSqliteQueueRepo(db: DocketDb): QueueRepo;
export function createSqliteProposalRepo(db: DocketDb): ProposalRepo;

// workspace-registry.ts — machine-local: which checkout holds which workspace
export interface WorkspaceRegistry extends WorkspacePaths {
  register(slug: WorkspaceSlug, path: string): Promise<void>;          // upsert; `path` absolute
  list(): Promise<readonly { readonly slug: WorkspaceSlug; readonly path: string }[]>;   // slug asc
  remove(slug: WorkspaceSlug): Promise<void>;
}
export function createSqliteWorkspaceRegistry(db: DocketDb): WorkspaceRegistry;
```

Migration 1 (`MIGRATIONS[0]`, exact):

```sql
CREATE TABLE work_orders (id TEXT PRIMARY KEY, workspace TEXT NOT NULL, created_at INTEGER NOT NULL, data TEXT NOT NULL);
CREATE INDEX work_orders_by_workspace ON work_orders (workspace, created_at, id);
CREATE TABLE work_order_events (work_order_id TEXT NOT NULL REFERENCES work_orders (id), seq INTEGER NOT NULL, data TEXT NOT NULL, PRIMARY KEY (work_order_id, seq));
CREATE TABLE runs (id TEXT PRIMARY KEY, work_order_id TEXT NOT NULL REFERENCES work_orders (id), started_at INTEGER NOT NULL, ended_at INTEGER, data TEXT NOT NULL);
CREATE INDEX runs_by_work_order ON runs (work_order_id, started_at, id);
CREATE INDEX runs_active ON runs (started_at, id) WHERE ended_at IS NULL;
CREATE TABLE run_events (run_id TEXT NOT NULL REFERENCES runs (id), seq INTEGER NOT NULL, data TEXT NOT NULL, PRIMARY KEY (run_id, seq));
CREATE TABLE audit (id TEXT PRIMARY KEY, at INTEGER NOT NULL, subject_kind TEXT NOT NULL, subject_key TEXT NOT NULL, data TEXT NOT NULL);
CREATE INDEX audit_by_subject ON audit (subject_kind, subject_key, at DESC, id DESC);
CREATE TABLE accounts (id TEXT PRIMARY KEY, data TEXT NOT NULL);
CREATE TABLE pools (id TEXT PRIMARY KEY, account_id TEXT NOT NULL, data TEXT NOT NULL);
CREATE INDEX pools_by_account ON pools (account_id);
CREATE TABLE meters (id TEXT PRIMARY KEY, pool_id TEXT NOT NULL, data TEXT NOT NULL);
CREATE INDEX meters_by_pool ON meters (pool_id);
CREATE TABLE spend (seq INTEGER PRIMARY KEY AUTOINCREMENT, account_id TEXT NOT NULL, workspace TEXT NOT NULL, work_order_id TEXT NOT NULL, at INTEGER NOT NULL, usd REAL NOT NULL);
CREATE INDEX spend_by_time ON spend (at);
CREATE TABLE bindings (level TEXT NOT NULL, scope_key TEXT NOT NULL, role TEXT NOT NULL, data TEXT NOT NULL, PRIMARY KEY (level, scope_key, role));
CREATE TABLE queue_items (id TEXT PRIMARY KEY, data TEXT NOT NULL);
CREATE TABLE proposals (id TEXT PRIMARY KEY, status TEXT NOT NULL, data TEXT NOT NULL);
CREATE TABLE secrets (ref TEXT PRIMARY KEY, blob BLOB NOT NULL);
CREATE TABLE workspaces (slug TEXT PRIMARY KEY, path TEXT NOT NULL);
```

Key columns: `audit.subject_key` = the subject's `id` (or `role` for `binding`); `bindings.scope_key` =
`''` for `global`, the workspace slug, or the work-order id. Ordering where a port promises none:
`queue_items` by `id` asc, `proposals` by `id` asc.

Rules:
- **I-3** `openDatabase`: creates the parent folder of a file path; sets `foreign_keys = ON`, `busy_timeout = 5000`, and for file databases `journal_mode = WAL` and `synchronous = NORMAL`; applies every migration whose `version` is greater than `PRAGMA user_version`, in order, each in one transaction that also sets `user_version`. Opening again is a no-op. A file whose `user_version` is greater than the last migration → `err({ code: 'too_new', found, supported })` and the handle is closed.
- **I-4** `transaction`: a throw inside `fn` rolls back every write made in it (including nested calls) and rethrows; a nested call does not open a second transaction.
- **I-5** **Parity with the fakes.** Each repository's test file runs the same behaviour cases against the port's in-memory fake and the SQLite implementation (`describe.each([['fake', …], ['sqlite', …]])`): ordering promises, upsert, `undefined` for a missing id, filters, `AccountRepo.remove` dropping the account's pools and meters but keeping spend, `spend` bounds `from ≤ at ≤ to`. A case where the fake and SQLite must differ is a bug in one of them — stop and comment, do not special-case.
- **I-6** A record read back deep-equals the record written: optional fields that were absent stay absent, `readonly` arrays keep their order, numbers stay numbers. Index columns are rewritten from the record on every update (e.g. `RunRepo.update` with `endedAt` removes the run from `listActive`).
- **I-7** `appendEvent` / `appendEvents` give each event `seq = previous max + 1` inside one transaction; `appendEvents` of N events stores all N or none; `events()` returns `seq` order. Appending to an unknown work order or run throws (foreign key).
- **I-8** Durability: everything written through the repositories and the registry is visible through a second `openDatabase` on the same file after the first handle is closed.

---

## 3. Keychain vault — `storage/keychain/`

```ts
// vault.ts
/** Supplied by electron/main.ts from Electron's safeStorage; tests pass a reversible test cipher. */
export interface CipherFns {
  isEncryptionAvailable(): boolean;
  encryptString(plain: string): Uint8Array;
  decryptString(blob: Uint8Array): string;
}
export function createKeychainVault(db: DocketDb, cipher: CipherFns): SecretVault;
```

Rules:
- **I-9** `put` stores `encryptString(value)` in `secrets` (upsert by ref); `get` returns `decryptString(blob)`, `undefined` for an unknown ref; `remove` is idempotent. The plaintext is never written: after `put`, the database file's bytes do not contain the value.
- **I-10** When `isEncryptionAvailable()` is false, `put` and `get` throw `Error('secret storage unavailable')` — never a plaintext fallback, and no error message contains the value or the ref's secret. (Phase 4 wiring: on Linux a `basic_text` safeStorage backend counts as unavailable.)

---

## 4. YAML definition store — `storage/definitions-yaml/`

Layout. Global root = `<dataDir>` (`~/.docket`); workspace root = `<workspace path>/.docket`.

```
<root>/roles/<slug>.yaml          one RoleDef per file        (global and workspace)
<root>/flows/<slug>.yaml          one FlowDef per file        (global and workspace)
<root>/capabilities/<slug>.yaml   one CapabilityDef per file  (global and workspace)
<root>/workspace.yaml             the WorkspaceDef            (workspace only)
<root>/roadmap.yaml               the Roadmap                 (workspace only)
```

```ts
// targets.ts
export type DefinitionKind = 'roles' | 'flows' | 'capabilities';
export type ParsedTarget =
  | { readonly kind: DefinitionKind; readonly id: string }
  | { readonly kind: 'workspace' }
  | { readonly kind: 'roadmap' };
export function parseTarget(scope: DefinitionScope, target: string): ParsedTarget | undefined;
export function hashContent(content: string): string;          // sha256 of the UTF-8 bytes, lowercase hex

// store.ts
export interface YamlStoreConfig { readonly globalRoot: string; readonly workspaces: WorkspacePaths }
export function createYamlDefinitionStore(config: YamlStoreConfig): DefinitionStore;
```

Every file is parsed with `yaml`'s `parse(text, { schema: 'core', uniqueKeys: true, maxAliasCount: 100 })`
(no custom tags) and must hold one mapping.

Rules:
- **I-11** `parseTarget` accepts exactly `roles|flows|capabilities/<slug>.yaml` (the stem passes the domain's `parseSlug`) in both scopes, and `workspace.yaml` / `roadmap.yaml` in the workspace scope only. Everything else → `undefined`: absolute paths, `..`, `./`, backslashes, other extensions, deeper folders, upper case.
- **I-12** `load(workspace)`: the workspace path comes from `WorkspacePaths` (unknown → `err([{ path: 'workspace', code: 'missing_field', … }])`, as does a missing `workspace.yaml`). Missing kind folders are empty; only `*.yaml` files that pass `parseTarget` are read, in file-name order. Merge per kind: global entries first; a workspace entry with the same `id` replaces the global one in its position; other workspace entries follow. The result is exactly `validateDefinitions({ roles, flows, capabilities, workspace })`.
- **I-13** File problems, collected for **every** file before validation: unparsable YAML or a non-mapping document → `{ path: '<global|workspace>:<target>', code: 'wrong_type', message: 'yaml: ' + first line of the parser message }`; a `roles/flows/capabilities` file whose `id` differs from its file stem → `{ path: same, code: 'invalid_slug', message: 'id does not match file name' }`. If any exist, `load` returns all of them and does not call `validateDefinitions`.
- **I-14** `loadRoadmap`: unknown workspace or no `roadmap.yaml` → `undefined`; otherwise `validateRoadmap(parsed)`, with a parse failure reported as a `RoadmapIssue` `{ path: 'roadmap.yaml', code: 'wrong_type', … }`.
- **I-15** `readFile`: an invalid target, an unknown workspace or a missing file → `undefined`; otherwise `{ content, hash: hashContent(content) }`.
- **I-16** `writeFile`: an invalid target or an unknown workspace throws (the application validates first — A-12). The current hash (`''` when the file is absent) must equal `expectedHash`, else `err('stale')` and nothing changes. The write goes to a temporary file in the same folder and is renamed over the target (folders created as needed); writes to the same file are serialized inside the process, so of two writers with the same `expectedHash` exactly one succeeds. Returns the new hash.
- **I-17** `validateCandidate` writes nothing (the folder listing and every file are unchanged afterwards). An invalid target → `err([{ path: target, code: 'wrong_type', message: 'not a definition file' }])`. Otherwise the candidate content replaces (or adds) the target in memory and the same pipeline as I-12/I-13 runs — workspace scope: that workspace's merged definitions; global scope: the global files alone, validated as `validateDefinitions({ roles, flows, capabilities })`. A `roadmap.yaml` target runs `validateRoadmap` and maps each issue to `{ path: 'roadmap.' + i.path, code: 'wrong_type', message: i.code + ': ' + i.message }`.
- **I-18** `workspacePath` returns `WorkspacePaths.path(workspace)`.

---

## 5. Git, worktrees, evidence — `vcs/`

```ts
// git.ts
export interface GitResult { readonly exitCode: number; readonly stdout: string; readonly stderr: string }
export function runGit(cwd: string, args: readonly string[], options?: { readonly timeoutMs?: number }): Promise<GitResult>;

// worktrees.ts
export interface WorktreesConfig { readonly root: string; readonly workspaces: WorkspacePaths }   // root = <dataDir>/worktrees
export function createWorktrees(config: WorktreesConfig): Worktrees;
export function worktreeBranch(id: WorkOrderId): string;      // 'docket/wo-' + id.toLowerCase()
export const BASE_REF_PREFIX = 'refs/docket/bases/';          // + work-order id → the commit the worktree started from

// evidence.ts
export function createEvidenceChecker(): EvidenceChecker;
```

Rules:
- **I-19** `runGit` spawns `git` directly (no shell) with an environment of only `PATH`, `HOME` (plus `SystemRoot` on Windows) from `process.env` and `LC_ALL=C`, `GIT_TERMINAL_PROMPT=0`; default timeout 60 s (then the process is killed and `exitCode` is 124). A non-zero exit is a result, not a throw; `git` missing → `exitCode: 127`.
- **I-20** `ensure(workspace, id)`: unknown workspace, a path that is not a git work tree, or a repository without commits → `err('no_repo')`. The worktree path is `<root>/<workspace>/<id>`. If `git worktree list --porcelain` already lists it → `ok({ path })` and nothing changes. Otherwise: base = `git rev-parse HEAD` of the workspace checkout; `git worktree add -b <worktreeBranch(id)> <path> <base>` (or without `-b` when the branch already exists); `git update-ref <BASE_REF_PREFIX><id> <base>` unless that ref exists. Concurrent calls for the same id share one creation. The workspace checkout's working tree and current branch are never changed.
- **I-21** `resolvePointers(cwd, pointers)`: every pointer is `<path>:<line>` or `<path>:<start>-<end>` (1-based, `start ≤ end`); the path is relative and, after resolving symlinks, stays inside `cwd`; the file exists and has at least `end` lines. Any malformed, escaping or missing pointer → `false`; an empty list → `false`.

---

## 6. Gates — `gates/`

```ts
// secret-patterns.ts
export interface SecretPattern { readonly id: string; readonly regex: RegExp }
export const SECRET_PATTERNS: readonly SecretPattern[];
export const ALLOW_MARKER = 'docket:allow-secret';
export interface SecretFinding { readonly line: number; readonly pattern: string }   // 1-based line, pattern id — never the match
export function findSecrets(text: string): readonly SecretFinding[];
export function redactSecrets(text: string): string;           // each match → '[redacted]'

// secret-scanner.ts
export function createSecretScanner(): SecretScanner;

// command-runner.ts
export interface CommandRunnerConfig {
  readonly env: Readonly<Record<string, string>>;   // the complete child environment (built by the composition root)
  readonly tailBytes?: number;                        // default 8192
}
export function createCommandRunner(config: CommandRunnerConfig): CommandRunner;
```

`SECRET_PATTERNS` (exact ids and expressions; all global, case-sensitive unless marked):

| id | regex |
| --- | --- |
| `private-key` | `-----BEGIN [A-Z ]*PRIVATE KEY-----` |
| `aws-access-key` | `\b(?:AKIA\|ASIA)[0-9A-Z]{16}\b` |
| `github-token` | `\bgh[pousr]_[A-Za-z0-9]{36,}\b` |
| `github-fine-grained` | `\bgithub_pat_[A-Za-z0-9_]{60,}\b` |
| `sk-key` | `\bsk-[A-Za-z0-9_-]{32,}` |
| `slack-token` | `\bxox[abprs]-[A-Za-z0-9-]{10,}` |
| `google-api-key` | `\bAIza[0-9A-Za-z_-]{35}\b` |
| `stripe-live` | `\b[rs]k_live_[0-9A-Za-z]{24,}\b` |
| `assigned-secret` | `(?:api[_-]?key\|secret\|token\|password)["']?\s*[:=]\s*["'][^"'\s]{16,}["']` (case-insensitive) |

Rules:
- **I-22** `findSecrets` checks every line against every pattern; a line containing `ALLOW_MARKER` is skipped; one finding per (line, pattern). Each pattern has a matching and a non-matching test. `redactSecrets` replaces every match (allow-marked lines too) with `[redacted]`.
- **I-23** `scan(cwd)` scans only what the work order changed when `cwd` is a Docket worktree — the current branch is `docket/wo-<id>` and `refs/docket/bases/<ID>` exists: files from `git diff --name-only --diff-filter=ACMR <base>` plus untracked files from `git ls-files --others --exclude-standard`. Any other `cwd` → every file from `git ls-files --cached --others --exclude-standard`. Files over 1 MiB or with a NUL byte in their first 8 KiB are skipped. `findings` = total `SecretFinding`s. Not a git work tree → throws.
- **I-24** `run(cwd, command, timeoutMs)` runs `command` through `/bin/sh -c` (Windows: `cmd.exe /d /s /c`) in `cwd` with **exactly** `config.env` — nothing inherited from `process.env` — in its own process group.
- **I-25** Timeout: SIGTERM to the process group, SIGKILL 5 s later if still alive; `exitCode` 124. A failure to spawn (e.g. missing `cwd`) → `exitCode` 127 and `outputTail` `'spawn failed: ' + <error code>`. `durationMs` is a whole number.
- **I-26** `outputTail`: stdout and stderr interleaved in arrival order; the last `tailBytes` bytes, cut on a UTF-8 character boundary; then every value of `config.env` that is at least 8 characters long is replaced with `[env]`, then `redactSecrets` runs.

---

## 7. Claude SDK transport — `providers/transports/sdk/`

The first `AgentTransport`, built on `@anthropic-ai/claude-agent-sdk` (already a dependency, pinned).
Written from the SDK's own type definitions and documentation. Discovery, other transports and the
`TransportResolver` are Phase 3; Phase 2b tests inject a fake `query`.

```ts
// map-message.ts
import type { SDKMessage } from '@anthropic-ai/claude-agent-sdk';
export interface MapContext { readonly costKind: CostKind }
/** Pure: one SDK message → zero or more AgentEvents, all stamped `at`. */
export function mapSdkMessage(message: SDKMessage, at: EpochMs, context: MapContext): readonly AgentEvent[];
export function toolTarget(input: Readonly<Record<string, unknown>>): string | undefined;

// transport.ts
import type { query } from '@anthropic-ai/claude-agent-sdk';
export type QueryFn = typeof query;
export interface SdkTransportConfig {
  readonly clock: Clock;
  readonly accounts: Pick<AccountRepo, 'get'>;
  readonly secrets: Pick<SecretVault, 'get'>;
  readonly baseEnv: Readonly<Record<string, string>>;   // allowlisted environment from the composition root
  readonly query?: QueryFn;                               // default: the SDK's query
  readonly executablePath?: string;                       // from discovery (Phase 3); SDK default when absent
}
export function createSdkTransport(config: SdkTransportConfig): AgentTransport;
```

Rules:
- **I-27** Mapping (`mapSdkMessage`): `system`/`init` → `session_started { sessionRef: session_id }`; `assistant` content blocks in order: `text` → `text`, `thinking` → `thinking`, `tool_use` → `tool_call { id, name, target: toolTarget(input) }`; `user` `tool_result` blocks → `tool_result { id: tool_use_id, ok: !is_error }`; `result` → `usage { inputTokens, outputTokens, cachedInputTokens: cache_read_input_tokens, costUsd: total_cost_usd, costKind: context.costKind }` then `finished { reason: subtype === 'success' ? 'completed' : 'failed' }`; `rate_limit_event` → `quota_signal` with `meter { label: rateLimitType, poolLabel: rateLimitType, cadence: 'fixed', unit: 'fraction', used: utilization, resetsAt: resetsAt × 1000, resetPrecision: 'exact', observedAt: at, source: 'pushed' }` (fields absent in the message stay absent), and when `status === 'rejected'` also `limit_hit { class: 'window_exhausted', resetsAt, remedies: ['wait'] }`; an `assistant` message with `error: 'authentication_failed'` → `error { class: 'auth' }`. Every other message → `[]`. `toolTarget` = the first string among `file_path`, `path`, `command`, `url`, `pattern`. (The SDK's `resetsAt` is epoch **seconds**; if its documentation says otherwise, stop and comment.)
- **I-28** `start(request)`: unknown account → `err({ code: 'unsupported', … })`. Environment = `baseEnv` without `ANTHROPIC_API_KEY` and `ANTHROPIC_AUTH_TOKEN`; an `api_key` account adds `ANTHROPIC_API_KEY` from `secrets.get(secretRef)` (missing → `err({ code: 'not_logged_in', … })`) and maps costs as `reported`; `subscription` maps them as `equivalent`; `cloud` and `byok` → `unsupported` until Phase 3. Options: `cwd`, `model: route.model`, `resume: request.resume?.sessionRef`, `settingSources: []` (the user's own settings files are never read or written), `systemPrompt: { type: 'preset', preset: 'claude_code', append: role.instructions }`, `mcpServers` from the request's `mcp` capabilities (`{ command, args, env }`, `secretRef` env values resolved through `secrets`, an unresolvable one → `err({ code: 'not_logged_in', … })`), and `canUseTool` (I-29). The prompt is streaming input: the first user message is `request.prompt`; `steer(note)` sends `note` as a further user message.
- **I-29** Permissions: every `canUseTool(name, input)` emits `permission_ask { id: 'ask-<n>' (1, 2, … per run), tool: name, target: toolTarget(input), options: ['allow', 'deny'] }` and waits for `answerPermission(id, …)`: `allow` → `{ behavior: 'allow', updatedInput: input }`, `deny` → `{ behavior: 'deny', message: 'Denied by the operator' }`. The call's abort signal → deny. An unknown or repeated `askId` is ignored.
- **I-30** `events` always ends with exactly one `finished`: after `result`; after `stop()` (abort, then `finished { reason: 'cancelled' }`); after a thrown SDK error (`error { class: 'crash' }` then `finished { reason: 'failed' }`). No event, error message or thrown error contains an environment value or a secret.

---

## 8. Composition for Node — `compose/`

```ts
// create-node-deps.ts
export interface NodeDepsConfig {
  readonly dataDir: string;                          // ~/.docket in the app, a temp folder in tests
  readonly cipher: CipherFns;
  readonly transports: TransportResolver;
  readonly notifier: Notifier;
  readonly commandEnv: Readonly<Record<string, string>>;
  readonly clock?: Clock;                            // default createSystemClock()
  readonly random?: RandomBytes;
}
export interface NodeDeps {
  readonly deps: AppDeps;
  readonly workspaces: WorkspaceRegistry;
  close(): void;
}
export function createNodeDeps(config: NodeDepsConfig): Result<NodeDeps, OpenDbError>;
```

Rules:
- **I-31** `createNodeDeps` opens `<dataDir>/docket.db`, uses `<dataDir>` as the global definitions root and `<dataDir>/worktrees` as the worktree root, and wires every `AppDeps` member to the adapters above (clock, `createUlidGen`, SQLite repositories and event log, YAML store over the registry, keychain vault, worktrees, command runner with `commandEnv`, secret scanner, evidence checker) plus the injected transports and notifier. A too-new database → the `openDatabase` error. `close()` closes the database.

## 9. Phase 2b acceptance — headless end to end on real storage

`src/infrastructure/scenarios/standard-flow-node.test.ts` repeats the Phase 2a scenario
([application.md §5](application.md#5-phase-2a-acceptance--headless-end-to-end)) through `createApi` and the
application services, but on `createNodeDeps` over a temporary data folder: the built-in roles and flows
written as YAML files under the global root, a throw-away git repository registered as the workspace
(its `.docket/workspace.yaml` enables `standard` with command sets that run `node -e "process.exit(0)"`),
the real command runner, secret scanner and worktrees, a fake transport and a test cipher. It asserts
the same states as 2a, that the worktree exists at `<dataDir>/worktrees/<workspace>/<id>`, and — after
`close()` and a fresh `createNodeDeps` on the same folder — that `workOrder.detail` returns the same
state and runs.
