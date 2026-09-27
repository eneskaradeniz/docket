// pollQuota — one quota poll for an account, reconciled into the stored pools and meters.
// Contract: docs/v2/application.md § 6; rule P-18 in docs/v2/providers.md → "Quota probes".
import type { AccountId, Meter, Pool, Result } from '../../domain/index';
import { err, ok } from '../../domain/index';

import type { AppDeps, MeterReading, QuotaProbeError, QuotaProbeResolver } from '../ports';

/** Pool identity is the server-supplied label: a stored pool with the same label keeps its id. */
const poolOf = (reading: MeterReading, accountId: AccountId, stored: readonly Pool[], newId: Pool['id']): Pool => ({
  id: stored.find((candidate) => candidate.label === reading.pool.label)?.id ?? newId,
  accountId,
  label: reading.pool.label,
  kind: reading.pool.kind,
  appliesTo: reading.pool.appliesTo,
});

/**
 * Meter identity: the pool it belongs to (found by label above) plus the meter's own label and
 * duration. The duration alone cannot carry identity — the windows of one pool regularly state no
 * duration at all, and matching on "same pool, no duration" would collapse weekly and five-hour
 * counters into one id.
 */
const isSameCounter = (meter: Meter, poolId: Pool['id'], reading: MeterReading): boolean =>
  meter.poolId === poolId && meter.label === reading.meter.label && meter.durationMs === reading.meter.durationMs;

export async function pollQuota(
  deps: Pick<AppDeps, 'clock' | 'ids' | 'log' | 'accounts'>,
  probes: QuotaProbeResolver,
  input: { readonly accountId: AccountId },
): Promise<Result<readonly Meter[], QuotaProbeError>> {
  // The clock and the log stay unused for now: observation time belongs to the probe (it is
  // closest to the CLI's answer), and polling is a background read with no acting user, so no
  // audit action fits it yet. Both stay in the signature the contract fixes.
  try {
    const account = await deps.accounts.get(input.accountId);
    // No account means no provider to resolve; the union has no separate not-found code, and the
    // answer the resolver would give for an unregistered provider is the honest one.
    if (account === undefined) return err('unknown_provider');
    const probe = probes.forProvider(account.provider);
    if (probe === undefined) return err('unknown_provider');

    // The use case has no discovery access; a null path tells the probe to resolve the binary
    // itself (bare name on PATH), and a probe that cannot find it reports not_installed.
    const polled = await probe.poll(account.provider, null);
    if (!polled.ok) return polled;

    const storedPools = await deps.accounts.pools(input.accountId);
    const storedMeters = await deps.accounts.meters(input.accountId);

    // Pools are reconciled first so every meter can point at a pool id that exists after
    // savePools; the save replaces the account's pools, so groups gone from the answer disappear.
    const poolsByLabel = new Map<string, Pool>();
    const assignments: { readonly reading: MeterReading; readonly pool: Pool }[] = [];
    for (const reading of polled.value) {
      const pool = poolsByLabel.get(reading.pool.label) ?? poolOf(reading, input.accountId, storedPools, deps.ids.next<'pool'>());
      poolsByLabel.set(pool.label, pool);
      assignments.push({ reading, pool });
    }
    await deps.accounts.savePools(input.accountId, [...poolsByLabel.values()]);

    const saved: Meter[] = [];
    for (const { reading, pool } of assignments) {
      const meter: Meter = {
        ...reading.meter,
        id: storedMeters.find((candidate) => isSameCounter(candidate, pool.id, reading))?.id ?? deps.ids.next<'meter'>(),
        poolId: pool.id,
      };
      await deps.accounts.saveMeter(meter);
      saved.push(meter);
    }
    return ok(saved);
  } catch {
    // A port that throws is broken, not fatal to the caller: the poll reports failure and the
    // next one tries again — the use case itself never throws.
    return err('probe_failed');
  }
}
