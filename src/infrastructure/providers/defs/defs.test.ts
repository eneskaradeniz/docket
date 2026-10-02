import { describe, expect, it } from 'vitest';
import { BUILTIN_PROVIDER_DEFS } from './builtin-provider-defs';
import { builtinProviderMarks } from './builtin-provider-marks';
import { isProviderDef } from './is-provider-def';
import {
  effortFlagArgs,
  effortModelId,
  effortOfProviderLevel,
  providerLevelOf,
  type LaunchInput,
  type ProviderDef,
} from './provider-def';

// The guard clauses come from the provider-definition contract: plain data, unique ids,
// non-empty bins/versionArgs, one of four transports, streamDialect exactly for stream-json,
// a config mechanism the CLI really accepts, and a prompt that never travels via argv.
const ALL_TRANSPORTS = ['sdk', 'app-server', 'acp', 'stream-json'] as const;
const BUILTIN_IDS = ['claude-code', 'codex', 'agy', 'copilot', 'cursor', 'opencode'] as const;

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
    for (const id of ['copilot', 'cursor', 'opencode']) {
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

  it('P-8: the opencode launch environment is exactly the config dir plus the documented Claude-compatibility switch', () => {
    expect(defById('opencode').buildLaunch(LAUNCH_INPUT).env).toEqual({
      OPENCODE_CONFIG_DIR: '/run/dir',
      OPENCODE_DISABLE_CLAUDE_CODE: '1',
    });
  });

  it('P-8: a baseEnv carrying a different OPENCODE_DISABLE_CLAUDE_CODE is overridden by the opencode literal', () => {
    // The transports spread the allowlisted machine env first and the def's launch env last;
    // the literal must survive that order so the machine value can never re-enable the read.
    const baseEnv: Readonly<Record<string, string>> = { OPENCODE_DISABLE_CLAUDE_CODE: '0' };
    const env = { ...baseEnv, ...defById('opencode').buildLaunch(LAUNCH_INPUT).env };
    expect(env.OPENCODE_DISABLE_CLAUDE_CODE).toBe('1');
  });

  it('P-1: BUILTIN_PROVIDER_DEFS contains exactly the six built-in ids', () => {
    expect([...BUILTIN_PROVIDER_DEFS.map((def) => def.id)].sort()).toEqual([...BUILTIN_IDS].sort());
  });

  it('P-1: copilot, cursor and opencode declare permissionAsk true', () => {
    for (const id of ['copilot', 'cursor', 'opencode'] as const) {
      expect(defById(id).capabilities.permissionAsk, id).toBe(true);
    }
  });

  it('P-1: isProviderDef accepts a def whose costReport is credits', () => {
    expect(
      isProviderDef({
        ...createValidDef(),
        capabilities: { ...createValidDef().capabilities, costReport: 'credits' },
      }),
    ).toBe(true);
  });

  it('P-1: isProviderDef accepts optional watchdog timeouts, 0 included, and rejects bad ones', () => {
    expect(isProviderDef({ ...createValidDef(), firstOutputTimeoutMs: 0, inactivityTimeoutMs: 5000 })).toBe(true);
    rejectsWith({ ...createValidDef(), firstOutputTimeoutMs: -1 }, 'negative first output');
    rejectsWith({ ...createValidDef(), inactivityTimeoutMs: 1.5 }, 'fractional inactivity');
    rejectsWith({ ...createValidDef(), inactivityTimeoutMs: '600' }, 'string inactivity');
  });

  describe('effort parameter (P-41)', () => {
    const EFFORT_ARG_BY_ID: Readonly<Record<string, unknown>> = {
      'claude-code': { kind: 'request-field', name: 'effort' },
      codex: { kind: 'request-field', name: 'effort' },
      agy: { kind: 'flag', flag: '--effort' },
      copilot: { kind: 'flag', flag: '--reasoning-effort' },
      opencode: { kind: 'session-option', category: 'thought_level' },
    };

    it('P-41: each built-in declares exactly its documented effort parameter, and cursor declares none', () => {
      for (const def of BUILTIN_PROVIDER_DEFS) {
        expect(def.effortArg, def.id).toEqual(EFFORT_ARG_BY_ID[def.id]);
      }
      expect(defById('cursor').effortArg).toBeUndefined();
    });

    it('P-41: a flag definition puts the flag and the level in argv, and nothing when the effort is absent', () => {
      for (const id of ['agy', 'copilot']) {
        const def = defById(id);
        const flag = def.effortArg?.kind === 'flag' ? def.effortArg.flag : undefined;
        expect(flag, id).toBeDefined();
        const withEffort = def.buildLaunch({ ...LAUNCH_INPUT, effort: 'high' }).args;
        const at = withEffort.indexOf(flag ?? '');
        expect(withEffort.slice(at, at + 2), id).toEqual([flag, 'high']);
        expect(def.buildLaunch(LAUNCH_INPUT).args, id).not.toContain(flag);
      }
    });

    it('P-41: a definition without a flag parameter ignores the effort and its launch is unchanged', () => {
      for (const id of ['claude-code', 'codex', 'cursor', 'opencode']) {
        const def = defById(id);
        expect(def.buildLaunch({ ...LAUNCH_INPUT, effort: 'high' }), id).toEqual(def.buildLaunch(LAUNCH_INPUT));
      }
    });

    it('P-41: isProviderDef accepts a valid effortArg of each kind and rejects a malformed one', () => {
      for (const effortArg of [
        { kind: 'flag', flag: '--x' },
        { kind: 'request-field', name: 'x' },
        { kind: 'session-option', category: 'x' },
      ]) {
        expect(isProviderDef({ ...createValidDef(), effortArg })).toBe(true);
      }
      for (const effortArg of [{ kind: 'flag' }, { kind: 'flag', flag: '' }, { kind: 'other' }, 'high', null]) {
        rejectsWith({ ...createValidDef(), effortArg }, JSON.stringify(effortArg));
      }
    });
  });

  describe('agy resume', () => {
    it('P-22: agy passes the session reference with --conversation when resuming, and nothing otherwise', () => {
      const def = defById('agy');
      const resumed = def.buildLaunch(LAUNCH_INPUT).args;
      const at = resumed.indexOf('--conversation');
      expect(resumed.slice(at, at + 2)).toEqual(['--conversation', 'session-1']);
      const fresh = def.buildLaunch({ prompt: PROMPT_SENTINEL, configDir: '/run/dir' }).args;
      expect(fresh).not.toContain('--conversation');
      expect(fresh).not.toContain('session-1');
    });
  });

  describe('effort suffix and level names (P-43)', () => {
    it('P-43: a model-suffix effort joins the model, the separator and the provider level name', () => {
      const arg = { kind: 'model-suffix', separator: '/' } as const;
      expect(effortModelId(arg, 'big-model', 'high')).toBe('big-model/high');
      expect(effortModelId(arg, 'big-model', 'none', { none: 'off' })).toBe('big-model/off');
      expect(effortModelId(arg, 'big-model', undefined)).toBe('big-model');
      expect(effortModelId(arg, undefined, 'high')).toBeUndefined();
      // Another kind never rewrites the model id, and a suffix never travels as a flag.
      expect(effortModelId({ kind: 'flag', flag: '--effort' }, 'big-model', 'high')).toBe('big-model');
      expect(effortFlagArgs(arg, 'high')).toEqual([]);
    });

    it('P-43: a level name map translates both ways and the flag builder applies it', () => {
      const names = { none: 'off', xhigh: 'extra' } as const;
      expect(providerLevelOf(names, 'none')).toBe('off');
      expect(effortOfProviderLevel(names, 'off')).toBe('none');
      expect(effortOfProviderLevel(names, 'extra')).toBe('xhigh');
      expect(effortFlagArgs({ kind: 'flag', flag: '--think' }, 'xhigh', names)).toEqual(['--think', 'extra']);
      // Without a map the level's own name is the provider's, in both directions.
      expect(providerLevelOf(undefined, 'high')).toBe('high');
      expect(effortOfProviderLevel(undefined, 'high')).toBe('high');
    });

    it('P-43: an effort with no provider name is not sent, and a provider value naming no level is never offered', () => {
      const names = { none: 'off' } as const;
      expect(providerLevelOf(names, 'high')).toBeUndefined();
      expect(effortFlagArgs({ kind: 'flag', flag: '--think' }, 'high', names)).toEqual([]);
      expect(effortModelId({ kind: 'model-suffix', separator: ':' }, 'm', 'high', names)).toBe('m');
      expect(effortOfProviderLevel(names, 'default')).toBeUndefined();
      expect(effortOfProviderLevel(undefined, 'default')).toBeUndefined();
    });

    it('P-43: isProviderDef accepts configId, category and model-suffix efforts and checks levelNames', () => {
      for (const effortArg of [
        { kind: 'session-option', configId: 'thinking' },
        { kind: 'session-option', category: 'thought_level' },
        { kind: 'model-suffix', separator: '/' },
      ]) {
        expect(isProviderDef({ ...createValidDef(), effortArg }), JSON.stringify(effortArg)).toBe(true);
      }
      for (const effortArg of [
        { kind: 'session-option', category: 'a', configId: 'b' },
        { kind: 'session-option' },
        { kind: 'session-option', configId: '' },
        { kind: 'model-suffix' },
        { kind: 'model-suffix', separator: '' },
      ]) {
        rejectsWith({ ...createValidDef(), effortArg }, JSON.stringify(effortArg));
      }
      expect(isProviderDef({ ...createValidDef(), levelNames: { none: 'off', max: 'ultra-think' } })).toBe(true);
      for (const levelNames of [{ bogus: 'x' }, { none: '' }, { none: 'same', low: 'same' }, 'off', ['off']]) {
        rejectsWith({ ...createValidDef(), levelNames }, JSON.stringify(levelNames));
      }
    });
  });

  describe('isolation fields (P-44)', () => {
    it('P-44: isProviderDef accepts well-formed isolation and telemetryOff and rejects malformed ones', () => {
      expect(
        isProviderDef({
          ...createValidDef(),
          isolation: { env: { X: '1' }, args: ['--no-x'], runScopedHome: 'HOME' },
          telemetryOff: ['--no-telemetry'],
        }),
      ).toBe(true);
      expect(isProviderDef({ ...createValidDef(), isolation: {} })).toBe(true);
      for (const isolation of [{ env: { X: 1 } }, { args: [''] }, { args: 'x' }, { runScopedHome: '' }, 'on', null]) {
        rejectsWith({ ...createValidDef(), isolation }, JSON.stringify(isolation));
      }
      for (const telemetryOff of ['--x', [''], [1]]) {
        rejectsWith({ ...createValidDef(), telemetryOff }, JSON.stringify(telemetryOff));
      }
    });
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

    it('P-25: isProviderDef rejects a mark that is neither null nor a non-empty { viewBox, path, fillRule }', () => {
      rejectsWith({ ...createValidDef(), mark: { viewBox: '', path: 'M1 1', fillRule: 'nonzero' } }, 'empty viewBox');
      rejectsWith({ ...createValidDef(), mark: { viewBox: '0 0 24 24', path: '', fillRule: 'nonzero' } }, 'empty path');
      rejectsWith(
        { ...createValidDef(), mark: { viewBox: '0 0 24 24', path: 'M1 1', fillRule: 'winding' } },
        'unknown fillRule',
      );
      rejectsWith({ ...createValidDef(), mark: { viewBox: '0 0 24 24', path: 'M1 1' } }, 'missing fillRule');
      rejectsWith({ ...createValidDef(), mark: { viewBox: '0 0 24 24' } }, 'missing path');
      rejectsWith({ ...createValidDef(), mark: 'logo.svg' }, 'mark is a string');
      const { mark: _dropped, ...withoutMark } = createValidDef() as unknown as Record<string, unknown>;
      rejectsWith(withoutMark, 'mark missing');
    });
  });
});

