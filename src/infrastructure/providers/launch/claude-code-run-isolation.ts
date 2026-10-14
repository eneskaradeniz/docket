// Run argv for claude-code when Docket delivers run-scoped MCP: the CLI flag keeps ambient MCP and
// connectors out so only inline / run-delivered servers load (probe #1015, #1154).
export const CLAUDE_CODE_STRICT_MCP_CONFIG_FLAG = '--strict-mcp-config';

/** argv fragment for the SDK-spawned CLI; empty when no run-scoped MCP is delivered. */
export function claudeCodeRunIsolationArgv(deliversRunScopedMcp: boolean): readonly string[] {
  return deliversRunScopedMcp ? [CLAUDE_CODE_STRICT_MCP_CONFIG_FLAG] : [];
}

export function claudeCodeRunIsolationSdkOptions(
  deliversRunScopedMcp: boolean,
): { readonly strictMcpConfig?: true } {
  return deliversRunScopedMcp ? { strictMcpConfig: true } : {};
}
