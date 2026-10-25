// Local account scan: finds Claude-style config directories in the home directory and proposes
// them as candidates. Contract: docs/v2/provider-capabilities.md → "Local account discovery (P-33)".
// Only key names, the endpoint host, the endpoint URL (origin plus pathname) and an OAuth-present
// boolean survive parsing; every other byte of the two files read is dropped at once, and nothing
// is logged.
import { readdir, stat, open } from 'node:fs/promises';
import { homedir } from 'node:os';
import { join } from 'node:path';

import type { AccountCandidate, AccountDiscovery, AccountRecord, DiscoveredProvider, ProviderDiscovery } from '../../../application/index';
import type { RouteKindRecord } from '../../../domain/index';
import { BUILTIN_PROVIDER_DEFS, type ProviderDef } from '../defs/index';
import { CAPABILITY_REGISTRY, createCapabilityCatalog } from '../registry/index';

/** A file larger than this is treated as unreadable instead of being parsed. */
export const MAX_READ_BYTES = 1024 * 1024;

const DIR_NAME = /^\.claude(-[A-Za-z0-9_-]+)?$/;
const DEFAULT_DIR_NAME = '.claude';
const PROVIDER_ID = 'claude-code';
const IDENTITY_FILE = '.claude.json';
export const SETTINGS_FILE = 'settings.json';

const ENDPOINT_KEYS: ReadonlySet<string> = new Set(['ANTHROPIC_BASE_URL']);
/** Token env keys in the order the CLI prefers them; the importer reads the first one set. */
export const TOKEN_KEY_ORDER: readonly string[] = ['ANTHROPIC_AUTH_TOKEN', 'ANTHROPIC_API_KEY'];
const TOKEN_KEYS: ReadonlySet<string> = new Set(TOKEN_KEY_ORDER);
const MODEL_KEYS: ReadonlySet<string> = new Set([
  'ANTHROPIC_MODEL',
  'ANTHROPIC_SMALL_FAST_MODEL',
  'ANTHROPIC_DEFAULT_OPUS_MODEL',
  'ANTHROPIC_DEFAULT_SONNET_MODEL',
  'ANTHROPIC_DEFAULT_HAIKU_MODEL',
]);

/** The narrow file-system surface the scan needs; tests inject an in-memory one. */
export interface AccountScanFs {
  listEntries(dir: string): Promise<readonly string[]>;
  isDirectory(path: string): Promise<boolean>;
  /** Text of the file, `undefined` when it does not exist; throws when it cannot be read or exceeds `maxBytes`. */
  readText(path: string, maxBytes: number): Promise<string | undefined>;
}

export interface AccountScanOptions {
  readonly fs: AccountScanFs;
  readonly homeDir: string;
  readonly accounts: { list(): Promise<readonly AccountRecord[]> };
  /** Defaults to the capability registry's route kinds. */
  readonly routeKinds?: readonly RouteKindRecord[];
  /** The discovery whose facts decide which providers are installed (P-53); absent = no machine-login candidates. */
  readonly providers?: ProviderDiscovery;
  /** Defaults to the built-in definitions; their `accountHome` is display data only. */
  readonly defs?: readonly ProviderDef[];
  /** The environment the `accountHome` override variable is looked up in (presence only, never the value). */
  readonly env?: Readonly<Record<string, string>>;
}

type Override = 'endpoint' | 'token' | 'model';

interface Evidence {
  readonly readable: boolean; // false once any of the files failed to read or parse
  readonly hasOauthLogin: boolean;
  /** An OAuth login was found, yet no identity carried a tier shape that proves a seat; the login
   *  is proposed anyway, flagged so the UI can say it could not be verified. */
  readonly loginUnverified: boolean;
  readonly envOverrides: readonly Override[];
  readonly endpointHost?: string;
  readonly endpointUrl?: string;
  readonly endpointUnparsed: boolean; // an endpoint override whose host could not be taken
}

type Parsed = { readonly state: 'missing' } | { readonly state: 'failed' } | { readonly state: 'ok'; readonly value: unknown };

