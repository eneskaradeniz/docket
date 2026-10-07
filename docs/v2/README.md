# Docket v2 — design

Docket v2 runs AI coding-agent CLIs (Claude Code, Codex, Antigravity, and others) through a flow the
user defines — roles, stages, gates, budgets — and keeps every step visible and approved. It is a
local, single-user, free and open-source desktop app (Apache-2.0), built so that a team mode can be
added later without a rewrite.

This folder is the source of truth for v2. When code and these documents disagree, the documents win
until an architect change updates them.

| Document | What it fixes |
| --- | --- |
| [architecture.md](architecture.md) | Layers, folders, ports, the API boundary, team-ready rules, mechanical layer checks |
| [domain.md](domain.md) | The domain model and the exact TypeScript contracts for Phase 1 |
| [application.md](application.md) | Ports, use cases, services and API contracts for Phase 2a |
| [infrastructure.md](infrastructure.md) | Adapters for Phase 2b: SQLite, YAML definitions, keychain, git, gates, the SDK transport |
| [integrations.md](integrations.md) | Design (not yet contract): code hosting, issue trackers, environments, deployment, remote CI |
| [providers.md](providers.md) | Agent CLI integration: transports, the common event stream, support tiers, isolation |
| [provider-capabilities.md](provider-capabilities.md) | Provider and model capability record, routes, support levels, model catalog, account discovery |
| [quota.md](quota.md) | Accounts, pools, windows, limit policies, budgets |
| [ui.md](ui.md) | Phase 4 presentation layer: labels, stores, API additions, the operator gate |
| [pages.md](pages.md) | Visual pages produced by agents (artifacts), sandboxing |
| [roadmap.md](roadmap.md) | Phases, milestones, issue contract, model routing, batch mode |
| [layer-promotion.md](layer-promotion.md), [screen-contract-template.md](screen-contract-template.md) | Layer-by-layer v2 → main promotion (order, gates, dogfood ladder, sign-off); per-screen contract template (a11y + measurements, no screenshots) |

## Glossary

The UI speaks Turkish; code uses the English term.

| English (code) | Turkish (UI) | Meaning |
| --- | --- | --- |
| Provider | Sağlayıcı | An agent CLI installed on the machine (Claude Code, Codex, …) |
| Account | Hesap | A credential of a provider: subscription, API key, cloud, or BYOK |
| Pool | Havuz | A quota bucket of an account (e.g. a model group) |
| Meter / Window | Pencere | One limit of a pool (5-hour, weekly, monthly, …) |
| Capability | Yetenek | An MCP server, skill, hook, or context document attached to roles |
| Role | Rol | An agent identity: instructions, write scope, capabilities |
| Flow | Akış | Ordered stages a work order goes through |
| Stage | Aşama | One step of a flow; a role acts, then exit gates are checked |
| Gate | Kapı | An exit condition: human approval, command, agent verdict, secret scan, page approval |
| Project | Proje | A set of repos with one main repo: the roadmap, project-level defaults, the project budget ceiling |
| Repo | Depo | One repository of a project: overrides, enabled flows, environments, the repo budget limit |
| Main repo | Ana depo | The project's central repo: `.docket/project.yaml` and the roadmap live there |
| Roadmap / Phase / Task | Yol haritası / Faz / Görev | The plan, owned by the project; a task is a planning unit targeting one or more repos |
| Work order | İş emri | One execution of a flow in one repo, usually for a task |
| Run | Koşu | One execution of one stage by one role on one account (one agent session) |
| Record | Kayıt | Transcript, usage, quota observations, gate results, evidence |
| Dispatcher | Dağıtıcı | The single service every run passes through: queue, limits, resume |
| Conversation | Sohbet | Chat at global / repo / work-order scope; can only propose |
| Proposal | Öneri | The only way AI changes configuration: a diff the user approves |
| Environment | Ortam | A deployment target of a repo (dev, stg, prd, …) |
| Deployment | Yayına alma | One run of an environment's deploy commands for a commit, after human approval |
| Forge | Kod platformu | Where repositories are hosted: pull requests, CI checks (GitHub, Bitbucket, Azure, …) |
| Issue tracker | İş takip sistemi | External task system (Jira, Azure Boards, …) linked to roadmap tasks |
| Page | Sayfa | A visual artifact an agent publishes (mockup, diagram, report) |
| Actor | — | Who did something: `user`, `agent`, or `system` |

## Non-negotiable invariants

Everything else is configurable. These five are not.

1. **A human owns every irreversible step.** Merge, deploy, delete: no agent does them on its own.
2. **Permissions are enforced by the engine, not the prompt.** A role that may not write somewhere is
   blocked from writing there, or its changes cannot enter the main line without approval.
3. **Budget and quota are checked before every run.** No headroom → the run does not start. A running
   run is never killed for budget reasons.
4. **Every run is recorded.** Transcript, usage, evidence. Records never carry environment values,
   credentials, or provider keys.
5. **AI changes configuration only through a Proposal** the user sees as a diff and approves.

## Where things live

| Place | Content | Shared? |
| --- | --- | --- |
| `~/.docket/` | Global definitions (roles, flows, capabilities), `docket.db`, and the machine-local registry: which project's repos are cloned where | Machine-local |
| `<main-repo>/.docket/` | `project.yaml` (the project, incl. its budget ceiling), project-level role/flow defaults, `roadmap.yaml` | Versioned with the main repo |
| `<repo>/.docket/` | `repo.yaml` (the repo definition) and repo-level overrides | Versioned with the repo |
| `~/.docket/docket.db` | Projects, repo registrations, providers, accounts, role bindings, work orders, runs, records, quota observations, pages, proposals | Machine-local |
| OS keychain | API keys, tokens | Never written to files or the DB |
