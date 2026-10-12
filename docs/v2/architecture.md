# Architecture

Dependencies point inward. The domain knows nothing about the outside world and is tested without any
file, network, process, or clock. Every contact with the outside world sits behind a port.

## Layers

| Layer | Folder | May import | Must not import |
| --- | --- | --- | --- |
| Domain | `src/domain/` | `src/domain/` only | anything else — no npm packages, no Node builtins, no React, no `Date.now()`/`Math.random()` |
| Application | `src/application/` | `src/domain/`, `src/application/` | infrastructure, presentation, Node builtins, React |
| API boundary | `src/api/` | `src/domain/` (types), `src/application/` | infrastructure, presentation, Node builtins, React |
| Infrastructure | `src/infrastructure/` | domain, application, api, npm packages, Node builtins | presentation |
| Presentation | `src/presentation/` | `src/api/`, `src/domain/` (types only), React | application, infrastructure, Node builtins |
| Composition root | `electron/main.ts` | everything | — |

v1 code is no longer in the tree; v1 is available only as the tag `v1-final`, and v2 code never
imports v1 code.

Additional rules, enforced by `scripts/check-layers.mjs` (added in Phase 0):

- No agent-vendor name (`claude`, `anthropic`, `codex`, `openai`, `gpt`, `gemini`, `antigravity`,
  `cursor`, `copilot`) in `src/domain/`, `src/application/`, `src/api/`, `src/presentation/`. Provider
  names live only in `src/infrastructure/providers/`; the UI shows them as data.
- `Date.now`, `new Date()`, `Math.random`, `crypto` are banned in `src/domain/` and
  `src/application/` — time and ids come through the `Clock` and `IdGen` ports.
- No `any` in v2 code (`@typescript-eslint`-free check: the literal `: any` / `as any` / `<any>`).
- No default exports in v2 code.
- `electron` is imported only under `electron/`; adapters receive Electron objects by injection.
- Infrastructure modules import each other only through their `index.ts`, following the module map in
  [infrastructure.md](infrastructure.md); `src/infrastructure/scenarios/` holds test files only.

## Folders

```
src/
  domain/
    shared/        result.ts · ids.ts · actor.ts · time.ts
    definitions/   types.ts · validate.ts
    resolver/      resolve.ts
    gates/         evaluate.ts
    flow/          events.ts · derive.ts · next-action.ts
    quota/         types.ts · headroom.ts · limit-policy.ts
    budget/        budget.ts
    dispatch/      decide.ts
    proposal/      proposal.ts
    roadmap/       types.ts · validate.ts · derive.ts
    providers/     capabilities.ts · agent-event.ts · fold-run.ts
    library/       roles.ts · flows.ts
    index.ts       public barrel — the only import path other layers use
  application/     use-cases/ · ports/ · dispatcher.ts
  api/             commands.ts · queries.ts · events.ts
  infrastructure/   module map and contracts: infrastructure.md
    system/        clock · ulid · repo-paths
    providers/     discovery · transports/{sdk, stream-json, app-server, acp} · defs/ · quota-probes/
    storage/       sqlite/ (one file per repository) · definitions-yaml/ · keychain/
    vcs/           git · worktrees · evidence
    forge/         github (gh CLI Forge adapter)
    gates/         secret-patterns · secret-scanner · command-runner
    pages/         mcp-server · page-store
    compose/       create-node-deps (everything except Electron objects)
    scenarios/     cross-module scenario tests only
  presentation/    shell · cockpit · board · work-order · roadmap · account · settings · wizard · pages-viewer
electron/          main.ts (composition root) · preload.ts (API bridge)
```

Tests sit next to the code: `derive.ts` → `derive.test.ts`.

## Where things live

