// machine-capability-scan.test.ts — P-60: read-only machine import scan; secret names only;
// hook candidates are listed; one provider's parse failure yields nothing for that provider.
import { describe, expect, it } from 'vitest';

import { machineCandidateKey } from '../../../domain/index';

import { createMachineCapabilityScan, type MachineScanFs } from './machine-capability-scan';

const HOME = '/home/op';
const ROOT = `${HOME}/.claude`;

const memoryFs = (
  files: Readonly<Record<string, string>>,
  dirs: readonly string[] = [ROOT],
): MachineScanFs => ({
  async listEntries(dir) {
    if (dir === ROOT) return ['CLAUDE.md', '.claude.json', 'settings.json', 'skills'];
    if (dir === `${ROOT}/skills`) return ['fetch.md'];
    return [];
  },
  async listFiles(dir) {
    if (dir === `${ROOT}/skills`) return ['fetch.md'];
    return [];
  },
  async isDirectory(path) {
    return dirs.includes(path) || path === `${ROOT}/skills`;
  },
  async readText(path, maxBytes) {
    const content = files[path];
    if (content === undefined) return undefined;
    if (content.length > maxBytes) return undefined;
    return content;
  },
});

describe('createMachineCapabilityScan', () => {
  it('P-60: scanMachineCapabilities scans provider configs read-only without modifying files', async () => {
    const files: Record<string, string> = {
      [`${ROOT}/CLAUDE.md`]: '# Rules\n',
      [`${ROOT}/.claude.json`]: JSON.stringify({
        mcpServers: { db: { command: 'npx db', env: { API_TOKEN: 'secret-value' } } },
      }),
      [`${ROOT}/settings.json`]: JSON.stringify({ hooks: { onSave: 'echo' }, plugins: ['pack-a'] }),
      [`${ROOT}/skills/fetch.md`]: '# Fetch\n',
    };
    const before = JSON.stringify(files);
    const scan = createMachineCapabilityScan({ fs: memoryFs(files), homeDir: HOME });
    const found = await scan.scan(['claude-code']);
    expect(JSON.stringify(files)).toBe(before);
    expect(found.length).toBeGreaterThan(0);
  });

  it('P-60: secret values are stripped and only secretNames are returned', async () => {
    const planted = JSON.stringify({
      mcpServers: {
        srv: { command: 'npx', env: { API_TOKEN: 'sk-live', PLAIN: 'x' } },
      },
    });
    const scan = createMachineCapabilityScan({
      fs: memoryFs({ [`${ROOT}/.claude.json`]: planted, [`${ROOT}/CLAUDE.md`]: 'x' }),
      homeDir: HOME,
    });
    const found = await scan.scan(['claude-code']);
    const mcp = found.find((row) => row.kind === 'mcp' && row.name === 'srv');
    expect(mcp?.secretNames).toEqual(['API_TOKEN', 'PLAIN']);
    const serialized = JSON.stringify(found);
    for (const banned of ['sk-live', 'secret-value']) {
      expect(serialized.includes(banned), banned).toBe(false);
    }
  });

  it('P-60: hook candidates are listed alongside importable kinds', async () => {
    const scan = createMachineCapabilityScan({
      fs: memoryFs({
        [`${ROOT}/settings.json`]: JSON.stringify({ hooks: { fmt: 'tool' } }),
        [`${ROOT}/CLAUDE.md`]: 'rules',
      }),
      homeDir: HOME,
    });
    const found = await scan.scan(['claude-code']);
    expect(found.some((row) => row.kind === 'hook' && row.name === 'fmt')).toBe(true);
    expect(found.some((row) => row.kind === 'plugin')).toBe(false);
  });

  it('P-60: a parse failure in one provider config yields an empty list for that provider, not a throw', async () => {
    const fs: MachineScanFs = {
      async listEntries() {
        return ['CLAUDE.md', '.claude.json'];
      },
      async listFiles() {
        return [];
      },
      async isDirectory(path) {
        return path === ROOT;
      },
      async readText(path) {
        if (path === `${ROOT}/.claude.json`) return '{ not json';
        if (path === `${ROOT}/CLAUDE.md`) return 'ok';
        return undefined;
      },
    };
    const scan = createMachineCapabilityScan({ fs, homeDir: HOME });
    await expect(scan.scan(['claude-code'])).resolves.toEqual([
      { provider: 'claude-code', kind: 'context', name: 'CLAUDE.md', sourcePath: `${ROOT}/CLAUDE.md`, secretNames: [] },
    ]);
    await expect(scan.scan(['unknown-provider'])).resolves.toEqual([]);
  });

  it('buildDefinition maps mcp env keys to secretRef without embedding values', async () => {
    const state = JSON.stringify({ mcpServers: { db: { command: 'npx db', env: { API_TOKEN: 'hidden' } } } });
    const scan = createMachineCapabilityScan({
      fs: memoryFs({ [`${ROOT}/.claude.json`]: state }),
      homeDir: HOME,
    });
    const candidate = {
      provider: 'claude-code',
      kind: 'mcp' as const,
      name: 'db',
      sourcePath: `${ROOT}/.claude.json`,
      secretNames: ['API_TOKEN'],
    };
    const built = await scan.buildDefinition(candidate, 'db-tools', { API_TOKEN: 'vault-key' });
    expect(built.ok).toBe(true);
    if (built.ok) {
      expect(built.value).toMatchObject({
        kind: 'mcp',
        id: 'db-tools',
        command: 'npx db',
        env: { API_TOKEN: { secretRef: 'vault-key' } },
      });
      expect(JSON.stringify(built.value)).not.toContain('hidden');
    }
    expect(machineCandidateKey(candidate)).toContain('claude-code');
  });
});
