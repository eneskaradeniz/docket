// account adoption — turning a discovered candidate into an account (P-33). The command carries a
// source path and a label only; the candidate is re-found by a fresh scan, and a token reaches the
// vault only through an explicit import that no record, audit entry, return value or error echoes.
import { describe, expect, it } from 'vitest';

import type { Actor } from '../../domain/index';

import type { AccountCandidate, AccountDiscovery, AppDeps, CredentialImporter } from '../ports';
import {
  createFakeCapabilityCatalog,
  createFakeClock,
  createFakeDeps,
  createFakeEventLog,
  createFakeSecretVault,
  type FakeEventLog,
} from '../ports/fakes';

import { adoptAccountCandidate, createAccountCandidateList } from './account-adoption';

const USER: Actor = { kind: 'user', id: 'user-1', label: 'Operator' };
const SENTINEL = 'sk-sentinel-token-9f8e7d6c';

const SUBSCRIPTION: AccountCandidate = {
  sourcePath: '/home/u/.claude-work',
  displayPath: '~/.claude-work',
  kind: 'subscription',
  routeKind: 'sub-route',
  hasOauthLogin: true,
  envOverrides: [],
  warnings: [],
  alreadyAdded: false,
};
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

interface Harness {
  readonly deps: AppDeps & { readonly discovery: AccountDiscovery; readonly importer: CredentialImporter };
  readonly log: FakeEventLog;
  readonly scans: { count: number };
  readonly reads: string[];
}

const makeHarness = (
  candidates: readonly AccountCandidate[] = [SUBSCRIPTION, ENDPOINT],
  token: string | null = SENTINEL,
  importerFails = false,
): Harness => {
  const log = createFakeEventLog();
  const scans = { count: 0 };
  const reads: string[] = [];
  const discovery: AccountDiscovery = {
    scan: async () => {
      scans.count += 1;
      return candidates;
    },
  };
  const importer: CredentialImporter = {
    readEndpointToken: async (sourcePath) => {
      reads.push(sourcePath);
      if (importerFails) throw new Error(`cannot read ${SENTINEL}`);
      return token ?? undefined;
    },
  };
  const base = createFakeDeps({
    clock: createFakeClock(1_000),
    log,
    secrets: createFakeSecretVault(),
    capabilities: createFakeCapabilityCatalog([
      { id: 'sub-route', provider: 'prov-a', authMode: 'subscription' },
      { id: 'endpoint-route', provider: 'prov-a', authMode: 'api_key', endpointHost: 'api.example.test' },
    ]),
  });
  return { deps: { ...base, discovery, importer }, log, scans, reads };
};

