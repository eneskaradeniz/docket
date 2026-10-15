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

const RUN_PLUGIN_MANIFEST_NAME = 'docket-run';

const yamlScalar = (value: string): string => {
  if (/^[\w.-]+$/u.test(value)) return value;
  return `"${value.replace(/\\/gu, '\\\\').replace(/"/gu, '\\"')}"`;
};

const yamlHasKey = (yaml: string, key: string): boolean =>
  new RegExp(`^${key}\\s*:`, 'mu').test(yaml);

const splitSkillFrontmatter = (
  body: string,
): { readonly hasBlock: boolean; readonly yaml: string; readonly rest: string } => {
  const normalized = body.endsWith('\n') ? body : `${body}\n`;
  const lines = normalized.split(/\r?\n/u);
  if (lines[0] !== '---') {
    return { hasBlock: false, yaml: '', rest: normalized };
  }
  let closeIndex = -1;
  for (let index = 1; index < lines.length; index += 1) {
    if (lines[index] === '---') {
      closeIndex = index;
      break;
    }
  }
  if (closeIndex === -1) {
    return { hasBlock: false, yaml: '', rest: normalized };
  }
  const yaml = lines.slice(1, closeIndex).join('\n');
  const restLines = lines.slice(closeIndex + 1);
  while (restLines.length > 0 && restLines[restLines.length - 1] === '') {
    restLines.pop();
  }
  const rest = restLines.length > 0 ? `${restLines.join('\n')}\n` : '\n';
  return { hasBlock: true, yaml, rest };
};

const ensureSkillMarkdownFrontmatter = (skillName: string, description: string, body: string): string => {
  const skillDescription = description.length > 0 ? description : skillName;
  const parsed = splitSkillFrontmatter(body);
  if (!parsed.hasBlock) {
    const rest = parsed.rest.endsWith('\n') ? parsed.rest : `${parsed.rest}\n`;
    return `---\nname: ${yamlScalar(skillName)}\ndescription: ${yamlScalar(skillDescription)}\n---\n${rest}`;
  }
  const additions: string[] = [];
  if (!yamlHasKey(parsed.yaml, 'name')) additions.push(`name: ${yamlScalar(skillName)}`);
  if (!yamlHasKey(parsed.yaml, 'description')) additions.push(`description: ${yamlScalar(skillDescription)}`);
  if (additions.length === 0) return body.endsWith('\n') ? body : `${body}\n`;
  const yaml =
    parsed.yaml.length > 0 ? `${parsed.yaml}\n${additions.join('\n')}` : additions.join('\n');
  const rest = parsed.rest.endsWith('\n') ? parsed.rest : `${parsed.rest}\n`;
  return `---\n${yaml}\n---\n${rest}`;
};

const materializeSkillMarkdown = async (
  skill: Extract<CapabilityDef, { kind: 'skill' }>,
  skillMarkdownPath: string,
): Promise<void> => {
  const dirName = skillDirName(skill);
  const description = skill.name.trim().length > 0 ? skill.name.trim() : dirName;
  const raw = await readFile(skillMarkdownPath, 'utf8');
  const withFrontmatter = ensureSkillMarkdownFrontmatter(dirName, description, raw);
  await writeFile(skillMarkdownPath, withFrontmatter, { encoding: 'utf8', mode: 0o600 });
};

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
    await writeFile(
      join(bundledPluginDir, '.claude-plugin', 'plugin.json'),
      `{"name":"${RUN_PLUGIN_MANIFEST_NAME}"}\n`,
      { encoding: 'utf8', mode: 0o600 },
    );
    for (const skill of skillCaps) {
      const targetDir = join(bundledPluginDir, 'skills', skillDirName(skill));
      const sourceStat = await stat(skill.path);
      if (sourceStat.isDirectory()) {
        await cp(skill.path, targetDir, { recursive: true, force: true });
        await materializeSkillMarkdown(skill, join(targetDir, 'SKILL.md'));
        continue;
      }
      await mkdir(targetDir, { recursive: true, mode: 0o700 });
      const body = await readFile(skill.path, 'utf8');
      const withFrontmatter = ensureSkillMarkdownFrontmatter(
        skillDirName(skill),
        skill.name.trim().length > 0 ? skill.name.trim() : skillDirName(skill),
        body,
      );
      await writeFile(join(targetDir, 'SKILL.md'), withFrontmatter, {
        encoding: 'utf8',
        mode: 0o600,
      });
    }
    plugins.push({ type: 'local', path: bundledPluginDir, skipMcpDiscovery });
  }

  for (const plugin of pluginCaps) {
    // A non-path plugin is already unsupported in translation (R-149: the setup warning fires and
    // the omission is recorded there), so it never reaches the run list this loop sees; skipping it
    // here is the second line of defence, not the place the loss is surfaced.
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

  // A-402: the CLI's automatic project memory is off on every run — this inline setting plus the
  // route environment's CLAUDE_CODE_DISABLE_AUTO_MEMORY=1 remove memory_paths from the SDK init
  // entirely, so Docket's own memory is the only memory a run sees.
  const settings: Record<string, unknown> = { disableClaudeAiConnectors: true, autoMemoryEnabled: false };
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
