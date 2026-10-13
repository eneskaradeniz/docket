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

  const createFs = (
    files: Readonly<Record<string, string>>,
    dirs: readonly string[],
    dirEntries?: Readonly<Record<string, readonly string[]>>,
  ): MachineScanFs => ({
    async listEntries(dir) {
      return dirEntries?.[dir] ?? [];
    },
    async listFiles(dir) {
      return dirEntries?.[dir] ?? [];
    },
    async isDirectory(path) {
      return dirs.includes(path);
    },
    async readText(path, maxBytes) {
      const content = files[path];
      if (content === undefined) return undefined;
      if (content.length > maxBytes) return undefined;
      return content;
    },
  });

  it('P-60: codex scan lists MCP, skills, context files and plugins read-only without modifying files', async () => {
    const codexRoot = `${HOME}/.codex`;
    const toml = [
      '[mcp_servers.db]',
      'command = "npx db"',
      'args = ["--stdio"]',
      '',
      '[mcp_servers.db.env]',
      'API_TOKEN = "env-token-sample"',
      'PLAIN_VAR = "plain"',
      '',
      '[plugins.pack-a]',
      'enabled = true',
    ].join('\n');

    const files: Record<string, string> = {
      [`${codexRoot}/AGENTS.md`]: '# Codex instructions\n',
      [`${codexRoot}/config.toml`]: toml,
      [`${codexRoot}/skills/calc.md`]: '# Calculator\n',
    };
    const before = JSON.stringify(files);
    const fs = createFs(
      files,
      [codexRoot, `${codexRoot}/skills`],
      { [`${codexRoot}/skills`]: ['calc.md'] },
    );
    const scan = createMachineCapabilityScan({ fs, homeDir: HOME });
    const found = await scan.scan(['codex']);

    expect(JSON.stringify(files)).toBe(before);
    expect(found).toHaveLength(4);

    const context = found.find((r) => r.kind === 'context');
    expect(context).toEqual({
      provider: 'codex',
      kind: 'context',
      name: 'AGENTS.md',
      sourcePath: `${codexRoot}/AGENTS.md`,
      secretNames: [],
    });

    const mcp = found.find((r) => r.kind === 'mcp');
    expect(mcp).toEqual({
      provider: 'codex',
      kind: 'mcp',
      name: 'db',
      sourcePath: `${codexRoot}/config.toml`,
      secretNames: ['API_TOKEN', 'PLAIN_VAR'],
    });

    const plugin = found.find((r) => r.kind === 'plugin');
    expect(plugin).toEqual({
      provider: 'codex',
      kind: 'plugin',
      name: 'pack-a',
      sourcePath: `${codexRoot}/config.toml`,
      secretNames: [],
    });

    const skill = found.find((r) => r.kind === 'skill');
    expect(skill).toEqual({
      provider: 'codex',
      kind: 'skill',
      name: 'calc',
      sourcePath: `${codexRoot}/skills/calc.md`,
      secretNames: [],
    });

    const serialized = JSON.stringify(found);
    expect(serialized).not.toContain('env-token-sample');
    expect(serialized).not.toContain('plain');

    if (mcp !== undefined) {
      const built = await scan.buildDefinition(mcp, 'codex-db', { API_TOKEN: 'ref-1', PLAIN_VAR: 'ref-2' });
      expect(built.ok).toBe(true);
      if (built.ok) {
        expect(built.value).toMatchObject({
          kind: 'mcp',
          id: 'codex-db',
          name: 'db',
          command: 'npx db',
          args: ['--stdio'],
          env: {
            API_TOKEN: { secretRef: 'ref-1' },
            PLAIN_VAR: { secretRef: 'ref-2' },
          },
        });
      }
    }
  });

  it('P-60: copilot scan lists MCP, skills, context files and plugins read-only without modifying files', async () => {
    const copilotRoot = `${HOME}/.copilot`;
    const mcpJson = JSON.stringify({
      mcpServers: {
        fs: {
          type: 'stdio',
          command: 'node fs.js',
          args: ['--root', '/tmp'],
          env: { FS_SECRET: 'fs-secret-sample' },
        },
      },
    });

    const files: Record<string, string> = {
      [`${copilotRoot}/copilot-instructions.md`]: '# Copilot instructions\n',
      [`${copilotRoot}/mcp-config.json`]: mcpJson,
      [`${copilotRoot}/skills/review.md`]: '# Code review\n',
    };
    const before = JSON.stringify(files);
    const fs = createFs(
      files,
      [copilotRoot, `${copilotRoot}/skills`, `${copilotRoot}/plugins`],
      {
        [`${copilotRoot}/skills`]: ['review.md'],
        [`${copilotRoot}/plugins`]: ['linter'],
      },
    );
    const scan = createMachineCapabilityScan({ fs, homeDir: HOME });
    const found = await scan.scan(['copilot']);

    expect(JSON.stringify(files)).toBe(before);
    expect(found).toHaveLength(4);

    const context = found.find((r) => r.kind === 'context');
    expect(context).toEqual({
      provider: 'copilot',
      kind: 'context',
      name: 'copilot-instructions.md',
      sourcePath: `${copilotRoot}/copilot-instructions.md`,
      secretNames: [],
    });

    const mcp = found.find((r) => r.kind === 'mcp');
    expect(mcp).toEqual({
      provider: 'copilot',
      kind: 'mcp',
      name: 'fs',
      sourcePath: `${copilotRoot}/mcp-config.json`,
      secretNames: ['FS_SECRET'],
    });

    const plugin = found.find((r) => r.kind === 'plugin');
    expect(plugin).toEqual({
      provider: 'copilot',
      kind: 'plugin',
      name: 'linter',
      sourcePath: `${copilotRoot}/plugins/linter`,
      secretNames: [],
    });

    const skill = found.find((r) => r.kind === 'skill');
    expect(skill).toEqual({
      provider: 'copilot',
      kind: 'skill',
      name: 'review',
      sourcePath: `${copilotRoot}/skills/review.md`,
      secretNames: [],
    });

    const serialized = JSON.stringify(found);
    expect(serialized).not.toContain('fs-secret-sample');

    if (mcp !== undefined) {
      const built = await scan.buildDefinition(mcp, 'copilot-fs', { FS_SECRET: 'vault-fs' });
      expect(built.ok).toBe(true);
      if (built.ok) {
        expect(built.value).toMatchObject({
          kind: 'mcp',
          id: 'copilot-fs',
          name: 'fs',
          command: 'node fs.js',
          args: ['--root', '/tmp'],
          env: { FS_SECRET: { secretRef: 'vault-fs' } },
        });
      }
    }
  });

  it('P-60: opencode scan lists MCP, skills, context files and plugins read-only without modifying files', async () => {
    const opencodeRoot = `${HOME}/.config/opencode`;
    const configJson = JSON.stringify({
      mcp: {
        git: {
          type: 'local',
          command: ['git-mcp', '--serve'],
          env: { GH_TOKEN: 'gh-secret-sample' },
        },
      },
      plugins: ['opencode-plugin-a', { package: 'opencode-plugin-b' }],
    });

    const files: Record<string, string> = {
      [`${opencodeRoot}/AGENTS.md`]: '# OpenCode instructions\n',
      [`${opencodeRoot}/opencode.json`]: configJson,
      [`${opencodeRoot}/skills/deploy.md`]: '# Deploy\n',
    };
    const before = JSON.stringify(files);
    const fs = createFs(
      files,
      [opencodeRoot, `${opencodeRoot}/skills`, `${opencodeRoot}/plugins`],
      {
        [`${opencodeRoot}/skills`]: ['deploy.md'],
        [`${opencodeRoot}/plugins`]: ['custom-tool'],
      },
    );
    const scan = createMachineCapabilityScan({ fs, homeDir: HOME });
    const found = await scan.scan(['opencode']);

    expect(JSON.stringify(files)).toBe(before);
    expect(found).toHaveLength(6);

    const context = found.find((r) => r.kind === 'context');
    expect(context).toEqual({
      provider: 'opencode',
      kind: 'context',
      name: 'AGENTS.md',
      sourcePath: `${opencodeRoot}/AGENTS.md`,
      secretNames: [],
    });

    const mcp = found.find((r) => r.kind === 'mcp');
    expect(mcp).toEqual({
      provider: 'opencode',
      kind: 'mcp',
      name: 'git',
      sourcePath: `${opencodeRoot}/opencode.json`,
      secretNames: ['GH_TOKEN'],
    });

    const plugins = found.filter((r) => r.kind === 'plugin');
    expect(plugins.map((p) => p.name).sort()).toEqual(['custom-tool', 'opencode-plugin-a', 'opencode-plugin-b']);

    const skill = found.find((r) => r.kind === 'skill');
    expect(skill).toEqual({
      provider: 'opencode',
      kind: 'skill',
      name: 'deploy',
      sourcePath: `${opencodeRoot}/skills/deploy.md`,
      secretNames: [],
    });

    const serialized = JSON.stringify(found);
    expect(serialized).not.toContain('gh-secret-sample');

    if (mcp !== undefined) {
      const built = await scan.buildDefinition(mcp, 'opencode-git', { GH_TOKEN: 'vault-gh' });
      expect(built.ok).toBe(true);
      if (built.ok) {
        expect(built.value).toMatchObject({
          kind: 'mcp',
          id: 'opencode-git',
          name: 'git',
          command: 'git-mcp',
          args: ['--serve'],
          env: { GH_TOKEN: { secretRef: 'vault-gh' } },
        });
      }
    }
  });

  it('P-60: unevidenced providers return an empty list without error', async () => {
    const scan = createMachineCapabilityScan({
      fs: memoryFs({}),
      homeDir: HOME,
    });
    await expect(scan.scan(['gemini'])).resolves.toEqual([]);
    await expect(scan.scan(['gemini-cli'])).resolves.toEqual([]);
    await expect(scan.scan(['unsupported-unknown'])).resolves.toEqual([]);
  });
});
