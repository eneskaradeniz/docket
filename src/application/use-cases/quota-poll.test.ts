// pollQuota tests — rule P-18 (docs/v2/providers.md → "Quota probes"), signature in
// docs/v2/application.md § 6. The probe resolver is scripted in-memory; nothing spawns a process.
import { describe, expect, it } from 'vitest';

import { err, isUlid, ok, parseUlid, type Result, type Ulid } from '../../domain/index';

import type { AccountRecord, QuotaProbe, QuotaProbeError, QuotaProbeResolver } from '../ports';
import { MeterReading } from '../ports';
import { createFakeCapabilityCatalog, createFakeDeps } from '../ports/fakes';

import { pollQuota } from './quota-poll';

// --- fixtures ---------------------------------------------------------------------------------------

const ulidOf = <B extends string>(input: string): Ulid<B> => {
  const parsed = parseUlid<B>(input);
  if (!parsed.ok) throw new Error(`fixture ulid must parse: ${input}`);
  return parsed.value;
};

const T0 = 1_790_000_000_000;

const ACCOUNT = ulidOf<'account'>('01ARZ3NDEKTSV4RRFFQ69G5FA2');
const STORED_POOL_ID = ulidOf<'pool'>('01ARZ3NDEKTSV4RRFFQ69G5FA4');
const STORED_WEEKLY_ID = ulidOf<'meter'>('01ARZ3NDEKTSV4RRFFQ69G5FA5');
const STORED_FIVE_HOUR_ID = ulidOf<'meter'>('01ARZ3NDEKTSV4RRFFQ69G5FA6');

const accountRecord = (overrides: Partial<AccountRecord> = {}): AccountRecord => ({
  id: ACCOUNT,
  provider: 'agy',
  label: 'Main',
  authMode: 'subscription',
  limitPolicy: 'wait_resume',
  caps: [],
  ...overrides,
});

const reading = (
  poolLabel: string,
  meterLabel: string,
  overrides: { readonly meter?: Partial<MeterReading['meter']>; readonly pool?: Partial<MeterReading['pool']> } = {},
): MeterReading => ({
  pool: { label: poolLabel, kind: 'allowance', appliesTo: [{ exact: 'Model X' }], ...overrides.pool },
  meter: {
    label: meterLabel,
    cadence: 'rolling_from_first_use',
    unit: 'fraction',
    remaining: 0.5,
    resetsAt: T0 + 3_600_000,
    resetPrecision: 'exact',
    observedAt: T0,
    source: 'polled',
    ...overrides.meter,
  },
});

interface ProbeCall {
  readonly defId: string;
  readonly binPath: string | null;
}

/** A probe that replays one answer (or throws it) and records what it was asked. */
const scriptedProbe = (
  answer: Result<readonly MeterReading[], QuotaProbeError> | { readonly reject: string },
): QuotaProbe & { readonly calls: readonly ProbeCall[] } => {
  const calls: ProbeCall[] = [];
  return {
    calls,
    poll: async (defId, binPath) => {
      calls.push({ defId, binPath });
      if ('reject' in answer) throw new Error(answer.reject);
      return answer;
    },
  };
};

/**
 * The resolver as the use case asks it: the route-kind question (provider id + kind) answers only
 * a dedicated kind probe, the provider question (provider id alone) the provider's probe — so the
 * test can see which id won exactly as the use case must.
 */
const resolverFor = (
  provider: string,
  probe: QuotaProbe,
  kindProbes: Readonly<Record<string, QuotaProbe>> = {},
): QuotaProbeResolver => ({
  forProvider: (defId, routeKind) => (routeKind !== undefined ? kindProbes[routeKind] : defId === provider ? probe : undefined),
});

// A catalog of neutral route kinds: one the provider's subscription accounts default to, one with
// a dedicated probe (a compatible endpoint's monitor), one without — vendor names live in
// infrastructure, never here.
const ROUTE_KIND_CATALOG = createFakeCapabilityCatalog([
  { id: 'acme-subscription', provider: 'acme', authMode: 'subscription' },
  { id: 'acme-monitor', authMode: 'api_key' },
  { id: 'acme-plain', authMode: 'api_key' },
]);