describe('provider marks (P-25)', () => {
  it('P-25: all six providers carry one mark each — a single path in a 24×24 viewBox', () => {
    for (const def of BUILTIN_PROVIDER_DEFS) {
      const mark = defById(def.id).mark;
      expect(mark, def.id).not.toBeNull();
      expect(mark?.viewBox, def.id).toBe('0 0 24 24');
      // One path's own data: path commands only, never svg markup or a second shape.
      expect(mark?.path.length, def.id).toBeGreaterThan(0);
      expect(mark?.path, def.id).not.toMatch(/[<>]/);
    }
  });

  it('P-26: the four official marks draw nonzero and the two placed stand-ins draw evenodd', () => {
    for (const id of ['claude-code', 'copilot', 'cursor', 'opencode'] as const) {
      expect(defById(id).mark?.fillRule, id).toBe('nonzero');
    }
    // Both stand-in files set fill-rule="evenodd" (codex also clip-rule="evenodd"); the paths
    // are injected unmodified and byte-checked against those files — the prefixes pin them.
    expect(defById('codex').mark?.fillRule).toBe('evenodd');
    expect(defById('agy').mark?.fillRule).toBe('evenodd');
    expect(defById('codex').mark?.path.startsWith('M8.086.457')).toBe(true);
    expect(defById('agy').mark?.path.startsWith('M21.751 22.607')).toBe(true);
  });

  it('P-25: builtinProviderMarks keys every built-in def id to its own mark', () => {
    const marks = builtinProviderMarks.marks();
    expect(Object.keys(marks).sort()).toEqual([...BUILTIN_IDS].sort());
    for (const def of BUILTIN_PROVIDER_DEFS) expect(marks[def.id], def.id).toEqual(def.mark);
  });
});
