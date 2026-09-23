import { describe, expect, it } from 'vitest';
import {
  DEFAULT_PROFILE,
  envEntryIssue,
  isTokenLooking,
  normalizeProfiles,
  parseEnvText,
  profileEnvText,
  resolveProfile,
  sameProfileName,
  spawnEnvOf,
  validateProfiles,
  type BackendProfile,
} from '../backend-profile';

// WO-0098 — backend profiles, the pure half: the non-secret env guard, the operator-list
// validation (the write refuses loudly), the fail-open read, the WO → workspace → built-in
// resolution, and the env-text codec the settings form speaks. The probe
// (docs/probes/backend-profiles/findings.md) measured WHAT steers a spawn — the config-dir
// variable — so the fixtures below carry that shape.

const GLM: BackendProfile = { name: 'GLM', env: {} };
const MAX: BackendProfile = { name: 'Max', env: { AGENT_CONFIG_DIR: '/Users/op/.agent-max' } };

describe('isTokenLooking — the value half of the no-secret rule', () => {
  it('flags a long mixed letter+digit run (the shape of an API token)', () => {
    expect(isTokenLooking('0f3a9c1e2b4d5f6a7b8c9d0e1f2a3b4c.AbCdEfGhIjKlMnOp')).toBe(true);
    // the prefix branch matches on the prefix ALONE (see isTokenLooking) — these stay short on
    // purpose, short enough that no scanner mistakes them for an actual leaked credential.
    expect(isTokenLooking('sk-live-x')).toBe(true);
    expect(isTokenLooking('eyJx')).toBe(true); // a JWT head, by its prefix
    expect(isTokenLooking('ghp_x')).toBe(true);
  });

  it('passes the values a profile legitimately carries', () => {
    expect(isTokenLooking('/Users/op/.agent-max')).toBe(false); // a config dir
    expect(isTokenLooking('https://api.example.test/api/v1')).toBe(false); // a base url
    expect(isTokenLooking('model-small-4-5-20251001')).toBe(false); // a dated model id: short segments
    expect(isTokenLooking('glm-5.3-flash[1m]')).toBe(false);
    expect(isTokenLooking('3000000')).toBe(false); // a timeout: digits only
    expect(isTokenLooking('1')).toBe(false);
  });
});

describe('envEntryIssue — one KEY=value pair', () => {
  it('accepts a non-secret pair', () => {
    expect(envEntryIssue('AGENT_CONFIG_DIR', '/Users/op/.agent-max')).toBeUndefined();
    expect(envEntryIssue('API_TIMEOUT_MS', '3000000')).toBeUndefined();
  });

  it('refuses a key that names a secret — whatever the value', () => {
    expect(envEntryIssue('PROVIDER_AUTH_TOKEN', 'x')).toBe('secret_key');
    expect(envEntryIssue('PROVIDER_API_KEY', 'x')).toBe('secret_key');
    expect(envEntryIssue('MY_PASSWORD', 'x')).toBe('secret_key');
    expect(envEntryIssue('client_secret', 'x')).toBe('secret_key');
  });

  it('refuses a token-looking value under an innocent key', () => {
    expect(envEntryIssue('ZAI_THING', '0f3a9c1e2b4d5f6a7b8c9d0e1f2a3b4c')).toBe('secret_value');
  });

  it('refuses a malformed key and an empty or multi-line value', () => {
    expect(envEntryIssue('1BAD', 'x')).toBe('key_shape');
    expect(envEntryIssue('HAS SPACE', 'x')).toBe('key_shape');
    expect(envEntryIssue('OK_VAR', '')).toBe('value_empty');
    expect(envEntryIssue('OK_VAR', 'a\nb')).toBe('value_shape');
  });
});

describe('validateProfiles — the operator write refuses loudly', () => {
  it('accepts a clean list (an empty env is a legal named passthrough)', () => {
    expect(validateProfiles([GLM, MAX])).toEqual([]);
  });

  it('names every issue by index + field', () => {
    const issues = validateProfiles([
      { name: '  ', env: {} },
      { name: 'glm', env: {} },
      { name: 'GLM', env: {} },
      { name: 'Default', env: {} },
      { name: 'Leaky', env: { PROVIDER_AUTH_TOKEN: 'abc' } },
    ]);
    expect(issues).toEqual([
      { index: 0, field: 'name', code: 'name_empty' },
      { index: 2, field: 'name', code: 'name_duplicate' }, // case-insensitive: 'glm' came first
      { index: 3, field: 'name', code: 'name_reserved' }, // the built-in's key
      { index: 4, field: 'env', code: 'secret_key', key: 'PROVIDER_AUTH_TOKEN' },
    ]);
  });

  it('refuses a name that cannot ride a front-matter line', () => {
    expect(validateProfiles([{ name: 'a\nb', env: {} }])).toEqual([{ index: 0, field: 'name', code: 'name_shape' }]);
    expect(validateProfiles([{ name: 'x'.repeat(41), env: {} }])).toEqual([{ index: 0, field: 'name', code: 'name_shape' }]);
  });
});

