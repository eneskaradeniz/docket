// mcp/endpoint.test.ts — rule I-60: where the built MCP script is and how the app launches it.
import { readFileSync } from 'node:fs';
import { isAbsolute, join, resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

import { createMcpEndpoint, MCP_SCRIPT_NAME, mcpScriptPath } from './endpoint';

describe('mcpScriptPath', () => {
  it('I-60: the script sits beside the main bundle as docket-mcp.cjs, as an absolute path', () => {
    expect(MCP_SCRIPT_NAME).toBe('docket-mcp.cjs');
    expect(mcpScriptPath('/app/dist-electron')).toBe(join('/app/dist-electron', 'docket-mcp.cjs'));
    expect(isAbsolute(mcpScriptPath('relative/dist-electron'))).toBe(true);
    expect(mcpScriptPath('relative/dist-electron')).toBe(resolve('relative/dist-electron', 'docket-mcp.cjs'));
  });

  it('I-60: the vite build emits that file name from electron/docket-mcp.ts as CommonJS', () => {
    const config = readFileSync(resolve(__dirname, '../../../vite.config.ts'), 'utf8');
    expect(config).toContain("input: 'electron/docket-mcp.ts'");
    expect(config).toMatch(/format:\s*'cjs',\s*entryFileNames:\s*'docket-mcp\.cjs'/);
    expect(readFileSync(resolve(__dirname, '../../../electron/docket-mcp.ts'), 'utf8')).toContain('runStdioServer');
  });
});

describe('createMcpEndpoint', () => {
  it('I-60: the child is the app\'s own executable run as plain Node on the built script, reaching the data directory\'s socket', () => {
    const endpoint = createMcpEndpoint({
      dataDir: '/home/u/.docket',
      platform: 'linux',
      execPath: '/opt/Docket/docket',
      mainDir: '/opt/Docket/resources/app/dist-electron',
    });
    expect(endpoint).toEqual({
      socketPath: '/home/u/.docket/run/mcp.sock',
      command: '/opt/Docket/docket',
      args: [join('/opt/Docket/resources/app/dist-electron', 'docket-mcp.cjs')],
      env: { ELECTRON_RUN_AS_NODE: '1' },
    });
  });
});
