// The capability registry: the single data file every support-level, route and model question is
// answered from. A gate carries evidence only where a test of that exact title exists in this
// repository — an absent gate is honesty, not an oversight. Without a recorded operator-gate run
// no provider can read as `full`; without usage visibility (G4) none can read as `isolated`, so
// today only the sdk provider tops out at `isolated` and the rest stay `experimental`. Model data
// (models, effort levels, prices) lands with the model-catalog issues; the route kinds start empty.
import type { CapabilityKind, CapabilityRegistry, ChannelRow, FamilyPattern, ProviderRecord, RouteKindRecord, TranslationRow, VersionRow } from '../../../domain/index';

/** Family recognition as data (P-29 section 4): an unknown live id containing `contains` gets that
 * tier automatically. The Fable family has no entry on purpose — it stays unclassified (selectable,
 * no automatic tier) until the architect decides its tier. */
export const FAMILY_PATTERNS: readonly FamilyPattern[] = [
  { contains: 'opus', tier: 'strong' },
  { contains: 'sonnet', tier: 'balanced' },
  { contains: 'haiku', tier: 'fast' },
];

/** MCP server names still visible outside run-scoped delivery after isolation (probe #1015 C6); names only, never values. Built-ins are listed, not treated as ambient leaks. */
export const AMBIENT_MCP_REMAINING_NAMES: Readonly<Partial<Record<string, readonly string[]>>> = {
  codex: ['codex_apps'],
};

