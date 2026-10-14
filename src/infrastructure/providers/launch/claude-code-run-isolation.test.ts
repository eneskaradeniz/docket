import { describe, expect, it } from 'vitest';
import {
  CLAUDE_CODE_STRICT_MCP_CONFIG_FLAG,
  claudeCodeRunIsolationArgv,
  claudeCodeRunIsolationSdkOptions,
} from './claude-code-run-isolation';

describe('claude-code run isolation argv (#1154, #1164)', () => {
  it('#1164: claude-code run argv carries --strict-mcp-config exactly once on every run', () => {
    const argv = claudeCodeRunIsolationArgv();
    expect(argv).toEqual([CLAUDE_CODE_STRICT_MCP_CONFIG_FLAG]);
    expect(argv.filter((arg) => arg === CLAUDE_CODE_STRICT_MCP_CONFIG_FLAG)).toHaveLength(1);
    expect(claudeCodeRunIsolationSdkOptions()).toEqual({ strictMcpConfig: true });
  });

  it('#1164: strict MCP SDK options are always on regardless of delivered MCP', () => {
    expect(claudeCodeRunIsolationArgv(false)).toEqual([CLAUDE_CODE_STRICT_MCP_CONFIG_FLAG]);
    expect(claudeCodeRunIsolationSdkOptions(false)).toEqual({ strictMcpConfig: true });
  });
});
