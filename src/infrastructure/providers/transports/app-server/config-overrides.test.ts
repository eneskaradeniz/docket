import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { BUILTIN_PROVIDER_DEFS } from '../../defs/index';
import { writeRunConfig } from '../../launch/index';
import { mcpConfigOverrideArgs } from './config-overrides';

const codex = BUILTIN_PROVIDER_DEFS.find((def) => def.id === 'codex');

describe('codex keeps the CLI login (P-44)', () => {
  it('P-44: the codex definition redirects no home and its launch sets no config variable', async () => {
    expect(codex?.config).toEqual({ mechanism: 'none' });
    const runDir = await mkdtemp(join(tmpdir(), 'docket-codex-'));
    const config = await writeRunConfig(runDir, codex as NonNullable<typeof codex>, []);
    expect(config.env).toEqual({});
    const launch = codex?.buildLaunch({ prompt: 'x', configDir: config.configDir });
    expect(launch?.env).toEqual({});
    expect(JSON.stringify(launch)).not.toContain('CODEX_HOME');
    expect(JSON.stringify(launch)).not.toContain(config.configDir);
  });

  it('P-44: the run MCP servers travel as -c overrides with TOML-quoted values', () => {
    const args = mcpConfigOverrideArgs({
      'repo-tools': { command: '/bin/tool', args: ['--a', 'b"c'], env: { K: 'v' } },
    });
    expect(args).toEqual([
      '-c', 'mcp_servers."repo-tools".command="/bin/tool"',
      '-c', 'mcp_servers."repo-tools".args=["--a","b\\"c"]',
      '-c', 'mcp_servers."repo-tools".env={"K"="v"}',
    ]);
  });

  it('P-44: no MCP server and no env add no override', () => {
    expect(mcpConfigOverrideArgs({})).toEqual([]);
    expect(mcpConfigOverrideArgs({ a: { command: 'c', args: [], env: {} } })).toEqual([
      '-c', 'mcp_servers."a".command="c"',
      '-c', 'mcp_servers."a".args=[]',
    ]);
  });
});
