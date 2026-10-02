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
| `acp` | Agent Client Protocol agents (Copilot, Cursor, opencode, Kimi, Kiro, Qwen, Mistral Vibe, Goose, Droid, …) | `initialize` → `session/new` / `session/load` → `session/prompt`; `session/update` notifications; `session/request_permission` must be **answered by the user**, never auto-approved |
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
  config: { readonly mechanism: 'env-var' | 'flag'; readonly name: string } | { readonly mechanism: 'none' }; // how the run-scoped config dir is passed; 'none' when the CLI's only config dir is the home that holds its login (P-44)
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
  readonly effort?: EffortLevel;                  // already clamped to the model (R-50, A-46)
  readonly model?: string;                        // the route's model, so a `model-suffix` effort can build the id (P-43)
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

1. **Prompt via stdin or a file, never argv** (argv limits break long prompts). The app-server and acp
   transports carry the prompt inside their protocol envelope — still never argv.
2. **Per-run isolated configuration.** MCP servers, skills and hooks for the run are written to a
   run-scoped directory and passed with the CLI's own mechanism (e.g. a config-dir environment
   variable, `--mcp-config`, `-c mcp_servers.*`, ACP `session/new.mcpServers`). The user's own
   `~/.claude`, `~/.codex`, `~/.gemini` files are **never written**.
3. **Billing mode is Docket's decision.** The run environment is built from an allowlist; a stray
   `ANTHROPIC_API_KEY` (or similar) is removed unless the chosen account is that API key.
4. **Kill the whole process group** on stop; inactivity and first-output watchdogs per provider.
   A watchdog that fires stops the run and emits `error` with `class: 'timeout'` and
   `reason: 'first_output_timeout' | 'inactivity_timeout'`, then `finished` with `reason: 'failed'`.
   The timers are paused while a permission question is unanswered and while a tool call is in flight.
5. **Resume:** `specify` (Docket passes a session id), `capture` (read it from the stream),
   `protocol` (`session/load`, thread resume). If resume fails, start fresh with a summary of the
   previous transcript.

Subscription identity on the SDK leg (no per-run config directory today) is specified in provider-capabilities.md (P-32).

## Support tiers

The support level (P-28, `supportLevel` over the capability record) decides the behaviour:

| Level | Condition | Behaviour |
| --- | --- | --- |
| `full` | structured stream + permission asks that really wait | Live approvals, write-scope enforcement by denial |
| `isolated` | structured stream, no reliable permission asks | Runs freely inside its own worktree; changes reach the main line only through the diff gate with human approval |
| `experimental` | plain text | Like isolated, but no tool or cost visibility; the UI says so |

Whether each ACP agent's `session/request_permission` really blocks until answered is verified by a
Phase 0 probe per agent. Agents that do not block drop to `isolated`.

The tier shown to users is derived from the capability record described in [provider-capabilities.md](provider-capabilities.md) (P-27, P-28); the model catalog, routes and account discovery are specified there.

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
  (app-server), `agy` (stream-json, dialect `agy`), `copilot`, `cursor`, `opencode` (acp).
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
  capabilities data, not code.) A user's `allow` answers with the agent's one-time option
  (`allow_once`); a standing grant (`allow_session`, `allow_always`) is never chosen on the user's
  behalf, and when the agent offers no one-time option the answer is `cancelled`.
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
- **P-25a** A built-in definition whose provider has no mark file carries `mark: null`; the marks test lists those ids explicitly, so a missing mark is a recorded fact, never an omission.
- **P-26** A mark carries the fill rule its file declares: `nonzero` for the five official
  marks, `evenodd` for the two placed files (both set `fill-rule="evenodd"`; the codex path also
  `clip-rule="evenodd"`, carried by the same `fillRule`). The rule travels through the marks
  query untouched (A-42) — a renderer never guesses it, since the same `d` renders differently
  under the two rules.

## Thinking levels and model ids (P-41, P-42)

