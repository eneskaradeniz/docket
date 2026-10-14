import { describe, expect, it } from 'vitest';
import { CODEX_IGNORE_USER_CONFIG_FLAG, codexRunIsolationArgv } from './codex-run-isolation';

describe('codex run isolation argv (#1156)', () => {
  it('P-44: every codex run argv carries --ignore-user-config exactly once', () => {
    for (const _case of ['with run-scoped MCP', 'without run-scoped MCP']) {
      const argv = codexRunIsolationArgv();
      expect(argv).toEqual([CODEX_IGNORE_USER_CONFIG_FLAG]);
      expect(argv.filter((arg) => arg === CODEX_IGNORE_USER_CONFIG_FLAG)).toHaveLength(1);
    }
  });

  it('#1156: codex run argv carries --ignore-user-config exactly once when run-scoped MCP is delivered', () => {
    const argv = codexRunIsolationArgv();
    expect(argv).toEqual([CODEX_IGNORE_USER_CONFIG_FLAG]);
    expect(argv.filter((arg) => arg === CODEX_IGNORE_USER_CONFIG_FLAG)).toHaveLength(1);
  });

  it('#1156: codex run argv carries --ignore-user-config exactly once when no run-scoped MCP is delivered', () => {
    const argv = codexRunIsolationArgv();
    expect(argv).toEqual([CODEX_IGNORE_USER_CONFIG_FLAG]);
    expect(argv.filter((arg) => arg === CODEX_IGNORE_USER_CONFIG_FLAG)).toHaveLength(1);
  });
});