async function readJson(fs: AccountScanFs, path: string): Promise<Parsed> {
  try {
    const text = await fs.readText(path, MAX_READ_BYTES);
    if (text === undefined) return { state: 'missing' };
    return { state: 'ok', value: JSON.parse(text) as unknown };
  } catch {
    return { state: 'failed' };
  }
}

function isRecord(value: unknown): value is Readonly<Record<string, unknown>> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function hostOf(value: unknown): string | undefined {
  if (typeof value !== 'string') return undefined;
  try {
    const host = new URL(value).hostname.toLowerCase();
    return host === '' ? undefined : host;
  } catch {
    return undefined;
  }
}

/** Both facts a candidate may carry about the configured endpoint, taken in one parse: the host
 *  classification matches on and the URL adoption stores. The URL is `origin + pathname` with one
 *  trailing `/` removed — the query string and fragment never survive. A URL with userinfo
 *  (`user:pass@`) yields nothing, so no part of a credential can reach a candidate. */
function endpointOf(value: unknown): { readonly host: string; readonly url: string } | undefined {
  if (typeof value !== 'string') return undefined;
  try {
    const parsed = new URL(value);
    if (parsed.username !== '' || parsed.password !== '') return undefined;
    const host = parsed.hostname.toLowerCase();
    if (host === '') return undefined;
    return { host, url: parsed.origin + parsed.pathname.replace(/\/$/, '') };
  } catch {
    return undefined;
  }
}

function hostOfAccount(endpoint: string | undefined): string | undefined {
  return endpoint === undefined ? undefined : hostOf(endpoint);
}

async function gather(fs: AccountScanFs, dir: string, withHomeIdentity: boolean, homeDir: string): Promise<Evidence> {
  let readable = true;
  let sawOauthLogin = false;
  let sawSeatProvingTier = false;
  const overrides = new Set<Override>();
  let endpointHost: string | undefined;
  let endpointUrl: string | undefined;
  let endpointUnparsed = false;

  const settings = await readJson(fs, join(dir, SETTINGS_FILE));
  if (settings.state === 'failed') readable = false;
  if (settings.state === 'ok' && isRecord(settings.value) && isRecord(settings.value.env)) {
    for (const [key, value] of Object.entries(settings.value.env)) {
      if (ENDPOINT_KEYS.has(key)) {
        overrides.add('endpoint');
        const endpoint = endpointOf(value);
        endpointHost = endpoint?.host;
        endpointUrl = endpoint?.url;
        if (endpoint === undefined) endpointUnparsed = true;
      } else if (TOKEN_KEYS.has(key)) overrides.add('token');
      else if (MODEL_KEYS.has(key)) overrides.add('model');
    }
  }

  const identityPaths = [join(dir, IDENTITY_FILE), ...(withHomeIdentity ? [join(homeDir, IDENTITY_FILE)] : [])];
  for (const path of identityPaths) {
    const identity = await readJson(fs, path);
    if (identity.state === 'failed') readable = false;
    if (identity.state === 'ok' && isRecord(identity.value) && isRecord(identity.value.oauthAccount)) {
      const oa = identity.value.oauthAccount;
      sawOauthLogin = true;
      // The tier shape the CLI writes while no seat is recorded (an expired or downgraded free
      // tier); a working Pro account can wear it too, so the login is kept — only flagged.
      const seatProvingTier =
        oa['organizationRateLimitTier'] !== 'default_claude_ai' ||
        (oa['seatTier'] !== null && oa['seatTier'] !== undefined) ||
        (oa['userRateLimitTier'] !== null && oa['userRateLimitTier'] !== undefined);
      if (seatProvingTier) sawSeatProvingTier = true;
    }
  }

  const order: readonly Override[] = ['endpoint', 'token', 'model'];
  return {
    readable,
    hasOauthLogin: sawOauthLogin,
    loginUnverified: sawOauthLogin && !sawSeatProvingTier,
    envOverrides: order.filter((o) => overrides.has(o)),
    ...(endpointHost !== undefined ? { endpointHost } : {}),
    ...(endpointUrl !== undefined ? { endpointUrl } : {}),
    endpointUnparsed,
  };
}