export const CAPABILITY_REGISTRY = {
  providers: [
    {
      // The sdk transport exists for this CLI alone, so the SDK message suites are its evidence.
      // The CLI keeps its machine login in its own config directory, so the isolation proof is the
      // launch that never points the config directory at the run directory.
      providerId: 'claude-code',
      // The SDK permission callback asks on every run (P-66).
      permissionChannel: 'native',
      // The sdk transport delivers a mid-run steering note (P-61).
      steering: 'steerable',
      // P-68: the live matrices ran on this installed pair — the user's own CLI binary driven by
      // the pinned SDK. The two sides drift independently, so both are named.
      measuredWith: { cli: '2.1.302', sdk: '0.3.221', at: '2026-10-16' },
      isolation: { kind: 'test', name: 'P-44: a subscription launch never points the config directory at the run directory, whatever the ambient environment carries' },
      gates: {
        G1: { kind: 'test', name: 'P-4: probes run once each on exactly the resolved path, each under a timeout' },
        G2: { kind: 'test', name: 'I-27: assistant content blocks map in order' },
        G3: { kind: 'test', name: 'I-29: a scripted session yields session_started, tool_call, permission_ask, usage and finished in order once answered' },
        G4: { kind: 'test', name: 'I-27: result maps to usage carrying the context costKind, then finished completed' },
        G5: { kind: 'test', name: 'P-21: get_usage utilization is 0–100 and normalises to the same meter scale a pushed rate_limit_event uses' },
        G6: { kind: 'test', name: 'P-24: sdk, app-server, stream-json and acp each run the identical work order to done with the same common event kinds and exactly one finished per run' },
      },
    },
    {
      // No G4: the app-server transport maps no usage event, so cost visibility is unproven.
      // Login stays under CODEX_HOME (config.mechanism 'none'); ambient config is dropped via argv.
      providerId: 'codex',
      // The app-server approval request becomes a permission_ask that waits (P-13, P-66).
      permissionChannel: 'native',
      // The app-server transport delivers a mid-run steering note (P-61).
      steering: 'steerable',
      isolation: {
        kind: 'test',
        name: 'P-44: every codex run argv carries --ignore-user-config exactly once',
      },
      gates: {
        G1: { kind: 'test', name: 'P-4: probes run once each on exactly the resolved path, each under a timeout' },
        G2: { kind: 'test', name: 'P-12: the run opens with initialize → thread/start → turn/start and maps the turn stream to AgentEvents' },
        G3: { kind: 'test', name: 'P-13: an approval request becomes a permission_ask; the user’s allow is delivered as the JSON-RPC response and nothing is ever auto-approved' },
        G5: { kind: 'test', name: 'P-20: reads rate limits through the app-server connection and maps primary/secondary windows to meters with exact resets, source polled' },
        G6: { kind: 'test', name: 'P-24: sdk, app-server, stream-json and acp each run the identical work order to done with the same common event kinds and exactly one finished per run' },
      },
    },
    {
      // No isolation evidence on purpose (P-44): the CLI documents no config-dir override and no
      // login location, so HOME is left alone (a run-scoped home could cut the CLI off from its
      // login) and the CLI reads its own configuration; the cap holds — with every gate now
      // carrying test evidence, isolation is the one thing still between agy and `full`.
      providerId: 'agy',
      // The stream-json transport has no ask callback; a run asks only through the Docket bridge
      // (P-63), so a role without the Docket tools leaves the run channel-less (P-66).
      permissionChannel: 'bridge',
      bridgeHow: 'headless agy cannot ask: command, MCP and write calls are denied without a prompt',
      // The stream-json transport does not carry a steering note (P-61).
      steering: 'not_steerable',
      // P-68: every agy fact in this registry was measured on 1.3.6 — the live run
      // 01M50YHMVARZ1G2FGHNPMG6WD2 and the probe/spike rows below. The CLI may self-update, so the
      // installed version is compared against this field (versionDrift).
      measuredWith: { cli: '1.3.6', at: '2026-10-16' },
      gates: {
        G1: { kind: 'test', name: 'P-4: probes run once each on exactly the resolved path, each under a timeout' },
        G2: { kind: 'test', name: 'P-11: the text turn fixture maps to session_started, one text, usage and a completed finished' },
        G3: { kind: 'test', name: 'P-63: a PreToolUse ask becomes a permission_ask, waits for the answer, nothing is auto-approved' },
        G4: { kind: 'test', name: 'P-11: the usage event carries the route\'s cost kind' },
        G5: { kind: 'test', name: 'P-19: runs `agy -p /usage --output-format json` and parses the payload from stderr' },
        G6: { kind: 'test', name: 'P-24: sdk, app-server, stream-json and acp each run the identical work order to done with the same common event kinds and exactly one finished per run' },
      },
      // The live agy walk (2026-10-16, agy 1.3.6, run 01M50YHMVARZ1G2FGHNPMG6WD2) is recorded here
      // per P-28 — an operator run only. With G6 now carrying the scripted stream-json leg, the
      // P-44 cap above (no isolation evidence) is the one thing that still keeps agy
      // experimental regardless of operatorRuns.
      operatorRuns: ['01M50YHMVARZ1G2FGHNPMG6WD2'],
    },
    {
      // No isolation evidence on purpose (P-44): the CLI's documented home override
      // (COPILOT_HOME) is also where its stored login lives, so neither HOME nor that variable is
      // ever redirected or named and the CLI reads its own configuration; the cap holds.
      providerId: 'copilot',
      // session/request_permission becomes a permission_ask that waits (P-16, P-66).
      permissionChannel: 'native',
      // The acp transport does not carry a steering note (P-61).
      steering: 'not_steerable',
      gates: {
        G1: { kind: 'test', name: 'P-4: probes run once each on exactly the resolved path, each under a timeout' },
        G2: { kind: 'test', name: 'P-15: initialize → session/new (carrying the run-scoped config) → session/prompt; session/update maps to AgentEvents and an unknown update kind becomes a raw event, never an error' },
        G3: { kind: 'test', name: 'P-16: session/request_permission becomes a permission_ask that waits for the user; the answer round-trips and nothing is ever auto-approved' },
        G6: { kind: 'test', name: 'P-24: sdk, app-server, stream-json and acp each run the identical work order to done with the same common event kinds and exactly one finished per run' },
      },
    },
    {
      // No isolation evidence on purpose (P-44): the CLI documents no config-dir or home override
      // and says only that the stored authentication is kept locally, so HOME is left alone (a
      // run-scoped home could cut the CLI off from its login) and the CLI reads its own
      // configuration; the cap holds.
      providerId: 'cursor',
      // session/request_permission becomes a permission_ask that waits (P-16, P-66).
      permissionChannel: 'native',
      // The acp transport does not carry a steering note (P-61).
      steering: 'not_steerable',
      gates: {
        G1: { kind: 'test', name: 'P-4: probes run once each on exactly the resolved path, each under a timeout' },
        G2: { kind: 'test', name: 'P-15: initialize → session/new (carrying the run-scoped config) → session/prompt; session/update maps to AgentEvents and an unknown update kind becomes a raw event, never an error' },
        G3: { kind: 'test', name: 'P-16: session/request_permission becomes a permission_ask that waits for the user; the answer round-trips and nothing is ever auto-approved' },
        G6: { kind: 'test', name: 'P-24: sdk, app-server, stream-json and acp each run the identical work order to done with the same common event kinds and exactly one finished per run' },
      },
    },
    {
      providerId: 'opencode',
      // session/request_permission becomes a permission_ask that waits (P-16, P-66).
      permissionChannel: 'native',
      // The acp transport does not carry a steering note (P-61).
      steering: 'not_steerable',
      isolation: { kind: 'test', name: 'P-8: the opencode launch environment is exactly the config dir plus the documented Claude-compatibility switch' },
      gates: {
        G1: { kind: 'test', name: 'P-4: probes run once each on exactly the resolved path, each under a timeout' },
        G2: { kind: 'test', name: 'P-15: initialize → session/new (carrying the run-scoped config) → session/prompt; session/update maps to AgentEvents and an unknown update kind becomes a raw event, never an error' },
        G3: { kind: 'test', name: 'P-16: session/request_permission becomes a permission_ask that waits for the user; the answer round-trips and nothing is ever auto-approved' },
        G6: { kind: 'test', name: 'P-24: sdk, app-server, stream-json and acp each run the identical work order to done with the same common event kinds and exactly one finished per run' },
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
      // The provider documents that coding-plan calls only draw on the plan's quota and never on the
      // account balance; a model outside the glm family stays unknown.
      defaultBilling: 'included',
      familyBilling: [{ contains: 'glm', billing: 'included' }],
      models: [],
      // The ids ride the CLI's context-size spelling: the `[1m]` tag leaves the wire id as glm-5.3
      // and turns into the CLI's 1M-context beta header, and the endpoint serves its coding-plan
      // models on that route only — the bare spelling the endpoint rejects comes back as the CLI's
      // model-not-found message, so the tag must survive into every run.
      tierModels: { strong: 'glm-5.3[1m]', balanced: 'glm-5.3-flash[1m]', fast: 'glm-5.3-flash[1m]' },
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
      // The bundled rows are the measured `agy models` answer (agy 1.3.6): every listed id
      // carries its effort in the suffix — one level per record, never a set — because the
      // `--effort` flag exists only on suffix-less ids the listing does not offer. Tiers follow
      // the families (argon the flagship, flash the cheap one, the third-party rows their own
      // family tiers), and billing stays unset on every row for the plan reason above. The tier
      // map stays inside the everywhere-covered Gemini families so a tier pick never names a
      // third-party row a lower plan cannot use; balanced is the flash family's top, the mid
      // point between flash low and argon high.
      models: [
        { id: 'gemini-4-argon-low', family: 'argon', tier: 'strong', thinking: { kind: 'levels', levels: ['low'] } },
        { id: 'gemini-4-argon-medium', family: 'argon', tier: 'strong', thinking: { kind: 'levels', levels: ['medium'] } },
        { id: 'gemini-4-argon-high', family: 'argon', tier: 'strong', thinking: { kind: 'levels', levels: ['high'] } },
        { id: 'gemini-3.8-flash-low', family: 'flash', tier: 'fast', thinking: { kind: 'levels', levels: ['low'] } },
        { id: 'gemini-3.8-flash-medium', family: 'flash', tier: 'fast', thinking: { kind: 'levels', levels: ['medium'] } },
        { id: 'gemini-3.8-flash-high', family: 'flash', tier: 'fast', thinking: { kind: 'levels', levels: ['high'] } },
        { id: 'claude-opus-5-5-low', family: 'opus', tier: 'strong', thinking: { kind: 'levels', levels: ['low'] } },
        { id: 'claude-opus-5-5-medium', family: 'opus', tier: 'strong', thinking: { kind: 'levels', levels: ['medium'] } },
        { id: 'claude-opus-5-5-high', family: 'opus', tier: 'strong', thinking: { kind: 'levels', levels: ['high'] } },
        { id: 'claude-sonnet-5-5-low', family: 'sonnet', tier: 'balanced', thinking: { kind: 'levels', levels: ['low'] } },
        { id: 'claude-sonnet-5-5-medium', family: 'sonnet', tier: 'balanced', thinking: { kind: 'levels', levels: ['medium'] } },
        { id: 'claude-sonnet-5-5-high', family: 'sonnet', tier: 'balanced', thinking: { kind: 'levels', levels: ['high'] } },
        { id: 'gpt-oss-120b-medium', family: 'gpt-oss', tier: 'balanced', thinking: { kind: 'levels', levels: ['medium'] } },
      ],
      tierModels: { strong: 'gemini-4-argon-high', balanced: 'gemini-3.8-flash-high', fast: 'gemini-3.8-flash-low' },
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
  ],
} as const satisfies CapabilityRegistry;

/** P-66: the permission-channel table `setupWarnings`' second source reads — one row per provider
 *  record, the bridge rows carrying their warning sentence. */
export const PERMISSION_CHANNELS: readonly ChannelRow[] = CAPABILITY_REGISTRY.providers.map(
  (provider: ProviderRecord) => ({
    provider: provider.providerId,
    channel: provider.permissionChannel,
    ...(provider.bridgeHow === undefined ? {} : { how: provider.bridgeHow }),
  }),
);

/** P-68: the measured side of the version table `setupWarnings`' third source reads — the CLI
 *  version each provider record's evidence was measured on, providers without a measurement
 *  absent. The installed side joins where discovery answers are known; absent reads `unknown`
 *  and never warns. */
export const MEASURED_VERSIONS: readonly VersionRow[] = CAPABILITY_REGISTRY.providers.flatMap((provider: ProviderRecord) =>
  provider.measuredWith?.cli === undefined ? [] : [{ provider: provider.providerId, measured: provider.measuredWith.cli }],
);

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
    // Docket runs with settingSources []: repo CLAUDE.md and CLAUDE.local.md are not loaded by the
    // CLI — P-37 inlines them (systemPrompt.append on the context row). The automatic project
    // memory (~/.claude/projects/<project>/memory/) once rode this row because it loaded even
    // with every setting source off; A-402 turns it off on every SDK run (autoMemoryEnabled
    // false inline plus CLAUDE_CODE_DISABLE_AUTO_MEMORY=1 in the route environment), so nothing
    // native loads it any more — Docket's own memory is the only memory a run sees, and the row
    // lists no native instruction set.
    providerId: 'claude-code',
    instructionFiles: [],
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
];

const UNVERIFIED_HOW = 'Unverified without live probe (#1015)';
const NATIVE_INSTRUCTIONS_HOW = 'Native instruction files (P-37)';
const COMMAND_ROW = { kind: 'command', support: 'degraded', how: 'Template delivered as instruction text; the agent fills the placeholders', degradesTo: 'prompt_text' } as const;
const PROBE_EVIDENCE_SUFFIX = 'probe #1015, 2026-10-14';
const probeHow = (sentence: string): string => `${sentence} ${PROBE_EVIDENCE_SUFFIX}`;

/** The six kinds in a provider's rows, in table order. */
const rowsOf = (provider: string, byKind: Readonly<Record<CapabilityKind, Omit<TranslationRow, 'provider' | 'kind'>>>): readonly TranslationRow[] =>
  (['mcp', 'skill', 'hook', 'context', 'plugin', 'command'] as const).map((kind) => ({ provider, kind, ...byKind[kind] }));

const unverified = { support: 'unverified', how: UNVERIFIED_HOW } as const;
const command = { support: COMMAND_ROW.support, how: COMMAND_ROW.how, degradesTo: COMMAND_ROW.degradesTo } as const;
/** A provider with no live evidence yet: everything unverified except the instruction files its
 *  own docs name (P-37) and the Docket-rendered command. */
const unprobed = (provider: string): readonly TranslationRow[] =>
  rowsOf(provider, {
    mcp: unverified,
    skill: unverified,
    hook: unverified,
    context: { support: 'native', how: NATIVE_INSTRUCTIONS_HOW },
    plugin: unverified,
    command,
  });

/** P-58: the initial translation and support table (docs/v2/provider-capabilities.md §15). Honest, no
 *  claim without evidence: every `native` row names its mechanism in `how`, and the live probe
 *  (#1015) later turns `unverified` into the observed value. */
export const TRANSLATION_TABLE: readonly TranslationRow[] = [
  ...rowsOf('claude-code', {
    mcp: {
      support: 'native',
      how: probeHow('Run-scoped MCP via inline mcpServers with strictMcpConfig on every run (settingSources: [])'),
    },
    skill: {
      support: 'native',
      how: probeHow('Per-run local plugin dir with skills/*/SKILL.md and skills: all'),
    },
    hook: {
      support: 'native',
      how: probeHow('Inline settings.hooks on the SDK settings option'),
    },
    context: {
      support: 'native',
      how: probeHow('systemPrompt.append once for role + context (no CLAUDE.md write)'),
    },
    plugin: {
      support: 'native',
      how: probeHow('plugins[{type:local,path,skipMcpDiscovery}]'),
      // R-149: a run never installs or edits the user's plugin state (P-44), so only a local path
      // bundle is deliverable — a marketplace plugin reads unsupported for this provider.
      sourceKinds: ['path'],
    },
    command,
  }),
  ...rowsOf('codex', {
    mcp: {
      support: 'native',
      how: 'App-server --ignore-user-config on every run, then -c mcp_servers.* overrides when MCP is delivered',
    },
    skill: {
      support: 'native',
      how: probeHow('Run-scoped skills under .agents/skills in the run directory'),
    },
    hook: {
      support: 'unsupported',
      how: probeHow(
        'Hooks were not evidenced after trying a .codex/hooks.json file and a -c hooks override',
      ),
    },
    context: { support: 'native', how: 'Native instruction files (AGENTS.md / fallback, P-37)' },
    plugin: {
      support: 'native',
      how: probeHow('Run-scoped plugin bundle under .codex/plugins with plugin.json'),
      // R-149: same rule as claude-code — only a local path bundle is deliverable (P-44).
      sourceKinds: ['path'],
    },
    command,
  }),
  ...rowsOf('agy', {
    mcp: {
      support: 'native',
      how: '.agents/mcp_config.json (stdio command/args/env) via --add-dir on the run config dir; URL (SSE) servers are not delivered (serverUrl key, a wrong key fails silently); call_mcp_tool asks over the permission bridge as mcp__<Server>__<Tool>, answered allow through the permission board (P-63) probe #1015 agy spike + live run, 2026-10-16',
    },
    skill: {
      support: 'native',
      how: '.agents/skills/<name>/SKILL.md via --add-dir (directory skill copied, single-file skill written as SKILL.md); the agent read the delivered SKILL.md probe #1015 agy spike + live run, 2026-10-16',
    },
    hook: {
      support: 'native',
      how: '.agents/hooks.json via --add-dir inside the single docket hook group (event names at the top level are silently ignored); after_tool maps to PostToolUse, after_write to PostToolUse with a write-tool matcher, run_end to Stop as a direct list (run_end not yet observed live); one invalid entry silently disables the whole file; before_tool rides the single PreToolUse wrapper entry whose exit 2 denies before any ask (P-64) probe #1015 agy spike + live run, 2026-10-16',
    },
    context: {
      support: 'native',
      how: '.agents/rules/<id>.md with trigger always_on frontmatter via --add-dir; repo instruction files stay native (P-37) and their text reached the agent with no read call probe #1015 agy spike + live run, 2026-10-16',
    },
    plugin: {
      support: 'native',
      how: ".agents/plugins/<name>/ with plugin.json via --add-dir (loads hooks and MCP; a plugin's own skill was not evidenced) probe #1015 agy spike, 2026-10-16",
      // R-149: same rule as claude-code and codex — only a local path bundle is deliverable (P-44).
      sourceKinds: ['path'],
    },
    command,
  }),
  ...unprobed('copilot'),
  ...rowsOf('cursor', {
    mcp: {
      support: 'native',
      how: probeHow(
        'Run-scoped MCP server on the ACP session/new.mcpServers field (def-verified launch; tool listing is nondeterministic)',
      ),
    },
    skill: {
      support: 'degraded',
      how: probeHow('Project rule at .cursor/rules carrying the skill instruction; not a documented skill kind'),
      degradesTo: 'context',
    },
    hook: {
      support: 'unsupported',
      how: probeHow(
        'Run-scoped .cursor/hooks.json with a UserPromptSubmit command hook was not evidenced (help names no hook format)',
      ),
    },
    context: {
      support: 'native',
      how: probeHow('Native instruction file AGENTS.md in the run cwd (P-37)'),
    },
    plugin: {
      support: 'unsupported',
      how: probeHow('Documented --plugin-dir flag pointing at a fixture plugin bundle was not evidenced'),
    },
    command,
  }),
  ...rowsOf('opencode', {
    mcp: {
      support: 'unsupported',
      how: probeHow(
        'Run-scoped config tree via OPENCODE_CONFIG_DIR with opencode.json mcp block was not evidenced',
      ),
    },
    skill: {
      support: 'native',
      how: probeHow('Skill directory under the same OPENCODE_CONFIG_DIR tree (skills/, P-60 addendum)'),
    },
    hook: {
      support: 'unverified',
      how: probeHow(
        'No hook kind documented in opencode --help, the repo docs (P-60 addendum names none) or the def; the CLI event surface is the plugin API, probed as C4',
      ),
    },
    context: {
      support: 'native',
      how: probeHow('Native instruction file AGENTS.md in the run cwd with OPENCODE_DISABLE_CLAUDE_CODE=1 (P-37)'),
    },
    plugin: {
      support: 'unsupported',
      how: probeHow(
        'JS plugin in the config tree plugin directory whose module load appends the marker line was not evidenced',
      ),
    },
    command,
  }),
];

export function findProvider(id: string): ProviderRecord | undefined {
  return CAPABILITY_REGISTRY.providers.find((provider) => provider.providerId === id);
}

export function findRouteKind(id: string): RouteKindRecord | undefined {
  return CAPABILITY_REGISTRY.routeKinds.find((routeKind) => routeKind.id === id);
}
