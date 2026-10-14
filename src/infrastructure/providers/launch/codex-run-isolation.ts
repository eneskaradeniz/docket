// Global codex argv before the app-server subcommand: drops ambient user config while login stays
// under CODEX_HOME (probe #1015, #1154).
export const CODEX_IGNORE_USER_CONFIG_FLAG = '--ignore-user-config';

/** argv fragment placed before `app-server`; empty when no run-scoped MCP is delivered. */
export function codexRunIsolationArgv(deliversRunScopedMcp: boolean): readonly string[] {
  return deliversRunScopedMcp ? [CODEX_IGNORE_USER_CONFIG_FLAG] : [];
}
