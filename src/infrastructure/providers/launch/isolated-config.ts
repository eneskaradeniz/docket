// Run-scoped configuration writer. Everything a run writes — its config directory and the
// MCP/skills/hooks files inside — lives under the run's own directory; the user's own CLI config
// trees (~/.claude and friends) are never written. Contract: docs/v2/providers.md → "Launch
// rules" 2 and "Phase 3 contracts" → "Launch isolation (P-7)".
import { mkdir, writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import type { HookEvent } from '../../../domain/index';
import type { ProviderDef } from '../defs';

/** Capabilities of one run with every secret already resolved: the vault answers before this
 * writer runs, so a secret reference never reaches the filesystem layer. */
export type RunCapability = RunMcpServer | RunSkill | RunHook;

export interface RunMcpServer {
  readonly kind: 'mcp';
  readonly id: string;
  readonly name: string;
  readonly command: string;
  readonly args: readonly string[];
  readonly env: Readonly<Record<string, string>>;
}

export interface RunSkill {
  readonly kind: 'skill';
  readonly id: string;
  readonly name: string;
  /** Repo or library path the CLI reads the skill from; referenced, never copied. */
  readonly path: string;
}

export interface RunHook {
  readonly kind: 'hook';
  readonly id: string;
  readonly name: string;
  readonly event: HookEvent;
  readonly command: string;
}

export interface WrittenMcpServer {
  readonly command: string;
  readonly args: readonly string[];
  readonly env: Readonly<Record<string, string>>;
}

export interface WrittenSkill {
  readonly id: string;
  readonly name: string;
  readonly path: string;
}

export interface WrittenHook {
  readonly id: string;
  readonly name: string;
  readonly event: HookEvent;
  readonly command: string;
}

/** What a launch hands to the CLI so the run reads — and writes — only its own configuration. */
export interface RunConfig {
  /** Absolute path of the run-scoped config directory (inside the run directory). */
  readonly configDir: string;
  /** mechanism 'flag': the flag and the config dir the CLI is invoked with. */
  readonly args: readonly string[];
  /** mechanism 'env-var': the config-dir variable of this CLI, pointing inside the run. */
  readonly env: Readonly<Record<string, string>>;
  /** The parsed config, so transports that carry config inline (e.g. a session-create field)
   * pass exactly what the files hold. */
  readonly mcpServers: Readonly<Record<string, WrittenMcpServer>>;
  readonly skills: readonly WrittenSkill[];
  readonly hooks: readonly WrittenHook[];
}

const CONFIG_DIR_NAME = 'config';
const MCP_FILE = 'mcp.json';
const SKILLS_FILE = 'skills.json';
const HOOKS_FILE = 'hooks.json';

const byId = (a: { id: string }, b: { id: string }): number => a.id.localeCompare(b.id);

const jsonFile = (value: unknown): string => `${JSON.stringify(value, null, 2)}\n`;

export async function writeRunConfig(
  runDir: string,
  def: ProviderDef,
  capabilities: readonly RunCapability[],
): Promise<RunConfig> {
  const configDir = resolve(runDir, CONFIG_DIR_NAME);
  // The run's own directory is the only writable surface; recursive keeps a re-used run dir working.
  await mkdir(configDir, { recursive: true });

  const mcpCapabilities = capabilities
    .filter((capability): capability is RunMcpServer => capability.kind === 'mcp')
    .sort(byId);
  const mcpServers: Record<string, WrittenMcpServer> = {};
  for (const server of mcpCapabilities) {
    mcpServers[server.id] = { command: server.command, args: server.args, env: server.env };
  }

  const skills: WrittenSkill[] = capabilities
    .filter((capability): capability is RunSkill => capability.kind === 'skill')
    .sort(byId)
    .map((skill) => ({ id: skill.id, name: skill.name, path: skill.path }));

  const hooks: WrittenHook[] = capabilities
    .filter((capability): capability is RunHook => capability.kind === 'hook')
    .sort(byId)
    .map((hook) => ({ id: hook.id, name: hook.name, event: hook.event, command: hook.command }));

  // All three files are always written, even when empty: the transports get one predictable file
  // set per mechanism instead of format probes.
  await writeFile(join(configDir, MCP_FILE), jsonFile({ mcpServers }), 'utf8');
  await writeFile(join(configDir, SKILLS_FILE), jsonFile({ skills }), 'utf8');
  await writeFile(join(configDir, HOOKS_FILE), jsonFile({ hooks }), 'utf8');

  return {
    configDir,
    args: def.config.mechanism === 'flag' ? [def.config.name, configDir] : [],
    env: def.config.mechanism === 'env-var' ? { [def.config.name]: configDir } : {},
    mcpServers,
    skills,
    hooks,
  };
}
