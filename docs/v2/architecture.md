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

v1 code (`src/core/`, `src/adapters/`, `src/ui/`, `src/renderer/`) is frozen legacy that stays until
Phase 4 reaches parity. v2 code never imports v1 code, and v1 code never imports v2 code.

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
    system/        clock · ulid · workspace-paths
    providers/     discovery · transports/{sdk, stream-json, app-server, acp} · defs/ · quota-probes/
    storage/       sqlite/ (one file per repository) · definitions-yaml/ · keychain/
    vcs/           git · worktrees · evidence · forge
    gates/         secret-patterns · secret-scanner · command-runner
    pages/         mcp-server · page-store
    compose/       create-node-deps (everything except Electron objects)
    scenarios/     cross-module scenario tests only
  presentation/    shell · cockpit · workspace-board · work-order · roadmap · settings · wizard · pages-viewer
electron/          main.ts (composition root) · preload.ts (API bridge)
```

Tests sit next to the code: `derive.ts` → `derive.test.ts`.

## Ports (defined in `src/application/ports/`)

| Port | Responsibility |
| --- | --- |
| `AgentTransport` | Start a run, return an async stream of `AgentEvent`, deliver permission answers and steer notes, stop |
| `ProviderCatalog` | Discover CLIs: path, version, login state, capabilities, models |
| `QuotaProbe` | Query an account's pools and windows |
| `DefinitionStore` | Read roles, flows, capabilities, workspace, roadmap; apply an approved proposal |
| `WorkOrderRepo`, `RunRepo`, `PageRepo`, `ProposalRepo`, `AccountRepo` | Runtime state, one repository per aggregate |
| `EventLog` | Append-only audit: who, what, when, on which subject |
| `SecretVault` | API keys and tokens |
| `Vcs`, `Forge` | Worktrees, branches, diff, merge · pull requests and issues |
| `CommandRunner` | Run gate commands (tests, lint, secret scan) |
| `Clock`, `IdGen`, `Notifier` | Time (epoch ms), ULIDs, desktop notifications |

Every port has an in-memory fake in `src/application/ports/fakes/` used by application tests.

## API boundary (team-ready)

The presentation layer reaches the core only through `src/api/`: **commands** (e.g. `openWorkOrder`,
`decideGate`, `answerPermission`, `applyProposal`), **queries** (e.g. `cockpit`, `workspaceBoard`,
`workOrderDetail`), and an **event subscription**. Today the transport is Electron IPC via
`electron/preload.ts`; later the same contract can be served over HTTP for a team server or the
mobile app. Contracts are plain JSON-serialisable types — no class instances, no functions.

## Team-ready rules (cheap now, a rewrite later)

1. Every write carries an `Actor` (`user` / `agent` / `system`) and lands in the `EventLog`.
2. Runtime ids are ULIDs; all times are UTC epoch milliseconds in the domain and ISO-8601 UTC at the
   edges. Two machines' data can be merged without collisions.
3. Storage is behind ports; the domain never knows it is SQLite.
4. An approval records who approved; a gate may later declare who is allowed to approve.
5. Definitions live in git, so sharing them with a team already works.

## Security rules

- Secrets live only in the OS keychain. Records, logs, events, and proposals never contain secret
  values or environment variable values; they may name targets (paths, commands).
- Agent-produced pages are untrusted content (see [pages.md](pages.md)).
- No third-party source code is copied into this repository. Integrations are written from the
  CLIs' and protocols' own documentation.
