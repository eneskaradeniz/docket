// The built-in provider set: pure data plus one pure buildLaunch per CLI, written from each
// CLI's own public documentation. Flag-level accuracy is operator-verified data — a wrong flag
// here is a data fix, never a contract change. Each mark is its provider's own, copied
// unmodified from the file its `d` came from (the provider's official file, or the
// operator-placed stand-in when none exists); it identifies the provider only and is never
// redrawn — `mark: null` stays the state of a def with no file.
import { effortFlagArgs, type EffortArg, type LevelNames, type ProviderDef } from './provider-def';

// Each effort parameter below is taken from the provider's own help output, SDK typings or
// protocol schema; a provider whose parameter is not verified carries none.
const AGY_EFFORT: EffortArg = { kind: 'flag', flag: '--effort' };
const CODEBUDDY_EFFORT: EffortArg = { kind: 'flag', flag: '--effort' };
const COPILOT_EFFORT: EffortArg = { kind: 'flag', flag: '--reasoning-effort' };
const GROK_EFFORT: EffortArg = { kind: 'flag', flag: '--reasoning-effort' };
const KIRO_EFFORT: EffortArg = { kind: 'flag', flag: '--effort' };
// The flag exists, but no model's level set is verified, so no level is named: none is offered
// and none is sent until an operator run records them (P-43's empty-map rule).
const KIRO_LEVEL_NAMES: LevelNames = {};
// The CLI's own --help lists minimal, low, medium, high, xhigh and max — six of the level names
// Docket knows. Naming exactly those six keeps `none` and `ultra`, which the CLI does not list,
// from ever being offered or sent (P-43's unmapped-name rule).
const CODEBUDDY_LEVEL_NAMES: LevelNames = {
  minimal: 'minimal',
  low: 'low',
  medium: 'medium',
  high: 'high',
  xhigh: 'xhigh',
  max: 'max',
};

