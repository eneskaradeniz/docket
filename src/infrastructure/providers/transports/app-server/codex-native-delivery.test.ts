import { mkdtemp, readFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import type { Slug } from '../../../../domain/index';

const slugOf = <B extends string>(input: string): Slug<B> => input as Slug<B>;
import { TRANSLATION_TABLE } from '../../registry/capability-registry';
import { materializeCodexNativeCapabilities } from './codex-native-delivery';

describe('codex native capability delivery (P-59, probe #1015)', () => {
  it('P-59: a native skill is copied into .agents/skills under the run directory', async () => {
    const runDir = await mkdtemp(join(tmpdir(), 'docket-codex-skill-'));
    const libraryRoot = await mkdtemp(join(tmpdir(), 'docket-codex-lib-'));
    const skillPath = join(libraryRoot, 'craft.md');
    await writeFile(skillPath, '# Craft skill\n', 'utf8');
    await materializeCodexNativeCapabilities(
      runDir,
      [{ kind: 'skill', id: slugOf<'capability'>('craft'), name: 'craft', path: skillPath }],
      TRANSLATION_TABLE,
    );
    const written = await readFile(join(runDir, '.agents', 'skills', 'craft', 'SKILL.md'), 'utf8');
    expect(written).toBe('# Craft skill\n');
  });

  it('P-59: a native plugin path bundle is copied under .codex/plugins in the run directory', async () => {
    const runDir = await mkdtemp(join(tmpdir(), 'docket-codex-plugin-'));
    const source = await mkdtemp(join(tmpdir(), 'docket-codex-plugin-src-'));
    await writeFile(join(source, 'plugin.json'), '{}\n', 'utf8');
    await materializeCodexNativeCapabilities(
      runDir,
      [
        {
          kind: 'plugin',
          id: slugOf<'capability'>('bundle'),
          name: 'probe-plugin',
          source: { kind: 'path', path: source },
          includes: [],
        },
      ],
      TRANSLATION_TABLE,
    );
    expect(await readFile(join(runDir, '.codex', 'plugins', 'probe-plugin', 'plugin.json'), 'utf8')).toBe('{}\n');
  });
});