export function createAccountScan(options: AccountScanOptions): AccountDiscovery {
  const { fs, homeDir } = options;
  const allKinds: readonly RouteKindRecord[] = options.routeKinds ?? CAPABILITY_REGISTRY.routeKinds;
  const routeKinds = allKinds.filter((k) => k.providerId === PROVIDER_ID);
  const subscriptionKind = routeKinds.find((k) => k.authMode === 'subscription' && k.endpointHost === undefined);

  function classify(
    evidence: Evidence,
  ): Pick<AccountCandidate, 'kind' | 'routeKind' | 'endpointHost' | 'endpointUrl' | 'warnings'> | undefined {
    const warnings: ('env_overrides_login' | 'unreadable' | 'login_unverified')[] = [];
    if (evidence.endpointHost !== undefined) {
      const preset = routeKinds.find((k) => k.endpointHost === evidence.endpointHost);
      if (preset === undefined) return undefined; // an endpoint no preset knows is not proposed
      if (evidence.hasOauthLogin) warnings.push('env_overrides_login');
      if (evidence.loginUnverified) warnings.push('login_unverified');
      return {
        kind: 'compatible_endpoint',
        routeKind: preset.id,
        endpointHost: evidence.endpointHost,
        ...(evidence.endpointUrl !== undefined ? { endpointUrl: evidence.endpointUrl } : {}),
        warnings,
      };
    }
    const overridesLogin = evidence.endpointUnparsed || evidence.envOverrides.includes('token');
    if (evidence.hasOauthLogin && !overridesLogin && subscriptionKind !== undefined) {
      if (evidence.loginUnverified) warnings.push('login_unverified');
      return { kind: 'subscription', routeKind: subscriptionKind.id, warnings };
    }
    return undefined;
  }

  const catalog = createCapabilityCatalog();
  const defs = options.defs ?? BUILTIN_PROVIDER_DEFS;

  /** One discovery pass answers both candidate kinds: the machine-login rows are built from its
   *  results, and the claude-code fact settles whether the default directory's login is live. */
  async function discoveredFacts(): Promise<readonly DiscoveredProvider[]> {
    if (options.providers === undefined) return [];
    const found: DiscoveredProvider[] = [];
    try {
      await options.providers.discover((result) => {
        found.push(result);
      });
    } catch {
      return [];
    }
    return found;
  }

  /** One candidate per installed provider that has no directory scanner (P-53, I-38). Nothing is read from disk. */
  async function machineLogins(
    existing: readonly AccountRecord[],
    facts: readonly DiscoveredProvider[],
  ): Promise<readonly AccountCandidate[]> {
    const candidates: AccountCandidate[] = [];
    for (const def of defs) {
      if (def.id === PROVIDER_ID) continue; // its candidates come from the directory scan
      const fact = facts.find((entry) => entry.defId === def.id);
      if (fact === undefined || fact.binPath === null) continue;
      const routeKind = catalog.routeKindOf({ provider: def.id, authMode: 'subscription' });
      if (routeKind === undefined) continue;
      const home = def.accountHome;
      const displayPath =
        home?.env !== undefined && options.env?.[home.env] !== undefined && options.env[home.env] !== ''
          ? `$${home.env}`
          : (home?.path ?? def.displayName);
      candidates.push({
        sourcePath: `machine-login:${def.id}`,
        displayPath,
        kind: 'machine_login',
        provider: def.id,
        routeKind,
        hasOauthLogin: fact.loggedIn === true,
        envOverrides: [],
        warnings: [],
        alreadyAdded: existing.some((account) => account.provider === def.id && account.identityDir === undefined),
      });
    }
    return candidates;
  }

  return {
    async scan() {
      let existing: readonly AccountRecord[] = [];
      try {
        existing = await options.accounts.list();
      } catch {
        existing = [];
      }
      const facts = await discoveredFacts();
      return [...(await scanDirectories(existing, facts)), ...(await machineLogins(existing, facts))];
    },
  };

  async function scanDirectories(
    existing: readonly AccountRecord[],
    facts: readonly DiscoveredProvider[],
  ): Promise<readonly AccountCandidate[]> {
    let names: readonly string[];
    try {
      names = await fs.listEntries(homeDir);
    } catch {
      return [];
    }
    const candidates: AccountCandidate[] = [];
    // The CLI's own status call about the default directory's login (no probe ran = null).
    const cliLoginLive = facts.find((fact) => fact.defId === PROVIDER_ID)?.loggedIn === true;
    for (const name of [...names].filter((n) => DIR_NAME.test(n)).sort()) {
      const sourcePath = join(homeDir, name);
      try {
        if (!(await fs.isDirectory(sourcePath))) continue;
        const isDefaultDir = name === DEFAULT_DIR_NAME;
        const evidence = await gather(fs, sourcePath, isDefaultDir, homeDir);
        const classified = classify(evidence);
        if (classified === undefined) continue;
        const alreadyAdded = existing.some(
          (account) =>
            account.identityDir === sourcePath ||
            // The default directory is one seat with the machine login: a subscription account of
            // this provider with no identityDir already occupies it.
            (isDefaultDir &&
              classified.kind === 'subscription' &&
              account.provider === PROVIDER_ID &&
              account.identityDir === undefined &&
              account.routeKind === classified.routeKind) ||
            (classified.endpointHost !== undefined &&
              account.routeKind === classified.routeKind &&
              hostOfAccount(account.endpoint) === classified.endpointHost),
        );
        // The CLI's own status call proved the default directory's login live, so the identity
        // file's free-tier shape is a stale file, not a dead login — the flag would be a false alarm.
        const flagged: AccountCandidate['warnings'] = evidence.readable
          ? classified.warnings
          : [...classified.warnings, 'unreadable'];
        const warnings = flagged.filter((warning) => !(isDefaultDir && cliLoginLive && warning === 'login_unverified'));
        candidates.push({
          sourcePath,
          displayPath: `~/${name}`,
          kind: classified.kind,
          provider: PROVIDER_ID,
          routeKind: classified.routeKind,
          ...(classified.endpointHost !== undefined ? { endpointHost: classified.endpointHost } : {}),
          ...(classified.endpointUrl !== undefined ? { endpointUrl: classified.endpointUrl } : {}),
          ...(isDefaultDir ? { defaultHome: true } : {}),
          hasOauthLogin: evidence.hasOauthLogin,
          envOverrides: evidence.envOverrides,
          warnings,
          alreadyAdded,
        });
      } catch {
        // one broken directory never stops the scan
      }
    }
    return candidates;
  }
}

/** The real reader over node:fs; the file is read through a capped handle so a huge file never loads. */
export function createNodeAccountScanFs(): AccountScanFs {
  return {
    async listEntries(dir) {
      return readdir(dir);
    },
    async isDirectory(path) {
      return (await stat(path)).isDirectory();
    },
    async readText(path, maxBytes) {
      let handle;
      try {
        handle = await open(path, 'r');
      } catch (error) {
        if (typeof error === 'object' && error !== null && (error as { code?: unknown }).code === 'ENOENT') return undefined;
        throw error;
      }
      try {
        const { size } = await handle.stat();
        if (size > maxBytes) throw new Error('file exceeds the read cap');
        return await handle.readFile({ encoding: 'utf8' });
      } finally {
        await handle.close();
      }
    },
  };
}

export function createNodeAccountScan(
  accounts: AccountScanOptions['accounts'],
  machine?: { readonly providers: ProviderDiscovery; readonly env: Readonly<Record<string, string>> },
): AccountDiscovery {
  return createAccountScan({ fs: createNodeAccountScanFs(), homeDir: homedir(), accounts, ...(machine ?? {}) });
}
