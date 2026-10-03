// The capability registry: the single data file every support-level, route and model question is
// answered from. A gate carries evidence only where a test of that exact title exists in this
// repository — an absent gate is honesty, not an oversight. Without a recorded operator-gate run
// no provider can read as `full`; without usage visibility (G4) none can read as `isolated`, so
// today only the sdk provider tops out at `isolated` and the rest stay `experimental`. Model data
// (models, effort levels, prices) lands with the model-catalog issues; the route kinds start empty.
import type { CapabilityRegistry, FamilyPattern, ProviderRecord, RouteKindRecord } from '../../../domain/index';

/** Family recognition as data (P-29 section 4): an unknown live id containing `contains` gets that
 * tier automatically. The Fable family has no entry on purpose — it stays unclassified (selectable,
 * no automatic tier) until the architect decides its tier. */
export const FAMILY_PATTERNS: readonly FamilyPattern[] = [
  { contains: 'opus', tier: 'strong' },
  { contains: 'sonnet', tier: 'balanced' },
  { contains: 'haiku', tier: 'fast' },
];

export const CAPABILITY_REGISTRY = {
  providers: [
    {
      // The sdk transport exists for this CLI alone, so the SDK message suites are its evidence.
      // The CLI keeps its machine login in its own config directory, so the isolation proof is the
      // launch that never points the config directory at the run directory.
      providerId: 'claude-code',
      isolation: { kind: 'test', name: 'P-44: a subscription launch never points the config directory at the run directory, whatever the ambient environment carries' },
      gates: {
        G1: { kind: 'test', name: 'P-4: probes run once each on exactly the resolved path, each under a timeout' },
        G2: { kind: 'test', name: 'I-27: assistant content blocks map in order' },
        G3: { kind: 'test', name: 'I-29: a scripted session yields session_started, tool_call, permission_ask, usage and finished in order once answered' },
        G4: { kind: 'test', name: 'I-27: result maps to usage carrying the context costKind, then finished completed' },
        G5: { kind: 'test', name: 'P-21: get_usage utilization is 0–100 and normalises to the same meter scale a pushed rate_limit_event uses' },
        G6: { kind: 'test', name: 'P-24: sdk, app-server and acp each run the identical work order to done with the same common event kinds and exactly one finished per run' },
      },
    },
    {
      // No G4: the app-server transport maps no usage event, so cost visibility is unproven.
      // No isolation evidence on purpose (P-44): the CLI keeps its login under its own home, so
      // the home is left alone and the CLI reads its own configuration; the cap holds.
      providerId: 'codex',
      gates: {
        G1: { kind: 'test', name: 'P-4: probes run once each on exactly the resolved path, each under a timeout' },
        G2: { kind: 'test', name: 'P-12: the run opens with initialize → thread/start → turn/start and maps the turn stream to AgentEvents' },
        G3: { kind: 'test', name: 'P-13: an approval request becomes a permission_ask; the user’s allow is delivered as the JSON-RPC response and nothing is ever auto-approved' },
        G5: { kind: 'test', name: 'P-20: reads rate limits through the app-server connection and maps primary/secondary windows to meters with exact resets, source polled' },
        G6: { kind: 'test', name: 'P-24: sdk, app-server and acp each run the identical work order to done with the same common event kinds and exactly one finished per run' },
      },
    },
    {
      // No G3 — the dialect surfaces no permission asks — and no G6, the end-to-end scenario has
      // no stream-json leg. No isolation evidence on purpose (P-44): the CLI documents no
      // config-dir override and no login location, so HOME is left alone (a run-scoped home could
      // cut the CLI off from its login) and the CLI reads its own configuration; the cap holds.
      providerId: 'agy',
      gates: {
        G1: { kind: 'test', name: 'P-4: probes run once each on exactly the resolved path, each under a timeout' },
        G2: { kind: 'test', name: 'P-11: the text turn fixture maps to session_started, one text, usage and a completed finished' },
        G4: { kind: 'test', name: 'P-11: an ERROR result ends usage + finished failed, so malformed-input runs still fold into one finished' },
        G5: { kind: 'test', name: 'P-19: runs `agy -p /usage --output-format json` and parses the payload from stderr' },
      },
    },
    {
      // No isolation evidence on purpose (P-44): the CLI's documented home override
      // (COPILOT_HOME) is also where its stored login lives, so neither HOME nor that variable is
      // ever redirected or named and the CLI reads its own configuration; the cap holds.
      providerId: 'copilot',
      gates: {
        G1: { kind: 'test', name: 'P-4: probes run once each on exactly the resolved path, each under a timeout' },
        G2: { kind: 'test', name: 'P-15: initialize → session/new (carrying the run-scoped config) → session/prompt; session/update maps to AgentEvents and an unknown update kind becomes a raw event, never an error' },
        G3: { kind: 'test', name: 'P-16: session/request_permission becomes a permission_ask that waits for the user; the answer round-trips and nothing is ever auto-approved' },
        G6: { kind: 'test', name: 'P-24: sdk, app-server and acp each run the identical work order to done with the same common event kinds and exactly one finished per run' },
      },
    },
    {
      // No isolation evidence on purpose (P-44): the CLI documents no config-dir or home override
      // and says only that the stored authentication is kept locally, so HOME is left alone (a
      // run-scoped home could cut the CLI off from its login) and the CLI reads its own
      // configuration; the cap holds.
      providerId: 'cursor',
      gates: {
        G1: { kind: 'test', name: 'P-4: probes run once each on exactly the resolved path, each under a timeout' },
        G2: { kind: 'test', name: 'P-15: initialize → session/new (carrying the run-scoped config) → session/prompt; session/update maps to AgentEvents and an unknown update kind becomes a raw event, never an error' },
        G3: { kind: 'test', name: 'P-16: session/request_permission becomes a permission_ask that waits for the user; the answer round-trips and nothing is ever auto-approved' },
        G6: { kind: 'test', name: 'P-24: sdk, app-server and acp each run the identical work order to done with the same common event kinds and exactly one finished per run' },
      },
    },
    {
      providerId: 'opencode',
      isolation: { kind: 'test', name: 'P-8: the opencode launch environment is exactly the config dir plus the documented Claude-compatibility switch' },
      gates: {
        G1: { kind: 'test', name: 'P-4: probes run once each on exactly the resolved path, each under a timeout' },
        G2: { kind: 'test', name: 'P-15: initialize → session/new (carrying the run-scoped config) → session/prompt; session/update maps to AgentEvents and an unknown update kind becomes a raw event, never an error' },
        G3: { kind: 'test', name: 'P-16: session/request_permission becomes a permission_ask that waits for the user; the answer round-trips and nothing is ever auto-approved' },
        G6: { kind: 'test', name: 'P-24: sdk, app-server and acp each run the identical work order to done with the same common event kinds and exactly one finished per run' },
      },
    },
    {
      // No isolation evidence on purpose (P-44): without a run-scoped home the CLI reads its own
      // home and auto-injects instruction files (AGENTS.md, SOUL.md, .cursorrules), memory and
      // preloaded skills per its own `--help`, so the level stays capped at experimental and runs
      // show that the CLI may read the user's own configuration. Its own writes (memory, skill
      // learning) stay under its home; Docket never writes or reads there. G4 is absent: no
      // usage mapping is proven for this CLI.
      providerId: 'hermes',
      gates: {
        G1: { kind: 'test', name: 'P-45: an ACP login probe reads an opened session as logged in, the documented refusal as logged out and any other answer as unknown' },
        G2: { kind: 'test', name: 'P-15: initialize → session/new (carrying the run-scoped config) → session/prompt; session/update maps to AgentEvents and an unknown update kind becomes a raw event, never an error' },
        G3: { kind: 'test', name: 'P-16: session/request_permission becomes a permission_ask that waits for the user; the answer round-trips and nothing is ever auto-approved' },
        G5: { kind: 'waived', reason: 'no machine-readable quota in the ACP session; a limit error maps to limit_hit' },
        G6: { kind: 'test', name: 'P-24: sdk, app-server and acp each run the identical work order to done with the same common event kinds and exactly one finished per run' },
      },
    },
    {
      // No isolation evidence on purpose (P-44): the CLI reads the user's `~/.claude` and
      // `~/.cursor` state by default, and the switch its own documentation names — the
      // `compat.claude.*` / `compat.cursor.*` keys of the CLI's config file under its home — is
      // not a file the launch writes, so the level stays capped at experimental. Instruction
      // files read natively: AGENTS.md/Agents.md/AGENT.md, CLAUDE.md/Claude.md/CLAUDE.local.md,
      // plus the .grok/rules, .claude/rules and .cursor/rules directories and their home
      // equivalents; the compat cells show all of it default-on (doc + live `inspect --json`;
      // the key names are documentation-only). G3 is absent: `session/request_permission` is
      // unproven until an operator run. G4 is absent: no usage mapping is proven for this CLI.
      providerId: 'grok-build',
      gates: {
        G1: { kind: 'test', name: 'P-45: a login probe that reads only the presence of the CLI\'s credential file answers true or false and never spawns the CLI or reads the file' },
        G2: { kind: 'test', name: 'P-15: initialize → session/new (carrying the run-scoped config) → session/prompt; session/update maps to AgentEvents and an unknown update kind becomes a raw event, never an error' },
        G5: { kind: 'waived', reason: 'provider reports no machine-readable quota; limit errors (rate_limited, usage_limit_reached, usage_pool_exhausted) map to limit_hit' },
        G6: { kind: 'test', name: 'P-24: sdk, app-server and acp each run the identical work order to done with the same common event kinds and exactly one finished per run' },
      },
    },
    {
      // No isolation evidence on purpose: the variables that would keep the CLI from reading the
      // user's other tool files appear only as strings in its binary, so the P-44 cap holds.
      providerId: 'kilo',
      gates: {
        G1: { kind: 'test', name: 'P-4: probes run once each on exactly the resolved path, each under a timeout' },
        G2: { kind: 'test', name: 'P-15: initialize → session/new (carrying the run-scoped config) → session/prompt; session/update maps to AgentEvents and an unknown update kind becomes a raw event, never an error' },
        G5: { kind: 'waived', reason: 'provider reports no machine-readable quota; a limit error maps to limit_hit' },
        G6: { kind: 'test', name: 'P-24: sdk, app-server and acp each run the identical work order to done with the same common event kinds and exactly one finished per run' },
      },
    },
    {
      // No isolation evidence on purpose (P-44): the CLI documents no switch that keeps it from
      // reading other tools' instruction files and its login lives in its own home, so the level
      // stays capped at experimental. Only the telemetry-off flag is declared. G3 and G4 are
      // absent: the permission request is known from source only and no usage mapping is proven.
      providerId: 'atomcode',
      gates: {
        G1: { kind: 'test', name: 'P-4: probes run once each on exactly the resolved path, each under a timeout' },
        G2: { kind: 'test', name: 'P-15: initialize → session/new (carrying the run-scoped config) → session/prompt; session/update maps to AgentEvents and an unknown update kind becomes a raw event, never an error' },
        G5: { kind: 'waived', reason: 'provider reports no machine-readable quota; a limit error maps to limit_hit' },
        G6: { kind: 'test', name: 'P-24: sdk, app-server and acp each run the identical work order to done with the same common event kinds and exactly one finished per run' },
      },
    },
    {
      // No isolation evidence on purpose (P-44): the CLI documents no switch that keeps it from
      // reading other tools' files and its home variable holds the API key, so the home is left
      // alone and the level stays capped at experimental. G1 is absent: the CLI has no status
      // command, so no login probe exists. G3 and G4 are absent: the permission request and the
      // usage update are known from source only.
      providerId: 'vibe',
      gates: {
        G2: { kind: 'test', name: 'P-15: initialize → session/new (carrying the run-scoped config) → session/prompt; session/update maps to AgentEvents and an unknown update kind becomes a raw event, never an error' },
        G5: { kind: 'waived', reason: 'provider reports no machine-readable quota; a limit error maps to limit_hit' },
        G6: { kind: 'test', name: 'P-24: sdk, app-server and acp each run the identical work order to done with the same common event kinds and exactly one finished per run' },
      },
    },
    {
      // Planned, no built-in definition: the CLI imports the user's Claude Code rules, skills and
      // MCP servers when its ACP server starts and runs those servers. Its only documented off
      // switch is the `read_config_from` key of a config file, which the launch cannot supply:
      // an isolation argument is static, while the file must be written per run, and the CLI
      // documents no run-scoped config directory or environment variable. Until a documented
      // switch the launch can pass exists, a run would execute the user's own tools.
      providerId: 'devin',
      planned: true,
      gates: {},
    },
    {
      // No isolation evidence on purpose (P-44): the one documented variable that moves state
      // leaves the global provider credentials and config in the CLI's own home, so no run-scoped
      // home exists and the level stays capped at experimental. G3 is absent: the permission request is documented but
      // unproven until an operator run. G4 is absent: the CLI's cost quote is not mapped.
      providerId: 'reasonix',
      gates: {
        G1: { kind: 'test', name: 'P-4: probes run once each on exactly the resolved path, each under a timeout' },
        G2: { kind: 'test', name: 'P-15: initialize → session/new (carrying the run-scoped config) → session/prompt; session/update maps to AgentEvents and an unknown update kind becomes a raw event, never an error' },
        G5: { kind: 'waived', reason: 'provider reports no machine-readable quota; a limit error maps to limit_hit' },
        G6: { kind: 'test', name: 'P-24: sdk, app-server and acp each run the identical work order to done with the same common event kinds and exactly one finished per run' },
      },
    },
    {
      // No isolation evidence on purpose (P-44): the CLI's help documents no switch that keeps it
      // from reading other tools' files, and its login lives in its own data directory, so the
      // level stays capped at experimental. G3 and G4 are absent: the permission request and the
      // usage update are known from source only.
      providerId: 'mimo',
      gates: {
        G1: { kind: 'test', name: 'P-4: probes run once each on exactly the resolved path, each under a timeout' },
        G2: { kind: 'test', name: 'P-15: initialize → session/new (carrying the run-scoped config) → session/prompt; session/update maps to AgentEvents and an unknown update kind becomes a raw event, never an error' },
        G5: { kind: 'waived', reason: 'provider reports no machine-readable quota; a limit error maps to limit_hit' },
        G6: { kind: 'test', name: 'P-24: sdk, app-server and acp each run the identical work order to done with the same common event kinds and exactly one finished per run' },
      },
    },
    {
      // No isolation evidence on purpose (P-44): the CLI's login and its model catalog live in
      // the user's own settings under the CLI's home, no documented switch redirects them, and
      // Docket neither reads nor writes that file, so the level stays capped at experimental. G3
      // and G4 are absent: the permission request is unproven until an operator run, and the
      // usage update carries context size only, so no cost is visible.
      providerId: 'qwen',
      gates: {
        G1: { kind: 'test', name: 'P-4: probes run once each on exactly the resolved path, each under a timeout' },
        G2: { kind: 'test', name: 'P-15: initialize → session/new (carrying the run-scoped config) → session/prompt; session/update maps to AgentEvents and an unknown update kind becomes a raw event, never an error' },
        G5: { kind: 'waived', reason: 'provider reports no quota; a limit error maps to limit_hit (failed fast, not retried)' },
        G6: { kind: 'test', name: 'P-24: sdk, app-server and acp each run the identical work order to done with the same common event kinds and exactly one finished per run' },
      },
    },
    {
      // No isolation evidence on purpose (P-44): the CLI's login lives in its own ~/.qoder home
      // and no documented switch redirects its state, so the home is left alone and the level
      // stays capped at experimental. The CLI reads its own instruction files (AGENTS.md,
      // .qoder/rules, ~/.qoder/AGENTS.md; CLAUDE.md is not read by default), but that is its own
      // behaviour, not an isolation Docket enforces. G3 and G4 are absent: the requestPermission
      // round trip is unproven until an operator run, and no cost field is verified on the ACP
      // stream — credits ride the provider SDK's control channel, which no Docket leg calls.
      providerId: 'qoder',
      gates: {
        G1: { kind: 'test', name: 'P-4: probes run once each on exactly the resolved path, each under a timeout' },
        G2: { kind: 'test', name: 'P-15: initialize → session/new (carrying the run-scoped config) → session/prompt; session/update maps to AgentEvents and an unknown update kind becomes a raw event, never an error' },
        G5: { kind: 'waived', reason: 'provider reports no machine-readable quota; a limit error maps to limit_hit' },
        G6: { kind: 'test', name: 'P-24: sdk, app-server and acp each run the identical work order to done with the same common event kinds and exactly one finished per run' },
      },
    },
    {
      // No isolation evidence on purpose (P-44): the CLI documents no per-run home or config
      // variable and its login lives in `~/.kiro`, so a run reads the user's own steering files
      // and the level stays capped at experimental. G3 is absent: the ask-first default is
      // documented (and a non-interactive run treats every ask as deny) but the permission wait
      // is unproven until an operator run. G4 is absent: usage is metered in credits whose
      // machine-readable fields are unverified. Instruction files: AGENTS.md and .kiro/steering/
      // are read natively, CLAUDE.md is not.
      providerId: 'kiro',
      gates: {
        G1: { kind: 'test', name: 'P-45: the whoami login probe reads only the account key — null is logged out, a populated account logged in, anything else unknown' },
        G2: { kind: 'test', name: 'P-15: the kiro session shape — modes without configOptions, custom _kiro.dev notifications — opens a session and maps its turn without an error' },
        G5: { kind: 'waived', reason: 'provider reports no machine-readable quota; a limit error maps to limit_hit' },
        G6: { kind: 'test', name: 'P-24: sdk, app-server and acp each run the identical work order to done with the same common event kinds and exactly one finished per run' },
      },
    },
    {
      // No isolation evidence on purpose (P-44): config is none — the login lives in the CLI's
      // own home and the launch redirects no home — so the run may read the CLI's own settings
      // and the level stays capped at experimental (the run's own settings file replaces the
      // user's, but that file is Docket's, not a switch of the CLI's). G1 is absent: the
      // account-list probe's logged-in output is unverified, so it answers logged-out or unknown,
      // never logged in. G3 is absent: the CLI asks no tool approval by default, so a run needs a
      // sandbox or worktree — the definition targets the isolated level first. G6 is absent: the
      // end-to-end scenario test covers the sdk, app-server and acp transports, not stream-json.
      providerId: 'amp',
      gates: {
        G2: { kind: 'test', name: 'P-11: the text turn fixture maps to session_started, text, usage and one completed finished' },
        G4: { kind: 'test', name: 'P-11: an error result ends usage, error and one failed finished, so failed runs still fold into one finished' },
        G5: { kind: 'waived', reason: 'provider reports no machine-readable quota; the usage command\'s output is unverified and its adapter is a separate issue; a limit error maps to limit_hit' },
      },
    },
    {
      // No isolation evidence on purpose (P-44): the CLI's login, config and sessions all live in
      // its own ~/.kimi-code home (relocated only by the machine's own KIMI_CODE_HOME), no
      // documented switch redirects them for a run, and Docket never writes that home, so the
      // level stays capped at experimental. G3 and G4 are absent: the request_permission round
      // trip is unproven until an operator run, and the ACP usage_update carries context size
      // only — the CLI's quota channel is a local REST server no Docket leg starts, and the
      // engine itself is documented to have no cost data. Instruction files: AGENTS.md is read
      // natively, CLAUDE.md is not.
      providerId: 'kimi',
      gates: {
        G1: { kind: 'test', name: 'P-45: the kimi login probe reads only whether a file exists under the CLI\'s credentials directory — true or false, never spawning the CLI and never reading a file' },
        G2: { kind: 'test', name: 'P-15: the kimi session shape — model select plus a thinking thought_level select recomputed on a model change — opens a session, maps its turn and never sends a level the model does not list' },
        G5: { kind: 'waived', reason: 'the provider\'s quota channel is only a local REST server; a limit error maps to limit_hit (failed fast, not retried)' },
        G6: { kind: 'test', name: 'P-24: sdk, app-server and acp each run the identical work order to done with the same common event kinds and exactly one finished per run' },
      },
    },
    {
      // No isolation evidence on purpose (P-44): config is none — the login lives in the CLI's
      // own ~/.codebuddy home and the launch redirects no home — so a run reads the CLI's own
      // instruction files (CODEBUDDY.md first, otherwise AGENTS.md; CLAUDE.md is not documented
      // as read) and the level stays capped at experimental. G3 is absent: the headless
      // permission ask (the canUseTool control request) is unverified until an operator run, so
      // a run relies on dontAsk plus a sandbox. G6 is absent: the end-to-end scenario test
      // covers the sdk, app-server and acp transports, not stream-json.
      providerId: 'codebuddy',
      gates: {
        G1: { kind: 'test', name: 'P-45: an ACP login probe reads an opened session as logged in, the documented refusal as logged out and any other answer as unknown' },
        G2: { kind: 'test', name: 'P-11: the text turn fixture maps to session_started, one text, usage with the reported cost and one completed finished' },
        G4: { kind: 'test', name: 'P-11: a quota result ends usage, limit_hit and one finished limit, so exhausted runs still fold into one finished' },
        G5: { kind: 'waived', reason: 'provider reports no machine-readable quota; a limit error maps to limit_hit' },
      },
    },
  ],
  routeKinds: [
    {
      // Subscription runs ride the SDK leg, which passes no config directory, so the identity is
      // the machine's single login.
      id: 'anthropic-subscription',
      providerId: 'claude-code',
      authMode: 'subscription',
      identity: 'machine_login',
      costKind: 'equivalent',
      quotaProbe: 'sdk_usage',
      modelSource: 'sdk',
      liveIsAuthoritative: true,
      familyBilling: [
        { contains: 'opus', billing: 'included' },
        { contains: 'sonnet', billing: 'included' },
        { contains: 'haiku', billing: 'included' },
      ],
      // The plan table covers the opus, sonnet and haiku families on every subscription tier, so
      // their current flagships are bundled as included — a pinned model on a plan no longer asks
      // for spend consent. The fable family splits per plan (inside the weekly limits on some,
      // usage-credits-only on others) and the record shape carries one billing per model, so it
      // stays unbundled: live-only rows read unknown and remain hand-pick-with-consent. The ids,
      // effort sets and plan rows follow the provider's current model-configuration and plan
      // documentation.
      models: [
        {
          id: 'claude-opus-5-5',
          family: 'opus',
          tier: 'strong',
          thinking: { kind: 'levels', levels: ['low', 'medium', 'high', 'xhigh', 'max'] },
          billing: 'included',
        },
        {
          id: 'claude-sonnet-5-5',
          family: 'sonnet',
          tier: 'balanced',
          thinking: { kind: 'levels', levels: ['low', 'medium', 'high', 'xhigh', 'max'] },
          billing: 'included',
        },
        {
          id: 'claude-haiku-4-5',
          family: 'haiku',
          tier: 'fast',
          thinking: { kind: 'none' },
          billing: 'included',
        },
      ],
    },
    {
      // API-key runs take the key from the keychain and report costs straight from the stream;
      // the live model list comes from the documented model-list endpoint, not the SDK. Every
      // model there is billed per use, so the kind defaults its live-only rows to metered.
      id: 'anthropic-api',
      providerId: 'claude-code',
      authMode: 'api_key',
      identity: 'secret',
      costKind: 'reported',
      quotaProbe: 'rate_limit_events',
      modelSource: 'api',
      liveIsAuthoritative: true,
      defaultBilling: 'metered',
      models: [],
    },
    {
      // A compatible endpoint reached through the vendor CLI's Anthropic-style variables: the
      // registry fixes the endpoint host and the three tier aliases (ids and host follow the
      // provider's own coding-plan documentation), the account fixes the exact URL and its token.
      // The endpoint answers the standard supported-models call through the shared route
      // environment, so the live list rides the SDK leg. The Anthropic price table never applies
      // to such an endpoint, so costs read as equivalents.
      id: 'zai-glm',
      providerId: 'claude-code',
      authMode: 'api_key',
      endpointHost: 'api.z.ai',
      identity: 'secret',
      costKind: 'equivalent',
      quotaProbe: 'http_monitor',
      modelSource: 'sdk',
      liveIsAuthoritative: true,
      models: [],
      tierModels: { strong: 'glm-5.3', balanced: 'glm-5.3-flash', fast: 'glm-5.3-flash' },
    },
    {
      // The login's model list is the plan-scoped ACP session answer (initialize then
      // session/new, no prompt turn): on a plan limited to the automatic choice it reports that
      // choice alone, so the list is authoritative and the registry bundles no models. The
      // tiers name the choice's quality settings — the automatic mode maps strong, balanced and
      // fast to its intelligence, balance and efficiency settings — and the adapter exposes
      // those settings as the listed entries. Usage is metered in the provider's own credit
      // unit (1 credit = $0.01, token-based), so costs read as credits; which models the plan
      // covers is not documented per model, so live rows stay unknown and no billing default
      // applies. The quota snapshot itself rides the provider SDK's quota call, which this
      // repository does not depend on — no probe exists yet, and the kind says none.
      id: 'copilot-subscription',
      providerId: 'copilot',
      authMode: 'subscription',
      identity: 'machine_login',
      costKind: 'credits',
      quotaProbe: 'none',
      modelSource: 'acp-session',
      liveIsAuthoritative: true,
      models: [],
      tierModels: { strong: 'intelligence', balanced: 'balance', fast: 'efficiency' },
    },
    {
      // The subscription login's models come from the CLI's own app-server control surface
      // (initialize then model/list, no thread and no turn); the plan scopes the list, so it is
      // authoritative. The same surface answers the rate-limit poll — a provider query — and the
      // plan's allowance reads as equivalents. The provider documents that its agent is included
      // across its plans with plan-varying usage limits, so a listed model the row itself says
      // nothing about reads as covered by the plan.
      id: 'codex-subscription',
      providerId: 'codex',
      authMode: 'subscription',
      identity: 'machine_login',
      costKind: 'equivalent',
      quotaProbe: 'provider_query',
      modelSource: 'app-server',
      liveIsAuthoritative: true,
      defaultBilling: 'included',
      models: [],
    },
    {
      // The subscription login's models come from the CLI's own listing subcommand (`agy models`
      // — a plain command run, no login, no agent turn); the plan scopes what the account may
      // use, so the list is authoritative, and the quota poll rides the provider's own query
      // (`/usage` in print mode). The plan documentation covers the Gemini models on every plan
      // but documents third-party model access as the top plan's ("rate limits and model
      // availability differ based on your Google AI plan"), so no single billing answer covers
      // the listed set: every live row reads unknown — hand-pick with consent — instead of a
      // claim the documentation does not make. Beyond the baseline quota the plan offers an
      // account-side overage setting (AI credits, opt-in); the provider's own setting, shown
      // never changed.
      id: 'agy-subscription',
      providerId: 'agy',
      authMode: 'subscription',
      identity: 'machine_login',
      costKind: 'equivalent',
      quotaProbe: 'provider_query',
      modelSource: 'cli-command',
      liveIsAuthoritative: true,
      models: [],
    },
    {
      // The machine login's models come from a protocol session the provider opens on demand —
      // initialize then session/new in a scratch directory, never a prompt — so the list reflects
      // the logged-in plan and is authoritative. The provider reports no quota a machine can read
      // (its spending state lives on a human-readable web dashboard), and its documentation does
      // not say the CLI's model usage is covered by the plan's monthly pools, so a listed model
      // reads unknown and stays a hand pick with spend consent (P-40).
      id: 'cursor-subscription',
      providerId: 'cursor',
      authMode: 'subscription',
      identity: 'machine_login',
      costKind: 'equivalent',
      quotaProbe: 'none',
      modelSource: 'acp-session',
      liveIsAuthoritative: true,
      models: [],
    },
    {
      // Same session-listed surface, with the model select arriving as a config option of
      // reserved category `model` and its effort sibling of category `thought_level`. Coverage
      // depends on the login (a subscription's per-model dollar limits, a prepaid balance, or the
      // free tier when nobody is logged in) and the documentation ties no listed model to a
      // covered plan, so live rows read unknown; the per-model dollar windows the plan defines
      // are not exposed to machines, so no probe exists.
      id: 'opencode-subscription',
      providerId: 'opencode',
      authMode: 'subscription',
      identity: 'machine_login',
      costKind: 'equivalent',
      quotaProbe: 'none',
      modelSource: 'acp-session',
      liveIsAuthoritative: true,
      models: [],
    },
    {
      // The CLI is a gateway to whichever inference provider the machine configured, so the
      // plan behind a listed model is the user's own and no source says how it is billed: live
      // rows read unknown and stay a hand pick with spend consent (P-40). The model list is the
      // session answer's `models.availableModels` (ids as `provider:model`, kept whole); a
      // logged-out machine's session is refused, which leaves the list empty. No quota channel
      // is read yet.
      id: 'hermes-subscription',
      providerId: 'hermes',
      authMode: 'subscription',
      identity: 'machine_login',
      costKind: 'none',
      quotaProbe: 'none',
      modelSource: 'acp-session',
      liveIsAuthoritative: true,
      defaultBilling: 'unknown',
      models: [],
    },
    {
      // Same session-listed surface as the opencode kind: the model select and its thought-level
      // sibling arrive as config options. The login may be a gateway account or a bring-your-own-key
      // credential and no plan source inside the CLI separates them, so every live row reads
      // unknown (P-40) and stays a hand pick with spend consent; no machine-readable quota exists.
      id: 'kilo-login',
      providerId: 'kilo',
      authMode: 'subscription',
      identity: 'machine_login',
      costKind: 'equivalent',
      quotaProbe: 'none',
      modelSource: 'acp-session',
      liveIsAuthoritative: true,
      defaultBilling: 'unknown',
      models: [],
    },
    {
      // The model list is the `initialize` answer's `_meta.modelState.availableModels`, which the
      // CLI gives even when nobody is logged in, so the list is not gated by the login. Whether
      // a login is a plan or a metered key is not visible to a machine, so every row reads
      // unknown (P-40) and stays a hand pick with spend consent; no machine-readable quota exists.
      id: 'grok-build-login',
      providerId: 'grok-build',
      authMode: 'subscription',
      identity: 'machine_login',
      costKind: 'none',
      quotaProbe: 'none',
      modelSource: 'acp-session',
      liveIsAuthoritative: true,
      defaultBilling: 'unknown',
      models: [],
    },
    {
      // The model select exists only when the user configured a provider (or signed in to the
      // CodingPlan), so a session without it lists no models. Whether the plan behind a row is
      // free or metered depends on that configuration and no source in the CLI says, so every
      // row reads unknown (P-40) and stays a hand pick with spend consent; no quota channel exists.
      id: 'atomcode-login',
      providerId: 'atomcode',
      authMode: 'subscription',
      identity: 'machine_login',
      costKind: 'none',
      quotaProbe: 'none',
      modelSource: 'acp-session',
      liveIsAuthoritative: true,
      defaultBilling: 'unknown',
      models: [],
    },
    {
      // The CLI runs on an API key, and no plan source inside it says how that key is billed, so
      // every row reads unknown (P-40) and stays a hand pick with spend consent. The model list
      // is the user's local configuration, answered by the session as the `model` select; no
      // quota channel exists.
      id: 'vibe-login',
      providerId: 'vibe',
      authMode: 'subscription',
      identity: 'machine_login',
      costKind: 'none',
      quotaProbe: 'none',
      modelSource: 'acp-session',
      liveIsAuthoritative: true,
      defaultBilling: 'unknown',
      models: [],
    },
    {
      // The CLI is a multi-vendor harness whose built-in provider presets all report the
      // pay-as-you-go billing mode (its billing document names `payg` for a provider and its
      // `doctor billing --json` reports it for each built-in), so live rows default to metered
      // and need spend consent and a cap (P-40). A preset in the `subscription_equivalent` mode or
      // a custom endpoint is not told apart from the session answer and stays a hand pick the
      // user confirms. The model select exists only after a key is configured; no quota channel
      // exists, and the CLI's own cost quote is not mapped, so no cost kind is claimed.
      id: 'reasonix-login',
      providerId: 'reasonix',
      authMode: 'subscription',
      identity: 'machine_login',
      costKind: 'none',
      quotaProbe: 'none',
      modelSource: 'acp-session',
      liveIsAuthoritative: true,
      defaultBilling: 'metered',
      models: [],
    },
    {
      // The model select lists each model plain and once per level; the listing folds the
      // variants into the plain row. The credential may be a free gateway, a pay-as-you-go key or
      // a token plan and no plan source inside the CLI separates them, so every row reads unknown
      // (P-40) and stays a hand pick with spend consent; no quota channel exists.
      id: 'mimo-login',
      providerId: 'mimo',
      authMode: 'subscription',
      identity: 'machine_login',
      costKind: 'none',
      quotaProbe: 'none',
      modelSource: 'acp-session',
      liveIsAuthoritative: true,
      defaultBilling: 'unknown',
      models: [],
    },
    {
      // The catalog is the user's own settings (the providers they configured), answered by the
      // session as models.availableModels plus the model select; Docket never writes those
      // settings and a logged-out machine's session is refused, which leaves the list empty.
      // Whether a row rides the vendor's coding plan or the user's own key is not visible to a
      // machine, so every row reads unknown (P-40) and stays a hand pick with spend consent; no
      // quota channel exists.
      id: 'qwen-login',
      providerId: 'qwen',
      authMode: 'subscription',
      identity: 'machine_login',
      costKind: 'none',
      quotaProbe: 'none',
      modelSource: 'acp-session',
      liveIsAuthoritative: true,
      defaultBilling: 'unknown',
      models: [],
    },
    {
      // The model list is the login-gated session answer (initialize then session/new in a
      // scratch directory, never a prompt), so it is authoritative and drops bundled rows the
      // live list does not contain. The registry bundles the four tier aliases the documentation
      // names as the logged-out fallback — a machine without a login refuses the session with
      // -32000, which the catalog maps to the not-logged-in answer — and other ids come from the
      // live list as unknown models (P-42). Which levels an alias takes is model-dependent, so
      // the records carry the documented vocabulary and the live session's own option refines it.
      // No plan source inside the CLI says which model a plan covers, so every row reads unknown
      // (P-40) and stays a hand pick with spend consent. Credits are reported only through the
      // provider SDK's control channel (getUsageInfo), which no Docket leg calls, so no cost kind
      // is claimed and no quota channel exists; the tiers follow the aliases' documented price
      // factors (ultimate the dearest, efficient the cheapest, auto between).
      id: 'qoder-login',
      providerId: 'qoder',
      authMode: 'subscription',
      identity: 'machine_login',
      costKind: 'none',
      quotaProbe: 'none',
      modelSource: 'acp-session',
      liveIsAuthoritative: true,
      defaultBilling: 'unknown',
      tierModels: { strong: 'ultimate', balanced: 'performance', fast: 'efficient' },
      models: [
        { id: 'auto', family: 'tier', tier: 'balanced', thinking: { kind: 'levels', levels: ['low', 'medium', 'high', 'xhigh', 'max'] } },
        { id: 'ultimate', family: 'tier', tier: 'strong', thinking: { kind: 'levels', levels: ['low', 'medium', 'high', 'xhigh', 'max'] } },
        { id: 'performance', family: 'tier', tier: 'balanced', thinking: { kind: 'levels', levels: ['low', 'medium', 'high', 'xhigh', 'max'] } },
        { id: 'efficient', family: 'tier', tier: 'fast', thinking: { kind: 'levels', levels: ['low', 'medium', 'high', 'xhigh', 'max'] } },
      ],
    },
    {
      // The login's model list is the CLI's own listing subcommand (`kiro-cli chat
      // --list-models -f json` — a plain command run, no agent turn), and the command starts a
      // browser login flow when nobody is logged in, so the listing is gated on the whoami
      // probe's `loggedIn === true` (P-45) and the plan scopes the list, so it is authoritative.
      // Usage is metered in plan credits with a per-model multiplier, but the multiplier is not
      // a price and no machine-readable plan source says which rows a plan covers, so every row
      // reads unknown (P-40) and stays a hand pick with spend consent. The credit quota channel
      // is a separate issue, so no cost kind is claimed yet.
      id: 'kiro-login',
      providerId: 'kiro',
      authMode: 'subscription',
      identity: 'machine_login',
      costKind: 'none',
      quotaProbe: 'none',
      modelSource: 'cli-command',
      liveIsAuthoritative: true,
      defaultBilling: 'unknown',
      models: [],
    },
    {
      // The modes are the models (architect decision, 2026-10-02): the user picks a mode — a
      // fixed model-plus-effort bundle locked for the thread — and no model catalog exists to
      // list, so the four documented modes are the whole catalog as static registry rows and the
      // launch passes the chosen mode through its own --mode flag. No live list exists that
      // could be authoritative. The plan is a monthly credit/USD allowance and no plan source
      // says which mode it covers (the ultra mode runs the strongest models), so every row reads
      // unknown (P-40) and stays a hand pick with spend consent. A row takes no thinking level:
      // the mode already is the effort, and the CLI has no effort flag. The quota rides the
      // provider's own usage command, whose output format is unverified; its adapter is a
      // separate issue, so no probe exists yet.
      id: 'amp-login',
      providerId: 'amp',
      authMode: 'subscription',
      identity: 'machine_login',
      costKind: 'none',
      quotaProbe: 'none',
      modelSource: 'static',
      models: [
        { id: 'low', family: 'tier', tier: 'fast', thinking: { kind: 'none' } },
        { id: 'medium', family: 'tier', tier: 'balanced', thinking: { kind: 'none' } },
        { id: 'high', family: 'tier', tier: 'strong', thinking: { kind: 'none' } },
        { id: 'ultra', family: 'tier', tier: 'strong', thinking: { kind: 'none' } },
      ],
    },
    {
      // The model list is the login-gated session answer (initialize then session/new in a scratch
      // directory, never a prompt): a machine without a login is refused with -32000, which the
      // catalog maps to the not-logged-in answer, and no account-free listing channel exists, so
      // the record bundles nothing — the live list is the only source and drops rows it does not
      // contain (P-42). The membership's model coverage is undocumented, so every live row reads
      // unknown (P-40) and stays a hand pick with spend consent; the Extra Usage pay-as-you-go
      // wallet behind the membership is not a billing answer either. No cost kind is claimed —
      // the ACP usage_update carries context size only — and the quota channel is a local REST
      // server no Docket leg starts (G5 waived).
      id: 'kimi-login',
      providerId: 'kimi',
      authMode: 'subscription',
      identity: 'machine_login',
      costKind: 'none',
      quotaProbe: 'none',
      modelSource: 'acp-session',
      liveIsAuthoritative: true,
      defaultBilling: 'unknown',
      models: [],
    },
    {
      // The model list is the CLI's own --help text, compiled into the shipped build, so it is
      // static registry data: a logged-out machine has no readable account list, and the
      // login-gated ACP session answer is a separate issue for the operator run. The five role
      // aliases and the sixteen concrete ids follow the help text; the aliases' tiers follow
      // their own names (fast and balanced self-describe, primary and deep read strong, default
      // balanced) and the concrete ids' tiers are provisional judgements from each vendor
      // family's flagship ordering, to be corrected by the operator run. The effort flag's
      // levels are the CLI-wide vocabulary the rows carry; per-model support is unverified, so
      // the operator run refines them. Whether a login's plan covers any row is not visible to
      // a machine, so every row and the live default read unknown (P-40) and stay hand picks
      // with spend consent. The result line reports total_cost_usd, so the cost kind is
      // reported; whether a plan fills the field is an operator-run item.
      id: 'codebuddy-login',
      providerId: 'codebuddy',
      authMode: 'subscription',
      identity: 'machine_login',
      costKind: 'reported',
      quotaProbe: 'none',
      modelSource: 'static',
      defaultBilling: 'unknown',
      models: [
        { id: 'default-model', family: 'tier', tier: 'balanced', thinking: { kind: 'levels', levels: ['minimal', 'low', 'medium', 'high', 'xhigh', 'max'] } },
        { id: 'fast-model', family: 'tier', tier: 'fast', thinking: { kind: 'levels', levels: ['minimal', 'low', 'medium', 'high', 'xhigh', 'max'] } },
        { id: 'balanced-model', family: 'tier', tier: 'balanced', thinking: { kind: 'levels', levels: ['minimal', 'low', 'medium', 'high', 'xhigh', 'max'] } },
        { id: 'primary-model', family: 'tier', tier: 'strong', thinking: { kind: 'levels', levels: ['minimal', 'low', 'medium', 'high', 'xhigh', 'max'] } },
        { id: 'deep-model', family: 'tier', tier: 'strong', thinking: { kind: 'levels', levels: ['minimal', 'low', 'medium', 'high', 'xhigh', 'max'] } },
        { id: 'hy4-preview', family: 'hy', tier: 'strong', thinking: { kind: 'levels', levels: ['minimal', 'low', 'medium', 'high', 'xhigh', 'max'] } },
        { id: 'hy3', family: 'hy', tier: 'balanced', thinking: { kind: 'levels', levels: ['minimal', 'low', 'medium', 'high', 'xhigh', 'max'] } },
        { id: 'deepseek-v4.1-flash', family: 'deepseek', tier: 'fast', thinking: { kind: 'levels', levels: ['minimal', 'low', 'medium', 'high', 'xhigh', 'max'] } },
        { id: 'gpt-6-astra', family: 'gpt', tier: 'strong', thinking: { kind: 'levels', levels: ['minimal', 'low', 'medium', 'high', 'xhigh', 'max'] } },
        { id: 'gpt-5.6-sol', family: 'gpt', tier: 'strong', thinking: { kind: 'levels', levels: ['minimal', 'low', 'medium', 'high', 'xhigh', 'max'] } },
        { id: 'gpt-5.6-terra', family: 'gpt', tier: 'balanced', thinking: { kind: 'levels', levels: ['minimal', 'low', 'medium', 'high', 'xhigh', 'max'] } },
        { id: 'gpt-5.6-luna', family: 'gpt', tier: 'fast', thinking: { kind: 'levels', levels: ['minimal', 'low', 'medium', 'high', 'xhigh', 'max'] } },
        { id: 'gpt-5.5', family: 'gpt', tier: 'balanced', thinking: { kind: 'levels', levels: ['minimal', 'low', 'medium', 'high', 'xhigh', 'max'] } },
        { id: 'gpt-5.4', family: 'gpt', tier: 'balanced', thinking: { kind: 'levels', levels: ['minimal', 'low', 'medium', 'high', 'xhigh', 'max'] } },
        { id: 'gemini-3.5-flash', family: 'gemini', tier: 'fast', thinking: { kind: 'levels', levels: ['minimal', 'low', 'medium', 'high', 'xhigh', 'max'] } },
        { id: 'glm-5.3-flash', family: 'glm', tier: 'fast', thinking: { kind: 'levels', levels: ['minimal', 'low', 'medium', 'high', 'xhigh', 'max'] } },
        { id: 'glm-5.3', family: 'glm', tier: 'strong', thinking: { kind: 'levels', levels: ['minimal', 'low', 'medium', 'high', 'xhigh', 'max'] } },
        { id: 'glm-5.2', family: 'glm', tier: 'balanced', thinking: { kind: 'levels', levels: ['minimal', 'low', 'medium', 'high', 'xhigh', 'max'] } },
        { id: 'kimi-k3', family: 'kimi', tier: 'strong', thinking: { kind: 'levels', levels: ['minimal', 'low', 'medium', 'high', 'xhigh', 'max'] } },
        { id: 'kimi-k2.6', family: 'kimi', tier: 'balanced', thinking: { kind: 'levels', levels: ['minimal', 'low', 'medium', 'high', 'xhigh', 'max'] } },
        { id: 'kimi-k2.8-preview', family: 'kimi', tier: 'strong', thinking: { kind: 'levels', levels: ['minimal', 'low', 'medium', 'high', 'xhigh', 'max'] } },
      ],
    },
  ],
} as const satisfies CapabilityRegistry;

