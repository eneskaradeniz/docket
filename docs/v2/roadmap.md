# Roadmap, issue contract, and batch mode

## Phases (GitHub milestones)

| Milestone | Scope | Done when |
| --- | --- | --- |
| **v2 · Phase 0 — Preparation** | Design docs, layer checks, folder scaffold, probes, rename (later) | Scaffold passes CI; probe results recorded |
| **v2 · Phase 1 — Domain core** | `src/domain/` per [domain.md](domain.md) | Every R-rule has a test; v1 parity scenarios pass |
| **v2 · Phase 2 — Application & storage** | Use cases, ports + fakes, SQLite repositories, YAML definition store, keychain, event log, API boundary, Claude SDK transport; 2c: environments, deploy and remote-check gates, `Forge`/`IssueTracker` ports ([integrations.md](integrations.md)) | A headless test runs a work order end to end |
| **v2 · Phase 3 — Providers** | Discovery, stream-json, Codex app-server, ACP, quota probes, per-run isolated capabilities, GitHub `Forge` adapter | Claude, Codex and one ACP agent run the same work order |
| **v2 · Phase 4 — UI & parity** | Shell, wizard, cockpit, workspace board, work-order detail, live pane, settings, secret-scan gate, environments and deploy approval. TODO: remove v1 module augmentations that widen SDK interfaces (unblocks SDK transport test stub cleanup). | v1 parity → v1 code removed |
| **v2 · Phase 5 — Roadmap & dispatcher** | Task dependencies, "run phase", auto-resume after quota, pool switching, fallback chain, remote-check polling, tracker import and write-back | A phase advances unattended |
| **v2 · Phase 6 — Pages & chat** | Docket MCP server, page viewer, page-approval gate, chat at three scopes, proposals | "Add a test role" approved from chat as a diff |
| **v2 · Phase 7 — Companion & library** | New project from scratch, role/flow library, security gates | From an empty machine to a running project |
| **v2 · Phase 8 — Mobile** | Free local-network mobile app: attention inbox, approvals, live view | A gate approved from the phone |
| **v2 · Phase 9 — Integrations** | `Forge` and `IssueTracker` adapters: Bitbucket, Azure DevOps, GitLab, Jira, Odoo Project, GitHub Issues | Each platform passes its adapter tests; one workspace runs on Bitbucket + Jira |

Team features and off-LAN remote access are out of scope for now.

## Labels

| Label | Meaning |
| --- | --- |
| `v2` | Part of the v2 rebuild |
| `phase:N` | Milestone shorthand |
| `model:glm-5.3` | Implement with the strong model (Claude Code `opus` slot) |
| `model:flash` | Implement with the fast model (Claude Code `sonnet` slot); escalate to `glm-5.3` after one failed attempt |
| `wave:N` | Batch-mode ordering: all issues of wave N depend only on waves < N |
| `type:epic` | A phase-level tracking issue; broken down later by the architect |
| `type:probe` | Needs a logged-in CLI or a human; never run in batch mode |
| `owner:operator` | Only the operator can do it |
| `needs-architect` | Blocked on a design question; do not work around it |

## Model routing — how the label is chosen

- `glm-5.3`: state machines and decision rules with many interacting rules (flow engine, dispatcher,
  limit policy, quota headroom, roadmap derivation, definition validation), and anything a flash
  attempt failed.
- `flash`: small, well-specified modules with few rules (ids, budget, proposal, capabilities, gates,
  resolver, event folding, built-in data), UI components, label bundles, mechanical refactors.

## Issue contract

Every implementation issue has these sections (see `.github/ISSUE_TEMPLATE/v2-task.md`):
Goal · Phase / Model / Wave · Depends on · Context · Scope · Out of scope · Test location · Interfaces ·
Acceptance · Tests · Touches · Manual check · Done when. The **Interfaces** section is copied from
[domain.md](domain.md) (or the phase's contract doc) and is not to be changed by the implementer.

## Batch mode (unattended runs)

Used for phases without UI (Phase 1, most of Phase 2). The operator reviews the result in the
morning. Rules:

1. **Integration branch `v2`.** Each issue gets a branch `v2-<issue>-<slug>` from the latest
   `origin/v2` and a PR **into `v2`** (never into `main`).
2. One subagent per issue, in its own git worktree, with the model from the issue's label. Waves run
   in order; inside a wave at most 3 issues in parallel.
3. A subagent writes the tests for every R-rule first, then the code, then runs
   `npm run typecheck && npm test && npm run check:boundaries`. It may change only its own module
   folder (plus its tests).
4. The orchestrator merges a PR into `v2` only when CI is green (`gh pr merge --squash
   --delete-branch`), then closes the issue with a short comment (issues do not auto-close on
   non-default branches).
5. A `flash` issue that fails once is retried once with `glm-5.3`. A second failure → comment the
   reason, add `needs-architect`, and skip the issues that depend on it.
6. Never: push or merge to `main`, force-push, delete branches other than its own, edit
   `docs/v2/**` or `CLAUDE.md`, change a contract from domain.md, add npm dependencies.
7. At the end: open (or update) a PR `v2 → main` titled "v2: batch run <date>" with the list of merged
   issues, skipped issues and reasons. The operator merges it after review.
8. On a usage-limit error: finish the current step, write the progress comment on the PR, and stop.
