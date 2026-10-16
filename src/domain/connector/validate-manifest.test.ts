import { describe, expect, it } from 'vitest';
import type { ConnectorId } from '../shared';
import {
  CONNECTOR_API_VERSION,
  validateConnectorManifest,
  type ConnectorManifest,
  type ConnectorManifestError,
} from './manifest';

const id = (raw: string): ConnectorId => raw as ConnectorId;

// Validation is about values the types would already refuse: hand them in as the field they claim.
const bad = <T>(value: unknown): T => value as T;

const manifest = (overrides: Partial<ConnectorManifest> = {}): ConnectorManifest => ({
  id: id('github'),
  name: 'GitHub',
  version: '1.2.3',
  apiVersion: CONNECTOR_API_VERSION,
  provides: ['forge'],
  hostMatch: ['github.com'],
  network: ['api.github.com'],
  settings: [],
  ...overrides,
});

const field = (key: string) => ({ key, label: key, kind: 'text' as const, required: true });

const deepFreeze = <T>(value: T): T => {
  if (value !== null && typeof value === 'object') {
    for (const nested of Object.values(value as Record<string, unknown>)) deepFreeze(nested);
    Object.freeze(value);
  }
  return value;
};

describe('validateConnectorManifest', () => {
  it('R-182: accepts the minimal valid manifest and returns the same reference', () => {
    const m = manifest();
    const result = validateConnectorManifest(m);
    expect(result).toEqual({ ok: true, value: m });
    expect(result.ok && result.value).toBe(m);
  });

  it('R-182: accepts a forge manifest with an empty hostMatch', () => {
    // Selected only by an explicit per-repo forge.kind, never by host matching.
    expect(validateConnectorManifest(manifest({ hostMatch: [] }))).toEqual({ ok: true, value: manifest({ hostMatch: [] }) });
  });

  it('R-182: rejects a non-slug id with invalid_id', () => {
    for (const raw of ['GitHub', 'gh hub', 'github!', '']) {
      expect(validateConnectorManifest(manifest({ id: id(raw) }))).toEqual({ ok: false, error: 'invalid_id' });
    }
  });

  it('R-182: rejects an empty provides with empty_provides', () => {
    expect(validateConnectorManifest(manifest({ provides: [] }))).toEqual({ ok: false, error: 'empty_provides' });
  });

  it('R-182: rejects an unknown family with unknown_family', () => {
    expect(validateConnectorManifest(manifest({ provides: bad(['forge', 'wiki']) }))).toEqual({ ok: false, error: 'unknown_family' });
    expect(validateConnectorManifest(manifest({ provides: bad(['Forge']) }))).toEqual({ ok: false, error: 'unknown_family' });
  });

  it('R-182: rejects a repeated family with duplicate_family', () => {
    expect(validateConnectorManifest(manifest({ provides: ['forge', 'tracker', 'forge'] }))).toEqual({
      ok: false,
      error: 'duplicate_family',
    });
  });

  it('R-182: rejects hostMatch entries that are not a bare host or *.host with bad_host_match', () => {
    for (const entry of [
      '*',
      '*.',
      'https://github.com',
      'github.com/owner',
      'github.com:22',
      '*evil.com',
      'evil*.com',
      '',
      'github..com',
      '-github.com',
    ]) {
      expect(validateConnectorManifest(manifest({ hostMatch: [entry] }))).toEqual({ ok: false, error: 'bad_host_match' });
    }
    // A wildcard label prefix and host case are both fine — matching is case-insensitive.
    expect(validateConnectorManifest(manifest({ hostMatch: ['*.GitHub.com', 'localhost'] })).ok).toBe(true);
  });

  it('R-182: rejects a wildcard or scheme/path network entry with wildcard_network', () => {
    for (const entry of ['*', 'api.*.com', 'https://api.github.com', 'api.github.com/v3']) {
      expect(validateConnectorManifest(manifest({ network: [entry] }))).toEqual({ ok: false, error: 'wildcard_network' });
    }
    // Ports are not paths: a host:port egress target stays valid.
    expect(validateConnectorManifest(manifest({ network: ['localhost:8123'] })).ok).toBe(true);
  });

  it('R-182: rejects duplicate setting keys with duplicate_setting', () => {
    expect(validateConnectorManifest(manifest({ settings: [field('token'), field('token')] }))).toEqual({
      ok: false,
      error: 'duplicate_setting',
    });
  });

  it('R-182: refuses every other apiVersion with unsupported_api', () => {
    for (const apiVersion of [0, 2, CONNECTOR_API_VERSION + 1]) {
      expect(validateConnectorManifest(manifest({ apiVersion }))).toEqual({ ok: false, error: 'unsupported_api' });
    }
  });

  it('R-182: rejects a non-semver version with bad_version', () => {
    for (const version of ['1.0', 'v1.0.0', '1.2.x', 'latest', '']) {
      expect(validateConnectorManifest(manifest({ version }))).toEqual({ ok: false, error: 'bad_version' });
    }
    expect(validateConnectorManifest(manifest({ version: '0.0.0' })).ok).toBe(true);
    expect(validateConnectorManifest(manifest({ version: '1.2.3-rc.1' })).ok).toBe(true);
    expect(validateConnectorManifest(manifest({ version: '1.2.3+build.7' })).ok).toBe(true);
  });

  it('R-182: reports the first failing check in the contract order', () => {
    const families = bad<ConnectorManifest['provides']>;
    const strings = bad<readonly string[]>;
    const order: readonly [Partial<ConnectorManifest>, ConnectorManifestError][] = [
      [{ id: id('GH'), provides: [], version: 'x' }, 'invalid_id'],
      [{ provides: [], version: 'x' }, 'empty_provides'],
      [{ provides: families(['wiki']), hostMatch: strings(['*']) }, 'unknown_family'],
      [{ provides: families(['forge', 'forge']), hostMatch: strings(['*']) }, 'duplicate_family'],
      [{ hostMatch: strings(['*']), network: strings(['*']) }, 'bad_host_match'],
      [{ network: strings(['*']), settings: [field('a'), field('a')] }, 'wildcard_network'],
      [{ settings: [field('a'), field('a')], apiVersion: 99 }, 'duplicate_setting'],
      [{ apiVersion: 99, version: 'x' }, 'unsupported_api'],
    ];
    for (const [overrides, error] of order) {
      expect(validateConnectorManifest(manifest(overrides))).toEqual({ ok: false, error });
    }
  });

  it('R-182: never mutates the manifest it validates', () => {
    const m = deepFreeze(manifest({ settings: [field('token')], requiresCli: 'gh' }));
    const before = JSON.stringify(m);
    expect(validateConnectorManifest(m)).toEqual({ ok: true, value: m });
    expect(JSON.stringify(m)).toBe(before);
  });
});
