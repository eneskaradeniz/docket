// Mapper for the provider SDK's account quota snapshot map onto meter readings. Contract:
// docs/v2/quota.md → provider notes (the Copilot CLI row: monthly allowance measured in the
// provider's credit unit, entitlement counts and percentages in the snapshot, hidden
// session/weekly guardrails the snapshot never shows) and P-39 in
// docs/v2/provider-capabilities.md §13 (dynamic meters — a key the table cannot match is
// informational, never blocking; unlimited entitlements show no meter). Pure on purpose: a
// future probe hands it the payload and the observation time; everything here is derivation.
// Diagnostic notes name keys and field names, never values. The quota call itself rides the
// provider SDK, which this repository does not depend on, so the mapper ships alone over the
// recorded shape until that decision changes.
import type { EpochMs, PoolKind } from '../../../../domain/index';
import type { MeterReading } from '../../../../application/index';

/** Plan entitlement windows are a shared allowance to spend, like every provider plan pool. */
const POOL_KIND: PoolKind = 'allowance';

/** The snapshot states its remainder as a percentage, so the meter carries the provider's own
 * scale — never rescaled to a fraction and never shown as another unit. */
const PERCENT_SCALE = 100;

const isRecord = (value: unknown): value is Readonly<Record<string, unknown>> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

/** What the mapper hands a probe: readings plus diagnostic notes, or the keys that stayed
 * unreadable — the names only, never the values behind them. */
export type CopilotQuotaMapping =
  | { readonly ok: true; readonly readings: readonly MeterReading[]; readonly notes: readonly string[] }
  | { readonly ok: false; readonly unrecognized: readonly string[] };

/**
 * Parses the quota snapshot map into readings, one pool per key. A key names its pool label
 * verbatim; which models draw from a key is not documented anywhere the provider states, so
 * every pool is informational (`appliesTo: 'unknown'`) — shown, never matched, never blocking;
 * exhaustion surfaces through limit hits, not through these meters. Unlimited entitlements
 * (the flag the snapshot carries, or the documented `-1` count spelling) state no meter. A
 * payload nothing readable can be derived from fails, so a poll never persists made-up numbers.
 */
export function mapCopilotQuotaSnapshots(payload: unknown, observedAt: EpochMs): CopilotQuotaMapping {
  if (!isRecord(payload)) return { ok: false, unrecognized: [] };
  const snapshots = payload['quotaSnapshots'];
  if (!isRecord(snapshots)) return { ok: false, unrecognized: Object.keys(payload) };

  const readings: MeterReading[] = [];
  const notes: string[] = [];
  const unreadable: string[] = [];
  for (const [key, snapshot] of Object.entries(snapshots)) {
    if (!isRecord(snapshot)) {
      unreadable.push(key);
      continue;
    }
    const entitlement = snapshot['entitlementRequests'];
    const unlimited =
      snapshot['isUnlimitedEntitlement'] === true || (typeof entitlement === 'number' && entitlement < 0);
    if (unlimited) {
      notes.push(`${key}: unlimited entitlement, no meter`);
      continue;
    }
    const rawRemaining = snapshot['remainingPercentage'];
    const remaining =
      typeof rawRemaining === 'number' && Number.isFinite(rawRemaining) ? rawRemaining : undefined;
    const parsedReset = typeof snapshot['resetDate'] === 'string' ? Date.parse(snapshot['resetDate']) : Number.NaN;
    const resetsAt = Number.isNaN(parsedReset) ? undefined : parsedReset;
    if (remaining === undefined && resetsAt === undefined) {
      unreadable.push(key);
      continue;
    }
    readings.push({
      pool: { label: key, kind: POOL_KIND, appliesTo: 'unknown' },
      meter: {
        // The allowance is a calendar-month window; the snapshot states no window name and no
        // length, so the meter carries neither a label nor a duration — identity rides on the
        // pool label alone, and neither may be invented from the key.
        cadence: 'calendar',
        unit: 'percent',
        ...(remaining === undefined
          ? {}
          : { used: PERCENT_SCALE - remaining, limit: PERCENT_SCALE, remaining }),
        // The date is carried exactly as reported: the recorded run reports a reset date in the
        // past, and it is the provider's own answer — never rolled forward to a guessed next
        // reset.
        ...(resetsAt === undefined ? {} : { resetsAt }),
        resetPrecision: resetsAt === undefined ? 'unknown' : 'exact',
        observedAt,
        source: 'polled',
      },
    });
  }
  // A poll fails only when no key stated anything at all: a snapshot map of unlimited
  // entitlements alone is a successful read that happens to carry no meter, and the notes say
  // so — a probe may still treat an empty reading list its own way.
  if (readings.length === 0 && notes.length === 0) {
    return { ok: false, unrecognized: unreadable.length > 0 ? unreadable : Object.keys(snapshots) };
  }
  if (unreadable.length > 0) notes.push(`unreadable snapshot keys: ${unreadable.join(', ')}`);
  return { ok: true, readings, notes };
}
