import { access, mkdir, mkdtemp, readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { describe, expect, it } from 'vitest';
import { parseSlug } from '../../../../domain/index';
import { prepareClaudeCodeSdkDelivery } from './claude-code-sdk-delivery';

const slugOf = <B extends string>(input: string) => {
  const parsed = parseSlug<B>(input);
  if (!parsed.ok) throw new Error('fixture slug');
  return parsed.value;
};

describe('claude-code SDK delivery cleanup (#1164)', () => {
  it('removes the run plugin directory after cleanup runs', async () => {
    const runDir = await mkdtemp(join(tmpdir(), 'docket-cc-clean-'));
    const skillPath = join(runDir, 'skill.md');
    await writeFile(skillPath, '# skill\n', 'utf8');
    const delivery = await prepareClaudeCodeSdkDelivery(
      runDir,
      'role text',
      [{ kind: 'skill', id: slugOf<'capability'>('s'), name: 's', path: skillPath }],
      false,
    );
    const pluginPath = delivery.plugins[0]?.path;
    if (pluginPath === undefined) throw new Error('expected plugin path');
    await expect(access(pluginPath)).resolves.toBeUndefined();
    await delivery.cleanup();
    await expect(access(pluginPath)).rejects.toThrow();
  });

  it('after_write PostToolUse hooks carry a write-tool matcher; after_tool hooks do not', async () => {
    const runDir = await mkdtemp(join(tmpdir(), 'docket-cc-hook-'));
    const delivery = await prepareClaudeCodeSdkDelivery(
      runDir,
      '',
      [
        {
          kind: 'hook',
          id: slugOf<'capability'>('after-write'),
          name: 'After write',
          event: 'after_write',
          command: 'echo wrote',
        },
        {
          kind: 'hook',
          id: slugOf<'capability'>('after-tool'),
          name: 'After tool',
          event: 'after_tool',
          command: 'echo tool',
        },
      ],
      false,
    );
    const hooks = delivery.settings.hooks as Record<string, { readonly matcher?: string; readonly hooks: unknown[] }[]>;
    const post = hooks.PostToolUse;
    expect(post).toHaveLength(2);
    const writeHook = post.find((entry) => entry.hooks[0] && (entry.hooks[0] as { command: string }).command === 'echo wrote');
    const toolHook = post.find((entry) => entry.hooks[0] && (entry.hooks[0] as { command: string }).command === 'echo tool');
    expect(writeHook?.matcher).toBe('Write|Edit|MultiEdit|NotebookEdit');
    expect(toolHook?.matcher).toBeUndefined();
    await delivery.cleanup();
  });

  it('materializes a skill directory with all files; a single file becomes SKILL.md', async () => {
    const runDir = await mkdtemp(join(tmpdir(), 'docket-cc-skill-'));
    const fileSkill = join(runDir, 'one-file.md');
    await writeFile(fileSkill, '# lone file\n', 'utf8');
    const dirSkill = join(runDir, 'skill-bundle');
    await mkdir(dirSkill, { recursive: true });
    await writeFile(join(dirSkill, 'SKILL.md'), '# bundle root\n', 'utf8');
    await writeFile(join(dirSkill, 'helper.txt'), 'extra\n', 'utf8');

    const delivery = await prepareClaudeCodeSdkDelivery(
      runDir,
      '',
      [
        { kind: 'skill', id: slugOf<'capability'>('file'), name: 'file-skill', path: fileSkill },
        { kind: 'skill', id: slugOf<'capability'>('dir'), name: 'dir-skill', path: dirSkill },
      ],
      false,
    );
    const pluginPath = delivery.plugins[0]?.path;
    if (pluginPath === undefined) throw new Error('expected plugin path');
    expect(await readFile(join(pluginPath, 'skills', 'file-skill', 'SKILL.md'), 'utf8')).toBe(
      '---\nname: file-skill\ndescription: file-skill\n---\n# lone file\n',
    );
    expect(await readFile(join(pluginPath, 'skills', 'dir-skill', 'SKILL.md'), 'utf8')).toBe(
      '---\nname: dir-skill\ndescription: dir-skill\n---\n# bundle root\n',
    );
    expect(await readFile(join(pluginPath, 'skills', 'dir-skill', 'helper.txt'), 'utf8')).toBe('extra\n');
    await delivery.cleanup();
  });

  it('writes a named plugin manifest for bundled run skills (#1175)', async () => {
    const runDir = await mkdtemp(join(tmpdir(), 'docket-cc-manifest-'));
    const skillPath = join(runDir, 'skill.md');
    await writeFile(skillPath, '# skill\n', 'utf8');
    const delivery = await prepareClaudeCodeSdkDelivery(
      runDir,
      '',
      [{ kind: 'skill', id: slugOf<'capability'>('s'), name: 'my-skill', path: skillPath }],
      false,
    );
    const pluginPath = delivery.plugins[0]?.path;
    if (pluginPath === undefined) throw new Error('expected plugin path');
    expect(await readFile(join(pluginPath, '.claude-plugin', 'plugin.json'), 'utf8')).toBe('{"name":"docket-run"}\n');
    await delivery.cleanup();
  });

  it('adds frontmatter to SKILL.md without an opening block (#1175)', async () => {
    const runDir = await mkdtemp(join(tmpdir(), 'docket-cc-fm-none-'));
    const skillPath = join(runDir, 'skill.md');
    await writeFile(skillPath, '# body only\n', 'utf8');
    const delivery = await prepareClaudeCodeSdkDelivery(
      runDir,
      '',
      [{ kind: 'skill', id: slugOf<'capability'>('s'), name: 'alpha', path: skillPath }],
      false,
    );
    const pluginPath = delivery.plugins[0]?.path;
    if (pluginPath === undefined) throw new Error('expected plugin path');
    expect(await readFile(join(pluginPath, 'skills', 'alpha', 'SKILL.md'), 'utf8')).toBe(
      '---\nname: alpha\ndescription: alpha\n---\n# body only\n',
    );
    await delivery.cleanup();
  });

  it('adds only missing name when frontmatter already has description (#1175)', async () => {
    const runDir = await mkdtemp(join(tmpdir(), 'docket-cc-fm-partial-'));
    const skillPath = join(runDir, 'skill.md');
    await writeFile(skillPath, '---\ndescription: From source\n---\n# keep\n', 'utf8');
    const delivery = await prepareClaudeCodeSdkDelivery(
      runDir,
      '',
      [{ kind: 'skill', id: slugOf<'capability'>('s'), name: 'beta', path: skillPath }],
      false,
    );
    const pluginPath = delivery.plugins[0]?.path;
    if (pluginPath === undefined) throw new Error('expected plugin path');
    expect(await readFile(join(pluginPath, 'skills', 'beta', 'SKILL.md'), 'utf8')).toBe(
      '---\ndescription: From source\nname: beta\n---\n# keep\n',
    );
    await delivery.cleanup();
  });

  it('leaves SKILL.md unchanged when frontmatter already has name and description (#1175)', async () => {
    const runDir = await mkdtemp(join(tmpdir(), 'docket-cc-fm-full-'));
    const skillPath = join(runDir, 'skill.md');
    const source = '---\nname: custom\ndescription: Custom desc\n---\n# intact\n';
    await writeFile(skillPath, source, 'utf8');
    const delivery = await prepareClaudeCodeSdkDelivery(
      runDir,
      '',
      [{ kind: 'skill', id: slugOf<'capability'>('s'), name: 'ignored-dir', path: skillPath }],
      false,
    );
    const pluginPath = delivery.plugins[0]?.path;
    if (pluginPath === undefined) throw new Error('expected plugin path');
    expect(await readFile(join(pluginPath, 'skills', 'ignored-dir', 'SKILL.md'), 'utf8')).toBe(source);
    await delivery.cleanup();
  });

  it('ignores a lone leading --- line without a closing block (#1175)', async () => {
    const runDir = await mkdtemp(join(tmpdir(), 'docket-cc-fm-fake-'));
    const skillPath = join(runDir, 'skill.md');
    await writeFile(skillPath, '---\nnot frontmatter\n# real\n', 'utf8');
    const delivery = await prepareClaudeCodeSdkDelivery(
      runDir,
      '',
      [{ kind: 'skill', id: slugOf<'capability'>('s'), name: 'gamma', path: skillPath }],
      false,
    );
    const pluginPath = delivery.plugins[0]?.path;
    if (pluginPath === undefined) throw new Error('expected plugin path');
    expect(await readFile(join(pluginPath, 'skills', 'gamma', 'SKILL.md'), 'utf8')).toBe(
      '---\nname: gamma\ndescription: gamma\n---\n---\nnot frontmatter\n# real\n',
    );
    await delivery.cleanup();
  });

  it('cleanup is safe when materialization fails before any directory is registered', async () => {
    const runDir = await mkdtemp(join(tmpdir(), 'docket-cc-fail-'));
    await expect(
      prepareClaudeCodeSdkDelivery(
        runDir,
        'role text',
        [{ kind: 'context', id: slugOf<'capability'>('c'), name: 'c', path: join(runDir, 'missing.md') }],
        false,
      ),
    ).rejects.toThrow();
    const entries = await import('node:fs/promises').then((fs) => fs.readdir(runDir));
    expect(entries.some((name) => name.startsWith('cc-run-plugin-'))).toBe(false);
  });
});

describe('claude-code SDK delivery automatic memory (A-402)', () => {
  it('A-402: the inline settings carry autoMemoryEnabled false beside disableClaudeAiConnectors true on every run', async () => {
    const runDir = await mkdtemp(join(tmpdir(), 'docket-cc-automem-'));
    const delivery = await prepareClaudeCodeSdkDelivery(
      runDir,
      'role text',
      [
        {
          kind: 'hook',
          id: slugOf<'capability'>('after-write'),
          name: 'After write',
          event: 'after_write',
          command: 'echo wrote',
        },
      ],
      false,
    );
    // A capability-laden run keeps both run-level switches: the hook only adds settings.hooks.
    expect(delivery.settings.disableClaudeAiConnectors).toBe(true);
    expect(delivery.settings.autoMemoryEnabled).toBe(false);
    await delivery.cleanup();
  });
});
