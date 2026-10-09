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
| `system/` | `clock.ts` · `ulid.ts` · `repo-paths.ts` | — |
| `storage/sqlite/` | `database.ts` · `schema.ts` · one file per repository · `repo-registry.ts` | `system` |
| `storage/keychain/` | `vault.ts` | `system`, `storage/sqlite` |
| `storage/definitions-yaml/` | `targets.ts` · `store.ts` | `system` |
| `vcs/` | `git.ts` · `worktrees.ts` · `evidence.ts` | `system` |
| `gates/` | `secret-patterns.ts` · `secret-scanner.ts` · `command-runner.ts` | `system`, `vcs` |
| `providers/` | `defs/` · `discovery/` · `launch/` · `quota/` · `transports/{sdk, stream-json, app-server, acp}/` | `system` |
| `forge/` | `github.ts` · `index.ts` | `system` |
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

// repo-paths.ts — the narrow path views other adapters need from the registries
export interface RepoPaths { path(slug: RepoSlug): Promise<string | undefined> }
export interface ProjectPaths { mainRepoPath(project: ProjectSlug): Promise<string | undefined> }
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
export function createSqliteProjectRepo(db: DocketDb): ProjectRepo;

// repo-registry.ts — machine-local pointers only (S1): where each repo is cloned
export interface RepoRegistry extends RepoPaths {
  register(slug: RepoSlug, path: string): Promise<void>;          // upsert; `path` absolute
  list(): Promise<readonly { readonly slug: RepoSlug; readonly path: string }[]>;   // slug asc
  remove(slug: RepoSlug): Promise<void>;
}
export function createSqliteRepoRegistry(db: DocketDb): RepoRegistry;
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

Migration 2 (`MIGRATIONS[1]`, exact — the Project layer, S1/S2; every existing workspace becomes a
"project ≡ repo" record, main repo = itself):

```sql
ALTER TABLE workspaces RENAME TO repos;
ALTER TABLE work_orders RENAME COLUMN workspace TO repo;
ALTER TABLE work_orders ADD COLUMN project TEXT NOT NULL DEFAULT '';
ALTER TABLE spend RENAME COLUMN workspace TO repo;
ALTER TABLE spend ADD COLUMN project TEXT NOT NULL DEFAULT '';
CREATE TABLE projects (slug TEXT PRIMARY KEY, name TEXT NOT NULL, main_repo TEXT NOT NULL, data TEXT NOT NULL);
CREATE TABLE project_repos (project TEXT NOT NULL REFERENCES projects (slug), repo TEXT NOT NULL, PRIMARY KEY (project, repo));
INSERT INTO projects (slug, name, main_repo, data)
  SELECT slug, slug, slug, json_object('id', slug, 'name', slug, 'mainRepo', slug, 'repos', json_array(slug)) FROM repos;
INSERT INTO project_repos (project, repo) SELECT slug, slug FROM repos;
UPDATE work_orders SET project = repo;
UPDATE work_orders SET data = json_set(json_remove(data, '$.workspace'), '$.project', repo, '$.repo', repo);
UPDATE spend SET project = repo;
UPDATE bindings SET level = 'repo' WHERE level = 'workspace';
CREATE INDEX work_orders_by_project ON work_orders (project, created_at, id);
CREATE INDEX project_repos_by_repo ON project_repos (repo);
```

`projects.data` stores the full `ProjectDef` JSON; `project_repos` carries the membership joins.
There are no roadmap tables today (the roadmap is YAML in the main repo) — nothing else to move.

Key columns: `audit.subject_key` = the subject's `id` (or `role` for `binding`); `bindings.scope_key` =
`''` for `global`, the project slug, the repo slug, or the work-order id by level. Ordering where a
port promises none: `queue_items` by `id` asc, `proposals` by `id` asc, `projects` by `slug` asc.

