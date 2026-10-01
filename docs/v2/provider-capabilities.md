# Provider capabilities and routes

Design for Phase 3.6 (not yet implemented). It extends `providers.md` and `quota.md`; where they
disagree, this file wins for the topics below and the other two are corrected in the same PR that
implements the change. Rule ids continue the `P-n` series.

Vocabulary: a **provider** is an agent CLI (one definition). An **account** is a credential of a
provider. A **route** is an account plus a model (and, for compatible endpoints, an endpoint). Two
routes of one provider can differ in models, thinking, quota and cost, so capabilities attach to the
route, not to the provider alone.

## 1. The capability record (P-26)
- One data file is the single source of truth: `src/domain/providers/capability-registry.ts`, plain
  `as const` data checked with `satisfies`. No npm packages, no Node builtins, no classes (domain rules).
- It holds, per provider: `planned` (manual flag), the six promotion gates (section 2) each with
  evidence, and its route kinds. Per route kind: auth mode, endpoint host (preset only), identity
  source, `tierModels`, cost kind, quota probe kind, model source. Per model: `id`, `family`, `tier`,
  `thinking`, `contextWindow?`, `retired?`.
- Everything derived from it is a pure function in the same module: support level, thinking options
  for a model, tier resolution. The README matrix is generated from it (P-35). No second table exists.

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

## 2. Support levels and promotion to full (P-27)
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
| G6 Tests | scripted-process scenario plus one operator-gate run on the real CLI | scenario name, run id |

Level derivation (pure, replaces the tier computed from capabilities alone):
- `planned`: the manual flag is set.
- `experimental`: G1 or G2 is missing, or the stream is plain text passed through raw.
- `isolated`: G1, G2, G4, G6 pass and G3 does not (the agent cannot ask; it runs sandboxed).
- `full`: G1–G6 pass (G5 may be waived).
The existing `supportTier(capabilities)` stays until the registry lands; the registry issue deletes it so
only one derivation exists.

## 3. Models and the catalog (P-28)
Four layers, merged per route:
1. **Bundled registry** (the data file): capabilities for known models. The only place that knows
   thinking levels, context window and price kind.
2. **Live list** per route: for Claude routes the SDK's own supported-models call (id, resolved id,
   display name, supported effort levels); for API-key routes the provider's documented model-list
   endpoint; for compatible endpoints the standard model list where it exists; for presets a fixed list.
3. **Merge:** live ∪ bundled. Each model carries its source (`live | bundled`). The cache is keyed by
   account and route, never by provider alone, so a plan-dependent list (for example a model only a
   higher subscription plan offers) never leaks to another account. A failed refresh keeps the last good
   list and marks it stale.
4. **Unknown model:** never rejected. A live id missing from the registry is selectable with unknown
   capabilities: thinking control hidden, price unknown. If its family is recognised by id pattern it gets
   a tier automatically and is labelled auto-classified. `retired` models stay in the registry so old
   records still render.
Tier resolution: a route's strong/balanced/fast tier resolves to the highest-version available model of
that tier, unless the route kind fixes `tierModels` (compatible endpoints map them explicitly).
The registry is updated by Docket releases. Fetching the registry from the internet is out of scope until
the operator decides it (open decision O-4).

## 4. Thinking levels (P-29)
- The user sees Fast / Balanced / Deep. They map to the model's supported levels: Fast → lowest,
  Balanced → `medium` (else the nearest lower), Deep → the highest level up to `xhigh`; `max` is
  reachable only from advanced settings. The mapping table is data, not code.
- A model with `thinking: none` hides the control and says the model offers no thinking level.
- The provider-specific parameter is produced by the definition's `buildLaunch`/transport from the chosen
  level; an unsupported level is clamped down, never sent.
- Thinking tokens are counted as output and shown as a separate usage line.

## 5. Accounts and route kinds (P-30)
New account fields (all non-secret): `routeKind`, `endpoint?` (URL), `identityDir?` (path),
`tierModels?`. Secrets stay in the OS keychain behind `secretRef`; records never carry environment values.
Route kinds are data: `anthropic-subscription`, `anthropic-api`, and presets for compatible endpoints
(the GLM preset fixes the endpoint host, the three tier models, cost kind `equivalent`, quota probe
`zai-http`). The definition builds the child environment from these fields (base URL, token, tier model
aliases); Docket never stores those environment values.

