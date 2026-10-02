// P-8 — the billing-mode environment allowlist: the child environment is built from an allowlist
// (the provider's own variables plus the chosen account's values); ambient credential-shaped
// variables of other accounts never reach the child.
import { describe, expect, it } from 'vitest';
import { buildChildEnv } from './launch-env';

/** Credential-looking fixture values are assembled at runtime, never written as one literal. */
const keyOf = (label: string): string => `${label}-` + 'k'.repeat(24);

const BASE_ENV: Readonly<Record<string, string>> = {
  PATH: '/usr/local/bin:/usr/bin:/bin',
  HOME: '/Users/someone',
  SHELL: '/bin/zsh',
  LANG: 'en_US.UTF-8',
  TMPDIR: '/var/folders/tmp',
  TZ: 'Europe/Istanbul',
  TERM: 'xterm-256color',
  USER: 'someone',
  LOGNAME: 'someone',
  NODE_EXTRA_CA_CERTS: '/usr/local/etc/corporate-ca.pem',
  HTTPS_PROXY: 'http://127.0.0.1:8888',
  NO_PROXY: 'localhost,127.0.0.1',
};

describe('child environment allowlist (P-8)', () => {
  it('P-8: the child environment is built from an allowlist, never the ambient environment', () => {
    const env = buildChildEnv('claude-code', {
      ...BASE_ENV,
      STRAY_VARIABLE: 'no reason to pass this',
      ANTHROPIC_BASE_URL: 'https://elsewhere.example', // billing mode is Docket's decision
      CODEX_HOME: '/Users/someone/.codex', // another CLI's config dir never leaks across providers
      SSH_AUTH_SOCK: '/private/tmp/agent.sock',
    }, {});

    for (const name of Object.keys(BASE_ENV)) {
      expect(env[name], name).toBe(BASE_ENV[name]);
    }
    expect('STRAY_VARIABLE' in env).toBe(false);
    expect('ANTHROPIC_BASE_URL' in env).toBe(false);
    expect('CODEX_HOME' in env).toBe(false);
    expect('SSH_AUTH_SOCK' in env).toBe(false);
  });

  it('P-8: a stray ANTHROPIC_API_KEY is dropped unless the account being used is exactly that key', () => {
    const stray = keyOf('sk-stray');
    const accountKey = keyOf('sk-account');

    // Subscription account: no API key belongs in the child at all.
    const subscription = buildChildEnv('claude-code', { ...BASE_ENV, ANTHROPIC_API_KEY: stray }, {});
    expect('ANTHROPIC_API_KEY' in subscription).toBe(false);

    // API-key account: the child sees the chosen account's key, never the stray shell export.
    const keyed = buildChildEnv(
      'claude-code',
      { ...BASE_ENV, ANTHROPIC_API_KEY: stray },
      { ANTHROPIC_API_KEY: accountKey },
    );
    expect(keyed.ANTHROPIC_API_KEY).toBe(accountKey);

    // The stray value is exactly the chosen account's key: the account is that key, so it stays.
    const ownKey = buildChildEnv(
      'claude-code',
      { ...BASE_ENV, ANTHROPIC_API_KEY: accountKey },
      { ANTHROPIC_API_KEY: accountKey },
    );
    expect(ownKey.ANTHROPIC_API_KEY).toBe(accountKey);
  });

  it('P-8: credential-shaped variables of other accounts are dropped from the base environment', () => {
    const chosen = keyOf('sk-chosen');
    const env = buildChildEnv('codex', {
      ...BASE_ENV,
      OPENAI_API_KEY: keyOf('sk-ambient-openai'),
      STRAY_API_KEY: keyOf('ambient-stray'),
      GITHUB_TOKEN: keyOf('ghp-ambient'),
      DEPLOY_SECRET: keyOf('deploy'),
      KEYCHAIN_PASSPHRASE: keyOf('passphrase'),
      SERVICE_ACCOUNT_CREDENTIALS: keyOf('service'),
    }, { OPENAI_API_KEY: chosen });

    expect(env.OPENAI_API_KEY).toBe(chosen);
    expect('STRAY_API_KEY' in env).toBe(false);
    expect('GITHUB_TOKEN' in env).toBe(false);
    expect('DEPLOY_SECRET' in env).toBe(false);
    expect('KEYCHAIN_PASSPHRASE' in env).toBe(false);
    expect('SERVICE_ACCOUNT_CREDENTIALS' in env).toBe(false);
  });

  it('P-8: the chosen account values ride on top of the allowlisted base', () => {
    const env = buildChildEnv(
      'claude-code',
      BASE_ENV,
      { ANTHROPIC_MODEL: 'model-x', HTTPS_PROXY: 'http://account-proxy.internal:3128' },
    );
    expect(env.ANTHROPIC_MODEL).toBe('model-x');
    expect(env.HTTPS_PROXY).toBe('http://account-proxy.internal:3128');
    expect(env.PATH).toBe(BASE_ENV.PATH);
  });

  it('P-8: an unknown provider id still gets only the base allowlist', () => {
    const env = buildChildEnv('not-a-known-def', { ...BASE_ENV, EVERYTHING_ELSE: 'leak' }, {});
    expect(env.PATH).toBe(BASE_ENV.PATH);
    expect(env.HOME).toBe(BASE_ENV.HOME);
    expect('EVERYTHING_ELSE' in env).toBe(false);
  });

  it("P-44: the claude CLI's own config-dir override passes through; another provider's child never sees it", () => {
    const ambient = { ...BASE_ENV, CLAUDE_CONFIG_DIR: '/Users/someone/.claude-anthropic' };
    // A machine login lives where the CLI's documented override variable points, so the value
    // must survive the allowlist — the CLI resolves its own home, Docket never names one for it.
    expect(buildChildEnv('claude-code', ambient, {}).CLAUDE_CONFIG_DIR).toBe('/Users/someone/.claude-anthropic');
    expect('CLAUDE_CONFIG_DIR' in buildChildEnv('codex', ambient, {})).toBe(false);
  });
});
