// api: accounts.candidates and account.adopt — the wire side of account adoption. The use case's
// own rules are tested beside it; here only the mapping onto the boundary is covered.
import { describe, expect, it } from 'vitest';

import type { Actor } from '../domain/index';

import type { AccountCandidate, AccountDiscovery, CredentialImporter } from '../application';
import { createFakeCapabilityCatalog, createFakeClock, createFakeDeps, createFakeEventLog } from '../application/ports/fakes';

import { createApi } from './api';

const ACTOR: Actor = { kind: 'user', id: 'user-1', label: 'Operator' };
const SENTINEL = 'sk-api-sentinel-1a2b3c';

const ENDPOINT: AccountCandidate = {
  sourcePath: '/home/u/.claude-glm',
  displayPath: '~/.claude-glm',
  kind: 'compatible_endpoint',
  routeKind: 'endpoint-route',
  endpointHost: 'api.example.test',
  hasOauthLogin: false,
  envOverrides: ['endpoint', 'token'],
  warnings: [],
  alreadyAdded: false,
};

const setup = () => {
  const scans = { count: 0 };
  const discovery: AccountDiscovery = {
    scan: async () => {
      scans.count += 1;
      return [ENDPOINT];
    },
  };
  const importer: CredentialImporter = { readEndpointToken: async () => SENTINEL };
  const log = createFakeEventLog();
  const deps = createFakeDeps({
    clock: createFakeClock(1_000),
    log,
    capabilities: createFakeCapabilityCatalog([
      { id: 'endpoint-route', provider: 'prov-a', authMode: 'api_key', endpointHost: 'api.example.test' },
    ]),
  });
  return { deps, discovery, importer, scans, log };
};

describe('accounts.candidates', () => {
  it('returns the scan result, cached for the session, and rescans on refresh', async () => {
    const h = setup();
    const api = createApi(h.deps, undefined, undefined, undefined, undefined, undefined, h);
    expect(await api.query({ type: 'accounts.candidates' })).toEqual([{ ...ENDPOINT, provider: 'prov-a' }]);
    await api.query({ type: 'accounts.candidates' });
    expect(h.scans.count).toBe(1);
    await api.query({ type: 'accounts.candidates', refresh: true });
    expect(h.scans.count).toBe(2);
  });

  it('A-53: a candidate names its provider through the route kind, null when the route kind is unknown', async () => {
    const h = setup();
    const stranger: AccountCandidate = { ...ENDPOINT, sourcePath: '/home/u/.other', routeKind: 'no-such-route' };
    const api = createApi(h.deps, undefined, undefined, undefined, undefined, undefined, {
      ...h,
      discovery: { scan: async () => [ENDPOINT, stranger] },
    });
    const rows = await api.query({ type: 'accounts.candidates' });
    expect(rows).toEqual([
      { ...ENDPOINT, provider: 'prov-a' },
      { ...stranger, provider: null },
    ]);
  });

  it('answers not_found when no discovery is composed', async () => {
    const api = createApi(setup().deps);
    expect(await api.query({ type: 'accounts.candidates' })).toEqual({ ok: false, code: 'not_found' });
  });
});

describe('account.adopt', () => {
  it('adopts the candidate, answers the new id, and the token reaches only the vault', async () => {
    const h = setup();
    const api = createApi(h.deps, undefined, undefined, undefined, undefined, undefined, h);
    const result = await api.command(ACTOR, {
      type: 'account.adopt',
      sourcePath: ENDPOINT.sourcePath,
      label: 'GLM',
      importToken: true,
    });
    if (!result.ok || result.id === undefined) throw new Error('adopt must answer an id');
    const record = (await h.deps.accounts.list())[0];
    expect(record).toMatchObject({ label: 'GLM', authMode: 'api_key', endpoint: 'https://api.example.test' });
    expect(await h.deps.secrets.get(record?.secretRef ?? '')).toBe(SENTINEL);
    expect(JSON.stringify({ result, record, audit: h.log.entries() })).not.toContain(SENTINEL);
    expect(h.log.entries().map((entry) => entry.action)).toContain('account.adopted');
  });

  it('maps the use case errors onto codes and drops the stale candidate cache', async () => {
    const h = setup();
    const api = createApi(h.deps, undefined, undefined, undefined, undefined, undefined, h);
    expect(await api.command(ACTOR, { type: 'account.adopt', sourcePath: '/nowhere', label: 'X' })).toEqual({
      ok: false,
      code: 'not_found',
    });
    await api.query({ type: 'accounts.candidates' });
    const before = h.scans.count;
    await api.command(ACTOR, { type: 'account.adopt', sourcePath: ENDPOINT.sourcePath, label: 'GLM' });
    await api.query({ type: 'accounts.candidates' });
    // The adoption scanned once itself and the cache was dropped, so the query scanned again.
    expect(h.scans.count).toBe(before + 2);
  });

  it('answers not_found when no discovery is composed', async () => {
    const api = createApi(setup().deps);
    expect(await api.command(ACTOR, { type: 'account.adopt', sourcePath: '/x', label: 'X' })).toEqual({
      ok: false,
      code: 'not_found',
    });
  });
});
