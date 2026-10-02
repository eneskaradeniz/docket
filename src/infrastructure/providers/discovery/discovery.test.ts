// Fake-bin tests for path discovery (docs/v2/providers.md → "Discovery (P-2 … P-6)").
// Every binary is a real executable script in a throwaway tree: search, overrides, probes and
// timeouts run through the real child-process machinery; only the spawn function is wrapped, to
// record what the children were asked to run and what environment they received.
import { spawn as nodeSpawn } from 'node:child_process';
import { chmodSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';

import type { DiscoveredProvider, ProviderDiscovery } from '../../../application/index';
import { BUILTIN_PROVIDER_DEFS, type ProviderDef } from '../defs/index';
import { createPathDiscovery, loggedInFromCredentialCount, type ProbeSpawn } from './path-discovery';

let root: string;

beforeAll(() => {
  root = mkdtempSync(join(tmpdir(), 'docket-path-discovery-'));
  mkdirSync(join(root, 'empty-path')); // the injected PATH never contains a usable binary
});

afterAll(() => {
  rmSync(root, { recursive: true, force: true });
});

interface BinScript {
  readonly version?: string; // --version prints this and exits 0
  readonly failVersion?: boolean; // --version exits 1 without output
  readonly hangVersion?: boolean; // --version never returns
  readonly hangAll?: boolean; // any invocation never returns
  readonly helpFlags?: 'stdout-stderr' | 'none'; // whether --help lists the optional flags
  readonly authExit?: number; // exit code of `login status` (default 0 = logged in)
}

const binBody = (script: BinScript): string => {
  if (script.hangAll === true) return 'exec /bin/sleep 30';
  const versionBranch =
    script.hangVersion === true
      ? '    exec /bin/sleep 30\n    ;;'
      : script.failVersion === true
        ? '    exit 1\n    ;;'
        : `    echo "${script.version ?? '0.0.0-fake'}"\n    exit 0\n    ;;`;
  const helpBranch =
    script.helpFlags === 'none'
      ? '    echo "Usage: fake [options]"'
      : [
          '    echo "Usage: fake [options]"',
          '    echo "  --flag-stdout      first capability flag"',
          '    echo "  --flag-stderr      second capability flag" >&2',
        ].join('\n');
  return `case "$1" in
  --version)
${versionBranch}
  --help)
${helpBranch}
    exit 0
    ;;
  login)
    if [ "$2" = "status" ]; then
      exit ${script.authExit ?? 0}
    fi
    ;;
esac
exit 0`;
};

const writeBin = (relativePath: string, body: string): string => {
  const path = join(root, relativePath);
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, `#!/bin/sh\n${body}\n`);
  chmodSync(path, 0o755);
  return path;
};

const defOf = (overrides?: Partial<ProviderDef>): ProviderDef => ({
  id: 'fake-cli',
  displayName: 'Fake CLI',
  bins: ['fake-cli'],
  versionArgs: ['--version'],
  helpArgs: ['--help'],
  authProbe: { args: ['login', 'status'] },
  optionalFlags: {
    '--flag-stdout': 'flag-stdout-capability',
    '--flag-stderr': 'flag-stderr-capability',
    '--flag-absent': 'flag-absent-capability',
  },
  transport: 'stream-json',
  streamDialect: 'fake',
  config: { mechanism: 'env-var', name: 'FAKE_CLI_HOME' },
  buildLaunch: () => ({ args: [], env: {}, stdin: 'prompt' }),
  resume: 'none',
  capabilities: {
    structuredStream: true,
    permissionAsk: false,
    resume: false,
    mcp: false,
    hooks: 'unknown',
    skills: 'unknown',
    images: 'unknown',
    quotaReport: 'none',
    costReport: 'none',
  },
  installHint: { url: 'https://example.invalid/fake-cli' },
  mark: null,
  ...overrides,
});

interface SpawnCall {
  readonly command: string;
  readonly args: readonly string[];
  readonly options: { readonly timeout: number; readonly env: Readonly<Record<string, string>> };
}

const recordingSpawn = (calls: SpawnCall[]): ProbeSpawn => (command, args, options) => {
  calls.push({ command, args: [...args], options });
  return nodeSpawn(command, [...args], { ...options });
};