## 6. Subscription identity (P-31)
Finding: the SDK leg passes no config directory, so every subscription run falls back to the single
machine login. A second subscription account on the same machine cannot be selected.
Rule: a subscription account carries `identityDir`, the user's own config directory, passed to the child as
the config-directory variable. `settingSources` stays empty so the user's settings and hooks do not affect
runs; MCP servers stay inline. Docket never writes into `identityDir` and never reads credential values from
it. Needs verification before the issue is cut: how the CLI keys its stored login per config directory on
macOS and Linux. Consequence to decide (O-2): sessions of such runs are stored under `identityDir`.

## 7. Local account discovery (P-32)
- A port `AccountDiscovery` scans the user's home for Claude-style config directories and proposes
  **candidates**; it never adds an account silently.
- Classification uses only key names and the endpoint host: an endpoint host matching a preset → that
  preset; an OAuth account present → subscription; neither → ignored (side-tool directories).
- Credential values are never read into Docket's records or logs. Importing a token is a separate step
  with explicit consent that moves the value into the keychain.
- Several accounts of one provider are normal: each is its own candidate and its own route.

## 8. Quota and cost per route (P-33)
- Subscription: SDK usage query and rate-limit events, as today (`claude-probe`).
- Compatible-endpoint preset (GLM): an HTTP quota probe against the provider's monitor endpoint with the
  account token. **The endpoint is observed behaviour of the operator's own tooling, not a published
  contract; it can change.** Failure → quota `unknown`, the run is not blocked; spend caps and 429 mapping
  to `limit_hit` still protect. Response windows map to meters: the 5-hour token window and the monthly
  tool window. Cache 60 s, show the last good value with a stale mark. No weekly window exists on this route.
- Cost kind per route: subscription `equivalent`; API key `reported` when the SDK reports it, otherwise
  `computed` from the registry price table (labelled estimate); GLM preset `equivalent`. The Anthropic
  price table never applies to a compatible endpoint.

## 9. Adding a provider (P-34)
A new provider is a definition plus the argument builder, nothing else, when it fits an existing transport.
A conformance suite runs the same fixture scenarios against every definition (launch via stdin or file,
event mapping, resume, stop). New providers enter as `experimental` or `isolated` and are promoted only
through the gates. Candidate classes, by how they fit today's transports:

| Class | Providers | Effort |
| --- | --- |
| Already supported | Claude Code, Codex, Antigravity, OpenCode, Cursor, Copilot, Gemini | model layer only |
| ACP, existing transport | kilo, vibe, hermes, devin, trae-cli, reasonix | S each |
| ACP with a special case | kimi, kiro, amr | M each |
| Stream JSON, new dialect (one per family) | amp, codebuddy (Claude-style stream); qoder; mimo (OpenCode-style) | M per family |
| Plain text, experimental only | grok-build, qwen, deepseek, aider, atomcode | S each |
| New transport | pi, deepseek-harness | L, later |
S ≈ one issue (definition, argument builder, scripted-agent test); M ≈ two; L = a transport. This list is a
backlog, not a promise. Priority is the operator's own providers: Claude Code, Codex, then the GLM route.

## 10. README matrix (P-35)
`scripts/gen-provider-matrix.mjs` writes the provider × model table (thinking, context, cost kind, support
level) into the README between marker comments, from the capability record. A test regenerates it in memory
and fails on any difference. The README is a product document and may name providers; the provider-name
restriction applies to code and comments under `src/` only.

## Open decisions
- O-1 Where endpoint and model mapping live: account fields (proposed) or a separate preset record.
- O-2 Subscription sessions stored under the user's config directory, or copied per run.
- O-3 Pilot providers for the add-a-provider path (proposed: kilo, hermes, amp).
- O-4 Whether Docket may fetch an updated model registry from the internet.
- O-5 Minimum supported CLI versions, as data, for the capability scan.
