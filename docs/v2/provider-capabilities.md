# Provider capabilities and routes

Design, not yet contract. It extends `providers.md` and `quota.md`; where they
disagree, this file wins for the topics below and the other two are corrected in the same PR that
implements the change. Rule ids continue the `P-n` series; the rule-coverage check does not scan this
file, so each rule moves into `providers.md` together with its tests when it is implemented.

Vocabulary: a **provider** is an agent CLI (one definition). An **account** is a credential of a
provider. A **route** is an account plus a model (and, for compatible endpoints, an endpoint). Two
routes of one provider can differ in models, thinking, quota and cost, so capabilities attach to the
route, not to the provider alone. **Steering (P-61)** is recorded on the provider row because each
provider's transport is fixed in its definition today (every route kind of one provider rides the
same transport).

## 1. The capability record (P-27)
- One data file is the single source of truth: `src/infrastructure/providers/registry/capability-registry.ts`, plain `as const` data checked with `satisfies` against the domain types. The types and the pure derivations live in `src/domain/providers/capability.ts` (domain rules: no npm packages, no Node builtins, no classes). The data sits in infrastructure because vendor names are banned outside `src/infrastructure/providers/`; an application port `CapabilityCatalog` exposes route kinds to `saveAccount`.
- It holds, per provider: `planned` (manual flag), the six promotion gates (section 2) each with
  evidence, optional `steering` (`steerable` | `not_steerable`; absent reads `unknown` through
  `CapabilityCatalog.steeringSupport`), and its route kinds. Per route kind: auth mode, endpoint host (preset only), identity
  source, `tierModels`, cost kind, quota probe kind, model source, `liveIsAuthoritative` (a plan-scoped
  live list hides the registry models it does not contain). Per model: `id`, `family`, `tier`,
  `thinking`, `contextWindow?`, `retired?`, `billing?` (`included`, `metered` or `unknown`; see P-40).
- Everything derived from it is a pure function in the domain module: support level, thinking options
  for a model, tier resolution. The README matrix is generated from it (P-36). No second table exists.

`ProviderCapabilities` also gains `plugins` (the same tri-state as `mcp`, `hooks` and `skills`).

```ts
type Tier = 'strong' | 'balanced' | 'fast'
type EffortLevel = 'low' | 'medium' | 'high' | 'xhigh' | 'max'
type Thinking =
  | { readonly kind: 'none' }
  | { readonly kind: 'levels'; readonly levels: readonly EffortLevel[] }
// A token-budget variant is reserved in the union later; the first release implements none | levels only.
type SupportLevel = 'planned' | 'experimental' | 'isolated' | 'full'
type CostKind = 'reported' | 'computed' | 'equivalent' | 'none'   // as in ProviderCapabilities.costReport
```

## 2. Support levels and promotion to full (P-28)
A gate is passed only with evidence: a test name or a recorded scripted-agent scenario, or an operator
run id. A gate may be `waived` with a written reason (only G5). Nobody writes a level by hand except
`planned`.

| Gate | Condition | Evidence |
| --- | --- | --- |
| G1 Discovery | binary, version and login-state probes exist; `loggedIn` is not always `null` | discovery test |
| G2 Event mapping | text, tool call/result, usage, error and finished map to `AgentEvent`; unknown frames become `raw` | mapping tests |
| G3 Permission wait | on `permission_ask` the run stops and continues with the answer | scripted-agent scenario |
| G4 Usage visibility | `usage` event reaches the record with a cost kind | usage mapping test |
| G5 Quota probe | `quotaReport` is not `none`, or waived: provider reports no quota and a limit error maps to `limit_hit` | probe test or waiver text |
| G6 Tests | scripted-process scenario; the operator-gate run on the real CLI is recorded separately in `operatorRuns` and only `full` needs it | scenario name |

Level derivation (pure, replaces the tier computed from capabilities alone):
- `planned`: the manual flag is set.
- `experimental`: G1 or G2 is missing, or the stream is plain text passed through raw.
- `isolated`: G1, G2, G4 and G6 (scripted scenario) pass; G3 may be missing (the agent cannot ask; it runs sandboxed).
- `full`: G1–G5 pass (G5 may be waived), G6 passes, and at least one operator-gate run is recorded in `operatorRuns`.
`supportLevel` is the only derivation; the earlier capability-only tier function is removed.
Each provider's evidence for these gates — and for everything beyond them — is audited row by row in §16
(P-65).

## 3. Models and the catalog (P-29)
Four layers, merged per route:
1. **Bundled registry** (the data file): capabilities for known models. The only place that knows
   thinking levels, context window and price kind. The window is optional data: ten of nineteen
   surveyed providers expose none through any channel (six report nothing, four are unverified),
   and an absent value surfaces as `CatalogModel.contextWindow: null` — the merge keeps the
   unknown visible instead of guessing.
2. **Live list** per route: for Claude routes the SDK's own supported-models call (id, resolved id,
   display name, supported effort levels); for API-key routes the provider's documented model-list
   endpoint; for compatible endpoints the standard model list where it exists; for presets a fixed list.
3. **Merge:** live ∪ bundled. Each model carries its source (`live | bundled`). The cache is keyed by
   account and route, never by provider alone, so a plan-dependent list (for example a model only a
   higher subscription plan offers) never leaks to another account. A failed refresh keeps the last good
   list and marks it stale. When the route kind sets `liveIsAuthoritative`, bundled models missing from
   the live list are dropped instead of kept.
   Alias rows (a provider listing `default` or a family name instead of a full id) match the registry through the canonical id the provider reports for them (P-42 in providers.md).
4. **Unknown model:** never rejected. A live id missing from the registry is selectable with unknown
   capabilities: thinking control hidden, price unknown. If its family is recognised by id pattern it gets
   a tier automatically and is labelled auto-classified. `retired` models stay in the registry so old
   records still render.

The model source is data per provider: one of `sdk | app-server | acp-session | cli-command | api | static`.
Which source each CLI really offers is established per provider by a discovery spike, from the CLI's own
documentation and by running the installed CLI, and the result is written into the registry, not guessed.
Multi-vendor providers (Cursor, Copilot, OpenCode) list many models: the unknown-model rule applies and only
the most used models get full registry entries. Observed: on a plan limited to automatic model choice, one
provider's session lists only its automatic choice with three quality settings (efficiency, balance,
intelligence); the list is plan-scoped, so it is authoritative, and the registry's model entries for that
provider are not shown on such a plan.

Tier resolution: a route's strong/balanced/fast tier resolves to the highest-version available model of
that tier, unless the route kind fixes `tierModels` (compatible endpoints map them explicitly). A route may
map a tier to a provider-side quality setting instead of a model id (the automatic mode above maps strong,
balanced and fast to its intelligence, balance and efficiency settings); `tierModels` then holds the name
of that setting.
The registry is updated by Docket releases. Fetching the registry from the internet is out of scope until
the operator decides it (open decision O-4).

## 4. Thinking levels (P-30)
- The user sees Fast / Balanced / Deep. They map to the model's supported levels: Fast → lowest,
  Balanced → `medium` (else the nearest lower), Deep → the highest level up to `xhigh`; `max` is
  reachable only from advanced settings. The mapping table is data, not code. Effort sets are per model,
  never per provider: one model of a provider lists `ultra`, another has no `max`.
- A model with `thinking: none` hides the control and says the model offers no thinking level.
- The provider-specific parameter is produced by the definition's `buildLaunch`/transport from the chosen
  level; an unsupported level is clamped down, never sent.
- Thinking tokens are counted as output and shown as a separate usage line.
- Decided (2026-10-02): the choice lives on the role binding, one setting per role, mapped per model at run time (`RoleBinding.thinking`, `effortForChoice` R-50 in domain.md; provider parameters P-41 in providers.md).

## 5. Accounts and route kinds (P-31)
New account fields (all non-secret): `routeKind`, `endpoint?` (URL), `identityDir?` (path),
`tierModels?`. Secrets stay in the OS keychain behind `secretRef`; records never carry environment values.
Route kinds are data: `anthropic-subscription`, `anthropic-api`, and presets for compatible endpoints
(the GLM preset fixes the endpoint host, the three tier models, cost kind `equivalent`, quota probe
`http_monitor`). The definition builds the child environment from these fields (base URL, token, tier model
aliases); Docket never stores those environment values.

