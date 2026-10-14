import { access, mkdtemp, writeFile } from 'node:fs/promises';
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
