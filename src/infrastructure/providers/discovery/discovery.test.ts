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
import { createLoginStates } from './login-states';
import {
  createPathDiscovery,
  loggedInFromAuthStatus,
  loggedInFromCredentialCount,
  loggedInFromProviderKeys,
  loggedInFromWhoami,
  type ProbeSpawn,
} from './path-discovery';

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

  it('A-67: every row carries the def display name and its install url, found or not', async () => {
    writeBin('path-dir/fake-cli', binBody({ version: '1.0.0' }));
    const { discovery } = makeDiscovery([defOf()], { PATH: join(root, 'path-dir') }, { probeTimeoutMs: 2000 });
    const [found] = await collect(discovery);
    expect(found).toMatchObject({ name: 'Fake CLI', installUrl: 'https://example.invalid/fake-cli' });
    const { discovery: absent } = makeDiscovery([defOf()], { PATH: join(root, 'empty'), DOCKET_FAKE_CLI_BIN: join(root, 'no-such-bin') }, { probeTimeoutMs: 2000 });
    const [missing] = await collect(absent);
    expect(missing).toMatchObject({ binPath: null, name: 'Fake CLI', installUrl: 'https://example.invalid/fake-cli' });
  });

  it('P-2: an override naming a missing file reports binPath null and never falls back to search', async () => {
    writeBin('path-dir/fake-cli', binBody({ version: '1.0.0-from-path' }));
    const { discovery, calls } = makeDiscovery(
      [defOf()],
      { PATH: join(root, 'path-dir'), DOCKET_FAKE_CLI_BIN: join(root, 'override', 'missing-bin') },
      { probeTimeoutMs: 2000 },
    );
    const results = await collect(discovery);
    expect(results).toEqual([{ defId: 'fake-cli', name: 'Fake CLI', installUrl: 'https://example.invalid/fake-cli', binPath: null, version: null, loggedIn: null, optionalFlags: [] }]);
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
        name: expect.any(String),
        installUrl: expect.any(String),
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
        name: expect.any(String),
        installUrl: expect.any(String),
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
        name: expect.any(String),
        installUrl: expect.any(String),
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

  it('P-45: discovery keeps the latest login answer per provider, replacing an older one and reporting a provider it never saw as undefined', async () => {
    writeBin('home/.local/bin/state-cli', binBody({ version: '1.0.0', authExit: 0 }));
    const loginStates = createLoginStates();
    const calls: SpawnCall[] = [];
    const discovery = createPathDiscovery(
      [defOf({ id: 'state-cli', bins: ['state-cli'] }), defOf({ id: 'absent-cli', bins: ['absent-cli'] })],
      recordingSpawn(calls),
      { PATH: EMPTY_PATH() },
      join(root, 'home'),
      { probeTimeoutMs: 2000, loginStates },
    );
    expect(loginStates.get('state-cli')).toBeUndefined();

    await collect(discovery);
    expect(loginStates.get('state-cli')).toBe(true);
    expect(loginStates.get('absent-cli')).toBeNull(); // not installed: no answer, which counts as not logged in
    expect(loginStates.get('never-seen')).toBeUndefined();

    writeBin('home/.local/bin/state-cli', binBody({ version: '1.0.0', authExit: 1 }));
    await collect(discovery);
    expect(loginStates.get('state-cli')).toBe(false);
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
      name: expect.any(String),
      installUrl: expect.any(String),
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
      { defId: 'fake-cli', name: 'Fake CLI', installUrl: 'https://example.invalid/fake-cli', binPath: bin, version: '1.0.0-bare', loggedIn: null, optionalFlags: [] },
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
    expect(results).toEqual([{ defId: 'absent-cli', name: 'Fake CLI', installUrl: 'https://example.invalid/fake-cli', binPath: null, version: null, loggedIn: null, optionalFlags: [] }]);
    expect(calls).toHaveLength(0);
  });
});