Design: [provider-capabilities.md](provider-capabilities.md) §3–§4.

- **P-41** `buildLaunch` turns `LaunchInput.effort` into the provider's own parameter, defined as data in the definition (`effortArg`, from the CLI's own documentation or help output): a flag with the level as its value, a config key, or a session option; the ACP and app-server transports send it through their session or turn request instead of argv. An absent effort adds nothing. A definition without an effort parameter ignores the effort and never fails the launch. A transport that reports reasoning or thinking token counts maps them to the `usage` event's `reasoningTokens`, still counted inside `outputTokens`.
- **P-42** Live model ids resolve to registry records: `LiveModel` carries `resolvedId?` (the canonical id an alias row stands for, as the provider reports it) and `isDefault?: true` (the row the provider uses when no model is pinned). Matching uses `canonicalModelId(resolvedId ?? id)`, which drops one trailing bracketed variant (`[...]`) and one trailing `-YYYYMMDD` date, compared with the record's `canonicalModelId(id)`; family patterns test `resolvedId ?? id`. Billing of a live row, first answer wins: the row's own `billing`; the matched record's `billing`; the route kind's `familyBilling` (data: `{ contains, billing }[]`, matched like family patterns); the route kind's `defaultBilling`; `unknown`. The selectable id stays the row's own `id` (an alias row stays an alias); `isDefault` and `resolvedId` travel to the merged entry (`CatalogModel.resolvedId?`), so quota matching can use the id an alias stands for (A-20). A subscription route kind lists in `familyBilling` only the families the provider's plan documentation covers on every plan; a family that splits per plan is left out and stays `unknown` until the account's own quota report settles it (`billingFromPools`).

## Capability record, routes and spend safety (P-27 … P-40, P-46; P-41 … P-45 sit in their own sections)

Design and evidence: [provider-capabilities.md](provider-capabilities.md), one section per rule. The rules below are the testable statements.