Rules:
- **I-3** `openDatabase`: creates the parent folder of a file path; sets `foreign_keys = ON`, `busy_timeout = 5000`, and for file databases `journal_mode = WAL` and `synchronous = NORMAL`; applies every migration whose `version` is greater than `PRAGMA user_version`, in order, each in one transaction that also sets `user_version`. Opening again is a no-op. A file whose `user_version` is greater than the last migration → `err({ code: 'too_new', found, supported })` and the handle is closed.
- **I-4** `transaction`: a throw inside `fn` rolls back every write made in it (including nested calls) and rethrows; a nested call does not open a second transaction.
- **I-5** **Parity with the fakes.** Each repository's test file runs the same behaviour cases against the port's in-memory fake and the SQLite implementation (`describe.each([['fake', …], ['sqlite', …]])`): ordering promises, upsert, `undefined` for a missing id, filters, `AccountRepo.remove` dropping the account's pools and meters but keeping spend, `spend` bounds `from ≤ at ≤ to`. A case where the fake and SQLite must differ is a bug in one of them — stop and comment, do not special-case.
- **I-6** A record read back deep-equals the record written: optional fields that were absent stay absent, `readonly` arrays keep their order, numbers stay numbers. Index columns are rewritten from the record on every update (e.g. `RunRepo.update` with `endedAt` removes the run from `listActive`).
- **I-7** `appendEvent` / `appendEvents` give each event `seq = previous max + 1` inside one transaction; `appendEvents` of N events stores all N or none; `events()` returns `seq` order. Appending to an unknown work order or run throws (foreign key).
- **I-8** Durability: everything written through the repositories and the registry is visible through a second `openDatabase` on the same file after the first handle is closed.
- **I-33** Migration 2: opening a database left at version 1 applies migration 2 exactly once, in one transaction. Afterwards the registry reads `repos`, `work_orders` / `spend` carry `repo` and `project` (every old workspace a project≡repo row in `projects` / `project_repos`, its work orders and spend pointing at it), and records read back deep-equal the new shapes (`data` rewritten — I-6). A database already at version 2 is a no-op; `too_new` (I-3) is unchanged.
- **I-34** Route-aware environment of the SDK transport (extends I-28; where they differ, this rule wins). `baseEnv` first loses `ANTHROPIC_API_KEY`, `ANTHROPIC_AUTH_TOKEN`, `ANTHROPIC_BASE_URL` and `ANTHROPIC_DEFAULT_OPUS_MODEL`, `ANTHROPIC_DEFAULT_SONNET_MODEL`, `ANTHROPIC_DEFAULT_HAIKU_MODEL`. Then by route kind: `anthropic-api` as in I-28; a compatible-endpoint kind adds `ANTHROPIC_BASE_URL` = the account's `endpoint`, `ANTHROPIC_AUTH_TOKEN` = `secrets.get(secretRef)` (missing → `err({ code: 'not_logged_in', … })`) and the three tier model variables = `tierModels` strong → OPUS, balanced → SONNET, fast → HAIKU (the account's `tierModels` overrides the route kind's defaults); `anthropic-subscription` with an `identityDir` adds the config-directory variable `CLAUDE_CONFIG_DIR` = `identityDir`, without one it behaves as in I-28. `settingSources: []` stays, MCP stays inline, and Docket neither writes into `identityDir` nor reads credential values from it. Cost kind per route kind is read from the capability registry. Environment values are never logged. Every SDK run also sets `CLAUDE_CODE_DISABLE_AUTO_MEMORY=1` so a run
never edits the user's personal memory files (the implementing issue verifies the variable name against the
CLI documentation). Tests (scripted SDK double, exact environment compared): api-key account, compatible-endpoint account with a missing secret, compatible-endpoint account with all tier models, subscription account with and without `identityDir`.

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

Layout. Global root = `<dataDir>` (`~/.docket`); project root = `<main-repo>/.docket`; repo root =
`<repo>/.docket`.

