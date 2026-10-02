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
const BUILTIN_IDS = ['claude-code', 'codex', 'agy', 'copilot', 'cursor', 'opencode', 'hermes', 'kilo', 'atomcode', 'grok-build', 'reasonix', 'vibe', 'mimo', 'qwen', 'qoder', 'kiro', 'kimi', 'amp'] as const;
// Definitions whose vendor ships no mark file: `mark: null` is their honest state, never a redrawn stand-in.
const MARKLESS_IDS: readonly string[] = ['kilo', 'hermes', 'atomcode', 'grok-build', 'reasonix', 'vibe', 'mimo', 'qwen', 'qoder', 'kiro', 'kimi', 'amp'];

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
    expect(defById('amp').transport).toBe('stream-json');
    for (const id of ['copilot', 'cursor', 'opencode', 'hermes', 'kilo', 'atomcode', 'grok-build', 'reasonix', 'vibe', 'mimo', 'qwen', 'qoder', 'kimi']) {
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
    expect(defById('amp').streamDialect).toBe('amp');
  });

  it('P-1: config carries the documented config-dir mechanism of its CLI', () => {
    const DOCUMENTED_CONFIG_NAME_BY_ID: Readonly<Record<string, string>> = {
      'claude-code': '',
      codex: '',
      agy: 'HOME',
      copilot: 'HOME',
      cursor: 'HOME',
      opencode: 'OPENCODE_CONFIG_DIR',
      hermes: '',
      kilo: 'KILO_CONFIG_DIR',
      'grok-build': '',
      atomcode: '',
      reasonix: '',
      vibe: '',
      mimo: '',
      qwen: '',
      qoder: '',
      kiro: '',
      kimi: '',
      amp: '',
    };
    for (const def of BUILTIN_PROVIDER_DEFS) {
      if (def.config.mechanism === 'none') {
        // The CLI's login lives in its own home, so no variable is set for it (hermes, codex).
        expect(DOCUMENTED_CONFIG_NAME_BY_ID[def.id], def.id).toBe('');
        continue;
      }
      expect(def.config.mechanism, def.id).toBe('env-var');
      expect(def.config.name, def.id).toBe(DOCUMENTED_CONFIG_NAME_BY_ID[def.id]);
    }
  });

  it('P-44: claude-code sets no config-dir variable — its login lives in its own config directory', () => {
    const def = defById('claude-code');
    expect(def.config).toEqual({ mechanism: 'none' });
    const launch = def.buildLaunch(LAUNCH_INPUT);
    expect(launch.env).toEqual({});
    expect(JSON.stringify(launch)).not.toContain(LAUNCH_INPUT.configDir);
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

  it('P-44: the kilo launch carries the run-scoped config dir and the unverified Claude-file switches, never the auto-approve switch', () => {
    const kilo = defById('kilo');
    const launch = kilo.buildLaunch({ ...LAUNCH_INPUT, effort: 'high', model: 'kilo/anthropic/claude-opus-5' });
    expect(launch.args).toEqual(['acp']);
    expect(launch.env).toEqual({ KILO_CONFIG_DIR: '/run/dir' });
    expect(kilo.isolation?.env).toEqual({ KILO_DISABLE_CLAUDE_CODE: '1', KILO_DISABLE_CLAUDE_CODE_SKILLS: '1' });
    expect(JSON.stringify([launch, kilo.isolation])).not.toContain('--auto');
    expect(kilo.levelNames).toBeUndefined();
    expect(kilo.capabilities.permissionAsk).toBe('unknown');
  });

  it('P-44: the grok-build launch has no GROK_HOME and no run dir, keeps agent options before stdio, runs without the shared leader, never auto-approves, and claims no isolation', () => {
    const grok = defById('grok-build');
    const launch = grok.buildLaunch({ ...LAUNCH_INPUT, effort: 'xhigh' });
    expect(launch.args).toEqual(['agent', '--no-leader', '--reasoning-effort', 'xhigh', 'stdio']);
    expect(grok.buildLaunch(LAUNCH_INPUT).args).toEqual(['agent', '--no-leader', 'stdio']);
    expect(launch.env['GROK_TELEMETRY_ENABLED']).toBe('0');
    expect(grok.config).toEqual({ mechanism: 'none' });
    expect(launch.env).toEqual({ GROK_TELEMETRY_ENABLED: '0' });
    expect(JSON.stringify(launch)).not.toContain('/run/dir');
    expect(JSON.stringify(launch)).not.toMatch(/always-approve|yolo|bypass/i);
    expect(grok.isolation).toBeUndefined();
    expect(grok.telemetryOff).toBeUndefined();
    expect(grok.levelNames).toBeUndefined();
    expect(grok.resume).toBe('protocol');
    expect(grok.capabilities).toMatchObject({ permissionAsk: 'unknown', mcp: true, images: false, quotaReport: 'none' });
    expect(grok.authProbe).toEqual({ args: [], presenceFile: { homeEnv: 'GROK_HOME', homeDir: '.grok', file: 'auth.json' } });
  });

  it('P-44: the reasonix launch is the bare acp subcommand with no environment, no permission preset and no run-scoped home, and claims no isolation', () => {
    const reasonix = defById('reasonix');
    const launch = reasonix.buildLaunch({ ...LAUNCH_INPUT, effort: 'high', model: 'deepseek-pro/deepseek-v4-pro' });
    expect(launch.args).toEqual(['acp']);
    expect(launch.env).toEqual({});
    expect(reasonix.config).toEqual({ mechanism: 'none' });
    expect(reasonix.isolation).toBeUndefined();
    expect(JSON.stringify(launch)).not.toContain('danger-full-access');
    expect(reasonix.resume).toBe('protocol');
    expect(reasonix.bins).toEqual(['reasonix']);
    expect(reasonix.authProbe).toEqual({ args: ['doctor', '--json'], parse: 'provider-key-present' });
    expect(reasonix.capabilities).toMatchObject({ images: false, quotaReport: 'none', costReport: 'none', permissionAsk: 'unknown' });
  });

  it('P-1: BUILTIN_PROVIDER_DEFS contains exactly the built-in ids', () => {
    expect([...BUILTIN_PROVIDER_DEFS.map((def) => def.id)].sort()).toEqual([...BUILTIN_IDS].sort());
  });

  it('P-1: copilot, cursor, opencode and hermes declare permissionAsk true', () => {
    for (const id of ['copilot', 'cursor', 'opencode', 'hermes'] as const) {
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
      kilo: { kind: 'session-option', configId: 'effort' },
      'grok-build': { kind: 'flag', flag: '--reasoning-effort' },
      atomcode: { kind: 'session-option', configId: 'reasoning_effort' },
      reasonix: { kind: 'session-option', configId: 'effort' },
      vibe: { kind: 'session-option', category: 'thinking' },
      mimo: { kind: 'model-suffix', separator: '/' },
      qoder: { kind: 'session-option', category: 'thought_level' },
      kiro: { kind: 'flag', flag: '--effort' },
      kimi: { kind: 'session-option', category: 'thought_level' },
      // The CLI documents no effort flag: the mode bundles the effort with the model (P-41: ignored).
      amp: undefined,
    };

    it('P-41: each built-in declares exactly its documented effort parameter, and cursor and hermes declare none', () => {
      for (const def of BUILTIN_PROVIDER_DEFS) {
        expect(def.effortArg, def.id).toEqual(EFFORT_ARG_BY_ID[def.id]);
      }
      expect(defById('cursor').effortArg).toBeUndefined();
      expect(defById('hermes').effortArg).toBeUndefined();
    });

    it('P-41: a flag definition puts the flag and the level in argv, and nothing when the effort is absent', () => {
      for (const id of ['agy', 'copilot', 'grok-build']) {
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
      for (const id of ['claude-code', 'codex', 'cursor', 'opencode', 'hermes', 'kilo', 'atomcode', 'reasonix', 'vibe', 'mimo', 'qwen', 'qoder', 'kimi', 'amp']) {
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

  describe('amp launch', () => {
    it('P-9: amp launches execute mode with the stream-json output and the run-scoped settings file, and never an approval bypass', () => {
      const def = defById('amp');
      const launch = def.buildLaunch({ prompt: PROMPT_SENTINEL, configDir: '/run/dir' });
      expect(launch.args).toEqual(['--execute', '--stream-json']);
      expect(launch.stdin).toBe('prompt');
      // The run's own settings file replaces the user's, so no permission preset of theirs can
      // reach a run and Docket writes none of its own. Only the update check is switched off.
      expect(launch.env).toEqual({ AMP_SKIP_UPDATE_CHECK: '1', AMP_SETTINGS_FILE: '/run/dir/mcp.json' });
      expect(JSON.stringify(launch)).not.toContain('dangerously');
      expect(JSON.stringify(launch)).not.toContain('--mode');
    });

    it('P-22: amp resumes through threads continue with the thread id, and nothing otherwise', () => {
      const def = defById('amp');
      const resumed = def.buildLaunch(LAUNCH_INPUT).args;
      expect(resumed.slice(0, 3)).toEqual(['threads', 'continue', 'session-1']);
      expect(resumed).toContain('--execute');
      expect(resumed).toContain('--stream-json');
      const fresh = def.buildLaunch({ prompt: PROMPT_SENTINEL, configDir: '/run/dir' }).args;
      expect(fresh).not.toContain('threads');
      expect(fresh).not.toContain('session-1');
    });

    it('P-41: amp takes the mode from the run model and nothing else — the CLI has no effort flag', () => {
      const def = defById('amp');
      expect(def.effortArg).toBeUndefined();
      const withModel = def.buildLaunch({ ...LAUNCH_INPUT, model: 'high' }).args;
      const at = withModel.indexOf('--mode');
      expect(withModel.slice(at, at + 2)).toEqual(['--mode', 'high']);
      expect(def.buildLaunch(LAUNCH_INPUT).args).not.toContain('--mode');
      // An effort the CLI cannot take changes nothing (P-41: absent parameter ignores it).
      expect(def.buildLaunch({ ...LAUNCH_INPUT, effort: 'high' })).toEqual(def.buildLaunch(LAUNCH_INPUT));
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

    it('P-44: isProviderDef accepts config none without a name and still rejects a blank name elsewhere', () => {
      expect(isProviderDef({ ...createValidDef(), config: { mechanism: 'none' } })).toBe(true);
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

describe('hermes definition (P-35)', () => {
  const hermes = (): ProviderDef => defById('hermes');

  it('P-35: hermes launches the CLI in its ACP mode, reads the version from --version and resumes through the protocol', () => {
    expect(hermes().bins).toEqual(['hermes']);
    expect(hermes().versionArgs).toEqual(['--version']);
    expect(hermes().buildLaunch(LAUNCH_INPUT)).toEqual({ args: ['acp'], env: {}, stdin: 'prompt' });
    expect(hermes().resume).toBe('protocol');
  });

  it('P-35: no hermes launch ever carries an approval bypass or a redirected home', () => {
    for (const input of [LAUNCH_INPUT, { ...LAUNCH_INPUT, effort: 'high' as const }, { prompt: 'x', configDir: '/run/dir' }]) {
      const launch = hermes().buildLaunch(input);
      expect(launch.args.join(' ')).not.toMatch(/yolo|accept-hooks|ignore|safe-mode/i);
      expect(Object.keys(launch.env).join(' ')).not.toMatch(/YOLO|HERMES_HOME|ACCEPT_HOOKS/i);
    }
    expect(hermes().effortArg).toBeUndefined();
  });

  it('P-44: hermes declares no isolation, so the cap applies and the CLI reads its own configuration', () => {
    expect(hermes().isolation).toBeUndefined();
    expect(hermes().telemetryOff).toBeUndefined();
  });

  it('P-45: the hermes login probe is the ACP session with the documented refusal as its logout, and the def stays valid', () => {
    expect(hermes().authProbe).toEqual({
      args: ['acp'],
      acpSession: { notLoggedIn: { rpcCode: -32603, textContains: 'not connected to any AI provider' } },
    });
    expect(hermes().helpNeedsLogin).toBeUndefined();
    expect(isProviderDef(hermes())).toBe(true);
    const base = createValidDef();
    for (const acpSession of [{}, { notLoggedIn: { rpcCode: 1.5, textContains: 'x' } }, { notLoggedIn: { rpcCode: -1, textContains: '' } }, 'x']) {
      rejectsWith({ ...base, authProbe: { args: ['acp'], acpSession } }, JSON.stringify(acpSession));
    }
  });
});

describe('atomcode definition (P-35)', () => {
  const atomcode = (): ProviderDef => defById('atomcode');

  it('P-35: atomcode launches its ACP subcommand with telemetry off, prompts over stdin and resumes through the protocol', () => {
    expect(atomcode().bins).toEqual(['atomcode']);
    expect(atomcode().versionArgs).toEqual(['--version']);
    expect(atomcode().buildLaunch(LAUNCH_INPUT)).toEqual({ args: ['acp', '--no-telemetry'], env: {}, stdin: 'prompt' });
    expect(atomcode().resume).toBe('protocol');
    expect(isProviderDef(atomcode())).toBe(true);
  });

  it('P-44: the atomcode launch has no home variable and always carries --no-telemetry', () => {
    expect(atomcode().config).toEqual({ mechanism: 'none' });
    for (const input of [LAUNCH_INPUT, { ...LAUNCH_INPUT, effort: 'high' as const, model: 'glm-5.2' }, { prompt: 'x', configDir: '/run/dir' }]) {
      const launch = atomcode().buildLaunch(input);
      expect(launch.env).toEqual({});
      expect(launch.args).toContain('--no-telemetry');
    }
  });

  it('P-44: the telemetry-off flag is declared and no launch ever carries an approval bypass, a bypass mode or a redirected home', () => {
    expect(atomcode().telemetryOff).toEqual(['--no-telemetry']);
    expect(atomcode().isolation).toBeUndefined();
    for (const input of [LAUNCH_INPUT, { ...LAUNCH_INPUT, effort: 'max' as const, model: 'glm-5.2' }, { prompt: 'x', configDir: '/run/dir' }]) {
      const launch = atomcode().buildLaunch(input);
      expect(launch.args.join(' ')).not.toMatch(/-y\b|dangerously|skip-permissions|bypass|accept_edits/i);
      expect(Object.keys(launch.env)).toEqual([]);
    }
  });

  it('P-43: effort is the reasoning_effort session option and only none, high and max have CLI names', () => {
    expect(atomcode().effortArg).toEqual({ kind: 'session-option', configId: 'reasoning_effort' });
    expect(atomcode().levelNames).toEqual({ none: 'off', high: 'high', max: 'max' });
  });

  it('P-45: the login probe reads only the documented logged-out text, nothing here needs a login, and the CLI login is never a probe', () => {
    expect(atomcode().authProbe).toEqual({ args: ['status', '--no-telemetry'], parse: 'logged-out-text', loggedOutText: 'Not logged in' });
    expect(atomcode().helpNeedsLogin).toBeUndefined();
    const base = createValidDef();
    rejectsWith({ ...base, authProbe: { args: ['status'], parse: 'logged-out-text' } }, 'logged-out-text without its text');
    rejectsWith({ ...base, authProbe: { args: ['status'], parse: 'logged-out-text', loggedOutText: '' } }, 'empty text');
    for (const probe of [atomcode().authProbe, atomcode().versionArgs, atomcode().helpArgs]) {
      expect(JSON.stringify(probe)).not.toMatch(/login|logout|upgrade|uninstall/);
    }
  });

  it('P-1: permissionAsk stays unknown until a scripted request proves it, and no quota or cost is reported', () => {
    expect(atomcode().capabilities).toMatchObject({ permissionAsk: 'unknown', quotaReport: 'none', costReport: 'none' });
  });
});

describe('provider marks (P-25)', () => {
  it('P-25a: every provider with a mark file carries one — a single path in a 24×24 viewBox — and the markless built-ins (kilo, hermes, atomcode, grok-build, vibe, mimo, qwen, qoder, kiro, kimi) carry null', () => {
    for (const def of BUILTIN_PROVIDER_DEFS) {
      const mark = defById(def.id).mark;
      if (MARKLESS_IDS.includes(def.id)) {
        expect(mark, def.id).toBeNull();
        continue;
      }
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

describe('vibe definition (P-35)', () => {
  const vibe = (): ProviderDef => defById('vibe');

  it('P-35: vibe launches its own ACP binary with no arguments, answers the shared probes, prompts over stdin and resumes through the protocol', () => {
    expect(vibe().bins).toEqual(['vibe-acp']);
    expect(vibe().versionArgs).toEqual(['--version']);
    expect(vibe().helpArgs).toEqual(['--help']);
    expect(vibe().buildLaunch(LAUNCH_INPUT)).toEqual({ args: [], env: {}, stdin: 'prompt' });
    expect(vibe().resume).toBe('protocol');
    expect(isProviderDef(vibe())).toBe(true);
  });

  it('P-44: the key lives in the CLI home, so the launch never sets VIBE_HOME, never auto-approves and claims no isolation', () => {
    expect(vibe().config).toEqual({ mechanism: 'none' });
    expect(vibe().isolation).toBeUndefined();
    expect(vibe().telemetryOff).toBeUndefined();
    for (const input of [LAUNCH_INPUT, { ...LAUNCH_INPUT, effort: 'high' as const }]) {
      const launch = vibe().buildLaunch(input);
      expect(Object.keys(launch.env)).not.toContain('VIBE_HOME');
      expect(JSON.stringify(launch)).not.toMatch(/yolo|auto-approve|--agent|--trust/);
    }
  });

  it('P-43: effort is the thinking session option, with off standing for none and every other CLI level named as is', () => {
    expect(vibe().effortArg).toEqual({ kind: 'session-option', category: 'thinking' });
    expect(vibe().levelNames).toEqual({ none: 'off', low: 'low', medium: 'medium', high: 'high', max: 'max' });
    expect(providerLevelOf(vibe().levelNames, 'none')).toBe('off');
    expect(providerLevelOf(vibe().levelNames, 'xhigh')).toBeUndefined();
  });

  it('P-45: there is no login probe and no probe that could start a login', () => {
    expect(vibe().authProbe).toBeUndefined();
    expect(vibe().helpNeedsLogin).toBeUndefined();
    for (const probe of [vibe().versionArgs, vibe().helpArgs]) {
      expect(JSON.stringify(probe)).not.toMatch(/login|setup|upgrade|update/);
    }
  });

  it('P-1: permissionAsk stays unknown until a live request proves it, and no quota or cost is reported', () => {
    expect(vibe().capabilities).toMatchObject({ permissionAsk: 'unknown', quotaReport: 'none', costReport: 'none' });
  });
});

describe('mimo definition (P-35)', () => {
  const mimo = (): ProviderDef => defById('mimo');

  it('P-35: mimo launches its ACP subcommand, answers the shared probes, prompts over stdin and resumes through the protocol', () => {
    expect(mimo().bins).toEqual(['mimo']);
    expect(mimo().versionArgs).toEqual(['--version']);
    expect(mimo().helpArgs).toEqual(['--help']);
    expect(mimo().buildLaunch(LAUNCH_INPUT)).toEqual({ args: ['acp'], env: {}, stdin: 'prompt' });
    expect(mimo().resume).toBe('protocol');
    expect(isProviderDef(mimo())).toBe(true);
  });

  it('P-44: the login stays in the CLI home, so the launch sets no config variable, never auto-approves and claims no isolation', () => {
    expect(mimo().config).toEqual({ mechanism: 'none' });
    expect(mimo().isolation).toBeUndefined();
    for (const input of [LAUNCH_INPUT, { ...LAUNCH_INPUT, effort: 'high' as const, model: 'xiaomi/mimo-v2.6-pro' }]) {
      const launch = mimo().buildLaunch(input);
      expect(launch.env).toEqual({});
      expect(JSON.stringify(launch)).not.toMatch(/yolo|skip-permissions|never-ask|trust|--model|--variant/);
    }
  });

  it('P-43: the effort joins the model id after a slash and only the three documented levels are named', () => {
    expect(mimo().effortArg).toEqual({ kind: 'model-suffix', separator: '/' });
    expect(mimo().levelNames).toEqual({ low: 'low', medium: 'medium', high: 'high' });
    const run = (model: string | undefined, effort: LaunchInput['effort']): string | undefined =>
      effortModelId(mimo().effortArg, model, effort, mimo().levelNames);
    expect(run('xiaomi/mimo-v2.6-pro', 'high')).toBe('xiaomi/mimo-v2.6-pro/high');
    expect(run('mimo/mimo-auto', 'low')).toBe('mimo/mimo-auto/low');
    expect(run('xiaomi/mimo-v2.6-pro', undefined)).toBe('xiaomi/mimo-v2.6-pro');
    expect(run(undefined, 'high')).toBeUndefined();
    expect(run('xiaomi/mimo-v2.6-pro', 'xhigh')).toBe('xiaomi/mimo-v2.6-pro');
    expect(run('xiaomi/mimo-v2.6-pro', 'max')).toBe('xiaomi/mimo-v2.6-pro');
  });

  it('P-45: the login probe is the credential listing, and no probe could start a login', () => {
    expect(mimo().authProbe).toEqual({ args: ['providers', 'list'], parse: 'credential-count' });
    expect(mimo().helpNeedsLogin).toBeUndefined();
    for (const probe of [mimo().versionArgs, mimo().helpArgs, mimo().authProbe?.args]) {
      expect(JSON.stringify(probe)).not.toMatch(/login|upgrade|uninstall/);
    }
  });

  it('P-1: permissionAsk stays unknown until a live request proves it, and no quota or cost is reported', () => {
    expect(mimo().capabilities).toMatchObject({ permissionAsk: 'unknown', quotaReport: 'none', costReport: 'none' });
  });
});

describe('qwen definition (P-35)', () => {
  const qwen = (): ProviderDef => defById('qwen');

  it('P-35: qwen launches its ACP entry flag, answers the shared probes, prompts over stdin and resumes through the protocol', () => {
    expect(qwen().bins).toEqual(['qwen']);
    expect(qwen().versionArgs).toEqual(['--version']);
    expect(qwen().helpArgs).toEqual(['--help']);
    expect(qwen().buildLaunch(LAUNCH_INPUT)).toEqual({ args: ['--acp'], env: {}, stdin: 'prompt' });
    expect(qwen().resume).toBe('protocol');
    expect(isProviderDef(qwen())).toBe(true);
  });

  it('P-44: the login and the model catalog live in the CLI\'s own home, so the launch sets no config variable, never leaves the default approval mode and claims no isolation', () => {
    expect(qwen().config).toEqual({ mechanism: 'none' });
    expect(qwen().isolation).toBeUndefined();
    for (const input of [LAUNCH_INPUT, { ...LAUNCH_INPUT, effort: 'high' as const, model: 'qwen3-coder-plus' }]) {
      const launch = qwen().buildLaunch(input);
      expect(launch.env).toEqual({});
      expect(launch.args).toEqual(['--acp']);
      // `yolo` is the far end of the CLI's mode list and `--approval-mode` overrides the asking
      // default; neither may reach a launch, and the deprecated telemetry flags stay out too.
      expect(JSON.stringify(launch)).not.toMatch(/yolo|approval-mode|--telemetry|--auto/);
    }
  });

  it('P-43: the session option exists but is never sent — no level is offered while the selection\'s persistence into the user\'s settings is unverified', () => {
    // The CLI names the very level names Docket knows, so nothing differs and no map would be
    // needed — but the package can write the reasoning-effort choice into the user's settings
    // file and no operator run has cleared it, so the definition maps no level: nothing is
    // offered and nothing is sent until that question is settled.
    expect(qwen().effortArg).toBeUndefined();
    expect(qwen().levelNames).toEqual({});
    expect(providerLevelOf(qwen().levelNames, 'high')).toBeUndefined();
    expect(effortOfProviderLevel(qwen().levelNames, 'high')).toBeUndefined();
    expect(effortOfProviderLevel(qwen().levelNames, 'default')).toBeUndefined();
  });

  it('P-45: the removed auth command means no login probe at all — loggedIn stays null in discovery — and no probe could start a login', () => {
    expect(qwen().authProbe).toBeUndefined();
    expect(qwen().helpNeedsLogin).toBeUndefined();
    for (const probe of [qwen().versionArgs, qwen().helpArgs]) {
      expect(JSON.stringify(probe)).not.toMatch(/login|upgrade|uninstall|auth/);
    }
  });

  it('P-1: permissionAsk stays unknown until a scripted request proves it, and no quota or cost is reported', () => {
    expect(qwen().capabilities).toMatchObject({
      permissionAsk: 'unknown',
      quotaReport: 'none',
      costReport: 'none',
      images: true,
      mcp: true,
    });
  });
});

describe('qoder definition (P-35)', () => {
  const qoder = (): ProviderDef => defById('qoder');

  it('P-35: qoder searches both documented bins, launches its ACP flag, answers the shared probes, prompts over stdin and resumes through the protocol', () => {
    // The npm package installs a `qoder` dispatcher and a `qodercli` binary and the docs name
    // `qoder`; which one the native installer places is unverified, so discovery searches both.
    expect(qoder().bins).toEqual(['qoder', 'qodercli']);
    expect(qoder().versionArgs).toEqual(['--version']);
    expect(qoder().helpArgs).toEqual(['--help']);
    expect(qoder().buildLaunch(LAUNCH_INPUT)).toEqual({ args: ['--acp'], env: {}, stdin: 'prompt' });
    expect(qoder().resume).toBe('protocol');
    expect(isProviderDef(qoder())).toBe(true);
  });

  it('P-44: the login lives in the CLI\'s own home, so the launch sets no config variable, passes no token and never leaves the default approval mode', () => {
    expect(qoder().config).toEqual({ mechanism: 'none' });
    expect(qoder().isolation).toBeUndefined();
    for (const input of [LAUNCH_INPUT, { ...LAUNCH_INPUT, effort: 'high' as const, model: 'ultimate' }]) {
      const launch = qoder().buildLaunch(input);
      expect(launch.env).toEqual({});
      expect(launch.args).toEqual(['--acp']);
      // The bypass far end of the CLI\'s mode list, its skip-permissions alias and a config-dir or
      // personal-token switch may never reach a launch: the run reads only the machine\'s own login.
      expect(JSON.stringify(launch)).not.toMatch(/yolo|bypass|dangerously|--config-dir|QODER_PERSONAL_ACCESS_TOKEN/);
    }
  });

  it('P-43: the effort rides the session\'s thought_level option — the CLI\'s level names are the level names Docket knows, so no map exists and an unnamed value is never offered', () => {
    expect(qoder().effortArg).toEqual({ kind: 'session-option', category: 'thought_level' });
    expect(qoder().levelNames).toBeUndefined();
    expect(providerLevelOf(qoder().levelNames, 'xhigh')).toBe('xhigh');
    expect(effortOfProviderLevel(qoder().levelNames, 'xhigh')).toBe('xhigh');
    // `off` and `auto` appear in the CLI\'s own effort surface and name no level: never offered.
    expect(effortOfProviderLevel(qoder().levelNames, 'off')).toBeUndefined();
    expect(effortOfProviderLevel(qoder().levelNames, 'auto')).toBeUndefined();
  });

  it('P-45: the login probe reads the status JSON\'s boolean under CI=1 and never runs a login, model or usage command', () => {
    expect(qoder().authProbe).toEqual({ args: ['status', '-o', 'json'], parse: 'logged-in-json', env: { CI: '1' } });
    expect(qoder().helpNeedsLogin).toBeUndefined();
    for (const probe of [qoder().authProbe?.args, qoder().versionArgs, qoder().helpArgs]) {
      expect(JSON.stringify(probe)).not.toMatch(/login|logout|list-models|usage|upgrade|uninstall/);
    }
  });

  it('P-1: permissionAsk stays unknown until a scripted request proves it, and no quota or cost is reported', () => {
    expect(qoder().capabilities).toMatchObject({
      permissionAsk: 'unknown',
      quotaReport: 'none',
      costReport: 'none',
      images: true,
      mcp: true,
    });
  });
});

describe('kiro definition (P-35)', () => {
  const kiro = (): ProviderDef => defById('kiro');

  it('P-35: kiro launches its ACP subcommand, answers the shared probes, prompts over stdin and resumes through the protocol', () => {
    expect(kiro().bins).toEqual(['kiro-cli']);
    expect(kiro().versionArgs).toEqual(['--version']);
    expect(kiro().helpArgs).toEqual(['--help']);
    expect(kiro().buildLaunch(LAUNCH_INPUT)).toEqual({ args: ['acp'], env: {}, stdin: 'prompt' });
    expect(kiro().resume).toBe('protocol');
    expect(isProviderDef(kiro())).toBe(true);
  });

  it('P-35: the wrapper names the chat binary it delegates to, so discovery can tell a broken install from a working one', () => {
    expect(kiro().agentDelegate).toEqual({ homeEnv: 'HOME', relativePath: '.local/bin/kiro-cli-chat' });
    // Nothing Docket could run repairs the install: the CLI's own setup is the user's remedy.
    expect(JSON.stringify(kiro().agentDelegate)).not.toMatch(/setup|doctor/);
  });

  it('P-44: no per-run home or config variable is documented, so the launch sets no variable, never auto-approves and claims no isolation', () => {
    expect(kiro().config).toEqual({ mechanism: 'none' });
    expect(kiro().isolation).toBeUndefined();
    for (const input of [LAUNCH_INPUT, { ...LAUNCH_INPUT, effort: 'high' as const, model: 'auto' }]) {
      const launch = kiro().buildLaunch(input);
      expect(launch.env).toEqual({});
      // `-a` and `--trust-all-tools` turn every ask into an allow; the ask-first default must stay.
      expect(JSON.stringify(launch)).not.toMatch(/trust-all-tools|-a\b|--agent-engine/);
    }
  });

  it('P-43: the effort flag is the CLI\'s own, but no level is offered or sent while the per-model level sets are unverified', () => {
    // `acp --help` lists low, medium, high, xhigh and max — the flag exists — but the model list
    // carries no effort field and no operator run has recorded which levels a model takes, so the
    // empty map names no level: nothing is offered, and nothing joins the launch.
    expect(kiro().effortArg).toEqual({ kind: 'flag', flag: '--effort' });
    expect(kiro().levelNames).toEqual({});
    expect(effortFlagArgs(kiro().effortArg, 'high', kiro().levelNames)).toEqual([]);
    expect(kiro().buildLaunch({ ...LAUNCH_INPUT, effort: 'high' }).args).toEqual(['acp']);
  });

  it('P-45: the login probe is whoami, which never opens a browser, and no probe could start a login flow', () => {
    expect(kiro().authProbe).toEqual({ args: ['whoami', '-f', 'json'], parse: 'account-null-json' });
    expect(kiro().helpNeedsLogin).toBeUndefined();
    for (const probe of [kiro().versionArgs, kiro().helpArgs, kiro().authProbe?.args]) {
      // The listing command that starts a browser login lives in the catalog's table, never here.
      expect(JSON.stringify(probe)).not.toMatch(/login|list-models|chat|setup|doctor/);
    }
  });

  it('P-1: permissionAsk stays unknown until a scripted request proves it, and no quota or cost is reported', () => {
    expect(kiro().capabilities).toMatchObject({
      permissionAsk: 'unknown',
      quotaReport: 'none',
      costReport: 'none',
      images: true,
      mcp: true,
    });
  });
});

describe('kimi definition (P-35)', () => {
  const kimi = (): ProviderDef => defById('kimi');

  it('P-35: kimi launches its ACP subcommand, answers the shared probes, prompts over stdin and resumes through the protocol', () => {
    expect(kimi().bins).toEqual(['kimi']);
    expect(kimi().versionArgs).toEqual(['--version']);
    expect(kimi().helpArgs).toEqual(['--help']);
    expect(kimi().buildLaunch(LAUNCH_INPUT)).toEqual({
      args: ['acp'],
      env: { KIMI_DISABLE_TELEMETRY: '1', KIMI_CODE_NO_AUTO_UPDATE: '1' },
      stdin: 'prompt',
    });
    expect(kimi().resume).toBe('protocol');
    expect(isProviderDef(kimi())).toBe(true);
  });

  it('P-44: the login reaches a run through the CLI\'s global home, so the launch never sets KIMI_CODE_HOME, never leaves the default approval mode and claims no isolation', () => {
    expect(kimi().config).toEqual({ mechanism: 'none' });
    expect(kimi().isolation).toBeUndefined();
    for (const input of [LAUNCH_INPUT, { ...LAUNCH_INPUT, effort: 'high' as const, model: 'kimi-code/kimi-for-coding' }]) {
      const launch = kimi().buildLaunch(input);
      expect(Object.keys(launch.env)).not.toContain('KIMI_CODE_HOME');
      expect(launch.args).toEqual(['acp']);
      // `yolo` and `auto` are the far ends of the CLI\'s mode list and no switch may reach a
      // launch that picks them; the run stays in the asking default and each ask reaches the user.
      expect(JSON.stringify(launch)).not.toMatch(/--yolo|--auto|--plan|yolo|approval/);
    }
  });

  it('P-43: the effort is the thought_level session option found by its category — the CLI\'s level names are the level names Docket knows, so no map exists and `off` is never offered', () => {
    expect(kimi().effortArg).toEqual({ kind: 'session-option', category: 'thought_level' });
    expect(kimi().levelNames).toBeUndefined();
    expect(providerLevelOf(kimi().levelNames, 'high')).toBe('high');
    expect(effortOfProviderLevel(kimi().levelNames, 'xhigh')).toBe('xhigh');
    // `off` and `on` appear in the CLI's own thinking surface and name no level: never offered,
    // so the run never sends a thinking-off value the user did not pick as a level.
    expect(effortOfProviderLevel(kimi().levelNames, 'off')).toBeUndefined();
    expect(effortOfProviderLevel(kimi().levelNames, 'on')).toBeUndefined();
  });

  it('P-45: the login probe reads only whether a file exists under the CLI\'s credentials directory, and no probe could start a login', () => {
    expect(kimi().authProbe).toEqual({
      args: [],
      presenceDir: { homeEnv: 'KIMI_CODE_HOME', homeDir: '.kimi-code', dir: 'credentials' },
    });
    expect(kimi().helpNeedsLogin).toBeUndefined();
    for (const probe of [kimi().versionArgs, kimi().helpArgs, kimi().authProbe?.args]) {
      // The terminal device-code login and the local web server are the user's own commands.
      expect(JSON.stringify(probe)).not.toMatch(/login|logout|web|provider|upgrade|migrate/);
    }
  });

  it('P-1: permissionAsk stays unknown until a scripted request proves it, and no quota or cost is reported', () => {
    expect(kimi().capabilities).toMatchObject({
      permissionAsk: 'unknown',
      quotaReport: 'none',
      costReport: 'none',
      images: true,
      mcp: true,
    });
  });
});