- **P-27** The capability registry (`registry/capability-registry.ts`) is the only table of providers, route kinds and models; it is plain data checked with `satisfies` against the domain types, and every derived value (support level, thinking options, tier) is a pure function over it.
- **P-28** `supportLevel` derives `planned | experimental | isolated | full` from the six gates exactly as provider-capabilities.md §2 states; `planned` is the only hand-set level and `full` requires a recorded operator run.
- **P-29** A route's catalog is live ∪ bundled, cached per account and route kind; a failed refresh keeps the last good list marked stale; `liveIsAuthoritative` drops bundled models the live list lacks; an unknown live id stays selectable with unknown capabilities.
- **P-30** Fast / Balanced / Deep map to a model's own effort levels through `thinkingFor` (R-50 for exact efforts); a model with `thinking: none` offers no level.
- **P-31** An account's route fields (`routeKind`, `endpoint`, `identityDir`, `tierModels`) are non-secret; `saveAccount` rejects an endpoint whose host differs from the route kind's preset host and an `identityDir` on a non-subscription route kind.
- **P-32** A subscription account with `identityDir` passes it to the child as the config-directory variable; Docket never writes into it and never reads credential values from it.
- **P-33** Local account discovery proposes candidates from key names and the endpoint host only; a candidate never carries a value other than the endpoint host, and adopting one never imports a token without explicit consent.
- **P-34** Quota is probed per route kind (`quotaProbe`); a failed probe makes quota `unknown` without blocking the run; the cost kind is per route (`equivalent` for subscriptions and presets, `reported` or `computed` for API keys, `credits` where the provider meters credits).
- **P-35** A new provider that fits an existing transport is a definition plus its argument builder; it enters as `experimental` or `isolated` and is promoted only through the gates.
- **P-36** The README provider matrix is generated from the registry between marker comments, and a test fails on any difference.
- **P-37** The effective instructions of a run are the instruction files the chosen provider reads natively plus the Docket layers; a repo instruction file the provider does not read natively is inlined at the start of the prompt within the prompt budget; nothing is written to the repo. The native set is registry **data** — the provider's best-known set, not a fixed law of the CLI: some CLIs make the set configurable (a fallback-filename list can add `CLAUDE.md`, a context-file setting can rename it), so a file the CLI reads natively but the row does not list is inlined too (rules delivered twice beat rules lost), and the row for the CLI that loads an automatic project memory even with setting sources off names that memory in its set (it lives outside the repo, so it is never an inline candidate). The application contract is [application.md](application.md) → "Instructions, checkpoints, handoff (#581)" (**A-53 … A-56**; the pure core is R-53, R-54 in [domain.md](domain.md) §11).
- **P-38** A run that continues on another provider starts from a handoff pack Docket assembles (stage prompt, effective instructions, derived task state, the same worktree with checkpoint commits, a bounded rolling summary); native resume is never mixed with the pack; raw transcripts do not travel. The application contract is [application.md](application.md) → "Instructions, checkpoints, handoff (#581)" (**A-57 … A-65**, acceptance §7; the pure core is R-55 … R-57 in [domain.md](domain.md) §11).
- **P-39** Quota parsers turn any reported bucket into meters with the provider's own label, window, remaining share, reset and unit; bucket applicability is data (quota.md "Bucket applicability"); an unknown bucket never blocks; an unreadable payload reports `probe_failed` naming field names, never values.
- **P-40** Every route and model has billing `included | metered | unknown`; `unknown` is never assumed free and shows `?`; tier resolution and limit-driven switches never pick a non-included model; a non-included model runs only with the user's consent and a spend cap (`needs_spend_consent` otherwise).
- **P-46** A handoff continuation (P-38) never starts on a route whose model billing is `unknown` without the user's consent and a spend cap on the account: the continuation run passes the same preflight as any run (`needs_spend_consent`), and an automatic fallback treats an `unknown`-billing candidate exactly like a `metered` one — skipped. The pack changes the provider, never the money boundary (P-40).

## Candidate providers: effort, isolation, discovery safety (P-43 … P-45)

Design: [provider-capabilities.md](provider-capabilities.md) §9.

- **P-43** `EffortArg` covers how candidates take an effort: `flag` (argv), `request-field` (turn or thread request), `session-option` (an ACP config option, named by its `category` or its `configId`), and `model-suffix` (the level joins the model id with the definition's `separator`, e.g. `<model>/<level>`; the effort then never travels separately). A definition may carry `levelNames`, a map from `EffortLevel` to the provider's own value names (e.g. `none` ↔ `off`); when a definition has `levelNames`, only the mapped levels are sent or offered (catalogs read advertised levels through the reverse map); without it, provider values that equal an `EffortLevel` are used as is and others are never offered. Unmapped effort → nothing is sent (never a guessed name).
- **P-44** A definition declares how the CLI is kept from reading the user's configuration of other tools (instruction files, skills, hooks, MCP servers of another agent): an environment variable, a flag or a run-scoped home directory, plus the CLI's own telemetry-off flag where one exists. A definition that cannot declare such isolation is capped at `experimental` and its runs show that the CLI may read the user's other tool configuration. A CLI whose login lives in its own home directory never gets that home redirected to the run directory (the login would be lost) and never gets it set to the user's real home either: its `config.mechanism` is `'none'` and the variable is left unset, until an operator run proves that a run-scoped home keeps the login.
- **P-45** Discovery runs only probes that are safe without a login: a definition marks commands that may open a browser, start a login flow or need an account (`needsLogin`); discovery runs them only when the login probe returned `loggedIn === true`, never when it is `false` or `null`. A model-list command marked `needsLogin` is skipped while logged out and the catalog falls back to bundled data; the catalog takes `loggedIn` from the account's latest discovery result, and a definition with any `needsLogin` command is not added to the built-ins until that value reaches the catalog.

