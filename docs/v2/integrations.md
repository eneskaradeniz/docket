# Integrations and environments — design

Status: **Phase 2c is a contract.** This document fixes the shape of code hosting, issue
tracking, environments, deployment and remote CI so that later phases can add adapters without
changing the core. The exact types and rules for Phase 2c (environments, deploy gates, remote checks, forge/tracker ports) have moved into [domain.md](domain.md) and
[application.md](application.md). The rest (platform adapters, tracker write-back) remain design until their phase.

## Principles

1. **Git is the core, platforms are adapters.** Worktrees, branches, diff, merge and secret scans use
   plain `git` and work with any remote or none. Everything platform-specific — pull requests, CI
   status, issues, boards — sits behind a port with one adapter per platform.
2. **Platform names are data.** The domain and application never branch on "GitHub" or "Jira"; they
   see a `kind` string and a capability set, exactly like agent providers.
3. **Outward writes are human-owned.** Opening a pull request, writing a comment or a status back to a
   tracker, deploying: each is either behind a human gate or an explicit per-workspace setting the user
   turned on, and each is recorded in the `EventLog` with its actor.
4. **Credentials are integration accounts.** A connection to a platform (base URL, user-given label,
   `secretRef`) is stored like an agent account; the token lives only in the OS keychain.
5. **Imports are proposals.** Pulling tasks from a tracker into the roadmap changes a definition file,
   so it arrives as a Proposal the user approves as a diff (invariant 5).

## Code hosting — the `Forge` port

`architecture.md` already names the `Forge` port. Its planned shape:

```ts
// planned — application port, one adapter per platform
type ForgeKind = string;   // 'github' | 'bitbucket' | 'azure-devops' | 'gitlab' | … (data)
interface ForgeCapabilities { readonly pullRequests: boolean; readonly checks: boolean; readonly issues: boolean }
interface PullRequestRef { readonly number: number; readonly url: string }
interface CheckRun { readonly name: string; readonly status: 'queued' | 'running' | 'passed' | 'failed' | 'cancelled' | 'skipped'; readonly url?: string }
interface Forge {
  readonly kind: ForgeKind;
  readonly capabilities: ForgeCapabilities;
  pushBranch(repo: RepoRef, branch: string): Promise<Result<void, ForgeError>>;
  openPullRequest(repo: RepoRef, input: { readonly head: string; readonly base: string; readonly title: string; readonly body: string }): Promise<Result<PullRequestRef, ForgeError>>;
  pullRequest(repo: RepoRef, number: number): Promise<Result<{ readonly state: 'open' | 'merged' | 'closed'; readonly mergeable?: boolean }, ForgeError>>;
  checks(repo: RepoRef, ref: string): Promise<Result<readonly CheckRun[], ForgeError>>;
  mergePullRequest(repo: RepoRef, number: number): Promise<Result<void, ForgeError>>;   // only after a human gate
}
interface ForgeResolver { forRepo(repo: RepoRef): Promise<Forge | undefined> }
```

