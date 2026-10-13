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

const CODEX_PROVIDER = 'codex';
const COPILOT_PROVIDER = 'copilot';
const OPENCODE_PROVIDER = 'opencode';

const expandHome = (path: string, homeDir: string): string =>
  path.startsWith('~/') ? join(homeDir, path.slice(2)) : path;

const configRootOf = (
  provider: string,
  homeDir: string,
  env: Readonly<Record<string, string>>,
): string | undefined => {
  if (provider === CLAUDE_PROVIDER) return join(homeDir, '.claude');
  if (provider === OPENCODE_PROVIDER) {
    const fromEnv = env['OPENCODE_CONFIG_DIR']?.trim() ?? env['OPENCODE_CONFIG']?.trim();
    if (fromEnv !== undefined && fromEnv !== '') {
      return expandHome(fromEnv, homeDir);
    }
    const xdgConfig = env['XDG_CONFIG_HOME']?.trim();
    if (xdgConfig !== undefined && xdgConfig !== '') {
      return join(expandHome(xdgConfig, homeDir), 'opencode');
    }
    return join(homeDir, '.config', 'opencode');
  }
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

interface TomlMcpEntry {
  command?: string;
  args?: readonly string[];
  envKeys: string[];
}

const cleanTomlKey = (raw: string): string => raw.trim().replace(/^["']|["']$/gu, '');

const parseCodexToml = (
  text: string,
  provider: string,
  sourcePath: string,
  found: MachineCandidate[],
): void => {
  const lines = text.split('\n');
  const mcpServers = new Map<string, TomlMcpEntry>();
  const plugins = new Map<string, boolean>();

  let currentSection = '';
  let currentMcpServer: string | undefined;
  let isMcpEnv = false;

  for (const rawLine of lines) {
    const line = rawLine.trim();
    if (line === '' || line.startsWith('#') || line.startsWith(';')) continue;

    const sectionMatch = line.match(/^\[([^\]]+)\]/u);
    if (sectionMatch !== null && sectionMatch[1] !== undefined) {
      currentSection = sectionMatch[1].trim();
      currentMcpServer = undefined;
      isMcpEnv = false;

      const mcpEnvMatch = currentSection.match(/^mcp_servers\.([^.]+)\.env$/u);
      if (mcpEnvMatch !== null && mcpEnvMatch[1] !== undefined) {
        currentMcpServer = cleanTomlKey(mcpEnvMatch[1]);
        isMcpEnv = true;
        if (!mcpServers.has(currentMcpServer)) {
          mcpServers.set(currentMcpServer, { envKeys: [] });
        }
        continue;
      }

      const mcpMatch = currentSection.match(/^mcp_servers\.([^.]+)$/u);
      if (mcpMatch !== null && mcpMatch[1] !== undefined) {
        currentMcpServer = cleanTomlKey(mcpMatch[1]);
        if (!mcpServers.has(currentMcpServer)) {
          mcpServers.set(currentMcpServer, { envKeys: [] });
        }
        continue;
      }

      const pluginMatch = currentSection.match(/^plugins\.([^.]+)$/u);
      if (pluginMatch !== null && pluginMatch[1] !== undefined) {
        const pluginName = cleanTomlKey(pluginMatch[1]);
        if (!plugins.has(pluginName)) {
          plugins.set(pluginName, true);
        }
        continue;
      }

      continue;
    }

    if (currentMcpServer !== undefined) {
      const entry = mcpServers.get(currentMcpServer);
      if (entry !== undefined) {
        if (isMcpEnv) {
          const kvMatch = line.match(/^([A-Za-z0-9_.-]+)\s*=/u);
          if (kvMatch !== null && kvMatch[1] !== undefined) {
            const key = cleanTomlKey(kvMatch[1]);
            if (!entry.envKeys.includes(key)) entry.envKeys.push(key);
          }
        } else {
          const cmdMatch = line.match(/^command\s*=\s*(?:["']([^"']+)["']|([^\s#]+))/u);
          if (cmdMatch !== null) {
            entry.command = cmdMatch[1] ?? cmdMatch[2];
          }
          const argsMatch = line.match(/^args\s*=\s*\[(.*)\]/u);
          if (argsMatch !== null && argsMatch[1] !== undefined) {
            const items = [...argsMatch[1].matchAll(/["']([^"']+)["']/gu)];
            entry.args = items.map((m) => m[1]).filter((s): s is string => typeof s === 'string');
          }
          const inlineEnvMatch = line.match(/^env\s*=\s*\{(.*)\}/u);
          if (inlineEnvMatch !== null && inlineEnvMatch[1] !== undefined) {
            const keyMatches = [...inlineEnvMatch[1].matchAll(/([A-Za-z0-9_.-]+)\s*=/gu)];
            for (const match of keyMatches) {
              const key = cleanTomlKey(match[1]);
              if (!entry.envKeys.includes(key)) entry.envKeys.push(key);
            }
          }
        }
      }
      continue;
    }

    const pluginMatch = currentSection.match(/^plugins\.([^.]+)$/u);
    if (pluginMatch !== null && pluginMatch[1] !== undefined) {
      const pluginName = cleanTomlKey(pluginMatch[1]);
      const enabledMatch = line.match(/^enabled\s*=\s*(true|false)/iu);
      if (enabledMatch !== null && enabledMatch[1] !== undefined) {
        plugins.set(pluginName, enabledMatch[1].toLowerCase() === 'true');
      }
    }
  }

  for (const [name, server] of mcpServers.entries()) {
    if (server.command !== undefined && server.command.trim() !== '') {
      pushUnique(found, {
        provider,
        kind: 'mcp',
        name,
        sourcePath,
        secretNames: [...server.envKeys].sort(),
      });
    }
  }

  for (const [name, enabled] of plugins.entries()) {
    if (enabled && name !== '') {
      pushUnique(found, {
        provider,
        kind: 'plugin',
        name,
        sourcePath,
        secretNames: [],
      });
    }
  }
};

const extractTomlMcp = (
  text: string,
  targetServer: string,
): { readonly command: string; readonly args: readonly string[] } | undefined => {
  const lines = text.split('\n');
  let currentServer: string | undefined;
  let command: string | undefined;
  let args: readonly string[] = [];

  for (const rawLine of lines) {
    const line = rawLine.trim();
    if (line === '' || line.startsWith('#') || line.startsWith(';')) continue;

    const sectionMatch = line.match(/^\[([^\]]+)\]/u);
    if (sectionMatch !== null && sectionMatch[1] !== undefined) {
      const section = sectionMatch[1].trim();
      const mcpMatch = section.match(/^mcp_servers\.([^.]+)$/u);
      if (mcpMatch !== null && mcpMatch[1] !== undefined) {
        currentServer = cleanTomlKey(mcpMatch[1]);
      } else {
        currentServer = undefined;
      }
      continue;
    }

    if (currentServer === targetServer) {
      const cmdMatch = line.match(/^command\s*=\s*(?:["']([^"']+)["']|([^\s#]+))/u);
      if (cmdMatch !== null) {
        command = cmdMatch[1] ?? cmdMatch[2];
      }
      const argsMatch = line.match(/^args\s*=\s*\[(.*)\]/u);
      if (argsMatch !== null && argsMatch[1] !== undefined) {
        const items = [...argsMatch[1].matchAll(/["']([^"']+)["']/gu)];
        args = items.map((m) => m[1]).filter((s): s is string => typeof s === 'string');
      }
    }
  }

  if (command === undefined) return undefined;
  return { command, args };
};

const parseCopilotMcp = (
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
    const cmd = entry['command'];
    if (typeof cmd !== 'string' || cmd.trim() === '') continue;
    pushUnique(found, {
      provider,
      kind: 'mcp',
      name,
      sourcePath: path,
      secretNames: envSecretNames(entry),
    });
  }
};

const parseOpenCodeConfig = (
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

  const mcp = (parsed['mcp'] ?? parsed['mcpServers']) as unknown;
  if (isRecord(mcp)) {
    for (const [name, entry] of Object.entries(mcp)) {
      if (!isRecord(entry)) continue;
      const cmd = entry['command'];
      const hasValidCmd =
        typeof cmd === 'string' && cmd.trim() !== ''
          ? true
          : Array.isArray(cmd) && typeof cmd[0] === 'string' && cmd[0].trim() !== '';
      if (!hasValidCmd) continue;
      pushUnique(found, {
        provider,
        kind: 'mcp',
        name,
        sourcePath: path,
        secretNames: envSecretNames(entry),
      });
    }
  }

  const plugins = parsed['plugins'];
  if (Array.isArray(plugins)) {
    for (const entry of plugins) {
      if (typeof entry === 'string' && entry !== '') {
        pushUnique(found, { provider, kind: 'plugin', name: entry, sourcePath: path, secretNames: [] });
      } else if (isRecord(entry)) {
        const pkgName =
          typeof entry['package'] === 'string'
            ? entry['package']
            : typeof entry['name'] === 'string'
              ? entry['name']
              : undefined;
        if (pkgName !== undefined && pkgName !== '') {
          pushUnique(found, { provider, kind: 'plugin', name: pkgName, sourcePath: path, secretNames: [] });
        }
      }
    }
  }
};

const scanSkillsDir = async (
  fs: MachineScanFs,
  provider: string,
  skillsRoot: string,
  found: MachineCandidate[],
): Promise<void> => {
  try {
    if (!(await fs.isDirectory(skillsRoot))) return;
    const entries = await fs.listFiles(skillsRoot);
    for (const name of [...entries].sort()) {
      if (name.endsWith('.md')) {
        pushUnique(found, {
          provider,
          kind: 'skill',
          name: name.replace(/\.md$/u, ''),
          sourcePath: join(skillsRoot, name),
          secretNames: [],
        });
      } else {
        const subPath = join(skillsRoot, name);
        try {
          if (await fs.isDirectory(subPath)) {
            const skillMdPath = join(subPath, 'SKILL.md');
            const content = await fs.readText(skillMdPath, CAPABILITY_SCAN_MEMORY_MAX_BYTES);
            if (content !== undefined) {
              pushUnique(found, {
                provider,
                kind: 'skill',
                name,
                sourcePath: skillMdPath,
                secretNames: [],
              });
            }
          }
        } catch {
          // continue
        }
      }
    }
  } catch {
    // continue
  }
};

const scanPluginsDir = async (
  fs: MachineScanFs,
  provider: string,
  pluginsRoot: string,
  found: MachineCandidate[],
): Promise<void> => {
  try {
    if (!(await fs.isDirectory(pluginsRoot))) return;
    const entries = await fs.listFiles(pluginsRoot);
    for (const name of [...entries].sort()) {
      if (name === '' || name.startsWith('.')) continue;
      pushUnique(found, {
        provider,
        kind: 'plugin',
        name,
        sourcePath: join(pluginsRoot, name),
        secretNames: [],
      });
    }
  } catch {
    // continue
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

  await scanSkillsDir(fs, provider, join(root, SKILLS_DIR), found);

  return found;
};

const scanCodexRoot = async (
  fs: MachineScanFs,
  provider: string,
  root: string,
): Promise<readonly MachineCandidate[]> => {
  const found: MachineCandidate[] = [];

  const agentsPath = join(root, 'AGENTS.md');
  try {
    const agents = await fs.readText(agentsPath, CAPABILITY_SCAN_MEMORY_MAX_BYTES);
    if (agents !== undefined) {
      pushUnique(found, { provider, kind: 'context', name: 'AGENTS.md', sourcePath: agentsPath, secretNames: [] });
    }
  } catch {
    // continue
  }

  const overridePath = join(root, 'AGENTS.override.md');
  try {
    const override = await fs.readText(overridePath, CAPABILITY_SCAN_MEMORY_MAX_BYTES);
    if (override !== undefined) {
      pushUnique(found, { provider, kind: 'context', name: 'AGENTS.override.md', sourcePath: overridePath, secretNames: [] });
    }
  } catch {
    // continue
  }

  const configPath = join(root, 'config.toml');
  try {
    const config = await fs.readText(configPath, CAPABILITY_SCAN_STATE_MAX_BYTES);
    if (config !== undefined) {
      parseCodexToml(config, provider, configPath, found);
    }
  } catch {
    // continue
  }

  await scanSkillsDir(fs, provider, join(root, SKILLS_DIR), found);

  return found;
};

const scanCopilotRoot = async (
  fs: MachineScanFs,
  provider: string,
  root: string,
): Promise<readonly MachineCandidate[]> => {
  const found: MachineCandidate[] = [];

  const instructionsPath = join(root, 'copilot-instructions.md');
  try {
    const instructions = await fs.readText(instructionsPath, CAPABILITY_SCAN_MEMORY_MAX_BYTES);
    if (instructions !== undefined) {
      pushUnique(found, { provider, kind: 'context', name: 'copilot-instructions.md', sourcePath: instructionsPath, secretNames: [] });
    }
  } catch {
    // continue
  }

  const mcpPath = join(root, 'mcp-config.json');
  try {
    const mcp = await fs.readText(mcpPath, CAPABILITY_SCAN_STATE_MAX_BYTES);
    if (mcp !== undefined) {
      parseCopilotMcp(mcp, provider, mcpPath, found);
    }
  } catch {
    // continue
  }

  await scanSkillsDir(fs, provider, join(root, SKILLS_DIR), found);
  await scanPluginsDir(fs, provider, join(root, 'plugins'), found);

  return found;
};

const scanOpenCodeRoot = async (
  fs: MachineScanFs,
  provider: string,
  root: string,
): Promise<readonly MachineCandidate[]> => {
  const found: MachineCandidate[] = [];

  const agentsPath = join(root, 'AGENTS.md');
  try {
    const agents = await fs.readText(agentsPath, CAPABILITY_SCAN_MEMORY_MAX_BYTES);
    if (agents !== undefined) {
      pushUnique(found, { provider, kind: 'context', name: 'AGENTS.md', sourcePath: agentsPath, secretNames: [] });
    }
  } catch {
    // continue
  }

  for (const cfgName of ['opencode.json', 'opencode.jsonc']) {
    const configPath = join(root, cfgName);
    try {
      const config = await fs.readText(configPath, CAPABILITY_SCAN_STATE_MAX_BYTES);
      if (config !== undefined) {
        parseOpenCodeConfig(config, provider, configPath, found);
        break;
      }
    } catch {
      // continue
    }
  }

  await scanSkillsDir(fs, provider, join(root, SKILLS_DIR), found);
  await scanPluginsDir(fs, provider, join(root, 'plugins'), found);

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
    const root = configRootOf(provider, homeDir, env);
    if (root === undefined) return [];
    try {
      if (!(await fs.isDirectory(root))) return [];
    } catch {
      return [];
    }
    try {
      switch (provider) {
        case CLAUDE_PROVIDER:
          return await scanClaudeRoot(fs, provider, root);
        case CODEX_PROVIDER:
          return await scanCodexRoot(fs, provider, root);
        case COPILOT_PROVIDER:
          return await scanCopilotRoot(fs, provider, root);
        case OPENCODE_PROVIDER:
          return await scanOpenCodeRoot(fs, provider, root);
        default:
          return [];
      }
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
        let pluginPath: string | undefined;
        if (candidate.sourcePath.endsWith('.json')) {
          const settings = await readJsonAt(candidate.sourcePath, MACHINE_SCAN_SETTINGS_MAX_BYTES);
          if (isRecord(settings)) {
            const plugins = settings['plugins'];
            const pluginEntry = isRecord(plugins) ? plugins[candidate.name] : undefined;
            if (isRecord(pluginEntry) && typeof pluginEntry['path'] === 'string') {
              pluginPath = pluginEntry['path'];
            }
          }
        }
        if (pluginPath === undefined) {
          pluginPath =
            candidate.sourcePath.endsWith('.json') || candidate.sourcePath.endsWith('.toml')
              ? candidate.name
              : candidate.sourcePath;
        }
        return ok({
          kind: 'plugin',
          id: slug,
          name: candidate.name,
          source: { kind: 'path', path: pluginPath },
          includes: [],
        });
      }
      case 'mcp': {
        let command: string | undefined;
        let args: readonly string[] = [];
        if (candidate.sourcePath.endsWith('.toml')) {
          const text = await fs.readText(candidate.sourcePath, CAPABILITY_SCAN_STATE_MAX_BYTES);
          if (text !== undefined) {
            const extracted = extractTomlMcp(text, candidate.name);
            command = extracted?.command;
            args = extracted?.args ?? [];
          }
        } else {
          const parsed = await readJsonAt(candidate.sourcePath, CAPABILITY_SCAN_STATE_MAX_BYTES);
          if (isRecord(parsed)) {
            const servers = (parsed['mcpServers'] ?? parsed['mcp']) as unknown;
            if (isRecord(servers)) {
              const server = servers[candidate.name];
              if (isRecord(server)) {
                if (typeof server['command'] === 'string') {
                  command = server['command'];
                } else if (Array.isArray(server['command']) && typeof server['command'][0] === 'string') {
                  command = server['command'][0];
                  args = server['command'].slice(1).map(String);
                }
                if (Array.isArray(server['args'])) {
                  args = server['args'].map(String);
                }
              }
            }
          }
        }
        if (command === undefined) return err('missing_command');
        const envBlock: Record<string, { readonly secretRef: string } | { readonly literal: string }> = {};
        for (const name of candidate.secretNames) {
          const ref = secretRefs[name];
          if (ref === undefined) return err('missing_secret_ref');
          envBlock[name] = { secretRef: ref };
        }
        return ok({ kind: 'mcp', id: slug, name: candidate.name, command, args, env: envBlock });
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