```
<root>/roles/<slug>.yaml          one RoleDef per file        (global, project and repo roots)
<root>/flows/<slug>.yaml          one FlowDef per file        (global, project and repo roots)
<root>/capabilities/<slug>.yaml   one CapabilityDef per file  (global, project and repo roots)
<project-root>/project.yaml       the ProjectDef              (project root only)
<project-root>/roadmap.yaml       the Roadmap                 (project root = the main repo only)
<repo-root>/repo.yaml             the RepoDef                 (repo root only)
```

```ts
// targets.ts
export type DefinitionKind = 'roles' | 'flows' | 'capabilities';
export type ParsedTarget =
  | { readonly kind: DefinitionKind; readonly id: string }
  | { readonly kind: 'project' }
  | { readonly kind: 'repo' }
  | { readonly kind: 'roadmap' };
export function parseTarget(scope: DefinitionScope, target: string): ParsedTarget | undefined;
export function hashContent(content: string): string;          // sha256 of the UTF-8 bytes, lowercase hex

// store.ts
export interface YamlStoreConfig { readonly globalRoot: string; readonly repos: RepoPaths; readonly projects: ProjectPaths }
export function createYamlDefinitionStore(config: YamlStoreConfig): DefinitionStore;
```

Every file is parsed with `yaml`'s `parse(text, { schema: 'core', uniqueKeys: true, maxAliasCount: 100 })`
(no custom tags) and must hold one mapping.