export const BUILTIN_PROVIDER_DEFS: readonly ProviderDef[] = [
  {
    id: 'claude-code',
    displayName: 'Claude Code',
    bins: ['claude'],
    versionArgs: ['--version'],
    helpArgs: ['--help'],
    // `auth status` prints JSON whose `loggedIn` boolean is the answer on either exit code;
    // only that boolean is read, never another field of the object.
    authProbe: { args: ['auth', 'status'], parse: 'logged-in-json' },
    transport: 'sdk',
    effortArg: { kind: 'request-field', name: 'effort' },
    // The CLI keeps its login in its own config directory (a keychain entry keyed to the
    // directory's path on macOS), so the variable stays unset: pointing it at a run directory
    // would leave the run logged out. The run's MCP servers and settings reach the SDK inline
    // (`settingSources: []`, inline `mcpServers`), never a run config dir.
    config: { mechanism: 'none' },
    buildLaunch: () => ({ args: [], env: {}, stdin: 'prompt' }),
    resume: 'specify',
    capabilities: {
      structuredStream: true,
      permissionAsk: true,
      resume: true,
      mcp: true,
      hooks: true,
      skills: true,
      images: true,
      quotaReport: 'stream',
      costReport: 'reported',
    },
    installHint: { url: 'https://docs.anthropic.com/en/docs/claude-code' },
    mark: { viewBox: '0 0 24 24', path: 'm4.7144 15.9555 4.7174-2.6471.079-.2307-.079-.1275h-.2307l-.7893-.0486-2.6956-.0729-2.3375-.0971-2.2646-.1214-.5707-.1215-.5343-.7042.0546-.3522.4797-.3218.686.0608 1.5179.1032 2.2767.1578 1.6514.0972 2.4468.255h.3886l.0546-.1579-.1336-.0971-.1032-.0972L6.973 9.8356l-2.55-1.6879-1.3356-.9714-.7225-.4918-.3643-.4614-.1578-1.0078.6557-.7225.8803.0607.2246.0607.8925.686 1.9064 1.4754 2.4893 1.8336.3643.3035.1457-.1032.0182-.0728-.164-.2733-1.3539-2.4467-1.445-2.4893-.6435-1.032-.17-.6194c-.0607-.255-.1032-.4674-.1032-.7285L6.287.1335 6.6997 0l.9957.1336.419.3642.6192 1.4147 1.0018 2.2282 1.5543 3.0296.4553.8985.2429.8318.091.255h.1579v-.1457l.1275-1.706.2368-2.0947.2307-2.6957.0789-.7589.3764-.9107.7468-.4918.5828.2793.4797.686-.0668.4433-.2853 1.8517-.5586 2.9021-.3643 1.9429h.2125l.2429-.2429.9835-1.3053 1.6514-2.0643.7286-.8196.85-.9046.5464-.4311h1.0321l.759 1.1293-.34 1.1657-1.0625 1.3478-.8804 1.1414-1.2628 1.7-.7893 1.36.0729.1093.1882-.0183 2.8535-.607 1.5421-.2794 1.8396-.3157.8318.3886.091.3946-.3278.8075-1.967.4857-2.3072.4614-3.4364.8136-.0425.0304.0486.0607 1.5482.1457.6618.0364h1.621l3.0175.2247.7892.522.4736.6376-.079.4857-1.2142.6193-1.6393-.3886-3.825-.9107-1.3113-.3279h-.1822v.1093l1.0929 1.0686 2.0035 1.8092 2.5075 2.3314.1275.5768-.3218.4554-.34-.0486-2.2039-1.6575-.85-.7468-1.9246-1.621h-.1275v.17l.4432.6496 2.3436 3.5214.1214 1.0807-.17.3521-.6071.2125-.6679-.1214-1.3721-1.9246L14.38 17.959l-1.1414-1.9428-.1397.079-.674 7.2552-.3156.3703-.7286.2793-.6071-.4614-.3218-.7468.3218-1.4753.3886-1.9246.3157-1.53.2853-1.9004.17-.6314-.0121-.0425-.1397.0182-1.4328 1.9672-2.1796 2.9446-1.7243 1.8456-.4128.164-.7164-.3704.0667-.6618.4008-.5889 2.386-3.0357 1.4389-1.882.929-1.0868-.0062-.1579h-.0546l-6.3385 4.1164-1.1293.1457-.4857-.4554.0608-.7467.2307-.2429 1.9064-1.3114Z', fillRule: 'nonzero' },
  },
  {
    id: 'codex',
    displayName: 'Codex',
    bins: ['codex'],
    versionArgs: ['--version'],
    helpArgs: ['--help'],
    authProbe: { args: ['login', 'status'] },
    transport: 'app-server',
    effortArg: { kind: 'request-field', name: 'effort' },
    // The CLI keeps its login (auth.json by default) under its home, so no home variable is set;
    // the run's MCP servers reach it through its `-c key=value` override instead.
    config: { mechanism: 'none' },
    buildLaunch: () => ({ args: ['app-server'], env: {}, stdin: 'prompt' }),
    resume: 'protocol',
    capabilities: {
      structuredStream: true,
      permissionAsk: true,
      resume: true,
      mcp: true,
      hooks: 'unknown',
      skills: 'unknown',
      images: true,
      quotaReport: 'query',
      costReport: 'none',
    },
    installHint: { url: 'https://developers.openai.com/codex/cli' },
    mark: { viewBox: '0 0 24 24', path: 'M8.086.457a6.105 6.105 0 013.046-.415c1.333.153 2.521.72 3.564 1.7a.117.117 0 00.107.029c1.408-.346 2.762-.224 4.061.366l.063.03.154.076c1.357.703 2.33 1.77 2.918 3.198.278.679.418 1.388.421 2.126a5.655 5.655 0 01-.18 1.631.167.167 0 00.04.155 5.982 5.982 0 011.578 2.891c.385 1.901-.01 3.615-1.183 5.14l-.182.22a6.063 6.063 0 01-2.934 1.851.162.162 0 00-.108.102c-.255.736-.511 1.364-.987 1.992-1.199 1.582-2.962 2.462-4.948 2.451-1.583-.008-2.986-.587-4.21-1.736a.145.145 0 00-.14-.032c-.518.167-1.04.191-1.604.185a5.924 5.924 0 01-2.595-.622 6.058 6.058 0 01-2.146-1.781c-.203-.269-.404-.522-.551-.821a7.74 7.74 0 01-.495-1.283 6.11 6.11 0 01-.017-3.064.166.166 0 00.008-.074.115.115 0 00-.037-.064 5.958 5.958 0 01-1.38-2.202 5.196 5.196 0 01-.333-1.589 6.915 6.915 0 01.188-2.132c.45-1.484 1.309-2.648 2.577-3.493.282-.188.55-.334.802-.438.286-.12.573-.22.861-.304a.129.129 0 00.087-.087A6.016 6.016 0 015.635 2.31C6.315 1.464 7.132.846 8.086.457zm-.804 7.85a.848.848 0 00-1.473.842l1.694 2.965-1.688 2.848a.849.849 0 001.46.864l1.94-3.272a.849.849 0 00.007-.854l-1.94-3.393zm5.446 6.24a.849.849 0 000 1.695h4.848a.849.849 0 000-1.696h-4.848z', fillRule: 'evenodd' },
  },
  {
    id: 'agy',
    displayName: 'Antigravity',
    bins: ['agy'],
    versionArgs: ['--version'],
    helpArgs: ['--help'],
    transport: 'stream-json',
    streamDialect: 'agy',
    effortArg: AGY_EFFORT,
    // The CLI documents no config-dir override and no login location, so HOME is never
    // redirected: a run-scoped home could cut the CLI off from wherever it keeps its login, and
    // the machine's home reaches the child as the CLI itself resolves it. No isolation is claimed.
    config: { mechanism: 'none' },
    buildLaunch: (input) => ({
      args: [
        '--input-format',
        'stream-json',
        '--output-format',
        'stream-json',
        ...(input.resume === undefined ? [] : ['--conversation', input.resume.sessionRef]),
        ...effortFlagArgs(AGY_EFFORT, input.effort),
      ],
      env: {},
      stdin: 'prompt',
    }),
    resume: 'specify',
    capabilities: {
      structuredStream: true,
      permissionAsk: false,
      resume: true,
      mcp: 'unknown',
      hooks: 'unknown',
      skills: 'unknown',
      images: 'unknown',
      quotaReport: 'query',
      costReport: 'none',
    },
    installHint: { url: 'https://antigravity.google/docs/cli' },
    mark: { viewBox: '0 0 24 24', path: 'M21.751 22.607c1.34 1.005 3.35.335 1.508-1.508C17.73 15.74 18.904 1 12.037 1 5.17 1 6.342 15.74.815 21.1c-2.01 2.009.167 2.511 1.507 1.506 5.192-3.517 4.857-9.714 9.715-9.714 4.857 0 4.522 6.197 9.714 9.715z', fillRule: 'evenodd' },
  },
  {
    id: 'copilot',
    displayName: 'Copilot CLI',
    bins: ['copilot'],
    versionArgs: ['--version'],
    helpArgs: ['--help'],
    transport: 'acp',
    // The CLI documents COPILOT_HOME as the override of the directory holding its configuration
    // and state files — the stored login among them — so neither HOME nor COPILOT_HOME is ever
    // redirected or named: an ambient value is the machine's own relocation and passes through.
    // The run's MCP servers ride the ACP session itself (session/new), never a config dir.
    config: { mechanism: 'none' },
    effortArg: COPILOT_EFFORT,
    buildLaunch: (input) => ({
      args: ['--acp', '--stdio', ...effortFlagArgs(COPILOT_EFFORT, input.effort)],
      env: {},
      stdin: 'prompt',
    }),
    resume: 'protocol',
    capabilities: {
      structuredStream: true,
      // probe #139: asks and blocks out-of-cwd; in-cwd edits auto-allowed (copilot asks for those too).
      permissionAsk: true,
      resume: true,
      mcp: true,
      hooks: 'unknown',
      skills: 'unknown',
      images: true,
      quotaReport: 'none',
      costReport: 'none',
    },
    installHint: { url: 'https://docs.github.com/en/copilot/reference/copilot-cli-reference' },
    mark: { viewBox: '0 0 24 24', path: 'M23.922 16.997C23.061 18.492 18.063 22.02 12 22.02 5.937 22.02.939 18.492.078 16.997A.641.641 0 0 1 0 16.741v-2.869a.883.883 0 0 1 .053-.22c.372-.935 1.347-2.292 2.605-2.656.167-.429.414-1.055.644-1.517a10.098 10.098 0 0 1-.052-1.086c0-1.331.282-2.499 1.132-3.368.397-.406.89-.717 1.474-.952C7.255 2.937 9.248 1.98 11.978 1.98c2.731 0 4.767.957 6.166 2.093.584.235 1.077.546 1.474.952.85.869 1.132 2.037 1.132 3.368 0 .368-.014.733-.052 1.086.23.462.477 1.088.644 1.517 1.258.364 2.233 1.721 2.605 2.656a.841.841 0 0 1 .053.22v2.869a.641.641 0 0 1-.078.256Zm-11.75-5.992h-.344a4.359 4.359 0 0 1-.355.508c-.77.947-1.918 1.492-3.508 1.492-1.725 0-2.989-.359-3.782-1.259a2.137 2.137 0 0 1-.085-.104L4 11.746v6.585c1.435.779 4.514 2.179 8 2.179 3.486 0 6.565-1.4 8-2.179v-6.585l-.098-.104s-.033.045-.085.104c-.793.9-2.057 1.259-3.782 1.259-1.59 0-2.738-.545-3.508-1.492a4.359 4.359 0 0 1-.355-.508Zm2.328 3.25c.549 0 1 .451 1 1v2c0 .549-.451 1-1 1-.549 0-1-.451-1-1v-2c0-.549.451-1 1-1Zm-5 0c.549 0 1 .451 1 1v2c0 .549-.451 1-1 1-.549 0-1-.451-1-1v-2c0-.549.451-1 1-1Zm3.313-6.185c.136 1.057.403 1.913.878 2.497.442.544 1.134.938 2.344.938 1.573 0 2.292-.337 2.657-.751.384-.435.558-1.15.558-2.361 0-1.14-.243-1.847-.705-2.319-.477-.488-1.319-.862-2.824-1.025-1.487-.161-2.192.138-2.533.529-.269.307-.437.808-.438 1.578v.021c0 .265.021.562.063.893Zm-1.626 0c.042-.331.063-.628.063-.894v-.02c-.001-.77-.169-1.271-.438-1.578-.341-.391-1.046-.69-2.533-.529-1.505.163-2.347.537-2.824 1.025-.462.472-.705 1.179-.705 2.319 0 1.211.175 1.926.558 2.361.365.414 1.084.751 2.657.751 1.21 0 1.902-.394 2.344-.938.475-.584.742-1.44.878-2.497Z', fillRule: 'nonzero' },
  },
  {
    id: 'cursor',
    displayName: 'Cursor Agent',
    bins: ['cursor-agent'],
    versionArgs: ['--version'],
    helpArgs: ['--help'],
    transport: 'acp',
    // The CLI documents no config-dir or home override (its help names only the API variables)
    // and says only that the stored authentication is kept locally, so HOME is never redirected:
    // the machine's home reaches the child as the CLI itself resolves it. The run's MCP servers
    // ride the ACP session itself (session/new), never a config dir.
    config: { mechanism: 'none' },
    buildLaunch: () => ({ args: ['acp'], env: {}, stdin: 'prompt' }),
    resume: 'protocol',
    capabilities: {
      structuredStream: true,
      // probe #139: asks and blocks out-of-cwd; in-cwd edits auto-allowed (copilot asks for those too).
      permissionAsk: true,
      resume: true,
      mcp: true,
      hooks: 'unknown',
      skills: 'unknown',
      images: true,
      quotaReport: 'none',
      costReport: 'none',
    },
    installHint: { url: 'https://cursor.com/docs/cli' },
    mark: { viewBox: '0 0 24 24', path: 'M11.503.131 1.891 5.678a.84.84 0 0 0-.42.726v11.188c0 .3.162.575.42.724l9.609 5.55a1 1 0 0 0 .998 0l9.61-5.55a.84.84 0 0 0 .42-.724V6.404a.84.84 0 0 0-.42-.726L12.497.131a1.01 1.01 0 0 0-.996 0M2.657 6.338h18.55c.263 0 .43.287.297.515L12.23 22.918c-.062.107-.229.064-.229-.06V12.335a.59.59 0 0 0-.295-.51l-9.11-5.257c-.109-.063-.064-.23.061-.23', fillRule: 'nonzero' },
  },
  {
    id: 'opencode',
    displayName: 'opencode',
    bins: ['opencode'],
    versionArgs: ['--version'],
    helpArgs: ['--help'],
    transport: 'acp',
    effortArg: { kind: 'session-option', category: 'thought_level' },
    config: { mechanism: 'env-var', name: 'OPENCODE_CONFIG_DIR' },
    // Without its documented switch the CLI also reads the user's own ~/.claude files
    // (CLAUDE.md, skills), so a run would carry the operator's personal instructions; the
    // literal pins the run to the run-scoped config tree only.
    buildLaunch: (input) => ({
      args: ['acp'],
      env: { OPENCODE_CONFIG_DIR: input.configDir, OPENCODE_DISABLE_CLAUDE_CODE: '1' },
      stdin: 'prompt',
    }),
    resume: 'protocol',
    capabilities: {
      structuredStream: true,
      // probe #139: asks and blocks out-of-cwd; in-cwd edits auto-allowed (copilot asks for those too).
      permissionAsk: true,
      resume: true,
      mcp: true,
      hooks: 'unknown',
      skills: 'unknown',
      images: true,
      quotaReport: 'none',
      costReport: 'none',
    },
    installHint: { url: 'https://opencode.ai/docs' },
    mark: { viewBox: '0 0 24 24', path: 'M22 24H2V0h20zM17 4.8H7v14.4h10z', fillRule: 'nonzero' },
  },
  {
    id: 'hermes',
    displayName: 'Hermes Agent',
    bins: ['hermes'],
    // The first line of the answer is the version; later lines describe the installation.
    versionArgs: ['--version'],
    // The CLI exposes no login command with a reliable exit code, so the login state is read from
    // the ACP session itself: a machine with no inference provider refuses `session/new` with
    // this one error. The CLI's own `--setup` login is never run by discovery.
    authProbe: {
      args: ['acp'],
      acpSession: { notLoggedIn: { rpcCode: -32603, textContains: 'not connected to any AI provider' } },
    },
    transport: 'acp',
    // The CLI's login lives in its own home, so the launch sets no home variable and the CLI reads
    // that home as it is (no isolation is claimed).
    config: { mechanism: 'none' },
    // No `--yolo` and no yolo variable, ever: every approval the CLI asks for reaches the user.
    buildLaunch: () => ({ args: ['acp'], env: {}, stdin: 'prompt' }),
    resume: 'protocol',
    capabilities: {
      structuredStream: true,
      permissionAsk: true,
      resume: true,
      mcp: 'unknown',
      hooks: 'unknown',
      skills: 'unknown',
      images: true,
      quotaReport: 'none',
      costReport: 'none',
    },
    installHint: { url: 'https://hermes-agent.nousresearch.com/docs/getting-started/installation' },
    mark: null,
  },
  {
    id: 'kilo',
    displayName: 'Kilo Code',
    bins: ['kilo'],
    versionArgs: ['--version'],
    helpArgs: ['--help'],
    // `kilo auth list` prints "N credentials". N > 0 means only that some credential is
    // configured (a bring-your-own-key entry counts the same as a gateway login).
    authProbe: { args: ['auth', 'list'], parse: 'credential-count' },
    transport: 'acp',
    effortArg: { kind: 'session-option', configId: 'effort' },
    config: { mechanism: 'env-var', name: 'KILO_CONFIG_DIR' },
    // These names were seen only as strings in the CLI binary; neither its help nor its
    // documentation lists them, so their effect is unverified. They are passed anyway because a
    // variable the CLI does not know is ignored, and one it does know keeps the run from reading
    // the operator's own ~/.claude files. No isolation evidence is registered for this reason.
    isolation: { env: { KILO_DISABLE_CLAUDE_CODE: '1', KILO_DISABLE_CLAUDE_CODE_SKILLS: '1' } },
    buildLaunch: (input) => ({ args: ['acp'], env: { KILO_CONFIG_DIR: input.configDir }, stdin: 'prompt' }),
    resume: 'protocol',
    capabilities: {
      structuredStream: true,
      permissionAsk: 'unknown',
      resume: true,
      mcp: true,
      hooks: 'unknown',
      skills: 'unknown',
      images: true,
      quotaReport: 'none',
      costReport: 'none',
    },
    installHint: { url: 'https://kilo.ai/docs/code-with-ai/platforms/cli' },
    mark: { viewBox: '0 0 24 24', path: 'M0 0v24h24V0H0zm22.222 22.222H1.778V1.778h20.444v20.444zm-7.555-4.964h2.222v1.778h-2.794L12.89 17.83v-2.794h1.778v2.222zm4 0h-1.778v-2.222h-2.222v-1.778h2.793l1.207 1.207v2.793zm-7.556-2.591H9.333v-1.778h1.778v1.778zm-5.778-1.778h1.778v4h4v1.778H6.54L5.333 17.46V12.89zm13.334-3.556v1.778h-5.778V9.333h1.987V7.111h-1.987V5.333h2.558l1.206 1.207v2.793h2.014zm-11.556-2h2.222l1.778 1.778v2H9.333v-2H7.111v2H5.333V5.333h1.778v2zm4 0H9.333v-2h1.778v2z', fillRule: 'evenodd' },
  },
  {
    id: 'atomcode',
    displayName: 'AtomCode',
    bins: ['atomcode'],
    versionArgs: ['--version'],
    helpArgs: ['--help'],
    // `atomcode status` prints "Not logged in." with exit 0 when logged out and its logged-in
    // wording is unconfirmed; a user may also run with an own API key and never log in, so
    // anything but the logged-out text reads as unknown. The CLI's own login is never run.
    authProbe: { args: ['status', '--no-telemetry'], parse: 'logged-out-text', loggedOutText: 'Not logged in' },
    transport: 'acp',
    // The option is found by its id here because the CLI names it; its levels are `off`, `high`
    // and `max`, so only the names that differ from the level names are mapped besides the two
    // that match: a level the CLI does not list (low, medium) is never offered or sent.
    effortArg: { kind: 'session-option', configId: 'reasoning_effort' },
    levelNames: { none: 'off', high: 'high', max: 'max' },
    // The CLI documents no config-directory variable and its login lives in its own home, so no
    // run-scoped home is claimed (no isolation is declared).
    config: { mechanism: 'none' },
    telemetryOff: ['--no-telemetry'],
    // Never `-y` / `--dangerously-skip-permissions`; the session stays in its default `build` mode.
    buildLaunch: () => ({ args: ['acp', '--no-telemetry'], env: {}, stdin: 'prompt' }),
    resume: 'protocol',
    capabilities: {
      structuredStream: true,
      permissionAsk: 'unknown',
      resume: true,
      mcp: true,
      hooks: 'unknown',
      skills: 'unknown',
      images: true,
      quotaReport: 'none',
      costReport: 'none',
    },
    installHint: { url: 'https://atomgit.com/atomgit_atomcode/atomcode' },
    mark: null,
  },
  {
    id: 'reasonix',
    displayName: 'Reasonix',
    bins: ['reasonix'],
    // Prints `reasonix v<semver>` on one line.
    versionArgs: ['--version'],
    helpArgs: ['--help'],
    // `doctor --json` lists the configured providers with a boolean `key_present` each. A true
    // means some key is configured, not that it is valid. The CLI's own `setup` login is never run.
    authProbe: { args: ['doctor', '--json'], parse: 'provider-key-present' },
    transport: 'acp',
    // The option is found by its id and the model is set before it, because a model change
    // rebuilds the session and recomputes the levels. `auto` names no level, so it is never offered.
    effortArg: { kind: 'session-option', configId: 'effort' },
    // The CLI's global provider credentials live in its home, and the one documented variable that
    // moves state leaves them there, so no run-scoped home is claimed and no isolation is declared.
    config: { mechanism: 'none' },
    // No permission preset is passed: the CLI's own default stays, and never `danger-full-access`.
    buildLaunch: () => ({ args: ['acp'], env: {}, stdin: 'prompt' }),
    resume: 'protocol',
    capabilities: {
      structuredStream: true,
      permissionAsk: 'unknown',
      resume: true,
      mcp: true,
      hooks: 'unknown',
      skills: 'unknown',
      images: false,
      quotaReport: 'none',
      costReport: 'none',
    },
    installHint: { url: 'https://www.npmjs.com/package/reasonix' },
    mark: null,
  },
  {
    id: 'grok-build',
    displayName: 'Grok Build',
    bins: ['grok'],
    versionArgs: ['--version'],
    helpArgs: ['--help'],
    // The CLI has no status command (only `login` and `logout`), so the login state is whether its
    // credential file exists. Presence does not prove the credential is still valid, and an API
    // key exported in the user's environment is deliberately not a login.
    authProbe: { args: [], presenceFile: { homeEnv: 'GROK_HOME', homeDir: '.grok', file: 'auth.json' } },
    transport: 'acp',
    effortArg: GROK_EFFORT,
    // The login lives in the CLI's own home, so no run-scoped directory is handed over and the
    // home variable stays whatever the machine set; no isolation is claimed.
    config: { mechanism: 'none' },
    // Agent options precede `stdio`. `--no-leader` keeps the run off the shared leader socket under
    // the user's home. Never an auto-approve switch: permission mode stays `default`, so every
    // approval the CLI asks for reaches the user.
    buildLaunch: (input) => ({
      args: ['agent', '--no-leader', ...effortFlagArgs(GROK_EFFORT, input.effort), 'stdio'],
      env: { GROK_TELEMETRY_ENABLED: '0' },
      stdin: 'prompt',
    }),
    resume: 'protocol',
    capabilities: {
      structuredStream: true,
      permissionAsk: 'unknown',
      resume: true,
      mcp: true,
      hooks: 'unknown',
      skills: 'unknown',
      images: false,
      quotaReport: 'none',
      // `none` until a run proves the ACP stream carries a cost; the CLI's headless output has one but that path is not used.
      costReport: 'none',
    },
    installHint: { url: 'https://x.ai/build' },
    mark: { viewBox: '0 0 24 24', path: 'M9.27 15.29l7.978-5.897c.391-.29.95-.177 1.137.272.98 2.369.542 5.215-1.41 7.169-1.951 1.954-4.667 2.382-7.149 1.406l-2.711 1.257c3.889 2.661 8.611 2.003 11.562-.953 2.341-2.344 3.066-5.539 2.388-8.42l.006.007c-.983-4.232.242-5.924 2.75-9.383.06-.082.12-.164.179-.248l-3.301 3.305v-.01L9.267 15.292M7.623 16.723c-2.792-2.67-2.31-6.801.071-9.184 1.761-1.763 4.647-2.483 7.166-1.425l2.705-1.25a7.808 7.808 0 00-1.829-1A8.975 8.975 0 005.984 5.83c-2.533 2.536-3.33 6.436-1.962 9.764 1.022 2.487-.653 4.246-2.34 6.022-.599.63-1.199 1.259-1.682 1.925l7.62-6.815', fillRule: 'evenodd' },
  },
  {
    id: 'vibe',
    displayName: 'Mistral Vibe',
    // The ACP entry is its own binary and takes no arguments; the interactive `vibe` answers the
    // same `--version` and `--help`, so the one binary serves launch and probes.
    bins: ['vibe-acp'],
    versionArgs: ['--version'],
    helpArgs: ['--help'],
    // No authProbe: the CLI has no status command, so a login state is never guessed. The key
    // lives in the CLI's own home file or an environment variable, and neither is read here.
    transport: 'acp',
    // The selector is named by its category `thinking` (not `thought_level`). The map names every
    // level the CLI lists (off, low, medium, high, max), because a level without an entry is never
    // offered or sent.
    effortArg: { kind: 'session-option', category: 'thinking' },
    levelNames: { none: 'off', low: 'low', medium: 'medium', high: 'high', max: 'max' },
    // The CLI's home variable (`VIBE_HOME`) also holds the API key, so it is neither redirected to
    // a run directory (the key would be lost) nor pointed at the user's real home: the variable is
    // left unset and no isolation is claimed.
    config: { mechanism: 'none' },
    // Never `--yolo`, `--auto-approve` or the `auto-approve` agent: the default agent waits for
    // approval of what it does not allow itself, and that request reaches the user.
    buildLaunch: () => ({ args: [], env: {}, stdin: 'prompt' }),
    // `session/load` is advertised by the live `initialize` answer; the transport falls back to a
    // summary when a load is refused.
    resume: 'protocol',
    capabilities: {
      structuredStream: true,
      permissionAsk: 'unknown',
      resume: true,
      // The live `initialize` answer carries no MCP capability field.
      mcp: 'unknown',
      hooks: 'unknown',
      skills: 'unknown',
      images: true,
      quotaReport: 'none',
      // The cost the CLI reports per session is known from source only, not from a live run.
      costReport: 'none',
    },
    installHint: { url: 'https://github.com/mistralai/mistral-vibe' },
    mark: { viewBox: '0 0 24 24', path: 'M3.428 3.4h3.429v3.428h3.429v3.429h-.002 3.431V6.828h3.427V3.4h3.43v13.714H24v3.429H13.714v-3.428h-3.428v-3.429h-3.43v3.428h3.43v3.429H0v-3.429h3.428V3.4zm10.286 13.715h3.428v-3.429h-3.427v3.429z', fillRule: 'evenodd' },
  },
  {
    id: 'mimo',
    displayName: 'MiMo Code',
    bins: ['mimo'],
    versionArgs: ['--version'],
    helpArgs: ['--help'],
    // `mimo providers list` prints "N credentials" without opening a browser; N > 0 means only
    // that some credential is stored. The CLI's own `providers login` is never run by discovery.
    authProbe: { args: ['providers', 'list'], parse: 'credential-count' },
    transport: 'acp',
    // The CLI has no thought-level option: its model select lists every model plain and once per
    // level (`<model>/low|medium|high`), so the level joins the model id. `mimo models --verbose`
    // names the same three variants; no other level is offered.
    effortArg: { kind: 'model-suffix', separator: '/' },
    levelNames: { low: 'low', medium: 'medium', high: 'high' },
    // The login lives in the CLI's own data directory, so no run-scoped directory is passed: the
    // launch sets no variable and no flag, and no isolation is claimed.
    config: { mechanism: 'none' },
    // Never `--yolo` or `--dangerously-skip-permissions`: what the default agent does not allow
    // itself is asked of the user.
    buildLaunch: () => ({ args: ['acp'], env: {}, stdin: 'prompt' }),
    resume: 'protocol',
    capabilities: {
      structuredStream: true,
      permissionAsk: 'unknown',
      resume: true,
      mcp: true,
      hooks: 'unknown',
      skills: 'unknown',
      images: true,
      quotaReport: 'none',
      costReport: 'none',
    },
    installHint: { url: 'https://github.com/XiaomiMiMo/MiMo-Code' },
    mark: { viewBox: '0 0 24 24', path: 'M.958 15.936a.459.459 0 01.459.44v2.729a.46.46 0 01-.918 0v-2.729a.459.459 0 01.459-.44zm4.814-2.035a.46.46 0 01.553.45v4.754a.458.458 0 11-.918 0V15.48L3.74 17.202a.462.462 0 01-.655.016.462.462 0 01-.065-.082L.628 14.67a.459.459 0 01.658-.637l2.124 2.187 2.127-2.188a.46.46 0 01.235-.13zm2.068.004a.46.46 0 01.458.445v4.755a.46.46 0 01-.458.458.459.459 0 01-.458-.458V14.35a.459.459 0 01.458-.445zm1.973 2.014a.46.46 0 01.46.457v2.729a.46.46 0 01-.784.324.46.46 0 01-.134-.324v-2.729a.46.46 0 01.458-.458zm.002-2.045a.458.458 0 01.328.157l2.127 2.19 2.125-2.19a.459.459 0 01.784.318v4.756a.46.46 0 01-.455.458.46.46 0 01-.458-.458V15.48l-1.667 1.723a.46.46 0 01-.65.008l-.005-.005c0-.002-.002-.002-.004-.003l-2.455-2.534a.46.46 0 01-.008-.667.461.461 0 01.338-.128zm6.797 1.206a.46.46 0 01.53.651A1.966 1.966 0 0019.81 18.4a.462.462 0 01.623.18.46.46 0 01-.181.624 2.863 2.863 0 01-1.38.353l-.142-.004a2.88 2.88 0 01-2.393-4.263.461.461 0 01.274-.21zm.864-.931a2.884 2.884 0 013.915 3.914.46.46 0 01-.402.24l-.057-.004a.458.458 0 01-.164-.055.46.46 0 01-.182-.622 1.967 1.967 0 00-2.669-2.67.459.459 0 11-.441-.803zM9.59 6.368c1.481 0 1.696 1.202 1.696 1.654v2.648h-.917v-.432c-.26.346-.792.535-1.36.535-.133 0-1.289-.03-1.384-1.136-.082-.932.675-1.61 2.053-1.61h.691c0-.563-.367-.886-.983-.886-.44.013-.864.174-1.2.458l-.36-.664c.484-.379 1.012-.567 1.764-.567zm4.427.1c1.263 0 2.082.97 2.083 2.15 0 1.181-.824 2.154-2.083 2.154-1.26 0-2.084-.972-2.084-2.152 0-1.18.82-2.153 2.084-2.153zm6.801.015c.68 0 1.202.465 1.197 1.548v2.642H21.1V8.29c0-.312-.002-.98-.63-.98s-.628.667-.628.838v2.524h-.89V8.148c0-.17-.001-.838-.63-.838-.628 0-.628.668-.628.98v2.383h-.917v-4.03h.917V7a1.22 1.22 0 01.947-.516c.398 0 .76.193.982.686a1.321 1.321 0 011.195-.686zm-18.093.872l1.457-1.772H5.32L3.311 8.07l2.14 2.602H4.24L2.725 8.796 1.21 10.672H0L2.138 8.07.13 5.583h1.138l1.458 1.772zm4.149 3.317h-.916V6.644h.916v4.028zm16.99 0h-.916V6.644h.916v4.028zM9.925 8.71c-1.055 0-1.359.412-1.326.742.032.329.324.537.757.537a1.013 1.013 0 001.014-.968l.002-.31h-.447zM14.018 7.3c-.663 0-1.184.487-1.184 1.32 0 .832.52 1.32 1.184 1.32.662 0 1.182-.49 1.182-1.32 0-.832-.52-1.32-1.182-1.32zM6.417 5.001a.568.568 0 01.587.582.588.588 0 01-1.175 0A.57.57 0 016.417 5zm16.991 0a.57.57 0 01.592.582.588.588 0 01-1.174 0 .57.57 0 01.357-.542.572.572 0 01.225-.04z', fillRule: 'evenodd' },
  },
  {
    id: 'qwen',
    displayName: 'Qwen Code',
    bins: ['qwen'],
    versionArgs: ['--version'],
    helpArgs: ['--help'],
    // No authProbe: the CLI's own `auth` command is removed (its --help says so), so discovery
    // never guesses a login and `loggedIn` stays null. The one refusal a session gives —
    // -32000 "Authentication required" — is mapped by the catalog path alone, never by discovery.
    transport: 'acp',
    // The CLI names the very level names Docket knows (plus `default`, which names none), but
    // whether setting the session option persists into the user's settings file is unverified and
    // the package can write that file, so no level is offered or sent: the empty map names no
    // level and `effortArg` stays out. An operator run settles it; only then does the session
    // option join, found by its category `thought_level`.
    levelNames: {},
    // The model catalog is the user's own settings file (their configured providers) and the
    // login lives in that home, so no run-scoped redirection exists and Docket never writes the
    // file; the credential stays whatever the machine's own configuration carries.
    config: { mechanism: 'none' },
    // Never `--yolo` or `--approval-mode yolo|auto`: the default mode asks for approval of file
    // edits and shell commands, and every ask reaches the user. The deprecated --telemetry flags
    // are not passed — telemetry is a settings key Docket never writes.
    buildLaunch: () => ({ args: ['--acp'], env: {}, stdin: 'prompt' }),
    resume: 'protocol',
    capabilities: {
      structuredStream: true,
      permissionAsk: 'unknown',
      resume: true,
      mcp: true,
      hooks: 'unknown',
      skills: 'unknown',
      images: true,
      quotaReport: 'none',
      costReport: 'none',
    },
    installHint: { url: 'https://github.com/QwenLM/qwen-code' },
    mark: { viewBox: '0 0 24 24', path: 'M12.604 1.34c.393.69.784 1.382 1.174 2.075a.18.18 0 00.157.091h5.552c.174 0 .322.11.446.327l1.454 2.57c.19.337.24.478.024.837-.26.43-.513.864-.76 1.3l-.367.658c-.106.196-.223.28-.04.512l2.652 4.637c.172.301.111.494-.043.77-.437.785-.882 1.564-1.335 2.34-.159.272-.352.375-.68.37-.777-.016-1.552-.01-2.327.016a.099.099 0 00-.081.05 575.097 575.097 0 01-2.705 4.74c-.169.293-.38.363-.725.364-.997.003-2.002.004-3.017.002a.537.537 0 01-.465-.271l-1.335-2.323a.09.09 0 00-.083-.049H4.982c-.285.03-.553-.001-.805-.092l-1.603-2.77a.543.543 0 01-.002-.54l1.207-2.12a.198.198 0 000-.197 550.951 550.951 0 01-1.875-3.272l-.79-1.395c-.16-.31-.173-.496.095-.965.465-.813.927-1.625 1.387-2.436.132-.234.304-.334.584-.335a338.3 338.3 0 012.589-.001.124.124 0 00.107-.063l2.806-4.895a.488.488 0 01.422-.246c.524-.001 1.053 0 1.583-.006L11.704 1c.341-.003.724.032.9.34zm-3.432.403a.06.06 0 00-.052.03L6.254 6.788a.157.157 0 01-.135.078H3.253c-.056 0-.07.025-.041.074l5.81 10.156c.025.042.013.062-.034.063l-2.795.015a.218.218 0 00-.2.116l-1.32 2.31c-.044.078-.021.118.068.118l5.716.008c.046 0 .08.02.104.061l1.403 2.454c.046.081.092.082.139 0l5.006-8.76.783-1.382a.055.055 0 01.096 0l1.424 2.53a.122.122 0 00.107.062l2.763-.02a.04.04 0 00.035-.02.041.041 0 000-.04l-2.9-5.086a.108.108 0 010-.113l.293-.507 1.12-1.977c.024-.041.012-.062-.035-.062H9.2c-.059 0-.073-.026-.043-.077l1.434-2.505a.107.107 0 000-.114L9.225 1.774a.06.06 0 00-.053-.031zm6.29 8.02c.046 0 .058.02.034.06l-.832 1.465-2.613 4.585a.056.056 0 01-.05.029.058.058 0 01-.05-.029L8.498 9.841c-.02-.034-.01-.052.028-.054l.216-.012 6.722-.012z', fillRule: 'evenodd' },
  },
  {
    id: 'qoder',
    displayName: 'Qoder',
    // The npm package installs a `qoder` dispatcher and a `qodercli` binary and the docs name
    // `qoder`; which one the native installer places is unverified, so discovery searches both.
    bins: ['qoder', 'qodercli'],
    versionArgs: ['--version'],
    helpArgs: ['--help'],
    // `status -o json` prints a `logged_in` boolean on either exit code; only that boolean is
    // read, never the version or the BYOK flag beside it. CI=1 keeps the CLI from opening a
    // browser, and its own `login` and `--list-models` are never run from the probe.
    authProbe: { args: ['status', '-o', 'json'], parse: 'logged-in-json', env: { CI: '1' } },
    transport: 'acp',
    // The five level names the documentation gives are the level names Docket knows, so no map
    // exists and a value that names no level (`off`, `auto`) is never offered. The argv fallback
    // `--reasoning-effort` (listed in --help) is not used: the session option is the CLI's
    // ACP-native place, set only when the live session carries it — after the model selection and
    // only for a level the option itself lists.
    effortArg: { kind: 'session-option', category: 'thought_level' },
    // The login and the settings live in the CLI's own ~/.qoder home, so no run-scoped
    // redirection exists: neither `--config-dir` nor a personal access token is ever set (an
    // ambient key of another account never reaches a run) and Docket never writes that home.
    config: { mechanism: 'none' },
    // `--acp` is documented and live-proven but absent from --help, so the help scan cannot gate
    // it — it stays plain data here. Never `--yolo` or `--dangerously-skip-permissions`: the
    // default mode asks and every ask reaches the user.
    buildLaunch: () => ({ args: ['--acp'], env: {}, stdin: 'prompt' }),
    // The live `initialize` advertises loadSession.
    resume: 'protocol',
    capabilities: {
      structuredStream: true,
      // The ACP requestPermission round trip is unproven until an operator run.
      permissionAsk: 'unknown',
      resume: true,
      mcp: true,
      hooks: 'unknown',
      skills: 'unknown',
      // The live `initialize` advertises image prompts.
      images: true,
      quotaReport: 'none',
      // No cost field is verified on the ACP stream; credits ride the SDK control channel only.
      costReport: 'none',
    },
    installHint: { url: 'https://docs.qoder.com/cli' },
    mark: null,
  },
  {
    id: 'kiro',
    displayName: 'Kiro',
    // The cask binary is a thin wrapper: its `acp` and `chat` entries delegate to a chat binary
    // the cask does not install (`~/.local/bin/kiro-cli-chat`), and only the CLI's own setup
    // creates it — so discovery checks the delegate and reports the provider unusable without it.
    bins: ['kiro-cli'],
    agentDelegate: { homeEnv: 'HOME', relativePath: '.local/bin/kiro-cli-chat' },
    versionArgs: ['--version'],
    helpArgs: ['--help'],
    // `whoami -f json` prints `{"account":null}` when logged out and a populated account when
    // logged in, both without opening a browser; only the account key's null-ness is read. The
    // CLI's own `login` is never run, and nothing that could start a login flow is a probe.
    authProbe: { args: ['whoami', '-f', 'json'], parse: 'account-null-json' },
    transport: 'acp',
    // The effort flag is the CLI's own (`acp --help` lists low, medium, high, xhigh, max), but
    // the model list carries no effort field and per-model levels are unverified, so the empty
    // map offers and sends no level until an operator run records them.
    effortArg: KIRO_EFFORT,
    levelNames: KIRO_LEVEL_NAMES,
    // No per-run home or config-dir variable is documented and the login lives in `~/.kiro`, so
    // no run-scoped redirection is invented and no isolation is claimed.
    config: { mechanism: 'none' },
    // Never `-a`/`--trust-all-tools`: the CLI's default is ask-first and a non-interactive run
    // treats every ask as deny, so each ask reaches the user through the transport's wait.
    buildLaunch: (input) => ({
      args: ['acp', ...effortFlagArgs(KIRO_EFFORT, input.effort, KIRO_LEVEL_NAMES)],
      env: {},
      stdin: 'prompt',
    }),
    resume: 'protocol',
    capabilities: {
      structuredStream: true,
      permissionAsk: 'unknown',
      resume: true,
      mcp: true,
      hooks: 'unknown',
      skills: 'unknown',
      images: true,
      quotaReport: 'none',
      // Usage is metered in credits, but no machine-readable field is verified: no report yet.
      costReport: 'none',
    },
    installHint: { url: 'https://kiro.dev/docs/cli/' },
    mark: { viewBox: '0 0 24 24', path: 'M4.594 6.677C6.67-2.226 18.746-2.211 21.16 6.632c.353 1.297 1.725 7.582-1.673 13.747-1.545 2.797-5.841 5.49-6.99 1.883C8.6 25.477 3.315 24.1 5.789 18.609l-.318.143c-3.57 1.305-3.863-1.208-3.173-2.513.45-.84.727-1.335.937-1.897.353-.975.458-1.568.593-2.498.27-1.837.277-3.607.765-5.167zm8.37.01a.92.92 0 00-.81.428c-.217.323-.33.825-.33 1.462 0 .705.15 1.89 1.14 1.89h.008c.757 0 1.214-.705 1.214-1.89 0-.622-.127-1.125-.367-1.455a1.014 1.014 0 00-.855-.435zm4.08 0a.92.92 0 00-.81.428c-.217.323-.33.825-.33 1.462 0 .705.15 1.89 1.14 1.89h.008c.757 0 1.215-.705 1.215-1.89 0-.622-.128-1.125-.368-1.455a1.014 1.014 0 00-.855-.435z', fillRule: 'evenodd' },
  },
  {
    id: 'kimi',
    displayName: 'Kimi Code',
    bins: ['kimi'],
    versionArgs: ['--version'],
    helpArgs: ['--help'],
    // The CLI has no status command, and the credential file's name after login is not
    // documented, so the login state is whether any file exists under its credentials directory.
    // Presence only: nothing is ever opened or read, and presence does not prove the credential
    // is still valid. The terminal device-code login and the local `web` server are the user's
    // own commands — no probe ever starts either.
    authProbe: { args: [], presenceDir: { homeEnv: 'KIMI_CODE_HOME', homeDir: '.kimi-code', dir: 'credentials' } },
    transport: 'acp',
    // The thought-level selector is found by its reserved category, never by its id `thinking`:
    // the level list belongs to the selected model and is read from the answer to the model
    // change. The level names are the level names Docket knows, so no map exists — a value that
    // names no level (`off`, `on`) is never offered, and `off` in particular never rides a run.
    effortArg: { kind: 'session-option', category: 'thought_level' },
    // The login, config and sessions all live in the CLI's own global home (`~/.kimi-code`, or
    // wherever the machine's own KIMI_CODE_HOME points), so no run-scoped redirection exists and
    // the variable is never set: a per-run home would drop the login (P-44).
    config: { mechanism: 'none' },
    // The ACP entry is the subcommand `acp`. Never `--yolo` or `--auto`: the CLI's `default` mode
    // asks for approval and every ask reaches the user, and the session's `mode` option is never
    // moved to its far ends. Telemetry and the auto-updater are turned off by their documented
    // variables on every run.
    buildLaunch: () => ({
      args: ['acp'],
      env: { KIMI_DISABLE_TELEMETRY: '1', KIMI_CODE_NO_AUTO_UPDATE: '1' },
      stdin: 'prompt',
    }),
    // The live `initialize` advertises loadSession.
    resume: 'protocol',
    capabilities: {
      structuredStream: true,
      // The session/request_permission round trip is unproven until an operator run.
      permissionAsk: 'unknown',
      resume: true,
      mcp: true,
      hooks: 'unknown',
      skills: 'unknown',
      // The live `initialize` advertises image prompts.
      images: true,
      quotaReport: 'none',
      // The ACP usage_update carries context size only — the engine itself has no cost data.
      costReport: 'none',
    },
    installHint: { url: 'https://moonshotai.github.io/kimi-code/' },
    mark: null,
  },
  {
    id: 'amp',
    displayName: 'Amp',
    bins: ['amp'],
    // `--version` and the `version` subcommand both print the version; the flag is the shorter ask.
    versionArgs: ['--version'],
    helpArgs: ['--help'],
    // `account list` prints "No saved accounts." with exit 0 when nobody is logged in (verified on
    // the installed CLI); the logged-in output is unverified, so the probe may answer logged-out
    // or unknown and never logged in. `login` and `account login-url` are never run — they open a
    // browser.
    authProbe: { args: ['account', 'list'], parse: 'logged-out-text', loggedOutText: 'No saved accounts.' },
    transport: 'stream-json',
    streamDialect: 'amp',
    // No `--effort` flag exists (verified against --help): the mode is the model-plus-effort
    // bundle, so the effort parameter stays absent and an effort is ignored, never sent.
    // The login lives in the CLI's own home, so no config-dir redirection exists: the machine's
    // login stays reachable and no isolation is claimed. The per-run settings file is the run's
    // own mcp.json, pointed at through the documented AMP_SETTINGS_FILE: it carries only what
    // Docket needs (the run's MCP servers) and replaces the user's settings file for the run, so
    // neither their permission presets nor anything Docket must not write can reach it.
    config: { mechanism: 'none' },
    // Never `amp.dangerouslyAllowAll` in any settings file, never a `--dangerously-*` switch: the
    // CLI asks no tool approval by default and a Docket run must not widen that.
    buildLaunch: (input) => ({
      args: [
        ...(input.resume === undefined ? [] : ['threads', 'continue', input.resume.sessionRef]),
        '--execute',
        '--stream-json',
        ...(input.model === undefined ? [] : ['--mode', input.model]),
      ],
      env: { AMP_SKIP_UPDATE_CHECK: '1', AMP_SETTINGS_FILE: `${input.configDir}/mcp.json` },
      stdin: 'prompt',
    }),
    // A thread continues by its T-id on the command line; the dialect captures the id from init.
    resume: 'specify',
    capabilities: {
      structuredStream: true,
      // The CLI asks no tool approval by default, so no ask ever waits: a run needs a sandbox or
      // worktree, which is why the provider targets the isolated support level first.
      permissionAsk: false,
      resume: true,
      mcp: 'unknown',
      hooks: 'unknown',
      skills: 'unknown',
      images: 'unknown',
      quotaReport: 'none',
      costReport: 'none',
    },
    installHint: { url: 'https://ampcode.com/docs/cli' },
    mark: null,
  },
  {
    id: 'codebuddy',
    displayName: 'CodeBuddy Code',
    // The npm package installs both names; the cask of the same name is an IDE and the unscoped
    // `codebuddy-code` package is unrelated, so only these two candidates are searched.
    bins: ['codebuddy', 'cbc'],
    versionArgs: ['--version'],
    helpArgs: ['--help'],
    // No documented status command exists, so the login state is read from the ACP session the
    // CLI also speaks: initialize plus session/new, never a prompt, and the probe closes what it
    // opened. Logged out, the session is refused with -32000 "Authentication required" — an
    // error, not a browser — so the probe is safe without a login; the logged-in answer is
    // settled by the operator run. The CLI's own `/login` and `doctor` (which hung on an empty
    // home during discovery) are never run.
    authProbe: {
      args: ['--acp'],
      acpSession: { notLoggedIn: { rpcCode: -32000, textContains: 'Authentication required' } },
    },
    transport: 'stream-json',
    streamDialect: 'codebuddy',
    effortArg: CODEBUDDY_EFFORT,
    levelNames: CODEBUDDY_LEVEL_NAMES,
    // The login lives in the CLI's own ~/.codebuddy home and no documented variable redirects
    // its state, so the launch sets no variable and no flag: the machine's login stays reachable
    // and no isolation is claimed (P-44).
    config: { mechanism: 'none' },
    // Print mode with the structured output; `--verbose` is the documented companion of the
    // stream formats. `--permission-mode default` is passed explicitly so the asking default is
    // the launch's own choice, never the CLI's drift; `-y`/`--dangerously-skip-permissions` and
    // every other mode (acceptEdits, plan, dontAsk, auto, bypassPermissions) never reach a run.
    // No documented resume flag exists, so nothing is resumed — a session ref is captured but
    // never passed back.
    buildLaunch: (input) => ({
      args: [
        '-p',
        '--output-format',
        'stream-json',
        '--verbose',
        '--permission-mode',
        'default',
        ...(input.model === undefined ? [] : ['--model', input.model]),
        ...effortFlagArgs(CODEBUDDY_EFFORT, input.effort, CODEBUDDY_LEVEL_NAMES),
      ],
      env: {},
      stdin: 'prompt',
    }),
    resume: 'none',
    capabilities: {
      structuredStream: true,
      // The headless ask channel (the canUseTool control request of the stream-json input mode
      // the launch does not use) is unverified until an operator run, so no ask is claimed to
      // wait; a run relies on dontAsk plus a sandbox until then.
      permissionAsk: 'unknown',
      resume: false,
      // No run-scoped config mechanism exists, so the run's MCP servers cannot reach the CLI.
      mcp: 'unknown',
      hooks: 'unknown',
      skills: 'unknown',
      images: 'unknown',
      quotaReport: 'none',
      // The result line carries the CLI's own total_cost_usd, mapped as a reported USD cost.
      costReport: 'reported',
    },
    installHint: { url: 'https://www.codebuddy.ai/docs/cli/installation' },
    mark: null,
  },
];
