// Global codex argv before the app-server subcommand: drops ambient user config while login stays
// under CODEX_HOME (probe #1015, #1154, #1156).
export const CODEX_IGNORE_USER_CONFIG_FLAG = '--ignore-user-config';

/** argv fragment placed before `app-server` on every run. */
export function codexRunIsolationArgv(): readonly string[] {
  return [CODEX_IGNORE_USER_CONFIG_FLAG];
}
