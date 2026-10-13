# Provider capabilities and routes

Design, not yet contract. It extends `providers.md` and `quota.md`; where they
disagree, this file wins for the topics below and the other two are corrected in the same PR that
implements the change. Rule ids continue the `P-n` series; the rule-coverage check does not scan this
file, so each rule moves into `providers.md` together with its tests when it is implemented.

Vocabulary: a **provider** is an agent CLI (one definition). An **account** is a credential of a
provider. A **route** is an account plus a model (and, for compatible endpoints, an endpoint). Two
routes of one provider can differ in models, thinking, quota and cost, so capabilities attach to the
route, not to the provider alone.

## 1. The capability record (P-27)
- One data file is the single source of truth: `src/infrastructure/providers/registry/capability-registry.ts`, plain `as const` data checked with `satisfies` against the domain types. The types and the pure derivations live in `src/domain/providers/capability.ts` (domain rules: no npm packages, no Node builtins, no classes). The data sits in infrastructure because vendor names are banned outside `src/infrastructure/providers/`; an application port `CapabilityCatalog` exposes route kinds to `saveAccount`.
- It holds, per provider: `planned` (manual flag), the six promotion gates (section 2) each with
  evidence, and its route kinds. Per route kind: auth mode, endpoint host (preset only), identity
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
through the gates.

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
rules delivered twice beat rules lost. Claude Code loads its automatic project memory
(`~/.claude/projects/<repo>/memory/`) even with `settingSources: []`; its row names that memory in the
native set. The memory lives outside the repo, so it is never an inline candidate and never travels in
a pack.
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
export interface TranslationRow { readonly provider: string; readonly kind: CapabilityKind; readonly support: TranslationSupport; readonly how: string; readonly degradesTo?: CapabilityKind | 'prompt_text' }
export function supportFor(table: readonly TranslationRow[], provider: string, kind: CapabilityKind): TranslationRow;   // missing row → { support: 'unverified' }
export interface SetupWarning { readonly stage: string; readonly capability: CapabilitySlug; readonly provider: string; readonly support: 'degraded' | 'unsupported' | 'unverified'; readonly how: string }
export function setupWarnings(stages: readonly { stage: string; provider: string; capabilities: readonly CapabilityDef[] }[], table: readonly TranslationRow[]): readonly SetupWarning[];

