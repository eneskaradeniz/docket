// api: quota.refresh, accounts.candidateQuota and the accounts.changed event — the wire side of
// quota wiring. Rules A-80 (refresh after adopt and a route-changing save), A-81, A-82 and P-50;
// the schedule and the preview have their own tests beside their code.
import { describe, expect, it } from 'vitest';

import type { Actor } from '../domain/index';
import { ok } from '../domain/index';

import type { AccountCandidate, AccountDiscovery, CredentialImporter, MeterReading, QuotaProbe, QuotaProbeContext, QuotaProbeResolver } from '../application';
import { createFakeCapabilityCatalog, createFakeClock, createFakeDeps, createFakeEventLog } from '../application/ports/fakes';

import { createApi, type UiEvent } from './api';

const ACTOR: Actor = { kind: 'user', id: 'user-1', label: 'Operator' };

const DIRECTORY: AccountCandidate = {
  sourcePath: '/home/u/.claude-a',
  displayPath: '~/.claude-a',
  kind: 'subscription',
  routeKind: 'acme-subscription',
  hasOauthLogin: true,
  envOverrides: [],
  warnings: [],
  alreadyAdded: false,
};

const ENDPOINT: AccountCandidate = {
  sourcePath: '/home/u/.claude-glm',
  displayPath: '~/.claude-glm',
  kind: 'compatible_endpoint',
  routeKind: 'acme-endpoint',
  endpointHost: 'api.example.test',
  hasOauthLogin: false,
  envOverrides: ['endpoint', 'token'],
  warnings: [],
  alreadyAdded: false,
};

const READING: MeterReading = {
  pool: { label: 'Plan', kind: 'allowance', appliesTo: 'all' },
  meter: { label: '5h', cadence: 'rolling_from_first_use', unit: 'fraction', remaining: 0.4, resetPrecision: 'exact', observedAt: 1_000, source: 'polled' },
};

const setup = () => {
  const contexts: QuotaProbeContext[] = [];
  const probe: QuotaProbe = {
    poll: async (_defId, _binPath, context) => {
      contexts.push(context);
      return ok([READING]);
    },
  };
  const probes: QuotaProbeResolver = { forProvider: (defId, routeKind) => (routeKind === undefined && defId === 'acme' ? probe : undefined) };
  const discovery: AccountDiscovery = { scan: async () => [DIRECTORY, ENDPOINT] };
  const importer: CredentialImporter = { readEndpointToken: async () => 'unused' };
  const clock = createFakeClock(1_000);
  const log = createFakeEventLog();
  const deps = createFakeDeps({
    clock,
    log,
    capabilities: createFakeCapabilityCatalog([
      { id: 'acme-subscription', provider: 'acme', authMode: 'subscription', quotaProbe: 'sdk_usage' },
      { id: 'acme-endpoint', provider: 'acme', authMode: 'api_key', endpointHost: 'api.example.test', quotaProbe: 'sdk_usage' },
    ]),
  });
  const timers = { setInterval: (): unknown => undefined, clearInterval: (): void => {} };
  const api = createApi(deps, undefined, undefined, undefined, undefined, undefined, { discovery, importer }, { probes, timers });
  const events: UiEvent[] = [];
  api.subscribe((event) => events.push(event));
  return { api, deps, contexts, events, clock, log };
};

const settle = async (): Promise<void> => {
  for (let turn = 0; turn < 30; turn += 1) await Promise.resolve();
};

describe('quota.refresh', () => {
  it('A-81: refreshes one account, answers ok after the poll ends, emits accounts.changed and audits nothing', async () => {
    const h = setup();
    const saved = await h.api.command(ACTOR, { type: 'account.save', provider: 'acme', label: 'Main', authMode: 'subscription' });
    if (!saved.ok || saved.id === undefined) throw new Error('save must answer an id');
    await settle();
    const baseline = { polls: h.contexts.length, events: h.events.length, audit: h.log.entries().length };

    const result = await h.api.command(ACTOR, { type: 'quota.refresh', id: saved.id });

    expect(result).toEqual({ ok: true });
    expect(h.contexts.length).toBe(baseline.polls + 1);
    expect(h.events.length).toBe(baseline.events + 1);
    expect(h.events.at(-1)).toEqual({ type: 'accounts.changed' });
    expect(h.log.entries().length).toBe(baseline.audit);
  });

  it('A-81: without an id every account is refreshed; an unknown id is not_found; a malformed id is invalid_id', async () => {
    const h = setup();
    await h.api.command(ACTOR, { type: 'account.save', provider: 'acme', label: 'A', authMode: 'subscription' });
    await h.api.command(ACTOR, { type: 'account.save', provider: 'acme', label: 'B', authMode: 'subscription' });
    await settle();
    const before = h.contexts.length;

    expect(await h.api.command(ACTOR, { type: 'quota.refresh' })).toEqual({ ok: true });
    expect(h.contexts.length).toBe(before + 2);

    expect(await h.api.command(ACTOR, { type: 'quota.refresh', id: '01ARZ3NDEKTSV4RRFFQ69G5FZZ' })).toEqual({ ok: false, code: 'not_found' });
    expect(await h.api.command(ACTOR, { type: 'quota.refresh', id: 'nope' })).toEqual({ ok: false, code: 'invalid_id' });
  });

  it('A-81: without quota wiring the command answers not_found', async () => {
    const api = createApi(createFakeDeps());
    expect(await api.command(ACTOR, { type: 'quota.refresh' })).toEqual({ ok: false, code: 'not_found' });
  });
});

