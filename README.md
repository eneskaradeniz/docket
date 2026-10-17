# Docket

A desktop app that runs AI coding-agent CLIs (Claude Code, Codex, Copilot, and others) through a flow
you define — roles, stages, gates, budgets — and keeps every step visible and approved.

**Status: v2 under active development.** The design lives in [`docs/v2/`](docs/v2/README.md). The
previous version is preserved at tag [`v1-final`](../../tree/v1-final).

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
npm run dev          # launch the app
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
| Claude Code (`claude-code`) | `anthropic-subscription` | `claude-opus-5-5` (strong), `claude-sonnet-5-5` (balanced), `claude-haiku-4-5` (fast) | `low`, `medium`, `high`, `xhigh`, `max` | — | equivalent | full |
| Claude Code (`claude-code`) | `anthropic-api` | — | — | — | reported | full |
| Claude Code (`claude-code`) | `zai-glm` | — | — | — | equivalent | full |
| Codex (`codex`) | `codex-subscription` | — | — | — | equivalent | experimental |
| Antigravity (`agy`) | `agy-subscription` | `gemini-4-argon-low` (strong), `gemini-4-argon-medium` (strong), `gemini-4-argon-high` (strong), `gemini-3.8-flash-low` (fast), `gemini-3.8-flash-medium` (fast), `gemini-3.8-flash-high` (fast), `claude-opus-5-5-low` (strong), `claude-opus-5-5-medium` (strong), `claude-opus-5-5-high` (strong), `claude-sonnet-5-5-low` (balanced), `claude-sonnet-5-5-medium` (balanced), `claude-sonnet-5-5-high` (balanced), `gpt-oss-120b-medium` (balanced) | `low`, `medium`, `high` | — | equivalent | isolated |
| Copilot CLI (`copilot`) | `copilot-subscription` | — | — | — | credits | experimental |
| Cursor Agent (`cursor`) | `cursor-subscription` | — | — | — | equivalent | experimental |
| opencode (`opencode`) | `opencode-subscription` | — | — | — | equivalent | experimental |
<!-- provider-matrix:end -->

### Bringing a provider back

Docket ships with the six verified providers in the matrix above; the other providers that were
tried during the launch phase were removed from the launch set. Their code, fixtures and evidence
stay at the git tag `providers-extended`. Bringing one back means one PR per provider, following
the promotion checklist in `docs/v2/provider-capabilities.md` §9 ("Adding a provider"). A provider
whose billing route is `metered` or `unknown` also needs an operator run with `--cap-usd` before
promotion (P-40).

## License

[Apache License 2.0](LICENSE). Contributions: see [CONTRIBUTING.md](CONTRIBUTING.md). Security
reports: see [SECURITY.md](SECURITY.md).
