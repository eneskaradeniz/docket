// z.ai monitor source tests — rule P-34 (docs/v2/provider-capabilities.md §8) and the z.ai row
// of docs/v2/quota.md. The source is driven over the real fetch against the fake monitor endpoint
// (fixtures/fake-monitor-server.cjs), so the wire — URL, raw Authorization header, status
// handling — is what production sees. The endpoint is observed behaviour, not a published
// contract; these tests pin today's observed shape.
import { readFileSync } from 'node:fs';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { err, ok } from '../../../../domain/index';

import { createFakeMonitorPool, FAKE_MONITOR_TOKEN, type FakeMonitorPool } from './fixtures/fake-monitor-server-harness';
import { createZaiMonitorSource } from './monitor-source';

const T0 = 1_790_000_000_000;

const fiveHourLimit = (percentage: number) => ({
  type: 'TOKENS_LIMIT',
  unit: 3,
  number: 5,
  percentage,
  nextResetTime: 1_759_100_000_000,
});
const monthlyLimit = (percentage: number) => ({
  type: 'TIME_LIMIT',
  unit: 5,
  percentage,
  nextResetTime: 1_762_000_000_000,
});

const happyBody = (): string =>
  JSON.stringify({
    data: {
      limits: [
        fiveHourLimit(40),
        monthlyLimit(10),
        // Neither row is a window the probe knows: an unknown type, and the token window with a
        // foreign number. Both must be ignored and counted.
        { type: 'RATE_LIMIT', unit: 9, number: 1, percentage: 0, nextResetTime: 0 },
        { type: 'TOKENS_LIMIT', unit: 3, number: 7, percentage: 55, nextResetTime: 1_759_100_000_000 },
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

const makeSource = (endpoint: string, options: { readonly missingToken?: boolean } = {}) => {
  let clock = T0;
  const notes: string[] = [];
  const source = createZaiMonitorSource({
    fetch: fetch,
    now: () => clock,
    endpoint,
    secretRef: 'zai-account-token',
    secrets: {
      get: async (ref) => (options.missingToken === true ? undefined : ref === 'zai-account-token' ? FAKE_MONITOR_TOKEN : undefined),
    },
    note: (message) => notes.push(message),
  });
  return {
    source,
    notes,
    advance: (ms: number): void => {
      clock += ms;
    },
  };
};

describe('createZaiMonitorSource', () => {
  it('P-34: reads both windows from the monitor endpoint and maps them to percent meters with exact resets', async () => {
    const server = await pool.start({ status: 200, body: happyBody() });
    const { source } = makeSource(server.endpoint);

    const result = await source.read();

    expect(result).toEqual(
      ok([
        {
          pool: { label: 'GLM Coding', kind: 'allowance', appliesTo: [{ prefix: 'glm-' }] },
          meter: {
            label: '5-hour token window',
            cadence: 'rolling_from_first_use',
            durationMs: 18_000_000, // number 5 with unit 3 (hours), stated by the endpoint itself
            unit: 'percent',
            remaining: 60, // 100 − percentage 40
            resetsAt: 1_759_100_000_000,
            resetPrecision: 'exact',
            observedAt: T0,
            source: 'polled',
          },
        },
        {
          pool: { label: 'GLM Coding', kind: 'allowance', appliesTo: [{ prefix: 'glm-' }] },
          meter: {
            label: 'monthly tool window',
            cadence: 'calendar',
            unit: 'percent',
            remaining: 90, // 100 − percentage 10
            resetsAt: 1_762_000_000_000,
            resetPrecision: 'exact',
            observedAt: T0,
            source: 'polled',
          },
        },
      ]),
    );
    // The wire: one GET of the monitor path under the endpoint's origin, token raw — no scheme.
    expect(server.requests()).toEqual([
      { method: 'GET', url: '/api/monitor/usage/quota/limit', auth: 'raw-match' },
    ]);
  });

  it('P-34: limits other than the two known windows are ignored but counted in a diagnostic note', async () => {
    const server = await pool.start({ status: 200, body: happyBody() });
    const { source, notes } = makeSource(server.endpoint);

    const result = await source.read();

    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error('unreachable');
    expect(result.value).toHaveLength(2);
    expect(notes).toHaveLength(1);
    expect(notes[0]).toContain('2');
  });

  it('P-34: a 401 with no last good value reports not_logged_in', async () => {
    const server = await pool.start({ status: 401, body: JSON.stringify({ code: 'unauthorized' }) });
    const { source } = makeSource(server.endpoint);

    const result = await source.read();

    expect(result).toEqual(err('not_logged_in'));
  });

  it('P-34: a 500 with no last good value reports probe_failed', async () => {
    const server = await pool.start({ status: 500, body: '' });
    const { source } = makeSource(server.endpoint);

    const result = await source.read();

    expect(result).toEqual(err('probe_failed'));
  });

  it('P-34: a malformed body reports probe_failed', async () => {
    const server = await pool.start({ status: 200, body: 'not-json{' });
    const { source } = makeSource(server.endpoint);

    const result = await source.read();

    expect(result).toEqual(err('probe_failed'));
  });

  it('P-34: a missing vault token reports not_logged_in without any request', async () => {
    const server = await pool.start({ status: 200, body: happyBody() });
    const { source } = makeSource(server.endpoint, { missingToken: true });

    const result = await source.read();

    expect(result).toEqual(err('not_logged_in'));
    expect(server.requests()).toEqual([]);
  });

  it('P-34: within the 60 s cache window a second read returns the stored readings without a request', async () => {
    const server = await pool.start({ status: 200, body: happyBody() });
    const { source, advance } = makeSource(server.endpoint);
    const first = await source.read();
    if (!first.ok) throw new Error('unreachable');

    advance(30_000);
    server.setPayload({ status: 200, body: JSON.stringify({ data: { limits: [fiveHourLimit(70)] } }) });
    const second = await source.read();

    expect(second).toEqual(first);
    expect(server.requests()).toHaveLength(1);
  });

  it('P-34: after the cache window the next read fetches again', async () => {
    const server = await pool.start({ status: 200, body: happyBody() });
    const { source, advance } = makeSource(server.endpoint);
    await source.read();

    advance(61_000);
    server.setPayload({ status: 200, body: JSON.stringify({ data: { limits: [fiveHourLimit(25), monthlyLimit(5)] } }) });
    const refreshed = await source.read();

    expect(refreshed.ok).toBe(true);
    if (!refreshed.ok) throw new Error('unreachable');
    expect(refreshed.value[0]?.meter.remaining).toBe(75);
    expect(refreshed.value[0]?.meter.observedAt).toBe(T0 + 61_000);
    expect(server.requests()).toHaveLength(2);
  });

  it('P-34: a failed refresh returns the last good readings marked stale instead of an error', async () => {
    const server = await pool.start({ status: 200, body: happyBody() });
    const { source, advance } = makeSource(server.endpoint);
    await source.read();

    advance(61_000);
    server.setPayload({ status: 500, body: '' });
    const afterFailure = await source.read();

    expect(afterFailure.ok).toBe(true);
    if (!afterFailure.ok) throw new Error('unreachable');
    expect(afterFailure.value[0]?.meter.remaining).toBe(60);
    expect(afterFailure.value[0]?.meter.observedAt).toBe(T0);
    // staleAfterMs 0 marks the value stale the moment it is returned: quota reads unknown.
    expect(afterFailure.value[0]?.meter.staleAfterMs).toBe(0);
  });

  it('P-34: the token never appears in results, notes or the fixture log', async () => {
    const server = await pool.start({ status: 200, body: happyBody() });
    const { source, notes, advance } = makeSource(server.endpoint);
    const results = [await source.read()];
    advance(61_000);
    server.setPayload({ status: 401, body: '' });
    results.push(await source.read());

    const surfaces = [JSON.stringify(results), notes.join('\n'), readFileSync(server.logPath, 'utf8')];
    for (const surface of surfaces) expect(surface.includes(FAKE_MONITOR_TOKEN)).toBe(false);
  });
});