| Place | Content | Shared? |
| --- | --- | --- |
| `~/.docket/` | Global definitions (roles, flows, capabilities), `docket.db`, the machine-local registry (which project's repos are cloned where), worktrees | Machine-local |
| `<main-repo>/.docket/` | `project.yaml` (the ProjectDef: name, main repo, repos, project budget ceiling), project-level role/flow/capability defaults, `roadmap.yaml` | Versioned with the main repo |
| `<repo>/.docket/` | `repo.yaml` (the RepoDef) and repo-level overrides; the repo budget limit | Versioned with the repo |

Definition precedence: global ← project ← repo — the repo's `.docket/` overrides the project,
the project overrides `~/.docket`; the work-order level resolves above all three
([domain.md §3](domain.md#3-resolver--the-precedence-chain)). The roadmap belongs to the project
and is read from the main repo's `.docket/roadmap.yaml`; changing the main repo moves where the
roadmap lives.

### Storage addendum (added 2026-10-12, #1004; decisions D-5, D-6, D-7)

Layout under `~/.docket/` (added 2026-10-12, #1004):
```
~/.docket/
  docket.db                      runtime state, registry (repoId → current folder), accounts, work orders, runs index
  library/roles|flows|capabilities|memory/<id>/v<N>.yaml    versioned library definitions (immutable files, domain.md R-129)
  projects/<project-slug>/project.yaml, roadmap.yaml        ProjectDef (no mainRepo), roadmap
  repos/<repo-slug>/repo.yaml                                RepoDef incl. flow, bindings, defaultLimitPolicy (domain.md R-126…R-135)
  worktrees/<repo-slug>/<work-order-code>/                   agent worktrees (already machine-local)
  runs/<run-id>/                                             records, transcripts
  run/children.json                                          process registry mirror (#999)
  exports/                                                   bundles the user exported
```

The registry (`docket.db`) maps `repoId` (ULID) → current folder on this machine together with a git fingerprint `{ rootCommit: string; remote?: string }` (I-88); `RepoRegistry` stays the port in application architecture. When a repo's folder is missing at start, it shows "folder not found"; a folder whose fingerprint `rootCommit` equals the stored one is offered as the relink target, never applied silently; a different `rootCommit` is refused.

**Conflicts and supersessions:**
Under D-5, Docket writes no file into a repository's working tree and no tracked content unless the operator runs an explicit "export to repo" (I-87). This supersedes the `<main-repo>/.docket/` and `<repo>/.docket/` rows above, project-level role/flow defaults, and roadmap in the main repo (Phase 3.5 decisions S1, S3 in #372, #375; R-46 `main_repo_not_listed`). Every definition Docket reads or writes lives under `~/.docket/`; the definition store never opens `<repo>/.docket/` except through the one-time legacy import (I-86, I-90). Definitions are versioned under `library/` (D-6) and agent capabilities are organized into dedicated library menus (D-7). Definitions and projects move across machines via portable export/import bundles (`*.docket-bundle.json`; I-89, I-91), never through git tracking in user repos.

## Ports (defined in `src/application/ports/`)

| Port | Responsibility |
| --- | --- |
| `AgentTransport` | Start a run, return an async stream of `AgentEvent`, deliver permission answers and steer notes, stop |
| `ProviderCatalog` | Discover CLIs: path, version, login state, capabilities, models |
| `QuotaProbe` | Query an account's pools and windows |
| `DefinitionStore` | Read roles, flows, capabilities, project, repo, roadmap; apply an approved proposal |
| `WorkOrderRepo`, `RunRepo`, `PageRepo`, `ProposalRepo`, `AccountRepo`, `ProjectRepo` | Runtime state, one repository per aggregate |
| `RepoRegistry` | Machine-local pointers: where each repo is cloned on this machine |
| `EventLog` | Append-only audit: who, what, when, on which subject |
| `SecretVault` | API keys and tokens |
| `Vcs`, `Forge` | Worktrees, branches, diff, merge · pull requests and issues |
| `CommandRunner` | Run gate commands (tests, lint, secret scan) |
| `Clock`, `IdGen`, `Notifier` | Time (epoch ms), ULIDs, desktop notifications |

Every port has an in-memory fake in `src/application/ports/fakes/` used by application tests.

## API boundary (team-ready)

The presentation layer reaches the core only through `src/api/`: **commands** (e.g. `openWorkOrder`,
`decideGate`, `answerPermission`, `attachProject`), **queries** (e.g. `cockpit`, `projectTree`,
`repoBoard`, `workOrderDetail`), and an **event subscription**. Today the transport is Electron IPC via
`electron/preload.ts`; later the same contract can be served over HTTP for a team server or the
mobile app. Contracts are plain JSON-serialisable types — no class instances, no functions.

## Team-ready rules (cheap now, a rewrite later)

1. Every write carries an `Actor` (`user` / `agent` / `system`) and lands in the `EventLog`.
2. Runtime ids are ULIDs; all times are UTC epoch milliseconds in the domain and ISO-8601 UTC at the
   edges. Two machines' data can be merged without collisions.
3. Storage is behind ports; the domain never knows it is SQLite.
4. An approval records who approved; a gate may later declare who is allowed to approve.
5. Project and repo definitions live in git (the main repo's and each repo's `.docket/`), so sharing
   them with a team already works; `~/.docket` holds only registrations and machine-local records.

### Team-ready rules addendum (added 2026-10-12, #1004, see D-5 in decisions-phase7.md)

Team-ready rules, revised: rules 1–4 (actor on every write, ULIDs and UTC times, storage behind ports, approvals record who) stand unchanged; rule 5 is superseded: definitions are portable by export/import (I-89, I-91; `*.docket-bundle.json`), not by git. This product stays single-user; a later team server serves the same API and is out of Phase 7 (I-92).

## Security rules

- Secrets live only in the OS keychain. Records, logs, events, and proposals never contain secret
  values or environment variable values; they may name targets (paths, commands).
- Agent-produced pages are untrusted content (see [pages.md](pages.md)).
- No third-party source code is copied into this repository. Integrations are written from the
  CLIs' and protocols' own documentation.