const makeDiscovery = (
  defs: readonly ProviderDef[],
  env: Readonly<Record<string, string>>,
  options?: { readonly probeTimeoutMs?: number },
): { readonly discovery: ProviderDiscovery; readonly calls: SpawnCall[] } => {
  const calls: SpawnCall[] = [];
  const discovery = createPathDiscovery(defs, recordingSpawn(calls), env, join(root, 'home'), options);
  return { discovery, calls };
};

const collect = async (discovery: ProviderDiscovery): Promise<DiscoveredProvider[]> => {
  const results: DiscoveredProvider[] = [];
  await discovery.discover((result) => results.push(result));
  return results;
};

const EMPTY_PATH = (): string => join(root, 'empty-path');
const HOME = (): string => join(root, 'home');

describe('path discovery', () => {
  it('P-2: the DOCKET_<ID>_BIN override wins over every search path', async () => {
    writeBin('path-dir/fake-cli', binBody({ version: '1.0.0-from-path' }));
    writeBin('home/.local/bin/fake-cli', binBody({ version: '2.0.0-from-toolchain' }));
    const override = writeBin('override/fake-cli', binBody({ version: '9.9.9-from-override' }));
    const { discovery, calls } = makeDiscovery(
      [defOf()],
      { PATH: join(root, 'path-dir'), DOCKET_FAKE_CLI_BIN: override },
      { probeTimeoutMs: 2000 },
    );
    const results = await collect(discovery);
    expect(results).toHaveLength(1);
    expect(results[0]?.binPath).toBe(override);
    expect(results[0]?.version).toBe('9.9.9-from-override'); // the probes ran on the override
    expect(calls.every((call) => call.command === override)).toBe(true);
  });

  it('P-2: an override naming a missing file reports binPath null and never falls back to search', async () => {
    writeBin('path-dir/fake-cli', binBody({ version: '1.0.0-from-path' }));
    const { discovery, calls } = makeDiscovery(
      [defOf()],
      { PATH: join(root, 'path-dir'), DOCKET_FAKE_CLI_BIN: join(root, 'override', 'missing-bin') },
      { probeTimeoutMs: 2000 },
    );
    const results = await collect(discovery);
    expect(results).toEqual([{ defId: 'fake-cli', binPath: null, version: null, loggedIn: null, optionalFlags: [] }]);
    expect(calls).toEqual([]); // without a binary there is nothing to probe
  });

  it('P-3: search covers PATH first and then the toolchain directories; the first existing candidate wins', async () => {
    const fromPath = writeBin('path-dir/fake-cli', binBody({ version: '1.0.0-from-path' }));
    writeBin('home/.local/bin/fake-cli', binBody({ version: '2.0.0-from-local' }));
    writeBin('home/.bun/bin/fake-cli', binBody({ version: '3.0.0-from-bun' }));
    const first = makeDiscovery([defOf()], { PATH: join(root, 'path-dir') }, { probeTimeoutMs: 2000 });
    const firstResults = await collect(first.discovery);
    expect(firstResults[0]?.binPath).toBe(fromPath);
    expect(firstResults[0]?.version).toBe('1.0.0-from-path');

    // Only a deeper toolchain entry exists, and only under the second candidate bin name.
    const fromBun = writeBin('home/.bun/bin/other-cli', binBody({ version: '3.0.0-from-bun' }));
    const second = makeDiscovery(
      [defOf({ bins: ['missing-cli', 'other-cli'] })],
      { PATH: join(root, 'path-dir') },
      { probeTimeoutMs: 2000 },
    );
    const secondResults = await collect(second.discovery);
    expect(secondResults[0]?.binPath).toBe(fromBun);
    expect(secondResults[0]?.version).toBe('3.0.0-from-bun');
  });

  it('P-3: nvm version shims are searched, and the enriched PATH is what the child receives', async () => {
    const shim = writeBin('home/.nvm/versions/node/v22.11.0/bin/shim-cli', binBody({ version: '22.0.0-from-nvm' }));
    const { discovery, calls } = makeDiscovery(
      [defOf({ id: 'shim-cli', bins: ['shim-cli'] })],
      { PATH: EMPTY_PATH() },
      { probeTimeoutMs: 2000 },
    );
    const results = await collect(discovery);
    expect(results[0]?.binPath).toBe(shim);
    const childPath = calls[0]?.options.env.PATH ?? '';
    const entries = childPath.split(':');
    expect(entries).toContain(EMPTY_PATH()); // the original PATH entries survive the enrichment
    expect(entries).toContain(join(HOME(), '.local', 'bin'));
    expect(entries).toContain(join(HOME(), '.bun', 'bin'));
    expect(entries).toContain('/opt/homebrew/bin');
    expect(entries).toContain('/usr/local/bin');
    expect(entries).toContain(join(HOME(), '.nvm', 'versions', 'node', 'v22.11.0', 'bin'));
    expect(calls.every((call) => call.options.env.PATH === childPath)).toBe(true);
  });

  it('P-4: probes run once each on exactly the resolved path, each under a timeout', async () => {
    const bin = writeBin('home/.local/bin/fake-cli', binBody({ version: '1.2.3-probed' }));
    const { discovery, calls } = makeDiscovery([defOf()], { PATH: EMPTY_PATH() }, { probeTimeoutMs: 2000 });
    const results = await collect(discovery);
    expect(calls.map((call) => [call.command, call.args])).toEqual([
      [bin, ['--version']],
      [bin, ['--help']],
      [bin, ['login', 'status']],
    ]);
    expect(calls.every((call) => call.options.timeout === 2000)).toBe(true);
    expect(results).toEqual([
      {
        defId: 'fake-cli',
        binPath: bin,
        version: '1.2.3-probed',
        loggedIn: true,
        optionalFlags: ['--flag-stdout', '--flag-stderr'],
      },
    ]);
  });

  it('P-4: a failing version probe leaves the field null while the provider is still reported', async () => {
    const bin = writeBin(
      'home/.local/bin/fake-cli',
      binBody({ failVersion: true, helpFlags: 'stdout-stderr', authExit: 0 }),
    );
    const { discovery, calls } = makeDiscovery([defOf()], { PATH: EMPTY_PATH() }, { probeTimeoutMs: 2000 });
    const results = await collect(discovery);
    expect(results).toEqual([
      {
        defId: 'fake-cli',
        binPath: bin,
        version: null,
        loggedIn: true,
        optionalFlags: ['--flag-stdout', '--flag-stderr'],
      },
    ]);
    expect(calls).toHaveLength(3); // the failed probe did not stop the remaining probes
  });

  it('P-4: a timing-out version probe leaves the field null while the other probes still answer', async () => {
    const bin = writeBin('home/.local/bin/fake-cli', binBody({ hangVersion: true }));
    const { discovery, calls } = makeDiscovery([defOf()], { PATH: EMPTY_PATH() }, { probeTimeoutMs: 400 });
    const results = await collect(discovery);
    expect(results).toEqual([
      {
        defId: 'fake-cli',
        binPath: bin,
        version: null,
        loggedIn: true,
        optionalFlags: ['--flag-stdout', '--flag-stderr'],
      },
    ]);
    expect(calls).toHaveLength(3); // every probe got its own chance after the timeout
  });

  it('P-5: an optional flag is enabled only when the help output lists it, on stdout or stderr', async () => {
    writeBin('home/.local/bin/fake-cli', binBody({ version: '1.0.0', helpFlags: 'stdout-stderr' }));
    const listed = makeDiscovery([defOf()], { PATH: EMPTY_PATH() }, { probeTimeoutMs: 2000 });
    const listedResults = await collect(listed.discovery);
    expect(listedResults[0]?.optionalFlags).toEqual(['--flag-stdout', '--flag-stderr']);

    writeBin('home/.bun/bin/quiet-cli', binBody({ version: '1.0.0', helpFlags: 'none' }));
    const unlisted = makeDiscovery(
      [defOf({ id: 'quiet-cli', bins: ['quiet-cli'] })],
      { PATH: EMPTY_PATH() },
      { probeTimeoutMs: 2000 },
    );
    const unlistedResults = await collect(unlisted.discovery);
    expect(unlistedResults[0]?.optionalFlags).toEqual([]);
  });

  it('P-45: a help command marked needsLogin is not run when the login probe answers false or null, and runs for true', async () => {
    const bin = writeBin('home/.local/bin/gated-cli', binBody({ version: '1.0.0', authExit: 1 }));
    const flags = ['--flag-stdout', '--flag-stderr'];
    const gated = (overrides?: Partial<ProviderDef>): ProviderDef =>
      defOf({ id: 'gated-cli', bins: ['gated-cli'], helpNeedsLogin: true, ...overrides });
    const helpRuns = (calls: readonly SpawnCall[]): number => calls.filter((call) => call.args[0] === '--help').length;

    const loggedOut = makeDiscovery([gated()], { PATH: EMPTY_PATH() }, { probeTimeoutMs: 2000 });
    const outResults = await collect(loggedOut.discovery);
    expect(outResults[0]).toMatchObject({ loggedIn: false, optionalFlags: [] });
    expect(helpRuns(loggedOut.calls)).toBe(0);

    const unknown = makeDiscovery([gated({ authProbe: undefined })], { PATH: EMPTY_PATH() }, { probeTimeoutMs: 2000 });
    const unknownResults = await collect(unknown.discovery);
    expect(unknownResults[0]).toMatchObject({ loggedIn: null, optionalFlags: [] });
    expect(helpRuns(unknown.calls)).toBe(0);

    writeBin('home/.local/bin/gated-cli', binBody({ version: '1.0.0', authExit: 0 }));
    const loggedIn = makeDiscovery([gated()], { PATH: EMPTY_PATH() }, { probeTimeoutMs: 2000 });
    const inResults = await collect(loggedIn.discovery);
    expect(inResults[0]).toMatchObject({ loggedIn: true, optionalFlags: flags });
    expect(loggedIn.calls.map((call) => [call.command, call.args[0]])).toEqual([
      [bin, '--version'],
      [bin, 'login'],
      [bin, '--help'],
    ]);
  });

  it('P-6: results stream per provider; a hanging binary delays only its own entry', async () => {
    writeBin('path-dir/fast-cli', binBody({ version: '1.0.0-fast' }));
    const slowBin = writeBin('home/.local/bin/slow-cli', binBody({ hangAll: true }));
    const { discovery } = makeDiscovery(
      [defOf({ id: 'slow-cli', bins: ['slow-cli'] }), defOf({ id: 'fast-cli', bins: ['fast-cli'] })],
      { PATH: join(root, 'path-dir') },
      { probeTimeoutMs: 400 },
    );
    const arrivals: string[] = [];
    const results: DiscoveredProvider[] = [];
    let settled = false;
    const done = discovery
      .discover((result) => {
        arrivals.push(result.defId);
        results.push(result);
      })
      .then(() => {
        settled = true;
      });
    await vi.waitFor(() => expect(arrivals).toEqual(['fast-cli']));
    expect(settled).toBe(false); // the slow provider is still inside its own probe timeouts
    await done;
    expect(arrivals).toEqual(['fast-cli', 'slow-cli']); // completion order, not definition order
    const slow = results.find((result) => result.defId === 'slow-cli');
    expect(slow).toEqual({
      defId: 'slow-cli',
      binPath: slowBin, // found and reported even though every probe of it timed out
      version: null,
      loggedIn: null,
      optionalFlags: [],
    });
  });

  it('a definition without help or auth probes is probed for the version only', async () => {
    const bin = writeBin('home/.local/bin/fake-cli', binBody({ version: '1.0.0-bare' }));
    const { discovery, calls } = makeDiscovery(
      [defOf({ helpArgs: undefined, optionalFlags: undefined, authProbe: undefined })],
      { PATH: EMPTY_PATH() },
      { probeTimeoutMs: 2000 },
    );
    const results = await collect(discovery);
    expect(results).toEqual([
      { defId: 'fake-cli', binPath: bin, version: '1.0.0-bare', loggedIn: null, optionalFlags: [] },
    ]);
    expect(calls).toHaveLength(1);
  });

  it('an auth probe exiting non-zero reports not logged in', async () => {
    writeBin('home/.local/bin/fake-cli', binBody({ version: '1.0.0', authExit: 1 }));
    const { discovery } = makeDiscovery([defOf()], { PATH: EMPTY_PATH() }, { probeTimeoutMs: 2000 });
    const results = await collect(discovery);
    expect(results[0]?.loggedIn).toBe(false);
  });

  it('a provider that is not installed is reported with null fields and never probed', async () => {
    const { discovery, calls } = makeDiscovery(
      [defOf({ id: 'absent-cli', bins: ['absent-cli'] })],
      { PATH: EMPTY_PATH() },
      { probeTimeoutMs: 2000 },
    );
    const results = await collect(discovery);
    expect(results).toEqual([{ defId: 'absent-cli', binPath: null, version: null, loggedIn: null, optionalFlags: [] }]);
    expect(calls).toHaveLength(0);
  });
});

