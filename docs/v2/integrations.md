# Integrations and environments — design

Status: **design, not yet a contract.** This document fixes the shape of code hosting, issue
tracking, environments, deployment and remote CI so that later phases can add adapters without
changing the core. The exact types and rules move into [domain.md](domain.md),
[application.md](application.md) and [infrastructure.md](infrastructure.md) when their phase is broken
down into issues (see "Phases" below); until then nothing here is implemented or tested.

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
  remote URL host, and the integration account is chosen by host.
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
