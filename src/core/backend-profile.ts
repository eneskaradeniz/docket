// src/core/backend-profile.ts — backend profiles, PURE (WO-0098).
//
// A backend profile is an operator-NAMED environment the runner adapter spawns its CLI under:
// the SAME adapter, a different environment (ADR-0006/0014 — the vendor stays inside the
// adapter; the profile is the product concept). The probe (docs/probes/backend-profiles/
// findings.md) measured what steers a spawn: the injected CONFIG-DIR variable does, while a
// variable the config dir's own settings also set does NOT (the settings win) — so a profile
// is a small, NON-SECRET env map, and the credentials stay where the operator's CLI login keeps
// them. This module is the rules and nothing else: the no-secret guard, the list validation (an
// operator write refuses loudly), the fail-open read (a corrupt or leaky row never reaches a
// spawn), the WO → workspace → role → built-in resolution (WO-0104 widened WO-0098's chain
// with the per-role route level), and the env-text codec the settings form
// speaks. No I/O, no display strings, no vendor names.

/** The built-in passthrough's reference key — the first profile, always present, never stored:
 *  inherit the process environment untouched (today's behavior, byte-identical). A work order
 *  may name it (`profile: default`) to pin the passthrough over a workspace default. Code
 *  vocabulary — the UI renders its own word for it through the label bundles. */
export const DEFAULT_PROFILE = 'default';

/** An operator-configured profile: a free-text name (operator vocabulary, never a vendor
 *  constant in code) + the NON-SECRET env pieces injected ahead of the inherited environment. */
export interface BackendProfile {
  name: string;
  env: Record<string, string>;
}

export type EnvIssueCode = 'key_shape' | 'secret_key' | 'secret_value' | 'value_empty' | 'value_shape';
export type ProfileIssue =
  | { index: number; field: 'name'; code: 'name_empty' | 'name_shape' | 'name_reserved' | 'name_duplicate' }
  | { index: number; field: 'env'; code: EnvIssueCode | 'env_shape'; key?: string };

/** Size bounds — a profile is a handful of pointers, never a dump of a shell environment. */
export const PROFILE_NAME_MAX = 40;
const ENV_VALUE_MAX = 1024;
const ENV_ENTRIES_MAX = 16;

const KEY_RE = /^[A-Za-z_][A-Za-z0-9_]*$/;
// A key that NAMES a secret is refused whatever its value — the credential stays in the
// operator's shell / CLI login (the order's frozen decision; CLAUDE.md "Records & PRs").
const SECRET_KEY_RE = /(TOKEN|SECRET|PASSW|CREDENTIAL|KEY|AUTH|COOKIE|PRIVATE)/i;
// Well-known credential prefixes (API keys, GitHub tokens, Slack tokens, a JWT head).
const SECRET_PREFIX_RE = /^(sk-|sk_|ghp_|gho_|ghs_|github_pat_|xox[abprs]-|eyJ)/;

/** Does this VALUE look like a credential? A run of ≥16 alphanumerics mixing letters and digits
 *  is the token shape; the values a profile legitimately carries (a path, a URL, a dated model
 *  id, a number) break into short runs. Deliberately conservative — a false positive costs the
 *  operator a rename, a false negative would persist a secret. */
export function isTokenLooking(value: string): boolean {
  if (SECRET_PREFIX_RE.test(value)) return true;
  return value.split(/[^A-Za-z0-9]+/).some((run) => run.length >= 16 && /[A-Za-z]/.test(run) && /[0-9]/.test(run));
}

/** One KEY=value pair's first issue, or undefined when it may be stored. */
export function envEntryIssue(key: string, value: string): EnvIssueCode | undefined {
  if (!KEY_RE.test(key)) return 'key_shape';
  if (SECRET_KEY_RE.test(key)) return 'secret_key';
  if (value === '') return 'value_empty';
  if (/[\r\n\0]/.test(value) || value.length > ENV_VALUE_MAX) return 'value_shape';
  if (isTokenLooking(value)) return 'secret_value';
  return undefined;
}

/** The one name comparison: trimmed, case-insensitive (a reference in order.md or a workspace
 *  setting finds its profile the way the operator reads it). */
export function sameProfileName(a: string, b: string): boolean {
  return a.trim().toLowerCase() === b.trim().toLowerCase();
}

function nameIssue(name: string, prior: readonly string[]): ProfileIssue['code'] | undefined {
  if (name.trim() === '') return 'name_empty';
  // The name rides a front-matter line (`profile: <name>`) and a settings row: one line, bounded.
  if (name !== name.trim() || name.length > PROFILE_NAME_MAX || /[\r\n\0]/.test(name)) return 'name_shape';
  if (sameProfileName(name, DEFAULT_PROFILE)) return 'name_reserved';
  if (prior.some((p) => sameProfileName(p, name))) return 'name_duplicate';
  return undefined;
}

function envIssue(env: unknown): { code: EnvIssueCode | 'env_shape'; key?: string } | undefined {
  if (!env || typeof env !== 'object' || Array.isArray(env)) return { code: 'env_shape' };
  const entries = Object.entries(env as Record<string, unknown>);
  if (entries.length > ENV_ENTRIES_MAX) return { code: 'env_shape' };
  for (const [k, v] of entries) {
    if (typeof v !== 'string') return { code: 'env_shape', key: k };
    const code = envEntryIssue(k, v);
    if (code) return { code, key: k };
  }
  return undefined;
}