- `RepoRef` gains an optional `forge?: { kind; account }`; without it the kind is inferred from the
  remote URL host, and the integration account is chosen by host. Extended by the connector
  registry (A-415, [application.md](application.md) → "the connector registry" addendum, added
  2026-10-16, #1247): the host test and readiness probe become `matchConnectorHost` plus the
  connector's own probe over the enabled connectors.
- Adapters: GitHub first (Phase 3). Bitbucket (Cloud and Data Center), Azure Repos, GitLab later —
  each is one adapter plus its tests against recorded API responses, no core change.
- A platform without checks or pull requests reports it in `capabilities`; gates that need it fail
  validation for that workspace instead of failing at run time.

## Issue tracking — the `IssueTracker` port

```ts
// planned — application port
interface ExternalItem { readonly source: string; readonly key: string; readonly title: string; readonly url: string; readonly status: string; readonly updatedAt: EpochMs }
interface IssueTracker {
  readonly kind: string;   // 'jira' | 'azure-boards' | 'github-issues' | 'odoo-project' | … (data)
  search(query: string, limit: number): Promise<Result<readonly ExternalItem[], TrackerError>>;
  get(key: string): Promise<Result<ExternalItem | undefined, TrackerError>>;
  comment(key: string, text: string): Promise<Result<void, TrackerError>>;
  transition(key: string, status: string): Promise<Result<void, TrackerError>>;
}
```

- A roadmap `Task` gains an optional `external?: { source; key }` link.
- **Import:** the user picks items; Docket builds a Proposal adding tasks to `roadmap.yaml`.
- **Write-back** (comment when a work order opens or closes, move the item's status) is off by default,
  switched on per workspace and per action, and audited. Written text names targets only — never
  secrets, environment values or transcripts.
- The tracker's own query language is passed through as data (`query: string`); Docket does not
  translate between JQL, WIQL or others.
- An agent may also read a tracker through an MCP capability attached to a role; that path is read-only
  context for the agent and never replaces the port.

### Phase 7 addendum: tracker model (added 2026-10-12, #1005)

Under D-3 (see `docs/v2/decisions-phase7.md`), Docket establishes its two-layer issue tracking architecture. Phase 7 ships the extended port, the sync engine, an in-memory recording fake adapter (#1019), and the GitHub adapter (#1020). Other platform adapters (Bitbucket, Jira, Azure Boards, Odoo) belong to Phase 9 (#226).

#### Port capabilities by sync mode

| Port method | `docket_only` | `read_only_mirror` | `limited_write` | `two_way` |
| --- | --- | --- | --- | --- |
| `probePermissions(scope)` | — | allowed | allowed | allowed |
| `listMilestones(scope, cursor?)` | — | allowed | allowed | allowed |
| `listIssues(scope, opts)` | — | allowed | allowed | allowed |
| `get(key)` / `search(query, limit)` | — | allowed | allowed | allowed |
| `transition(key, status)` | — | — | allowed | allowed |
| `comment(key, text)` | — | — | allowed | allowed |
| `createIssue(scope, input)` | — | — | — | allowed |
| `updateIssue(key, patch)` | — | — | — | allowed |

#### Platform support and phase boundaries

| Tracker Platform | Phase | Implementation Status | Scope / Supported Sync Modes |
| --- | --- | --- | --- |
| GitHub Issues & Milestones | Phase 7 (#1020) | GitHub adapter over `gh` CLI | `docket_only`, `read_only_mirror`, `limited_write`, `two_way` |
| In-memory Fake | Phase 7 (#1019) | Test fake with recording spy | all modes |
| Bitbucket Issues | Phase 9 (#226) | Deferred adapter | all modes |
| Jira | Phase 9 (#226) | Deferred adapter | all modes |
| Azure Boards | Phase 9 (#226) | Deferred adapter | all modes |
| Odoo Project | Phase 9 (#226) | Deferred adapter | all modes |

Contract every adapter must pass (**A-333** `trackerAdapterContract(adapter)`, shared test suite): pagination via `cursor`, `probePermissions` never reports a capability the API refuses, rate limit → `TrackerError 'rate_limited'`, no write call in `read_only_mirror`, re-listing is idempotent. The GitHub adapter must pass it (#1020).

#### Conflicts and supersessions (added 2026-10-12, #1005)

- **Tracker import is not a proposal:** Replaces Principle 5 ("Imports are proposals") and the import proposal note in §Issue tracking: importing into the repo roadmap mirror is a direct mirror (default `read_only_mirror`, D-3), NOT a proposal. Changes to the PROJECT roadmap (phase items) remain proposals.
- **Task external links:** Supersedes "A roadmap `Task` gains an optional `external?: { source; key }` link": `TaskDef` and roadmap tasks stay as the execution-planning unit and gain no tracker fields; tracker identity is tracked on `RepoIssue` and `RepoMilestone` inside `RepoRoadmap`.

## Environments (dev, stg, prd, …)

The workspace definition gains an ordered list of environments:

```ts
// planned — domain, definitions
type EnvSlug = Slug<'env'>;
interface EnvironmentDef {
  readonly id: EnvSlug;                               // 'dev', 'stg', 'prd'
  readonly name: string;
  readonly order: number;                             // promotion order, ascending
  readonly deploy: string;                            // command set that deploys the work order's commit
  readonly verify?: string;                           // command set run after deploy (smoke tests)
  readonly env: Readonly<Record<string, EnvValue>>;   // literal or secretRef (OS keychain)
  readonly protected: boolean;                        // prd-like: stricter rules below
  readonly promoteFrom?: EnvSlug;                     // must have a successful deploy of the same commit first
}
// WorkspaceDef.environments: readonly EnvironmentDef[]   (optional, default [])
```

A new gate kind makes deployment a normal flow step:

```ts
// planned — GateDef member
| { readonly kind: 'deploy'; readonly id: GateSlug; readonly environment: EnvSlug }
```

Rules (planned):
- A `deploy` gate always needs a **human approval first** (invariant 1); only then does the engine run
  the environment's `deploy` command set, then `verify`. The gate passes when both exit 0.
- For a `protected` environment the approver may not be the actor who started the work order's last
  run, and `promoteFrom` is required.
- With `promoteFrom`, the gate stays blocked until a successful deployment of the **same commit** to that
  environment exists.
- Every attempt is a **deployment record**: environment, commit, approver, start/end, result, output
  tail (redacted like command gates). Environment values and secrets never reach records.
- Deploy commands run through the existing `CommandRunner` in the work order's worktree; environment
  values are injected from the definition and the keychain only for that command.
- Typical flow: `… → review → deploy-stg (deploy gate: stg) → staging test (human stage) → deploy-prd
  (deploy gate: prd) → closure`. The built-in library gains a "Standard with environments" flow.

## Remote CI

A second new gate kind waits for the platform's checks:

```ts
// planned — GateDef member
| { readonly kind: 'remote_checks'; readonly id: GateSlug; readonly required: readonly string[] | 'all'; readonly timeoutMinutes: number }
```

- The work order's branch must be pushed (`Forge.pushBranch`; automatic push is a workspace setting,
  off by default). The gate reads `Forge.checks` for the branch head: all required checks `passed` →
  pass; any `failed`/`cancelled` → fail (normal `onFail`); otherwise pending, re-checked by the
  dispatcher on a timer; past `timeoutMinutes` → fail with reason `timeout`.
- Local command gates stay the default; remote checks are an addition for projects whose truth is the
  platform's CI (GitHub Actions, Bitbucket Pipelines, Azure Pipelines, GitLab CI).
- Docket does not run or configure CI/CD pipelines itself; it observes them and, through `deploy`
  gates, runs the user's own deploy commands.

## Phases

| Phase | What lands |
| --- | --- |
| **2c — Environments core** (headless, after 2b) | Domain: `EnvironmentDef`, `deploy` and `remote_checks` gates, validation, promotion and approval rules, deployment records in the flow's events. Application: `Forge` and `IssueTracker` port interfaces with fakes; deploy-gate and remote-checks use cases. No real platform adapter. |
| **3 — Providers** | GitHub `Forge` adapter (push, pull request, checks). |
| **4 — UI & parity** | Environments in workspace settings and the wizard; deploy approval and deployment history in the work-order view; CI status on cards. |
| **5 — Roadmap & dispatcher** | Remote-check polling by the dispatcher; tracker import as proposal; opt-in write-back. |
| **9 — Integrations** | Adapters: Bitbucket (repos, pipelines), Azure DevOps (Repos, Pipelines, Boards), GitLab, Jira, Odoo Project, GitHub Issues. Each is an adapter set on the ports above. |

## Phase 9 addendum: the connector model (added 2026-10-16, #1247)

Operator decision 2026-10-16, step 0 of Phase 9: *modules in the Odoo sense, but built-in*. Each
integration is a self-contained **connector module** with a manifest, one registration path, its own
folder and a conformance suite, shipped inside the app and switched on/off in Settings.
Clean-architecture layering applies throughout. The contracts: the manifest and its validation are
R-182/R-183 ([domain.md](domain.md) → the same-titled addendum), the registry, the connector
context and the write/error laws A-415 … A-417 ([application.md](application.md) → the same-titled
addendum), the layout and the conformance suite I-113/I-114 ([infrastructure.md](infrastructure.md)
→ the same-titled addendum), the Settings screen U-356/U-357 ([ui.md](ui.md)). Third-party loading
at run time is explicitly **not** part of this decision — see Deferred below.

### Adding a connector

The contributor path, mirroring §9 of [provider-capabilities.md](provider-capabilities.md) ("Adding
a provider"):

1. **Evidence first.** Read the platform's own API documentation; write the adapter independently
   from that documentation (CLAUDE.md rule 7: no copying, no naming other projects in code).
2. **Manifest** — `manifest.ts` in the connector folder, valid under R-182.
3. **Adapter on the ports** — the provided families' methods over the `ConnectorContext` (A-416),
   nothing else.
4. **Recorded fixtures** from a throw-away account, with all identifiers replaced — no real data, no
   tokens, no personal names (I-113).
5. **Conformance suite green** — `connectorConformance` (I-114) passes for the connector.
6. **README connector matrix row** — the new connector appears in the matrix.
7. **One PR per connector.**
8. **Operator run** — the maintainer's run on a throw-away account is recorded before the connector
   ships enabled by default.

Strangers need no live account to contribute: fixtures + suite are the review evidence.

### Open decisions

- O-11 Whether Docket ships an auto-updater: the app has none in the code today
  (`electron-updater`/`autoUpdater` appear nowhere under `electron/` or in `package.json`), so
  connectors ship with app releases — a connector update is an app update. Whether to add an
  auto-updater (and with it out-of-band connector updates) is not decided here; revisit when a
  connector needs to move faster than the app's release rhythm.

### Deferred (not decided)

Loading connectors from a user directory at run time. The boundary above (manifest +
`ConnectorContext`, no ambient imports) is chosen so a connector could later run out-of-process
(stdio protocol, permissions from the manifest) without rewriting the built-ins. Revisit when
several real third-party connector requests exist or maintainer review becomes the bottleneck.
**Naming:** "connector", never "plugin" — `plugin` is already an agent capability kind (D-4).
