// Structural guard for untrusted definition data (repo overrides, tests, fixtures).
// It checks one definition in isolation; id uniqueness across a set is checked where the set is built.
import type { ProviderCapabilities, Tri } from '../../../domain/index';
import type { LaunchInput, ProviderDef, ProviderLaunch, ProviderTransport } from './provider-def';

const TRANSPORTS: readonly ProviderTransport[] = ['sdk', 'app-server', 'acp', 'stream-json'];
const RESUME_MODES: readonly ProviderDef['resume'][] = ['specify', 'capture', 'protocol', 'none'];
const CONFIG_MECHANISMS: readonly ProviderDef['config']['mechanism'][] = ['env-var', 'flag'];
const QUOTA_REPORTS: readonly ProviderCapabilities['quotaReport'][] = ['stream', 'query', 'error_only', 'none'];
const COST_REPORTS: readonly ProviderCapabilities['costReport'][] = ['reported', 'computed', 'equivalent', 'none'];

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isNonEmptyString(value: unknown): value is string {
  return typeof value === 'string' && value.length > 0;
}

function isStringArray(value: unknown): value is readonly string[] {
  return Array.isArray(value) && value.every((entry) => typeof entry === 'string');
}

function isNonEmptyStringArray(value: unknown): value is readonly string[] {
  return isStringArray(value) && value.length > 0 && value.every((entry) => entry.length > 0);
}

function isTri(value: unknown): value is Tri {
  return typeof value === 'boolean' || value === 'unknown';
}

function isCapabilities(value: unknown): value is ProviderCapabilities {
  if (!isRecord(value)) return false;
  if (typeof value['structuredStream'] !== 'boolean') return false;
  for (const key of ['permissionAsk', 'resume', 'mcp', 'hooks', 'skills', 'images'] as const) {
    if (!isTri(value[key])) return false;
  }
  if (!QUOTA_REPORTS.includes(value['quotaReport'] as ProviderCapabilities['quotaReport'])) return false;
  if (!COST_REPORTS.includes(value['costReport'] as ProviderCapabilities['costReport'])) return false;
  return true;
}

function isBuildLaunch(value: unknown): value is (input: LaunchInput) => ProviderLaunch {
  return typeof value === 'function';
}

export function isProviderDef(value: unknown): value is ProviderDef {
  if (!isRecord(value)) return false;
  if (!isNonEmptyString(value['id'])) return false;
  if (!isNonEmptyString(value['displayName'])) return false;
  if (!isNonEmptyStringArray(value['bins'])) return false;
  if (!isNonEmptyStringArray(value['versionArgs'])) return false;
  const authProbe = value['authProbe'];
  if (authProbe !== undefined && !(isRecord(authProbe) && isStringArray(authProbe['args']))) return false;
  const helpArgs = value['helpArgs'];
  if (helpArgs !== undefined && !isStringArray(helpArgs)) return false;
  const optionalFlags = value['optionalFlags'];
  if (
    optionalFlags !== undefined &&
    !(isRecord(optionalFlags) && Object.values(optionalFlags).every((v) => typeof v === 'string'))
  ) {
    return false;
  }
  if (!TRANSPORTS.includes(value['transport'] as ProviderTransport)) return false;
  const isStreamJson = value['transport'] === 'stream-json';
  if (isStreamJson !== isNonEmptyString(value['streamDialect'])) return false;
  const config = value['config'];
  if (!isRecord(config)) return false;
  if (!CONFIG_MECHANISMS.includes(config['mechanism'] as ProviderDef['config']['mechanism'])) return false;
  if (!isNonEmptyString(config['name'])) return false;
  if (!isBuildLaunch(value['buildLaunch'])) return false;
  if (!RESUME_MODES.includes(value['resume'] as ProviderDef['resume'])) return false;
  if (!isCapabilities(value['capabilities'])) return false;
  const installHint = value['installHint'];
  if (!(isRecord(installHint) && isNonEmptyString(installHint['url']))) return false;
  return true;
}
