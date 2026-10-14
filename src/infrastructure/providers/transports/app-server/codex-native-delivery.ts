// Codex run-scoped native skill and plugin delivery (P-59, probe #1015): skills under
// `<runDir>/.agents/skills/<name>/SKILL.md`, plugins under `<runDir>/.codex/plugins/<name>/`.
import { cp, mkdir, readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import type { CapabilityDef } from '../../../../domain/index';
import { supportFor, type TranslationRow } from '../../../../domain/index';

const CODEX_PROVIDER = 'codex';

const skillDirName = (capability: Extract<CapabilityDef, { kind: 'skill' }>): string => {
  const trimmed = capability.name.trim();
  if (trimmed.length > 0) return trimmed.replace(/\s+/gu, '-');
  return capability.id;
};

export async function materializeCodexNativeCapabilities(
  runDir: string,
  capabilities: readonly CapabilityDef[],
  table: readonly TranslationRow[],
): Promise<void> {
  for (const capability of capabilities) {
    if (supportFor(table, CODEX_PROVIDER, capability.kind).support !== 'native') continue;
    if (capability.kind === 'skill') {
      const targetDir = join(runDir, '.agents', 'skills', skillDirName(capability));
      await mkdir(targetDir, { recursive: true, mode: 0o700 });
      const body = await readFile(capability.path, 'utf8');
      await writeFile(join(targetDir, 'SKILL.md'), body.endsWith('\n') ? body : `${body}\n`, {
        encoding: 'utf8',
        mode: 0o600,
      });
      continue;
    }
    if (capability.kind === 'plugin' && capability.source.kind === 'path') {
      const targetDir = join(runDir, '.codex', 'plugins', capability.name);
      await cp(capability.source.path, targetDir, { recursive: true, force: true });
    }
  }
}