## 6. Subscription identity (P-32)
Finding: the SDK leg passes no config directory, so every subscription run falls back to the single
machine login. A second subscription account on the same machine cannot be selected.
Rule: a subscription account carries `identityDir`, the user's own config directory, passed to the child as
the config-directory variable. Verified: two directories give two different logins, and on macOS the CLI
keys its keychain entry to the directory path, so a copied directory loses the login and copying per run is
not an option. `settingSources` stays empty so the user's settings and hooks do not affect runs, but the
directory's own `env` settings still apply to the child, so a subscription directory must carry no endpoint
or token overrides; MCP servers stay inline. Docket itself never writes into `identityDir` and never reads
credential values from it. The CLI's own session storage under `identityDir` is accepted (O-2 resolved): it
keeps native resume working; a one-off run that does not need resume may turn persistence off. On Linux the
CLI keeps its credentials file inside `identityDir`: Docket treats the directory as sensitive and never
copies it.

## 7. Local account discovery (P-33)
- A port `AccountDiscovery` scans the user's home for Claude-style config directories and proposes
  **candidates**; it never adds an account silently.
- Classification uses only key names and the endpoint host: an endpoint host matching a preset → that
  preset; an OAuth account present → subscription; neither → ignored (side-tool directories).
- Credential values are never read into Docket's records or logs. Importing a token is a separate step
  with explicit consent that moves the value into the keychain.
- A directory whose own settings set an endpoint or token override is classified by those settings, never
  as a subscription; a subscription candidate that carries such overrides is shown with a warning.
- Several accounts of one provider are normal: each is its own candidate and its own route.

## 8. Quota and cost per route (P-34)
- Subscription: SDK usage query and rate-limit events, as today (`claude-probe`).
- Compatible-endpoint preset (GLM): an HTTP quota probe against the provider's monitor endpoint with the
  account token. **The endpoint is observed behaviour of the operator's own tooling, not a published
  contract; it can change.** Failure → quota `unknown`, the run is not blocked; spend caps and 429 mapping
  to `limit_hit` still protect. Response windows map to meters: the 5-hour token window and the monthly
  tool window. Cache 60 s, show the last good value with a stale mark. The observed endpoint reports no weekly window (quota.md lists one; the probe issue confirms).
- Cost kind per route: subscription `equivalent`; API key `reported` when the SDK reports it, otherwise
  `computed` from the registry price table (labelled estimate); GLM preset `equivalent`. The Anthropic
  price table never applies to a compatible endpoint.
- Antigravity reports two quota pools (a Gemini family and a Claude family). The registry maps each model to
  a pool through the existing `Pool.appliesTo` matchers (`quota.md`), so choosing a model selects the pool
  whose headroom is checked.
- A provider may meter usage in credits (one documents 1 credit = $0.01, token based; its quota snapshot carries entitlement counts and percentages, spend arrives as nano units on the usage channel). `CostKind` gains `credits` (O-7 resolved).

## 9. Adding a provider (P-35, P-47)
A new provider is a definition plus the argument builder, nothing else, when it fits an existing transport.
A conformance suite runs the same fixture scenarios against every definition (launch via stdin or file,
event mapping, resume, stop). New providers enter as `experimental` or `isolated` and are promoted only
through the gates. Beyond the gates, every provider is measured by the conformance checklist (§16, P-65).

**Launch set (P-47, operator decision of 2026-10-03).** Docket ships with the six providers that passed a
real operator run: Claude Code, Codex, Antigravity, Copilot, Cursor, OpenCode. Thirteen further
definitions (eleven over ACP: hermes, kilo, atomcode, reasonix, grok-build, vibe, mimo, qwen, qoder,
kiro, kimi; two over stream JSON with their own dialects: amp, codebuddy) were built and
unit-tested but never run against a real account, and two more (devin, trae-cli) were planned. They were
removed so the product only promises what was verified; their code, fixtures and evidence comments stay
at the git tag `providers-extended` (commit `082ac24`) as a starting point for contributors. Every
mechanism they introduced that is not named after a provider stays in the code (P-47 step 2).

**Checklist for adding a provider.** One PR per provider; each step names the file family it touches.
1. **Evidence first.** Read the CLI's own documentation or `--help` output for: the headless channel
   (ACP, stream JSON, app-server, SDK), how a model and an effort are passed, how a session resumes,
   where the login lives, which instruction files it reads natively, and how it can be kept from reading
   other tools' configuration. Nothing is guessed; an unverified field stays absent.
2. **Definition** in `defs/` — transport, launch, `effortArg` (P-43), `config.mechanism` (P-44),
   `needsLogin` on any probe that may need an account (P-45), `mark` or `null` (P-25, P-25a).
3. **Registry row and route kinds** in `registry/` — support gates (§2), billing per route kind; a route
   whose billing is not documented is `unknown` (P-40), never assumed included.
4. **Transport fit.** An existing transport takes a table entry only (ACP launch table, stream-json
   dialect registry, CLI model-command table). A new stream-json dialect is a folder with recorded
   fixtures; a new transport is its own issue.
5. **Tests** — the definition test, the conformance suite over a scripted fake agent, the catalog and
   login-probe cases; fixture ids are neutral unless the case is about that provider.
6. **README matrix** regenerated (P-36).
7. **Operator run.** The provider enters as `experimental` or `isolated`; `full` needs a recorded real
   run (`npm run operator-run -- <id>`, with `--cap-usd` on any `metered` or `unknown` route — P-40).

Earlier removals: Gemini CLI, replaced by Antigravity. A stored account whose provider id has no
definition is listed as unsupported and never breaks loading or quota polling (P-47 step 4).

## 10. README matrix (P-36)
`scripts/gen-provider-matrix.mjs` writes the provider × model table (thinking, context, cost kind, support
level) into the README between marker comments, from the capability record. A test regenerates it in memory
and fails on any difference. The README is a product document and may name providers; the provider-name
restriction applies to code and comments under `src/` only.

