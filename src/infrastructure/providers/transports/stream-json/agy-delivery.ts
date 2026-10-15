// agy run-scoped capability delivery (P-62, probe #1015 agy spike — spike-agy5/6, agy 1.3.6):
// one per-run `.agents/` tree under the run's config directory, loaded by the launch's
// `--add-dir <absolute configDir>` (a relative path loads no hooks). Nothing is written into the
// repository worktree or `~/.gemini`; the tree dies with the run directory. Every shape here is
// the measured one — one invalid hooks.json entry silently disables the whole file, so the writer
// emits only the proven minimal schema and the tests pin it.
// P-64: the permission surface is ONE PreToolUse entry whose command is the per-run ask launcher;
// the user's before_tool commands ride `.docket-ask.json`, never hooks.json (two PreToolUse
// entries would let an auto_approve win over a deny — probe #1015, spike-agy2/3).
// P-62 correction (#1219): agy's hooks.json top level maps hook-GROUP names to event objects —
// event names at the top level are silently ignored (the whole file never loads) — so every event
// rides inside exactly ONE group named `docket`; a second group would be another hook source that
// could out-vote the single PreToolUse entry.
// Contract: docs/v2/providers.md → "agy run-scoped delivery (P-62)" and
// "agy before_tool wrapper (P-64)".
import { cp, mkdir, readFile, stat, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import type { CapabilityDef, CapabilitySlug, HookEvent } from '../../../../domain/index';
import type { RunHook, RunMcpServer, RunSkill } from '../../launch/index';

/** What one agy run delivers: the launch pass's resolved capabilities (a secret reference never
 * gets this far — the run is refused first), plus the two kinds the generic pass drops: context
 * (rules files) and path-sourced plugins. */
export type AgyDeliveryCapability =
  | RunMcpServer
  | RunSkill
  | RunHook
  | Extract<CapabilityDef, { kind: 'context' }>
  | { readonly kind: 'plugin'; readonly id: CapabilitySlug; readonly name: string; readonly path: string };

/** PostToolUse matcher for agy's file-writing tools (probe #1015: the matcher is a tool-name
 * alternation; the tool names are the CLI's own). */
const AFTER_WRITE_TOOL_MATCHER =
  'write_to_file|replace_file_content|multi_replace_file_content|sed_file|notebook_edit';

/** The events this delivery writes as hooks.json entries of their own. `before_tool` (PreToolUse)
 * is deliberately absent: the ONE PreToolUse entry is the ask wrapper (P-64), and a user
 * before_tool command is never an entry of its own — an auto_approve that wins over the wrapper's
 * deny is exactly what the single entry exists to prevent. */
const HOOK_EVENT_TO_AGY: Readonly<Partial<Record<HookEvent, 'PostToolUse' | 'Stop'>>> = {
  after_tool: 'PostToolUse',
  after_write: 'PostToolUse',
  run_end: 'Stop',
};

/** The built ask child (I-108), the same spelling mcp/ask-script-path.ts owns; the providers
 * module cannot import that one (the infrastructure module map allows system only), so the tests
 * pin the two spellings against each other. */
const ASK_SCRIPT_FILE = 'docket-agy-ask.cjs';

/** The ask launcher's file name under `.agents/hooks/`; the id is fixed, not a capability id. */
const ASK_LAUNCHER_ID = 'docket-ask';

/** The ask configuration file the launcher's script reads (I-108). */
const DOCKET_ASK_FILE = '.docket-ask.json';

/** The one wait budget: the PreToolUse entry's `timeout` and the ask file's `timeoutSeconds`
 * are this same constant, so the CLI never kills the hook before the script gives up (I-108). */
const ASK_TIMEOUT_SECONDS = 3600;

/** The built-in MCP capability whose env carries the run's socket path and token, whose command
 * is the app's own executable and whose script argument names the directory the ask child lives
 * in (the mcp-attach spelling). */
const DOCKET_PAGES_ID = 'docket-pages';

/** Stop (and the other matcher-less events) take a direct command list — NO matcher, NO hooks
 * wrapper; PreToolUse/PostToolUse take { matcher?, hooks: [...] }. All of it sits inside the one
 * hook group `docket` (P-62 correction, #1219) — the group key, not the events, is the file's top
 * level. */
interface AgyHookGroup {
  readonly PreToolUse: readonly { readonly matcher?: string; readonly hooks: readonly unknown[] }[];
  readonly PostToolUse?: readonly { readonly matcher?: string; readonly hooks: readonly unknown[] }[];
  readonly Stop?: readonly { readonly type: 'command'; readonly command: string }[];
}

/** The whole hooks.json: exactly one top-level key, the group name (a second group would be
 * another hook source and could out-vote the single PreToolUse entry — P-64 inside P-62). */
interface AgyHooksFile {
  readonly docket: AgyHookGroup;
}

const byId = (a: { id: string }, b: { id: string }): number => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0);