/** Validate the operator's whole list — [] means it may be stored. At most one issue per entry
 *  (the name's first, else the env's first), in list order: the form places each under its field. */
export function validateProfiles(list: readonly BackendProfile[]): ProfileIssue[] {
  const issues: ProfileIssue[] = [];
  const seen: string[] = [];
  list.forEach((p, index) => {
    const n = nameIssue(p.name, seen);
    seen.push(p.name);
    if (n) {
      issues.push({ index, field: 'name', code: n } as ProfileIssue);
      return;
    }
    const e = envIssue(p.env);
    if (e) issues.push({ index, field: 'env', code: e.code, ...(e.key !== undefined ? { key: e.key } : {}) });
  });
  return issues;
}

/** The FAIL-OPEN read of a stored row: every entry that would not pass `validateProfiles`
 *  against the entries kept before it is dropped — garbage, duplicates, the reserved name, and
 *  any entry carrying a secret-looking pair. Never throws; a non-array is no profiles. */
export function normalizeProfiles(raw: unknown): BackendProfile[] {
  if (!Array.isArray(raw)) return [];
  const kept: BackendProfile[] = [];
  for (const entry of raw) {
    if (!entry || typeof entry !== 'object') continue;
    const { name, env } = entry as { name?: unknown; env?: unknown };
    if (typeof name !== 'string') continue;
    if (nameIssue(name, kept.map((k) => k.name)) || envIssue(env)) continue;
    kept.push({ name, env: { ...(env as Record<string, string>) } });
  }
  return kept;
}

/** Where a drive's profile came from — the resolution the pipeline gates on. `builtin` is the
 *  passthrough (no env injected); `missing` is a DANGLING reference (a renamed or deleted
 *  profile): the drive is refused, never silently spawned on another backend. WO-0104 adds the
 *  `'role'` source — the per-role route's profile is the chain's THIRD level (the WO-0098
 *  two-level chain, widened). */
export type ProfileResolution =
  | { kind: 'builtin' }
  | { kind: 'profile'; profile: BackendProfile; source: 'wo' | 'workspace' | 'role' }
  | { kind: 'missing'; name: string; source: 'wo' | 'workspace' | 'role' };

/** WO override (order.md `profile:`) → workspace default (`driver:<wsId>`'s profile half) →
 *  the role-level account default (the per-role route, WO-0104) → the built-in.
 *  A reference to `default` pins the built-in explicitly. Blank references are absent. */
export function resolveProfile(input: {
  profiles: readonly BackendProfile[];
  workspaceDefault?: string;
  woOverride?: string;
  roleProfile?: string;
}): ProfileResolution {
  const pick = (ref: string | undefined, source: 'wo' | 'workspace' | 'role'): ProfileResolution | undefined => {
    if (ref === undefined || ref.trim() === '') return undefined;
    if (sameProfileName(ref, DEFAULT_PROFILE)) return { kind: 'builtin' };
    const profile = input.profiles.find((p) => sameProfileName(p.name, ref));
    return profile ? { kind: 'profile', profile, source } : { kind: 'missing', name: ref.trim(), source };
  };
  return (
    pick(input.woOverride, 'wo')
    ?? pick(input.workspaceDefault, 'workspace')
    ?? pick(input.roleProfile, 'role')
    ?? { kind: 'builtin' }
  );
}

/** The env map the adapter composes over the inherited environment — undefined for the built-in
 *  (the spawn options stay byte-identical to the pre-profile shape) and for a missing reference
 *  (which never spawns). A copy: the adapter may not mutate the stored row. */
export function spawnEnvOf(res: ProfileResolution): Record<string, string> | undefined {
  return res.kind === 'profile' ? { ...res.profile.env } : undefined;
}

export type EnvLineIssue = { line: number; code: EnvIssueCode | 'line_shape' | 'duplicate_key'; key?: string };

/** The settings form's text → env map: one `KEY=value` per line, split on the FIRST `=`; blank
 *  lines and `#` comments skipped. A refused line never enters the map; each issue names its
 *  1-based line so the error sits under the field with the line it means. */
export function parseEnvText(text: string): { env: Record<string, string>; issues: EnvLineIssue[] } {
  const env: Record<string, string> = {};
  const issues: EnvLineIssue[] = [];
  text.split(/\r?\n/).forEach((raw, i) => {
    const line = raw.trim();
    if (line === '' || line.startsWith('#')) return;
    const eq = line.indexOf('=');
    if (eq <= 0) {
      issues.push({ line: i + 1, code: 'line_shape' });
      return;
    }
    const key = line.slice(0, eq).trim();
    const value = line.slice(eq + 1).trim();
    const code = envEntryIssue(key, value);
    if (code) {
      issues.push({ line: i + 1, code, key });
      return;
    }
    if (Object.prototype.hasOwnProperty.call(env, key)) {
      issues.push({ line: i + 1, code: 'duplicate_key', key });
      return;
    }
    env[key] = value;
  });
  return { env, issues };
}

/** The env map → the form's text (the codec's other half; key order preserved). */
export function profileEnvText(env: Record<string, string>): string {
  return Object.entries(env).map(([k, v]) => `${k}=${v}`).join('\n');
}
