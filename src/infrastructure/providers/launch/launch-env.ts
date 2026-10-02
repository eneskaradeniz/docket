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
 * base set. No built-in CLI needs one today. A provider's config-dir variable is deliberately
 * never listed: the run-scoped value from the config writer replaces whatever the ambient
 * environment carries, so a stray value can never redirect a run into the user's own config tree. */
const PROVIDER_ENV_ALLOWLIST: Readonly<Record<string, readonly string[]>> = {
  'claude-code': [],
  codex: [],
  agy: [],
  copilot: [],
  cursor: [],
  opencode: [],
  kilo: [],
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