const jsonFile = (value: unknown): string => `${JSON.stringify(value, null, 2)}\n`;

/** hooks.json carries only the quoted absolute path of a launcher file: agy parses double-quoted
 * arguments of its shell-less command exec (probe #1015, spike-agy5 U3), so the quotes are the
 * proven form for paths with spaces. */
const quoted = (path: string): string => JSON.stringify(path);

/** Directory name of a named component: the trimmed name with runs of whitespace as dashes, or
 * the id when the name is empty (same rule as the SDK delivery's skill dirs). */
const dirNameOf = (capability: { readonly id: string; readonly name: string }): string => {
  const trimmed = capability.name.trim();
  if (trimmed.length > 0) return trimmed.replace(/\s+/gu, '-');
  return capability.id;
};

/** One per-run executable launcher: `#!/bin/sh` plus the body verbatim, mode 0755. The user's
 * command line keeps its shell syntax (P-62's refusal is lifted — the command runs inside the
 * shell the launcher provides); the ask launcher execs the plain-Node child (I-108). */
const writeLauncher = async (hooksDir: string, id: string, body: string): Promise<string> => {
  const path = join(hooksDir, `${id}.sh`);
  await writeFile(path, `#!/bin/sh\n${body}\n`, { encoding: 'utf8', mode: 0o755 });
  return path;
};

/** What the ask side of this run needs: the plain-Node executable, the built ask child, and the
 * permission channel when the run has one. Everything comes from the delivered `docket-pages`
 * capability; without it there is no channel (bridge false) and the app's own entry bundle
 * directory is the best in-band spelling of the built child's home. */
const askDeliveryOf = (capabilities: readonly AgyDeliveryCapability[]): {
  readonly execPath: string;
  readonly scriptPath: string;
  readonly socketPath: string;
  readonly token: string;
} => {
  const docketPages = capabilities.find(
    (capability): capability is RunMcpServer =>
      capability.kind === 'mcp' && capability.id === DOCKET_PAGES_ID && capability.args.length > 0,
  );
  if (docketPages !== undefined) {
    return {
      execPath: docketPages.command,
      scriptPath: join(dirname(docketPages.args[0]), ASK_SCRIPT_FILE),
      socketPath: docketPages.env['DOCKET_MCP_SOCKET'] ?? '',
      token: docketPages.env['DOCKET_MCP_TOKEN'] ?? '',
    };
  }
  const entry = process.argv[1] ?? process.execPath;
  return { execPath: process.execPath, scriptPath: join(dirname(entry), ASK_SCRIPT_FILE), socketPath: '', token: '' };
};

/** Writes the run's `.agents/` tree under `configDir` and returns its path. Throws on a
 * capability the measured surface cannot carry (unreadable source); the transport turns that
 * into a typed start error, never a crash. */
