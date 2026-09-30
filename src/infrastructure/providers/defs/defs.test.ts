import { describe, expect, it } from 'vitest';
import { BUILTIN_PROVIDER_DEFS } from './builtin-provider-defs';
import { builtinProviderMarks } from './builtin-provider-marks';
import { isProviderDef } from './is-provider-def';
import type { LaunchInput, ProviderDef } from './provider-def';

// The guard clauses come from the provider-definition contract: plain data, unique ids,
// non-empty bins/versionArgs, one of four transports, streamDialect exactly for stream-json,
// a config mechanism the CLI really accepts, and a prompt that never travels via argv.
const ALL_TRANSPORTS = ['sdk', 'app-server', 'acp', 'stream-json'] as const;
const BUILTIN_IDS = ['claude-code', 'codex', 'agy', 'gemini', 'copilot', 'cursor', 'opencode'] as const;

const PROMPT_SENTINEL = 'docket prompt sentinel 7f3a with "quotes" and\nnewlines';

const LAUNCH_INPUT: LaunchInput = {
  prompt: PROMPT_SENTINEL,
  configDir: '/run/dir',
  resume: { sessionRef: 'session-1' },
};

function defById(id: string): ProviderDef {
  const def = BUILTIN_PROVIDER_DEFS.find((candidate) => candidate.id === id);
  if (def === undefined) throw new Error(`missing built-in def ${id}`);
  return def;
}

/** A minimal valid definition the guard-rejection tests perturb one clause at a time. */
function createValidDef(): ProviderDef {
  return {
    id: 'probe',
    displayName: 'Probe',
    bins: ['probe-cli'],
    versionArgs: ['--version'],
    transport: 'acp',
    config: { mechanism: 'env-var', name: 'PROBE_CONFIG_DIR' },
    buildLaunch: () => ({ args: [], env: { PROBE_CONFIG_DIR: '/run/dir' }, stdin: 'prompt' }),
    resume: 'protocol',
    capabilities: {
      structuredStream: true,
      permissionAsk: 'unknown',
      resume: true,
      mcp: true,
      hooks: 'unknown',
      skills: 'unknown',
      images: 'unknown',
      quotaReport: 'none',
      costReport: 'none',
    },
    installHint: { url: 'https://example.invalid/probe' },
    mark: null,
  };
}

function rejectsWith(def: unknown, message: string): void {
  expect(isProviderDef(def), message).toBe(false);
}

