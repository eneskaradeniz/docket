// agy run-scoped capability delivery (P-62, probe #1015 agy spike — spike-agy5/6, agy 1.3.6):
// one per-run `.agents/` tree under the run's config directory, loaded by the launch's
// `--add-dir <absolute configDir>` (a relative path loads no hooks). Nothing is written into the
// repository worktree or `~/.gemini`; the tree dies with the run directory. Every shape here is
// the measured one — one invalid hooks.json entry silently disables the whole file, so the writer
// emits only the proven minimal schema and the tests pin it.
// Contract: docs/v2/providers.md → "agy run-scoped delivery (P-62)".
import { cp, mkdir, readFile, stat, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
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

/** The events this delivery writes. `before_tool` (PreToolUse) is deliberately absent: the
 * permission bridge owns that entry, so a user before_tool hook is not delivered by this issue
 * and the registry's hook row reports the omission. */
const HOOK_EVENT_TO_AGY: Readonly<Partial<Record<HookEvent, 'PostToolUse' | 'Stop'>>> = {
  after_tool: 'PostToolUse',
  after_write: 'PostToolUse',
  run_end: 'Stop',
};

/** agy executes a hook command without a shell (probe #1015: a `2>>` redirection broke every
 * hook call), so the proven form is one command with quoted arguments. A command carrying shell
 * syntax is refused here — writing it would break silently at run time. */
const SHELL_SYNTAX_RE = /&&|\|\||[|<>;`]|\$\(|\r|\n/u;

/** Stop (and the other matcher-less events) take a direct command list — NO matcher, NO hooks
 * wrapper; PreToolUse/PostToolUse take { matcher?, hooks: [...] }. */
interface AgyHooksFile {
  readonly PostToolUse?: readonly { readonly matcher?: string; readonly hooks: readonly unknown[] }[];
  readonly Stop?: readonly { readonly type: 'command'; readonly command: string }[];
}

const byId = (a: { id: string }, b: { id: string }): number => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0);

const jsonFile = (value: unknown): string => `${JSON.stringify(value, null, 2)}\n`;

/** Directory name of a named component: the trimmed name with runs of whitespace as dashes, or
 * the id when the name is empty (same rule as the SDK delivery's skill dirs). */
const dirNameOf = (capability: { readonly id: string; readonly name: string }): string => {
  const trimmed = capability.name.trim();
  if (trimmed.length > 0) return trimmed.replace(/\s+/gu, '-');
  return capability.id;
};

const buildHooksFile = (hooks: readonly RunHook[]): AgyHooksFile => {
  const postToolUse: { matcher?: string; hooks: unknown[] }[] = [];
  const stop: { type: 'command'; command: string }[] = [];
  for (const hook of hooks) {
    const command = hook.command;
    if (SHELL_SYNTAX_RE.test(command)) {
      throw new Error(
        `agy hook ${hook.id} command carries shell syntax agy cannot execute (no shell: ${command})`,
      );
    }
    const agyEvent = HOOK_EVENT_TO_AGY[hook.event];
    if (agyEvent === undefined) continue; // before_tool: not delivered by this issue (see above)
    const entry = { type: 'command' as const, command };
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
  const file: AgyHooksFile = {
    ...(postToolUse.length > 0 ? { PostToolUse: postToolUse } : {}),
    ...(stop.length > 0 ? { Stop: stop } : {}),
  };
  return file;
};

/** Writes the run's `.agents/` tree under `configDir` and returns its path. Throws on a
 * capability the measured surface cannot carry (shell-syntax hook command, unreadable source);
 * the transport turns that into a typed start error, never a crash. */
export async function prepareAgyDelivery(
  configDir: string,
  capabilities: readonly AgyDeliveryCapability[],
): Promise<string> {
  const agentsDir = join(configDir, '.agents');
  await mkdir(agentsDir, { recursive: true, mode: 0o700 });
  const sorted = [...capabilities].sort(byId);

  const hooks = sorted.filter((capability): capability is RunHook => capability.kind === 'hook');
  const hooksFile = buildHooksFile(hooks);
  // Only files with content are written: an empty hooks.json or mcp_config.json is not part of the
  // measured surface, so the writer never bets a run on an unmeasured shape.
  if (hooksFile.PostToolUse !== undefined || hooksFile.Stop !== undefined) {
    await writeFile(join(agentsDir, 'hooks.json'), jsonFile(hooksFile), { encoding: 'utf8', mode: 0o600 });
  }

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
