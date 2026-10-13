// Machine capability scan: read-only listing of MCP, skills, plugins and hooks from each
// provider's own user-level config (P-60). Contract: docs/v2/provider-capabilities.md §15.
import { readdir } from 'node:fs/promises';
import { homedir } from 'node:os';
import { join } from 'node:path';

import type { MachineCapabilityScan, MachineCapabilityMaterializeError } from '../../../application/index';
import type { CapabilityDef, MachineCandidate, Result } from '../../../domain/index';
import { err, ok } from '../../../domain/index';
import { BUILTIN_PROVIDER_DEFS } from '../defs/index';

import {
  CAPABILITY_SCAN_MEMORY_MAX_BYTES,
  CAPABILITY_SCAN_STATE_MAX_BYTES,
  createNodeCapabilityScanFs,
  type CapabilityScanFs,
} from './capability-scan';
import { SETTINGS_FILE } from './account-scan';

export const MACHINE_SCAN_SETTINGS_MAX_BYTES = 256 * 1024;

const CLAUDE_PROVIDER = 'claude-code';
const MEMORY_FILE = 'CLAUDE.md';
const STATE_FILE = '.claude.json';
const SKILLS_DIR = 'skills';

const isRecord = (value: unknown): value is Readonly<Record<string, unknown>> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

export interface MachineScanFs extends CapabilityScanFs {
  listFiles(dir: string): Promise<readonly string[]>;
}

const expandHome = (path: string, homeDir: string): string =>
  path.startsWith('~/') ? join(homeDir, path.slice(2)) : path;

const configRootOf = (
  provider: string,
  homeDir: string,
  env: Readonly<Record<string, string>>,
): string | undefined => {
  if (provider === CLAUDE_PROVIDER) return join(homeDir, '.claude');
  const def = BUILTIN_PROVIDER_DEFS.find((entry) => entry.id === provider);
  const home = def?.accountHome;
  if (home === undefined) return undefined;
  const fromEnv = home.env === undefined ? undefined : env[home.env]?.trim();
  const raw = fromEnv !== undefined && fromEnv !== '' ? fromEnv : home.path;
  return expandHome(raw, homeDir);
};

const envSecretNames = (entry: Readonly<Record<string, unknown>>): readonly string[] => {
  const env = entry['env'];
  if (!isRecord(env)) return [];
  return Object.keys(env).filter((key) => typeof env[key] === 'string').sort();
};

const pushUnique = (found: MachineCandidate[], row: MachineCandidate): void => {
  if (
    found.some(
      (other) =>
        other.provider === row.provider &&
        other.kind === row.kind &&
        other.name === row.name &&
        other.sourcePath === row.sourcePath,
    )
  ) {
    return;
  }
  found.push(row);
};

const parseClaudeState = (
  text: string,
  provider: string,
  path: string,
  found: MachineCandidate[],
): void => {
  let parsed: unknown;
  try {
    parsed = JSON.parse(text) as unknown;
  } catch {
    return;
  }
  if (!isRecord(parsed)) return;
  const servers = parsed['mcpServers'];
  if (!isRecord(servers)) return;
  for (const [name, entry] of Object.entries(servers)) {
    if (!isRecord(entry)) continue;
    if (typeof entry['command'] !== 'string') continue;
    pushUnique(found, {
      provider,
      kind: 'mcp',
      name,
      sourcePath: path,
      secretNames: envSecretNames(entry),
    });
  }
};

const parseClaudeSettings = (
  text: string,
  provider: string,
  path: string,
  found: MachineCandidate[],
): void => {
  let parsed: unknown;
  try {
    parsed = JSON.parse(text) as unknown;
  } catch {
    return;
  }
  if (!isRecord(parsed)) return;
  const hooks = parsed['hooks'];
  if (isRecord(hooks)) {
    for (const name of Object.keys(hooks).sort()) {
      pushUnique(found, { provider, kind: 'hook', name, sourcePath: path, secretNames: [] });
    }
  }
  const plugins = parsed['plugins'];
  if (Array.isArray(plugins)) {
    for (const entry of plugins) {
      if (typeof entry === 'string' && entry !== '') {
        pushUnique(found, { provider, kind: 'plugin', name: entry, sourcePath: path, secretNames: [] });
      } else if (isRecord(entry) && typeof entry['name'] === 'string' && entry['name'] !== '') {
        pushUnique(found, { provider, kind: 'plugin', name: entry['name'], sourcePath: path, secretNames: [] });
      }
    }
  } else if (isRecord(plugins)) {
    for (const name of Object.keys(plugins).sort()) {
      pushUnique(found, { provider, kind: 'plugin', name, sourcePath: path, secretNames: [] });
    }
  }
  const enabled = parsed['enabledPlugins'];
  if (isRecord(enabled)) {
    for (const name of Object.keys(enabled).sort()) {
      pushUnique(found, { provider, kind: 'plugin', name, sourcePath: path, secretNames: [] });
    }
  }
};

