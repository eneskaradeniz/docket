// Run argv for claude-code: strict MCP on every run keeps ambient MCP and connectors out (probe #1015, SDK4).
export const CLAUDE_CODE_STRICT_MCP_CONFIG_FLAG = '--strict-mcp-config';

/** argv fragment for the SDK-spawned CLI; strict isolation on every run. */
export function claudeCodeRunIsolationArgv(_deliversRunScopedMcp?: boolean): readonly string[] {
  return [CLAUDE_CODE_STRICT_MCP_CONFIG_FLAG];
}

export function claudeCodeRunIsolationSdkOptions(
  _deliversRunScopedMcp?: boolean,
): { readonly strictMcpConfig: true } {
  return { strictMcpConfig: true };
}
