// Path discovery: overrides, PATH + toolchain search, streamed probes.
// Contract: docs/v2/providers.md → "Discovery (P-2 … P-6)". Only the spawn function is injected;
// the file system is consulted directly, so tests stage real binaries in throwaway trees.
import type { ChildProcess } from 'node:child_process';
import { accessSync, constants } from 'node:fs';
import { readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import type { DiscoveredProvider, ProviderDiscovery } from '../../../application/index';
import type { ProviderDef } from '../defs/index';
import { buildChildEnv } from '../launch/index';
import { probeAcpLogin } from '../transports/acp/index';

const DEFAULT_PROBE_TIMEOUT_MS = 10_000;

/** The narrow spawn surface the prober needs; the real node spawn satisfies it directly. */
export type ProbeSpawn = (
  command: string,
  args: readonly string[],
  options: { readonly timeout: number; readonly env: Readonly<Record<string, string>> },
) => ChildProcess;

export interface PathDiscoveryOptions {
  /** How long a single probe may run before it is killed and its field is left null. */
  readonly probeTimeoutMs?: number;
}

interface ProbeOutcome {
  readonly exitCode: number | null; // null = killed early, spawn error, or never ran
  readonly timedOut: boolean;
  readonly stdout: string;
  readonly stderr: string;
}

const isExecutableFile = (path: string): boolean => {
  try {
    return statSync(path).isFile() && accessSync(path, constants.X_OK) === undefined;
  } catch {
    return false;
  }
};

const isDirectory = (path: string): boolean => {
  try {
    return statSync(path).isDirectory();
  } catch {
    return false;
  }
};

/** `<parent>/<version-or-shell-id>/bin` — the shape nvm version dirs and fnm multishells share. */
const scopedNodeBins = (parent: string): readonly string[] => {
  try {
    return readdirSync(parent).map((name) => join(parent, name, 'bin')).filter(isDirectory);
  } catch {
    return [];
  }
};

const toolchainDirs = (env: Readonly<Record<string, string>>, homedir: string): readonly string[] => {
  const dataHome = env.XDG_DATA_HOME ?? join(homedir, '.local', 'share');
  return [
    '/opt/homebrew/bin', // Homebrew on Apple silicon
    '/usr/local/bin', // Homebrew on Intel; also npm's default global prefix bin
    join(homedir, '.local', 'bin'),
    join(homedir, '.bun', 'bin'),
    join(env.NPM_CONFIG_PREFIX ?? env.npm_config_prefix ?? '/usr/local', 'bin'),
    join(dataHome, 'mise', 'shims'),
    ...scopedNodeBins(join(env.NVM_DIR ?? join(homedir, '.nvm'), 'versions', 'node')),
    ...scopedNodeBins(join(dataHome, 'fnm_multishells')),
    ...scopedNodeBins(join(env.FNM_DIR ?? join(dataHome, 'fnm'), 'multishells')),
  ];
};

const enrichedPathEntries = (env: Readonly<Record<string, string>>, homedir: string): readonly string[] => {
  const entries: string[] = [];
  for (const dir of [...(env.PATH ?? '').split(':'), ...toolchainDirs(env, homedir)]) {
    if (dir !== '' && !entries.includes(dir)) entries.push(dir);
  }
  return entries;
};

const overrideEnvName = (defId: string): string => `DOCKET_${defId.toUpperCase().replaceAll('-', '_')}_BIN`;

const resolveBinPath = (
  def: ProviderDef,
  env: Readonly<Record<string, string>>,
  dirs: readonly string[],
): string | null => {
  const override = env[overrideEnvName(def.id)];
  if (override !== undefined) {
    // The override is a commitment to exactly one file: it wins, and a missing file never falls back.
    return isExecutableFile(override) ? override : null;
  }
  for (const bin of def.bins) {
    for (const dir of dirs) {
      const candidate = join(dir, bin);
      if (isExecutableFile(candidate)) return candidate;
    }
  }
  return null;
};

const runProbe = (
  spawn: ProbeSpawn,
  command: string,
  args: readonly string[],
  timeoutMs: number,
  env: Readonly<Record<string, string>>,
): Promise<ProbeOutcome> =>
  new Promise((resolve) => {
    let child: ChildProcess;
    try {
      child = spawn(command, args, { timeout: timeoutMs, env });
    } catch {
      resolve({ exitCode: null, timedOut: false, stdout: '', stderr: '' });
      return;
    }
    let stdout = '';
    let stderr = '';
    let timedOut = false;
    let settled = false;
    const finish = (exitCode: number | null): void => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      resolve({ exitCode, timedOut, stdout, stderr });
    };
    // The injected spawn is asked to time out too; this timer is the backstop for one that ignores it.
    const timer = setTimeout(() => {
      timedOut = true;
      child.kill('SIGKILL');
    }, timeoutMs);
    child.stdout?.setEncoding('utf8');
    child.stderr?.setEncoding('utf8');
    child.stdout?.on('data', (chunk: string) => {
      stdout += chunk;
    });
    child.stderr?.on('data', (chunk: string) => {
      stderr += chunk;
    });
    child.on('error', () => finish(null));
    child.on('close', (code) => finish(code));
  });