// machine import (read-only)
export interface MachineCandidate { readonly provider: string; readonly kind: CapabilityKind; readonly name: string; readonly sourcePath: string; readonly secretNames: readonly string[] }   // names only, never values
```

### Initial translation and support table (P-58)

The initial table recorded as data in the capability registry (`registry/capability-registry.ts`). Honest, no claim without evidence — real-run probe #1015 later turns `unverified` into the observed value:

| Provider | Kind | Support | How / Mechanism | Degrades To |
| --- | --- | --- | --- | --- |
| `claude-code` | `mcp` | `native` | Inlined via SDK / run-scoped config | |
| `claude-code` | `skill` | `native` | Run-scoped directory / SDK setting | |
| `claude-code` | `hook` | `native` | Run-scoped hooks | |
| `claude-code` | `context` | `native` | Native instruction files (`CLAUDE.md`, P-37) | |
| `claude-code` | `plugin` | `native` | Unpacks package bundle to native capabilities | |
| `claude-code` | `command` | `degraded` | Docket renders template placeholders | `prompt_text` |
| `codex` | `mcp` | `native` | App-server `-c mcp_servers.*` | |
| `codex` | `context` | `native` | Native instruction files (`AGENTS.md` / fallback, P-37) | |
| `codex` | `skill` | `degraded` | Inlined as instruction text | `context` |
| `codex` | `hook` | `unsupported` | Unsupported by app-server protocol | |
| `codex` | `plugin` | `unverified` | Unverified without live probe (#1015) | |
| `codex` | `command` | `degraded` | Docket renders template placeholders | `prompt_text` |
| `agy` | `mcp` | `unverified` | Unverified without live probe (#1015) | |
| `agy` | `skill` | `unverified` | Unverified without live probe (#1015) | |
| `agy` | `hook` | `unverified` | Unverified without live probe (#1015) | |
| `agy` | `context` | `native` | Native instruction files (P-37) | |
| `agy` | `plugin` | `unverified` | Unverified without live probe (#1015) | |
| `agy` | `command` | `degraded` | Docket renders template placeholders | `prompt_text` |
| `copilot` | `mcp` | `unverified` | Unverified without live probe (#1015) | |
| `copilot` | `skill` | `unverified` | Unverified without live probe (#1015) | |
| `copilot` | `hook` | `unverified` | Unverified without live probe (#1015) | |
| `copilot` | `context` | `native` | Native instruction files (P-37) | |
| `copilot` | `plugin` | `unverified` | Unverified without live probe (#1015) | |
| `copilot` | `command` | `degraded` | Docket renders template placeholders | `prompt_text` |
| `cursor` | `mcp` | `unverified` | Unverified without live probe (#1015) | |
| `cursor` | `skill` | `unverified` | Unverified without live probe (#1015) | |
| `cursor` | `hook` | `unverified` | Unverified without live probe (#1015) | |
| `cursor` | `context` | `native` | Native instruction files (P-37) | |
| `cursor` | `plugin` | `unverified` | Unverified without live probe (#1015) | |
| `cursor` | `command` | `degraded` | Docket renders template placeholders | `prompt_text` |
| `opencode` | `mcp` | `unverified` | Unverified without live probe (#1015) | |
| `opencode` | `skill` | `unverified` | Unverified without live probe (#1015) | |
| `opencode` | `hook` | `unverified` | Unverified without live probe (#1015) | |
| `opencode` | `context` | `native` | Native instruction files (P-37) | |
| `opencode` | `plugin` | `unverified` | Unverified without live probe (#1015) | |
| `opencode` | `command` | `degraded` | Docket renders template placeholders | `prompt_text` |

### Rules (P-57 … P-60)

- **P-57** (added 2026-10-12, #1006) `supportFor` answers from the table; a missing row is `unverified`; `setupWarnings` returns one warning per (stage, capability) whose support is not `native`, in stage order; the UI shows them at setup time and before a run starts; `unverified` is shown as such, never as `native`.
- **P-58** (added 2026-10-12, #1006) The table's initial content (data in the registry; honest, no claim without evidence — the real-run probe #1015 later turns `unverified` into the observed value): for provider `claude-code` (stream-json/SDK): mcp native, skill native, hook native, context native, plugin native, command degraded→prompt_text; for `codex`: mcp native, context native, skill degraded→context, hook unsupported, plugin unverified, command degraded→prompt_text; for `agy`, `copilot`, `cursor`, `opencode`: every kind `unverified` except context (native: instruction files, P-37) and command (degraded→prompt_text).
- **P-59** (added 2026-10-12, #1006) Translation is per provider and per run: a stage's role capabilities are translated into the run-scoped files/flags the provider's launch rules already use (P-7 addendum for run-scoped files, the MCP child launch rules); a capability whose support is `unsupported` is omitted from the run and recorded in the run record as `omitted_capability`; `degraded` capabilities are inlined as instruction text; no translation ever writes into the repository (D-5) or the user's own provider config.
- **P-60** (added 2026-10-12, #1006) Machine import is read-only: a scan lists `MachineCandidate`s per provider from that provider's own user-level config locations; it never writes there, never copies a secret value (only `secretNames`; at import the user is asked to store the value in the keychain, the definition then holds `{secretRef}`); it supersedes nothing in R-62…R-67 — the existing `CapabilityCandidate` for mcp/skill/context stays and this adds plugin and hook candidates: hook candidates are listed but still not importable (R-66's note, 2026-10-11, stands).
- **P-60 addendum (2026-10-14, #1067)** Evidenced user-level machine scan locations:
  - `claude-code`: `~/.claude/` (`CLAUDE.md`, `.claude.json` mcpServers, `settings.json` hooks/plugins, `skills/*.md`).
  - `codex`: `~/.codex/` (or `$CODEX_HOME`: `config.toml` `[mcp_servers.*]` / `[plugins.*]`, `AGENTS.md`, `skills/`).
  - `copilot`: `~/.copilot/` (or `$COPILOT_HOME`: `mcp-config.json` `mcpServers`, `copilot-instructions.md`, `skills/`, `plugins/`).
  - `opencode`: `~/.config/opencode/` (or `$OPENCODE_CONFIG_DIR`, `$OPENCODE_CONFIG`: `opencode.json` `mcp` / `plugins`, `AGENTS.md`, `skills/`, `plugins/`).
  - Other providers without evidenced documentation (`gemini-cli`) stay unconfigured and return an empty candidate list.

Conflicts and supersessions (added 2026-10-12, #1006, D-7): Glossary "Capability — MCP, skill, hook, context" grows by plugin and command; "capabilities attached to roles" now also arrive through plugins; Phase 3.5 account-scoped capability candidates (R-62…R-67, #850–#866) stay as the import mechanism.

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