// --- the use case -----------------------------------------------------------------------------------

describe('pollQuota', () => {
  it('P-18: polls the account provider, persists reconciled pools and meters, returns the saved meters', async () => {
    const deps = createFakeDeps();
    await deps.accounts.save(accountRecord());
    const probe = scriptedProbe(ok([reading('Gemini Models', 'Weekly Limit Remaining'), reading('Claude and GPT models', 'Weekly Limit Remaining')]));

    const result = await pollQuota(deps, resolverFor('agy', probe), { accountId: ACCOUNT });

    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error('unreachable');
    expect(probe.calls).toEqual([{ defId: 'agy', binPath: null }]);

    const pools = await deps.accounts.pools(ACCOUNT);
    expect(pools.map((pool) => pool.label)).toEqual(['Gemini Models', 'Claude and GPT models']);
    for (const pool of pools) {
      expect(isUlid(pool.id)).toBe(true);
      expect(pool.accountId).toBe(ACCOUNT);
      expect(pool.kind).toBe('allowance');
    }

    // The returned meters are exactly what was stored, ids and pool ids included.
    expect(result.value).toEqual(await deps.accounts.meters(ACCOUNT));
    expect(result.value).toHaveLength(2);
    for (const meter of result.value) {
      expect(isUlid(meter.id)).toBe(true);
      expect(pools.map((pool) => pool.id)).toContain(meter.poolId);
      expect(meter.remaining).toBe(0.5);
      expect(meter.source).toBe('polled');
    }
  });

  it('P-18: a stored pool with the same label and a stored meter with the same label and duration reuse their ids', async () => {
    const deps = createFakeDeps();
    await deps.accounts.save(accountRecord());
    await deps.accounts.savePools(ACCOUNT, [
      { id: STORED_POOL_ID, accountId: ACCOUNT, label: 'Gemini Models', kind: 'allowance', appliesTo: 'all' },
    ]);
    await deps.accounts.saveMeter({
      id: STORED_WEEKLY_ID,
      poolId: STORED_POOL_ID,
      label: 'Weekly Limit Remaining',
      cadence: 'rolling_from_first_use',
      unit: 'fraction',
      remaining: 0.9,
      resetsAt: T0 - 1,
      resetPrecision: 'exact',
      observedAt: T0 - 60_000,
      source: 'polled',
    });
    const probe = scriptedProbe(ok([reading('Gemini Models', 'Weekly Limit Remaining', { meter: { remaining: 0.2 } })]));

    const result = await pollQuota(deps, resolverFor('agy', probe), { accountId: ACCOUNT });

    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error('unreachable');
    expect(result.value[0]?.id).toBe(STORED_WEEKLY_ID);
    expect(result.value[0]?.poolId).toBe(STORED_POOL_ID);
    expect(result.value[0]?.remaining).toBe(0.2);
    const pools = await deps.accounts.pools(ACCOUNT);
    expect(pools).toHaveLength(1);
    expect(pools[0]?.id).toBe(STORED_POOL_ID);
  });

  it('P-18: windows of one pool that state no duration keep distinct meter ids across polls', async () => {
    const deps = createFakeDeps();
    await deps.accounts.save(accountRecord());
    const weekly = reading('Gemini Models', 'Weekly Limit Remaining', { meter: { remaining: 0.6869 } });
    const fiveHour = reading('Gemini Models', 'Five Hour Limit Remaining', { meter: { remaining: 1 } });
    const resolver = resolverFor('agy', scriptedProbe(ok([weekly, fiveHour])));

    const first = await pollQuota(deps, resolver, { accountId: ACCOUNT });
    expect(first.ok).toBe(true);
    if (!first.ok) throw new Error('unreachable');
    const [firstWeekly, firstFiveHour] = first.value;
    expect(firstWeekly?.id).not.toBe(firstFiveHour?.id); // both undefined-duration windows, still two counters

    const second = await pollQuota(
      deps,
      resolverFor(
        'agy',
        scriptedProbe(ok([reading('Gemini Models', 'Weekly Limit Remaining', { meter: { remaining: 0.5 } }), fiveHour])),
      ),
      { accountId: ACCOUNT },
    );
    expect(second.ok).toBe(true);
    if (!second.ok) throw new Error('unreachable');
    expect(second.value[0]?.id).toBe(firstWeekly?.id);
    expect(second.value[0]?.remaining).toBe(0.5);
    expect(second.value[1]?.id).toBe(firstFiveHour?.id);
    expect(await deps.accounts.meters(ACCOUNT)).toHaveLength(2);
  });

  it('P-18: a meter whose stated duration changed is a new counter, and an unseen pool label gets a fresh pool id', async () => {
    const deps = createFakeDeps();
    await deps.accounts.save(accountRecord());
    await deps.accounts.savePools(ACCOUNT, [
      { id: STORED_POOL_ID, accountId: ACCOUNT, label: 'Deprecated group', kind: 'allowance', appliesTo: 'all' },
    ]);
    await deps.accounts.saveMeter({
      id: STORED_FIVE_HOUR_ID,
      poolId: STORED_POOL_ID,
      label: 'Five Hour Limit Remaining',
      cadence: 'rolling_from_first_use',
      durationMs: 18_000_000,
      unit: 'fraction',
      remaining: 0.9,
      resetPrecision: 'exact',
      observedAt: T0 - 60_000,
      source: 'polled',
    });
    const probe = scriptedProbe(
      ok([reading('Gemini Models', 'Five Hour Limit Remaining')]), // same label, no duration stated now
    );

    const result = await pollQuota(deps, resolverFor('agy', probe), { accountId: ACCOUNT });

    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error('unreachable');
    expect(result.value[0]?.id).not.toBe(STORED_FIVE_HOUR_ID);
    const pools = await deps.accounts.pools(ACCOUNT);
    expect(pools).toHaveLength(1); // savePools replaces: the deprecated pool is gone
    expect(pools[0]?.label).toBe('Gemini Models');
    expect(pools[0]?.id).not.toBe(STORED_POOL_ID);
  });

  it('P-18: an unknown account is a Result error, never a throw', async () => {
    const deps = createFakeDeps();
    const probe = scriptedProbe(ok([]));

    const result = await pollQuota(deps, resolverFor('agy', probe), { accountId: ACCOUNT });

    expect(result).toEqual(err('unknown_provider'));
    expect(probe.calls).toEqual([]); // nothing is polled without an account
  });

  it('P-18: a provider with no registered probe is a Result error', async () => {
    const deps = createFakeDeps();
    await deps.accounts.save(accountRecord({ provider: 'codex' }));
    const probe = scriptedProbe(ok([]));

    const result = await pollQuota(deps, resolverFor('agy', probe), { accountId: ACCOUNT });

    expect(result).toEqual(err('unknown_provider'));
    expect(probe.calls).toEqual([]);
  });

  it('P-18: an account naming a provider id with no definition (a stale record) answers unknown_provider, never a throw', async () => {
    const deps = createFakeDeps();
    await deps.accounts.save(accountRecord({ provider: 'gemini' })); // an id no def carries anymore
    const probe = scriptedProbe(ok([]));

    const result = await pollQuota(deps, resolverFor('agy', probe), { accountId: ACCOUNT });

    expect(result).toEqual(err('unknown_provider'));
    expect(probe.calls).toEqual([]);
  });

  it('P-18: a probe error passes through and persists nothing', async () => {
    const deps = createFakeDeps();
    await deps.accounts.save(accountRecord());
    const probe = scriptedProbe(err('not_installed'));

    const result = await pollQuota(deps, resolverFor('agy', probe), { accountId: ACCOUNT });

    expect(result).toEqual(err('not_installed'));
    expect(await deps.accounts.pools(ACCOUNT)).toEqual([]);
    expect(await deps.accounts.meters(ACCOUNT)).toEqual([]);
  });

  it('P-18: a rejecting probe surfaces as a Result error — the use case never throws', async () => {
    const deps = createFakeDeps();
    await deps.accounts.save(accountRecord());
    const probe = scriptedProbe({ reject: 'probe exploded' });

    const result = await pollQuota(deps, resolverFor('agy', probe), { accountId: ACCOUNT });

    expect(result).toEqual(err('probe_failed'));
  });

  it('P-34: a route kind with a dedicated probe is polled under its kind id, not the provider probe', async () => {
    const deps = createFakeDeps({ capabilities: ROUTE_KIND_CATALOG });
    await deps.accounts.save(accountRecord({ provider: 'acme', authMode: 'api_key', routeKind: 'acme-monitor' }));
    const sdk = scriptedProbe(ok([reading('Provider Pool', 'Weekly Limit Remaining')]));
    const monitor = scriptedProbe(ok([reading('Monitor Pool', 'Monitor Meter')]));
    const resolver = resolverFor('acme', sdk, { 'acme-monitor': monitor });

    const result = await pollQuota(deps, resolver, { accountId: ACCOUNT });

    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error('unreachable');
    expect(monitor.calls).toEqual([{ defId: 'acme-monitor', binPath: null }]);
    expect(sdk.calls).toEqual([]); // the provider's own probe is never asked
    expect((await deps.accounts.pools(ACCOUNT)).map((pool) => pool.label)).toEqual(['Monitor Pool']);
  });

  it('P-34: a subscription account is still polled through the provider probe under its provider id', async () => {
    const deps = createFakeDeps({ capabilities: ROUTE_KIND_CATALOG });
    await deps.accounts.save(accountRecord({ provider: 'acme' })); // subscription, no explicit kind
    const sdk = scriptedProbe(ok([reading('Provider Pool', 'Weekly Limit Remaining')]));
    const monitor = scriptedProbe(ok([reading('Monitor Pool', 'Monitor Meter')]));
    const resolver = resolverFor('acme', sdk, { 'acme-monitor': monitor });

    const result = await pollQuota(deps, resolver, { accountId: ACCOUNT });

    expect(result.ok).toBe(true);
    expect(sdk.calls).toEqual([{ defId: 'acme', binPath: null }]);
    expect(monitor.calls).toEqual([]); // the derived subscription kind has no dedicated probe
  });

  it('P-34: a route kind with no dedicated probe falls back to the provider probe under its provider id', async () => {
    const deps = createFakeDeps({ capabilities: ROUTE_KIND_CATALOG });
    await deps.accounts.save(accountRecord({ provider: 'acme', authMode: 'api_key', routeKind: 'acme-plain' }));
    const sdk = scriptedProbe(ok([reading('Provider Pool', 'Weekly Limit Remaining')]));
    const monitor = scriptedProbe(ok([reading('Monitor Pool', 'Monitor Meter')]));
    const resolver = resolverFor('acme', sdk, { 'acme-monitor': monitor });

    const result = await pollQuota(deps, resolver, { accountId: ACCOUNT });

    expect(result.ok).toBe(true);
    expect(sdk.calls).toEqual([{ defId: 'acme', binPath: null }]);
    expect(monitor.calls).toEqual([]);
  });

  it('P-34: an account whose route kind the catalog cannot resolve falls back to the provider probe', async () => {
    const deps = createFakeDeps({ capabilities: ROUTE_KIND_CATALOG }); // knows no default for 'other'
    await deps.accounts.save(accountRecord({ provider: 'other' })); // subscription, no explicit kind
    const sdk = scriptedProbe(ok([reading('Provider Pool', 'Weekly Limit Remaining')]));
    const monitor = scriptedProbe(ok([reading('Monitor Pool', 'Monitor Meter')]));
    const resolver = resolverFor('other', sdk, { 'acme-monitor': monitor });

    const result = await pollQuota(deps, resolver, { accountId: ACCOUNT });

    expect(result.ok).toBe(true);
    expect(sdk.calls).toEqual([{ defId: 'other', binPath: null }]);
    expect(monitor.calls).toEqual([]);
  });
});