describe('ACP login probe in discovery (P-45)', () => {
  const FAKE_AGENT = join(dirname(fileURLToPath(import.meta.url)), '..', 'transports', 'acp', 'fake-agent.cjs');
  const hermesDef = (): ProviderDef => {
    const def = BUILTIN_PROVIDER_DEFS.find((candidate) => candidate.id === 'hermes');
    if (def === undefined) throw new Error('missing hermes definition');
    return def;
  };
  /** A `hermes` stand-in: the multi-line --version answer and the fake ACP agent behind `acp`. */
  const writeHermes = (dir: string, scenario: string): string =>
    writeBin(
      `${dir}/hermes`,
      `case "$1" in
  --version)
    echo "Hermes Agent v0.21.4 (2026.9.21)"
    echo "Install directory: /somewhere"
    exit 0
    ;;
  acp)
    exec "${process.execPath}" "${FAKE_AGENT}" ${scenario} "${join(root, dir, 'agent-log.jsonl')}"
    ;;
esac
exit 0`,
    );

  it('P-45: discovery reads the hermes version from the first line and the login from an ACP session, with no ambient credential in the child', async () => {
    for (const [scenario, expected] of [
      ['models-hermes', true],
      ['session-login-refused', false],
      ['session-internal-error', null],
    ] as const) {
      const bin = writeHermes(`hermes-${scenario}`, scenario);
      const { discovery, calls } = makeDiscovery(
        [hermesDef()],
        { PATH: EMPTY_PATH(), DOCKET_HERMES_BIN: bin, OPENAI_API_KEY: 'sk-ambient', HOME: HOME() },
        { probeTimeoutMs: 5000 },
      );
      const found = await collect(discovery);
      expect(found[0], scenario).toMatchObject({
        defId: 'hermes',
        binPath: bin,
        version: 'Hermes Agent v0.21.4 (2026.9.21)',
        loggedIn: expected,
        optionalFlags: [],
      });
      // The login probe launches the CLI's ACP mode and nothing else beyond the version probe, and
      // the probe child gets the allowlisted environment: the ambient key stays out.
      expect(calls.map((call) => call.args), scenario).toEqual([['--version'], ['acp']]);
      expect(calls[1]?.options.env['OPENAI_API_KEY'], scenario).toBeUndefined();
      expect(calls[1]?.options.env['HOME'], scenario).toBe(HOME());
    }
  }, 30_000);
});

