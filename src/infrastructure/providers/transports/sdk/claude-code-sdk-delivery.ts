// Claude-code SDK capability delivery (probe #1015, SDK1–SDK4): run-scoped plugin dir, inline settings, append-only context.
import { cp, mkdir, mkdtemp, readFile, rm, stat, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import type { SdkPluginConfig } from '@anthropic-ai/claude-agent-sdk';
import type { CapabilityDef, HookEvent } from '../../../../domain/index';

const HOOK_EVENT_TO_SDK: Readonly<Record<HookEvent, string>> = {
  before_tool: 'PreToolUse',
  after_tool: 'PostToolUse',
  after_write: 'PostToolUse',
  run_end: 'Stop',
};

/** PostToolUse matcher for file-writing tools (Claude Code hooks reference: tool name regex). */
const AFTER_WRITE_TOOL_MATCHER = 'Write|Edit|MultiEdit|NotebookEdit';

const skillDirName = (capability: Extract<CapabilityDef, { kind: 'skill' }>): string => {
  const trimmed = capability.name.trim();
  if (trimmed.length > 0) return trimmed.replace(/\s+/gu, '-');
  return capability.id;
};

const byId = (left: CapabilityDef, right: CapabilityDef): number =>
  left.id < right.id ? -1 : left.id > right.id ? 1 : 0;

export interface ClaudeCodeSdkDelivery {
  readonly plugins: readonly SdkPluginConfig[];
  readonly skills?: 'all';
  readonly settings: Record<string, unknown>;
  readonly systemAppend: string;
  readonly cleanup: () => Promise<void>;
}

export async function prepareClaudeCodeSdkDelivery(
  runDir: string,
  roleInstructions: string,
  capabilities: readonly CapabilityDef[],
  _deliversRunScopedMcp: boolean,
): Promise<ClaudeCodeSdkDelivery> {
  const skipMcpDiscovery = true;
  const sorted = [...capabilities].sort(byId);
  const skillCaps = sorted.filter((capability): capability is Extract<CapabilityDef, { kind: 'skill' }> => capability.kind === 'skill');
  const hookCaps = sorted.filter((capability): capability is Extract<CapabilityDef, { kind: 'hook' }> => capability.kind === 'hook');
  const contextCaps = sorted.filter((capability): capability is Extract<CapabilityDef, { kind: 'context' }> => capability.kind === 'context');
  const pluginCaps = sorted.filter((capability): capability is Extract<CapabilityDef, { kind: 'plugin' }> => capability.kind === 'plugin');

  const removals: string[] = [];
  const plugins: SdkPluginConfig[] = [];

  let bundledPluginDir: string | undefined;
  if (skillCaps.length > 0) {
    bundledPluginDir = await mkdtemp(join(runDir, 'cc-run-plugin-'));
    removals.push(bundledPluginDir);
    await mkdir(join(bundledPluginDir, '.claude-plugin'), { recursive: true, mode: 0o700 });
    await writeFile(join(bundledPluginDir, '.claude-plugin', 'plugin.json'), '{}\n', { encoding: 'utf8', mode: 0o600 });
    for (const skill of skillCaps) {
      const targetDir = join(bundledPluginDir, 'skills', skillDirName(skill));
      const sourceStat = await stat(skill.path);
      if (sourceStat.isDirectory()) {
        await cp(skill.path, targetDir, { recursive: true, force: true });
        continue;
      }
      await mkdir(targetDir, { recursive: true, mode: 0o700 });
      const body = await readFile(skill.path, 'utf8');
      await writeFile(join(targetDir, 'SKILL.md'), body.endsWith('\n') ? body : `${body}\n`, {
        encoding: 'utf8',
        mode: 0o600,
      });
    }
    plugins.push({ type: 'local', path: bundledPluginDir, skipMcpDiscovery });
  }

  for (const plugin of pluginCaps) {
    if (plugin.source.kind !== 'path') continue;
    plugins.push({ type: 'local', path: plugin.source.path, skipMcpDiscovery });
  }

  const hooks: Record<string, unknown[]> = {};
  for (const hook of hookCaps) {
    const sdkEvent = HOOK_EVENT_TO_SDK[hook.event];
    const bucket = hooks[sdkEvent] ?? [];
    const entry =
      hook.event === 'after_write'
        ? { matcher: AFTER_WRITE_TOOL_MATCHER, hooks: [{ type: 'command', command: hook.command }] }
        : { hooks: [{ type: 'command', command: hook.command }] };
    bucket.push(entry);
    hooks[sdkEvent] = bucket;
  }

  const contextParts: string[] = [];
  for (const context of contextCaps) {
    const body = await readFile(context.path, 'utf8');
    contextParts.push(body.endsWith('\n') ? body.slice(0, -1) : body);
  }
  const appendParts = [roleInstructions, ...contextParts].filter((part) => part.length > 0);
  const systemAppend = appendParts.join('\n\n');

  const settings: Record<string, unknown> = { disableClaudeAiConnectors: true };
  if (Object.keys(hooks).length > 0) settings.hooks = hooks;

  const cleanup = async (): Promise<void> => {
    for (const path of removals) {
      await rm(path, { recursive: true, force: true });
    }
  };

  return {
    plugins,
    ...(skillCaps.length > 0 ? { skills: 'all' as const } : {}),
    settings,
    systemAppend,
    cleanup,
  };
}
