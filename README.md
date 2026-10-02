# Docket

A desktop app that runs AI coding-agent CLIs (Claude Code, Codex, Copilot, and others) through a flow
you define — roles, stages, gates, budgets — and keeps every step visible and approved.

**Status: v2 redesign in progress (2026-09-26).** The design is being written and approved before any
v2 code lands. The previous version is preserved at tag [`v1-final`](../../tree/v1-final).

## What v2 is

- **Configurable, with defaults.** Roles, flows, gates and capabilities (MCP servers, skills, hooks)
  are defined by the user; a first-run wizard sets up sensible defaults in minutes.
- **Many providers.** Agent CLIs are discovered automatically; each account is either a subscription
  (windowed quotas, auto-resume after reset) or pay-per-token (spend caps).
- **Roadmap and parallel work.** Phases and tasks plan the work; several work orders run at once,
  across workspaces, each in its own working copy.
- **The human decides the irreversible.** Merges, deploys and configuration changes proposed by AI
  always pass through the user's approval.

## Development

```bash
npm install
npm run dev          # launch the app (still v1 until v2 replaces it)
npm test
npm run typecheck
npm run check:boundaries
```

Contributors and coding agents: read `CLAUDE.md` first.

## Providers

Agent CLIs Docket can run, with the route kinds of each. Support levels and model data come
from the capability registry; regenerate with `npm run gen:provider-matrix`.

<!-- provider-matrix:start -->
| Provider | Route kind | Models | Thinking | Context | Cost | Support level |
| --- | --- | --- | --- | --- | --- | --- |
| Claude Code (`claude-code`) | `anthropic-subscription` | `claude-opus-5-5` (strong), `claude-sonnet-5-5` (balanced), `claude-haiku-4-5` (fast) | `low`, `medium`, `high`, `xhigh`, `max` | — | equivalent | isolated |
| Claude Code (`claude-code`) | `anthropic-api` | — | — | — | reported | isolated |
| Claude Code (`claude-code`) | `zai-glm` | — | — | — | equivalent | isolated |
| Codex (`codex`) | — | — | — | — | — | experimental |
| Antigravity (`agy`) | — | — | — | — | — | experimental |
| Copilot CLI (`copilot`) | — | — | — | — | — | experimental |
| Cursor Agent (`cursor`) | — | — | — | — | — | experimental |
| opencode (`opencode`) | — | — | — | — | — | experimental |
<!-- provider-matrix:end -->

## License

[Apache License 2.0](LICENSE). Contributions: see [CONTRIBUTING.md](CONTRIBUTING.md). Security
reports: see [SECURITY.md](SECURITY.md).