## 11. Instruction files (P-37)
Providers read different project instruction files: one reads `CLAUDE.md`, others read `AGENTS.md` or their
own rule files. The registry records, per provider, which file names it reads natively (data).
The record is the provider's **best-known set**, not a fixed law of the CLI: Codex makes its fallback
list configurable (`project_doc_fallback_filenames` can add `CLAUDE.md`) and Qoder's `context.fileName`
can rename `AGENTS.md`, so the set is data that may later grow route- or account-level fields where a
CLI makes it configurable. A file the CLI reads natively but the row misses is inlined all the same —
rules delivered twice beat rules lost. Claude Code loaded its automatic project memory
(`~/.claude/projects/<repo>/memory/`) even with `settingSources: []`, so its row once named that memory
in the native set — until A-402 ([application.md](application.md), 2026-10-15, #1207): every
claude-code run now disables the automatic memory (inline `autoMemoryEnabled: false` plus the route
environment's `CLAUDE_CODE_DISABLE_AUTO_MEMORY=1`), nothing native loads it any more, and the row
lists no native instruction set. The memory lives outside the repo, so it was never an inline
candidate and never traveled in a pack.
- Docket computes the **effective instructions** of a run: the instruction files the chosen provider reads
  natively, plus the Docket layers (flow, stage, role), which are always delivered in the prompt. The same
  Docket layers go to every provider, so behaviour does not depend on the provider.
- If the repo has instructions that the chosen provider does not read natively (for example only
  `CLAUDE.md` while the run goes to another provider), Docket inlines that file's content at the start of
  the prompt, within the prompt budget. Nothing is written to the repo.
- Docket AI may propose a one-time repo change that makes one file canonical (the other imports it or is
  generated from it) as a normal diff in a work order; it is never applied silently. Which file is
  canonical is open decision O-6.
- An instruction file is written by the repo's authors. It reaches the agent as project context below the
  Docket layers and never becomes a Docket instruction. The boundary is marked, not implied: everything
  the pack and the prompt quote — instruction files read from the repo, and any issue, page or upload
  content that later rides the same path — travels as data under a heading that says so, never as
  Docket's system instruction. Content read from the repo or the web is untrusted input to Docket.
- Edits to instruction files follow the code path: proposed diff, work order, review.

## 12. Handoff between providers (P-38)
When a run cannot continue on its account (limit, cap, outage) and the limit policy picks a route on
another provider, the next run starts from a **handoff pack**. Native resume exists only within one
provider and is never mixed with the pack: two continuation mechanisms in one run would send the same
turn twice. Docket assembles the pack, not the failing agent:
1. The stage prompt and acceptance criteria as originally given.
2. The effective instructions (P-37), so both providers follow the same rules.
3. Task state derived deterministically from run events: plan, done and remaining list, the last command
   and its result, files touched.
4. Code state: the same worktree. Docket makes checkpoint commits (at each tool-result boundary and at
   the run's terminal events — no background timer; the event stream is the only clock) so the work
   survives; the diff since the stage started is part of the pack.
5. A bounded conversation summary maintained continuously during the run (a rolling note), so it exists
   even when the account is already blocked. Deterministic extraction comes first; an optional
   model-written summary uses the fast tier on a route that still has headroom (open decision O-8).
6. Raw transcripts do not travel.
The pack is sized from the fixed ceilings first (the instruction budget, the rolling-note cap); a known
context window only tightens it (`min` over the candidates' known windows), and most providers report no
window today — the pack is specified to work with the data absent. The new
agent first runs the stage's checks, then continues. A stage written on a fallback model is reviewed at
the strong tier. Autonomy and approvals travel as policy, not as session state. Acceptance: a scripted
three-leg scenario in the style of P-24: the first provider hits a limit mid-stage, the second continues
from the pack, the stage checks pass.

Privacy: a provider may keep its threads on the vendor's server, possibly with a shared default
visibility, so a pack written into a continuation session would leave the machine. Docket never widens
the audience: the visibility choice stays with the operator, and the pack carries only items 1–6 (already
secret-redacted). A provider with server-side sessions settles how they are handled in its own adding
issue (§9, step 1); noted here so the pack design does not assume every session is local.

## 13. Dynamic quota meters (P-39)
Parsers turn whatever a provider reports into meters: the provider's own label (verbatim), window length, remaining fraction, reset time and unit. No window name or count is fixed in code; a new bucket shows up without a release.
- Which models draw from a bucket is data: a small table maps known bucket names to model matchers (`Pool.appliesTo`), matched by the display name the provider reports. A bucket the table does not know is shown for information only ("which models draw from this bucket is unknown") and never blocks a run; exhaustion still surfaces through `limit_hit`.
- Only pools whose applicability is known take part in the headroom check before a run; the strictest applicable pool wins.
- A payload the parser cannot read is never shown as numbers: the probe reports `probe_failed` with a diagnostic naming the unrecognised field names (never values).
- A meter carries its unit (percent, credits, currency, tokens); a meter with an unknown unit is not rendered as a percentage.
- Observed (Claude): a model-scoped bucket arrives inside the usage report's model-scoped list, and an extra-usage section carries credit fields. A model-scoped weekly row arrives as its own meter; the support documentation describes it as a share of the weekly limit, and the operator observed that using that model also lowers the five-hour and weekly meters (the documentation does not confirm the five-hour part). Docket depends on neither reading: the row is one more meter that applies to that model together with the five-hour and weekly meters. Real responses are recorded as fixtures per provider version and kept as tests.

## 14. No surprise spend (P-40)
Docket never starts a run that may spend real money without the user's explicit consent and a spend cap.
- Every route and model has a billing state: `included` (the plan covers it, verified), `metered` (billed per use, verified) or `unknown`. `unknown` is never assumed to be free or to cost a given amount.
- The UI shows `unknown` with a question mark and the text that Docket could not verify whether the plan covers it and that using it may be billed. It shows no amount and no claim of a price for `unknown`. `metered` shows a currency mark and, when the registry holds a price, an estimate.
- Tier resolution and fallbacks never pick a `metered` or `unknown` model on their own. Choosing one by hand asks for explicit consent per account and model and requires a spend cap (account day, week or month) before the run starts; without a cap the run is refused (`needs_spend_consent`).
- An automatic switch caused by a limit (switch pool, fallback account) never crosses from `included` to `metered` or `unknown`; the policy falls back to waiting or asking. Full autonomy needs the cap as well.
- If the provider reports an account-side overage or extra-usage setting, Docket shows it and warns that reaching a limit may be billed; it never changes that setting.
- A handoff continuation (P-38) is a run like any other at this boundary: it never starts on an `unknown`-billing route without consent and a spend cap, and an automatic fallback skips an `unknown` candidate exactly like a `metered` one (providers.md P-46).
- Observed (Claude): a model outside a plan's limits (documented for one plan: billed at standard API rates through usage credits, and only when extra usage is enabled) is `metered`; with extra usage disabled it cannot be used. The CLI's non-interactive mode may spend credits without asking, so Docket enforces the cap and does not leave it to the CLI.
- Ambient API keys never reach a run (P-8, I-34): a key is used only when the account is an API-key account.

## 15. Capability translation and support table (P-57…)

Decisions D-4 and D-7 (#1006, 2026-10-12). Agent capabilities in Docket are composed of six kinds:
`mcp`, `skill`, `hook`, `context`, `plugin`, `command`. Plugins bundle other capabilities as packages;
commands are prompt templates rendered by Docket (placeholder substitution); memory is propose-and-approve
(R-142, R-143 in [domain.md](domain.md) §2).

Different agent CLIs support different capability kinds natively, in degraded form, or not at all.
Docket translates stage role capabilities per provider and per run into the run-scoped files or flags
the provider uses, without ever modifying the repository (D-5) or the user's ambient provider config.

Because real agent runs across all providers are not yet executed, the support table is recorded with an
honest `unverified` status where live evidence is lacking. The real-run probe #1015 later turns
`unverified` into observed values.

```ts
// providers — translation and support table (data, in the capability registry)
export type CapabilityKind = CapabilityDef['kind'];
export type TranslationSupport = 'native' | 'degraded' | 'unsupported' | 'unverified';
export interface TranslationRow { readonly provider: string; readonly kind: CapabilityKind; readonly support: TranslationSupport; readonly how: string; readonly degradesTo?: CapabilityKind | 'prompt_text'; readonly sourceKinds?: readonly string[] }   // sourceKinds (R-149): the source kinds this row delivers; absent = every source kind
export function supportFor(table: readonly TranslationRow[], provider: string, kind: CapabilityKind, sourceKind?: string): TranslationRow;   // missing row → { support: 'unverified' }; a sourceKind a sourceKinds row does not list → { support: 'unsupported' }, no degradesTo, how naming the source kind
export interface SetupWarning { readonly stage: string; readonly capability: CapabilitySlug; readonly provider: string; readonly support: 'degraded' | 'unsupported' | 'unverified'; readonly how: string }
export function setupWarnings(stages: readonly { stage: string; provider: string; capabilities: readonly CapabilityDef[] }[], table: readonly TranslationRow[]): readonly SetupWarning[];

// machine import (read-only)
export interface MachineCandidate { readonly provider: string; readonly kind: CapabilityKind; readonly name: string; readonly sourcePath: string; readonly secretNames: readonly string[] }   // names only, never values
```

### Initial translation and support table (P-58)

The initial table recorded as data in the capability registry (`registry/capability-registry.ts`). Honest, no claim without evidence — real-run probe #1015 later turns `unverified` into the observed value:

| Provider | Kind | Support | How / Mechanism | Degrades To | Source Kinds |
| --- | --- | --- | --- | --- | --- |
| `claude-code` | `mcp` | `native` | Run-scoped MCP via inline mcpServers with strictMcpConfig on every run (settingSources: []) probe #1015, 2026-10-14 | | |
| `claude-code` | `skill` | `native` | Per-run local plugin dir with skills/*/SKILL.md and skills: all probe #1015, 2026-10-14 | | |
| `claude-code` | `hook` | `native` | Inline settings.hooks on the SDK settings option probe #1015, 2026-10-14 | | |
| `claude-code` | `context` | `native` | systemPrompt.append once for role + context (no CLAUDE.md write) probe #1015, 2026-10-14 | | |
| `claude-code` | `plugin` | `native` | plugins[{type:local,path,skipMcpDiscovery}] probe #1015, 2026-10-14 | | `path` |
| `claude-code` | `command` | `degraded` | Template delivered as instruction text; the agent fills the placeholders | `prompt_text` | |
| `codex` | `mcp` | `native` | App-server --ignore-user-config on every run, then -c mcp_servers.* overrides when MCP is delivered | | |
| `codex` | `skill` | `native` | Run-scoped skills under .agents/skills in the run directory probe #1015, 2026-10-14 | | |
| `codex` | `hook` | `unsupported` | Hooks were not evidenced after trying a .codex/hooks.json file and a -c hooks override probe #1015, 2026-10-14 | | |
| `codex` | `context` | `native` | Native instruction files (AGENTS.md / fallback, P-37) | | |
| `codex` | `plugin` | `native` | Run-scoped plugin bundle under .codex/plugins with plugin.json probe #1015, 2026-10-14 | | `path` |
| `codex` | `command` | `degraded` | Template delivered as instruction text; the agent fills the placeholders | `prompt_text` | |
| `agy` | `mcp` | `native` | .agents/mcp_config.json (stdio command/args/env) via --add-dir on the run config dir; URL (SSE) servers are not delivered (serverUrl key, a wrong key fails silently); call_mcp_tool asks over the permission bridge as mcp__<Server>__<Tool>, answered allow through the permission board (P-63) probe #1015 agy spike + live run, 2026-10-16 | | |
| `agy` | `skill` | `native` | .agents/skills/<name>/SKILL.md via --add-dir (directory skill copied, single-file skill written as SKILL.md); the agent read the delivered SKILL.md probe #1015 agy spike + live run, 2026-10-16 | | |
| `agy` | `hook` | `native` | .agents/hooks.json via --add-dir inside the single docket hook group (event names at the top level are silently ignored); after_tool maps to PostToolUse, after_write to PostToolUse with a write-tool matcher, run_end to Stop as a direct list (run_end not yet observed live); one invalid entry silently disables the whole file; before_tool rides the single PreToolUse wrapper entry whose exit 2 denies before any ask (P-64) probe #1015 agy spike + live run, 2026-10-16 | | |
| `agy` | `context` | `native` | .agents/rules/<id>.md with trigger always_on frontmatter via --add-dir; repo instruction files stay native (P-37) and their text reached the agent with no read call probe #1015 agy spike + live run, 2026-10-16 | | |
| `agy` | `plugin` | `native` | .agents/plugins/<name>/ with plugin.json via --add-dir (loads hooks and MCP; a plugin's own skill was not evidenced) probe #1015 agy spike, 2026-10-16 | | `path` |
| `agy` | `command` | `degraded` | Template delivered as instruction text; the agent fills the placeholders | `prompt_text` | |
| `copilot` | `mcp` | `unverified` | Unverified without live probe (#1015) | | |
| `copilot` | `skill` | `unverified` | Unverified without live probe (#1015) | | |
| `copilot` | `hook` | `unverified` | Unverified without live probe (#1015) | | |
| `copilot` | `context` | `native` | Native instruction files (P-37) | | |
| `copilot` | `plugin` | `unverified` | Unverified without live probe (#1015) | | |
| `copilot` | `command` | `degraded` | Template delivered as instruction text; the agent fills the placeholders | `prompt_text` | |
| `cursor` | `mcp` | `native` | Run-scoped MCP server on the ACP session/new.mcpServers field (def-verified launch; tool listing is nondeterministic) probe #1015, 2026-10-14 | | |
| `cursor` | `skill` | `degraded` | Project rule at .cursor/rules carrying the skill instruction; not a documented skill kind probe #1015, 2026-10-14 | `context` | |
| `cursor` | `hook` | `unsupported` | Run-scoped .cursor/hooks.json with a UserPromptSubmit command hook was not evidenced (help names no hook format) probe #1015, 2026-10-14 | | |
| `cursor` | `context` | `native` | Native instruction file AGENTS.md in the run cwd (P-37) probe #1015, 2026-10-14 | | |
| `cursor` | `plugin` | `unsupported` | Documented --plugin-dir flag pointing at a fixture plugin bundle was not evidenced probe #1015, 2026-10-14 | | |
| `cursor` | `command` | `degraded` | Template delivered as instruction text; the agent fills the placeholders | `prompt_text` | |
| `opencode` | `mcp` | `unsupported` | Run-scoped config tree via OPENCODE_CONFIG_DIR with opencode.json mcp block was not evidenced probe #1015, 2026-10-14 | | |
| `opencode` | `skill` | `native` | Skill directory under the same OPENCODE_CONFIG_DIR tree (skills/, P-60 addendum) probe #1015, 2026-10-14 | | |
| `opencode` | `hook` | `unverified` | No hook kind documented in opencode --help, the repo docs (P-60 addendum names none) or the def; the CLI event surface is the plugin API, probed as C4 probe #1015, 2026-10-14 | | |
| `opencode` | `context` | `native` | Native instruction file AGENTS.md in the run cwd with OPENCODE_DISABLE_CLAUDE_CODE=1 (P-37) probe #1015, 2026-10-14 | | |
| `opencode` | `plugin` | `unsupported` | JS plugin in the config tree plugin directory whose module load appends the marker line was not evidenced probe #1015, 2026-10-14 | | |
| `opencode` | `command` | `degraded` | Template delivered as instruction text; the agent fills the placeholders | `prompt_text` | |

### Rules (P-57 … P-60)

- **P-57** (added 2026-10-12, #1006) `supportFor` answers from the table; a missing row is `unverified`; `setupWarnings` returns one warning per (stage, capability) whose support is not `native`, in stage order; the UI shows them at setup time and before a run starts; `unverified` is shown as such, never as `native`.
- **P-58** (added 2026-10-12, #1006) The table's initial content (data in the registry; honest, no claim without evidence — the real-run probe #1015 later turns `unverified` into the observed value): for provider `claude-code` (stream-json/SDK): mcp native, skill native, hook native, context native, plugin native, command degraded→prompt_text; for `codex`: mcp native, context native, skill degraded→context, hook unsupported, plugin unverified, command degraded→prompt_text; for `agy`, `copilot`, `cursor`, `opencode`: every kind `unverified` except context (native: instruction files, P-37) and command (degraded→prompt_text).
- **P-58 amendment (2026-10-14, probe #1015, #1141)** Real-run probe #1015 updates the solid rows: `claude-code` mcp/skill/hook/context/plugin `how` lines name the evidenced mechanism; `codex` skill and plugin become `native` (run-dir `.agents/skills` and `.codex/plugins`); `codex` hook stays `unsupported` with `how` citing the failed hook attempts.
- **P-58 amendment (2026-10-14, probe #1015, #1149)** Real-run probe #1015 updates `cursor` (mcp native with nondeterministic listing, skill degraded→context via project rule, hook and plugin unsupported), `opencode` (mcp and plugin unsupported, skill native under the config dir, hook unverified), and `agy` (mcp and skill unsupported, hook and plugin unverified); `copilot` stays unverified until the probe reruns.
- **P-58 amendment (2026-10-14, probe #1015, #1154)** Ambient MCP isolation: `claude-code` adds `--strict-mcp-config` when run-scoped MCP is delivered; `codex` adds `--ignore-user-config` on the app-server argv when run-scoped MCP is delivered (`codex_apps` remains as a built-in name, not an ambient leak). `cursor`, `opencode`, and `agy` unchanged — no isolation flag; leak names stay in registry data only.
- **P-58 amendment (2026-10-14, probe #1015, #1164)** Claude-code SDK delivery: `strictMcpConfig` and inline `disableClaudeAiConnectors: true` on every run; skills via a per-run local plugin directory with `skills: 'all'`; hooks via inline `settings.hooks`; context and role instructions via `systemPrompt.append` only (no `CLAUDE.md` write); plugin bundles via `plugins[{type:local,path,skipMcpDiscovery}]`.
- **P-58 amendment (2026-10-14, probe #1015, #1156)** `codex` passes `--ignore-user-config` on every app-server run (not only when run-scoped MCP is delivered); run MCP still travels as `-c mcp_servers.*` overrides when delivered (`codex_apps` unchanged).
- **P-58 amendment (2026-10-14, probe #1015, #1175)** Claude-code run plugin: `plugin.json` names the bundle `docket-run`; each materialized `SKILL.md` carries YAML frontmatter with `name` and `description` (existing frontmatter is kept and only missing keys are added); skills are invoked as `docket-run:<skill-name>`.
- **P-58 amendment (2026-10-14, #1184)** Plugin source kinds (R-149) and command semantics (R-141 addendum): the `claude-code` and `codex` `plugin` rows declare `sourceKinds: ['path']` — a run never installs or edits the user's plugin state (P-44), so a `marketplace` plugin reads `unsupported` for those providers and the P-57 setup warning and the P-59 omission record fire. Every `command` row's how now reads "Template delivered as instruction text; the agent fills the placeholders": the template rides the effective prompt with its `{{placeholders}}` for the agent to fill from the task, and Docket substitutes nothing (no argument input path exists yet; `renderCommand` stays unwired for a future explicit-arguments path).
- **P-58 amendment (2026-10-16, probe #1015 agy spike, #1210)** `agy` gains run-scoped delivery through `--add-dir <run config dir>` (P-62): the `mcp`, `skill`, `hook` and `plugin` rows move from `unsupported`/`unverified` to `native` (plugin with `sourceKinds: ['path']`, R-149), and the `context` row's how now names `.agents/rules/<id>.md` with `trigger: always_on` frontmatter on top of the native instruction files (P-37) — context capabilities are no longer dropped at launch. The earlier `unsupported`/`unverified` values above this amendment recorded the pre-spike state (no delivery mechanism was known then); the table rows carry today's evidenced values.
- **P-58 amendment #2 (2026-10-16, live agy run, #1221)** The delivery series (#1210…#1220) is live-evidenced: real `agy` 1.3.6 launched by Docket (Antigravity subscription account, `~/.docket-test`, model `gemini-3.8-flash-low`, main 9941cdc), run `01M50YHMVARZ1G2FGHNPMG6WD2`, outcome `succeeded`, 2026-10-16 — the repo instruction text reached the agent with no read call, a `Write` ask (mapped from `write_to_file`) answered `allow` wrote `notes.txt`, a user `before_tool` hook's exit 2 denied `forbidden.txt` before any ask was raised (P-64), a `call_mcp_tool` ask (`mcp__docket-pages__page_publish`) answered `allow` published the page (P-63), the delivered `.agents/skills/<name>/SKILL.md` was read by the agent, the `after_write` hook marker fired once, and five permission asks in total were all answered through the permission board. Not observed live: the `run_end` (Stop) hook, resume (`--conversation`) with `--add-dir`, the D-10 `auto` level on agy asks. The `mcp`, `skill`, `hook` and `context` rows above now cite the live run for what it evidenced (`plugin` stays probe-evidenced — no plugin rode the run); the registry records the operator run in `operatorRuns` per P-28, and the support level does not move: G6 still has no scripted stream-json scenario and P-44 keeps the isolation cap (the CLI documents no config-dir override, so HOME cannot be redirected), so `agy` stays `experimental`. Two measured traps live in the hook row's wording: hooks.json loads only inside the single `docket` hook-group wrapper and one invalid entry silently disables the whole file; an `allow`/`{}` answer from a PreToolUse hook runs NOTHING headless (only `auto_approve` runs a tool), so a run without a Docket channel stays auto-denied and surfaces the `denied_actions` error (P-11 addendum).
- **P-59** (added 2026-10-12, #1006) Translation is per provider and per run: a stage's role capabilities are translated into the run-scoped files/flags the provider's launch rules already use (P-7 addendum for run-scoped files, the MCP child launch rules); a capability whose support is `unsupported` is omitted from the run and recorded in the run record as `omitted_capability`; `degraded` capabilities are inlined as instruction text; no translation ever writes into the repository (D-5) or the user's own provider config.
- **P-60** (added 2026-10-12, #1006) Machine import is read-only: a scan lists `MachineCandidate`s per provider from that provider's own user-level config locations; it never writes there, never copies a secret value (only `secretNames`; at import the user is asked to store the value in the keychain, the definition then holds `{secretRef}`); it supersedes nothing in R-62…R-67 — the existing `CapabilityCandidate` for mcp/skill/context stays and this adds plugin and hook candidates: hook candidates are listed but still not importable (R-66's note, 2026-10-11, stands).
- **P-60 addendum (2026-10-14, #1067)** Evidenced user-level machine scan locations:
  - `claude-code`: `~/.claude/` (`CLAUDE.md`, `.claude.json` mcpServers, `settings.json` hooks/plugins, `skills/*.md`).
  - `codex`: `~/.codex/` (or `$CODEX_HOME`: `config.toml` `[mcp_servers.*]` / `[plugins.*]`, `AGENTS.md`, `skills/`).
  - `copilot`: `~/.copilot/` (or `$COPILOT_HOME`: `mcp-config.json` `mcpServers`, `copilot-instructions.md`, `skills/`, `plugins/`).
  - `opencode`: `~/.config/opencode/` (or `$OPENCODE_CONFIG_DIR`, `$OPENCODE_CONFIG`: `opencode.json` `mcp` / `plugins`, `AGENTS.md`, `skills/`, `plugins/`).
  - Other providers without evidenced documentation (`gemini-cli`) stay unconfigured and return an empty candidate list.

Conflicts and supersessions (added 2026-10-12, #1006, D-7): Glossary "Capability — MCP, skill, hook, context" grows by plugin and command; "capabilities attached to roles" now also arrive through plugins; Phase 3.5 account-scoped capability candidates (R-62…R-67, #850–#866) stay as the import mechanism.

## 16. Conformance checklist (P-65)

Added 2026-10-16, #1226 — step 1 of the provider conformance series: an audit only, nothing is fixed in
that issue (step 2 closes the gaps, step 3 reports). One checklist measures every provider by the same
rows. It is filled in below for **Claude Code** (`claude-code`, sdk transport) and **agy** (Antigravity,
stream-json transport) from the code, the tests and the recorded evidence at main `e970310` (2026-10-16);
later providers are measured by the same list before any promotion (§9).

**P-65** (added 2026-10-16, #1226) Every provider is measured by the checklist below, one status per row:
`pass` (evidence cited: a file and line, a test that exists under that name, a merged PR/issue, or a
recorded operator run id — a worker claim is not evidence) · `partial` (what works / what does not) ·
`fail` · `n/a` (with the reason) · `unverified` — never silently `pass`. Every non-`pass` row carries
three short fields: **Workaround** (what Docket does instead today), **Why not done** (CLI limit / not
built / out of scope, with the measured fact), **Proposal** (one line). A provider's support-table row
(§15) and README matrix (P-36) may cite only checklist rows whose status here is `pass`: a `partial`,
`fail` or `unverified` row never backs a `native` claim, and a `pass` names its evidence in the row
itself.

### The rows

- **Group A — base gates**: A/G1…A/G6 are exactly the six promotion gates of §2 (P-28); this section
  does not redefine them, it audits the evidence behind each provider's registry row.
- **Group B — delivery**: B1 the repo's instruction rule reaches the agent (P-37) · B2 skill · B3 MCP,
  the Docket tools included · B4 plugin · B5 hook delivery · B6 run-scoped isolation, nothing read from
  or written to the user's ambient config (P-44) · B7 context and memory files.
- **Group C — safety**: C1 a permission ask reaches the board and the answer is honoured (G3) · C2
  forbidden paths are blocked before any ask · C3 silent denials surface as events · C4 a role without
  Docket tools on a provider with no permission channel raises a setup warning · C5 no surprise spend
  (P-40) · C6 no token or secret in argv, in logs, or in any child environment beyond the designed
  channel.
- **Group D — lifecycle**: D1 resume with the same delivery · D2 stop and the run-end hook · D3
  after_tool / after_write hooks · D4 orphaned-run boot sweep (A-400) · D5 the cockpit's real wait
  reason (A-401) · D6 steer and stop of a running stage (A-366/A-367, P-61 as applicable) · D7 the
  provider's own auto-memory is disabled in runs (A-402).
- **Group E — accounting**: E1 usage reaches the record with a cost kind (G4) · E2 quota probe or
  written waiver (G5) · E3 model and thinking catalog with the effort argument (P-29, P-30, P-43) ·
  E4 login and account discovery without reading credentials (P-33).
- **Group F — autonomy (D-10)**: F1 the `auto` level observed live, permission arm and gate arm · F2 the
  risk-rule table applies to the provider's tool names (canonical translation).
- **Group G — observability**: G1b the UI capability table matches the registry (U-333) · G2b the README
  matrix is regenerated (P-36).

Paths below are relative to `src/` unless they start with `electron/` or name the README; `registry` is
`src/infrastructure/providers/registry/capability-registry.ts`. The live agy run id
`01M50YHMVARZ1G2FGHNPMG6WD2` (agy 1.3.6, 2026-10-16, registry:80, #1221) is cited as "the live run".

### Claude Code (claude-code, sdk transport)

Registry row registry:29-41; derived level `isolated` — G1–G6 all pass with test evidence, no operator
run recorded (P-28: `full` additionally needs `operatorRuns`; domain/providers/capability.ts:92-112,
pinned capability-registry.test.ts:425-433 — see gap 10).

| Row | Status | Evidence |
| --- | --- | --- |
| A/G1 | pass | providers/discovery/discovery.test.ts:236 ('P-4: probes run once each…'); registry:34 |
| A/G2 | pass | providers/transports/sdk/map-message.test.ts:217 ('I-27: assistant content blocks map in order'); registry:35 |
| A/G3 | pass | providers/transports/sdk/transport.test.ts:1214 (I-29 scripted session); executor side application/services/run-executor.test.ts:695/:710 (A-16); registry:36 |
| A/G4 | pass | map-message.test.ts:268 ('I-27: result maps to usage carrying the context costKind'); registry:37 |
| A/G5 | pass | providers/quota/claude/claude-probe.test.ts:78 (P-21); registry:38 |
| A/G6 | pass | infrastructure/scenarios/providers.test.ts:594 (P-24, sdk leg); registry:39 |
| B1 | pass | production wiring electron/main.ts:327-344 (composeRunPrompt → executeRun); the native set is empty by A-402 (registry:329-331) so every repo instruction file is inlined: application/use-cases/instructions.test.ts:208/:238/:275/:377 (A-53/A-54/A-56), registry/capability-catalog.test.ts:229 ('P-37 (#1165): claude-code inlines repo CLAUDE.md once…') |
| B2 | pass | providers/transports/sdk/claude-code-sdk-delivery.ts:116-146 (per-run `docket-run` plugin dir, `skills: 'all'`); tests claude-code-sdk-delivery.test.ts:65/:95 (manifest + frontmatter, #1175), claude-code-delivery.test.ts:304 (CC-3) |
| B3 | pass | inline mcpServers transport.ts:113-132 with `strictMcpConfig` :220 and `disableClaudeAiConnectors` claude-code-sdk-delivery.ts:179; the Docket tools attached application/services/mcp-attach.ts:18-43; tests claude-code-delivery.test.ts:223 (CC-1), :553 (CC-8), transport.test.ts:697/:736 (I-28) |
| B4 | pass | path-only plugins claude-code-sdk-delivery.ts:148-154 (R-149; second line of defence domain/providers/capability.ts:140-156); registry:409-415 `sourceKinds: ['path']`; tests CC-6 :426, CC-9 :721, CC-10 :757, CC-12 :848 |
| B5 | pass | hook map claude-code-sdk-delivery.ts:7-12; inline `settings.hooks` :156-166/:180 with `settingSources: []` transport.ts:212; tests claude-code-delivery.test.ts:357 (CC-4), claude-code-sdk-delivery.test.ts:32-63 (matcher split) |
| B6 | pass | isolation evidence registry:32 = transport.test.ts:976 ('P-44: a subscription launch never points the config directory at the run directory…'); sentinel trees providers/launch/isolated-config.test.ts:122 (every def); env allowlist providers/launch/launch-env.test.ts:26 (P-8) |
| B7 | pass | context via `systemPrompt.append` once claude-code-sdk-delivery.ts:168-174 (CC-5 claude-code-delivery.test.ts:392); auto-memory off A-402 (#1208): settings :176-179 + route env claude-code route-env.ts:36-37/:72, tests transport.test.ts:552-591, claude-code-sdk-delivery.test.ts:197-218 |
| C1 | pass | `canUseTool` transport.ts:177-206; the executor decision path run-executor.ts:853-887; board application/services/permission-board.ts:84-101 (U-11 permission-board.test.ts:167+); conformance permission leg providers/conformance/conformance.test.ts:156-167 |
| C2 | partial | see notes |
| C3 | pass | a deny surfaces as the executor-written `permission_answered` event + audit (run-executor.ts:860-876; A-16 run-executor.test.ts:695) and as the failed `tool_result` (map-message.ts:42-52; I-27 test :237); every permission decision routes through the Docket callback (transport.ts:177), so no silent run-level verdict path exists |
| C4 | n/a | the SDK permission callback exists on every run — the row's condition (provider without a permission channel) cannot occur; the general absence of a channel-keyed warning is recorded under agy's C4 |
| C5 | pass | preflight run-executor.ts:663-666 runs before the transport is resolved (provider-blind); predicate application/services/spend-consent.ts:34-52; tests run-executor.test.ts:1528-1675 (P-40), :1856/:1882 (P-46), spend-consent.test.ts:33-72 (P-51) |
| C6 | pass | prompt never in argv (providers/defs/defs.test.ts:259 P-1; conformance launch leg conformance.test.ts:117-134); env allowlist providers/launch/launch-env.ts:72-88 (P-8 tests :26/:44/:69); the run token appears nowhere a run leaves behind (run-executor.test.ts:2146, A-143). Designed channel only: the docket-pages child env (mcp-attach.ts:33-38) |
| D1 | pass | resume `specify`: SDK option transport.ts:211; sessionRef captured map-message.ts:19 and persisted run-executor.ts:850-852; attempt plan :262-290; the delivery is rebuilt identically on resume (the A-402 test asserts equal settings and env on the resumed start, transport.test.ts:552-591); I-28 :637-670; stop→resume api/api.test.ts:2007-2070 (A-362); P-22 fallback run-executor.ts:810-828 (tests :1284-1439) |
| D2 | pass | run.stop is the SDK abort with exactly one `finished cancelled` (I-30 transport.test.ts:1424-1452; A-362 api.test.ts:2007-2083) and `run_end` maps to a Stop hook entry in the inline `settings.hooks` (claude-code-sdk-delivery.ts:7-12, direct list, no matcher; test claude-code-sdk-delivery.test.ts:65 'a run_end hook maps to a Stop entry in the inline settings hooks', #1237) |
| D3 | pass | after_write matcher `Write/Edit/MultiEdit/NotebookEdit` claude-code-sdk-delivery.ts:14-15/:160-163; test claude-code-sdk-delivery.test.ts:32-63; before_tool CC-4 :357; the hook mechanism is live-evidenced by probe #1015, 2026-10-14 (registry:403) |
| D4 | pass | `sweepOrphanedRuns` application/use-cases/boot-sweep.ts:22-57 — provider-blind (the file reads no provider field); wired electron/main.ts:788-794 ahead of the first dispatch tick (guard electron/boot-sweep.test.ts:16-28); tests boot-sweep.test.ts:102-245 (A-400, #1196) |
| D5 | pass | dispatcher wait memory application/services/dispatcher.ts:54-65/:208-223; `queuedReason` api/api.ts:2655-2684; cockpit `queuedNote` U-354 presentation/stores/cockpit.ts:150-181; tests dispatcher.test.ts:1294, queries.test.ts:592-653, cockpit.test.ts:555-596 — all provider-generic (#1195) |
| D6 | pass | `steerable` registry:31; run.steer/run.stop api.ts:1206-1248 (A-361…A-365, #1121); the steer note as a further user message transport.ts:279-285 (I-28 test :1392-1422); stop = SDK abort, one finished cancelled (I-30 transport.test.ts:1424-1452); `canSteer` on the detail A-367 api.test.ts:2248-2275; the UI offers steering only when the transport can (#1148) |
| D7 | pass | A-402 (#1208): inline `autoMemoryEnabled: false` claude-code-sdk-delivery.ts:176-179 plus `CLAUDE_CODE_DISABLE_AUTO_MEMORY=1` on every route env claude-code route-env.ts:36-37/:70-72; the registry instruction row emptied :329-331; tests transport.test.ts:552-591, claude-code-sdk-delivery.test.ts:197-218, capability-catalog.test.ts:193 |
| E1 | pass | the usage event carries the route's costKind map-message.ts:53-67 (context.costKind :64); per-route kinds registry:131/:179/:198; the flow route-env.ts:48-49/:112/:120 → transport.ts:111/:236; test map-message.test.ts:268 |
| E2 | pass | the claude probe providers/quota/claude/claude-probe.ts:28-52 (P-21 tests claude-probe.test.ts:78-275); route probes registry:132/:180/:199; wiring providers/quota/probe-resolver.ts:52-66 |
| E3 | pass | live list providers/catalog/claude-catalog.ts:63-100 (supportedModels, `settingSources: []`, `persistSession: false`; tests claude-catalog.test.ts:182-422); bundled models + thinking registry:147-169; effort `request-field` providers/defs/builtin-provider-defs.ts:25 → SDK query option transport.ts:38-39/:223 (P-41 test transport.test.ts:384-413); P-30 mapping domain/providers/catalog.test.ts:357-380 |
| E4 | pass | providers/discovery/account-scan.ts:1-5/:99-110/:165-186 (key names + endpoint host only); tests account-scan.test.ts:240 (P-33 'never carries a secret value'), :349-412; login probes P-54/P-55, tests discovery.test.ts:981+ |
| F1 | unverified | see notes |
| F2 | pass | the SDK's tool names are the canonical names; Docket's own read tools renamed providers/transports/sdk/docket-own-tool.ts:10-14 (test transport.test.ts:1269); risk table domain/autonomy/risk.ts:61-65/:337-350; executor mappability gate run-executor.ts:96-114; the server-prefixed docket tool name stays human-decided under `auto` by the mappability miss, pinned so a later mapping change cannot license it (run-executor.test.ts:2669 A-412, #1237) |
| G1b | pass | drift guard scripts/check-capability-copy.mjs (every table row, order-independent compare, exit 1 on drift) wired into `check:boundaries` (package.json:21); the store copy presentation/stores/agent-capabilities.ts:24-34; tests agent-capabilities.test.ts:41-115 (U-333, #1224) |
| G2b | pass | providers/registry/provider-matrix.test.ts:32 ('P-36: the committed README block equals the matrix regenerated from the capability registry'); README rows :40-42; generator scripts/gen-provider-matrix.mjs |

Non-pass rows — Claude Code:

- **C2 · partial** — Works: user `before_tool` hooks ride inline PreToolUse (CC-4, claude-code-delivery.test.ts:357) and under `auto` the D-10 deny floor keeps forbidden writes, git internals and secrets human-decided (risk.ts:337-350; run-executor.test.ts:2562-2721). Does not: Docket itself blocks no forbidden path before the ask — roles carry write-scope data (domain/library/roles.ts:19-92) that nothing enforces pre-ask, and whether the vendor runs PreToolUse before the permission callback is untested here. Workaround: every ask reaches the board (manual/balanced) or the risk floor (`auto`). Why not done: not built — no guard concept exists in the permission path (measured: no guard/forbidden/allowedPaths match in src/application and src/domain). Proposal: a pre-ask write-scope check in `decideAsk`, keyed on the role's write scope.
- **C4 · n/a** — reason in the table.
- **F1 · unverified** — Both arms are provider-independent and test-covered: the permission arm domain/autonomy/decide.ts:23-41 plus run-executor.test.ts:2562-2721 (#1205), the gate arm domain/flow/gate-auto.ts:43-68 plus application/use-cases/gate-auto.test.ts:145-265 (#1209). But no operator run has exercised `auto` live — the registry records no claude-code `operatorRuns` at all (registry:29-41). Workaround: none needed mechanically; the level re-resolves per ask (R-170). Why not done: no live auto run recorded. Proposal: one live auto run (the permission arm on claude-code; the gate arm is provider-blind), recorded per P-28.

### agy (Antigravity, stream-json transport)

Registry row registry:64-81; derived level `experimental` — every gate now carries test evidence (G6
cites the stream-json leg of the P-24 scenario, #1237) and one live operator run is recorded (the live run,
registry:80), but the record still carries no isolation evidence, and that P-44 cap alone (capability.ts:94)
holds the level (capability-registry.test.ts:151-163).

| Row | Status | Evidence |
| --- | --- | --- |
| A/G1 | pass | discovery.test.ts:236 (P-4, shared); registry:69 |
| A/G2 | pass | providers/transports/stream-json/dialects/agy/agy-dialect.test.ts:34 ('P-11: the text turn fixture maps…'); registry:70 |
| A/G3 | pass | bridge suites stream-json.test.ts:606/:646 (P-63), infrastructure/mcp/agy-ask.test.ts:95/:176 (I-108), agy-ask-bridge.test.ts:57 (I-109); the conformance exemption is documented and tested (conformance.test.ts:33-40/:236); registry:71; the live run answered five asks through the board (#1221) |
| A/G4 | pass | the usage event carries the route's cost kind from the dialect context — the same `context.costKind` stamp the SDK mapper applies (agy-dialect.ts:80/:96, after map-message.ts:53-67); route kind `equivalent` registry:269; test agy-dialect.test.ts:63 ('P-11: the usage event carries the route's cost kind', #1237); registry:72 |
| A/G5 | pass | providers/quota/agy/usage-probe.test.ts:79 ('P-19: runs `agy -p /usage --output-format json` and parses the payload from stderr'); registry:73 |
| A/G6 | pass | the P-24 identical-work-order scenario's stream-json leg runs the real built-in agy dialect over the checked-in fake CLI with the same common event kinds and one finished per run (infrastructure/scenarios/providers.test.ts:637, #1237); registry:74 |
| B1 | pass | native set registry:342-344 (AGENTS.md, GEMINI.md, the `.agents/` variants); live: the repo instruction text reached the agent with no read call (registry:457, #1221); non-native files are inlined by the shared P-37 core (instructions.test.ts:275); production wiring electron/main.ts:327-344 |
| B2 | pass | `.agents/skills/<name>/SKILL.md` via `--add-dir` providers/transports/stream-json/agy-delivery.ts:221-235; tests agy-delivery.test.ts:151-165, stream-json.test.ts:455-489; live: the agent read the delivered SKILL.md (registry:449) |
| B3 | partial | see notes |
| B4 | partial | see notes |
| B5 | pass | hooks.json inside the single `docket` hook group: the map agy-delivery.ts:36-44, assembly :148-189 (launcher files :102-106; exactly one PreToolUse wrapper :155-157); tests agy-delivery.test.ts:178-341 (P-62, P-64 and both corrections, #1210/#1212/#1219); live: the after_write marker fired once, a before_tool exit 2 denied before any ask (registry:451-454, #1221) |
| B6 | fail | see notes |
| B7 | pass | `.agents/rules/<id>.md` with `trigger: always_on` frontmatter agy-delivery.ts:240-248 (test agy-delivery.test.ts:210-219); the context row is live-evidenced (registry:457); no agy memory mechanism exists to disable (D7 n/a) |
| C1 | pass | the bridge: waiter registration and deny on every end path stream-json.ts:50-57/:256-290; the ask child mcp/agy-ask.ts:185-229 (fail-closed); the listener agy-ask-bridge.ts:36-83 (token check, `NO_CHANNEL` deny); wiring electron/main.ts:666-671; tests stream-json.test.ts:606/:628/:646/:662; registry:71; the live run (#1221) |
| C2 | partial | see notes |
| C3 | pass | `denied_actions` becomes exactly one error event before finished: agy-dialect.ts:59-75/:96-97, fixture denied-result.jsonl, test agy-dialect.test.ts:95 (P-11 addendum, #1214); never a text event, the fold is unchanged |
| C4 | fail | see notes |
| C5 | pass | the same provider-blind preflight run-executor.ts:663-666; agy live rows are billing-`unknown` by design (registry:253-272), so a hand-picked model always needs consent + a cap |
| C6 | pass | the prompt rides the one-line NDJSON stdin envelope, never argv (defs.test.ts:259 P-1; agy-dialect.test.ts:82); env allowlist extras empty (launch-env.ts:50); a secretRef MCP server refuses the run `not_logged_in` (stream-json.test.ts:491); token, socket path and hook commands appear in neither hooks.json nor the launcher (agy-delivery.test.ts:282-306). Designed channel only: the 0600 run-scoped `.docket-ask.json` and `mcp_config.json`, and the docket-pages child env |
| D1 | partial | see notes |
| D2 | partial | see notes |
| D3 | pass | the matcher split agy-delivery.ts:31-34/:176-180 (test agy-delivery.test.ts:196-205); live: the after_write hook marker fired once (registry:453, #1221) |
| D4 | pass | the same provider-blind sweep boot-sweep.ts:22-57 (no provider field is read anywhere in the file); tests boot-sweep.test.ts:102-245 (A-400) |
| D5 | pass | the same generic wait reason (evidence as for claude-code); an open agy ask surfaces as an attention row api.ts:2563-2578 while the watchdog timers pause (watchdog.ts:65) |
| D6 | partial | see notes |
| D7 | n/a | no agy auto-memory mechanism is known to the def, the registry or the transport (verified: no memory surface anywhere; `~/.gemini` rule files are native instructions, not memory). If the CLI grows one, nothing today would catch it — tracked under the B6 gap |
| E1 | pass | the usage event reaches the record with tokens plus the route's cost kind (A/G4 evidence; registry:269 `equivalent`), #1237 |
| E2 | pass | the usage probe providers/quota/agy/usage-probe.ts:14/:68-95 (print mode, both streams read) and parser usage-parser.ts:116-134 (stdout or stderr); tests usage-probe.test.ts:79-153, usage-parser.test.ts:107-153, usage-groups.test.ts (P-39); registry:269 `provider_query` |
| E3 | pass | live list providers/catalog/cli-command-catalog.ts:40-42 (parser + fourteen-model fixture tests cli-command-catalog.test.ts:154-308; login-free per P-45); bundled models + thinking registry:272-295 — the measured `agy models` answer (agy 1.3.6): the id suffix carries the effort, one level per record, tier map argon-high/flash-high/flash-low (tests capability-registry.test.ts:206/:250); a live row meets its bundled record in the merge (model-catalog.test.ts:541); effort `flag` providers/defs/builtin-provider-defs.ts:11 → argv :96-106 (P-41 tests defs.test.ts:331/:345); P-30 mapping domain/providers/catalog.test.ts:356+ |
| E4 | pass | the P-56 presence probe providers/defs/builtin-provider-defs.ts:82-85 (presence only, `absent: 'unknown'`; tests defs.test.ts:217-224, discovery.test.ts:981-1007); no directory scanner → exactly one machine-login candidate and nothing read from disk for it (account-scan.ts:192-227; tests account-scan.test.ts:350/:406) |
| F1 | unverified | see notes |
| F2 | pass | agy names are translated once, in the ask child: mcp/agy-ask.ts:74-92 (run_command→Bash, the write family→Write, view_file→Read, call_mcp_tool→mcp__Server__Tool with no target); tests agy-ask.test.ts:127-170; an unmapped ask stays with the human even under `auto` (run-executor.ts:96-114), including the prefixed `mcp__docket-pages__page_publish` itself (run-executor.test.ts:2669 A-412, #1237); the live run's asks arrived as Write, Read and mcp__… (#1221) |
| G1b | pass | the same U-333 guard covers every row including agy (agent-capabilities.test.ts:48, 'the agy rows read native for mcp, skill, hook and plugin') |
| G2b | pass | the README agy row :44 pinned by provider-matrix.test.ts:32 |

Non-pass rows — agy:

- **B3 · partial** — Works: stdio servers are delivered through `.agents/mcp_config.json` `{command, args, env}` (agy-delivery.ts:208-219; tests agy-delivery.test.ts:151-161); the Docket tools ride it and `call_mcp_tool` asks flow through the bridge (live: the page published, #1221). Does not: URL/SSE servers are not delivered at all — the CLI wants the `serverUrl` key and nothing URL-shaped is ever written (agy-delivery.ts:210-212; registry:445); no omission record fires and no negative test pins it. Workaround: the registry row's `how` documents the limit. Why not done: CLI limit — only the stdio shape was evidenced (probe #1015). Proposal: record an `omitted_capability` (P-59) for URL-shaped servers, or deliver `serverUrl` once evidenced.
- **B4 · partial** — Works: path plugin bundles are copied with a root `plugin.json` and load hooks + MCP (agy-delivery.ts:251-266; tests agy-delivery.test.ts:151-172; probe #1015 spike — registry:459-464, path-only per R-149). Does not: a plugin's own skill was never evidenced and no plugin rode the live run. Workaround: skills travel as first-class capabilities (B2). Why not done: not observed — probe scope. Proposal: one live run with a plugin that carries a skill.
- **B6 · fail** — The CLI documents no config-dir override and its login lives under `~/.gemini/antigravity-cli` (P-56), so HOME is never redirected and the CLI may read the user's ambient configuration: isolation is deliberately not claimed (registry:61-64), the tests pin the pass-through posture (isolated-config.test.ts:251-267) and the level is capped `experimental` (capability.ts:94). Workaround: the experimental level says so in the UI; everything Docket writes stays inside the run dir (P-7 tests, isolated-config.test.ts:98). Why not done: CLI limit — no config-dir flag exists and redirecting HOME could cut the CLI off from its login (measured; the P-44 rule). Proposal: probe whether a run-scoped home with an adopted login survives, or adopt a CLI config-dir flag when one appears; until then the cap stands.
- **C2 · partial** — Works: the P-64 wrapper runs the user's `before_tool` hooks before any ask and an exit 2 denies first (mcp/agy-ask.ts:210-214; test agy-ask.test.ts:200; live: `forbidden.txt` denied before any ask, #1221). Does not: the guard rules are user hooks — Docket enforces no forbidden-path set of its own before the ask (the same measured absence as claude-code). Workaround: the risk floor under `auto`; the human board otherwise. Why not done: not built. Proposal: the same pre-ask write-scope check as claude-code — it would be provider-blind.
- **C4 · fail** — A role without the `docket-pages` capability (or any run without a run token) sets up no permission channel: the ask file stays `bridge: false`, the wrapper answers neutral `allow` and headless agy auto-denies `command`/`mcp`/`write` tools, surfacing only as the run's `denied_actions` error (stream-json.test.ts:662-684; §15 P-58 amendment #2). No setup-time warning exists — `setupWarnings` keys on capability kind only (capability.ts:158-180), and the runtime deny string 'no permission channel for this run' (agy-ask-bridge.ts:38) is an answer, not a warning. Workaround: the C3 error event tells the operator after the run. Why not done: not built (measured: no channel-keyed warning anywhere). Proposal: a provider-level SetupWarning when the def's ask rides a capability and the stage's roles carry no Docket tools.
- **D1 · partial** — Works: `--conversation` resume is built and fake-CLI tested, and a resumed run rebuilds the same delivery — `--add-dir` re-passed, the `.agents` tree rewritten, the rules file present (stream-json.ts:184-200; stream-json.test.ts:455-489; defs.test.ts:378-388); the P-22 restart fallback is provider-blind (run-executor.ts:810-828). Does not: no live agy resume exists — explicitly listed as not observed (§15 P-58 amendment #2; the P-63 cross-reference in providers.md). Workaround: scripted evidence plus P-22. Why not done: no live run yet. Proposal: a live resume leg in the next operator run.
- **D2 · partial** — Works: run.stop kills the whole process group (P-10 test stream-json.test.ts:318-351) and the run_end→Stop entry is writer-tested as the direct list inside the `docket` group (agy-delivery.test.ts:178-208, :222-248). Does not: a Stop hook firing was never observed live (registry:453, 'run_end not yet observed live'). Workaround: the writer tests pin the shape. Why not done: the live run's Stop path produced no observable marker. Proposal: a `run_end` marker hook in the next live run.
- **D6 · partial** — Works: run.stop (above) plus honest refusal — the registry pins `not_steerable` (registry:67; capability-catalog.test.ts:203-213), `run.steer` answers `unsupported` before any audit (api.ts:1235-1238; api.test.ts:2156-2179) and the UI offers steering only when the transport can (#1148). Does not: mid-run steering is impossible — the stream-json prompt is one-shot on stdin and a later note is dropped (stream-json.ts:386-393/:402-405). Workaround: stop + resume, or a fresh run with the note in the prompt. Why not done: CLI/transport limit — no steering channel (P-61 records it as data). Proposal: none until the CLI grows an input channel; revisit together with the B6 probe.
- **F1 · unverified** — the same state as claude-code: both arms are provider-independent and test-covered, but no live `auto` run exists; the live agy run answered all five asks through the human board and D-10 `auto` on agy asks is explicitly not yet observed (§15 P-58 amendment #2). Workaround: none mechanically. Why not done: no live run under auto. Proposal: one live auto run; on agy it would also prove the bridge path under policy.

### Gaps, in the order we propose to close them

Ordered by risk first, then effort; step 2 of the series works this list and nothing was fixed in #1226:

1. **B6 · agy** — isolation: probe a run-scoped home (or a config-dir flag) that keeps the login, or the
   experimental cap stands; it blocks every promotion.
2. **C4 · agy** — a setup warning for a channel-less role; today the operator learns of the headless
   auto-deny only after a wasted run.
3. **C2 · both** — a Docket-side forbidden-path/write-scope guard before the ask; roles already carry
   write-scope data, nothing enforces it pre-ask.
4. **A/G6 · agy** — closed in #1237: the P-24 scenario runs a fourth, stream-json leg over the real
   agy dialect and the fake CLI, and the registry cites it as G6.
5. **F1 · both** — one live `auto` run (permission arm and gate arm) recorded in `operatorRuns`; on agy it
   also exercises the bridge under policy.
6. **E1 + A/G4 · agy** — closed in #1237: the dialect stamps the route's cost kind (dialect context,
   as the SDK mapper does) and G4 cites the cost-carrying test.
7. **D2 · both** — half closed in #1237: the claude-code delivery test pins `settings.hooks.Stop`
   (D2 now pass there); the live agy Stop marker remains open.
8. **D1 · agy** — a live resume leg (`--conversation` with `--add-dir`) in the next operator run.
9. **B3 · agy** — record the URL/SSE MCP omission (or deliver `serverUrl` when evidenced).
10. **operatorRuns · claude-code** — record the claude-code verification runs per P-28, so six passing
    gates can translate into `full`.
11. **B4 · agy** — one live run with a plugin (own-skill evidence).
12. **E3 · agy** — bundle gemini models and thinking levels as registry data.
13. **F2 · both** — closed in #1237: A-412 (run-executor.test.ts) pins the prefixed
    `mcp__docket-pages__page_publish` as human-decided under `auto` via the mappability miss.

## Open decisions
- O-1 Where endpoint and model mapping live: account fields (proposed) or a separate preset record.
- O-2 Resolved: sessions stay under the user's config directory; a per-run copy cannot keep the macOS login.
- O-3 Resolved (2026-10-03, P-47): no pilot in the launch set; the add-a-provider path is the §9 checklist, exercised by the next contributed provider.
- O-4 Whether Docket may fetch an updated model registry from the internet.
- O-5 Minimum supported CLI versions, as data, for the capability scan.
- O-6 Which instruction file is canonical when a repo serves several providers (proposed: keep each file
  as the repo has it, inline the missing one; offer a canonical-file diff only on request).
- O-7 Resolved: `CostKind` gains `credits`; the internal representation is the provider's smallest unit.
- O-8 Who writes the optional conversation summary in the handoff pack, and on which tier.
- O-9 Tier of the Fable model: it spends limits fast, has its own weekly meter on one plan and outside the limits on another (`metered`); decided: no automatic tier, selectable by hand only.
- O-10 Whether a run-internal window observation may size a pack when the catalog carries no window for the provider: Codex's turn notification (`ThreadTokenUsageUpdated`) reports `modelContextWindow` mid-run. Using an in-run observation as sizing data is undecided — note only, decision later.