Rules:
- **I-11** `parseTarget` accepts exactly `roles|flows|capabilities/<slug>.yaml` (the stem passes the domain's `parseSlug`) in all three scopes, `project.yaml` / `roadmap.yaml` in the project scope only, and `repo.yaml` in the repo scope only. Everything else → `undefined`: absolute paths, `..`, `./`, backslashes, other extensions, deeper folders, upper case.
- **I-12** `load(repo)`: the repo path comes from `RepoPaths` (unknown → `err([{ path: 'repo', code: 'missing_field', … }])`, as does a missing `repo.yaml`); the project defaults come from the repo's project (via `ProjectPaths.mainRepoPath`; a repo whose project is unknown loads global + repo only). Missing kind folders are empty; only `*.yaml` files that pass `parseTarget` are read, in file-name order. Merge per kind (S3): global entries first; a project entry with the same `id` replaces the global one in its position; a repo entry replaces both; other entries follow in root order global → project → repo. The result is exactly `validateDefinitions({ roles, flows, capabilities, project, repo })` with `repo` present and `project` carried alongside.
- **I-13** File problems, collected for **every** file before validation: unparsable YAML or a non-mapping document → `{ path: '<global|project|repo>:<target>', code: 'wrong_type', message: 'yaml: ' + first line of the parser message }`; a `roles/flows/capabilities` file whose `id` differs from its file stem → `{ path: same, code: 'invalid_slug', message: 'id does not match file name' }`. If any exist, `load` returns all of them and does not call `validateDefinitions`.
- **I-14** `loadRoadmap(project)`: unknown project or no `roadmap.yaml` in its main repo → `undefined`; otherwise `validateRoadmap(parsed, projectDef)`, with a parse failure reported as a `RoadmapIssue` `{ path: 'roadmap.yaml', code: 'wrong_type', … }`.
- **I-15** `readFile`: an invalid target, an unknown scope subject (project/repo) or a missing file → `undefined`; otherwise `{ content, hash: hashContent(content) }`.
- **I-16** `writeFile`: an invalid target or an unknown scope subject throws (the application validates first — A-12). The current hash (`''` when the file is absent) must equal `expectedHash`, else `err('stale')` and nothing changes. The write goes to a temporary file in the same folder and is renamed over the target (folders created as needed); writes to the same file are serialized inside the process, so of two writers with the same `expectedHash` exactly one succeeds. Returns the new hash.
- **I-17** `validateCandidate` writes nothing (the folder listing and every file are unchanged afterwards). An invalid target → `err([{ path: target, code: 'wrong_type', message: 'not a definition file' }])`. Otherwise the candidate content replaces (or adds) the target in memory and the same pipeline as I-12/I-13 runs — repo scope: that repo's merged definitions; project scope: the project root merged over the global files, validated as `validateDefinitions({ roles, flows, capabilities, project })`; global scope: the global files alone, validated as `validateDefinitions({ roles, flows, capabilities })`. A `roadmap.yaml` target runs `validateRoadmap` (with the project when resolvable) and maps each issue to `{ path: 'roadmap.' + i.path, code: 'wrong_type', message: i.code + ': ' + i.message }`.
- **I-18** `repoPath` returns `RepoPaths.path(repo)`.
- **I-32** project.yaml loading: `readProjectAt(path)` reads `<path>/.docket/project.yaml` — absent → `err([{ path: 'project.yaml', code: 'missing_field' }])`; unparsable or a non-mapping document → `{ path: 'project.yaml', code: 'wrong_type', message: 'yaml: …' }`; otherwise the parsed mapping is validated with R-46 (project rules only — roles/flows are not required) and returned as a `ProjectDef`. `load`'s project arm uses the same reader on the main repo path.

---

## 5. Git, worktrees, evidence — `vcs/`

```ts
// git.ts
export interface GitResult { readonly exitCode: number; readonly stdout: string; readonly stderr: string }
export function runGit(cwd: string, args: readonly string[], options?: { readonly timeoutMs?: number }): Promise<GitResult>;

// worktrees.ts
export interface WorktreesConfig { readonly root: string; readonly repos: RepoPaths }   // root = <dataDir>/worktrees
export function createWorktrees(config: WorktreesConfig): Worktrees;
export function worktreeBranch(id: WorkOrderId): string;      // 'docket/wo-' + id.toLowerCase()
export const BASE_REF_PREFIX = 'refs/docket/bases/';          // + work-order id → the commit the worktree started from

// evidence.ts
export function createEvidenceChecker(): EvidenceChecker;
```

Rules:
- **I-19** `runGit` spawns `git` directly (no shell) with an environment of only `PATH`, `HOME` (plus `SystemRoot` on Windows) from `process.env` and `LC_ALL=C`, `GIT_TERMINAL_PROMPT=0`; default timeout 60 s (then the process is killed and `exitCode` is 124). A non-zero exit is a result, not a throw; `git` missing → `exitCode: 127`.
- **I-20** `ensure(repo, id)`: unknown repo, a path that is not a git work tree, or a repository without commits → `err('no_repo')`. The worktree path is `<root>/<repo>/<id>`. If `git worktree list --porcelain` already lists it → `ok({ path })` and nothing changes. Otherwise: base = `git rev-parse HEAD` of the repo checkout; `git worktree add -b <worktreeBranch(id)> <path> <base>` (or without `-b` when the branch already exists); `git update-ref <BASE_REF_PREFIX><id> <base>` unless that ref exists. Concurrent calls for the same id share one creation. The repo checkout's working tree and current branch are never changed.
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
- **I-24** `run(cwd, command, timeoutMs)` runs `command` through `/bin/sh -c` (Windows: `cmd.exe /d /s /c`) in `cwd` with **exactly** `config.env` plus the call's `env` argument (the call's value wins on a name clash) — nothing inherited from `process.env` — in its own process group.
- **I-25** Timeout: SIGTERM to the process group, SIGKILL 5 s later if still alive; `exitCode` 124. A failure to spawn (e.g. missing `cwd`) → `exitCode` 127 and `outputTail` `'spawn failed: ' + <error code>`. `durationMs` is a whole number.
- **I-26** `outputTail`: stdout and stderr interleaved in arrival order; the last `tailBytes` bytes, cut on a UTF-8 character boundary; then every value of `config.env` and of the call's `env` that is at least 8 characters long is replaced with `[env]`, then `redactSecrets` runs.

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
  readonly repos: RepoRegistry;
  readonly projects: ProjectRepo;
  close(): void;
}
export function createNodeDeps(config: NodeDepsConfig): Result<NodeDeps, OpenDbError>;
```

Rules:
- **I-31** `createNodeDeps` opens `<dataDir>/docket.db`, uses `<dataDir>` as the global definitions root and `<dataDir>/worktrees` as the worktree root, and wires every `AppDeps` member to the adapters above (clock, `createUlidGen`, SQLite repositories and event log, project repo, YAML store over the repo registry and project paths, keychain vault, worktrees, command runner with `commandEnv`, secret scanner, evidence checker) plus the injected transports and notifier. A too-new database → the `openDatabase` error. `close()` closes the database.

### Quota probe context and machine-login scan (P-48, P-53)

- **I-37** The Claude usage source builds its child environment with the SDK transport's route-aware rules (I-34): the base environment without the `ANTHROPIC_*` keys I-34 drops, plus the config-directory variable `CLAUDE_CONFIG_DIR` = `context.identityDir` when it is set; `cwd` is the OS temp dir and `settingSources` stays empty. The probe resolver passes `context` through to every probe; the `codex`, `agy` and `copilot` probes read the machine login (their context's `identityDir` is `null`), the z.ai monitor probe keeps reading the account's endpoint and key. A probe's failure text never quotes the child's output.
- **I-38** The account scan composes two sources: the existing Claude-style directory scan, and one machine-login candidate per provider that `providers.discovered` reports with a `binPath` and that has no directory scanner (today: every built-in except `claude-code`). The def gains optional `accountHome: { readonly path: string; readonly env?: string }` (display data only — never read, never opened): `codex` `{ path: '~/.codex', env: 'CODEX_HOME' }`, `copilot` `{ path: '~/.copilot', env: 'COPILOT_HOME' }`; the others carry none until their CLI documents one. `displayPath` = `$<env>` when that variable is set in the environment, else `path`, else the provider's name.

### Project scaffolding adapters (#370)

- **I-36** `installBuiltins` writes `<globalRoot>/roles/<id>.yaml` and `<globalRoot>/flows/<id>.yaml` with the store's own YAML serializer (the same shape `load` parses back: a written file round-trips to an equal definition), creating the folders when missing; a target that exists is skipped untouched, whatever its content; `written` lists the targets actually written. `scaffoldProject` checks both `<path>/.docket/project.yaml` and `<path>/.docket/repo.yaml` first and writes nothing when either exists; otherwise it creates `.docket` and writes both files with exclusive create (`wx`), `project.yaml` first; a write error → `io_failed`. `createRepo`: `parent` must be an existing directory (`not_a_folder`); `<parent>/<folder>` existing in any form → `folder_exists`; otherwise `mkdir` then `git init --initial-branch=main` through `execFile` (no shell); a failure → `io_failed`, logged by name only. Nothing else in the folder is written.

### Account test adapters (#716)

- **I-35** The account-test adapters: `createMemoryAccountTestRepo()` keeps records in memory for the process lifetime and, on `save`, passes `detail` through the secret redaction the gates use (`redactSecrets`) and then cuts it to 300 code points, so a stored detail never carries a token-shaped value. `createScratchDirs()` creates each dir with `mkdtemp` under the OS temp dir, named `docket-account-test-*`, outside every repo and every `identityDir`; `dispose` removes exactly that directory recursively and never fails the caller (a removal error is logged by name only). The SQLite `recordSpend` stores an `account_test` entry with empty strings in the project/repo and work-order columns (no schema change); the repo/project/work-order filters therefore never match it, while an `accountId` filter does.

### Worktree files adapter (#819)

```ts
// vcs/worktree-files.ts — behind ports/worktree-files.ts (application.md → #819)
export function createWorktreeFiles(): WorktreeFiles;
```

- **I-39** (added 2026-10-09, #819) `listChanged(worktreePath)` runs through `runGit` (I-19) in the worktree: `git diff --name-only --diff-filter=ACMR HEAD` (staged and unstaged alike; deleted files are excluded — nothing to read, nothing to decide on) plus `git ls-files --others --exclude-standard` (untracked but not ignored — the scanner I-23's set). Entries are the union, paths '/'-separated as git prints them, sorted by path in Unicode code-point order; `sizeBytes` is each file's stat. Not a git work tree → throws (the scanner's stance); a git failure throws and the api boundary answers with its failure envelope. Nothing is written and no file's content is read — the stat is the only touch.
- **I-40** (added 2026-10-09, #819) `readText` guards in this fixed order and answers with exactly the contract's names: (1) `relativePath` contains a `..` segment, or the symlink-resolved real path of `worktreePath/relativePath` does not lie under the symlink-resolved `worktreePath` (the resolved root plus a separator — never a string-coincidence prefix) → `outside_worktree`; (2) no regular file there → `not_found`; (3) its size is over 256 KiB (262 144 bytes) → `too_large`; (4) its bytes contain a NUL byte or do not decode as UTF-8 → `not_text`. Otherwise: the first `maxLines` lines, split on `'\n'` (a trailing newline ends the last line, it does not start an empty one), `truncated: true` when the file had more lines. The order is the contract — an escaping path answers `outside_worktree` even when nothing exists there; the size is checked before a byte of content is read.
- **I-41** (added 2026-10-09, #819) The fake `createFakeWorktreeFiles()` (ports/fakes, A-1) carries this same contract, not a loose stand-in: it rejects `..`, a resolved escape, an oversize and a binary entry with I-40's own names and order, keeps I-39's path ordering, and truncates at `maxLines` — a use-case test against the fake exercises the adapter's semantics. Its files live in memory only and it returns copies (A-2).

### Capability scan adapter (#853)

The adapter behind the `CapabilityDiscovery` port (application.md's #853 section): one scan map,
one file-system seam, one guarded node reader. The scan map may name a source only where the
vendor's own CLI documentation and this repo together prove the location (the PR's evidence
table); anything unproven stays out and is listed as `unknown` — never a guess.

- **I-42** (added 2026-10-09, #853) `createCapabilityScan` reads only what the provider's scan map row names, under the account's own `identityDir`. Wave-1 rows: `claude-code` → `CLAUDE.md` (context — the vendor's memory documentation puts user instructions at the config root, and the capability registry's own row says the same) and `.claude.json` (mcp — the CLI's state file: its location under the adopted account's dir is what the account scan reads as the identity file and what the `CLAUDE_CONFIG_DIR` launch makes it, and the vendor's MCP documentation puts the user-scope servers in that file's top-level `mcpServers`); every other provider has no row — no finds. Confinement is I-40's: the symlink-resolved file path must lie under the symlink-resolved directory (the resolved root plus a separator, never a string-coincidence prefix); the final component opens `O_NOFOLLOW` (re-vetting a symlink swapped in after the realpath) and `O_NONBLOCK` (a FIFO cannot block the read) and must be a regular file. A file over **256 KiB (262 144 bytes)**, one with a NUL byte, or one that is not UTF-8 is skipped silently — never an error, never logged with content. A missing `identityDir`, an unreadable or unparseable file, or one broken account never stops the scan. Nothing is ever written. Amended 2026-10-09, #853: the state file has its own 4 MiB cap because it grows with the user's project history; every other row keeps 256 KiB.
- **I-43** (added 2026-10-09, #853) Parsing drops everything the candidate type cannot carry, at once. For the state-file row only the top-level user-scope `mcpServers` is read (per-project state never is), and of each server only its key (→ `name`) and its `command` string survive — `args`, `env` (names and values alike), headers and credential-carrying URLs are dropped before anything is returned or logged; an entry without a string `command` (a remote server) yields nothing, because a candidate has no field for a URL and an import of it could only fail. For the `CLAUDE.md` row one `context` candidate: `name: 'CLAUDE.md'`, `path` = the file's absolute path (referenced, never copied), `description` = the first non-empty line. Each find carries `sources: [<that account's id>]` and the R-62 form in `identity`.
- **I-44** (added 2026-10-09, #853) The store's capability installer: `installCapabilities` writes `<globalRoot>/capabilities/<id>.yaml` with the store's own YAML serializer — a written file round-trips to an equal `CapabilityDef` through `load` (I-36's law, tested) — through the store's per-path write queue; an existing target is skipped untouched whatever its content, and `written`/`skipped` list the targets actually written / found. `createNodeDeps` wires `capabilityDiscovery: createNodeCapabilityScan()`.
- **I-45** (added 2026-10-09, #853) The fake `createFakeCapabilityDiscovery()` (ports/fakes, A-1) carries the port's contract, not a loose stand-in: an account without `identityDir` answers nothing, a configured broken directory is an empty find, never a throw, and every find's `sources` are forced to exactly the scanning account's id — whatever a test seeded — so a use-case test against the fake exercises the adapter's semantics (I-41's stance). The file-level parsing stays adapter detail; the fake stays at the port's altitude.

- **I-46** (added 2026-10-10, #873) The settings store: migration 4 creates `app_settings (key TEXT PRIMARY KEY, value_json TEXT)`; `createSqliteAppSettingsRepo(db)` implements `AppSettingsRepo` (A-105) over it — `set` upserts the key with the value as JSON text, `get` parses it back (`undefined` for an unset key). The fake `createFakeAppSettingsRepo()` runs the same behaviour cases (I-5): values round-trip structurally, a stored value is a copy (later mutation of the input never reaches the store), a re-`set` replaces, and a value that is not JSON-serialisable (`undefined`) rejects without touching the stored value.
- **I-47** (added 2026-10-10, #873) The table is generic on purpose: a new setting is a new key, never a new migration. A set value survives closing and reopening the database file (I-8's stance), and migration 4's SQL is pinned exactly in `database`'s migration list.

- **I-48** (added 2026-10-10, #879) The phase auto-run store: `createSqlitePhaseAutoRunRepo(db)` implements `PhaseAutoRunRepo` (A-109) over migration 5's `phase_auto_runs`, and the fake and the SQLite repository run the same cases (I-5 style): an unknown (project, phase) reads `undefined` and an empty store lists nothing; `put` round-trips every field, the attention ids included, and replaces the record of the same (project, phase) without touching others; `list` is ordered by project then phase; the store keeps copies, so mutating the input afterwards never reaches it.
- **I-49** (added 2026-10-10, #879) Migration 5 creates `phase_auto_runs (project TEXT NOT NULL, phase TEXT NOT NULL, state TEXT NOT NULL, started_at INTEGER NOT NULL, attention_json TEXT NOT NULL, PRIMARY KEY (project, phase))`, pinned exactly in the sqlite tests; a stored record survives closing and reopening the database file (I-8's stance).

## 9. Phase 2b acceptance — headless end to end on real storage

`src/infrastructure/scenarios/standard-flow-node.test.ts` repeats the Phase 2a scenario
([application.md §5](application.md#5-phase-2a-acceptance--headless-end-to-end)) through `createApi` and the
application services, but on `createNodeDeps` over a temporary data folder: the built-in roles and flows
written as YAML files under the global root, a throw-away git repository registered as a project≡repo
(its `.docket/project.yaml` naming itself `mainRepo`, its `.docket/repo.yaml` enabling `standard` with
command sets that run `node -e "process.exit(0)"`),
the real command runner, secret scanner and worktrees, a fake transport and a test cipher. It asserts
the same states as 2a, that the worktree exists at `<dataDir>/worktrees/<repo>/<id>`, and — after
`close()` and a fresh `createNodeDeps` on the same folder — that `workOrder.detail` returns the same
state and runs.
