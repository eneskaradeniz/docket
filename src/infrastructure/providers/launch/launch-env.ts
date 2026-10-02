// The billing-mode environment allowlist. The child environment is built from an allowlist — the
// base machine variables each CLI needs, the provider's own non-credential variables, and the
// chosen account's resolved values — so ambient credentials exported in the user's shell (a stray
// API key of another account) never reach the child. Contract: docs/v2/providers.md → "Launch
// rules" 3 and "Phase 3 contracts" → "Launch isolation (P-8)".

/** Variables every child process needs on the user's machine: process mechanics, locale,
 * terminal, and the TLS/proxy trust roots a corporate machine requires. Credential-shaped names
 * are absent by design — the chosen account's values are their only route into the child. */
const BASE_ENV_ALLOWLIST: readonly string[] = [
  'PATH',
  'HOME',
  'SHELL',
  'PWD',
  'TMPDIR',
  'TZ',
  'LANG',
  'LC_ALL',
  'LC_CTYPE',
  'TERM',
  'TERMINFO',
  'USER',
  'LOGNAME',
  'DISPLAY',
  'WAYLAND_DISPLAY',
  'XDG_SESSION_TYPE',
  'SSL_CERT_FILE',
  'SSL_CERT_DIR',
  'NODE_EXTRA_CA_CERTS',
  'HTTP_PROXY',
  'HTTPS_PROXY',
  'NO_PROXY',
  'http_proxy',
  'https_proxy',
  'no_proxy',
];

/** Non-credential, non-billing variables a provider documents for normal operation, beyond the
 * base set. A provider whose config mechanism redirects to a run-scoped directory is deliberately
 * never listed here: the config writer's value replaces whatever the ambient environment carries.
 * A provider whose login lives in its own home (mechanism 'none') lists that home's variable, so
 * an ambient override reaches the child exactly as the CLI itself would resolve it. */
const PROVIDER_ENV_ALLOWLIST: Readonly<Record<string, readonly string[]>> = {
  // The CLI's own documented config-dir override: a machine login lives where it points, so the
  // login probe and a run must read the same one.
  'claude-code': ['CLAUDE_CONFIG_DIR'],
  codex: [],
  agy: [],
  copilot: [],
  cursor: [],
  opencode: [],
  hermes: [],
  kilo: [],
  // The CLI's own home variable: the login probe and a run must read the same one.
  'grok-build': ['GROK_HOME'],
  atomcode: [],
  reasonix: [],
  vibe: [],
  mimo: [],
  // The CLI reads its credential from the environment variable the user's own settings name, so
  // none is passed through here: an ambient key of another account never reaches a run.
  qwen: [],
  // The CLI's documented headless key is a credential-shaped variable, so it reaches a child only
  // through the chosen account, never through the ambient environment.
  kiro: [],
};

/** Names that look like credentials. The match is deliberately broad: dropping a variable the
 * child does not need is harmless, while handing it a stranger's token is not. */
const CREDENTIAL_ENV_NAME_RE = /(?:API_?KEY|TOKEN|SECRET|PASSWORD|PASSPHRASE|CREDENTIALS?|PRIVATE_?KEY|_KEY)$/i;

export function isCredentialEnvName(name: string): boolean {
  return CREDENTIAL_ENV_NAME_RE.test(name);
}

/**
 * The environment a provider's child process is spawned with: the allowlisted base plus the
 * chosen account's values. Account values win over the base, so an account key survives exactly
 * when the account being used is that key; everything credential-shaped in the base is dropped.
 */
export function buildChildEnv(
  defId: string,
  baseEnv: Readonly<Record<string, string>>,
  accountEnv: Readonly<Record<string, string>>,
): Record<string, string> {
  const allowed = new Set<string>([...BASE_ENV_ALLOWLIST, ...(PROVIDER_ENV_ALLOWLIST[defId] ?? [])]);
  const env: Record<string, string> = {};
  for (const [name, value] of Object.entries(baseEnv)) {
    if (!allowed.has(name)) continue;
    if (isCredentialEnvName(name)) continue; // credentials come from the chosen account only
    env[name] = value;
  }
  for (const [name, value] of Object.entries(accountEnv)) {
    env[name] = value;
  }
  return env;
}