describe('logged-out text login probe (atomcode)', () => {
  it('G1: only the documented text with exit 0 reads as logged out; every other answer is unknown, never logged in', async () => {
    const atomcode = BUILTIN_PROVIDER_DEFS.find((def) => def.id === 'atomcode');
    if (atomcode === undefined) throw new Error('missing atomcode definition');
    const body = (answer: string, exit = 0): string =>
      `case "$1" in\n  --version) echo "atomcode 5.2.1 (bb491ce)"; exit 0;;\n  status) echo "${answer}"; exit ${exit};;\nesac\nexit 0`;
    const def = defOf({ id: 'atomcode-like', bins: ['atomcode-like'], helpArgs: undefined, optionalFlags: undefined, authProbe: atomcode.authProbe });
    for (const [answer, exit, expected] of [
      ['Not logged in.', 0, false],
      ['Logged in as someone', 0, null],
      ['Not logged in.', 1, null],
    ] as const) {
      writeBin('home/.local/bin/atomcode-like', body(answer, exit));
      const { discovery, calls } = makeDiscovery([def], { PATH: EMPTY_PATH() }, { probeTimeoutMs: 2000 });
      const results = await collect(discovery);
      expect(results[0]?.loggedIn, `${answer} / exit ${exit}`).toBe(expected);
      expect(calls.map((call) => call.args[0]).filter((arg) => arg === 'login' || arg === 'logout')).toEqual([]);
    }
  });
});