const scanClaudeRoot = async (fs: MachineScanFs, provider: string, root: string): Promise<readonly MachineCandidate[]> => {
  const found: MachineCandidate[] = [];
  try {
    if (!(await fs.isDirectory(root))) return [];
  } catch {
    return [];
  }

  const memoryPath = join(root, MEMORY_FILE);
  try {
    const memory = await fs.readText(memoryPath, CAPABILITY_SCAN_MEMORY_MAX_BYTES);
    if (memory !== undefined) {
      pushUnique(found, { provider, kind: 'context', name: MEMORY_FILE, sourcePath: memoryPath, secretNames: [] });
    }
  } catch {
    // one unreadable file never stops the scan
  }

  const statePath = join(root, STATE_FILE);
  try {
    const state = await fs.readText(statePath, CAPABILITY_SCAN_STATE_MAX_BYTES);
    if (state !== undefined) parseClaudeState(state, provider, statePath, found);
  } catch {
    // continue
  }

  const settingsPath = join(root, SETTINGS_FILE);
  try {
    const settings = await fs.readText(settingsPath, MACHINE_SCAN_SETTINGS_MAX_BYTES);
    if (settings !== undefined) parseClaudeSettings(settings, provider, settingsPath, found);
  } catch {
    // continue
  }

  const skillsRoot = join(root, SKILLS_DIR);
  try {
    if (await fs.isDirectory(skillsRoot)) {
      const entries = await fs.listFiles(skillsRoot);
      for (const name of [...entries].sort()) {
        if (!name.endsWith('.md')) continue;
        const skillPath = join(skillsRoot, name);
        pushUnique(found, {
          provider,
          kind: 'skill',
          name: name.replace(/\.md$/u, ''),
          sourcePath: skillPath,
          secretNames: [],
        });
      }
    }
  } catch {
    // continue
  }

  return found;
};

export function createMachineCapabilityScan(options: {
  readonly fs: MachineScanFs;
  readonly homeDir: string;
  readonly env?: Readonly<Record<string, string>>;
}): MachineCapabilityScan {
  const { fs, homeDir } = options;
  const env = options.env ?? {};

  const scanProvider = async (provider: string): Promise<readonly MachineCandidate[]> => {
    if (provider !== CLAUDE_PROVIDER) {
      const root = configRootOf(provider, homeDir, env);
      if (root === undefined) return [];
      try {
        if (!(await fs.isDirectory(root))) return [];
      } catch {
        return [];
      }
      return [];
    }
    const root = configRootOf(provider, homeDir, env);
    if (root === undefined) return [];
    try {
      return await scanClaudeRoot(fs, provider, root);
    } catch {
      return [];
    }
  };

  const readJsonAt = async (path: string, maxBytes: number): Promise<unknown | undefined> => {
    try {
      const text = await fs.readText(path, maxBytes);
      if (text === undefined) return undefined;
      return JSON.parse(text) as unknown;
    } catch {
      return undefined;
    }
  };

  const buildDefinition = async (
    candidate: MachineCandidate,
    id: string,
    secretRefs: Readonly<Record<string, string>>,
  ): Promise<Result<CapabilityDef, MachineCapabilityMaterializeError>> => {
    const slug = id as CapabilityDef['id'];
    switch (candidate.kind) {
      case 'context':
      case 'skill':
        return ok({ kind: candidate.kind, id: slug, name: candidate.name, path: candidate.sourcePath });
      case 'hook':
        return err('unreadable');
      case 'plugin': {
        const settings = await readJsonAt(candidate.sourcePath, MACHINE_SCAN_SETTINGS_MAX_BYTES);
        if (!isRecord(settings)) return err('missing_plugin_source');
        let pluginPath: string | undefined;
        const plugins = settings['plugins'];
        const pluginEntry = isRecord(plugins) ? plugins[candidate.name] : undefined;
        if (isRecord(pluginEntry) && typeof pluginEntry['path'] === 'string') {
          pluginPath = pluginEntry['path'];
        }
        if (pluginPath === undefined) pluginPath = candidate.name;
        return ok({
          kind: 'plugin',
          id: slug,
          name: candidate.name,
          source: { kind: 'path', path: pluginPath },
          includes: [],
        });
      }
      case 'mcp': {
        const parsed = await readJsonAt(candidate.sourcePath, CAPABILITY_SCAN_STATE_MAX_BYTES);
        if (!isRecord(parsed)) return err('missing_command');
        const servers = parsed['mcpServers'];
        if (!isRecord(servers) || !isRecord(servers[candidate.name])) return err('missing_command');
        const server = servers[candidate.name];
        if (!isRecord(server)) return err('missing_command');
        const command = server['command'];
        if (typeof command !== 'string') return err('missing_command');
        const envBlock: Record<string, { readonly secretRef: string } | { readonly literal: string }> = {};
        for (const name of candidate.secretNames) {
          const ref = secretRefs[name];
          if (ref === undefined) return err('missing_secret_ref');
          envBlock[name] = { secretRef: ref };
        }
        return ok({ kind: 'mcp', id: slug, name: candidate.name, command, args: [], env: envBlock });
      }
      default:
        return err('unreadable');
    }
  };

  return {
    async scan(providers) {
      const found: MachineCandidate[] = [];
      for (const provider of providers) {
        try {
          found.push(...(await scanProvider(provider)));
        } catch {
          // one provider's failure yields an empty list for that provider, never an error for the whole scan
        }
      }
      return found;
    },
    buildDefinition,
  };
}

export function createNodeMachineScanFs(): MachineScanFs {
  const base = createNodeCapabilityScanFs();
  return {
    ...base,
    async listFiles(dir) {
      return readdir(dir);
    },
  };
}

export function createNodeMachineCapabilityScan(
  options: { readonly homeDir?: string; readonly env?: Readonly<Record<string, string>> } = {},
): MachineCapabilityScan {
  return createMachineCapabilityScan({
    fs: createNodeMachineScanFs(),
    homeDir: options.homeDir ?? homedir(),
    ...(options.env === undefined ? {} : { env: options.env }),
  });
}

/** Issue contract name — the node adapter behind the port. */
export function scanMachineCapabilities(providers: readonly string[]): Promise<readonly MachineCandidate[]> {
  return createNodeMachineCapabilityScan().scan(providers);
}
