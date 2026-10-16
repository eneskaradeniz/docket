// The connector manifest and its two laws (docs/v2/domain.md, the connector addendum): a
// connector is a self-contained module described by one manifest, validated before it is ever
// registered, and selected for a repo by the host of its git remote.
import { err, isSlug, ok, type Result } from '../shared';
import type { ConnectorId } from '../shared';

/** The families of port a connector can provide; the set every `provides` entry must come from. */
export type PortFamily = 'forge' | 'tracker' | 'ci' | 'deploy';

export interface ConnectorSettingField {
  readonly key: string;
  readonly label: string;
  readonly kind: 'text' | 'url' | 'secret';
  readonly required: boolean;
}

export interface ConnectorManifest {
  readonly id: ConnectorId;
  readonly name: string;
  /** semver of the connector */
  readonly version: string;
  /** the connector API the module was written against */
  readonly apiVersion: number;
  /** non-empty, unique */
  readonly provides: readonly PortFamily[];
  /** remote-URL host patterns for 'forge' (data, e.g. 'github.com'); empty otherwise */
  readonly hostMatch: readonly string[];
  /** the hosts the connector may reach (egress allowlist); '*' is invalid */
  readonly network: readonly string[];
  /** account fields; 'secret' fields are keychain refs, never values */
  readonly settings: readonly ConnectorSettingField[];
  /** an external CLI the connector shells out to, probed not assumed */
  readonly requiresCli?: string;
}

/** The connector API version this core speaks. A module written against any other version is
 *  refused outright — never loaded in a degraded mode. */
export const CONNECTOR_API_VERSION = 1;

export type ConnectorManifestError =
  | 'invalid_id'
  | 'empty_provides'
  | 'duplicate_family'
  | 'unknown_family'
  | 'bad_host_match'
  | 'wildcard_network'
  | 'duplicate_setting'
  | 'unsupported_api'
  | 'bad_version';

const PORT_FAMILIES: readonly PortFamily[] = ['forge', 'tracker', 'ci', 'deploy'];

// A bare DNS-style host: dot-separated labels, each starting and ending alphanumeric, so
// 'github.com', 'localhost' and 'gist.github.com' pass while 'a..b' or '-x.com' fail.
const BARE_HOST = /^[a-z0-9](?:[a-z0-9-]*[a-z0-9])?(?:\.[a-z0-9](?:[a-z0-9-]*[a-z0-9])?)*$/;

// semver.org: MAJOR.MINOR.PATCH with optional pre-release and build metadata.
const SEMVER =
  /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(?:-(?:0|[1-9]\d*|\d*[a-zA-Z-][0-9a-zA-Z-]*)(?:\.(?:0|[1-9]\d*|\d*[a-zA-Z-][0-9a-zA-Z-]*))*)?(?:\+[0-9a-zA-Z-]+(?:\.[0-9a-zA-Z-]+)*)?$/;

// A hostMatch entry is a bare host or a '*.host' wildcard over subdomains — no scheme, path,
// port, or a '*' in any other position. Hosts are case-insensitive, so case is normalized here.
const isHostPattern = (raw: string): boolean => {
  const entry = raw.toLowerCase();
  if (entry.includes('://') || entry.includes('/') || entry.includes(':')) return false;
  const host = entry.startsWith('*.') ? entry.slice(2) : entry;
  if (host.includes('*')) return false;
  return BARE_HOST.test(host);
};

// A network entry is a host the connector may reach; a port is allowed (it is not a path), a
// wildcard or a scheme/path is not.
const isNetworkEntry = (raw: string): boolean => !raw.includes('*') && !raw.includes('://') && !raw.includes('/');

/** R-182: validate a manifest before it is registered, checking in the contract's order and
 *  reporting the first failure. A 'forge' module with an empty `hostMatch` is valid — it is
 *  selected only by an explicit per-repo `forge.kind`, never by host matching. Pure: the input
 *  is returned unmodified, never mutated. */
