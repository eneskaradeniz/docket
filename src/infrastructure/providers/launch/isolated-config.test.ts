// P-7 — launch isolation: everything a run writes stays inside the run's own directory, and the
// user's own CLI config trees (~/.claude, ~/.codex) stay byte-identical across a launch.
import { mkdir, mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { buildChildEnv } from './launch-env';
import { BUILTIN_PROVIDER_DEFS } from '../defs';
import type { ProviderDef } from '../defs';
import { writeRunConfig } from './isolated-config';
import type { RunCapability } from './isolated-config';

const scratchRoots: string[] = [];

afterEach(async () => {
  await Promise.all(scratchRoots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

/** Credential-looking fixture bytes are assembled at runtime, never written as one literal. */
const sentinelBytes = (label: string): string => `${label} :: token-${'x'.repeat(24)}\n`;

/** A fake HOME carrying sentinel copies of the CLI config trees Docket must never touch. */
async function createSentinelHome(root: string): Promise<string> {
  const home = join(root, 'home');
  const files: readonly (readonly string[])[] = [
    ['.claude', 'settings.json'],
    ['.claude', 'credentials.json'],
    ['.claude', 'projects', 'session-a.jsonl'],
    ['.codex', 'config.toml'],
    ['.codex', 'auth.json'],
    ['.gitconfig'],
  ];
  for (const segments of files) {
    const file = join(home, ...segments);
    await mkdir(dirname(file), { recursive: true });
    await writeFile(file, sentinelBytes(segments.join('/')), 'utf8');
  }
  return home;
}

/** Every file under root as `path → base64 bytes`; directories carry a trailing slash marker. */
async function snapshotTree(root: string): Promise<Map<string, string>> {
  const snapshot = new Map<string, string>();
  const walk = async (dir: string, prefix: string): Promise<void> => {
    for (const entry of await readdir(dir, { withFileTypes: true })) {
      const rel = prefix === '' ? entry.name : `${prefix}/${entry.name}`;
      if (entry.isDirectory()) {
        snapshot.set(`${rel}/`, '');
        await walk(join(dir, entry.name), rel);
      } else if (entry.isFile()) {
        snapshot.set(rel, (await readFile(join(dir, entry.name))).toString('base64'));
      }
    }
  };
  await walk(root, '');
  return snapshot;
}

async function createRoot(): Promise<{ root: string; runDir: string }> {
  const root = await mkdtemp(join(tmpdir(), 'docket-launch-'));
  scratchRoots.push(root);
  // The run dir sits directly under the root so the snapshot diff can name its prefix exactly.
  return { root, runDir: join(root, 'run-1') };
}

function defById(id: string): ProviderDef {
  const def = BUILTIN_PROVIDER_DEFS.find((candidate) => candidate.id === id);
  if (def === undefined) throw new Error(`missing built-in def ${id}`);
  return def;
}

/** A def for a CLI that takes its config dir as a flag — no built-in rides this mechanism yet. */
function flagDef(): ProviderDef {
  const base = defById('copilot');
  return {
    ...base,
    id: 'flag-probe',
    config: { mechanism: 'flag', name: '--mcp-config' },
    buildLaunch: (input) => ({ args: ['--mcp-config', input.configDir], env: {}, stdin: 'prompt' }),
  };
}

const RUN_CAPABILITIES: readonly RunCapability[] = [
  {
    kind: 'mcp',
    id: 'filesystem',
    name: 'Filesystem',
    command: 'npx',
    args: ['-y', 'fs-server'],
    env: { ROOT: '/repo/main' },
  },
  { kind: 'mcp', id: 'github', name: 'GitHub', command: 'gh-mcp', args: [], env: {} },
  { kind: 'skill', id: 'review', name: 'Review skill', path: '/library/skills/review' },
  { kind: 'hook', id: 'block-writes', name: 'Block writes', event: 'before_tool', command: 'docket-hook block' },
];

describe('run-scoped config writer (P-7)', () => {
  it('P-7: everything the writer produces stays inside the run directory', async () => {
    const { root, runDir } = await createRoot();
    const home = await createSentinelHome(root);
    const before = await snapshotTree(root);

    const previousHome = process.env.HOME;
    process.env.HOME = home;
    try {
      for (const def of [...BUILTIN_PROVIDER_DEFS, flagDef()]) {
        const fragment = await writeRunConfig(runDir, def, RUN_CAPABILITIES);
        expect(fragment.configDir.startsWith(runDir), def.id).toBe(true);
      }
    } finally {
      process.env.HOME = previousHome;
    }

    const after = await snapshotTree(root);
    expect(after.size).toBeGreaterThan(before.size);
    for (const [path, bytes] of after) {
      if (before.get(path) === bytes) continue;
      expect(path.startsWith('run-1/'), `${path} changed outside the run directory`).toBe(true);
    }
  });

  it('P-7: sentinel CLI config trees under a fake HOME stay byte-identical across a launch', async () => {
    const { root, runDir } = await createRoot();
    const home = await createSentinelHome(root);
    const before = await snapshotTree(home);

    const previousHome = process.env.HOME;
    process.env.HOME = home;
    try {
      for (const def of [...BUILTIN_PROVIDER_DEFS, flagDef()]) {
        const fragment = await writeRunConfig(runDir, def, RUN_CAPABILITIES);
        // Nothing a launch hands to the CLI may point back into the sentinel home.
        for (const value of Object.values(fragment.env)) {
          expect(value.startsWith(home), `${def.id} env points into HOME`).toBe(false);
        }
      }
    } finally {
      process.env.HOME = previousHome;
    }

    const after = await snapshotTree(home);
    expect([...after.entries()].sort()).toEqual([...before.entries()].sort());
  });

  it('P-7: the config dir reaches the CLI through the provider config mechanism', async () => {
    const { runDir } = await createRoot();

    const viaEnv = await writeRunConfig(runDir, defById('claude-code'), RUN_CAPABILITIES);
    expect(viaEnv.env).toEqual({ CLAUDE_CONFIG_DIR: join(runDir, 'config') });
    expect(viaEnv.args).toEqual([]);

    const viaFlag = await writeRunConfig(runDir, flagDef(), RUN_CAPABILITIES);
    expect(viaFlag.args).toEqual(['--mcp-config', join(runDir, 'config')]);
    expect(viaFlag.env).toEqual({});
  });

  it('P-7: the run config files carry the MCP servers, skills and hooks of the run', async () => {
    const { runDir } = await createRoot();
    const fragment = await writeRunConfig(runDir, defById('codex'), RUN_CAPABILITIES);

    const mcp = JSON.parse(await readFile(join(fragment.configDir, 'mcp.json'), 'utf8')) as {
      mcpServers: Record<string, { command: string; args: string[]; env: Record<string, string> }>;
    };
    expect(Object.keys(mcp.mcpServers).sort()).toEqual(['filesystem', 'github']);
    expect(mcp.mcpServers.filesystem).toEqual({
      command: 'npx',
      args: ['-y', 'fs-server'],
      env: { ROOT: '/repo/main' },
    });

    const skills = JSON.parse(await readFile(join(fragment.configDir, 'skills.json'), 'utf8')) as {
      skills: { id: string; name: string; path: string }[];
    };
    expect(skills.skills).toEqual([{ id: 'review', name: 'Review skill', path: '/library/skills/review' }]);

    const hooks = JSON.parse(await readFile(join(fragment.configDir, 'hooks.json'), 'utf8')) as {
      hooks: { id: string; name: string; event: string; command: string }[];
    };
    expect(hooks.hooks).toEqual([
      { id: 'block-writes', name: 'Block writes', event: 'before_tool', command: 'docket-hook block' },
    ]);

    // The parsed fragment mirrors the files, so ACP transports can pass the same config inline.
    expect(fragment.mcpServers['github']).toEqual({ command: 'gh-mcp', args: [], env: {} });
    expect(fragment.skills).toHaveLength(1);
    expect(fragment.hooks).toHaveLength(1);
  });

  it('P-7: a run without capabilities still gets a complete, empty config set', async () => {
    const { runDir } = await createRoot();
    const fragment = await writeRunConfig(runDir, defById('copilot'), []);
    expect(fragment.mcpServers).toEqual({});
    expect(fragment.skills).toEqual([]);
    expect(fragment.hooks).toEqual([]);
    const mcp = JSON.parse(await readFile(join(fragment.configDir, 'mcp.json'), 'utf8')) as unknown;
    expect(mcp).toEqual({ mcpServers: {} });
  });
});

describe('isolation and telemetry (P-44)', () => {
  const isolatedDef = (): ProviderDef => ({
    ...flagDef(),
    id: 'isolated-probe',
    isolation: {
      env: { PROBE_NO_EXTERNAL_CONFIG: '1' },
      args: ['--no-external-config'],
      runScopedHome: 'PROBE_HOME',
    },
    telemetryOff: ['--no-telemetry'],
  });

  it('P-44: the isolation env and args and the telemetry-off flags are applied to the launch', async () => {
    const { runDir } = await createRoot();

    const config = await writeRunConfig(runDir, isolatedDef(), []);

    expect(config.args).toEqual(['--mcp-config', config.configDir, '--no-external-config', '--no-telemetry']);
    expect(config.env['PROBE_NO_EXTERNAL_CONFIG']).toBe('1');
  });

  it('P-44: a run-scoped home points at the run config dir and never at the real home, whatever the machine carries', async () => {
    const { root, runDir } = await createRoot();
    const realHome = join(root, 'real-home');
    const def: ProviderDef = { ...isolatedDef(), isolation: { runScopedHome: 'HOME' } };

    const config = await writeRunConfig(runDir, def, []);
    // The transports spread the allowlisted machine env first and the run config on top of it.
    const childEnv = { ...buildChildEnv(def.id, { HOME: realHome, PATH: '/bin' }, {}), ...config.env };

    expect(childEnv['HOME']).toBe(config.configDir);
    expect(Object.values(childEnv).some((value) => value.startsWith(realHome))).toBe(false);
  });

  it('P-44: a definition without isolation or telemetry flags launches exactly as before', async () => {
    const { runDir } = await createRoot();

    const config = await writeRunConfig(runDir, defById('claude-code'), []);

    expect(config.args).toEqual([]);
    expect(config.env).toEqual({ CLAUDE_CONFIG_DIR: config.configDir });
  });
});
