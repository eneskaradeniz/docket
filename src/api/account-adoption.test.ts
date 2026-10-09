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
  provider: 'prov-a',
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
  it('A-85: returns the remembered scan to every reader; fresh: true scans anew and replaces it', async () => {
    const h = setup();
    const api = createApi(h.deps, undefined, undefined, undefined, undefined, undefined, h);
    expect(await api.query({ type: 'accounts.candidates' })).toEqual([{ ...ENDPOINT, provider: 'prov-a', billing: 'unknown' }]);
    await api.query({ type: 'accounts.candidates' });
    expect(h.scans.count).toBe(1);
    await api.query({ type: 'accounts.candidates', fresh: true });
    expect(h.scans.count).toBe(2);
  });

  it('A-67: a candidate names its provider through the route kind, null when the route kind is unknown', async () => {
    const h = setup();
    const stranger: AccountCandidate = { ...ENDPOINT, sourcePath: '/home/u/.other', routeKind: 'no-such-route' };
    const api = createApi(h.deps, undefined, undefined, undefined, undefined, undefined, {
      ...h,
      discovery: { scan: async () => [ENDPOINT, stranger] },
    });
    const rows = await api.query({ type: 'accounts.candidates' });
    expect(rows).toEqual([
      { ...ENDPOINT, provider: 'prov-a', billing: 'unknown' },
      { ...stranger, provider: null, billing: 'unknown' },
    ]);
  });

  it('A-83a: a candidate carries its route kind’s declared billing, else the fallback by kind', async () => {
    const h = setup();
    const zai: AccountCandidate = { ...ENDPOINT, sourcePath: '/home/u/.zai', routeKind: 'zai-route' };
    const metered: AccountCandidate = { ...ENDPOINT, sourcePath: '/home/u/.api', routeKind: 'api-route' };
    const subscription: AccountCandidate = {
      ...ENDPOINT,
      sourcePath: '/home/u/.sub',
      kind: 'subscription',
      routeKind: 'sub-route',
      hasOauthLogin: true,
      envOverrides: [],
    };
    const deps = createFakeDeps({
      clock: createFakeClock(1_000),
      capabilities: createFakeCapabilityCatalog([
        { id: 'endpoint-route', provider: 'prov-a', authMode: 'api_key' },
        { id: 'zai-route', provider: 'prov-a', authMode: 'api_key', defaultBilling: 'included' },
        { id: 'api-route', provider: 'prov-a', authMode: 'api_key', defaultBilling: 'metered' },
        { id: 'sub-route', provider: 'prov-a', authMode: 'subscription' },
      ]),
    });
    const api = createApi(deps, undefined, undefined, undefined, undefined, undefined, {
      ...h,
      discovery: { scan: async () => [ENDPOINT, zai, metered, subscription] },
    });
    const rows = (await api.query({ type: 'accounts.candidates' })) as readonly { readonly billing: string }[];
    expect(rows.map((row) => row.billing)).toEqual(['unknown', 'included', 'metered', 'included']);
  });

  it('answers not_found when no discovery is composed', async () => {
    const api = createApi(setup().deps);
    expect(await api.query({ type: 'accounts.candidates' })).toEqual({ ok: false, code: 'not_found' });
  });

  it('A-85: a just-adopted source reads alreadyAdded without a new scan', async () => {
    const SUBSCRIPTION: AccountCandidate = {
      sourcePath: '/home/u/.claude-work',
      displayPath: '~/.claude-work',
      kind: 'subscription',
      provider: 'prov-a',
      routeKind: 'sub-route',
      hasOauthLogin: true,
      envOverrides: [],
      warnings: [],
      alreadyAdded: false,
    };
    const UNTOUCHED: AccountCandidate = { ...SUBSCRIPTION, sourcePath: '/home/u/.claude-other', displayPath: '~/.claude-other' };
    const MACHINE: AccountCandidate = {
      sourcePath: 'machine-login:prov-b',
      displayPath: '~/.prov-b',
      kind: 'machine_login',
      provider: 'prov-b',
      routeKind: 'machine-route',
      hasOauthLogin: true,
      envOverrides: [],
      warnings: [],
      alreadyAdded: false,
    };
    const scans = { count: 0 };
    const discovery: AccountDiscovery = {
      scan: async () => {
        scans.count += 1;
        return [SUBSCRIPTION, ENDPOINT, MACHINE, UNTOUCHED];
      },
    };
    const deps = createFakeDeps({
      clock: createFakeClock(1_000),
      capabilities: createFakeCapabilityCatalog([
        { id: 'sub-route', provider: 'prov-a', authMode: 'subscription' },
        { id: 'endpoint-route', provider: 'prov-a', authMode: 'api_key', endpointHost: 'api.example.test' },
        { id: 'machine-route', provider: 'prov-b', authMode: 'subscription' },
      ]),
    });
    const api = createApi(deps, undefined, undefined, undefined, undefined, undefined, { discovery, importer: setup().importer });

    await api.query({ type: 'accounts.candidates' });
    expect(scans.count).toBe(1);
    for (const candidate of [SUBSCRIPTION, ENDPOINT, MACHINE]) {
      const adopted = await api.command(ACTOR, { type: 'account.adopt', sourcePath: candidate.sourcePath, label: 'L' });
      expect(adopted.ok).toBe(true);
    }
    // The remembered scan still answers, but its alreadyAdded flags are decided against the store.
    const rows = (await api.query({ type: 'accounts.candidates' })) as readonly {
      readonly sourcePath: string;
      readonly alreadyAdded: boolean;
    }[];
    expect(scans.count).toBe(1);
    const byPath = new Map(rows.map((row) => [row.sourcePath, row.alreadyAdded]));
    expect(byPath.get(SUBSCRIPTION.sourcePath)).toBe(true);
    expect(byPath.get(ENDPOINT.sourcePath)).toBe(true);
    expect(byPath.get(MACHINE.sourcePath)).toBe(true);
    expect(byPath.get(UNTOUCHED.sourcePath)).toBe(false);
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

  it('A-85: an adoption after the candidates query adds no scan; the remembered scan serves both', async () => {
    const h = setup();
    const api = createApi(h.deps, undefined, undefined, undefined, undefined, undefined, h);
    expect(await api.command(ACTOR, { type: 'account.adopt', sourcePath: '/nowhere', label: 'X' })).toEqual({
      ok: false,
      code: 'not_found',
    });
    await api.query({ type: 'accounts.candidates' });
    const before = h.scans.count;
    const adopted = await api.command(ACTOR, { type: 'account.adopt', sourcePath: ENDPOINT.sourcePath, label: 'GLM' });
    expect(adopted.ok).toBe(true);
    await api.query({ type: 'accounts.candidates' });
    expect(h.scans.count).toBe(before);
    // The scan predates the stored account, so a second adoption of the same path is refused.
    expect(await api.command(ACTOR, { type: 'account.adopt', sourcePath: ENDPOINT.sourcePath, label: 'Again' })).toEqual({
      ok: false,
      code: 'already_added',
    });
  });

  it('answers not_found when no discovery is composed', async () => {
    const api = createApi(setup().deps);
    expect(await api.command(ACTOR, { type: 'account.adopt', sourcePath: '/x', label: 'X' })).toEqual({
      ok: false,
      code: 'not_found',
    });
  });
});
