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
      providerId: 'claude-code',
      isolation: { kind: 'test', name: 'P-7: the config dir reaches the CLI through the provider config mechanism' },
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
      // no stream-json leg.
      providerId: 'agy',
      isolation: { kind: 'test', name: 'P-7: the config dir reaches the CLI through the provider config mechanism' },
      gates: {
        G1: { kind: 'test', name: 'P-4: probes run once each on exactly the resolved path, each under a timeout' },
        G2: { kind: 'test', name: 'P-11: the text turn fixture maps to session_started, one text, usage and a completed finished' },
        G4: { kind: 'test', name: 'P-11: an ERROR result ends usage + finished failed, so malformed-input runs still fold into one finished' },
        G5: { kind: 'test', name: 'P-19: runs `agy -p /usage --output-format json` and parses the payload from stderr' },
      },
    },
    {
      providerId: 'copilot',
      isolation: { kind: 'test', name: 'P-7: the config dir reaches the CLI through the provider config mechanism' },
      gates: {
        G1: { kind: 'test', name: 'P-4: probes run once each on exactly the resolved path, each under a timeout' },
        G2: { kind: 'test', name: 'P-15: initialize → session/new (carrying the run-scoped config) → session/prompt; session/update maps to AgentEvents and an unknown update kind becomes a raw event, never an error' },
        G3: { kind: 'test', name: 'P-16: session/request_permission becomes a permission_ask that waits for the user; the answer round-trips and nothing is ever auto-approved' },
        G6: { kind: 'test', name: 'P-24: sdk, app-server and acp each run the identical work order to done with the same common event kinds and exactly one finished per run' },
      },
    },
    {
      providerId: 'cursor',
      isolation: { kind: 'test', name: 'P-7: the config dir reaches the CLI through the provider config mechanism' },
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
      // `~/.cursor` files by default and no documented switch turns that off, so the level stays
      // capped at experimental. G3 is absent: `session/request_permission` is unproven until an
      // operator run. G4 is absent: no usage mapping is proven for this CLI.
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
  ],
} as const satisfies CapabilityRegistry;

export function findProvider(id: string): ProviderRecord | undefined {
  return CAPABILITY_REGISTRY.providers.find((provider) => provider.providerId === id);
}

export function findRouteKind(id: string): RouteKindRecord | undefined {
  return CAPABILITY_REGISTRY.routeKinds.find((routeKind) => routeKind.id === id);
}