describe('ACP login probe in discovery (P-45)', () => {
  const FAKE_AGENT = join(dirname(fileURLToPath(import.meta.url)), '..', 'transports', 'acp', 'fake-agent.cjs');
  // A neutral fixture def whose auth probe is the ACP session itself (P-45): no built-in carries
  // one today (P-47), so the session probe's discovery contract is pinned with fixture data.
  const acpProbeDef = (): ProviderDef =>
    defOf({
      id: 'p-x',
      displayName: 'Probe CLI',
      bins: ['p-x'],
      helpArgs: undefined,
      optionalFlags: undefined,
      authProbe: {
        args: ['acp'],
        acpSession: { notLoggedIn: { rpcCode: -32603, textContains: 'not connected to any inference provider' } },
      },
    });
  /** A stand-in CLI: a multi-line --version answer and the fake ACP agent behind `acp`. */
  const writeProbeCli = (dir: string, scenario: string): string =>
    writeBin(
      `${dir}/p-x`,
      `case "$1" in
  --version)
    echo "Probe Agent v0.21.4 (2026.9.21)"
    echo "Install directory: /somewhere"
    exit 0
    ;;
  acp)
    exec "${process.execPath}" "${FAKE_AGENT}" ${scenario} "${join(root, dir, 'agent-log.jsonl')}"
    ;;
esac
exit 0`,
    );

  it('P-45: discovery reads the version from the first line and the login from an ACP session, with no ambient credential in the child', async () => {
    for (const [scenario, expected] of [
      ['models-cursor', true],
      ['session-login-refused', false],
      ['session-internal-error', null],
    ] as const) {
      const bin = writeProbeCli(`acp-probe-${scenario}`, scenario);
      const { discovery, calls } = makeDiscovery(
        [acpProbeDef()],
        { PATH: EMPTY_PATH(), DOCKET_P_X_BIN: bin, OPENAI_API_KEY: 'sk-ambient', HOME: HOME() },
        { probeTimeoutMs: 5000 },
      );
      const found = await collect(discovery);
      expect(found[0], scenario).toMatchObject({
        defId: 'p-x',
        binPath: bin,
        version: 'Probe Agent v0.21.4 (2026.9.21)',
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

describe('logged-out text login probe', () => {
  it('G1: only the documented text with exit 0 reads as logged out; every other answer is unknown, never logged in', async () => {
    const authProbe: NonNullable<ProviderDef['authProbe']> = { args: ['status'], parse: 'logged-out-text', loggedOutText: 'Not logged in' };
    const body = (answer: string, exit = 0): string =>
      `case "$1" in\n  --version) echo "probe 5.2.1 (bb491ce)"; exit 0;;\n  status) echo "${answer}"; exit ${exit};;\nesac\nexit 0`;
    const def = defOf({ id: 'p-x', bins: ['p-x'], helpArgs: undefined, optionalFlags: undefined, authProbe });
    for (const [answer, exit, expected] of [
      ['Not logged in.', 0, false],
      ['Logged in as someone', 0, null],
      ['Not logged in.', 1, null],
    ] as const) {
      writeBin('home/.local/bin/p-x', body(answer, exit));
      const { discovery, calls } = makeDiscovery([def], { PATH: EMPTY_PATH() }, { probeTimeoutMs: 2000 });
      const results = await collect(discovery);
      expect(results[0]?.loggedIn, `${answer} / exit ${exit}`).toBe(expected);
      expect(calls.map((call) => call.args[0]).filter((arg) => arg === 'login' || arg === 'logout')).toEqual([]);
    }
  });
});

describe('credential-count login probe', () => {
  it('G1: "<N> credentials" gives logged in for N > 0, not logged in for 0, and unknown for anything else', () => {
    const ESC = String.fromCharCode(27);
    expect(loggedInFromCredentialCount('0 credentials')).toBe(false);
    expect(loggedInFromCredentialCount('3 credentials')).toBe(true);
    expect(loggedInFromCredentialCount('1 credential')).toBe(true);
    expect(loggedInFromCredentialCount('garbage')).toBeNull();
    expect(loggedInFromCredentialCount('')).toBeNull();
    // Colour codes and a leading INFO log line surround the real answer.
    const noisy = `INFO  2026-10-02T18:27:53 +49ms service=default\n${ESC}[0m\n\u250c  Credentials ${ESC}[90m~/.local/share/probe/auth.json\n\u2502\n\u2514  ${ESC}[0m2 credentials\n`;
    expect(loggedInFromCredentialCount(noisy)).toBe(true);
    expect(loggedInFromCredentialCount(noisy.replace('2 credentials', '0 credentials'))).toBe(false);
  });

  it('G1: a definition probing `auth list` reads the count, never an exit code alone', async () => {
    const authProbe: NonNullable<ProviderDef['authProbe']> = { args: ['auth', 'list'], parse: 'credential-count' };
    const body = (answer: string, exit = 0): string =>
      `case "$1" in\n  --version) echo "7.8.3"; exit 0;;\n  auth) echo "INFO log line"; echo "${answer}"; exit ${exit};;\nesac\nexit 0`;
    const def = defOf({
      id: 'p-x',
      bins: ['p-x'],
      helpArgs: undefined,
      optionalFlags: undefined,
      authProbe,
    });
    for (const [answer, exit, expected] of [
      ['0 credentials', 0, false],
      ['3 credentials', 0, true],
      ['nothing useful', 0, null],
      ['3 credentials', 1, null],
    ] as const) {
      writeBin('home/.local/bin/p-x', body(answer, exit));
      const { discovery } = makeDiscovery([def], { PATH: EMPTY_PATH() }, { probeTimeoutMs: 2000 });
      const results = await collect(discovery);
      expect(results[0]?.loggedIn, `${answer} / exit ${exit}`).toBe(expected);
    }
  });
});

describe('logged-in-json login probe (claude-code)', () => {
  // The CLI's own `auth status` answer, in the shape 2.1.287 prints (six fields, fixture values
  // only): just the loggedIn boolean is read, never another field.
  const LOGGED_IN = JSON.stringify({
    loggedIn: true,
    authMethod: 'claude.ai',
    apiProvider: 'anthropic',
    analyticsDisabled: true,
    projectsDirectory: '/tmp/fixture/projects',
    configDirectory: '/tmp/fixture/.claude-anthropic',
  });
  const LOGGED_OUT = JSON.stringify({
    loggedIn: false,
    authMethod: 'none',
    apiProvider: 'anthropic',
    analyticsDisabled: true,
    projectsDirectory: '/tmp/fixture/projects',
    configDirectory: '/tmp/fixture/.claude',
  });

  it('G1: the loggedIn boolean is the answer; anything else is unknown', () => {
    expect(loggedInFromAuthStatus(LOGGED_IN)).toBe(true);
    expect(loggedInFromAuthStatus(LOGGED_OUT)).toBe(false);
    expect(loggedInFromAuthStatus('')).toBeNull();
    expect(loggedInFromAuthStatus('not json')).toBeNull();
    expect(loggedInFromAuthStatus('{"authMethod": "oauth_token"}')).toBeNull();
    expect(loggedInFromAuthStatus('{"loggedIn": "yes"}')).toBeNull();
    expect(loggedInFromAuthStatus('["loggedIn"]')).toBeNull();
  });

  it('G1: the claude-code definition probes `claude auth status` and reads the JSON on either exit code', async () => {
    const claude = BUILTIN_PROVIDER_DEFS.find((def) => def.id === 'claude-code');
    expect(claude?.authProbe).toEqual({ args: ['auth', 'status'], parse: 'logged-in-json' });
    // The JSON answer is one line, so echo (a shell builtin) carries it; the probe environment
    // resolves no external command on purpose.
    const body = (answer: string, exit: number): string =>
      `case "$1" in\n  --version) echo "2.1.287-fake"; exit 0;;\n  --help) echo "Usage: claude [options]"; exit 0;;\n  auth) echo '${answer}'; exit ${exit};;\nesac\nexit 0`;
    const def = defOf({
      id: 'claude-like',
      bins: ['claude-like'],
      helpArgs: undefined,
      optionalFlags: undefined,
      authProbe: claude?.authProbe,
    });
    for (const [answer, exit, expected] of [
      [LOGGED_IN, 0, true],
      [LOGGED_OUT, 1, false],
      ['garbage', 0, null],
    ] as const) {
      writeBin('home/.local/bin/claude-like', body(answer, exit));
      const { discovery, calls } = makeDiscovery([def], { PATH: EMPTY_PATH() }, { probeTimeoutMs: 2000 });
      const results = await collect(discovery);
      expect(results[0]?.loggedIn, `exit ${exit}`).toBe(expected);
      expect(calls.some((call) => call.args.join(' ') === 'auth status')).toBe(true);
    }
  });

  it('P-44: the probe answers for the environment the CLI would see — an ambient config directory rides the spawn verbatim', async () => {
    const claude = BUILTIN_PROVIDER_DEFS.find((def) => def.id === 'claude-code');
    const def = defOf({
      id: 'claude-like',
      bins: ['claude-like'],
      helpArgs: undefined,
      optionalFlags: undefined,
      authProbe: claude?.authProbe,
    });
    const body = (answer: string, exit: number): string =>
      `case "$1" in\n  --version) echo "2.1.287-fake"; exit 0;;\n  auth) echo '${answer}'; exit ${exit};;\nesac\nexit 0`;
    writeBin('home/.local/bin/claude-like', body(LOGGED_IN, 0));
    const { discovery, calls } = makeDiscovery(
      [def],
      { PATH: EMPTY_PATH(), CLAUDE_CONFIG_DIR: '/tmp/fixture/ambient-config' },
      { probeTimeoutMs: 2000 },
    );
    const results = await collect(discovery);

    // The machine login lives where the CLI's own override variable points, so the probe must
    // read exactly that environment — never a stripped one — and its boolean is the answer.
    const probe = calls.find((call) => call.args.join(' ') === 'auth status');
    expect(probe?.options.env.CLAUDE_CONFIG_DIR).toBe('/tmp/fixture/ambient-config');
    expect(results[0]?.loggedIn).toBe(true);
  });
});

describe('logged-in-json login probe (snake_case answer)', () => {
  // A snake_case `logged_in` answer of the shape a CLI's own status command prints: only the
  // boolean is read, never the fields beside it.
  const LOGGED_IN = JSON.stringify({ logged_in: true, version: '1.1.65-fake', allow_byok: 0 });
  const LOGGED_OUT = JSON.stringify({ logged_in: false, version: '1.1.65-fake', allow_byok: 0 });

  it('G1: the logged_in boolean is the answer; anything else is unknown', () => {
    expect(loggedInFromAuthStatus(LOGGED_IN)).toBe(true);
    expect(loggedInFromAuthStatus(LOGGED_OUT)).toBe(false);
    expect(loggedInFromAuthStatus('{"version": "1.1.65-fake", "allow_byok": 0}')).toBeNull();
    expect(loggedInFromAuthStatus('{"logged_in": "yes"}')).toBeNull();
    expect(loggedInFromAuthStatus('not json')).toBeNull();
  });

  it('G1: a definition whose probe carries its own env answers with that env in the child, so no browser can open', async () => {
    // The authProbe env is the mechanism (P-45): a probe that would otherwise open a browser is
    // pinned to a headless value. No built-in carries one today (P-47); fixture data drives it.
    const authProbe: NonNullable<ProviderDef['authProbe']> = { args: ['status', '-o', 'json'], parse: 'logged-in-json', env: { CI: '1' } };
    // The staged CLI refuses to answer without CI=1, so the probe's environment is under test too.
    const body = (answer: string): string =>
      `case "$1" in\n  --version) echo "1.1.65-fake"; exit 0;;\n  --help) echo "Usage: probe [options]"; exit 0;;\n  status) [ "$CI" = "1" ] || exit 9; echo '${answer}'; exit 0;;\nesac\nexit 0`;
    const def = defOf({
      id: 'p-x',
      bins: ['p-x'],
      helpArgs: undefined,
      optionalFlags: undefined,
      authProbe,
    });
    for (const [answer, expected] of [
      [LOGGED_IN, true],
      [LOGGED_OUT, false],
      ['garbage', null],
    ] as const) {
      writeBin('home/.local/bin/p-x', body(answer));
      const { discovery, calls } = makeDiscovery([def], { PATH: EMPTY_PATH() }, { probeTimeoutMs: 2000 });
      const results = await collect(discovery);
      expect(results[0]?.loggedIn, answer).toBe(expected);
      const probe = calls.find((call) => call.args.join(' ') === 'status -o json');
      expect(probe).toBeDefined();
      expect(probe?.options.env['CI']).toBe('1');
    }
  });
});

describe('provider-key login probe', () => {
  const doctor = (...flags: readonly unknown[]): string =>
    JSON.stringify({ version: 'v1', providers: flags.map((key_present) => ({ name: 'p', key_present, api_key_env: 'SOME_ENV' })) });

  it('G1: one configured key is a login, all absent is none, and an unreadable answer is unknown', () => {
    expect(loggedInFromProviderKeys(doctor(true, false))).toBe(true);
    expect(loggedInFromProviderKeys(doctor(false, true))).toBe(true);
    expect(loggedInFromProviderKeys(doctor(false, false))).toBe(false);
    expect(loggedInFromProviderKeys(doctor(true))).toBe(true);
    expect(loggedInFromProviderKeys(doctor(false, 'yes'))).toBeNull();
    expect(loggedInFromProviderKeys(doctor())).toBeNull();
    expect(loggedInFromProviderKeys('garbage')).toBeNull();
    expect(loggedInFromProviderKeys('')).toBeNull();
    expect(loggedInFromProviderKeys('[]')).toBeNull();
    expect(loggedInFromProviderKeys('{"providers":"x"}')).toBeNull();
    expect(loggedInFromProviderKeys('{}')).toBeNull();
  });

  it('G1: a definition probing `doctor --json` runs it once, never runs setup, and reads only the booleans', async () => {
    const authProbe: NonNullable<ProviderDef['authProbe']> = { args: ['doctor', '--json'], parse: 'provider-key-present' };
    const def = defOf({ id: 'p-x', bins: ['p-x'], helpArgs: undefined, optionalFlags: undefined, authProbe });
    const body = (answer: string, exit = 0): string =>
      `case "$1" in\n  --version) echo "probe v1.39.7"; exit 0;;\n  doctor) echo '${answer}'; exit ${exit};;\nesac\nexit 0`;
    for (const [answer, exit, expected] of [
      [doctor(false, false), 0, false],
      [doctor(false, true), 0, true],
      ['not json', 0, null],
      [doctor(true), 1, null],
    ] as const) {
      writeBin('home/.local/bin/p-x', body(answer, exit));
      const { discovery, calls } = makeDiscovery([def], { PATH: EMPTY_PATH() }, { probeTimeoutMs: 2000 });
      const results = await collect(discovery);
      expect(results[0]?.loggedIn, `${answer} / exit ${exit}`).toBe(expected);
      expect(results[0]?.version).toBe('probe v1.39.7');
      expect(calls.map((call) => call.args)).toEqual([['--version'], ['doctor', '--json']]);
    }
  });
});

describe('credential-file presence login probe', () => {
  // A neutral fixture def whose login state is the presence of a credential file under the CLI's
  // home (P-45): no built-in carries one today (P-47), so the mechanism stays driven by fixture
  // data — presence only, the file is never opened.
  const presenceDef = (): ProviderDef =>
    defOf({
      id: 'p-x',
      bins: ['p-x'],
      helpArgs: undefined,
      optionalFlags: undefined,
      authProbe: { args: [], presenceFile: { homeEnv: 'P_X_HOME', homeDir: '.p-x', file: 'auth.json' } },
    });
  const probeHome = (): string => join(HOME(), '.p-x');
  const clearProbeHome = (): void => rmSync(probeHome(), { recursive: true, force: true });
  const discoverPresence = async (env: Readonly<Record<string, string>>): Promise<{ readonly loggedIn: boolean | null | undefined; readonly calls: SpawnCall[] }> => {
    writeBin('home/.local/bin/p-x', 'case "$1" in\n  --version) echo "1.0.46"; exit 0;;\nesac\nexit 3');
    const { discovery, calls } = makeDiscovery([presenceDef()], { PATH: EMPTY_PATH(), ...env }, { probeTimeoutMs: 2000 });
    const results = await collect(discovery);
    return { loggedIn: results[0]?.loggedIn, calls };
  };

  it('G1: auth.json under the default home is a login, its absence is not, and the CLI is spawned only for its version', async () => {
    clearProbeHome();
    const absent = await discoverPresence({});
    expect(absent.loggedIn).toBe(false);

    mkdirSync(probeHome(), { recursive: true });
    // Content is never read: the file holds nothing parseable and the answer is the same.
    writeFileSync(join(probeHome(), 'auth.json'), 'not json');
    const present = await discoverPresence({});
    expect(present.loggedIn).toBe(true);
    expect(present.calls.map((call) => call.args)).toEqual([['--version']]);
    clearProbeHome();
  });

  it('G1: the home override redirects the probe, and an ambient API key is not a login', async () => {
    const elsewhere = join(root, 'presence-elsewhere');
    mkdirSync(elsewhere, { recursive: true });
    clearProbeHome();
    mkdirSync(probeHome(), { recursive: true });
    writeFileSync(join(probeHome(), 'auth.json'), '{}');

    // The override names a home without the file: the default home's file no longer counts.
    expect((await discoverPresence({ P_X_HOME: elsewhere })).loggedIn).toBe(false);
    writeFileSync(join(elsewhere, 'auth.json'), '{}');
    expect((await discoverPresence({ P_X_HOME: elsewhere })).loggedIn).toBe(true);

    clearProbeHome();
    expect((await discoverPresence({ XAI_API_KEY: 'xai-ambient' })).loggedIn).toBe(false);
  });
});

describe('credentials-directory presence login probe', () => {
  // A neutral fixture def whose login state is the presence of any file under a credentials
  // directory of the CLI's home (P-45): no built-in carries one today (P-47), so the mechanism
  // stays driven by fixture data — presence only, nothing is ever opened.
  const presenceDirDef = (): ProviderDef =>
    defOf({
      id: 'p-x',
      bins: ['p-x'],
      helpArgs: undefined,
      optionalFlags: undefined,
      authProbe: { args: [], presenceDir: { homeEnv: 'P_X_HOME', homeDir: '.p-x', dir: 'credentials' } },
    });
  const discoverPresence = async (env: Readonly<Record<string, string>>): Promise<{ readonly loggedIn: boolean | null | undefined; readonly calls: SpawnCall[] }> => {
    writeBin('home/.local/bin/p-x', 'case "$1" in\n  --version) echo "2.1.1"; exit 0;;\nesac\nexit 3');
    const { discovery, calls } = makeDiscovery([presenceDirDef()], { PATH: EMPTY_PATH(), ...env }, { probeTimeoutMs: 2000 });
    const results = await collect(discovery);
    return { loggedIn: results[0]?.loggedIn, calls };
  };
  const credentialsHome = (): string => join(HOME(), '.p-x');
  const clearCredentialsHome = (): void => rmSync(credentialsHome(), { recursive: true, force: true });

  it('G1: a file under the default home\'s credentials directory is a login, its absence and an empty directory are not, and the CLI is spawned only for its version', async () => {
    clearCredentialsHome();
    const absent = await discoverPresence({});
    expect(absent.loggedIn).toBe(false);

    // The file name after login is not documented, so the probe reads presence only: a file of
    // any name and any unparseable content answers the same, because content is never read.
    mkdirSync(join(credentialsHome(), 'credentials'), { recursive: true });
    const empty = await discoverPresence({});
    expect(empty.loggedIn).toBe(false);

    writeFileSync(join(credentialsHome(), 'credentials', 'oauth.json'), 'not json');
    const present = await discoverPresence({});
    expect(present.loggedIn).toBe(true);
    expect(present.calls.map((call) => call.args)).toEqual([['--version']]);
    clearCredentialsHome();
  });

  it('G1: the home override redirects the probe, and the default home\'s credentials no longer count', async () => {
    const elsewhere = join(root, 'credentials-elsewhere');
    mkdirSync(join(elsewhere, 'credentials'), { recursive: true });
    clearCredentialsHome();
    mkdirSync(join(credentialsHome(), 'credentials'), { recursive: true });
    writeFileSync(join(credentialsHome(), 'credentials', 'oauth.json'), '{}');

    // The override names a home whose credentials directory holds no file: the default home's
    // login no longer counts, and once a file lands there it does.
    expect((await discoverPresence({ P_X_HOME: elsewhere })).loggedIn).toBe(false);
    writeFileSync(join(elsewhere, 'credentials', 'oauth.json'), '{}');
    expect((await discoverPresence({ P_X_HOME: elsewhere })).loggedIn).toBe(true);

    rmSync(elsewhere, { recursive: true, force: true });
    clearCredentialsHome();
  });
});

describe('whoami login probe', () => {
  it('P-45: the whoami login probe reads only the account key — null is logged out, a populated account logged in, anything else unknown', () => {
    // The logged-out shape is a recorded live answer; the logged-in shape is unverified, so a
    // populated object of any fields is the login and nothing inside it is ever read.
    expect(loggedInFromWhoami('{"account":null}')).toBe(false);
    expect(loggedInFromWhoami('{"account":{"id":"builder-1"}}')).toBe(true);
    expect(loggedInFromWhoami('')).toBeNull();
    expect(loggedInFromWhoami('Not logged in')).toBeNull();
    expect(loggedInFromWhoami('{"other":null}')).toBeNull();
    // An account that is neither null nor an object names no state Docket can read.
    expect(loggedInFromWhoami('{"account":"builder-1"}')).toBeNull();
  });

  it('G1: a definition probing `whoami -f json` runs it once and reads the account key, never a login flow', async () => {
    const authProbe: NonNullable<ProviderDef['authProbe']> = { args: ['whoami', '-f', 'json'], parse: 'account-null-json' };
    const def = defOf({ id: 'p-x', bins: ['p-x'], helpArgs: undefined, optionalFlags: undefined, authProbe });
    writeBin(
      'whoami-path/p-x',
      'case "$1" in\n  --version) echo "p-x 2.27.0"; exit 0;;\n  whoami) echo \'{"account":null}\'; exit 0;;\nesac\nexit 0',
    );
    const { discovery, calls } = makeDiscovery([def], {
      PATH: join(root, 'whoami-path'),
      HOME: HOME(),
    });

    const results = await collect(discovery);

    expect(results[0]).toMatchObject({ defId: 'p-x', binPath: join(root, 'whoami-path', 'p-x'), version: 'p-x 2.27.0', loggedIn: false, optionalFlags: [] });
    expect(calls.map((call) => call.args)).toEqual([['--version'], ['whoami', '-f', 'json']]);
  });
});

describe('agent delegate resolution', () => {
  // A neutral fixture def whose wrapper delegates to a chat binary under the home (P-4): no
  // built-in carries one today (P-47), so the delegate mechanism stays driven by fixture data.
  const delegateDef = (): ProviderDef =>
    defOf({
      id: 'p-x',
      displayName: 'Probe CLI',
      bins: ['p-x'],
      helpArgs: undefined,
      optionalFlags: undefined,
      authProbe: { args: ['whoami', '-f', 'json'], parse: 'account-null-json' },
      agentDelegate: { homeEnv: 'HOME', relativePath: '.local/bin/p-x-chat' },
    });
  const stageWrapper = (): string => {
    writeBin('wrapper-path/p-x', 'case "$1" in\n  --version) echo "p-x 2.27.0"; exit 0;;\n  whoami) echo \'{"account":null}\'; exit 0;;\nesac\nexit 0');
    return join(root, 'wrapper-path');
  };

  it('P-4: a wrapper whose agent delegate is missing reports the provider unusable — binPath null and nothing spawned', async () => {
    const path = stageWrapper();
    const home = join(root, 'delegate-broken-home'); // no .local/bin/p-x-chat
    mkdirSync(home, { recursive: true });

    const { discovery, calls } = makeDiscovery([delegateDef()], { PATH: path, HOME: home });
    const results = await collect(discovery);

    // Exactly the not-found shape: the install hint is the user's remedy, and Docket never runs
    // the CLI's own setup or doctor to repair it.
    expect(results[0]).toEqual({ defId: 'p-x', name: expect.any(String), installUrl: expect.any(String), binPath: null, version: null, loggedIn: null, optionalFlags: [] });
    expect(calls).toEqual([]);
  });

  it('P-4: the delegate present, the wrapper answers the shared probes normally', async () => {
    const path = stageWrapper();
    const home = join(root, 'delegate-working-home');
    mkdirSync(join(home, '.local', 'bin'), { recursive: true });
    writeFileSync(join(home, '.local', 'bin', 'p-x-chat'), 'unused');

    const { discovery } = makeDiscovery([delegateDef()], { PATH: path, HOME: home });
    const results = await collect(discovery);

    expect(results[0]?.binPath).toBe(join(path, 'p-x'));
    expect(results[0]?.version).toBe('p-x 2.27.0');
    expect(results[0]?.loggedIn).toBe(false);
  });

  it('P-2: an override pointing straight at the delegate binary is self-sufficient — no delegate check applies', async () => {
    const chat = writeBin('app-bundle/p-x-chat', 'case "$1" in\n  --version) echo "p-x-chat 2.27.0"; exit 0;;\n  whoami) echo \'{"account":null}\'; exit 0;;\nesac\nexit 0');
    const home = join(root, 'delegate-override-home'); // no .local/bin/p-x-chat
    mkdirSync(home, { recursive: true });

    const { discovery } = makeDiscovery([delegateDef()], { PATH: EMPTY_PATH(), HOME: home, DOCKET_P_X_BIN: chat });
    const results = await collect(discovery);

    expect(results[0]?.binPath).toBe(chat);
    expect(results[0]?.version).toBe('p-x-chat 2.27.0');
  });
});
