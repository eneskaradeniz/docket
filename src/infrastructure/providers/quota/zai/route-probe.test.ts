// z.ai route probe tests — the QuotaProbe face every quotaProbe 'http_monitor' route kind hangs
// off (P-34, docs/v2/provider-capabilities.md §8): it picks the accounts riding the polled kind,
// takes each account's token from the vault, and merges every account's readings. Each account
// gets its own cache, because accounts on one endpoint own separate quotas.
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import type { AccountRecord } from '../../../../application/index';
import { err, parseUlid } from '../../../../domain/index';

import { createFakeMonitorPool, FAKE_MONITOR_TOKEN, type FakeMonitorPool } from './fixtures/fake-monitor-server-harness';
import { createZaiRouteProbe } from './route-probe';

const ulidOf = <B extends string>(input: string) => {
  const parsed = parseUlid<B>(input);
  if (!parsed.ok) throw new Error(`bad ulid fixture: ${input}`);
  return parsed.value;
};

const happyBody = (): string =>
  JSON.stringify({
    data: {
      limits: [
        { type: 'TOKENS_LIMIT', unit: 3, number: 5, percentage: 40, nextResetTime: 1_759_100_000_000 },
        { type: 'TIME_LIMIT', unit: 5, percentage: 10, nextResetTime: 1_762_000_000_000 },
      ],
    },
  });

let pool: FakeMonitorPool;

beforeAll(() => {
  pool = createFakeMonitorPool();
});

afterAll(() => {
  pool.dispose();
});

const zaiAccount = (endpoint: string, id: string = '01ARZ3NDEKTSV4RRFFQ69G5FA2'): AccountRecord => ({
  id: ulidOf<'account'>(id),
  provider: 'claude-code',
  label: 'GLM Coding',
  authMode: 'api_key',
  limitPolicy: 'wait_resume',
  routeKind: 'zai-glm',
  endpoint,
  secretRef: `token-${id}`,
  caps: [],
});

const subscriptionAccount = (): AccountRecord => ({
  id: ulidOf<'account'>('01ARZ3NDEKTSV4RRFFQ69G5FA3'),
  provider: 'claude-code',
  label: 'Pro',
  authMode: 'subscription',
  limitPolicy: 'wait_resume',
  caps: [],
});

const fakeVault = {
  get: async (ref: string): Promise<string | undefined> =>
    ref.startsWith('token-') ? FAKE_MONITOR_TOKEN : undefined,
};

describe('createZaiRouteProbe', () => {
  it('P-34: polls every account riding the http_monitor kind and merges their readings', async () => {
    const server = await pool.start({ status: 200, body: happyBody() });
    const probe = createZaiRouteProbe({
      accounts: { list: async () => [zaiAccount(server.endpoint), subscriptionAccount()] },
      secrets: fakeVault,
      fetch: fetch,
      now: () => 1_790_000_000_000,
    });

    const result = await probe.poll('zai-glm', null, { accountId: null, identityDir: null });

    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error('unreachable');
    expect(result.value).toHaveLength(2);
    expect(result.value[0]?.pool.appliesTo).toEqual([{ prefix: 'glm-' }]);
    // Only the endpoint account was asked; the subscription account owns no monitor endpoint.
    expect(server.requests()).toEqual([
      { method: 'GET', url: '/api/monitor/usage/quota/limit', auth: 'raw-match' },
    ]);
  });

  it('P-34: a defId whose route kind is not http_monitor is refused without any request', async () => {
    const server = await pool.start({ status: 200, body: happyBody() });
    const probe = createZaiRouteProbe({
      accounts: { list: async () => [zaiAccount(server.endpoint)] },
      secrets: fakeVault,
      fetch: fetch,
      now: () => 1_790_000_000_000,
    });

    const result = await probe.poll('anthropic-subscription', null, { accountId: null, identityDir: null });

    expect(result).toEqual(err('unknown_provider'));
    expect(server.requests()).toEqual([]);
  });

  it('P-34: no account riding the kind leaves the probe nothing to read', async () => {
    const server = await pool.start({ status: 200, body: happyBody() });
    const probe = createZaiRouteProbe({
      accounts: { list: async () => [subscriptionAccount()] },
      secrets: fakeVault,
      fetch: fetch,
      now: () => 1_790_000_000_000,
    });

    const result = await probe.poll('zai-glm', null, { accountId: null, identityDir: null });

    expect(result).toEqual(err('probe_failed'));
    expect(server.requests()).toEqual([]);
  });

  it('P-34: accounts of one kind keep independent caches', async () => {
    const server = await pool.start({ status: 200, body: happyBody() });
    const probe = createZaiRouteProbe({
      accounts: {
        list: async () => [
          zaiAccount(server.endpoint, '01ARZ3NDEKTSV4RRFFQ69G5FA4'),
          zaiAccount(server.endpoint, '01ARZ3NDEKTSV4RRFFQ69G5FA5'),
        ],
      },
      secrets: fakeVault,
      fetch: fetch,
      now: () => 1_790_000_000_000,
    });

    await probe.poll('zai-glm', null, { accountId: null, identityDir: null });
    await probe.poll('zai-glm', null, { accountId: null, identityDir: null });

    // Two accounts, one request each; the second poll of each hits its cache.
    expect(server.requests()).toHaveLength(2);
  });

  it('P-34: one failing account does not hide the readings of the others', async () => {
    const dead = await pool.start({ status: 200, body: happyBody() });
    dead.kill();
    const alive = await pool.start({ status: 200, body: happyBody() });
    const probe = createZaiRouteProbe({
      accounts: {
        list: async () => [
          zaiAccount(dead.endpoint, '01ARZ3NDEKTSV4RRFFQ69G5FA6'),
          zaiAccount(alive.endpoint, '01ARZ3NDEKTSV4RRFFQ69G5FA7'),
        ],
      },
      secrets: fakeVault,
      fetch: fetch,
      now: () => 1_790_000_000_000,
    });

    const result = await probe.poll('zai-glm', null, { accountId: null, identityDir: null });

    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error('unreachable');
    expect(result.value).toHaveLength(2);
    expect(alive.requests()).toHaveLength(1);
  });
});
