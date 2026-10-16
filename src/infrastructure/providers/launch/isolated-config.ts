// Run-scoped configuration writer. Everything a run writes — its config directory and the
// MCP/skills/hooks files inside — lives under the run's own directory; the user's own CLI config
// trees (~/.claude and friends) are never written. Contract: docs/v2/providers.md → "Launch
// rules" 2 and "Phase 3 contracts" → "Launch isolation (P-7)".
import { mkdir, writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import type { HookEvent } from '../../../domain/index';
import type { ProviderDef } from '../defs';
import { homeRootEnvOf } from '../defs';

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
  /** mechanism 'flag': the flag and the config dir the CLI is invoked with, then the definition's
   * isolation flags and telemetry-off flags. */
  readonly args: readonly string[];
  /** The config-dir variable of this CLI (mechanism 'env-var'), the definition's isolation
   * variables, and — for a home-rooted CLI of an account with an identity directory (P-67) —
   * HOME at that directory plus GIT_CONFIG_GLOBAL at the machine gitconfig. */
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

/** P-67: the home of the account a run belongs to. `identityDir` points a home-rooted CLI's HOME
 * at the account's identity directory (the operator signs in there with the vendor's own tool;
 * Docket never creates the login and never reads, prints, logs or writes a credential).
 * `machineGitconfig` is the machine's ~/.gitconfig path: a redirected HOME hides it from every
 * command the agent runs, so it crosses as GIT_CONFIG_GLOBAL — the one non-secret ambient file.
 * Nothing else is passed or symlinked, never .ssh, the gh config, .npmrc, keychains or tokens:
 * the agent holds no push credentials, and Docket's own forge/git actions run host-side in the
 * worktree. */
export interface RunAccountHome {
  readonly identityDir?: string;
  readonly machineGitconfig?: string;
}

export async function writeRunConfig(
  runDir: string,
  def: ProviderDef,
  capabilities: readonly RunCapability[],
  account?: RunAccountHome,
): Promise<RunConfig> {
  const configDir = resolve(runDir, CONFIG_DIR_NAME);
  // The run's own directory is the only writable surface; recursive keeps a re-used run dir working.
  await mkdir(configDir, { recursive: true, mode: 0o700 });

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
  await writeFile(join(configDir, MCP_FILE), jsonFile({ mcpServers }), { encoding: 'utf8', mode: 0o600 });
  await writeFile(join(configDir, SKILLS_FILE), jsonFile({ skills }), { encoding: 'utf8', mode: 0o600 });
  await writeFile(join(configDir, HOOKS_FILE), jsonFile({ hooks }), { encoding: 'utf8', mode: 0o600 });

  // A HOME-named config root is the CLI's login home (P-67): the run directory must never take
  // it — the login would be lost (P-44) — so its value comes from the account's identity
  // directory, and an account without one leaves the machine home to the launch allowlist.
  const homeRoot = homeRootEnvOf(def);
  const identityDir = homeRoot !== undefined ? account?.identityDir : undefined;
  const machineGitconfig = identityDir !== undefined ? account?.machineGitconfig : undefined;

  return {
    configDir,
    args: [
      ...(def.config.mechanism === 'flag' ? [def.config.name, configDir] : []),
      ...(def.isolation?.args ?? []),
      ...(def.telemetryOff ?? []),
    ],
    env: {
      ...def.isolation?.env,
      // The run's own directory is the only value a home variable can take: the user's real home
      // would let the CLI read every other tool's configuration.
      ...(def.isolation?.runScopedHome === undefined ? {} : { [def.isolation.runScopedHome]: configDir }),
      ...(def.config.mechanism === 'env-var' && homeRoot === undefined ? { [def.config.name]: configDir } : {}),
      ...(homeRoot !== undefined && identityDir !== undefined ? { [homeRoot]: identityDir } : {}),
      // The git identity crosses only together with a redirected home: without one the machine
      // home already carries it, and an unset machineGitconfig (no ~/.gitconfig) sets nothing.
      ...(machineGitconfig === undefined ? {} : { GIT_CONFIG_GLOBAL: machineGitconfig }),
    },
    mcpServers,
    skills,
    hooks,
  };
}