describe('provider definitions (P-1)', () => {
  it('P-1: every built-in definition passes isProviderDef and is plain data', () => {
    for (const def of BUILTIN_PROVIDER_DEFS) {
      expect(isProviderDef(def), def.id).toBe(true);
      for (const [key, value] of Object.entries(def) as [string, unknown][]) {
        if (key === 'buildLaunch') {
          expect(typeof value, def.id).toBe('function');
          continue;
        }
        if (value === undefined) continue;
        expect(['string', 'object'], `${def.id}.${key}`).toContain(typeof value);
        if (typeof value === 'object' && value !== null) {
          expect(Array.isArray(value) || value.constructor === Object, `${def.id}.${key}`).toBe(true);
        }
      }
    }
  });

  it('P-1: provider ids are unique across defs', () => {
    const ids = BUILTIN_PROVIDER_DEFS.map((def) => def.id);
    expect(new Set(ids).size).toBe(BUILTIN_PROVIDER_DEFS.length);
  });

  it('P-1: bins and versionArgs are non-empty arrays of non-empty strings', () => {
    for (const def of BUILTIN_PROVIDER_DEFS) {
      expect(def.bins.length, def.id).toBeGreaterThan(0);
      expect(def.versionArgs.length, def.id).toBeGreaterThan(0);
      for (const bin of def.bins) expect(bin.trim().length, `${def.id} bin`).toBeGreaterThan(0);
      for (const arg of def.versionArgs) expect(arg.trim().length, `${def.id} versionArg`).toBeGreaterThan(0);
    }
  });

  it('P-1: transport is one of the four transports, and the initial set rides the documented one', () => {
    for (const def of BUILTIN_PROVIDER_DEFS) {
      expect(ALL_TRANSPORTS, def.id).toContain(def.transport);
    }
    expect(defById('claude-code').transport).toBe('sdk');
    expect(defById('codex').transport).toBe('app-server');
    expect(defById('agy').transport).toBe('stream-json');
    for (const id of ['gemini', 'copilot', 'cursor', 'opencode']) {
      expect(defById(id).transport, id).toBe('acp');
    }
  });

  it('P-1: streamDialect is present exactly when transport is stream-json', () => {
    for (const def of BUILTIN_PROVIDER_DEFS) {
      if (def.transport === 'stream-json') {
        expect(typeof def.streamDialect, def.id).toBe('string');
        expect((def.streamDialect ?? '').length, def.id).toBeGreaterThan(0);
      } else {
        expect(def.streamDialect, def.id).toBeUndefined();
      }
    }
    expect(defById('agy').streamDialect).toBe('agy');
  });

  it('P-1: config carries the documented config-dir mechanism of its CLI', () => {
    const DOCUMENTED_CONFIG_NAME_BY_ID: Readonly<Record<string, string>> = {
      'claude-code': 'CLAUDE_CONFIG_DIR',
      codex: 'CODEX_HOME',
      agy: 'HOME',
      gemini: 'GEMINI_CLI_HOME',
      copilot: 'HOME',
      cursor: 'HOME',
      opencode: 'OPENCODE_CONFIG_DIR',
    };
    for (const def of BUILTIN_PROVIDER_DEFS) {
      expect(def.config.mechanism, def.id).toBe('env-var');
      expect(def.config.name, def.id).toBe(DOCUMENTED_CONFIG_NAME_BY_ID[def.id]);
    }
  });

  it('P-1: buildLaunch never places the prompt in argv and carries it on stdin', () => {
    for (const def of BUILTIN_PROVIDER_DEFS) {
      const launch = def.buildLaunch(LAUNCH_INPUT);
      expect(Array.isArray(launch.args), def.id).toBe(true);
      expect(JSON.stringify(launch.args), `${def.id} argv leaks the prompt`).not.toContain(PROMPT_SENTINEL);
      expect(launch.stdin, def.id).toBe('prompt');
      for (const [key, value] of Object.entries(launch.env)) {
        expect(key.length, `${def.id} env key`).toBeGreaterThan(0);
        expect(value, `${def.id} env value leaks the prompt`).not.toContain(PROMPT_SENTINEL);
      }
    }
  });

  it('P-1: BUILTIN_PROVIDER_DEFS contains exactly the seven built-in ids', () => {
    expect([...BUILTIN_PROVIDER_DEFS.map((def) => def.id)].sort()).toEqual([...BUILTIN_IDS].sort());
  });

  it('P-1: copilot, cursor and opencode declare permissionAsk true', () => {
    for (const id of ['copilot', 'cursor', 'opencode'] as const) {
      expect(defById(id).capabilities.permissionAsk, id).toBe(true);
    }
  });

  describe('guard rejections', () => {
    it('P-1: isProviderDef rejects a non-object value', () => {
      rejectsWith(null, 'null');
      rejectsWith('claude-code', 'string');
      rejectsWith(42, 'number');
      rejectsWith([] as unknown, 'array');
    });

    it('P-1: isProviderDef rejects a def without a non-empty id', () => {
      rejectsWith({ ...createValidDef(), id: '' }, 'empty id');
      rejectsWith({ ...createValidDef(), id: 7 }, 'non-string id');
      const { id: _missing, ...withoutId } = { ...createValidDef(), id: undefined } as unknown as Record<
        string,
        unknown
      >;
      rejectsWith(withoutId, 'missing id');
    });

    it('P-1: isProviderDef rejects a def with empty bins', () => {
      rejectsWith({ ...createValidDef(), bins: [] }, 'empty bins');
      rejectsWith({ ...createValidDef(), bins: [''] }, 'blank bin entry');
    });

    it('P-1: isProviderDef rejects a def with empty versionArgs', () => {
      rejectsWith({ ...createValidDef(), versionArgs: [] }, 'empty versionArgs');
      rejectsWith({ ...createValidDef(), versionArgs: ['--version', ''] }, 'blank versionArg entry');
    });

    it('P-1: isProviderDef rejects a def with an unknown transport', () => {
      rejectsWith({ ...createValidDef(), transport: 'tcp' }, 'unknown transport');
      rejectsWith({ ...createValidDef(), transport: '' }, 'empty transport');
    });

    it('P-1: isProviderDef rejects a stream-json def without a non-empty streamDialect', () => {
      const missing = { ...createValidDef(), transport: 'stream-json' } as unknown as Record<string, unknown>;
      delete missing.streamDialect;
      rejectsWith(missing, 'missing streamDialect');
      rejectsWith({ ...createValidDef(), transport: 'stream-json', streamDialect: '' }, 'empty streamDialect');
    });

    it('P-1: isProviderDef rejects a non-stream-json def that carries a streamDialect', () => {
      rejectsWith({ ...createValidDef(), streamDialect: 'probe' }, 'stray streamDialect');
    });

    it('P-1: isProviderDef rejects a def with an invalid config mechanism', () => {
      rejectsWith({ ...createValidDef(), config: { mechanism: 'registry', name: 'X' } }, 'unknown mechanism');
      rejectsWith({ ...createValidDef(), config: { mechanism: '', name: 'X' } }, 'empty mechanism');
    });

    it('P-1: isProviderDef rejects a def with a blank config name', () => {
      rejectsWith({ ...createValidDef(), config: { mechanism: 'env-var', name: '' } }, 'empty config name');
    });

    it('P-1: isProviderDef rejects a def whose buildLaunch is not a function', () => {
      rejectsWith({ ...createValidDef(), buildLaunch: 'nope' }, 'buildLaunch is a string');
      const { buildLaunch: _dropped, ...withoutBuildLaunch } = createValidDef() as unknown as Record<
        string,
        unknown
      >;
      rejectsWith(withoutBuildLaunch, 'buildLaunch missing');
    });

    it('P-1: isProviderDef rejects a def with an unknown resume mode', () => {
      rejectsWith({ ...createValidDef(), resume: 'replay' }, 'unknown resume');
      rejectsWith({ ...createValidDef(), resume: '' }, 'empty resume');
    });

    it('P-1: isProviderDef rejects a def with malformed capabilities', () => {
      rejectsWith({ ...createValidDef(), capabilities: { ...createValidDef().capabilities, structuredStream: 'yes' } }, 'structuredStream not boolean');
      rejectsWith({ ...createValidDef(), capabilities: { ...createValidDef().capabilities, permissionAsk: 'maybe' } }, 'permissionAsk not a Tri');
      rejectsWith({ ...createValidDef(), capabilities: { ...createValidDef().capabilities, quotaReport: 'sometimes' } }, 'unknown quotaReport');
      rejectsWith({ ...createValidDef(), capabilities: { ...createValidDef().capabilities, costReport: 'magic' } }, 'unknown costReport');
      const { capabilities: _dropped, ...withoutCapabilities } = createValidDef() as unknown as Record<
        string,
        unknown
      >;
      rejectsWith(withoutCapabilities, 'capabilities missing');
    });

    it('P-1: isProviderDef rejects a def without an install-hint url', () => {
      rejectsWith({ ...createValidDef(), installHint: { url: '' } }, 'empty url');
      rejectsWith({ ...createValidDef(), installHint: {} }, 'missing url');
    });

    it('P-25: isProviderDef rejects a mark that is neither null nor a non-empty { viewBox, path }', () => {
      rejectsWith({ ...createValidDef(), mark: { viewBox: '', path: 'M1 1' } }, 'empty viewBox');
      rejectsWith({ ...createValidDef(), mark: { viewBox: '0 0 24 24', path: '' } }, 'empty path');
      rejectsWith({ ...createValidDef(), mark: { viewBox: '0 0 24 24' } }, 'missing path');
      rejectsWith({ ...createValidDef(), mark: 'logo.svg' }, 'mark is a string');
      const { mark: _dropped, ...withoutMark } = createValidDef() as unknown as Record<string, unknown>;
      rejectsWith(withoutMark, 'mark missing');
    });
  });
});

describe('provider marks (P-25)', () => {
  it('P-25: the five providers with an official file carry one mark each — a single path in a 24×24 viewBox', () => {
    for (const id of ['claude-code', 'gemini', 'copilot', 'cursor', 'opencode'] as const) {
      const mark = defById(id).mark;
      expect(mark, id).not.toBeNull();
      expect(mark?.viewBox, id).toBe('0 0 24 24');
      // One path's own data: path commands only, never svg markup or a second shape.
      expect(mark?.path.length, id).toBeGreaterThan(0);
      expect(mark?.path, id).not.toMatch(/[<>]/);
    }
  });

  it('P-25: codex and agy carry mark null — a mark is never redrawn without an official file', () => {
    expect(defById('codex').mark).toBeNull();
    expect(defById('agy').mark).toBeNull();
  });

  it('P-25: builtinProviderMarks keys every built-in def id to its own mark', () => {
    const marks = builtinProviderMarks.marks();
    expect(Object.keys(marks).sort()).toEqual([...BUILTIN_IDS].sort());
    for (const def of BUILTIN_PROVIDER_DEFS) expect(marks[def.id], def.id).toEqual(def.mark);
  });
});
