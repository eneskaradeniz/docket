import { describe, expect, it } from 'vitest';
import { CODEX_IGNORE_USER_CONFIG_FLAG, codexRunIsolationArgv } from './codex-run-isolation';

describe('codex run isolation argv (#1154)', () => {
  it('#1154: codex run argv carries --ignore-user-config exactly once when run-scoped MCP is delivered', () => {
    const argv = codexRunIsolationArgv(true);
    expect(argv).toEqual([CODEX_IGNORE_USER_CONFIG_FLAG]);
    expect(argv.filter((arg) => arg === CODEX_IGNORE_USER_CONFIG_FLAG)).toHaveLength(1);
  });

  it('#1154: codex run argv omits --ignore-user-config when no run-scoped MCP is delivered', () => {
    expect(codexRunIsolationArgv(false)).toEqual([]);
  });
});
