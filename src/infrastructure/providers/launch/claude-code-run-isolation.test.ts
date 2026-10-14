import { describe, expect, it } from 'vitest';
import {
  CLAUDE_CODE_STRICT_MCP_CONFIG_FLAG,
  claudeCodeRunIsolationArgv,
  claudeCodeRunIsolationSdkOptions,
} from './claude-code-run-isolation';

describe('claude-code run isolation argv (#1154)', () => {
  it('#1154: claude-code run argv carries --strict-mcp-config exactly once when run-scoped MCP is delivered', () => {
    const argv = claudeCodeRunIsolationArgv(true);
    expect(argv).toEqual([CLAUDE_CODE_STRICT_MCP_CONFIG_FLAG]);
    expect(argv.filter((arg) => arg === CLAUDE_CODE_STRICT_MCP_CONFIG_FLAG)).toHaveLength(1);
    expect(claudeCodeRunIsolationSdkOptions(true)).toEqual({ strictMcpConfig: true });
  });

  it('#1154: claude-code run argv omits --strict-mcp-config when no run-scoped MCP is delivered', () => {
    expect(claudeCodeRunIsolationArgv(false)).toEqual([]);
    expect(claudeCodeRunIsolationSdkOptions(false)).toEqual({});
  });
});
