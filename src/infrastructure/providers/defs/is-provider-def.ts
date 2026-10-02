// Structural guard for untrusted definition data (repo overrides, tests, fixtures).
// It checks one definition in isolation; id uniqueness across a set is checked where the set is built.
import type { ProviderCapabilities, Tri } from '../../../domain/index';
import { EFFORT_LEVELS, type LaunchInput, type ProviderDef, type ProviderLaunch, type ProviderTransport } from './provider-def';

const TRANSPORTS: readonly ProviderTransport[] = ['sdk', 'app-server', 'acp', 'stream-json'];
const RESUME_MODES: readonly ProviderDef['resume'][] = ['specify', 'capture', 'protocol', 'none'];
const CONFIG_MECHANISMS: readonly ProviderDef['config']['mechanism'][] = ['env-var', 'flag', 'none'];
const QUOTA_REPORTS: readonly ProviderCapabilities['quotaReport'][] = ['stream', 'query', 'error_only', 'none'];
const COST_REPORTS: readonly ProviderCapabilities['costReport'][] = ['reported', 'computed', 'equivalent', 'credits', 'none'];
const FILL_RULES: readonly NonNullable<ProviderDef['mark']>['fillRule'][] = ['nonzero', 'evenodd'];

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

function isEffortArg(value: unknown): boolean {
  if (value === undefined) return true;
  if (!isRecord(value)) return false;
  if (value['kind'] === 'flag') return isNonEmptyString(value['flag']);
  if (value['kind'] === 'request-field') return isNonEmptyString(value['name']);
  if (value['kind'] === 'session-option') {
    // Exactly one way to find the option: a category and a configId together would be ambiguous.
    const { category, configId } = value;
    return (isNonEmptyString(category) && configId === undefined) || (isNonEmptyString(configId) && category === undefined);
  }
  if (value['kind'] === 'model-suffix') return isNonEmptyString(value['separator']);
  return false;
}

function isLevelNames(value: unknown): boolean {
  if (value === undefined) return true;
  if (!isRecord(value)) return false;
  const entries = Object.entries(value);
  // A value shared by two levels could not be reversed.
  const names = entries.map(([, name]) => name);
  return (
    entries.every(([level, name]) => (EFFORT_LEVELS as readonly string[]).includes(level) && isNonEmptyString(name)) &&
    new Set(names).size === names.length
  );
}

function isIsolation(value: unknown): boolean {
  if (value === undefined) return true;
  if (!isRecord(value)) return false;
  const { env, args, runScopedHome } = value;
  if (env !== undefined && !(isRecord(env) && Object.entries(env).every(([name, v]) => name.length > 0 && typeof v === 'string'))) {
    return false;
  }
  if (args !== undefined && !(isStringArray(args) && args.every((entry) => entry.length > 0))) return false;
  return runScopedHome === undefined || isNonEmptyString(runScopedHome);
}

function isAcpSessionProbe(value: unknown): boolean {
  if (value === undefined) return true;
  if (!isRecord(value)) return false;
  const rule = value['notLoggedIn'];
  return isRecord(rule) && Number.isInteger(rule['rpcCode']) && isNonEmptyString(rule['textContains']);
}

function isProbeEnv(value: unknown): boolean {
  return value === undefined || (isRecord(value) && Object.entries(value).every(([name, v]) => name.length > 0 && typeof v === 'string'));
}

function isPresenceFileProbe(value: unknown): boolean {
  if (value === undefined) return true;
  if (!isRecord(value)) return false;
  return isNonEmptyString(value['homeEnv']) && isNonEmptyString(value['homeDir']) && isNonEmptyString(value['file']);
}

function isTimeoutMs(value: unknown): boolean {
  return value === undefined || (typeof value === 'number' && Number.isInteger(value) && value >= 0);
}

export function isProviderDef(value: unknown): value is ProviderDef {
  if (!isRecord(value)) return false;
  if (!isNonEmptyString(value['id'])) return false;
  if (!isNonEmptyString(value['displayName'])) return false;
  if (!isNonEmptyStringArray(value['bins'])) return false;
  if (!isNonEmptyStringArray(value['versionArgs'])) return false;
  const authProbe = value['authProbe'];
  if (authProbe !== undefined && !(isRecord(authProbe) && isStringArray(authProbe['args']) && isAcpSessionProbe(authProbe['acpSession']) && isPresenceFileProbe(authProbe['presenceFile']) && isProbeEnv(authProbe['env']))) {
    return false;
  }
  if (isRecord(authProbe) && authProbe['parse'] !== undefined && authProbe['parse'] !== 'credential-count' && authProbe['parse'] !== 'logged-out-text' && authProbe['parse'] !== 'provider-key-present' && authProbe['parse'] !== 'logged-in-json') {
    return false;
  }
  if (isRecord(authProbe) && authProbe['parse'] === 'logged-out-text' && !isNonEmptyString(authProbe['loggedOutText'])) return false;
  const helpArgs = value['helpArgs'];
  if (helpArgs !== undefined && !isStringArray(helpArgs)) return false;
  if (value['helpNeedsLogin'] !== undefined && value['helpNeedsLogin'] !== true) return false;
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
  if (config['mechanism'] !== 'none' && !isNonEmptyString(config['name'])) return false;
  if (!isBuildLaunch(value['buildLaunch'])) return false;
  if (!isEffortArg(value['effortArg'])) return false;
  if (!isLevelNames(value['levelNames'])) return false;
  if (!isIsolation(value['isolation'])) return false;
  const telemetryOff = value['telemetryOff'];
  if (telemetryOff !== undefined && !(isStringArray(telemetryOff) && telemetryOff.every((entry) => entry.length > 0))) return false;
  if (!RESUME_MODES.includes(value['resume'] as ProviderDef['resume'])) return false;
  if (!isCapabilities(value['capabilities'])) return false;
  const installHint = value['installHint'];
  if (!(isRecord(installHint) && isNonEmptyString(installHint['url']))) return false;
  if (!isTimeoutMs(value['firstOutputTimeoutMs']) || !isTimeoutMs(value['inactivityTimeoutMs'])) return false;
  const mark = value['mark'];
  if (
    mark !== null &&
    !(isRecord(mark) && isNonEmptyString(mark['viewBox']) && isNonEmptyString(mark['path']) && FILL_RULES.includes(mark['fillRule'] as NonNullable<ProviderDef['mark']>['fillRule']))
  ) {
    return false;
  }
  return true;
}
