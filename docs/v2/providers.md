# Providers — agent CLI integration

Every agent CLI is described by a **provider definition** (data) and driven by one of a few
**transports** (code). The engine and UI only see the common `AgentEvent` stream
([domain.md §11](domain.md#11-providers--capabilities-tiers-the-common-event-stream)); they never know
which CLI ran. Adding a CLI means adding a definition, not changing the engine.

All integration code is written from each CLI's and protocol's **own documentation and observed
behaviour**. No third-party source code is copied into this repository, and no third-party project is
named in code or comments.

## Transports (Phase 3)

| Transport | Used for | Notes |
| --- | --- | --- |
| `sdk` | Claude Code via the Agent SDK | Richest channel: permission callback, resume, usage, `rate_limit_event`, `get_usage` |
| `app-server` | Codex (`codex app-server`, JSON-RPC over stdio) | Streaming deltas, approval requests, `account/rateLimits/read` + `updated`, thread resume. Do **not** use `codex exec --json` (no quota, no streaming deltas) |
| `acp` | Agent Client Protocol agents (Gemini CLI, Copilot, Cursor, opencode, Kimi, Kiro, Qwen, Mistral Vibe, Goose, Droid, …) | `initialize` → `session/new` / `session/load` → `session/prompt`; `session/update` notifications; `session/request_permission` must be **answered by the user**, never auto-approved |
| `stream-json` | CLIs with a JSON-lines output mode but no ACP (e.g. Antigravity `agy`, Amp) | One parser per stream dialect |

Plain-text-only CLIs are supported in the `experimental` tier through `stream-json`'s raw passthrough
(every line becomes a `raw` event).

## Provider definition (data, `src/infrastructure/providers/defs/`)

```ts
interface ProviderDef {
  id: string;                    // 'claude-code', 'codex', 'agy', …
  displayName: string;           // shown as data in the UI
  bins: string[];                // candidate executable names, first found wins
  versionArgs: string[];
  authProbe?: { args: string[] };               // exit 0 = logged in
  helpArgs?: string[];                          // scanned (stdout + stderr) for optional flags
  optionalFlags?: Record<string, string>;       // flag → capability name, enabled only if --help lists it
  transport: 'sdk' | 'app-server' | 'acp' | 'stream-json';
  streamDialect?: string;                       // stream-json only
  buildLaunch(input: LaunchInput): { args: string[]; env: Record<string, string>; stdin: 'prompt' | 'none' };
  resume: 'specify' | 'capture' | 'protocol' | 'none';
  capabilities: ProviderCapabilities;           // declared; refined by probes at discovery
  installHint: { url: string };
}
```

## Discovery

- Search `PATH` **plus** well-known toolchain directories (Homebrew, `~/.local/bin`, `~/.bun/bin`,
  npm global prefix, nvm/fnm/mise shims). GUI apps start with a thinner `PATH` than a login shell;
  the spawned process gets the same enriched `PATH`.
- A per-provider override (`DOCKET_<ID>_BIN`) wins over discovery.
- Probe exactly the path that will be spawned: version → optional flags from `--help` → auth probe.
  Results stream in per provider; one slow CLI never blocks the list.

## Launch rules

1. **Prompt via stdin or a file, never argv** (argv limits break long prompts).
2. **Per-run isolated configuration.** MCP servers, skills and hooks for the run are written to a
   run-scoped directory and passed with the CLI's own mechanism (e.g. a config-dir environment
   variable, `--mcp-config`, `-c mcp_servers.*`, ACP `session/new.mcpServers`). The user's own
   `~/.claude`, `~/.codex`, `~/.gemini` files are **never written**.
3. **Billing mode is Docket's decision.** The run environment is built from an allowlist; a stray
   `ANTHROPIC_API_KEY` (or similar) is removed unless the chosen account is that API key.
4. **Kill the whole process group** on stop; inactivity and first-output watchdogs per provider.
5. **Resume:** `specify` (Docket passes a session id), `capture` (read it from the stream),
   `protocol` (`session/load`, thread resume). If resume fails, start fresh with a summary of the
   previous transcript.

## Support tiers

`supportTier()` (domain) derives the tier from capabilities:

| Tier | Condition | Behaviour |
| --- | --- | --- |
| `full` | structured stream + permission asks that really wait | Live approvals, write-scope enforcement by denial |
| `isolated` | structured stream, no reliable permission asks | Runs freely inside its own worktree; changes reach the main line only through the diff gate with human approval |
| `experimental` | plain text | Like isolated, but no tool or cost visibility; the UI says so |

Whether each ACP agent's `session/request_permission` really blocks until answered is verified by a
Phase 0 probe per agent. Agents that do not block drop to `isolated`.