export async function prepareAgyDelivery(
  configDir: string,
  capabilities: readonly AgyDeliveryCapability[],
): Promise<string> {
  const agentsDir = join(configDir, '.agents');
  await mkdir(agentsDir, { recursive: true, mode: 0o700 });
  const sorted = [...capabilities].sort(byId);

  const hooksDir = join(agentsDir, 'hooks');
  await mkdir(hooksDir, { recursive: true, mode: 0o700 });
  const ask = askDeliveryOf(sorted);
  // The ONE PreToolUse entry (P-64): its command is the ask launcher — the user's before_tool
  // commands are never entries of their own, so nothing can out-vote this wrapper.
  const askLauncher = await writeLauncher(
    hooksDir,
    ASK_LAUNCHER_ID,
    `exec env ELECTRON_RUN_AS_NODE=1 ${quoted(ask.execPath)} ${quoted(ask.scriptPath)} ${quoted(configDir)}`,
  );
  const preToolUse = [
    { matcher: '.*', hooks: [{ type: 'command' as const, command: quoted(askLauncher), timeout: ASK_TIMEOUT_SECONDS }] },
  ];

  const beforeTool: string[] = [];
  const postToolUse: { matcher?: string; hooks: unknown[] }[] = [];
  const stop: { type: 'command'; command: string }[] = [];
  for (const hook of sorted.filter((capability): capability is RunHook => capability.kind === 'hook')) {
    if (hook.event === 'before_tool') {
      // Delivered through the wrapper's file, not hooks.json (P-64).
      beforeTool.push(hook.command);
      continue;
    }
    const agyEvent = HOOK_EVENT_TO_AGY[hook.event];
    if (agyEvent === undefined) continue;
    const launcher = await writeLauncher(hooksDir, hook.id, hook.command);
    const entry = { type: 'command' as const, command: quoted(launcher) };
    if (agyEvent === 'Stop') {
      stop.push(entry);
      continue;
    }
    postToolUse.push(
      hook.event === 'after_write'
        ? { matcher: AFTER_WRITE_TOOL_MATCHER, hooks: [entry] }
        : { hooks: [entry] },
    );
  }

  const hooksFile: AgyHooksFile = {
    docket: {
      PreToolUse: preToolUse,
      ...(postToolUse.length > 0 ? { PostToolUse: postToolUse } : {}),
      ...(stop.length > 0 ? { Stop: stop } : {}),
    },
  };
  // Always written now: the PreToolUse wrapper entry exists even with no user hooks and no
  // channel (neutral `allow`), so a later capability cannot change the entry count mid-flight.
  await writeFile(join(agentsDir, 'hooks.json'), jsonFile(hooksFile), { encoding: 'utf8', mode: 0o600 });

  // The ask configuration (I-108): the only place the run token and socket path live outside the
  // docket-pages server env — 0600, inside the run's own tree, gone with the run directory.
  await writeFile(
    join(agentsDir, DOCKET_ASK_FILE),
    jsonFile({
      socketPath: ask.socketPath,
      token: ask.token,
      timeoutSeconds: ASK_TIMEOUT_SECONDS,
      beforeTool,
      bridge: ask.socketPath !== '' && ask.token !== '',
    }),
    { encoding: 'utf8', mode: 0o600 },
  );

  const mcpServers: Record<string, Pick<RunMcpServer, 'command' | 'args' | 'env'>> = {};
  for (const server of sorted.filter((capability): capability is RunMcpServer => capability.kind === 'mcp')) {
    // stdio only: a remote server needs the `serverUrl` key and a wrong key fails silently
    // (probe #1015), so nothing URL-shaped is ever written — the registry row says so.
    mcpServers[server.id] = { command: server.command, args: [...server.args], env: server.env };
  }
  if (Object.keys(mcpServers).length > 0) {
    await writeFile(join(agentsDir, 'mcp_config.json'), jsonFile({ mcpServers }), {
      encoding: 'utf8',
      mode: 0o600,
    });
  }

  for (const skill of sorted.filter((capability): capability is RunSkill => capability.kind === 'skill')) {
    const targetDir = join(agentsDir, 'skills', dirNameOf(skill));
    const sourceStat = await stat(skill.path);
    if (sourceStat.isDirectory()) {
      await cp(skill.path, targetDir, { recursive: true, force: true });
      continue;
    }
    await mkdir(targetDir, { recursive: true, mode: 0o700 });
    const body = await readFile(skill.path, 'utf8');
    // No frontmatter is added: the probe loaded SKILL.md without one (unlike claude-code).
    await writeFile(join(targetDir, 'SKILL.md'), body.endsWith('\n') ? body : `${body}\n`, {
      encoding: 'utf8',
      mode: 0o600,
    });
  }

  for (const context of sorted.filter(
    (capability): capability is Extract<CapabilityDef, { kind: 'context' }> => capability.kind === 'context',
  )) {
    // Without valid frontmatter the CLI silently discards the file (probe #1015), so the trigger
    // block is load-bearing, not cosmetics.
    const body = await readFile(context.path, 'utf8');
    await mkdir(join(agentsDir, 'rules'), { recursive: true, mode: 0o700 });
    await writeFile(
      join(agentsDir, 'rules', `${context.id}.md`),
      `---\ntrigger: always_on\n---\n\n${body.endsWith('\n') ? body : `${body}\n`}`,
      { encoding: 'utf8', mode: 0o600 },
    );
  }

  for (const plugin of sorted.filter(
    (capability): capability is Extract<AgyDeliveryCapability, { kind: 'plugin' }> =>
      capability.kind === 'plugin',
  )) {
    const sourceStat = await stat(plugin.path);
    if (!sourceStat.isDirectory()) {
      throw new Error(`agy plugin ${plugin.id} source is not a directory: ${plugin.path}`);
    }
    const name = dirNameOf(plugin);
    const targetDir = join(agentsDir, 'plugins', name);
    await cp(plugin.path, targetDir, { recursive: true, force: true });
    // The manifest sits at the bundle root (probe #1015: plugin.json {"name"} loads the plugin's
    // hooks and MCP; a plugin's own skill was not evidenced) — written after the copy so the
    // delivered bundle always carries the proven minimal manifest.
    await writeFile(join(targetDir, 'plugin.json'), jsonFile({ name }), { encoding: 'utf8', mode: 0o600 });
  }

  return agentsDir;
}