describe('credential-count login probe (kilo)', () => {
  it('G1: "<N> credentials" gives logged in for N > 0, not logged in for 0, and unknown for anything else', () => {
    const ESC = String.fromCharCode(27);
    expect(loggedInFromCredentialCount('0 credentials')).toBe(false);
    expect(loggedInFromCredentialCount('3 credentials')).toBe(true);
    expect(loggedInFromCredentialCount('1 credential')).toBe(true);
    expect(loggedInFromCredentialCount('garbage')).toBeNull();
    expect(loggedInFromCredentialCount('')).toBeNull();
    // Colour codes and a leading INFO log line surround the real answer.
    const noisy = `INFO  2026-10-02T18:27:53 +49ms service=default\n${ESC}[0m\n┌  Credentials ${ESC}[90m~/.local/share/kilo/auth.json\n│\n└  ${ESC}[0m2 credentials\n`;
    expect(loggedInFromCredentialCount(noisy)).toBe(true);
    expect(loggedInFromCredentialCount(noisy.replace('2 credentials', '0 credentials'))).toBe(false);
  });

  it('G1: the kilo definition probes `kilo auth list` and reads the count, never an exit code alone', async () => {
    const kilo = BUILTIN_PROVIDER_DEFS.find((def) => def.id === 'kilo');
    expect(kilo?.authProbe).toEqual({ args: ['auth', 'list'], parse: 'credential-count' });
    const body = (answer: string, exit = 0): string =>
      `case "$1" in\n  --version) echo "7.8.3"; exit 0;;\n  auth) echo "INFO log line"; echo "${answer}"; exit ${exit};;\nesac\nexit 0`;
    const def = defOf({
      id: 'kilo-like',
      bins: ['kilo-like'],
      helpArgs: undefined,
      optionalFlags: undefined,
      authProbe: kilo?.authProbe,
    });
    for (const [answer, exit, expected] of [
      ['0 credentials', 0, false],
      ['3 credentials', 0, true],
      ['nothing useful', 0, null],
      ['3 credentials', 1, null],
    ] as const) {
      writeBin('home/.local/bin/kilo-like', body(answer, exit));
      const { discovery } = makeDiscovery([def], { PATH: EMPTY_PATH() }, { probeTimeoutMs: 2000 });
      const results = await collect(discovery);
      expect(results[0]?.loggedIn, `${answer} / exit ${exit}`).toBe(expected);
    }
  });
});