const firstLine = (text: string): string | null => {
  for (const line of text.split('\n')) {
    const trimmed = line.trim();
    if (trimmed !== '') return trimmed;
  }
  return null;
};

const probeVersion = (
  spawn: ProbeSpawn,
  def: ProviderDef,
  binPath: string,
  timeoutMs: number,
  env: Readonly<Record<string, string>>,
): Promise<string | null> =>
  runProbe(spawn, binPath, [...def.versionArgs], timeoutMs, env).then((outcome) =>
    outcome.exitCode === 0 ? firstLine(outcome.stdout) : null,
  );

const probeOptionalFlags = async (
  spawn: ProbeSpawn,
  def: ProviderDef,
  binPath: string,
  timeoutMs: number,
  env: Readonly<Record<string, string>>,
): Promise<readonly string[]> => {
  if (def.helpArgs === undefined || def.optionalFlags === undefined) return [];
  const outcome = await runProbe(spawn, binPath, [...def.helpArgs], timeoutMs, env);
  if (outcome.timedOut || outcome.exitCode === null) return [];
  // Help output may land on either stream, and many CLIs exit non-zero for --help: scan regardless.
  const combined = `${outcome.stdout}\n${outcome.stderr}`;
  return Object.keys(def.optionalFlags).filter((flag) => combined.includes(flag));
};

const probeAuth = async (
  spawn: ProbeSpawn,
  def: ProviderDef,
  binPath: string,
  timeoutMs: number,
  env: Readonly<Record<string, string>>,
): Promise<boolean | null> => {
  if (def.authProbe === undefined) return null;
  if (def.authProbe.acpSession !== undefined) {
    // The ACP session is the login signal: the child gets the same allowlisted environment a run
    // builds, so an ambient credential of another account never counts as this machine's login.
    return probeAcpLogin({
      command: binPath,
      args: def.authProbe.args,
      env: buildChildEnv(def.id, env, {}),
      rule: def.authProbe.acpSession.notLoggedIn,
      timeoutMs,
      spawn: (command, args, options) => spawn(command, args, { timeout: timeoutMs, env: options.env ?? env }),
    });
  }
  const outcome = await runProbe(spawn, binPath, [...def.authProbe.args], timeoutMs, env);
  if (outcome.timedOut || outcome.exitCode === null) return null;
  return outcome.exitCode === 0; // exit 0 = logged in; any completed non-zero exit is a real answer
};

export function createPathDiscovery(
  defs: readonly ProviderDef[],
  spawn: ProbeSpawn,
  env: Readonly<Record<string, string>>,
  homedir: string,
  options?: PathDiscoveryOptions,
): ProviderDiscovery {
  const timeoutMs = options?.probeTimeoutMs ?? DEFAULT_PROBE_TIMEOUT_MS;

  const discoverDef = async (
    spawnFn: ProbeSpawn,
    dirs: readonly string[],
    probeEnv: Readonly<Record<string, string>>,
    def: ProviderDef,
  ): Promise<DiscoveredProvider> => {
    const binPath = resolveBinPath(def, env, dirs);
    if (binPath === null) {
      return { defId: def.id, binPath: null, version: null, loggedIn: null, optionalFlags: [] };
    }
    // Probes run in sequence on exactly the path that will be spawned; each carries its own timeout.
    const version = await probeVersion(spawnFn, def, binPath, timeoutMs, probeEnv);
    // A command that may open a browser or start a login flow runs only once the login probe
    // answered `true`; `false` and `null` (unknown) both keep it from starting.
    let loggedIn: boolean | null;
    let optionalFlags: readonly string[];
    if (def.helpNeedsLogin === true) {
      loggedIn = await probeAuth(spawnFn, def, binPath, timeoutMs, probeEnv);
      optionalFlags = loggedIn === true ? await probeOptionalFlags(spawnFn, def, binPath, timeoutMs, probeEnv) : [];
    } else {
      optionalFlags = await probeOptionalFlags(spawnFn, def, binPath, timeoutMs, probeEnv);
      loggedIn = await probeAuth(spawnFn, def, binPath, timeoutMs, probeEnv);
    }
    return { defId: def.id, binPath, version, loggedIn, optionalFlags };
  };

  return {
    discover: async (onResult): Promise<void> => {
      const dirs = enrichedPathEntries(env, homedir);
      const probeEnv: Readonly<Record<string, string>> = { ...env, PATH: dirs.join(':') };
      // One independent chain per provider: each entry reports as soon as its own probes finish,
      // so a slow or hanging binary delays only its own result.
      await Promise.all(
        defs.map(async (def) => {
          onResult(await discoverDef(spawn, dirs, probeEnv, def));
        }),
      );
    },
  };
}
