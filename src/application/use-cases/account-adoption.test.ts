// account adoption — turning a discovered candidate into an account (P-33). The command carries a
// source path and a label only; the candidate is re-found in the remembered scan (A-85), and a
// token reaches the vault only through an explicit import that no record, audit entry, return
// value or error echoes.
import { describe, expect, it } from 'vitest';

import type { Actor } from '../../domain/index';

import type { AccountCandidate, AccountDiscovery, AppDeps, CredentialImporter } from '../ports';
import {
  createFakeCapabilityCatalog,
  createFakeClock,
  createFakeDeps,
  createFakeEventLog,
  createFakeSecretVault,
  type FakeClock,
  type FakeEventLog,
} from '../ports/fakes';

import { adoptAccountCandidate, createAccountCandidateList, type AccountCandidateList } from './account-adoption';

const USER: Actor = { kind: 'user', id: 'user-1', label: 'Operator' };
const SENTINEL = 'sk-sentinel-token-9f8e7d6c';

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

interface Harness {
  readonly deps: AppDeps & { readonly candidates: AccountCandidateList; readonly importer: CredentialImporter };
  readonly clock: FakeClock;
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
  const clock = createFakeClock(1_000);
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
    clock,
    log,
    secrets: createFakeSecretVault(),
    capabilities: createFakeCapabilityCatalog([
      { id: 'sub-route', provider: 'prov-a', authMode: 'subscription' },
      { id: 'endpoint-route', provider: 'prov-a', authMode: 'api_key', endpointHost: 'api.example.test' },
      { id: 'machine-route', provider: 'prov-b', authMode: 'subscription' },
    ]),
  });
  // One remembered scan per harness, as the api owns one per instance: every adoption reads it.
  const list = createAccountCandidateList(clock, discovery);
  return { deps: { ...base, candidates: list, importer }, clock, log, scans, reads };
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

  it('A-84: adopts a machine-login candidate: subscription record with no identityDir, endpoint or secret; importToken ignored', async () => {
    const h = makeHarness([MACHINE]);
    const result = await adoptAccountCandidate(h.deps, {
      sourcePath: MACHINE.sourcePath,
      label: 'Machine',
      importToken: true,
      actor: USER,
    });
    if (!result.ok) throw new Error('adoption must succeed');
    const record = await h.deps.accounts.get(result.value);
    expect(record).toMatchObject({
      provider: 'prov-b',
      label: 'Machine',
      authMode: 'subscription',
      routeKind: 'machine-route',
      limitPolicy: 'wait_resume',
      caps: [],
    });
    expect(record?.identityDir).toBeUndefined();
    expect(record?.endpoint).toBeUndefined();
    expect(record?.secretRef).toBeUndefined();
    expect(h.reads).toEqual([]);
  });

  it('A-84: an already-added machine-login candidate is refused', async () => {
    const h = makeHarness([{ ...MACHINE, alreadyAdded: true }]);
    const result = await adoptAccountCandidate(h.deps, { sourcePath: MACHINE.sourcePath, label: 'M', actor: USER });
    expect(result).toEqual({ ok: false, error: 'already_added' });
  });

  it('P-33: adopts a compatible-endpoint candidate without a secret: https endpoint, a secretRef, empty vault', async () => {
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

  it('stores the candidate endpointUrl verbatim, so a configured path survives adoption', async () => {
    const h = makeHarness([{ ...ENDPOINT, endpointUrl: 'https://api.example.test/api/anthropic' }]);
    const result = await adoptAccountCandidate(h.deps, { sourcePath: ENDPOINT.sourcePath, label: 'GLM', actor: USER });
    if (!result.ok) throw new Error('adoption must succeed');
    const record = await h.deps.accounts.get(result.value);
    expect(record?.endpoint).toBe('https://api.example.test/api/anthropic');
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

  it('A-85: adopting three candidates after one scan runs no further scan', async () => {
    const h = makeHarness([SUBSCRIPTION, ENDPOINT, MACHINE]);
    await h.deps.candidates.get();
    const first = await adoptAccountCandidate(h.deps, { sourcePath: SUBSCRIPTION.sourcePath, label: 'A', actor: USER });
    const second = await adoptAccountCandidate(h.deps, { sourcePath: ENDPOINT.sourcePath, label: 'B', actor: USER });
    const third = await adoptAccountCandidate(h.deps, { sourcePath: MACHINE.sourcePath, label: 'C', actor: USER });
    expect([first.ok, second.ok, third.ok]).toEqual([true, true, true]);
    expect(h.scans.count).toBe(1);
  });

  it('A-85: a scan older than 60 s is not reused — the adoption scans anew and remembers that scan', async () => {
    const h = makeHarness();
    await h.deps.candidates.get();
    h.clock.advance(60_000);
    const adopted = await adoptAccountCandidate(h.deps, { sourcePath: SUBSCRIPTION.sourcePath, label: 'A', actor: USER });
    expect(adopted.ok).toBe(true);
    expect(h.scans.count).toBe(2);
    // The new scan is remembered: the next adoption inside the window adds none.
    const again = await adoptAccountCandidate(h.deps, { sourcePath: ENDPOINT.sourcePath, label: 'B', actor: USER });
    expect(again.ok).toBe(true);
    expect(h.scans.count).toBe(2);
  });

  it('A-85: a candidate absent from the remembered scan fails not_found without a hidden second scan', async () => {
    const h = makeHarness([SUBSCRIPTION]);
    await h.deps.candidates.get();
    const result = await adoptAccountCandidate(h.deps, { sourcePath: ENDPOINT.sourcePath, label: 'X', actor: USER });
    expect(result).toEqual({ ok: false, error: 'not_found' });
    expect(h.scans.count).toBe(1);
  });

  it('A-85: re-adopting a source the remembered scan predates fails already_added — the store decides', async () => {
    const h = makeHarness();
    await h.deps.candidates.get();
    const first = await adoptAccountCandidate(h.deps, { sourcePath: SUBSCRIPTION.sourcePath, label: 'A', actor: USER });
    expect(first.ok).toBe(true);
    // The remembered scan still lists the path as not added; the accounts store is the truth.
    const second = await adoptAccountCandidate(h.deps, { sourcePath: SUBSCRIPTION.sourcePath, label: 'A2', actor: USER });
    expect(second).toEqual({ ok: false, error: 'already_added' });
    expect(await h.deps.accounts.list()).toHaveLength(1);
    expect(h.scans.count).toBe(1);
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
  it('answers every reader from one scan and scans again only once the scan is 60 s old', async () => {
    const h = makeHarness();
    const list = h.deps.candidates;
    expect(await list.get()).toEqual([SUBSCRIPTION, ENDPOINT]);
    await list.get();
    expect(h.scans.count).toBe(1);
    h.clock.advance(59_999);
    await list.get();
    expect(h.scans.count).toBe(1);
    h.clock.advance(1);
    await list.get();
    expect(h.scans.count).toBe(2);
  });

  it('shares one in-flight scan between concurrent readers', async () => {
    const h = makeHarness();
    const [first, second] = await Promise.all([h.deps.candidates.get(), h.deps.candidates.get()]);
    expect(first).toEqual([SUBSCRIPTION, ENDPOINT]);
    expect(second).toEqual([SUBSCRIPTION, ENDPOINT]);
    expect(h.scans.count).toBe(1);
  });

  it('a failed scan does not stick: the next read scans again', async () => {
    let fail = true;
    const scans = { count: 0 };
    const discovery: AccountDiscovery = {
      scan: async () => {
        scans.count += 1;
        if (fail) throw new Error('scan broke');
        return [SUBSCRIPTION];
      },
    };
    const list = createAccountCandidateList(createFakeClock(1_000), discovery);
    await expect(list.get()).rejects.toThrow('scan broke');
    fail = false;
    await expect(list.get()).resolves.toEqual([SUBSCRIPTION]);
    expect(scans.count).toBe(2);
  });

  it('A-85: fresh: true always scans anew and replaces the remembered scan', async () => {
    const h = makeHarness();
    const list = h.deps.candidates;
    await list.get();
    await list.get({ fresh: true });
    expect(h.scans.count).toBe(2);
    // The fresh result is the remembered one: a plain read and an adoption add no scan.
    await list.get();
    const adopted = await adoptAccountCandidate(h.deps, { sourcePath: ENDPOINT.sourcePath, label: 'B', actor: USER });
    expect(adopted.ok).toBe(true);
    expect(h.scans.count).toBe(2);
  });
});
