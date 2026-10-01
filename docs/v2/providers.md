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
  config: { readonly mechanism: 'env-var' | 'flag'; readonly name: string }; // how the run-scoped config dir is passed
  buildLaunch(input: LaunchInput): { args: string[]; env: Record<string, string>; stdin: 'prompt' | 'none' };
  resume: 'specify' | 'capture' | 'protocol' | 'none';
  capabilities: ProviderCapabilities;           // declared; refined by probes at discovery
  installHint: { url: string };
  mark: ProviderMark | null;                    // the provider's own mark, with its fill rule; null when no file exists — never redrawn
}

`buildLaunch` receives a `LaunchInput`:

```ts
interface LaunchInput {
  readonly prompt: string;                        // travels via stdin/envelope, never argv
  readonly configDir: string;                     // the run-scoped config dir (launch module)
  readonly resume?: { readonly sessionRef: string };
}
```
```

## Discovery

- Search `PATH` **plus** well-known toolchain directories (Homebrew, `~/.local/bin`, `~/.bun/bin`,
  npm global prefix, nvm/fnm/mise shims). GUI apps start with a thinner `PATH` than a login shell;
  the spawned process gets the same enriched `PATH`.
- A per-provider override (`DOCKET_<ID>_BIN`) wins over discovery.
- Probe exactly the path that will be spawned: version → optional flags from `--help` → auth probe.
  Results stream in per provider; one slow CLI never blocks the list.

## Launch rules

1. **Prompt via stdin or a file, never argv** (argv limits break long prompts). The app-server and acp
   transports carry the prompt inside their protocol envelope — still never argv.
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

Subscription identity on the SDK leg (no per-run config directory today) is specified in provider-capabilities.md (P-31).

## Support tiers

`supportTier()` (domain) derives the tier from capabilities:

| Tier | Condition | Behaviour |
| --- | --- | --- |
| `full` | structured stream + permission asks that really wait | Live approvals, write-scope enforcement by denial |
| `isolated` | structured stream, no reliable permission asks | Runs freely inside its own worktree; changes reach the main line only through the diff gate with human approval |
| `experimental` | plain text | Like isolated, but no tool or cost visibility; the UI says so |

Whether each ACP agent's `session/request_permission` really blocks until answered is verified by a
Phase 0 probe per agent. Agents that do not block drop to `isolated`.

The tier shown to users is derived from the capability record described in [provider-capabilities.md](provider-capabilities.md) (P-26, P-27); the model catalog, routes and account discovery are specified there.

---

## Phase 3 contracts

All Phase 3 rules carry the **P-n** prefix and live in this document (tests: `it('P-n: …')`, colocated
with the owning module under `src/infrastructure/providers/`, `src/application/` or `src/api/`).
Signatures that belong to the application layer are repeated in
[application.md](application.md); when the two disagree, this document wins for rule text,
application.md for signatures.

### Provider definitions (P-1)

- **P-1** Every built-in definition in `src/infrastructure/providers/defs/` is plain data (no imports
  beyond types), passes `isProviderDef` (ids unique across defs; `bins` and `versionArgs` non-empty;
  `transport` one of the four; `streamDialect` present exactly when `transport === 'stream-json'`;
  `config.mechanism` matches how the CLI accepts a config dir), and `buildLaunch` never places the
  prompt in `argv` — `stdin: 'prompt'` carries it. Initial set: `claude-code` (sdk), `codex`
  (app-server), `agy` (stream-json, dialect `agy`), `gemini`, `copilot`, `cursor`, `opencode` (acp).
  Flag accuracy is data, verified by operator probes; a wrong flag is a data fix, not a contract change.

### Discovery (P-2 … P-6)

Port (application, `ports/provider-discovery.ts`); implementation in
`src/infrastructure/providers/discovery/`:

```ts
export interface DiscoveredProvider {
  readonly defId: string;
  readonly binPath: string | null;      // null = not found on this machine
  readonly version: string | null;      // null = probe failed or not defined
  readonly loggedIn: boolean | null;    // null = no authProbe defined
  readonly optionalFlags: readonly string[]; // only the ones --help lists
}
export interface ProviderDiscovery {
  discover(onResult: (r: DiscoveredProvider) => void): Promise<void>;
}
```

- **P-2** The override `DOCKET_<ID>_BIN` (def id upper-cased, `-` → `_`) wins over every search path;
  an override naming a non-existent file reports `binPath: null`, never falls back to search.
- **P-3** Search covers `PATH` plus the well-known toolchain directories (Homebrew prefix,
  `~/.local/bin`, `~/.bun/bin`, npm global prefix bin, nvm/fnm/mise shim dirs). First existing
  candidate wins. The enriched `PATH` is what the spawned process receives.
- **P-4** Probes (version → `--help` flags → auth) run on exactly the resolved path, once each, each
  under a timeout. A probe that fails or times out leaves its field `null`; the provider is still
  reported with whatever succeeded.
- **P-5** An `optionalFlags` entry is enabled only when the `helpArgs` output (stdout and stderr)
  contains the flag.
- **P-6** Results are delivered per provider as they complete; a slow or hanging binary delays only
  its own entry, never the others.

The same module provides the transport factory used by the composition root: it maps a def (plus the
discovered binary) to an `AgentTransport` instance and implements `TransportResolver` by reading the
account's `provider` field.

### Launch isolation (P-7, P-8)

`src/infrastructure/providers/launch/`:

- **P-7** Everything a run writes (run-scoped config dir, MCP/skills/hooks files) stays inside the
  run's own directory. Given sentinel copies of `~/.claude`, `~/.codex`, `~/.gemini` as `HOME`, a
  launch leaves them byte-identical.
- **P-8** The child environment is built from an allowlist (the provider's own variables plus the
  chosen account's values). A stray `ANTHROPIC_API_KEY` (or any credential-shaped variable of another
  account) is dropped unless the account being used is exactly that key.

### stream-json transport (P-9 … P-11)

`src/infrastructure/providers/transports/stream-json/`:

```ts
export interface StreamDialect {
  readonly id: string;
  parse(line: unknown): readonly AgentEvent[] | null;  // null = no event
}
export function createStreamJsonTransport(def: ProviderDef, dialect: StreamDialect): AgentTransport;
```

- **P-9** Framing splits stdout into lines; each line is JSON-parsed and handed to the dialect. A
  line that fails to parse — or a parsed object the dialect does not recognise — becomes a `raw`
  event; parsing never throws into the event stream.
- **P-10** A run produces exactly one `finished` event. If the child exits (any code, any signal) or
  the stream closes without the dialect emitting one, the transport synthesises a failed `finished`.
- **P-11** The `agy` dialect maps the recorded print-mode transcript (fixtures under
  `dialects/agy/fixtures/`, captured by the operator, see the probe issue) to `AgentEvent`s: text
  output → message events, tool activity → tool events, final statistics → usage + `finished`.

### Codex app-server transport (P-12 … P-14)

`src/infrastructure/providers/transports/app-server/` — a JSON-RPC 2.0 client over the child's
stdio, written from the protocol's own documentation. The tests drive a scripted fake server process;
no Codex install is needed.

- **P-12** Lifecycle: initialize handshake → thread creation → prompt. Requests and notifications the
  client does not know are ignored (logged), never fatal; the client answers only requests the
  protocol requires it to answer.
- **P-13** An approval request becomes a `permission_ask`; the user's answer is delivered as the
  JSON-RPC response. Nothing is ever auto-approved; `stop()` answers `deny`.
- **P-14** Rate-limit reads and updates map to `quota_signal` meter readings per the Codex row of
  [quota.md](quota.md) (primary ≈5h / secondary ≈weekly, windows from `windowDurationMins`, exact
  resets).

### ACP transport (P-15 … P-17)

`src/infrastructure/providers/transports/acp/` — an Agent Client Protocol client over stdio, written
from the public ACP specification. Tests drive a scripted fake agent process.

- **P-15** Session lifecycle: `initialize` → `session/new` (carrying the run-scoped config) →
  `session/prompt`. `session/update` notifications map to `AgentEvent`s; an update kind the client
  does not know becomes a `raw` event, never an error.
- **P-16** `session/request_permission` becomes a `permission_ask` and the agent is expected to wait;
  the client never auto-approves. The only automated answer is `deny`, sent by `stop()`. (Whether a
  given CLI really waits is probe #139's table; non-blocking agents drop to `isolated` via
  capabilities data, not code.)
- **P-17** Resume uses `session/load` with the captured session id. If loading fails, the client
  starts a fresh `session/new` and prefixes the prompt with a bounded summary of the previous
  transcript.

### Quota probes (P-18 … P-21)

Port (application, `ports/quota-probe.ts`); use case `pollQuota`; parsers in
`src/infrastructure/providers/quota/`:

```ts
export type QuotaProbeError = 'not_installed' | 'not_logged_in' | 'probe_failed' | 'unknown_provider';
export interface MeterReading {          // id-free observation; ids are assigned when persisting
  readonly pool: { readonly label: string; readonly kind: PoolKind; readonly appliesTo: readonly ModelMatcher[] | 'all' };
  readonly meter: Omit<Meter, 'id' | 'poolId'>;
}
export interface QuotaProbe {
  poll(defId: string, binPath: string | null): Promise<Result<readonly MeterReading[], QuotaProbeError>>;
}
export interface QuotaProbeResolver { forProvider(defId: string): QuotaProbe | undefined }
```

- **P-18** `pollQuota(deps: Pick<AppDeps, 'clock' | 'ids' | 'log' | 'accounts'>, probes, input:
  { accountId })` resolves the account's provider, polls, reconciles readings with the stored pools
  (a reading reuses stored ids when pool label, meter label and meter duration all match — otherwise a
  new id), persists via `savePools`/`saveMeter`, and returns the saved meters. Every failure path is a
  `Result` error; the use case never throws.
- **P-19** The `agy` probe parses `/usage` print-mode JSON exactly per [quota.md](quota.md): group →
  pool (`label` = name, model matchers only from the model list in the description, verbatim), bucket
  → meter (`unit: 'fraction'`, `remaining`, `resetsAt`, `resetPrecision: 'exact'`,
  `source: 'polled'`); the payload may arrive on stdout or stderr — both are read; `durationMs` is
  set only from a value the CLI itself states, never derived from the window name.
- **P-20** The `codex` probe reads rate limits through the app-server connection and maps
  primary/secondary windows (from `windowDurationMins`) to meters with exact resets, `source: 'polled'`.
- **P-21** The `claude-code` probe maps SDK `get_usage` output to meters, applying the scale pitfall:
  `get_usage` utilization is 0–100 while pushed `rate_limit_event` is 0–1 — both normalise to the same
  meter scale; resets are `exact`; a stored `resetsAt` is never trusted without this poll.

### Resume fallback (P-22)

- **P-22** When a run is started with a `resume` reference and the transport cannot resume (detected
  as a start that fails while a resume reference was passed — the fixed `TransportError` union has no
  dedicated resume code), the executor restarts the run **once** without resume, prefixing the
  prompt with a bounded summary of the previous transcript (built from the stored events). A second
  resume-or-restart failure fails the run; there is no loop.

### GitHub Forge adapter (P-23)

`src/infrastructure/forge/github.ts`, implementing the `Forge` port through the `gh` CLI (no npm
dependency; the command runner is injected so tests script it):

- **P-23** Capabilities are probed once (`gh` present + authenticated → pull requests and checks);
  `checks` map to `CheckRun` statuses including `skipped`; failures map to `ForgeError` (`auth` for
  auth failures, `rate_limited` for 429, `network` for connection errors, `not_found` for missing
  resources); merge never happens without the port's explicit call.

### Acceptance (P-24)

- **P-24** The Phase 3 headless scenario (`src/infrastructure/scenarios/providers.test.ts`) runs the
  same work order to completion three times — through the sdk transport (scripted SDK session), the
  app-server transport (fake server) and the ACP transport (fake agent). The engine and use-case code
  path is identical across the legs: the same audit-trail action sequence, the same succeeded stage
  runs, the work order reaching `done`. Each leg emits the same **common** event kinds over the shared
  `AgentEvent` stream (`session_started → text → usage → finished`) and exactly one `finished`
  (reason `completed`, last event) per stage run; transport-specific kinds beyond the common set are
  expected and do not count against equality.

---

## Provider marks (P-25)

Port (application, `ports/provider-marks.ts`); the built-in implementation sits beside the defs
(`src/infrastructure/providers/defs/builtin-provider-marks.ts`) and the composition root hands it
to `createApi` as its marks argument (the discovery pattern; the query side is A-41 in
[application.md](application.md)):

```ts
export interface ProviderMark {
  readonly viewBox: string;
  readonly path: string;
  readonly fillRule: 'nonzero' | 'evenodd';
}
export interface ProviderMarks { marks(): Record<string, ProviderMark | null> }
```

- **P-25** Every built-in definition carries `mark`: the provider's own mark as one SVG path —
  `d` data copied unmodified from the file it came from, rendered with `currentColor`,
  24×24 viewBox — or `null` when no file exists; a mark is never redrawn. All seven built-ins
  have a mark: the five with an official file plus `codex` and `agy`, whose files were placed by
  the operator from an MIT-licensed icon set (the marks remain their owners' trademarks, used
  unmodified only to identify the provider; they are not the owners' official brand kits — if
  official files arrive, only the def's path changes). The marks identify the provider only.
  `isProviderDef` rejects a mark that is neither `null` nor a `{ viewBox, path, fillRule }` of
  non-empty strings with a known fill rule, and `builtinProviderMarks` keys every built-in def
  id to its own mark, so adding a provider touches no code beyond its def.
- **P-26** A mark carries the fill rule its file declares: `nonzero` for the five official
  marks, `evenodd` for the two placed files (both set `fill-rule="evenodd"`; the codex path also
  `clip-rule="evenodd"`, carried by the same `fillRule`). The rule travels through the marks
  query untouched (A-42) — a renderer never guesses it, since the same `d` renders differently
  under the two rules.
