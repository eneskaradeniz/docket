// Quota snapshot mapper tests (P-39). The fixtures mirror the recorded live shape of the
// provider SDK's account quota call: a snapshot map keyed `chat`, `completions` and
// `premium_interactions`, each carrying entitlement counts, a remaining percentage and an ISO
// reset date the recorded run reported in the past — the mapper must carry that date verbatim,
// never roll it forward. Nothing here reaches the provider: the payload is a fixture and the
// mapper is pure.
import { describe, expect, it } from 'vitest';

import { mapCopilotQuotaSnapshots } from './quota-mapper';

/** The recorded snapshot of the entitlement-limited key (premium_interactions, 200 requests,
 * nothing used) — field names and values as the live answer carried them. */
const LIMITED_SNAPSHOT = {
  isUnlimitedEntitlement: false,
  entitlementRequests: 200,
  usedRequests: 0,
  usageAllowedWithExhaustedQuota: false,
  overage: 0,
  overageAllowedWithExhaustedQuota: false,
  remainingPercentage: 100,
  resetDate: '2026-10-01T14:51:31.434-07:00',
  hasQuota: true,
  tokenBasedBilling: true,
  overageEntitlement: 0,
};

/** The recorded unlimited snapshot (chat, completions): no meter, by rule. */
const UNLIMITED_SNAPSHOT = { ...LIMITED_SNAPSHOT, isUnlimitedEntitlement: true, entitlementRequests: 0 };

/** The observation time of the recorded probe — after the reset date it reported, so the past
 * date is pinned by the assertions below. */
const OBSERVED_AT = Date.parse('2026-10-01T22:04:53.436Z');
const RESET_AT = Date.parse('2026-10-01T14:51:31.434-07:00');

describe('mapCopilotQuotaSnapshots (P-39)', () => {
  it('P-39: the recorded snapshot maps the limited key to an informational pool with its percentage', () => {
    const mapped = mapCopilotQuotaSnapshots(
      { quotaSnapshots: { chat: UNLIMITED_SNAPSHOT, completions: UNLIMITED_SNAPSHOT, premium_interactions: LIMITED_SNAPSHOT } },
      OBSERVED_AT,
    );

    expect(mapped.ok).toBe(true);
    if (!mapped.ok) throw new Error('unreachable');
    expect(mapped.readings).toEqual([
      {
        pool: {
          // The key verbatim; which models draw from it is not documented, so the pool is
          // informational — shown, never matched, never blocking.
          label: 'premium_interactions',
          kind: 'allowance',
          appliesTo: 'unknown',
        },
        meter: {
          cadence: 'calendar',
          unit: 'percent',
          used: 0,
          limit: 100,
          remaining: 100,
          resetsAt: RESET_AT,
          resetPrecision: 'exact',
          observedAt: OBSERVED_AT,
          source: 'polled',
        },
      },
    ]);
    // The two unlimited keys state no meter, each said so in a note naming the key alone.
    expect(mapped.notes).toEqual(['chat: unlimited entitlement, no meter', 'completions: unlimited entitlement, no meter']);
  });

  it('P-39: a reset date in the past is carried as reported, never assumed to be the next reset', () => {
    const mapped = mapCopilotQuotaSnapshots(
      { quotaSnapshots: { premium_interactions: LIMITED_SNAPSHOT } },
      // Observed well after the reported reset date: the mapper must not roll the date forward.
      Date.parse('2026-10-02T09:15:00.000Z'),
    );

    expect(mapped.ok).toBe(true);
    if (!mapped.ok) throw new Error('unreachable');
    expect(mapped.readings[0]?.meter.resetsAt).toBe(RESET_AT);
    expect(mapped.readings[0]?.meter.resetPrecision).toBe('exact');
  });

  it('P-39: a partially used entitlement maps its remaining percentage verbatim on the percent scale', () => {
    const mapped = mapCopilotQuotaSnapshots(
      {
        quotaSnapshots: {
          premium_interactions: { ...LIMITED_SNAPSHOT, usedRequests: 120, remainingPercentage: 40 },
        },
      },
      OBSERVED_AT,
    );

    expect(mapped.ok).toBe(true);
    if (!mapped.ok) throw new Error('unreachable');
    expect(mapped.readings[0]?.meter).toMatchObject({ unit: 'percent', used: 60, limit: 100, remaining: 40 });
  });

  it('P-39: a key the mapper does not know still maps — label verbatim, applicability unknown', () => {
    const mapped = mapCopilotQuotaSnapshots(
      { quotaSnapshots: { weekly_guardrail: { ...LIMITED_SNAPSHOT, remainingPercentage: 80 } } },
      OBSERVED_AT,
    );

    expect(mapped.ok).toBe(true);
    if (!mapped.ok) throw new Error('unreachable');
    expect(mapped.readings[0]?.pool).toEqual({ label: 'weekly_guardrail', kind: 'allowance', appliesTo: 'unknown' });
    expect(mapped.readings[0]?.meter.remaining).toBe(80);
  });

  it('P-39: a negative entitlement count is the documented other spelling of unlimited — no meter', () => {
    const mapped = mapCopilotQuotaSnapshots(
      { quotaSnapshots: { chat: { ...LIMITED_SNAPSHOT, isUnlimitedEntitlement: false, entitlementRequests: -1 } } },
      OBSERVED_AT,
    );

    expect(mapped.ok).toBe(true);
    if (!mapped.ok) throw new Error('unreachable');
    expect(mapped.readings).toEqual([]);
    expect(mapped.notes).toEqual(['chat: unlimited entitlement, no meter']);
  });

  it('P-39: a snapshot without any readable number or date is never shown as numbers', () => {
    const mapped = mapCopilotQuotaSnapshots(
      { quotaSnapshots: { premium_interactions: { isUnlimitedEntitlement: false, entitlementRequests: 200 } } },
      OBSERVED_AT,
    );

    // Nothing numeric was stated, so the probe fails naming the unreadable key — the field
    // name only, never any value behind it.
    expect(mapped).toEqual({ ok: false, unrecognized: ['premium_interactions'] });
  });

  it('P-39: a payload without a snapshot map is unreadable and names the fields it carried', () => {
    expect(mapCopilotQuotaSnapshots('not-a-record', OBSERVED_AT)).toEqual({ ok: false, unrecognized: [] });
    expect(mapCopilotQuotaSnapshots({ somethingElse: 1 }, OBSERVED_AT)).toEqual({ ok: false, unrecognized: ['somethingElse'] });
    expect(mapCopilotQuotaSnapshots({ quotaSnapshots: {} }, OBSERVED_AT)).toEqual({ ok: false, unrecognized: [] });
  });

  it('P-39: an unreadable entry among readable ones is named in a note and does not fail the poll', () => {
    const mapped = mapCopilotQuotaSnapshots(
      {
        quotaSnapshots: {
          premium_interactions: LIMITED_SNAPSHOT,
          broken: 'not-a-record',
        },
      },
      OBSERVED_AT,
    );

    expect(mapped.ok).toBe(true);
    if (!mapped.ok) throw new Error('unreachable');
    expect(mapped.readings).toHaveLength(1);
    expect(mapped.notes).toEqual(['unreadable snapshot keys: broken']);
  });
});