describe('adoptAccountCandidate', () => {
  it('adopts a subscription candidate: identityDir is the source path, no secret, nothing imported', async () => {
    const h = makeHarness();
    const result = await adoptAccountCandidate(h.deps, { sourcePath: SUBSCRIPTION.sourcePath, label: 'Work', actor: USER });
    if (!result.ok) throw new Error('adoption must succeed');
    const record = await h.deps.accounts.get(result.value);
    expect(record).toMatchObject({
      provider: 'prov-a',
      label: 'Work',
      authMode: 'subscription',
      routeKind: 'sub-route',
      identityDir: SUBSCRIPTION.sourcePath,
      limitPolicy: 'wait_resume',
      caps: [],
    });
    expect(record?.secretRef).toBeUndefined();
    expect(record?.endpoint).toBeUndefined();
    expect(h.reads).toEqual([]);
  });

  it('adopts a compatible-endpoint candidate without a secret: https endpoint, a secretRef, empty vault', async () => {
    const h = makeHarness();
    const result = await adoptAccountCandidate(h.deps, { sourcePath: ENDPOINT.sourcePath, label: 'GLM', actor: USER });
    if (!result.ok) throw new Error('adoption must succeed');
    const record = await h.deps.accounts.get(result.value);
    expect(record).toMatchObject({
      provider: 'prov-a',
      authMode: 'api_key',
      routeKind: 'endpoint-route',
      endpoint: 'https://api.example.test',
    });
    expect(record?.identityDir).toBeUndefined();
    expect(record?.secretRef).toBeDefined();
    expect(await h.deps.secrets.get(record?.secretRef ?? '')).toBeUndefined();
    expect(h.reads).toEqual([]);
  });

  it('an unknown sourcePath fails with not_found and writes nothing', async () => {
    const h = makeHarness();
    const result = await adoptAccountCandidate(h.deps, { sourcePath: '/home/u/.claude-nope', label: 'X', actor: USER });
    expect(result).toEqual({ ok: false, error: 'not_found' });
    expect(await h.deps.accounts.list()).toEqual([]);
    expect(h.log.entries()).toEqual([]);
  });

  it('an already added candidate fails with already_added and writes nothing', async () => {
    const h = makeHarness([{ ...SUBSCRIPTION, alreadyAdded: true }]);
    const result = await adoptAccountCandidate(h.deps, { sourcePath: SUBSCRIPTION.sourcePath, label: 'X', actor: USER });
    expect(result).toEqual({ ok: false, error: 'already_added' });
    expect(await h.deps.accounts.list()).toEqual([]);
    expect(h.log.entries()).toEqual([]);
  });

  it('re-scans on every adoption instead of trusting an earlier answer', async () => {
    const h = makeHarness();
    await adoptAccountCandidate(h.deps, { sourcePath: SUBSCRIPTION.sourcePath, label: 'A', actor: USER });
    await adoptAccountCandidate(h.deps, { sourcePath: ENDPOINT.sourcePath, label: 'B', actor: USER });
    expect(h.scans.count).toBe(2);
  });

  it('importToken stores the token in the vault under the secretRef; it appears nowhere else', async () => {
    const h = makeHarness();
    const result = await adoptAccountCandidate(h.deps, {
      sourcePath: ENDPOINT.sourcePath,
      label: 'GLM',
      importToken: true,
      actor: USER,
    });
    if (!result.ok) throw new Error('adoption must succeed');
    const record = await h.deps.accounts.get(result.value);
    expect(await h.deps.secrets.get(record?.secretRef ?? '')).toBe(SENTINEL);
    expect(h.reads).toEqual([ENDPOINT.sourcePath]);
    const everywhereElse = JSON.stringify({ records: await h.deps.accounts.list(), audit: h.log.entries(), result });
    expect(everywhereElse).not.toContain(SENTINEL);
  });

  it('the token appears in no thrown or returned error, including a failing importer', async () => {
    const failing = makeHarness([ENDPOINT], SENTINEL, true);
    const result = await adoptAccountCandidate(failing.deps, {
      sourcePath: ENDPOINT.sourcePath,
      label: 'GLM',
      importToken: true,
      actor: USER,
    });
    // A failing read leaves the account created without a secret, never an error carrying a value.
    expect(result.ok).toBe(true);
    expect(JSON.stringify({ result, audit: failing.log.entries(), records: await failing.deps.accounts.list() })).not.toContain(SENTINEL);

    const rejected = makeHarness([{ ...ENDPOINT, endpointHost: 'other.example.test' }]);
    const mismatch = await adoptAccountCandidate(rejected.deps, {
      sourcePath: ENDPOINT.sourcePath,
      label: 'GLM',
      importToken: true,
      actor: USER,
    });
    expect(mismatch).toEqual({ ok: false, error: 'endpoint_mismatch' });
    expect(JSON.stringify(mismatch)).not.toContain(SENTINEL);
    expect(await rejected.deps.accounts.list()).toEqual([]);
  });

  it('importToken with no token on disk creates the account without a secret', async () => {
    const h = makeHarness([ENDPOINT], null);
    const result = await adoptAccountCandidate(h.deps, {
      sourcePath: ENDPOINT.sourcePath,
      label: 'GLM',
      importToken: true,
      actor: USER,
    });
    if (!result.ok) throw new Error('adoption must succeed');
    const record = await h.deps.accounts.get(result.value);
    expect(await h.deps.secrets.get(record?.secretRef ?? '')).toBeUndefined();
  });

  it('importToken on a subscription candidate is ignored', async () => {
    const h = makeHarness();
    const result = await adoptAccountCandidate(h.deps, {
      sourcePath: SUBSCRIPTION.sourcePath,
      label: 'Work',
      importToken: true,
      actor: USER,
    });
    expect(result.ok).toBe(true);
    expect(h.reads).toEqual([]);
    expect((await h.deps.accounts.list())[0]?.secretRef).toBeUndefined();
  });

  it('a client-supplied kind is never trusted: the command has no such field, the scan decides', async () => {
    const h = makeHarness();
    const forged = { sourcePath: SUBSCRIPTION.sourcePath, label: 'X', kind: 'compatible_endpoint', actor: USER };
    const result = await adoptAccountCandidate(h.deps, forged);
    if (!result.ok) throw new Error('adoption must succeed');
    expect((await h.deps.accounts.get(result.value))?.authMode).toBe('subscription');
  });

  it('audits account.adopted naming the account and the display path, never a value', async () => {
    const h = makeHarness();
    const result = await adoptAccountCandidate(h.deps, {
      sourcePath: ENDPOINT.sourcePath,
      label: 'GLM',
      importToken: true,
      actor: USER,
    });
    if (!result.ok) throw new Error('adoption must succeed');
    const adopted = h.log.entries().filter((entry) => entry.action === 'account.adopted');
    expect(adopted).toHaveLength(1);
    expect(adopted[0]).toMatchObject({
      actor: USER,
      subject: { kind: 'account', id: result.value },
      detail: { displayPath: '~/.claude-glm' },
    });
  });
});

describe('createAccountCandidateList', () => {
  it('scans once per session and again only on refresh', async () => {
    const h = makeHarness();
    const list = createAccountCandidateList(h.deps.discovery);
    expect(await list.get()).toEqual([SUBSCRIPTION, ENDPOINT]);
    await list.get();
    expect(h.scans.count).toBe(1);
    await list.get({ refresh: true });
    expect(h.scans.count).toBe(2);
  });

  it('invalidate drops the cache so the next read scans again', async () => {
    const h = makeHarness();
    const list = createAccountCandidateList(h.deps.discovery);
    await list.get();
    list.invalidate();
    await list.get();
    expect(h.scans.count).toBe(2);
  });
});