describe('normalizeProfiles — the fail-open read (a corrupt or leaky row never reaches a spawn)', () => {
  it('keeps the valid entries verbatim, in order', () => {
    expect(normalizeProfiles([GLM, MAX])).toEqual([GLM, MAX]);
  });

  it('drops garbage, duplicates, reserved names and any entry carrying a secret', () => {
    const raw: unknown = [
      GLM,
      null,
      { name: 3, env: {} },
      { name: 'Bad', env: { K: 1 } },
      { name: 'glm', env: {} },
      { name: 'default', env: {} },
      { name: 'Leaky', env: { X_TOKEN: 'v' } },
      MAX,
    ];
    expect(normalizeProfiles(raw)).toEqual([GLM, MAX]);
  });

  it('reads a non-array as no profiles', () => {
    expect(normalizeProfiles(undefined)).toEqual([]);
    expect(normalizeProfiles({ name: 'GLM' })).toEqual([]);
  });
});

describe('resolveProfile — WO override → workspace default → the built-in passthrough', () => {
  const profiles = [GLM, MAX];

  it('zero configured profiles and no references resolve to the built-in (today, byte-identical)', () => {
    expect(resolveProfile({ profiles: [] })).toEqual({ kind: 'builtin' });
    expect(spawnEnvOf(resolveProfile({ profiles: [] }))).toBeUndefined();
  });

  it('the workspace default applies when the WO names none', () => {
    expect(resolveProfile({ profiles, workspaceDefault: 'Max' })).toEqual({ kind: 'profile', profile: MAX, source: 'workspace' });
  });

  it("the WO's override wins over the workspace default", () => {
    expect(resolveProfile({ profiles, workspaceDefault: 'Max', woOverride: 'GLM' })).toEqual({ kind: 'profile', profile: GLM, source: 'wo' });
  });

  it('matches names case-insensitively, trimmed', () => {
    expect(resolveProfile({ profiles, woOverride: ' max ' })).toEqual({ kind: 'profile', profile: MAX, source: 'wo' });
  });

  it("a WO may pin the built-in explicitly over a workspace default ('default')", () => {
    expect(resolveProfile({ profiles, workspaceDefault: 'Max', woOverride: DEFAULT_PROFILE })).toEqual({ kind: 'builtin' });
  });

  it('a dangling reference is MISSING — never a silent fall-through to another backend', () => {
    expect(resolveProfile({ profiles, woOverride: 'Gone', workspaceDefault: 'Max' })).toEqual({ kind: 'missing', name: 'Gone', source: 'wo' });
    expect(resolveProfile({ profiles, workspaceDefault: 'Gone' })).toEqual({ kind: 'missing', name: 'Gone', source: 'workspace' });
  });

  it('the spawn env is the profile env (a copy), undefined for the built-in and for missing', () => {
    const env = spawnEnvOf({ kind: 'profile', profile: MAX, source: 'workspace' });
    expect(env).toEqual({ AGENT_CONFIG_DIR: '/Users/op/.agent-max' });
    expect(env).not.toBe(MAX.env);
    expect(spawnEnvOf({ kind: 'missing', name: 'x', source: 'wo' })).toBeUndefined();
  });

  it('sameProfileName is the one comparison', () => {
    expect(sameProfileName('GLM', ' glm')).toBe(true);
    expect(sameProfileName('GLM', 'Max')).toBe(false);
  });
});

describe('parseEnvText / profileEnvText — the settings form codec (one KEY=value per line)', () => {
  it('round-trips an env map', () => {
    const text = profileEnvText(MAX.env);
    expect(text).toBe('AGENT_CONFIG_DIR=/Users/op/.agent-max');
    expect(parseEnvText(text)).toEqual({ env: MAX.env, issues: [] });
  });

  it('skips blank lines and # comments; splits on the FIRST =', () => {
    expect(parseEnvText('\n# note\nA_URL=https://x.test/p?a=b\n\n')).toEqual({ env: { A_URL: 'https://x.test/p?a=b' }, issues: [] });
  });

  it('names each bad line (1-based) and never carries a refused value into the map', () => {
    const r = parseEnvText('NOEQUALS\nPROVIDER_AUTH_TOKEN=abc\nA=1\nA=2');
    expect(r.issues).toEqual([
      { line: 1, code: 'line_shape' },
      { line: 2, code: 'secret_key', key: 'PROVIDER_AUTH_TOKEN' },
      { line: 4, code: 'duplicate_key', key: 'A' },
    ]);
    expect(r.env).toEqual({ A: '1' });
  });
});