export function validateConnectorManifest(m: ConnectorManifest): Result<ConnectorManifest, ConnectorManifestError> {
  if (!isSlug(m.id)) return err('invalid_id');
  if (m.provides.length === 0) return err('empty_provides');
  const seenFamilies: PortFamily[] = [];
  for (const family of m.provides) {
    if (!PORT_FAMILIES.includes(family)) return err('unknown_family');
    if (seenFamilies.includes(family)) return err('duplicate_family');
    seenFamilies.push(family);
  }
  for (const entry of m.hostMatch) if (!isHostPattern(entry)) return err('bad_host_match');
  for (const entry of m.network) if (!isNetworkEntry(entry)) return err('wildcard_network');
  const seenSettingKeys: string[] = [];
  for (const field of m.settings) {
    if (seenSettingKeys.includes(field.key)) return err('duplicate_setting');
    seenSettingKeys.push(field.key);
  }
  if (m.apiVersion !== CONNECTOR_API_VERSION) return err('unsupported_api');
  if (!SEMVER.test(m.version)) return err('bad_version');
  return ok(m);
}

const SCHEME_URL = /^[a-zA-Z][a-zA-Z0-9+.-]*:\/\//;

// The host half of a URL authority: 'git@github.com:22/owner' → 'github.com'. An empty host,
// a leftover port, or anything that is not a bare host makes the remote unparsable.
const hostOfAuthority = (authorityAndPath: string): string | undefined => {
  let authority = authorityAndPath;
  const pathAt = authority.search(/[/?#]/);
  if (pathAt >= 0) authority = authority.slice(0, pathAt);
  const userInfoAt = authority.lastIndexOf('@');
  if (userInfoAt >= 0) authority = authority.slice(userInfoAt + 1);
  const lower = authority.toLowerCase();
  if (lower.startsWith('[')) {
    // IPv6 literal: '[::1]' or '[::1]:22' — only an optional port may follow the bracket.
    const closeAt = lower.indexOf(']');
    if (closeAt < 1) return undefined;
    const rest = lower.slice(closeAt + 1);
    return rest === '' || (rest.startsWith(':') && !rest.slice(1).includes(':')) ? lower.slice(1, closeAt) : undefined;
  }
  const portAt = lower.indexOf(':');
  const host = portAt >= 0 ? lower.slice(0, portAt) : lower;
  return host !== '' && BARE_HOST.test(host) ? host : undefined;
};

// The host of a git remote: an 'https://user@host:port/path' style URL, or the scp-like
// 'user@host:path' form whose separating colon comes before any slash. Anything else — a bare
// word, a local path, a hostless URL — is unparsable and answers undefined.
const extractRemoteHost = (remoteUrl: string): string | undefined => {
  const remote = remoteUrl.trim();
  if (remote === '') return undefined;
  const scheme = SCHEME_URL.exec(remote);
  if (scheme !== null) return hostOfAuthority(remote.slice(scheme[0].length));
  const colonAt = remote.indexOf(':');
  const slashAt = remote.indexOf('/');
  if (colonAt <= 0 || (slashAt >= 0 && slashAt < colonAt)) return undefined;
  let host = remote.slice(0, colonAt);
  const userInfoAt = host.lastIndexOf('@');
  if (userInfoAt >= 0) host = host.slice(userInfoAt + 1);
  host = host.toLowerCase();
  return BARE_HOST.test(host) ? host : undefined;
};

/** R-183: does this manifest's `hostMatch` cover the host of a git remote? The host is extracted
 *  (https, ssh://, scp-like), lower-cased, and compared to each entry: a bare host matches only
 *  itself, a '*.host' entry matches any subdomain — the leading dot of the suffix is the label
 *  boundary, so 'evil-github.com' and 'github.com.evil.io' never match 'github.com'. Pure; an
 *  unparsable remote answers false. */
export function matchConnectorHost(manifest: ConnectorManifest, remoteUrl: string): boolean {
  const host = extractRemoteHost(remoteUrl);
  if (host === undefined) return false;
  for (const raw of manifest.hostMatch) {
    const entry = raw.toLowerCase();
    if (entry.startsWith('*.')) {
      if (host.endsWith(entry.slice(1))) return true;
    } else if (host === entry) {
      return true;
    }
  }
  return false;
}