describe('quota refresh after a change', () => {
  it('A-80: account.adopt refreshes the adopted account without awaiting it', async () => {
    const h = setup();

    const adopted = await h.api.command(ACTOR, { type: 'account.adopt', sourcePath: DIRECTORY.sourcePath, label: 'A' });
    if (!adopted.ok || adopted.id === undefined) throw new Error('adopt must answer an id');
    await settle();

    expect(h.contexts).toEqual([{ accountId: adopted.id, identityDir: DIRECTORY.sourcePath }]);
    expect(h.events).toContainEqual({ type: 'accounts.changed' });
  });

  it('A-80: account.save refreshes a new account and one whose provider or auth mode changed, and only those', async () => {
    const h = setup();
    const saved = await h.api.command(ACTOR, { type: 'account.save', provider: 'acme', label: 'Main', authMode: 'subscription' });
    if (!saved.ok || saved.id === undefined) throw new Error('save must answer an id');
    await settle();
    expect(h.contexts).toHaveLength(1);

    // A label edit changes no route: no poll.
    await h.api.command(ACTOR, { type: 'account.save', id: saved.id, provider: 'acme', label: 'Renamed', authMode: 'subscription' });
    await settle();
    expect(h.contexts).toHaveLength(1);

    // A different auth mode is a different route.
    await h.api.command(ACTOR, { type: 'account.save', id: saved.id, provider: 'acme', label: 'Renamed', authMode: 'api_key' });
    await settle();
    expect(h.contexts).toHaveLength(2);
  });

  it('A-80: the lifecycle handed to the root starts and stops the schedule', async () => {
    const h = setup();
    await h.deps.accounts.save({ id: ulid(), provider: 'acme', label: 'Main', authMode: 'subscription', limitPolicy: 'wait_resume', caps: [] });

    h.api.quota.start();
    await settle();
    h.api.quota.stop();

    expect(h.contexts).toHaveLength(1);
  });
});

const ulid = () => {
  const id = createFakeDeps().ids.next<'account'>();
  return id;
};

describe('accounts.candidateQuota', () => {
  it('A-82: answers pools and meters for a directory candidate, polling with accountId null and the sourcePath', async () => {
    const h = setup();

    const view = await h.api.query({ type: 'accounts.candidateQuota', sourcePath: DIRECTORY.sourcePath });

    expect(h.contexts).toEqual([{ accountId: null, identityDir: DIRECTORY.sourcePath }]);
    expect(view).toMatchObject({ ok: true, pools: [{ label: 'Plan', kind: 'allowance', appliesTo: 'all' }], meters: [{ label: '5h', remaining: 0.4 }] });
  });

  it('A-82: writes nothing — no account, pool, meter or audit row appears', async () => {
    const h = setup();

    await h.api.query({ type: 'accounts.candidateQuota', sourcePath: DIRECTORY.sourcePath });

    expect(await h.deps.accounts.list()).toEqual([]);
    expect(await h.deps.accounts.pools()).toEqual([]);
    expect(await h.deps.accounts.meters()).toEqual([]);
    expect(h.log.entries()).toEqual([]);
    expect(h.events).toEqual([]);
  });

  it('A-82: a compatible-endpoint candidate answers needs_account, an unknown path not_found', async () => {
    const h = setup();

    expect(await h.api.query({ type: 'accounts.candidateQuota', sourcePath: ENDPOINT.sourcePath })).toEqual({ ok: false, code: 'needs_account' });
    expect(await h.api.query({ type: 'accounts.candidateQuota', sourcePath: '/nowhere' })).toEqual({ ok: false, code: 'not_found' });
    expect(h.contexts).toEqual([]);
  });

  it('A-82: the answer is cached per sourcePath for 60 s', async () => {
    const h = setup();
    await h.api.query({ type: 'accounts.candidateQuota', sourcePath: DIRECTORY.sourcePath });
    await h.api.query({ type: 'accounts.candidateQuota', sourcePath: DIRECTORY.sourcePath });
    expect(h.contexts).toHaveLength(1);

    h.clock.advance(60_000);
    await h.api.query({ type: 'accounts.candidateQuota', sourcePath: DIRECTORY.sourcePath });
    expect(h.contexts).toHaveLength(2);
  });

  it('P-50: without quota wiring the query answers not_found', async () => {
    const api = createApi(createFakeDeps());
    expect(await api.query({ type: 'accounts.candidateQuota', sourcePath: '/x' })).toEqual({ ok: false, code: 'not_found' });
  });
});