/** The instruction files each provider reads natively (P-37) — the provider's best-known set, not a
 *  fixed law of the CLI. Entries name repo-level files and paths the CLI reads on its own; where a
 *  CLI reads a file only conditionally (a documented "X first, otherwise Y" chain), the conditional
 *  names stay OUT of the row so they remain inline candidates — content delivered twice beats
 *  content lost (A-54). Directory-shaped and home-level lookups cannot be flat names, so they ride
 *  the comments. Rows follow the provider order above; the union keeps this order. */
export const PROVIDER_INSTRUCTION_FILES: readonly {
  readonly providerId: string;
  readonly instructionFiles: readonly string[];
}[] = [
  {
    // Its own docs: CLAUDE.md with the project-local and user-level variants. The automatic project
    // memory loads even with every setting source off, so the row names it per P-37 — it lives
    // outside the repo and never matches a repo file, hence never an inline candidate.
    providerId: 'claude-code',
    instructionFiles: ['CLAUDE.md', 'CLAUDE.local.md', '~/.claude/projects/<project>/memory/'],
  },
  {
    // Its own docs: AGENTS.md plus the override companion, walked root→cwd; a global ~/.codex/
    // AGENTS.md and a configurable fallback-filename list (which can add CLAUDE.md) also exist — a
    // fallback entry is exactly the conditional case that stays out of the row.
    providerId: 'codex',
    instructionFiles: ['AGENTS.md', 'AGENTS.override.md'],
  },
  {
    // Its own docs: either context name at the repo root and under .agents/, plus .agents/rules/
    // and ~/.gemini/ rule files (directories, not names). Both names are documented lookups.
    providerId: 'agy',
    instructionFiles: ['AGENTS.md', 'GEMINI.md', '.agents/AGENTS.md', '.agents/GEMINI.md'],
  },
  {
    // Live `instruction list` probe with planted candidate files: the root files it loads. The
    // .github/instructions/*.instructions.md set applies too but is a glob, not a name.
    providerId: 'copilot',
    instructionFiles: ['.github/copilot-instructions.md', 'AGENTS.md', 'CLAUDE.md'],
  },
  {
    // Its own docs: both root files; .cursor/rules/ loads automatically (a directory, not a name).
    providerId: 'cursor',
    instructionFiles: ['AGENTS.md', 'CLAUDE.md'],
  },
  {
    // Its own docs: AGENTS.md walked cwd→root. The Claude fallback is the HOME ~/.claude/CLAUDE.md
    // (behind a documented off switch), not a repo file — a repo CLAUDE.md is not read natively.
    providerId: 'opencode',
    instructionFiles: ['AGENTS.md'],
  },
  {
    // The CLI's own --ignore-rules help text: the files it auto-injects. CLAUDE.md auto-reading is
    // unverified, so it stays out (inlined, never lost).
    providerId: 'hermes',
    instructionFiles: ['AGENTS.md', 'SOUL.md', '.cursorrules', '.hermes.md', 'HERMES.md'],
  },
  {
    // Its own docs and live inspect output: the case variants plus the rules directories
    // (.grok/rules, .claude/rules, .cursor/rules and their home equivalents) and the ~/.claude/*
    // compatibility layer, on by default.
    providerId: 'grok-build',
    instructionFiles: ['AGENTS.md', 'Agents.md', 'AGENT.md', 'CLAUDE.md', 'Claude.md', 'CLAUDE.local.md'],
  },
  {
    // Its own docs: AGENTS.md (/init); .kilo/rules/*.md and the kilo.jsonc instruction globs are
    // directory/glob lookups. Claude-file reading is unverified, so CLAUDE.md stays out.
    providerId: 'kilo',
    instructionFiles: ['AGENTS.md'],
  },
  {
    // Its own README: the preferred file plus AGENTS.md. CLAUDE.md reading is unverified.
    providerId: 'atomcode',
    instructionFiles: ['.atomcode.md', 'AGENTS.md'],
  },
  {
    // Its own docs and source: only AGENTS.md, in trusted folders (project + user home); the
    // source grep shows CLAUDE.md is not read.
    providerId: 'vibe',
    instructionFiles: ['AGENTS.md'],
  },
  // devin (planned, no definition) has no row on purpose: nothing repo-level is documented — it
  // imports the user's ~/.claude configuration — so every present candidate inlines (A-54).
  {
    // Its own guide: the hierarchical standing-instruction files, all read walking up.
    providerId: 'reasonix',
    instructionFiles: ['REASONIX.md', 'AGENTS.md', 'CLAUDE.md'],
  },
  {
    // Its own docs: AGENTS.md (/init) and the CLI's own memory files; the .claude/skills fallback
    // needs an opt-in variable and CLAUDE.md reading is unverified, so both stay out.
    providerId: 'mimo',
    instructionFiles: ['AGENTS.md', 'MEMORY.md', 'checkpoint.md'],
  },
  {
    // Installed CLI source: the default and agent context files plus the local variant; .qwen/rules
    // is a directory. CLAUDE.md is deliberately not auto-loaded (source-verified).
    providerId: 'qwen',
    instructionFiles: ['QWEN.md', 'AGENTS.md', 'QWEN.local.md'],
  },
  {
    // Its own docs: AGENTS.md (renameable via a config key — a renamed file never matches the
    // candidate list, which inlines it: twice beats lost) plus the local variant; .qoder/rules/**
    // is a glob. CLAUDE.md is not read by default.
    providerId: 'qoder',
    instructionFiles: ['AGENTS.md', 'AGENTS.local.md'],
  },
  {
    // Its own docs: AGENTS.md plus the .kiro/steering/ and ~/.kiro/steering/ directories (not
    // names). CLAUDE.md is undocumented, so it stays out.
    providerId: 'kiro',
    instructionFiles: ['AGENTS.md'],
  },
  {
    // Its own docs: AGENTS.md walked cwd→$HOME. AGENT.md and CLAUDE.md load only when no AGENTS.md
    // exists — the documented conditional — so they stay inline candidates.
    providerId: 'amp',
    instructionFiles: ['AGENTS.md'],
  },
  {
    // Its own docs: the project-root file and the repo-local .kimi-code/ companion; the home and
    // shared-global copies live outside the repo. CLAUDE.md is not auto-read (source-checked).
    providerId: 'kimi',
    instructionFiles: ['AGENTS.md', '.kimi-code/AGENTS.md'],
  },
  {
    // Its own docs: CODEBUDDY.md first, otherwise AGENTS.md — the conditional fallback stays out of
    // the row — plus the local variant; .codebuddy/rules/ is a directory. CLAUDE.md is not
    // documented as read.
    providerId: 'codebuddy',
    instructionFiles: ['CODEBUDDY.md', 'CODEBUDDY.local.md'],
  },
];

export function findProvider(id: string): ProviderRecord | undefined {
  return CAPABILITY_REGISTRY.providers.find((provider) => provider.providerId === id);
}

export function findRouteKind(id: string): RouteKindRecord | undefined {
  return CAPABILITY_REGISTRY.routeKinds.find((routeKind) => routeKind.id === id);
}