describe('credential-file presence login probe (grok-build)', () => {
  const grokDef = (): ProviderDef => {
    const grok = BUILTIN_PROVIDER_DEFS.find((def) => def.id === 'grok-build');
    return defOf({
      id: 'grok-like',
      bins: ['grok-like'],
      helpArgs: undefined,
      optionalFlags: undefined,
      authProbe: grok?.authProbe,
    });
  };
  const discoverGrok = async (env: Readonly<Record<string, string>>): Promise<{ readonly loggedIn: boolean | null | undefined; readonly calls: SpawnCall[] }> => {
    writeBin('home/.local/bin/grok-like', 'case "$1" in\n  --version) echo "1.0.46"; exit 0;;\nesac\nexit 3');
    const { discovery, calls } = makeDiscovery([grokDef()], { PATH: EMPTY_PATH(), ...env }, { probeTimeoutMs: 2000 });
    const results = await collect(discovery);
    return { loggedIn: results[0]?.loggedIn, calls };
  };

  it('G1: auth.json under the default home is a login, its absence is not, and the CLI is spawned only for its version', async () => {
    rmSync(join(HOME(), '.grok'), { recursive: true, force: true });
    const absent = await discoverGrok({});
    expect(absent.loggedIn).toBe(false);

    mkdirSync(join(HOME(), '.grok'), { recursive: true });
    // Content is never read: the file holds nothing parseable and the answer is the same.
    writeFileSync(join(HOME(), '.grok', 'auth.json'), 'not json');
    const present = await discoverGrok({});
    expect(present.loggedIn).toBe(true);
    expect(present.calls.map((call) => call.args)).toEqual([['--version']]);
    rmSync(join(HOME(), '.grok'), { recursive: true, force: true });
  });

  it('G1: GROK_HOME redirects the probe, and an ambient API key is not a login', async () => {
    const elsewhere = join(root, 'grok-elsewhere');
    mkdirSync(elsewhere, { recursive: true });
    rmSync(join(HOME(), '.grok'), { recursive: true, force: true });
    mkdirSync(join(HOME(), '.grok'), { recursive: true });
    writeFileSync(join(HOME(), '.grok', 'auth.json'), '{}');

    // The override names a home without the file: the default home's file no longer counts.
    expect((await discoverGrok({ GROK_HOME: elsewhere })).loggedIn).toBe(false);
    writeFileSync(join(elsewhere, 'auth.json'), '{}');
    expect((await discoverGrok({ GROK_HOME: elsewhere })).loggedIn).toBe(true);

    rmSync(join(HOME(), '.grok'), { recursive: true, force: true });
    expect((await discoverGrok({ XAI_API_KEY: 'xai-ambient' })).loggedIn).toBe(false);
  });
});
